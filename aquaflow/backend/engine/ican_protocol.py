"""
I-CAN / NETCAN fountain gateway protocol codec.

Separates transport framing from fountain command semantics. Every function here
is pure (bytes in / bytes or dataclass out) so it is trivially unit-testable and
carries no I/O or hardware side effects.

=============================================================================
WHAT IS PROVEN vs UNKNOWN  (be honest about the difference — see prompt)
=============================================================================
TRANSPORT — PROVEN by packet capture (20 Aug 2026, olympia.pcap / ican_map.pcapng):
  * UDP. Computer local port 2002  <->  gateway port 200.
  * Observed site: computer 192.168.5.200, gateway 192.168.5.2. The IPs are
    site-specific and MUST NOT be hard-coded as a permanent dependency.
  * Every application-layer payload observed was EXACTLY 13 bytes.

FRAME LAYOUT:
  byte[0]      command / opcode                              — PROVEN (varies per command)
  byte[1]      for cmd 0x08: 0 = PC request, 1 = gateway reply — INFERRED from paired frames
  byte[2..3]   always 0x00 in every captured frame            — UNKNOWN (reserved?)
  byte[4]      device-group / channel selector                — PROVEN to select device groups
  byte[5..9]   payload; for cmd 0x08 a channel bitmask         — PROVEN (bit set = channel active)
  byte[10..12] trailer, almost always 0x00                     — UNKNOWN (nonzero only in a
                                                                 handshake frame)

COMMANDS OBSERVED:
  0x08  PC->GW  main output / state stream. Carries the channel bitmask, so a 0x08
                frame with a NON-ZERO mask is an OUTPUT command and is NOT safe to
                send blindly. A zeroed-mask 0x08 sets no channel active (all-off shape).
  0x08  GW->PC  reply / echo (byte[1] = 1).
  0x03  PC->GW  channel-address command (byte[4] = channel; addresses seen 1,9,17,25 —
                stride 8, matching the 8-channel SSR-8Y-A relay banks).
  0x07  GW->PC  status reply to a 0x03 (payload had an 0xAA pattern = a status bitmap).

CAPTURE-DERIVED TEST VECTORS — direction is proven, SEMANTICS ARE NOT. Do not treat
these as verified control commands (see validate-on-real-hardware note in the codec):
  PC->GW : 08 00 00 00 09 00 02 00 00 40 00 00 00
  GW->PC : 08 01 00 00 00 87 80 0B A5 B5 AF AD 0A
  PC->GW : 03 00 00 00 01 00 00 00 00 00 00 00 00
  GW->PC : 07 00 00 00 01 00 00 00 AA AA AA 00

STILL UNKNOWN / NOT DECODED:
  * Meaning of bytes 2, 3, 10, 11, 12.
  * Whether the 0x03/0x07 pair is a read query or a write — treated as UNSUPPORTED
    for control until proven on real hardware.
  * Any checksum / sequence scheme.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# ── Verified transport constants ─────────────────────────────────────────────
FRAME_LEN = 13                 # PROVEN: every observed payload is 13 bytes
DEFAULT_GATEWAY_PORT = 200     # PROVEN: gateway listens here
DEFAULT_LOCAL_PORT = 2002      # PROVEN: the working software's local port

# ── Command bytes (byte[0]) ──────────────────────────────────────────────────
CMD_OUTPUT = 0x08              # main output/state stream (PC->GW) and its echo (GW->PC)
CMD_CHANNEL = 0x03             # channel-address command (PC->GW)
CMD_STATUS_REPLY = 0x07        # status reply (GW->PC)

# A genuine I-CAN gateway reply begins with one of these. Used to tell an I-CAN
# gateway apart from any other device that merely happens to answer on the port.
SIGNATURE_COMMANDS = frozenset({CMD_OUTPUT, CMD_STATUS_REPLY})

# Byte offsets within the frame.
_OFF_CMD = 0
_OFF_FLAG = 1
_OFF_GROUP = 4
_OFF_MASK = slice(5, 10)       # 5 bytes = 40 channel bits
_OFF_TRAILER = slice(10, 13)


@dataclass
class ParsedResponse:
    """Structured view of a 13-byte frame. Unknown bytes are preserved, never dropped."""
    raw: bytes
    command: int
    is_reply: bool                 # byte[1] == 1 (meaningful for cmd 0x08)
    group: int                     # byte[4]
    channels: list[int]            # decoded active channels (for bitmask frames)
    payload: bytes                 # bytes[5..9] verbatim
    trailer: bytes                 # bytes[10..12] verbatim (UNKNOWN meaning)
    hex: str = ""

    def __post_init__(self):
        if not self.hex:
            self.hex = hexdump(self.raw)


@dataclass
class ValidationResult:
    """Why a datagram was accepted or rejected as an I-CAN gateway response."""
    valid: bool
    reason: str
    command: Optional[int] = None
    signature: Optional[str] = None


# ── helpers ──────────────────────────────────────────────────────────────────
def hexdump(data: bytes) -> str:
    """Space-separated uppercase hex, e.g. '08 00 00 ...'. For diagnostic logging."""
    return " ".join(f"{b:02X}" for b in bytes(data))


def channels_from_mask(mask: bytes) -> list[int]:
    """Decode a channel bitmask (bytes[5..9]) into 1-based active channel numbers.
    PROVEN mapping: bit `b` of mask byte `i` => channel i*8 + b + 1."""
    out: list[int] = []
    for i, byte in enumerate(bytes(mask)):
        for b in range(8):
            if byte & (1 << b):
                out.append(i * 8 + b + 1)
    return out


def mask_from_channels(channels) -> bytes:
    """Inverse of channels_from_mask — build a 5-byte bitmask from channel numbers."""
    m = bytearray(5)
    for ch in channels or ():
        idx = int(ch) - 1
        if 0 <= idx < 40:
            m[idx // 8] |= 1 << (idx % 8)
    return bytes(m)


# ── probe frames (discovery) ─────────────────────────────────────────────────
def safe_probe_frame() -> bytes:
    """The smallest, safest read-only-shaped discovery probe.

    A cmd 0x08 frame for group 0 with an ALL-ZERO channel mask. Because no channel
    bit is set, it activates nothing (all-off shape) — the least risky frame we can
    send while still soliciting the gateway's reply. NOTE: its read-only nature is
    ASSUMED from the frame shape, not proven; the real-hardware test procedure must
    confirm it with the vendor software closed and outputs in a safe state.
    """
    frame = bytearray(FRAME_LEN)
    frame[_OFF_CMD] = CMD_OUTPUT   # 0x08
    # everything else stays 0x00 -> group 0, empty mask, empty trailer
    return bytes(frame)


def captured_probe_frame() -> bytes:
    """The exact PC->GW request byte-string observed in the capture. DIAGNOSTIC ONLY —
    it carries a non-zero payload, so it must never be used as the default probe."""
    return bytes.fromhex("08000000090002000040000000")


# ── codec ────────────────────────────────────────────────────────────────────
def encode_output(group: int, channels=None, *, mask: Optional[bytes] = None) -> bytes:
    """Build a cmd 0x08 OUTPUT frame. This CAN drive hardware — callers must route it
    through the connection manager's gated, audited output path, never send it raw."""
    frame = bytearray(FRAME_LEN)
    frame[_OFF_CMD] = CMD_OUTPUT
    frame[_OFF_GROUP] = int(group) & 0xFF
    m = mask if mask is not None else mask_from_channels(channels)
    frame[5:5 + len(m[:5])] = m[:5]
    return bytes(frame)


