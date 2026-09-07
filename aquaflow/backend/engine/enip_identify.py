"""
engine/enip_identify.py — EtherNet/IP ListIdentity, strictly validated.

Allen-Bradley / Rockwell devices are IDENTIFY-ONLY in AquaFlow: there is no
EtherNet/IP control driver, so the most discovery may ever say is "this is a
Logix-class device called X". Even that claim needs a real ListIdentity reply —
an open TCP 44818 proves nothing (a web proxy, a CIP router, a half-configured
firewall rule all answer a SYN).

The old identifier accepted any 24-byte blob whose first two bytes were 0x0063
and then read a product name at a hard-coded offset. This module parses the
encapsulation header and the Common Packet Format properly and refuses:
  * a command that is not ListIdentity (0x0063)
  * a non-zero encapsulation status
  * a declared length that does not match the bytes received
  * an item count of 0 (empty identity payload)
  * an item type that is not the Identity item (0x000C)
  * an item length that overruns the frame or is too short for the fixed fields
  * a product-name short-string that overruns its item

Every function is pure (bytes in, dataclass out) so it is tested against
constructed packets, never a live PLC.
"""
from __future__ import annotations

import asyncio
import struct
from dataclasses import dataclass, field, asdict
from typing import Optional

CMD_LIST_IDENTITY = 0x0063
ENCAP_HEADER_LEN = 24
ITEM_IDENTITY = 0x000C
ITEM_FIXED_LEN = 33          # encap ver(2) + sockaddr(16) + vendor(2) + type(2) +
                             # code(2) + rev(2) + status(2) + serial(4) + name_len(1)

# ODVA vendor ids that matter to a fountain plant (the rest are reported numerically).
VENDOR_NAMES = {
    0x0001: "Rockwell Automation / Allen-Bradley",
    0x0016: "Omron",
    0x001A: "Schneider Electric",
    0x0034: "Hitachi",
    0x0043: "Siemens",
    0x005A: "Turck",
    0x0116: "Beckhoff",
    0x0138: "Phoenix Contact",
    0x0188: "WAGO",
}

# CIP device-type codes (Volume 1, Appendix C).
DEVICE_TYPES = {
    0x00: "Generic Device", 0x02: "AC Drive", 0x07: "General Purpose Discrete I/O",
    0x0C: "Communications Adapter", 0x0E: "Programmable Logic Controller",
    0x10: "Position Controller", 0x1B: "Safety Discrete I/O", 0x23: "Motor Overload",
    0x24: "Softstart", 0x2B: "Managed Ethernet Switch",
    0x32: "Communications Adapter (CIP Router)",
}


def list_identity_request() -> bytes:
    """The standard 24-byte ListIdentity request: command, zero length, zero
    session, zero status, zero context, zero options. Nothing else is sent."""
    return struct.pack("<HHIIQI", CMD_LIST_IDENTITY, 0, 0, 0, 0, 0)


@dataclass
class EnipIdentity:
    vendor_id: int
    vendor: str
    device_type: int
    device_type_name: str
    product_code: int
    revision: str
    status: int
    serial: str
    product_name: str
    state: int
    ip_from_item: str = ""
    encap_version: int = 0
    warnings: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


class EnipParseError(ValueError):
    """The bytes are not a valid ListIdentity reply. The message says why."""


def parse_list_identity(data: bytes) -> EnipIdentity:
    """Validate and parse one ListIdentity reply. Raises EnipParseError."""
    b = bytes(data)
    if len(b) < ENCAP_HEADER_LEN:
        raise EnipParseError(f"truncated encapsulation header ({len(b)} < {ENCAP_HEADER_LEN})")
    cmd, length, session, status, _ctx, _opts = struct.unpack("<HHIIQI", b[:ENCAP_HEADER_LEN])
    if cmd != CMD_LIST_IDENTITY:
        raise EnipParseError(f"encapsulation command 0x{cmd:04X} is not ListIdentity")
    if status != 0:
        raise EnipParseError(f"encapsulation status 0x{status:08X} (expected 0)")
    payload = b[ENCAP_HEADER_LEN:]
    if len(payload) != length:
        raise EnipParseError(f"declared payload length {length} but {len(payload)} byte(s) received")
    if length < 2:
        raise EnipParseError("empty ListIdentity payload (no item count)")
    item_count = struct.unpack_from("<H", payload, 0)[0]
    if item_count == 0:
        raise EnipParseError("ListIdentity reply carries zero items")
    pos = 2
    for _ in range(item_count):
        if pos + 4 > len(payload):
            raise EnipParseError("item header overruns the frame")
        item_type, item_len = struct.unpack_from("<HH", payload, pos)
        pos += 4
        if pos + item_len > len(payload):
            raise EnipParseError(f"item 0x{item_type:04X} length {item_len} overruns the frame")
        item = payload[pos:pos + item_len]
        pos += item_len
        if item_type != ITEM_IDENTITY:
            continue                           # other CPF items are tolerated, not parsed
        return _parse_identity_item(item, session)
    raise EnipParseError("no Identity item (0x000C) in the reply")


