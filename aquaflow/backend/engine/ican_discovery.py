"""
I-CAN gateway automatic discovery.

Finds the NETCAN/I-CAN gateway on whatever network the computer is currently on,
so the software keeps working after the equipment is moved to a different site /
router / IP. Never depends on a fixed 192.168.5.2.

Algorithm (see module-level docstring in the connection manager for the full flow):
  1. Enumerate eligible IPv4 interfaces (skip loopback/VPN/virtual/inactive by default).
  2. For each, compute the local /prefix subnet.
  3. ARP-first: test hosts already in the neighbour table before a broader sweep.
  4. Unicast probe: ONE local UDP socket (prefer 2002), send the SAFE read-only
     probe to each candidate on gateway port 200, await a reply.
  5. Accept a candidate ONLY when the reply passes protocol-level validation
     (ican_protocol.validate_gateway_response) — never just because a port answered.
  6. Broadcast is an OPTIONAL fallback, tried only after unicast finds nothing.

READ-ONLY, always: the only frame this module ever transmits is
`ican_protocol.safe_probe_frame()` — the cmd 0x03 channel-address poll. The
output opcode 0x08 is not imported, not constructed and not sent from here.

Socket coordination (the part that used to be wrong):
  * The old prober opened a NEW socket per probed host, each bound to 2002 with
    SO_REUSEADDR. Sixteen sockets on one port meant a reply could land on any of
    them, and — worse — a bind "succeeded" while the fountain-control client (or
    the vendor software) owned 2002, silently stealing its datagrams. There is
    now ONE socket per discovery run, bound WITHOUT SO_REUSEADDR: if 2002 is busy
    the bind fails loudly, an ephemeral port is used and the report says so.
  * When AquaFlow's own fountain-control connection is active on 2002, discovery
    does not bind at all: it reuses that connection's read-only status (did the
    gateway answer the poll?) and reports "control owns the port". An active
    fountain-control link is never interrupted by a scan.

Everything network-touching is injectable (`prober`, `interface_provider`,
`arp_provider`, `control_status_provider`) so the whole module is unit-testable
against a fake gateway with no real interfaces involved.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import socket
import subprocess
import threading
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

# Connection states of the fountain-control manager under which it OWNS its
# local port (engine/ican_connection.ConnectionState values).
_CONTROL_ACTIVE_STATES = frozenset({"connected", "connecting", "reconnecting"})


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
    source: str = "probe"          # probe | control_status

    def to_dict(self) -> dict:
        return {
            "interface": self.interface, "ip": self.ip,
            "gateway_port": self.gateway_port, "local_port": self.local_port,
            "accepted": self.accepted, "reason": self.reason,
            "latency_ms": self.latency_ms, "signature": self.signature,
            "mac": self.mac, "confidence": self.confidence, "source": self.source,
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
    cancelled: bool = False
    deadline_hit: bool = False
    control_owns_port: bool = False
    probe_hex: str = ""

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
            "cancelled": self.cancelled, "deadline_hit": self.deadline_hit,
            "control_owns_port": self.control_owns_port,
            "probe_hex": self.probe_hex,
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


# ── the shared probe socket (ONE bind per discovery run) ─────────────────────
def open_probe_socket(local_port: int, bind_ip: str = "") -> tuple[socket.socket, bool]:
    """Bind the discovery socket WITHOUT SO_REUSEADDR. Returns (sock, fallback).
    A busy `local_port` (vendor software, or our own control client) is
    reported through `fallback=True` and an ephemeral port — never hidden."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    fallback = False
    try:
        sock.bind((bind_ip, local_port))
    except OSError as e:
        sock.bind((bind_ip, 0))
        fallback = True
        logger.warning("local port %s busy (%s); discovery using ephemeral %s",
                       local_port, getattr(e, "errno", e), sock.getsockname()[1])
    return sock, fallback