def encode_all_off(group: int = 0) -> bytes:
    """A cmd 0x08 frame with an empty mask = all channels of `group` off. Used by
    blackout. Same shape as the safe probe (for group 0)."""
    return encode_output(group, mask=bytes(5))


def parse_response(data: bytes) -> ParsedResponse:
    """Parse a 13-byte frame, preserving every byte. Raises ValueError on wrong length
    so callers can distinguish a malformed datagram from a valid one."""
    b = bytes(data)
    if len(b) != FRAME_LEN:
        raise ValueError(f"I-CAN frame must be {FRAME_LEN} bytes, got {len(b)}")
    cmd = b[_OFF_CMD]
    return ParsedResponse(
        raw=b,
        command=cmd,
        is_reply=(b[_OFF_FLAG] == 1),
        group=b[_OFF_GROUP],
        channels=channels_from_mask(b[_OFF_MASK]) if cmd == CMD_OUTPUT else [],
        payload=b[_OFF_MASK],
        trailer=b[_OFF_TRAILER],
    )


def validate_gateway_response(data: bytes) -> ValidationResult:
    """Protocol-level validation: is this datagram a genuine I-CAN gateway reply?

    A device is called an I-CAN gateway ONLY when this passes — never merely because
    a port answered. Requires the exact 13-byte length and a known signature command
    byte, the two facts every captured gateway reply satisfies.
    """
    b = bytes(data)
    if len(b) != FRAME_LEN:
        return ValidationResult(False, f"wrong length {len(b)} (expected {FRAME_LEN})")
    cmd = b[_OFF_CMD]
    if cmd not in SIGNATURE_COMMANDS:
        return ValidationResult(
            False, f"command 0x{cmd:02X} not an I-CAN reply signature", command=cmd
        )
    return ValidationResult(
        True, "valid I-CAN gateway reply", command=cmd, signature=hexdump(b[:2])
    )