def _parse_identity_item(item: bytes, session: int) -> EnipIdentity:
    if len(item) < ITEM_FIXED_LEN:
        raise EnipParseError(f"identity item too short ({len(item)} < {ITEM_FIXED_LEN})")
    encap_ver = struct.unpack_from("<H", item, 0)[0]
    # sockaddr_in (big-endian as per the spec): family(2) port(2) addr(4) zero(8)
    sin_family, sin_port = struct.unpack_from(">HH", item, 2)
    sin_addr = ".".join(str(x) for x in item[6:10])
    vendor_id, device_type, product_code = struct.unpack_from("<HHH", item, 18)
    rev_major, rev_minor = item[24], item[25]
    status = struct.unpack_from("<H", item, 26)[0]
    serial = struct.unpack_from("<I", item, 28)[0]
    name_len = item[32]
    if 33 + name_len + 1 > len(item):
        raise EnipParseError(
            f"product name length {name_len} overruns the identity item ({len(item)} bytes)")
    name = item[33:33 + name_len].decode("ascii", errors="replace")
    state = item[33 + name_len]
    warnings = []
    if encap_ver != 1:
        warnings.append(f"encapsulation protocol version {encap_ver} (expected 1)")
    if sin_family != 2:
        warnings.append(f"sockaddr family {sin_family} (expected AF_INET=2)")
    if session != 0:
        warnings.append("non-zero session handle in an unconnected reply")
    return EnipIdentity(
        vendor_id=vendor_id,
        vendor=VENDOR_NAMES.get(vendor_id, f"vendor 0x{vendor_id:04X}"),
        device_type=device_type,
        device_type_name=DEVICE_TYPES.get(device_type, f"device type 0x{device_type:04X}"),
        product_code=product_code,
        revision=f"{rev_major}.{rev_minor:03d}",
        status=status,
        serial=f"{serial:08X}",
        product_name=name.strip(),
        state=state,
        ip_from_item=sin_addr,
        encap_version=encap_ver,
        warnings=warnings,
    )


def build_list_identity_reply(*, vendor_id: int = 1, device_type: int = 0x0E,
                              product_code: int = 0x5D, rev=(33, 11), status: int = 0x0060,
                              serial: int = 0x00C0FFEE, name: str = "1769-L33ER/A LOGIX5333ER",
                              state: int = 3, ip: str = "192.168.5.20",
                              encap_status: int = 0, item_type: int = ITEM_IDENTITY,
                              item_count: int = 1, truncate: int = 0,
                              lie_length: int = 0, lie_name_len: Optional[int] = None) -> bytes:
    """A reply builder for the fake server and the tests. The `lie_*`/`truncate`
    knobs produce the malformed variants the parser must refuse."""
    raw_name = name.encode("ascii")
    item = struct.pack("<H", 1)                                      # encap version
    item += struct.pack(">HH", 2, 44818) + bytes(int(x) for x in ip.split(".")) + bytes(8)
    item += struct.pack("<HHH", vendor_id, device_type, product_code)
    item += bytes([rev[0], rev[1]]) + struct.pack("<H", status) + struct.pack("<I", serial)
    item += bytes([lie_name_len if lie_name_len is not None else len(raw_name)]) + raw_name
    item += bytes([state])
    body = struct.pack("<H", item_count) + struct.pack("<HH", item_type, len(item)) + item
    hdr = struct.pack("<HHIIQI", CMD_LIST_IDENTITY, len(body) + lie_length, 0,
                      encap_status, 0, 0)
    frame = hdr + body
    return frame[:len(frame) - truncate] if truncate else frame


async def list_identity(ip: str, port: int = 44818, *, connect_timeout: float = 1.0,
                        timeout: float = 1.5) -> tuple[Optional[EnipIdentity], str, Optional[bytes]]:
    """Send ONE ListIdentity over TCP and validate the reply.
    Returns (identity | None, reason, raw_reply). Never raises."""
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port),
                                                timeout=connect_timeout)
    except Exception as e:
        return None, f"tcp connect failed: {e.__class__.__name__}", None
    try:
        writer.write(list_identity_request())
        await writer.drain()
        try:
            head = await asyncio.wait_for(reader.readexactly(ENCAP_HEADER_LEN), timeout=timeout)
        except asyncio.IncompleteReadError as e:
            return None, f"truncated encapsulation header ({len(e.partial)} bytes)", bytes(e.partial)
        except asyncio.TimeoutError:
            return None, "no ListIdentity reply (timeout)", None
        length = struct.unpack_from("<H", head, 2)[0]
        try:
            body = await asyncio.wait_for(reader.readexactly(length), timeout=timeout) if length else b""
        except asyncio.IncompleteReadError as e:
            raw = head + bytes(e.partial)
            return None, f"truncated payload ({len(e.partial)} of {length} bytes)", raw
        except asyncio.TimeoutError:
            return None, "payload timed out", head
        raw = head + body
        try:
            return parse_list_identity(raw), "valid ListIdentity reply", raw
        except EnipParseError as e:
            return None, str(e), raw
    except Exception as e:
        return None, f"socket error: {e.__class__.__name__}", None
    finally:
        try:
            writer.close()
        except Exception:
            pass