class SharedProber:
    """The default prober: ONE socket for the whole sweep, with a small receive
    thread that routes each datagram to the pending probe for its source IP.

    A thread rather than an asyncio datagram transport on purpose: on Windows a
    UDP socket reports a probed host's ICMP port-unreachable as a
    ConnectionResetError on the next recvfrom, and asyncio's proactor transport
    stops reading after that first error — so a sweep of a subnet where one host
    exists without a listener would go deaf. The thread just skips the error.

    First reply per host wins; duplicates and datagrams from hosts we did not
    probe are counted and ignored. Call signature matches the legacy per-host
    prober so tests can still inject a fake."""

    def __init__(self, local_port: int, bind_ip: str = ""):
        self.local_port_requested = local_port
        self.bind_ip = bind_ip
        self.fallback = False
        self.bound_port: Optional[int] = None
        self._sock: Optional[socket.socket] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._pending: dict[str, asyncio.Future] = {}
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.unrelated = 0
        self.duplicates = 0

    async def open(self):
        self._loop = asyncio.get_running_loop()
        self._sock, self.fallback = open_probe_socket(self.local_port_requested, self.bind_ip)
        self._sock.settimeout(0.1)
        self.bound_port = self._sock.getsockname()[1]
        self._thread = threading.Thread(target=self._rx_loop, name="ican-discovery-rx",
                                        daemon=True)
        self._thread.start()
        return self

    def _rx_loop(self):
        sock = self._sock
        while not self._stop.is_set():
            try:
                data, addr = sock.recvfrom(2048)
            except socket.timeout:
                continue
            except ConnectionResetError:
                continue                     # a probed host has no listener — not fatal
            except OSError:
                break                        # socket closed
            self._loop.call_soon_threadsafe(self._deliver, bytes(data), addr)

    def _deliver(self, data: bytes, addr):
        ip, port = addr[0], addr[1]
        fut = self._pending.get(ip)
        if fut is None:
            self.unrelated += 1              # nobody asked this host — ignore
            return
        if fut.done():
            self.duplicates += 1             # repeated reply from the same gateway
            return
        fut.set_result((data, port))

    def close(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=0.5)
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(OSError("probe socket closed"))

    @property
    def stats(self) -> dict:
        return {"unrelated_datagrams": self.unrelated, "duplicate_replies": self.duplicates}

    async def __call__(self, ip: str, gateway_port: int, local_port: int, timeout: float,
                       probe_frame: bytes):
        """(validated, reply_bytes, latency_ms, reason, used_fallback_port)"""
        if self._sock is None or self._loop is None:
            return (False, None, None, "socket error: probe socket not open", self.fallback)
        fut = self._loop.create_future()
        self._pending[ip] = fut
        t0 = time.monotonic()
        try:
            try:
                self._sock.sendto(probe_frame, (ip, gateway_port))
            except OSError as e:
                return (False, None, None, f"socket error: {e}", self.fallback)
            try:
                data, src_port = await asyncio.wait_for(fut, timeout)
            except asyncio.TimeoutError:
                return (False, None, None, "no reply (timeout)", self.fallback)
            except OSError as e:
                return (False, None, None, f"socket error: {e}", self.fallback)
            latency = (time.monotonic() - t0) * 1000.0
            v = proto.validate_gateway_response(data)
            if not v.valid:
                return (False, data, latency, v.reason, self.fallback)
            reason = "validated I-CAN reply"
            if src_port != gateway_port:
                reason += f" (from source port {src_port})"
            return (True, data, latency, reason, self.fallback)
        finally:
            self._pending.pop(ip, None)


# ── legacy per-host prober (kept for callers that import it; not the default) ─
async def _udp_probe(ip: str, gateway_port: int, local_port: int, timeout: float,
                     probe_frame: bytes) -> tuple[bool, Optional[bytes], Optional[float], str, bool]:
    """Send one safe probe to ip:gateway_port from a fresh socket, await a reply.

    Returns (validated, reply_bytes, latency_ms, reason, used_fallback_port).
    No SO_REUSEADDR: a busy `local_port` falls back to an ephemeral port and
    reports it (never silently, never by squatting on the control client's port)."""
    loop = asyncio.get_event_loop()

    def _do() -> tuple[bool, Optional[bytes], Optional[float], str, bool]:
        try:
            sock, fallback = open_probe_socket(local_port)
        except OSError as e:
            return (False, None, None, f"socket error: {e}", False)
        try:
            sock.settimeout(timeout)
            t0 = time.monotonic()
            sock.sendto(probe_frame, (ip, gateway_port))
            while True:
                try:
                    data, addr = sock.recvfrom(1024)
                except socket.timeout:
                    return (False, None, None, "no reply (timeout)", fallback)
                # source validation: reply must come FROM the probed gateway
                if addr[0] != ip:
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


