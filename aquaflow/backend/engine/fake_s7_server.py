"""
engine/fake_s7_server.py — AF-IO-008: a minimal S7comm PLC for the bench.

The same idea as engine/fake_ican_gateway.py: enough of the real protocol to
exercise AquaFlow's client code end to end with injectable faults, and nothing
more. Speaks the S7-1200 dialect AquaFlow uses: COTP connection setup, S7
communication setup, and Read Var / Write Var against non-optimized DBs with
absolute BIT addressing (the address field is byte_offset*8 + bit — the exact
encoding the old raw driver got wrong and AF-IO-005 fixes).

DB model: db_number → bytearray. Words are big-endian, as on the wire.

Halted-CPU simulation: the server keeps answering reads forever (a halted CPU
does exactly that), and the heartbeat WORD only advances when the test calls
tick_heartbeat(). Not calling it IS the halted CPU — there is no special mode,
because that is precisely what makes the failure sneaky.

Fault modes:
  None      — behave correctly
  "error"   — every Read/Write Var item answers return code 0x05 (address out of
              range) instead of data
  "short"   — answer a Read/Write Var with a truncated TPKT frame, then close
  "drop"    — close the connection on the first Read/Write Var after setup
(Faults apply to the DATA phase only — the COTP/S7 handshake always succeeds, the
way a real PLC that later fails mid-session behaves.)
"""
from __future__ import annotations

import asyncio
import logging
import struct
from typing import Optional

logger = logging.getLogger("aquaflow.fake_s7")

# S7 item return codes (the per-item status byte in a Read/Write Var reply).
RET_OK = 0xFF
RET_ADDR_OUT_OF_RANGE = 0x05


