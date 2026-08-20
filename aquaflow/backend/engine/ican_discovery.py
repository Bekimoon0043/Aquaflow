"""
I-CAN gateway automatic discovery.

Finds the NETCAN/I-CAN gateway on whatever network the computer is currently on,
so the software keeps working after the equipment is moved to a different site /
router / IP. Never depends on a fixed 192.168.5.2.

Algorithm (see module-level docstring in the connection manager for the full flow):
  1. Enumerate eligible IPv4 interfaces (skip loopback/VPN/virtual/inactive by default).
  2. For each, compute the local /prefix subnet.
  3. ARP-first: test hosts already in the neighbour table before a broader sweep.
  4. Unicast probe: bind a local UDP socket (prefer 2002), send the SAFE read-only
     probe to each candidate on gateway port 200, await a reply.
  5. Accept a candidate ONLY when the reply passes protocol-level validation
     (ican_protocol.validate_gateway_response) — never just because a port answered.
  6. Broadcast is an OPTIONAL fallback, tried only after unicast finds nothing.

Everything network-touching is injectable (`prober`, `interface_provider`,
`arp_provider`) so the whole module is unit-testable against a fake gateway with
no real interfaces involved.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import socket
import subprocess
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from engine import ican_protocol as proto

logger = logging.getLogger("ican.discovery")

# Interface-name fragments we skip by default (VPN / virtual / container / loopback).
_VIRTUAL_HINTS = (
    "loopback", "vethernet", "vmware", "virtualbox", "vbox", "docker", "wsl",
    "hyper-v", "tap", "tun", "proton", "openvpn", "wireguard", "bluetooth",
    "npcap", "pseudo",
)


@dataclass
class Interface:
    name: str
    ip: str
    prefix: int = 24            # CIDR prefix; /24 assumed when a real mask is unavailable

    @property
    def network(self) -> ipaddress.IPv4Network:
        return ipaddress.IPv4Network(f"{self.ip}/{self.prefix}", strict=False)


@dataclass
class Candidate:
    """One probed host and the verdict, with everything the UI needs to explain it."""
    interface: str
    ip: str
    gateway_port: int
    local_port: int
    accepted: bool
    reason: str
    latency_ms: Optional[float] = None
    signature: Optional[str] = None
    mac: Optional[str] = None
    confidence: str = "none"       # none | low | high

    def to_dict(self) -> dict:
        return {
            "interface": self.interface, "ip": self.ip,
            "gateway_port": self.gateway_port, "local_port": self.local_port,
            "accepted": self.accepted, "reason": self.reason,
            "latency_ms": self.latency_ms, "signature": self.signature,
            "mac": self.mac, "confidence": self.confidence,
        }


@dataclass
class DiscoveryReport:
    gateway: Optional[Candidate]
    candidates: list[Candidate] = field(default_factory=list)
    interfaces: list[Interface] = field(default_factory=list)
    local_port_used: Optional[int] = None
    local_port_fallback: bool = False
    scanned: int = 0
    elapsed_ms: float = 0.0
    note: str = ""

    def to_dict(self) -> dict:
        return {
            "found": self.gateway is not None,
            "gateway": self.gateway.to_dict() if self.gateway else None,
            "candidates": [c.to_dict() for c in self.candidates],
            "interfaces": [{"name": i.name, "ip": i.ip, "prefix": i.prefix}
                           for i in self.interfaces],
            "local_port_used": self.local_port_used,
            "local_port_fallback": self.local_port_fallback,
            "scanned": self.scanned, "elapsed_ms": round(self.elapsed_ms, 1),
            "note": self.note,
        }


# ── interface + ARP enumeration (best-effort, dependency-free) ───────────────
def list_interfaces(include_virtual: bool = False) -> list[Interface]:
    """Every usable IPv4 interface. Uses the default-route trick plus hostname
    resolution; netmask defaults to /24 when the OS mask can't be read cheaply
    (logged as an assumption). `include_virtual` is the diagnostic escape hatch."""
    seen: dict[str, Interface] = {}

    def consider(ip: str, name: str, prefix: int = 24):
        if not ip or ip.startswith("127."):
            return
        if not include_virtual and ip.startswith("169.254."):
            return  # link-local (APIPA) — no DHCP; skip unless diagnostic
        if not include_virtual and any(h in name.lower() for h in _VIRTUAL_HINTS):
            return
        seen.setdefault(ip, Interface(name=name, ip=ip, prefix=prefix))

    # default-route address (the interface that reaches the outside world)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))          # no traffic sent — selects a route
        consider(s.getsockname()[0], "default-route")
        s.close()
    except OSError:
        pass

    # everything resolvable for this host
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            consider(info[4][0], "host")
    except OSError:
        pass

    return sorted(seen.values(), key=lambda i: i.ip)


def arp_neighbours(subnet: ipaddress.IPv4Network) -> dict[str, str]:
    """{ip: mac} from the OS ARP table, limited to `subnet`. Best-effort; empty on error."""
    out: dict[str, str] = {}
    try:
        raw = subprocess.check_output(
            ["arp", "-a"], encoding="utf-8", errors="ignore",
            stderr=subprocess.DEVNULL, timeout=6,
        )
    except Exception:
        return out
    for m in re.finditer(r"(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}(?:[-:][0-9a-fA-F]{2}){5})", raw):
        ip, mac = m.group(1), m.group(2).lower().replace("-", ":")
        try:
            if ipaddress.IPv4Address(ip) in subnet:
                out[ip] = mac
        except ValueError:
            continue
    return out


# ── the default real-network prober ──────────────────────────────────────────
async def _udp_probe(ip: str, gateway_port: int, local_port: int, timeout: float,
                     probe_frame: bytes) -> tuple[bool, Optional[bytes], Optional[float], str, bool]:
    """Send one safe probe to ip:gateway_port from local_port, await a reply.

    Returns (validated, reply_bytes, latency_ms, reason, used_fallback_port).
    Binding prefers `local_port`; on EADDRINUSE it falls back to an ephemeral port
    and reports it (never silently)."""
    loop = asyncio.get_event_loop()

    def _do() -> tuple[bool, Optional[bytes], Optional[float], str, bool]:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        fallback = False
        try:
            try:
                sock.bind(("", local_port))
            except OSError as e:
                # port busy (the vendor software may hold 2002) — fall back + report
                sock.bind(("", 0))
                fallback = True
                logger.warning("local port %s busy (%s); using ephemeral %s",
                               local_port, e.errno, sock.getsockname()[1])
            sock.settimeout(timeout)
            t0 = time.monotonic()
            sock.sendto(probe_frame, (ip, gateway_port))
            while True:
                try:
                    data, addr = sock.recvfrom(1024)
                except socket.timeout:
                    return (False, None, None, "no reply (timeout)", fallback)
                # source validation: reply must come FROM the probed gateway:port
                if addr[0] != ip or addr[1] != gateway_port:
                    continue  # unrelated datagram — keep waiting within the timeout
                latency = (time.monotonic() - t0) * 1000.0
                v = proto.validate_gateway_response(data)
                reason = v.reason if not v.valid else "validated I-CAN reply"
                return (v.valid, data, latency, reason, fallback)
        except OSError as e:
            return (False, None, None, f"socket error: {e}", fallback)
        finally:
            sock.close()

    return await loop.run_in_executor(None, _do)


# ── the discovery service ────────────────────────────────────────────────────
async def discover(
    *,
    interfaces: Optional[list[Interface]] = None,
    candidate_ips: Optional[list[str]] = None,
    gateway_port: int = proto.DEFAULT_GATEWAY_PORT,
    local_port: int = proto.DEFAULT_LOCAL_PORT,
    timeout: float = 0.4,
    concurrency: int = 16,
    retries: int = 1,
    arp_first: bool = True,
    include_virtual: bool = False,
    probe_frame: Optional[bytes] = None,
    prober: Optional[Callable] = None,
    interface_provider: Callable = list_interfaces,
    arp_provider: Callable = arp_neighbours,
    progress: Optional[Callable[[float, str], None]] = None,
) -> DiscoveryReport:
    """Discover the I-CAN gateway. All network operations are injectable for tests.

    `candidate_ips` overrides host enumeration (used by tests / manual retry).
    `prober` overrides `_udp_probe` (tests pass a fake). `probe_frame` defaults to
    the SAFE read-only probe.
    """
    t_start = time.monotonic()
    probe_frame = probe_frame if probe_frame is not None else proto.safe_probe_frame()
    prober = prober or _udp_probe
    ifaces = interfaces if interfaces is not None else interface_provider(include_virtual)

    report = DiscoveryReport(gateway=None, interfaces=ifaces, local_port_used=local_port)
    if not ifaces and candidate_ips is None:
        report.note = "no eligible network interface found"
        report.elapsed_ms = (time.monotonic() - t_start) * 1000.0
        return report

    # Build the ordered candidate list: ARP neighbours first, then the rest of each /24.
    ordered: list[tuple[str, str, Optional[str]]] = []  # (iface_name, ip, mac)
    seen_ips: set[str] = set()

    def add(iface_name: str, ip: str, mac: Optional[str]):
        if ip not in seen_ips:
            seen_ips.add(ip)
            ordered.append((iface_name, ip, mac))

    if candidate_ips is not None:
        for ip in candidate_ips:
            add("manual", ip, None)
    else:
        for iface in ifaces:
            net = iface.network
            macs = arp_provider(net) if arp_first else {}
            for ip in macs:                                  # ARP-first
                add(iface.name, ip, macs[ip])
            for host in net.hosts():                         # then the rest of the subnet
                ip = str(host)
                if ip != iface.ip:
                    add(iface.name, ip, macs.get(ip))

    sem = asyncio.Semaphore(max(1, concurrency))
    total = len(ordered)
    done = 0
    found: Optional[Candidate] = None
    lock = asyncio.Lock()

    async def probe_one(iface_name: str, ip: str, mac: Optional[str]):
        nonlocal done, found
        async with sem:
            if found is not None:            # short-circuit once we have a gateway
                return None
            validated = False
            latency = reason = None
            fallback = False
            for _ in range(max(1, retries)):
                validated, reply, latency, reason, fallback = await prober(
                    ip, gateway_port, local_port, timeout, probe_frame)
                if validated:
                    break
            cand = Candidate(
                interface=iface_name, ip=ip, gateway_port=gateway_port,
                local_port=local_port, accepted=validated,
                reason=reason or "no reply", latency_ms=latency, mac=mac,
                signature=(proto.hexdump(reply[:2]) if validated and reply else None),
                confidence="high" if validated else "none",
            )
            if fallback:
                report.local_port_fallback = True
            async with lock:
                done += 1
                if progress:
                    progress(done / max(1, total), f"probed {ip}")
                if validated and found is None:
                    found = cand
            return cand

    tasks = [asyncio.create_task(probe_one(n, ip, mac)) for n, ip, mac in ordered]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    report.candidates = [c for c in results if isinstance(c, Candidate)]
    report.scanned = total
    report.gateway = found
    if found:
        logger.info("I-CAN gateway found at %s:%s via %s (%.1f ms)",
                    found.ip, found.gateway_port, found.interface, found.latency_ms or 0)
        report.note = f"gateway at {found.ip}"
    else:
        report.note = "no I-CAN gateway responded to the unicast probe"
    report.elapsed_ms = (time.monotonic() - t_start) * 1000.0
    return report
