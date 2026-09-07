"""
engine/profinet_dcp.py — PROFINET DCP Identify (read-only), for finding Siemens
and other PROFINET devices on the LOCAL Ethernet segment.

DCP is a layer-2 protocol (EtherType 0x8892). An Identify-All request is one
multicast frame to 01:0E:CF:00:00:00; every PROFINET device on the segment
answers with its station name, vendor/device id, IP parameters and role — even
a PLC with NO IP address or an IP on a foreign subnet, which is exactly the
device an IP sweep can never find. It does not cross a router, which is right
for "what is in this cabinet".

Strictly read-only by construction. This module implements the Identify service
(0x05) ONLY. There is no DCP Set (IP/name assignment), no Get, no Hello, no
factory reset and no Signal/LED-flash service anywhere in it — those change
device state and are out of scope for discovery. The only frame that can leave
this module is `build_identify_all()`.

Transport providers (one is chosen per platform; all are injectable):
  AfPacketProvider  Linux AF_PACKET raw socket (root / CAP_NET_RAW).
  NpcapProvider     Windows: the Npcap runtime's wpcap.dll called through ctypes
                    — no Python package, no scapy, no Wireshark GUI. Npcap is a
                    installer from https://npcap.com that AquaFlow does NOT
                    bundle (the free/demo edition is installation-limited and
                    redistribution requires an Npcap OEM licence); the
                    provider fails CLOSED with an install hint when it is absent.
  FakeEthernetProvider
                    Bench/test provider fed with constructed frames. Automated
                    tests never touch a real NIC.

The sender is bound to ONE explicitly selected adapter (resolved by IPv4 address
and description, never "the first NIC"), transmits exactly one Identify-All per
run, correlates replies by transaction id and destination MAC, rejects malformed
or unrelated frames, de-duplicates by source MAC, and honours a deadline and a
cancel callback. S7comm validation over TCP 102 (engine/s7_identify.py) then
confirms any device whose IP is reachable.
"""
from __future__ import annotations

import ctypes
import os
import socket
import struct
import sys
import time
from dataclasses import dataclass, field, asdict
from typing import Callable, Optional

ETHERTYPE_PN = 0x8892
DCP_MULTICAST = bytes.fromhex("010ecf000000")
BROADCAST = b"\xff" * 6
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

NPCAP_URL = "https://npcap.com"
NPCAP_HINT = (
    "PROFINET DCP on Windows needs the Npcap packet-capture runtime (installer at "
    f"{NPCAP_URL}; AquaFlow does not bundle it). Install it, keep the default "
    "'Restrict Npcap driver's access to Administrators only' UNTICKED (or run AquaFlow "
    "as Administrator), then run discovery again. Until then only S7comm/Modbus "
    "identification of the selected subnet runs — PLCs with an unknown or foreign IP "
    "cannot be found. Check Npcap's current licence before deployment; its free/demo "
    "edition has an installation limit."
)

# Keep add_dll_directory handles alive for the process lifetime. Closing (or
# garbage-collecting) one removes that path from Windows' DLL search order and
# can make wpcap.dll's Packet.dll dependency disappear on a later load.
_DLL_DIRECTORY_HANDLES: list = []


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
    adapter: str = ""              # the adapter the reply arrived on
    raw_blocks: list = field(default_factory=list)
    warnings: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


class DcpParseError(ValueError):
    pass


class ProviderUnavailable(RuntimeError):
    """The raw-Ethernet transport cannot be used on this machine/adapter. The
    message is operator-facing (what is missing and what to install)."""


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
def parse_identify_response(frame: bytes, *, expected_xid: Optional[int] = None,
                            expected_dst: Optional[bytes] = None) -> DcpDevice:
    """Parse one Identify response Ethernet frame. Raises DcpParseError on
    anything that is not a well-formed DCP Identify response addressed to us."""
    b = bytes(frame)
    if len(b) < 14 + 2 + 10:
        raise DcpParseError(f"frame too short ({len(b)} bytes)")
    if expected_dst is not None and b[0:6] not in (expected_dst, BROADCAST):
        raise DcpParseError("destination MAC is not ours — not a reply to our request")
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
    if pos != len(body):
        raise DcpParseError(f"DCP body has {len(body) - pos} trailing byte(s)")
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
        if dev.ip == "0.0.0.0":
            dev.ip = ""
            dev.warnings.append("device has no IP address configured (DCP-only reachable)")
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