class FakeS7Server:
    """A scriptable S7comm responder bound to 127.0.0.1:<ephemeral>."""

    def __init__(self, mode: Optional[str] = None):
        self.mode = mode
        self.dbs: dict[int, bytearray] = {1: bytearray(64)}
        self.reads = 0
        self.writes = 0
        self._server: Optional[asyncio.Server] = None
        self._conns: list[asyncio.StreamWriter] = []
        self.port: Optional[int] = None

    # ── DB helpers for tests ─────────────────────────────────────────────────
    def set_word(self, db: int, offset: int, value: int):
        buf = self.dbs.setdefault(db, bytearray(64))
        struct.pack_into(">H", buf, offset, value & 0xFFFF)

    def get_word(self, db: int, offset: int) -> int:
        return struct.unpack_from(">H", self.dbs[db], offset)[0]

    def set_bit(self, db: int, offset: int, bit: int, value: bool):
        buf = self.dbs.setdefault(db, bytearray(64))
        if value:
            buf[offset] |= 1 << bit
        else:
            buf[offset] &= ~(1 << bit)

    def tick_heartbeat(self, db: int = 1, offset: int = 0):
        """Advance the heartbeat counter — the thing a HALTED CPU stops doing
        while still answering every read."""
        self.set_word(db, offset, (self.get_word(db, offset) + 1) & 0xFFFF)

    # ── lifecycle ────────────────────────────────────────────────────────────
    async def start(self):
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]

    async def stop(self):
        if self._server:
            self._server.close()
            for w in self._conns:
                try:
                    w.close()
                except Exception:
                    pass
            self._conns = []
            await self._server.wait_closed()

    # ── the protocol ─────────────────────────────────────────────────────────
    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self._conns.append(writer)
        try:
            while True:
                tpkt = await reader.readexactly(4)
                if tpkt[0] != 0x03:
                    return                                     # not TPKT — hang up
                total = struct.unpack(">H", tpkt[2:4])[0]
                frame = await reader.readexactly(total - 4)
                self._close_after_reply = False
                reply = self._reply(frame)
                if reply is None:                              # drop mode
                    writer.close()
                    return
                writer.write(reply)
                await writer.drain()
                if self._close_after_reply:                    # short mode
                    writer.close()
                    return
        except (asyncio.IncompleteReadError, ConnectionError, OSError):
            pass

    def _reply(self, frame: bytes) -> Optional[bytes]:
        # frame = COTP + payload (TPKT already consumed).
        cotp_len = frame[0] + 1
        cotp, s7 = frame[:cotp_len], frame[cotp_len:]

        # COTP connection request → connection confirm.
        if len(cotp) >= 2 and cotp[1] == 0xE0:
            cc = bytes([0x11, 0xD0]) + cotp[2:6] + bytes([0x00]) + cotp[7:]
            return self._tpkt(cc)

        if len(s7) < 10 or s7[0] != 0x32:
            return self._tpkt(cotp)                            # echo nonsense politely

        rosctr = s7[1]
        pdu_ref = s7[4:6]

        if rosctr == 0x01:                                     # JOB
            function = s7[10]
            if function == 0xF0:                               # setup communication
                param = s7[10:18]                              # echo negotiated params
                return self._s7_ack(pdu_ref, param, b"")
            if function in (0x04, 0x05):
                # Data-phase fault injection lives HERE so the handshake stays clean.
                if self.mode == "drop":
                    return None
                if self.mode == "short":
                    self._close_after_reply = True
                    return b"\x03\x00\x00\x05\x02"             # truncated TPKT
            if function == 0x04:                               # Read Var
                return self._read_var(pdu_ref, s7)
            if function == 0x05:                               # Write Var
                return self._write_var(pdu_ref, s7)
        return self._s7_ack(pdu_ref, bytes([0x00, 0x00]), b"")

    @staticmethod
    def _parse_item(item: bytes):
        """Item spec: 12 0a 10 <transport> <length:2> <db:2> <area> <addr:3>.
        The 3-byte address is in BITS: byte_offset*8 + bit — the encoding that
        matters. Returns (db, byte_offset, bit, count, transport)."""
        transport = item[3]
        count = struct.unpack(">H", item[4:6])[0]
        db = struct.unpack(">H", item[6:8])[0]
        area = item[8]
        addr = (item[9] << 16) | (item[10] << 8) | item[11]
        if area != 0x84:                                       # only DB area modelled
            return None
        return db, addr >> 3, addr & 0x07, count, transport

    def _read_var(self, pdu_ref: bytes, s7: bytes) -> bytes:
        self.reads += 1
        item = s7[12:24]
        parsed = self._parse_item(item)
        if parsed is None or self.mode == "error":
            data = bytes([RET_ADDR_OUT_OF_RANGE, 0x00, 0x00, 0x00])
            return self._s7_ack(pdu_ref, bytes([0x04, 0x01]), data)
        db, offset, bit, count, transport = parsed
        buf = self.dbs.get(db)
        if buf is None or offset + count > len(buf):
            data = bytes([RET_ADDR_OUT_OF_RANGE, 0x00, 0x00, 0x00])
            return self._s7_ack(pdu_ref, bytes([0x04, 0x01]), data)
        if transport == 0x01:                                  # BIT transport
            value = (buf[offset] >> bit) & 1
            data = bytes([RET_OK, 0x03]) + struct.pack(">H", 1) + bytes([value])
        else:                                                  # BYTE/WORD transport
            payload = bytes(buf[offset:offset + count])
            data = bytes([RET_OK, 0x04]) + struct.pack(">H", count * 8) + payload
        return self._s7_ack(pdu_ref, bytes([0x04, 0x01]), data)

    def _write_var(self, pdu_ref: bytes, s7: bytes) -> bytes:
        self.writes += 1
        item = s7[12:24]
        parsed = self._parse_item(item)
        if parsed is None or self.mode == "error":
            return self._s7_ack(pdu_ref, bytes([0x05, 0x01]),
                                bytes([RET_ADDR_OUT_OF_RANGE]))
        db, offset, bit, count, transport = parsed
        buf = self.dbs.setdefault(db, bytearray(64))
        data_part = s7[24:]                                    # retcode-less on request
        # Request data header: 00 <transport> <length_bits:2> <payload>
        payload = data_part[4:]
        if transport == 0x01:                                  # single BIT
            self.set_bit(db, offset, bit, bool(payload[0] & 1))
        else:
            if offset + count > len(buf):
                return self._s7_ack(pdu_ref, bytes([0x05, 0x01]),
                                    bytes([RET_ADDR_OUT_OF_RANGE]))
            buf[offset:offset + count] = payload[:count]
        return self._s7_ack(pdu_ref, bytes([0x05, 0x01]), bytes([RET_OK]))

    # ── framing ──────────────────────────────────────────────────────────────
    @staticmethod
    def _tpkt(payload: bytes) -> bytes:
        return struct.pack(">BBH", 0x03, 0x00, len(payload) + 4) + payload

    def _s7_ack(self, pdu_ref: bytes, param: bytes, data: bytes) -> bytes:
        header = (bytes([0x32, 0x03, 0x00, 0x00]) + pdu_ref +
                  struct.pack(">HH", len(param), len(data)) +
                  bytes([0x00, 0x00]))                         # error class/code = ok
        cotp = bytes([0x02, 0xF0, 0x80])
        return self._tpkt(cotp + header + param + data)
