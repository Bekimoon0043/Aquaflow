"""
engine/profinet_dcp.py — PROFINET DCP Identify (read-only), for finding Siemens
and other PROFINET devices on the LOCAL Ethernet segment.

DCP is a layer-2 protocol (EtherType 0x8892). An Identify-All request is one
multicast frame to 01:0E:CF:00:00:00; every PROFINET device on the segment
answers with its station name, vendor/device id, IP parameters and role. It
does not cross a router, which is exactly right for "what is in this cabinet".

Strictly read-only by construction. This module implements the Identify service
(0x05) ONLY. There is no DCP Set (IP/name assignment), no factory reset and no
Signal/LED-flash service anywhere in it — those services change device state
and are out of scope for discovery.

The wire codec is pure and tested against constructed frames. Sending needs a
raw Ethernet socket: Linux AF_PACKET works natively (root or CAP_NET_RAW);
Windows needs npcap, which AquaFlow does not bundle — there the sender reports
`available=False` with the reason rather than pretending the segment is empty.
S7comm validation over TCP 102 (engine/s7_identify.py) does not have that
limitation and remains the universal path.
"""
from __future__ import annotations

import os
import socket
import struct
import sys
import time
from dataclasses import dataclass, field, asdict
from typing import Optional

ETHERTYPE_PN = 0x8892
DCP_MULTICAST = bytes.fromhex("010ecf000000")
FRAME_ID_IDENTIFY_REQ = 0xFEFE
FRAME_ID_IDENTIFY_RSP = 0xFEFF
SERVICE_IDENTIFY = 0x05
SERVICE_TYPE_REQUEST = 0x00
SERVICE_TYPE_RESPONSE = 0x01
SERVICE_TYPE_RESPONSE_UNSUPPORTED = 0x05

# Options / suboptions (IEC 61158-6-10).
OPT_IP, OPT_DEVICE, OPT_ALL = 0x01, 0x02, 0xFF
SUB_IP_MAC, SUB_IP_PARAM = 0x01, 0x02
SUB_DEV_VENDOR, SUB_DEV_NAME, SUB_DEV_ID, SUB_DEV_ROLE = 0x01, 0x02, 0x03, 0x04
SUB_DEV_OPTIONS, SUB_DEV_ALIAS, SUB_DEV_INSTANCE, SUB_DEV_OEM_ID = 0x05, 0x06, 0x07, 0x08

PN_VENDORS = {
    0x002A: "Siemens", 0x0010: "Phoenix Contact", 0x011A: "Beckhoff", 0x0101: "WAGO",
    0x00B0: "Turck", 0x0116: "Hilscher", 0x0122: "Weidmüller", 0x0127: "ifm",
}
ROLES = {0x01: "IO-Device", 0x02: "IO-Controller", 0x04: "IO-Multidevice", 0x08: "PN-Supervisor"}


@dataclass
class DcpDevice:
    mac: str
    station_name: str = ""
    vendor_name: str = ""          # "type of station" text (e.g. "S7-1200")
    vendor_id: Optional[int] = None
    vendor: str = ""               # decoded from vendor_id
    device_id: Optional[int] = None
    role: str = ""
    ip: str = ""
    netmask: str = ""
    gateway: str = ""
    alias: str = ""
    instance: Optional[int] = None
    order_id: str = ""             # not carried by DCP Identify; filled by S7 SZL later
    device_family: str = ""
    raw_blocks: list = field(default_factory=list)
    warnings: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


class DcpParseError(ValueError):
    pass


# ── request ──────────────────────────────────────────────────────────────────
def build_identify_all(src_mac: bytes, xid: int = 0x01000001, response_delay: int = 1) -> bytes:
    """One Identify-All request frame (Ethernet + PN + DCP). Option/suboption
    0xFF/0xFF = "all devices". Nothing in it can change a device."""
    if len(src_mac) != 6:
        raise ValueError("src_mac must be 6 bytes")
    dcp_block = struct.pack(">BBH", OPT_ALL, 0xFF, 0)
    dcp = struct.pack(">BBIHH", SERVICE_IDENTIFY, SERVICE_TYPE_REQUEST, xid,
                      response_delay, len(dcp_block)) + dcp_block
    pn = struct.pack(">H", FRAME_ID_IDENTIFY_REQ) + dcp
    eth = DCP_MULTICAST + src_mac + struct.pack(">H", ETHERTYPE_PN)
    frame = eth + pn
    return frame + bytes(max(0, 60 - len(frame)))      # minimum Ethernet payload