# ── transport providers ──────────────────────────────────────────────────────
def _mac_bytes(mac: str) -> bytes:
    text = (mac or "").replace("-", ":").replace(".", "").strip()
    parts = text.split(":") if ":" in text else [text[i:i + 2] for i in range(0, len(text), 2)]
    if len(parts) != 6:
        raise ValueError(f"adapter MAC {mac!r} is not a 6-byte address")
    return bytes(int(p, 16) for p in parts)


def _adapter_fields(adapter) -> dict:
    """Accept net_adapters.Adapter, a dict, or a bare name."""
    if isinstance(adapter, str):
        return {"name": adapter, "ip": "", "mac": "", "description": ""}
    if isinstance(adapter, dict):
        src = adapter
    else:
        src = {k: getattr(adapter, k, "") for k in ("name", "ip", "mac", "description")}
    return {"name": str(src.get("name") or ""), "ip": str(src.get("ip") or ""),
            "mac": str(src.get("mac") or ""), "description": str(src.get("description") or "")}


class EthernetLink:
    """One opened adapter: raw frames in and out. Close it."""
    src_mac: bytes = bytes(6)
    device: str = ""

    def send(self, frame: bytes) -> None:
        raise NotImplementedError

    def recv(self, timeout_s: float) -> Optional[bytes]:
        raise NotImplementedError

    def close(self) -> None:
        pass


class EthernetProvider:
    name = "abstract"

    def availability(self) -> tuple[bool, str]:
        """(usable, reason/hint). Never raises."""
        return False, "no raw-Ethernet provider"

    def open(self, adapter) -> EthernetLink:
        """Bind to exactly this adapter. Raises ProviderUnavailable."""
        raise ProviderUnavailable(self.availability()[1])


class AfPacketProvider(EthernetProvider):
    """Linux AF_PACKET (root or CAP_NET_RAW)."""
    name = "af_packet"

    def availability(self) -> tuple[bool, str]:
        if not hasattr(socket, "AF_PACKET"):
            return False, "raw Ethernet sockets (AF_PACKET) are not available on this platform"
        if hasattr(os, "geteuid") and os.geteuid() != 0:
            return False, "raw Ethernet sockets need root or CAP_NET_RAW"
        return True, "AF_PACKET available"

    def open(self, adapter) -> EthernetLink:
        ok, why = self.availability()
        if not ok:
            raise ProviderUnavailable(why)
        a = _adapter_fields(adapter)

        class _Link(EthernetLink):
            def __init__(self, name):
                self.sock = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(ETHERTYPE_PN))
                try:
                    self.sock.bind((name, 0))
                except OSError as e:
                    self.sock.close()
                    raise ProviderUnavailable(f"cannot bind raw socket to {name!r}: {e}")
                self.src_mac = self.sock.getsockname()[4][:6]
                self.device = name

            def send(self, frame):
                self.sock.send(frame)

            def recv(self, timeout_s):
                self.sock.settimeout(max(0.01, timeout_s))
                try:
                    return self.sock.recv(2048)
                except socket.timeout:
                    return None

            def close(self):
                self.sock.close()
        return _Link(a["name"])


# ── Windows: Npcap through ctypes (no Python package, no scapy) ──────────────
class _SockAddr(ctypes.Structure):
    _fields_ = [("sa_family", ctypes.c_ushort), ("sa_data", ctypes.c_ubyte * 14)]


class _PcapAddr(ctypes.Structure):
    pass


_PcapAddr._fields_ = [("next", ctypes.POINTER(_PcapAddr)), ("addr", ctypes.POINTER(_SockAddr)),
                      ("netmask", ctypes.POINTER(_SockAddr)), ("broadaddr", ctypes.POINTER(_SockAddr)),
                      ("dstaddr", ctypes.POINTER(_SockAddr))]


class _PcapIf(ctypes.Structure):
    pass


_PcapIf._fields_ = [("next", ctypes.POINTER(_PcapIf)), ("name", ctypes.c_char_p),
                    ("description", ctypes.c_char_p), ("addresses", ctypes.POINTER(_PcapAddr)),
                    ("flags", ctypes.c_uint)]


class _PcapPktHdr(ctypes.Structure):
    _fields_ = [("tv_sec", ctypes.c_long), ("tv_usec", ctypes.c_long),
                ("caplen", ctypes.c_uint), ("len", ctypes.c_uint)]


class _BpfProgram(ctypes.Structure):
    _fields_ = [("bf_len", ctypes.c_uint), ("bf_insns", ctypes.c_void_p)]


_PCAP_ERRBUF_SIZE = 256


