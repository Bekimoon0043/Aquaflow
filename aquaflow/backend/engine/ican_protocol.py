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

FRAME LAYOUT (PC->GW):
  byte[0]      command / opcode                              — PROVEN
  byte[1..4]   group id, BIG-ENDIAN uint32 (group 9 -> 00 00 00 09)
                                                             — PROVEN on real hardware
  byte[5..9]   5-byte channel bitmask (40 channels).
               bit b of mask byte i => channel i*8 + b + 1   — PROVEN (drives real relays)
  byte[10..12] trailer, 00 00 00 for every ordinary frame    — PROVEN; the only non-zero
               trailer ever seen (A9 03 21) was on a single group-0 handshake frame that
               never reappeared in 8085 captured frames, so it is not needed for control.

  NOTE ON byte[1]: an earlier reading of a smaller capture treated byte[1] as a
  "0 = request / 1 = reply" flag and byte[4] alone as the group. For every group in
  0..255 the two readings produce IDENTICAL bytes, which is why that reading survived
  as long as it did. The big-endian uint32 is the correct one — it is what the working
  client sends and what the gateway acts on. GW->PC 0x08 frames are a different shape
  (they carry telemetry, not a group id), and byte[1] == 1 remains a usable heuristic
  for recognising one, which is all `is_reply` is used for.

COMMANDS OBSERVED:
  0x08  PC->GW  main output / state stream. Carries the channel bitmask, so a 0x08
                frame with a NON-ZERO mask is an OUTPUT command and is NOT safe to
                send blindly. A zeroed-mask 0x08 sets no channel active (all-off shape).
  0x08  GW->PC  reply / echo (byte[1] = 1).
  0x03  PC->GW  channel-address command (byte[4] = channel; addresses seen 1,9,17,25 —
                stride 8, matching the 8-channel SSR-8Y-A relay banks).
  0x07  GW->PC  status reply to a 0x03 (payload had an 0xAA pattern = a status bitmap).

PROVEN ON REAL HARDWARE (31 Aug 2026, site gateway 192.168.5.2:200 from 192.168.5.200:2002):
  A cmd 0x08 frame built exactly as described above RUNS THE FOUNTAIN. Sent
  fire-and-forget over UDP with NO reply read back; the gateway does NOT acknowledge
  ordinary per-group 0x08 frames. Any code path that requires an ack before it will
  transmit cannot control this hardware.

CAPTURE-DERIVED TEST VECTORS (direction and framing proven; the 0x03/0x07 pair is a
read-only poll/status exchange and is the only exchange the gateway does answer):
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
_OFF_FLAG = 1                  # GW->PC 0x08 telemetry marker only (see module docstring)
_OFF_GROUP32 = slice(1, 5)     # group id, big-endian uint32 — PROVEN on hardware
_OFF_GROUP = 4                 # low byte of the group; equal to the group for 0..255
_OFF_MASK = slice(5, 10)       # 5 bytes = 40 channel bits
_OFF_TRAILER = slice(10, 13)

MAX_CHANNEL = 40               # 5 mask bytes x 8 bits
MAX_GROUP = 0xFFFFFFFF


@dataclass
class ParsedResponse:
    """Structured view of a 13-byte frame. Unknown bytes are preserved, never dropped."""
    raw: bytes
    command: int
    is_reply: bool                 # byte[1] == 1 (meaningful for cmd 0x08)
    group: int                     # byte[4] — the group for every id 0..255
    channels: list[int]            # decoded active channels (for bitmask frames)
    payload: bytes                 # bytes[5..9] verbatim
    trailer: bytes                 # bytes[10..12] verbatim (UNKNOWN meaning)
    group32: int = 0               # bytes[1..4] big-endian, the full group field
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


def group_to_bytes(group: int) -> bytes:
    """Encode a group id as the 4-byte big-endian field at bytes[1..4].

    Big-endian is not a guess: `group 9 -> 00 00 00 09` is what the working client
    sends and what the site gateway acts on.
    """
    g = int(group)
    if not 0 <= g <= MAX_GROUP:
        raise ValueError(f"group {g} out of range 0..{MAX_GROUP}")
    return g.to_bytes(4, "big")


def group_from_bytes(data: bytes) -> int:
    """Decode the 4-byte big-endian group field."""
    return int.from_bytes(bytes(data)[:4], "big")


def mask_from_channels(channels) -> bytes:
    """Inverse of channels_from_mask — build a 5-byte bitmask from channel numbers."""
    m = bytearray(5)
    for ch in channels or ():
        idx = int(ch) - 1
        # Refuse rather than drop. Silently ignoring channel 41 would mean an operator
        # maps a jet, arms the output, presses the button and watches nothing happen
        # with no error anywhere — the worst possible failure on real equipment.
        if not 0 <= idx < MAX_CHANNEL:
            raise ValueError(f"channel {ch} out of range 1..{MAX_CHANNEL}")
        m[idx // 8] |= 1 << (idx % 8)
    return bytes(m)


# ── probe frames (discovery) ─────────────────────────────────────────────────
def encode_channel_address(group: int = 1) -> bytes:
    """Build a cmd 0x03 channel-address frame — the read-only poll.

    This is the ONE exchange the gateway is observed to answer: 0x03 out, 0x07 status
    back (payload AA AA AA AA 00 when idle). It carries no channel mask and does not
    use the output opcode at all, so it cannot actuate a relay.
    """
    frame = bytearray(FRAME_LEN)
    frame[_OFF_CMD] = CMD_CHANNEL          # 0x03
    frame[_OFF_GROUP32] = group_to_bytes(group)
    return bytes(frame)


def safe_probe_frame(group: int = 1) -> bytes:
    """The discovery / liveness probe: a cmd 0x03 channel-address poll.

    This used to be a cmd 0x08 frame with an empty mask. That was the wrong choice on
    two counts. It sprayed the OUTPUT opcode — the one that closes relays — across
    every host on the subnet during a scan, relying on an all-zero mask to make it
    harmless. And the gateway does not answer 0x08 at all, so every probe timed out
    and no real gateway was ever discovered or connected. 0x03 is both safer and the
    frame that actually gets a reply.
    """
    return encode_channel_address(group)


def all_off_frame(group: int = 0) -> bytes:
    """A cmd 0x08 frame with an empty mask: every channel of `group` off."""
    return encode_output(group, mask=bytes(5))


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
    # Big-endian uint32 across bytes[1..4]. The old code wrote `group & 0xFF` into
    # byte[4] alone, which is byte-identical for groups 0..255 but silently WRAPPED
    # above that — group 256 would have driven group 0's relays.
    frame[_OFF_GROUP32] = group_to_bytes(group)
    m = mask if mask is not None else mask_from_channels(channels)
    if len(m) != 5:
        raise ValueError(f"mask must be 5 bytes, got {len(m)}")
    frame[_OFF_MASK] = m
    return bytes(frame)


def encode_all_off(group: int = 0) -> bytes:
    """A cmd 0x08 frame with an empty mask = all channels of `group` off. Used by
    blackout."""
    return all_off_frame(group)


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
        group32=group_from_bytes(b[_OFF_GROUP32]),
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
