"""
Fake I-CAN gateway — a controllable UDP responder for integration tests.

Binds a real UDP socket on 127.0.0.1 (high port, so no privilege needed) and answers
the SAFE probe with a valid I-CAN reply. Fault modes are toggleable so tests can drive
timeout / malformed / delayed / wrong-source / duplicate behaviour deterministically.

Read-only by nature: it only ever *replies*; it never initiates or drives anything.
"""
from __future__ import annotations

import socket
import threading
import time
from dataclasses import dataclass

from engine import ican_protocol as proto


@dataclass
class FakeFaults:
    silent: bool = False           # never reply (timeout)
    malformed: bool = False        # reply with a non-13-byte / bad-command frame
    delay_s: float = 0.0           # delay before replying
    wrong_source_port: bool = False  # reply from a different port than expected
    duplicate: bool = False        # send the reply twice
    ignore_unrelated: bool = True   # do not reply to non-13-byte / unknown probes


class FakeICANGateway:
    def __init__(self, host: str = "127.0.0.1", port: int = 0, faults: FakeFaults = None):
        self.host = host
        self.faults = faults or FakeFaults()
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind((host, port))
        self.port = self._sock.getsockname()[1]
        self._alt = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)  # for wrong-source
        self._alt.bind((host, 0))
        self._run = False
        self._thread: threading.Thread | None = None
        self.received: list[bytes] = []

    # A faithful gateway reply. The real unit answers a 0x03 channel-address poll with
    # a 0x07 status frame echoing the group (idle payload AA AA AA AA 00), and does NOT
    # acknowledge 0x08 output frames at all. Modelling that silence is the whole point:
    # a fake that politely acked everything is exactly why a connect path that required
    # an ack passed every test here and could not control the real fountain.
    @staticmethod
    def _valid_reply(probe: bytes) -> bytes:
        cmd = probe[0] if probe else proto.CMD_CHANNEL
        if cmd == proto.CMD_CHANNEL:
            r = bytearray(proto.FRAME_LEN)
            r[0] = proto.CMD_STATUS_REPLY
            r[1:5] = probe[1:5]                       # echo the group field
            r[8:11] = bytes([0xAA, 0xAA, 0xAA])   # idle status bitmap
            return bytes(r)
        # Anything else (notably 0x08) gets the telemetry-shaped frame the older
        # capture showed, so tests that still want a reply to a 0x08 have one.
        r = bytearray(proto.FRAME_LEN)
        r[0] = cmd
        r[1] = 1
        return bytes(r)

    #: When True the fake behaves like the real gateway and stays silent on 0x08.
    answer_output_frames: bool = False

    def _serve(self):
        self._sock.settimeout(0.2)
        while self._run:
            try:
                data, addr = self._sock.recvfrom(1024)
            except socket.timeout:
                continue
            except OSError:
                break
            self.received.append(data)
            f = self.faults
            # ignore payloads that are not a well-formed probe
            if f.ignore_unrelated and len(data) != proto.FRAME_LEN:
                continue
            if f.silent:
                continue
            # The real gateway never acks an output frame. Control is fire-and-forget.
            if data and data[0] == proto.CMD_OUTPUT and not self.answer_output_frames:
                continue
            if f.delay_s:
                time.sleep(f.delay_s)
            if f.malformed:
                reply = b"\x99\x99"          # wrong length + bad command
            else:
                reply = self._valid_reply(data)
            sender = self._alt if f.wrong_source_port else self._sock
            try:
                sender.sendto(reply, addr)
                if f.duplicate:
                    sender.sendto(reply, addr)
            except OSError:
                pass

    def start(self):
        self._run = True
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()
        return self

    def stop(self):
        self._run = False
        if self._thread:
            self._thread.join(timeout=1.0)
        self._sock.close()
        self._alt.close()

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.stop()