def _load_wpcap():
    """Load Npcap's wpcap.dll. Raises ProviderUnavailable with the install hint."""
    if not sys.platform.startswith("win"):
        raise ProviderUnavailable("Npcap provider is Windows-only")
    npcap_dir = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "Npcap")
    if os.path.isdir(npcap_dir) and hasattr(os, "add_dll_directory"):
        try:
            _DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(npcap_dir))
        except OSError:
            pass
    try:
        dll_path = os.path.join(npcap_dir, "wpcap.dll")
        lib = ctypes.CDLL(dll_path if os.path.isfile(dll_path) else "wpcap.dll")
    except OSError as e:
        raise ProviderUnavailable(f"Npcap runtime not found (wpcap.dll: {e}). {NPCAP_HINT}")
    c_void_p, c_int, c_char_p, c_uint = ctypes.c_void_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint
    lib.pcap_findalldevs.argtypes = [ctypes.POINTER(ctypes.POINTER(_PcapIf)), c_char_p]
    lib.pcap_findalldevs.restype = c_int
    lib.pcap_freealldevs.argtypes = [ctypes.POINTER(_PcapIf)]
    lib.pcap_freealldevs.restype = None
    lib.pcap_open_live.argtypes = [c_char_p, c_int, c_int, c_int, c_char_p]
    lib.pcap_open_live.restype = c_void_p
    lib.pcap_close.argtypes = [c_void_p]
    lib.pcap_close.restype = None
    lib.pcap_compile.argtypes = [c_void_p, ctypes.POINTER(_BpfProgram), c_char_p, c_int, c_uint]
    lib.pcap_compile.restype = c_int
    lib.pcap_setfilter.argtypes = [c_void_p, ctypes.POINTER(_BpfProgram)]
    lib.pcap_setfilter.restype = c_int
    lib.pcap_freecode.argtypes = [ctypes.POINTER(_BpfProgram)]
    lib.pcap_freecode.restype = None
    lib.pcap_sendpacket.argtypes = [c_void_p, c_char_p, c_int]
    lib.pcap_sendpacket.restype = c_int
    lib.pcap_next_ex.argtypes = [c_void_p, ctypes.POINTER(ctypes.POINTER(_PcapPktHdr)),
                                 ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte))]
    lib.pcap_next_ex.restype = c_int
    lib.pcap_geterr.argtypes = [c_void_p]
    lib.pcap_geterr.restype = c_char_p
    if hasattr(lib, "pcap_setmintocopy"):
        lib.pcap_setmintocopy.argtypes = [c_void_p, c_int]
        lib.pcap_setmintocopy.restype = c_int
    return lib


def npcap_devices(lib=None) -> list[dict]:
    """Every capture device Npcap knows: name (\\Device\\NPF_{GUID}), description,
    IPv4 addresses. Used to map the operator's adapter onto a capture device."""
    lib = lib or _load_wpcap()
    errbuf = ctypes.create_string_buffer(_PCAP_ERRBUF_SIZE)
    head = ctypes.POINTER(_PcapIf)()
    if lib.pcap_findalldevs(ctypes.byref(head), errbuf) != 0:
        raise ProviderUnavailable(f"pcap_findalldevs failed: {errbuf.value.decode(errors='replace')}")
    out = []
    try:
        node = head
        while node:
            d = node.contents
            ips = []
            addr = d.addresses
            while addr:
                a = addr.contents
                if a.addr and a.addr.contents.sa_family == socket.AF_INET:
                    ips.append(".".join(str(x) for x in bytes(a.addr.contents.sa_data)[2:6]))
                addr = a.next
            out.append({"name": (d.name or b"").decode(errors="replace"),
                        "description": (d.description or b"").decode(errors="replace"),
                        "ips": ips})
            node = d.next
    finally:
        lib.pcap_freealldevs(head)
    return out


def match_npcap_device(devices: list[dict], adapter: dict) -> Optional[dict]:
    """Pick the capture device for the SELECTED adapter: by IPv4 address first
    (unambiguous), then by exact description. Never 'the first one'."""
    ip = adapter.get("ip") or ""
    if ip:
        for d in devices:
            if ip in d.get("ips", []):
                return d
    desc = (adapter.get("description") or "").strip().lower()
    if desc:
        for d in devices:
            if d.get("description", "").strip().lower() == desc:
                return d
    return None