def control_status_from_manager(manager) -> Optional[dict]:
    """Adapter: the fountain-control manager's status() dict, or None."""
    try:
        return manager.status() if manager is not None else None
    except Exception:
        return None


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
    cancel: Optional[asyncio.Event] = None,
    max_seconds: Optional[float] = None,
    bind_ip: str = "",
    control_status_provider: Optional[Callable[[], Optional[dict]]] = None,
) -> DiscoveryReport:
    """Discover the I-CAN gateway. All network operations are injectable for tests.

    `candidate_ips` overrides host enumeration (used by tests / manual retry).
    `prober` overrides the shared-socket prober (tests pass a fake). `probe_frame`
    defaults to the SAFE read-only probe. `cancel` / `max_seconds` bound the run;
    `control_status_provider` lets discovery defer to an active fountain-control
    connection instead of competing with it for the local port.
    """
    t_start = time.monotonic()
    probe_frame = probe_frame if probe_frame is not None else proto.safe_probe_frame()
    ifaces = interfaces if interfaces is not None else interface_provider(include_virtual)

    report = DiscoveryReport(gateway=None, interfaces=ifaces, local_port_used=local_port,
                             probe_hex=proto.hexdump(probe_frame))

    # ── an active fountain-control connection owns the port: do not compete ──
    status = control_status_provider() if control_status_provider else None
    if status and status.get("state") in _CONTROL_ACTIVE_STATES \
            and int(status.get("local_port") or 0) == int(local_port):
        report.control_owns_port = True
        gw_ip = status.get("gateway_ip")
        verified = bool(status.get("verified"))
        report.note = (f"fountain-control connection owns local port {local_port} — "
                       "discovery did not bind it; reporting that connection's read-only status")
        if gw_ip:
            cand = Candidate(
                interface="control-connection", ip=gw_ip,
                gateway_port=int(status.get("gateway_port") or gateway_port),
                local_port=int(local_port), accepted=verified,
                reason=("reported by the active control connection: gateway answered the "
                        "read-only 0x03 poll" if verified else
                        "active control connection is UNVERIFIED — the gateway has not "
                        "answered the read-only poll"),
                confidence="high" if verified else "none", source="control_status",
            )
            report.candidates = [cand]
            report.gateway = cand if verified else None
        report.elapsed_ms = (time.monotonic() - t_start) * 1000.0
        return report

    if not ifaces and candidate_ips is None:
        report.note = "no eligible network interface found"
        report.elapsed_ms = (time.monotonic() - t_start) * 1000.0
        return report

    # Build the ordered candidate list: ARP neighbours first, then the rest of each subnet.
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

    shared: Optional[SharedProber] = None
    if prober is None:
        try:
            shared = await SharedProber(local_port, bind_ip).open()
        except OSError as e:
            report.note = f"could not open the discovery socket: {e}"
            report.elapsed_ms = (time.monotonic() - t_start) * 1000.0
            return report
        prober = shared
        report.local_port_used = shared.bound_port
        report.local_port_fallback = shared.fallback

    sem = asyncio.Semaphore(max(1, concurrency))
    total = len(ordered)
    done = 0
    skipped = 0
    found: Optional[Candidate] = None
    lock = asyncio.Lock()
    deadline = (t_start + max_seconds) if max_seconds else None

    def _stopped() -> bool:
        if cancel is not None and cancel.is_set():
            report.cancelled = True
            return True
        if deadline is not None and time.monotonic() > deadline:
            report.deadline_hit = True
            return True
        return False

    async def probe_one(iface_name: str, ip: str, mac: Optional[str]):
        nonlocal done, found, skipped
        async with sem:
            if found is not None or _stopped():      # short-circuit once we have a gateway
                skipped += 1
                return None
            validated = False
            reply = latency = reason = None
            fallback = False
            for _ in range(max(1, retries)):
                validated, reply, latency, reason, fallback = await prober(
                    ip, gateway_port, local_port, timeout, probe_frame)
                if validated or _stopped():
                    break
            cand = Candidate(
                interface=iface_name, ip=ip, gateway_port=gateway_port,
                local_port=(report.local_port_used or local_port), accepted=validated,
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

    try:
        tasks = [asyncio.create_task(probe_one(n, ip, mac)) for n, ip, mac in ordered]
        results = await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        if shared is not None:
            shared.close()
    report.candidates = [c for c in results if isinstance(c, Candidate)]
    report.scanned = total
    report.gateway = found
    if found:
        logger.info("I-CAN gateway found at %s:%s via %s (%.1f ms)",
                    found.ip, found.gateway_port, found.interface, found.latency_ms or 0)
        report.note = f"gateway at {found.ip}"
    elif report.cancelled:
        report.note = f"discovery cancelled after {done} of {total} probe(s)"
    elif report.deadline_hit:
        report.note = f"discovery time budget exhausted after {done} of {total} probe(s)"
    else:
        report.note = "no I-CAN gateway responded to the unicast probe"
    if report.local_port_fallback:
        report.note += (f" — local port {local_port} was busy, probed from ephemeral port "
                        f"{report.local_port_used}; a gateway that only talks to {local_port} "
                        "may not have answered")
    report.elapsed_ms = (time.monotonic() - t_start) * 1000.0
    return report