# ── response ─────────────────────────────────────────────────────────────────
def parse_identify_response(frame: bytes, *, expected_xid: Optional[int] = None) -> DcpDevice:
    """Parse one Identify response Ethernet frame. Raises DcpParseError on
    anything that is not a well-formed DCP Identify response."""
    b = bytes(frame)
    if len(b) < 14 + 2 + 10:
        raise DcpParseError(f"frame too short ({len(b)} bytes)")
    ethertype = struct.unpack_from(">H", b, 12)[0]
    offset = 14
    if ethertype == 0x8100:                                # VLAN tag
        if len(b) < 18 + 12:
            raise DcpParseError("VLAN frame too short")
        ethertype = struct.unpack_from(">H", b, 16)[0]
        offset = 18
    if ethertype != ETHERTYPE_PN:
        raise DcpParseError(f"EtherType 0x{ethertype:04X} is not PROFINET")
    src_mac = ":".join(f"{x:02x}" for x in b[6:12])
    frame_id = struct.unpack_from(">H", b, offset)[0]
    if frame_id != FRAME_ID_IDENTIFY_RSP:
        raise DcpParseError(f"FrameID 0x{frame_id:04X} is not Identify response")
    service, stype, xid, _resp_delay, dcp_len = struct.unpack_from(">BBIHH", b, offset + 2)
    if service != SERVICE_IDENTIFY:
        raise DcpParseError(f"service 0x{service:02X} is not Identify")
    if stype == SERVICE_TYPE_RESPONSE_UNSUPPORTED:
        raise DcpParseError("device answered 'service not supported'")
    if stype != SERVICE_TYPE_RESPONSE:
        raise DcpParseError(f"service type 0x{stype:02X} is not a response")
    if expected_xid is not None and xid != expected_xid:
        raise DcpParseError(f"xid 0x{xid:08X} does not match our request")
    body_start = offset + 12
    body = b[body_start:body_start + dcp_len]
    if len(body) < dcp_len:
        raise DcpParseError(f"DCP length {dcp_len} overruns the frame ({len(body)} available)")
    dev = DcpDevice(mac=src_mac)
    pos = 0
    while pos + 4 <= len(body):
        opt, sub, blen = struct.unpack_from(">BBH", body, pos)
        pos += 4
        if pos + blen > len(body):
            raise DcpParseError(f"block {opt:02X}/{sub:02X} length {blen} overruns the DCP body")
        block = body[pos:pos + blen]
        pos += blen + (blen & 1)                            # blocks are padded to even
        dev.raw_blocks.append(f"{opt:02X}/{sub:02X}:{block.hex()}")
        if blen < 2:
            dev.warnings.append(f"block {opt:02X}/{sub:02X} has no BlockInfo")
            continue
        payload = block[2:]                                 # skip BlockInfo
        _apply_block(dev, opt, sub, payload)
    if not dev.station_name and not dev.ip and dev.vendor_id is None:
        raise DcpParseError("response carries no identity blocks")
    if dev.vendor_id == 0x002A and dev.vendor_name:
        dev.device_family = dev.vendor_name
    return dev


def _apply_block(dev: DcpDevice, opt: int, sub: int, payload: bytes):
    if opt == OPT_IP and sub == SUB_IP_PARAM:
        if len(payload) < 12:
            dev.warnings.append("IP parameter block too short")
            return
        dev.ip = socket.inet_ntoa(payload[0:4])
        dev.netmask = socket.inet_ntoa(payload[4:8])
        dev.gateway = socket.inet_ntoa(payload[8:12])
    elif opt == OPT_IP and sub == SUB_IP_MAC:
        if len(payload) >= 6:
            dev.mac = ":".join(f"{x:02x}" for x in payload[:6])
    elif opt == OPT_DEVICE and sub == SUB_DEV_VENDOR:
        dev.vendor_name = payload.decode("utf-8", errors="replace").rstrip("\x00")
    elif opt == OPT_DEVICE and sub == SUB_DEV_NAME:
        dev.station_name = payload.decode("utf-8", errors="replace").rstrip("\x00")
    elif opt == OPT_DEVICE and sub == SUB_DEV_ID:
        if len(payload) >= 4:
            dev.vendor_id, dev.device_id = struct.unpack_from(">HH", payload, 0)
            dev.vendor = PN_VENDORS.get(dev.vendor_id, f"vendor 0x{dev.vendor_id:04X}")
    elif opt == OPT_DEVICE and sub == SUB_DEV_ROLE:
        if payload:
            dev.role = ", ".join(n for bit, n in ROLES.items() if payload[0] & bit) or f"0x{payload[0]:02X}"
    elif opt == OPT_DEVICE and sub == SUB_DEV_ALIAS:
        dev.alias = payload.decode("utf-8", errors="replace").rstrip("\x00")
    elif opt == OPT_DEVICE and sub == SUB_DEV_INSTANCE:
        if len(payload) >= 2:
            dev.instance = struct.unpack_from(">H", payload, 0)[0]