class NpcapProvider(EthernetProvider):
    """Windows raw Ethernet through the Npcap runtime (wpcap.dll via ctypes)."""
    name = "npcap"

    def __init__(self):
        self._lib = None

    def _lib_or_raise(self):
        if self._lib is None:
            self._lib = _load_wpcap()
        return self._lib

    def availability(self) -> tuple[bool, str]:
        try:
            self._lib_or_raise()
            return True, "Npcap runtime available"
        except ProviderUnavailable as e:
            return False, str(e)

    def open(self, adapter) -> EthernetLink:
        lib = self._lib_or_raise()
        a = _adapter_fields(adapter)
        if not a["mac"]:
            raise ProviderUnavailable(
                f"adapter {a['name']!r} has no MAC address in the adapter list — DCP needs the "
                "adapter's MAC as the frame source; select the adapter from the list (not a typed CIDR)")
        src_mac = _mac_bytes(a["mac"])
        dev = match_npcap_device(npcap_devices(lib), a)
        if dev is None:
            raise ProviderUnavailable(
                f"adapter {a['name']!r} ({a['ip'] or 'no IP'}) is not visible to Npcap — "
                "if it was just plugged in, re-run; virtual/VPN adapters are not supported")
        errbuf = ctypes.create_string_buffer(_PCAP_ERRBUF_SIZE)
        handle = lib.pcap_open_live(dev["name"].encode(), 2048, 0, 100, errbuf)
        if not handle:
            msg = errbuf.value.decode(errors="replace")
            hint = " — Npcap was installed with 'Administrators only'; run AquaFlow as Administrator" \
                if "denied" in msg.lower() or "access" in msg.lower() else ""
            raise ProviderUnavailable(f"cannot open {dev['description'] or dev['name']}: {msg}{hint}")
        prog = _BpfProgram()
        if lib.pcap_compile(handle, ctypes.byref(prog), b"ether proto 0x8892", 1, 0xFFFFFFFF) != 0:
            msg = (lib.pcap_geterr(handle) or b"").decode(errors="replace")
            lib.pcap_close(handle)
            raise ProviderUnavailable(f"cannot compile the PROFINET-only capture filter: {msg}")
        try:
            if lib.pcap_setfilter(handle, ctypes.byref(prog)) != 0:
                msg = (lib.pcap_geterr(handle) or b"").decode(errors="replace")
                lib.pcap_close(handle)
                raise ProviderUnavailable(f"cannot apply the PROFINET-only capture filter: {msg}")
        finally:
            lib.pcap_freecode(ctypes.byref(prog))
        if hasattr(lib, "pcap_setmintocopy"):
            lib.pcap_setmintocopy(handle, 0)                     # deliver replies immediately

        class _Link(EthernetLink):
            def __init__(self):
                self.src_mac = src_mac
                self.device = dev["name"]
                self.description = dev["description"]
                self._closed = False

            def send(self, frame):
                if lib.pcap_sendpacket(handle, frame, len(frame)) != 0:
                    err = (lib.pcap_geterr(handle) or b"").decode(errors="replace")
                    raise OSError(f"pcap_sendpacket failed: {err}")

            def recv(self, timeout_s):
                deadline = time.monotonic() + max(0.0, timeout_s)
                hdr = ctypes.POINTER(_PcapPktHdr)()
                data = ctypes.POINTER(ctypes.c_ubyte)()
                while True:
                    rc = lib.pcap_next_ex(handle, ctypes.byref(hdr), ctypes.byref(data))
                    if rc == 1:
                        return ctypes.string_at(data, hdr.contents.caplen)
                    if rc < 0:
                        err = (lib.pcap_geterr(handle) or b"").decode(errors="replace")
                        raise OSError(f"pcap_next_ex failed ({rc}): {err}")
                    if time.monotonic() >= deadline:      # rc == 0: to_ms expired, nothing yet
                        return None

            def close(self):
                if not self._closed:
                    self._closed = True
                    lib.pcap_close(handle)
        return _Link()


class FakeEthernetProvider(EthernetProvider):
    """Bench/test provider. `replies` is a list of frames (or callables taking the
    sent request and returning a frame) delivered in order, one per recv; a
    float entry is a delay in seconds before the next frame. Records every
    frame the sender transmits and which adapter was opened."""
    name = "fake"

    def __init__(self, replies=None, src_mac: bytes = bytes.fromhex("047c16aabbcc"),
                 unavailable: Optional[str] = None):
        self.replies = list(replies or [])
        self.src_mac = src_mac
        self.unavailable = unavailable
        self.opened_with = None
        self.sent: list[bytes] = []
        self.closed = False

    def availability(self):
        return (False, self.unavailable) if self.unavailable else (True, "fake provider")

    def open(self, adapter):
        if self.unavailable:
            raise ProviderUnavailable(self.unavailable)
        self.opened_with = adapter
        prov = self

        class _Link(EthernetLink):
            src_mac = prov.src_mac
            device = "fake0"

            def send(self, frame):
                prov.sent.append(bytes(frame))

            def recv(self, timeout_s):
                while prov.replies:
                    item = prov.replies.pop(0)
                    if isinstance(item, (int, float)):
                        time.sleep(min(float(item), timeout_s))
                        continue
                    if callable(item):
                        item = item(prov.sent[-1] if prov.sent else b"")
                    return bytes(item)
                time.sleep(min(0.02, timeout_s))
                return None

            def close(self):
                prov.closed = True
        return _Link()


