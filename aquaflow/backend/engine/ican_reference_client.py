#!/usr/bin/env python3
"""
ican_client.py - minimal client for the I-CAN Music Fountain Control System
protocol, reverse-engineered from a live capture against a real NetCAN
converter (gateway 192.168.5.2:200, PC-side host 192.168.5.200:2002).

=============================================================================
THIS FILE IS THE LIVE TRANSPORT. DO NOT "IMPROVE" IT.
=============================================================================
On 31 Aug 2026 this script was run against the real site gateway and IT DROVE
THE FOUNTAIN. AquaFlow does not reimplement it and does not wrap it in a
cleverer socket layer -- ICANConnection instantiates the ICANClient below and
calls set_channels()/all_off()/poll() on it. The bytes that reach the gateway
come from this file, so "it works from the terminal but not from the app"
cannot be a difference in the protocol code.

Do not add SO_REUSEADDR here. Its absence is load-bearing: binding local port
2002 must FAIL LOUDLY when the vendor I-CAN software already owns it, rather
than appearing to succeed while the frames go nowhere.

Everything above the transport -- the safety-kernel permit, the typed ARM
confirmation, the channel map -- still applies. Those gates decide WHETHER a
command is allowed. This file decides what the frame looks like and puts it on
the wire, and it is the part that is proven.

PROTOCOL (confirmed from capture.jsonl, 8085 frames):
    All frames are exactly 13 bytes over UDP.

        byte 0        : command
                           0x08 = OUTPUT/state  (set/announce channel bitmask
                                                  for a group)
                           0x03 = channel-address (PC->GW poll/handshake)
                           0x07 = status-reply     (GW->PC ack, payload AA AA
                                                     AA AA 00 when idle)
        bytes 1-4     : group id, big-endian uint32 (e.g. group 9 -> 00 00 00 09)
        bytes 5-9     : 5-byte channel bitmask (40 channels).
                           bit i of byte b (LSB first) = channel (b*8 + i + 1)
        bytes 10-12   : trailer. Always 00 00 00 for ordinary per-group
                           OUTPUT/state frames. Only the very first "group 0"
                           handshake frame of a session used a non-zero
                           trailer (A9 03 21) - group 0 / that trailer never
                           reappeared in 8085 frames, so it looks like a
                           one-time full-state sync rather than something a
                           normal controller needs to send.

    Channel control is fire-and-forget: the gateway did NOT ack ordinary
    per-group 0x08 frames in the capture, so no reply needs to be read back
    for basic control (poll with 0x03 / read 0x07 status-reply if you want
    a heartbeat/health-check).

USAGE
    # your controlling machine must be on the same subnet as the gateway,
    # e.g. static IP 192.168.5.200/24 (matches the original PC's ipconfig)

    from ican_client import ICANClient

    client = ICANClient(gateway_ip="192.168.5.2", gateway_port=200)
    client.set_channels(group=1, channels=[9, 13, 17, 21])   # turn these on, rest off in group 1
    client.all_off(group=1)

    # CLI:
    python3 ican_client.py --gateway 192.168.5.2 --group 1 --on 9,13,17,21
    python3 ican_client.py --gateway 192.168.5.2 --group 1 --all-off
    python3 ican_client.py --gateway 192.168.5.2 --replay changes.txt --speed 1.0
"""

import argparse
import re
import socket
import sys
import time

MASK_BYTES = 5          # 40 channels
TRAILER = b"\x00\x00\x00"
CMD_OUTPUT = 0x08
CMD_CHANNEL_ADDRESS = 0x03
CMD_STATUS_REPLY = 0x07


def channels_to_mask(channels, mask_bytes=MASK_BYTES):
    """[1, 4, 9] -> 5-byte bitmask, bit i of byte b = channel b*8+i+1."""
    mask = bytearray(mask_bytes)
    for ch in channels:
        if ch < 1 or ch > mask_bytes * 8:
            raise ValueError(f"channel {ch} out of range 1..{mask_bytes*8}")
        idx0 = ch - 1
        byte_i, bit_i = divmod(idx0, 8)
        mask[byte_i] |= (1 << bit_i)
    return bytes(mask)


def mask_to_channels(mask: bytes):
    channels = []
    for byte_i, b in enumerate(mask):
        for bit_i in range(8):
            if b & (1 << bit_i):
                channels.append(byte_i * 8 + bit_i + 1)
    return channels


def encode_frame(cmd: int, group: int, mask: bytes = None, trailer: bytes = TRAILER) -> bytes:
    if mask is None:
        mask = bytes(MASK_BYTES)
    if len(mask) != MASK_BYTES:
        raise ValueError(f"mask must be {MASK_BYTES} bytes")
    if len(trailer) != 3:
        raise ValueError("trailer must be 3 bytes")
    group_b = group.to_bytes(4, "big")
    return bytes([cmd]) + group_b + mask + trailer