def build_identify_response(*, src_mac: bytes, xid: int = 0x01000001, station_name="plc-1",
                            vendor_name="S7-1200", vendor_id=0x002A, device_id=0x010D,
                            role=0x02, ip="192.168.5.10", mask="255.255.255.0",
                            gw="192.168.5.1", dst_mac: bytes = bytes(6),
                            corrupt_length: bool = False) -> bytes:
    """Fake-device response builder (tests / bench). Mirrors what an S7-1200
    answers to Identify-All."""
    def block(opt, sub, data: bytes, info: int = 0) -> bytes:
        body = struct.pack(">H", info) + data
        out = struct.pack(">BBH", opt, sub, len(body)) + body
        return out + (b"\x00" if len(body) & 1 else b"")

    blocks = (
        block(OPT_DEVICE, SUB_DEV_VENDOR, vendor_name.encode()) +
        block(OPT_DEVICE, SUB_DEV_NAME, station_name.encode()) +
        block(OPT_DEVICE, SUB_DEV_ID, struct.pack(">HH", vendor_id, device_id)) +
        block(OPT_DEVICE, SUB_DEV_ROLE, bytes([role, 0])) +
        block(OPT_IP, SUB_IP_PARAM, socket.inet_aton(ip) + socket.inet_aton(mask) +
              socket.inet_aton(gw), info=1)
    )
    declared = len(blocks) + (40 if corrupt_length else 0)
    dcp = struct.pack(">BBIHH", SERVICE_IDENTIFY, SERVICE_TYPE_RESPONSE, xid, 0, declared) + blocks
    return dst_mac + src_mac + struct.pack(">H", ETHERTYPE_PN) + struct.pack(">H", FRAME_ID_IDENTIFY_RSP) + dcp


# ── sending (platform-gated raw socket) ──────────────────────────────────────
@dataclass
class DcpScanResult:
    available: bool
    reason: str
    interface: str = ""
    devices: list = field(default_factory=list)      # DcpDevice
    rejected: list = field(default_factory=list)     # (mac, reason) for malformed replies
    elapsed_ms: float = 0.0

    def to_dict(self) -> dict:
        return {
            "available": self.available, "reason": self.reason, "interface": self.interface,
            "devices": [d.to_dict() for d in self.devices], "rejected": self.rejected,
            "elapsed_ms": round(self.elapsed_ms, 1),
        }


def raw_ethernet_available() -> tuple[bool, str]:
    if not hasattr(socket, "AF_PACKET"):
        if sys.platform.startswith("win"):
            return False, ("PROFINET DCP needs a raw Ethernet socket (npcap on Windows) which "
                           "AquaFlow does not bundle — S7comm validation over TCP 102 is used instead")
        return False, "raw Ethernet sockets are not available on this platform"
    if hasattr(os, "geteuid") and os.geteuid() != 0:
        return False, "raw Ethernet sockets need root or CAP_NET_RAW"
    return True, "AF_PACKET available"


def dcp_identify_all(interface: str, *, listen_s: float = 1.5) -> DcpScanResult:
    """Send ONE Identify-All on `interface` and collect responses for `listen_s`.
    Blocking; run it in an executor. Only ever sends the Identify request."""
    t0 = time.monotonic()
    ok, why = raw_ethernet_available()
    if not ok:
        return DcpScanResult(available=False, reason=why, interface=interface)
    result = DcpScanResult(available=True, reason="identify-all sent", interface=interface)
    xid = int(time.time()) & 0xFFFFFFFF
    sock = None
    try:
        sock = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(ETHERTYPE_PN))
        sock.bind((interface, 0))
        src_mac = sock.getsockname()[4][:6]
        sock.settimeout(0.2)
        sock.send(build_identify_all(src_mac, xid=xid))
        seen: set[str] = set()
        deadline = time.monotonic() + listen_s
        while time.monotonic() < deadline:
            try:
                frame = sock.recv(2048)
            except socket.timeout:
                continue
            try:
                dev = parse_identify_response(frame, expected_xid=xid)
            except DcpParseError as e:
                mac = ":".join(f"{x:02x}" for x in frame[6:12]) if len(frame) >= 12 else "?"
                if "not Identify response" not in str(e):     # our own request echoes back
                    result.rejected.append((mac, str(e)))
                continue
            if dev.mac in seen:
                continue
            seen.add(dev.mac)
            result.devices.append(dev)
    except OSError as e:
        result.available = False
        result.reason = f"raw socket error: {e}"
    finally:
        if sock is not None:
            sock.close()
    result.elapsed_ms = (time.monotonic() - t0) * 1000.0
    return result