def default_provider() -> EthernetProvider:
    if sys.platform.startswith("win"):
        return NpcapProvider()
    return AfPacketProvider()


# ── the scan ─────────────────────────────────────────────────────────────────
@dataclass
class DcpScanResult:
    available: bool
    reason: str
    interface: str = ""
    provider: str = ""
    src_mac: str = ""
    devices: list = field(default_factory=list)      # DcpDevice
    rejected: list = field(default_factory=list)     # (mac, reason) for malformed replies
    duplicates: int = 0
    sent_hex: list = field(default_factory=list)     # every frame transmitted (evidence)
    cancelled: bool = False
    install_hint: str = ""
    elapsed_ms: float = 0.0

    def to_dict(self) -> dict:
        return {
            "available": self.available, "reason": self.reason, "interface": self.interface,
            "provider": self.provider, "src_mac": self.src_mac,
            "devices": [d.to_dict() for d in self.devices], "rejected": self.rejected,
            "duplicates": self.duplicates, "sent_hex": self.sent_hex,
            "cancelled": self.cancelled, "install_hint": self.install_hint,
            "elapsed_ms": round(self.elapsed_ms, 1),
        }


def raw_ethernet_available(provider: Optional[EthernetProvider] = None) -> tuple[bool, str]:
    return (provider or default_provider()).availability()


def dcp_identify_all(adapter, *, provider: Optional[EthernetProvider] = None,
                     listen_s: float = 1.5, should_stop: Optional[Callable[[], bool]] = None,
                     xid: Optional[int] = None) -> DcpScanResult:
    """Send ONE Identify-All on `adapter` and collect responses for `listen_s`.
    Blocking; run it in an executor. Only ever sends the Identify request.
    `should_stop()` (polled between receives) cancels early."""
    t0 = time.monotonic()
    a = _adapter_fields(adapter)
    provider = provider or default_provider()
    result = DcpScanResult(available=False, reason="", interface=a["name"], provider=provider.name)
    try:
        link = provider.open(adapter)
    except ProviderUnavailable as e:
        result.reason = str(e)
        if provider.name == "npcap":
            result.install_hint = NPCAP_HINT
        result.elapsed_ms = (time.monotonic() - t0) * 1000.0
        return result
    result.available = True
    result.reason = "identify-all sent"
    result.src_mac = ":".join(f"{x:02x}" for x in link.src_mac)
    xid = (xid if xid is not None else (int(time.time() * 1000) & 0x7FFFFFFF) | 0x01000000)
    seen: set[str] = set()
    try:
        request = build_identify_all(link.src_mac, xid=xid)
        link.send(request)
        result.sent_hex.append(request.hex())
        deadline = time.monotonic() + listen_s
        while time.monotonic() < deadline:
            if should_stop is not None and should_stop():
                result.cancelled = True
                result.reason = "cancelled"
                break
            frame = link.recv(min(0.2, max(0.01, deadline - time.monotonic())))
            if frame is None:
                continue
            try:
                dev = parse_identify_response(frame, expected_xid=xid, expected_dst=link.src_mac)
            except DcpParseError as e:
                mac = ":".join(f"{x:02x}" for x in frame[6:12]) if len(frame) >= 12 else "?"
                if "not Identify response" in str(e) and len(frame) >= 12 and frame[6:12] == link.src_mac:
                    continue                                   # our own request echoed back
                result.rejected.append((mac, str(e)))
                continue
            if dev.mac in seen:
                result.duplicates += 1
                continue
            seen.add(dev.mac)
            dev.adapter = a["name"]
            result.devices.append(dev)
    except OSError as e:
        result.available = False
        result.reason = f"raw Ethernet error: {e}"
    finally:
        try:
            link.close()
        except Exception:
            pass
    result.elapsed_ms = (time.monotonic() - t0) * 1000.0
    return result