def decode_frame(data: bytes):
    if len(data) != 13:
        raise ValueError(f"expected 13-byte frame, got {len(data)}")
    cmd = data[0]
    group = int.from_bytes(data[1:5], "big")
    payload = data[5:13]
    result = {"cmd": cmd, "group": group, "payload_hex": payload.hex(" ")}
    if cmd == CMD_OUTPUT:
        mask = payload[:MASK_BYTES]
        result["channels"] = mask_to_channels(mask)
        result["trailer"] = payload[MASK_BYTES:]
    return result


class ICANClient:
    def __init__(self, gateway_ip: str, gateway_port: int = 200,
                 local_ip: str = "", local_port: int = 2002, timeout: float = 1.0):
        self.gateway_addr = (gateway_ip, gateway_port)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.settimeout(timeout)
        try:
            self.sock.bind((local_ip, local_port))
        except OSError as e:
            raise OSError(
                f"couldn't bind local UDP port {local_port} ({e}). "
                "Make sure nothing else (e.g. the original I-CAN app) is running, "
                "and that this machine has an IP on the gateway's subnet."
            )

    def _send(self, frame: bytes):
        self.sock.sendto(frame, self.gateway_addr)

    def set_channels(self, group: int, channels):
        """Set the ON channels for a group (all others in that group go off)."""
        mask = channels_to_mask(channels)
        self._send(encode_frame(CMD_OUTPUT, group, mask))

    def all_off(self, group: int):
        self.set_channels(group, [])

    def poll(self, group: int, read_reply: bool = True):
        """Send a channel-address (0x03) probe; optionally read the 0x07 status-reply."""
        self._send(encode_frame(CMD_CHANNEL_ADDRESS, group, bytes(MASK_BYTES)))
        if read_reply:
            try:
                data, _ = self.sock.recvfrom(64)
                return decode_frame(data)
            except socket.timeout:
                return None

    def close(self):
        self.sock.close()


# ---------------------------------------------------------------------------
# changes.txt replay - lets you sanity-check the client against a real
# gateway using the exact sequence you already captured, at real timing.
# Expected line format (as produced by the capture tool):
#     8.26s      0  [1, 4, 6, 9, ...]
#    17.45s      1  [9, 13, 17, 21, 25, 29, 33, 37]
#    17.45s      9  (all off)
# ---------------------------------------------------------------------------
LINE_RE = re.compile(
    r"^\s*([\d.]+)s\s+(\d+)\s+(\(all off\)|\[[^\]]*\])"
)


def parse_changes_file(path):
    events = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = LINE_RE.match(line)
            if not m:
                continue
            t = float(m.group(1))
            group = int(m.group(2))
            raw = m.group(3)
            channels = [] if raw == "(all off)" else [int(x) for x in raw.strip("[]").split(",") if x.strip()]
            events.append((t, group, channels))
    return events


def replay(client: ICANClient, events, speed: float = 1.0):
    if not events:
        print("no events to replay")
        return
    t0 = events[0][0]
    start = time.monotonic()
    for t, group, channels in events:
        target = start + (t - t0) / speed
        now = time.monotonic()
        if target > now:
            time.sleep(target - now)
        client.set_channels(group, channels)
        print(f"[{t:8.2f}s] group {group:2d} -> {channels}")


def main():
    ap = argparse.ArgumentParser(description="I-CAN protocol client / CLI")
    ap.add_argument("--gateway", default="192.168.5.2", help="gateway IP (default 192.168.5.2)")
    ap.add_argument("--port", type=int, default=200, help="gateway UDP port (default 200)")
    ap.add_argument("--local-port", type=int, default=2002, help="local UDP port to bind (default 2002)")
    ap.add_argument("--group", type=int, help="group id to control")
    ap.add_argument("--on", help="comma-separated channel numbers to turn on, e.g. 9,13,17")
    ap.add_argument("--all-off", action="store_true", help="turn all channels off for --group")
    ap.add_argument("--poll", action="store_true", help="send a channel-address probe to --group and print the reply")
    ap.add_argument("--replay", metavar="FILE", help="replay a changes.txt-format sequence file")
    ap.add_argument("--speed", type=float, default=1.0, help="replay speed multiplier (default 1.0 = real time)")
    args = ap.parse_args()

    client = ICANClient(args.gateway, args.port, local_port=args.local_port)

    try:
        if args.replay:
            events = parse_changes_file(args.replay)
            print(f"loaded {len(events)} events from {args.replay}")
            replay(client, events, speed=args.speed)
        elif args.poll:
            if args.group is None:
                sys.exit("--poll requires --group")
            reply = client.poll(args.group)
            print(reply)
        elif args.all_off:
            if args.group is None:
                sys.exit("--all-off requires --group")
            client.all_off(args.group)
            print(f"group {args.group}: all off")
        elif args.on is not None:
            if args.group is None:
                sys.exit("--on requires --group")
            channels = [int(x) for x in args.on.split(",") if x.strip()]
            client.set_channels(args.group, channels)
            print(f"group {args.group}: {channels}")
        else:
            ap.print_help()
    finally:
        client.close()


if __name__ == "__main__":
    main()
