"""
engine/net_adapters.py — real IPv4 adapters with their real subnet masks.

Discovery used to assume "/24 around every address the hostname resolves to".
That guesses wrong on a /22 site network (misses three quarters of it), scans a
VPN tunnel as though it were the plant, and cannot tell the operator WHICH cable
a device was found behind. This module reads what the OS actually has:

  * adapter name + description
  * IPv4 address + prefix length (from the real netmask)
  * the calculated subnet
  * a kind: physical | virtual | vpn | loopback | link_local | unknown

Everything is dependency-free (no psutil) and the OS readers are injectable so
the parsing is unit-tested against captured `ipconfig /all` / `ip addr` text
without touching the machine's real interfaces.

Selection rules (used by controller discovery):
  * loopback and clear virtual/VPN adapters are EXCLUDED by default;
  * an operator can name one adapter explicitly;
  * an operator can type a CIDR explicitly — then ONLY that CIDR is scanned;
  * an unreasonable range (too many hosts, IPv6, /0) is refused, never clamped.
"""
from __future__ import annotations

import ipaddress
import platform
import re
import socket
import subprocess
from dataclasses import dataclass, asdict
from typing import Callable, Optional

# Name/description fragments that mark an adapter as not-the-plant-network.
VIRTUAL_HINTS = (
    "vethernet", "vmware", "virtualbox", "vbox", "docker", "wsl", "hyper-v",
    "hyperv", "npcap", "pseudo", "loopback", "virtual", "vmnet", "veth", "br-",
    "container",
)
VPN_HINTS = (
    "tap", "tun", "proton", "openvpn", "wireguard", "wg", "nordlynx", "zerotier",
    "tailscale", "hamachi", "vpn", "cisco anyconnect", "fortinet", "globalprotect",
    "utun", "ppp",
)
PHYSICAL_HINTS = ("ethernet", "wi-fi", "wifi", "wlan", "eth", "en0", "en1", "enp",
                  "eno", "ens", "realtek", "intel", "broadcom", "qualcomm", "killer",
                  "mediatek")

# Scan-size guard: a /22 (1022 hosts) is the largest range discovery will sweep.
# Bigger than that is a mistake (or a WAN), and it is refused rather than clamped
# so the operator sees the problem instead of a scan that silently covers 1/64th.
MAX_SCAN_HOSTS = 1024
MIN_PREFIX = 22


@dataclass
class Adapter:
    name: str
    ip: str
    prefix: int
    kind: str = "unknown"          # physical | virtual | vpn | loopback | link_local | unknown
    description: str = ""
    mac: str = ""

    @property
    def network(self) -> ipaddress.IPv4Network:
        return ipaddress.IPv4Network(f"{self.ip}/{self.prefix}", strict=False)

    @property
    def subnet(self) -> str:
        return str(self.network)

    @property
    def netmask(self) -> str:
        return str(self.network.netmask)

    @property
    def eligible(self) -> bool:
        """Scanned by default? Only physical/unknown adapters with a routable
        private-or-public address. Virtual, VPN, loopback and APIPA are opt-in."""
        return self.kind in ("physical", "unknown")

    def to_dict(self) -> dict:
        d = asdict(self)
        d.update({"subnet": self.subnet, "netmask": self.netmask,
                  "eligible": self.eligible,
                  "host_count": max(0, self.network.num_addresses - 2)})
        return d


def classify(name: str, description: str = "", ip: str = "") -> str:
    """Kind from the adapter's name/description and address. Loopback and
    link-local are decided by the ADDRESS (no naming convention needed); the
    rest is a name heuristic — so an unknown name stays 'unknown', which is
    still eligible (a plant NIC with a strange name must not vanish)."""
    if ip.startswith("127."):
        return "loopback"
    if ip.startswith("169.254."):
        return "link_local"
    text = f"{name} {description}".lower()
    if any(h in text for h in VPN_HINTS if len(h) > 3):
        return "vpn"
    # short VPN tokens only match as whole words (so "tap" ≠ "adapter")
    if re.search(r"\b(tap|tun|wg\d*|ppp\d*|utun\d*)\b", text):
        return "vpn"
    if any(h in text for h in VIRTUAL_HINTS):
        return "virtual"
    if any(h in text for h in PHYSICAL_HINTS):
        return "physical"
    return "unknown"


def _mask_to_prefix(mask: str) -> int:
    try:
        return ipaddress.IPv4Network(f"0.0.0.0/{mask}").prefixlen
    except ValueError:
        return 24


# ── OS readers (each returns raw text; parsing is separate + tested) ─────────
def _run(cmd: list[str]) -> str:
    flags = {"creationflags": 0x08000000} if hasattr(subprocess, "STARTUPINFO") else {}
    try:
        return subprocess.check_output(cmd, encoding="utf-8", errors="ignore",
                                       stderr=subprocess.DEVNULL, timeout=8, **flags)
    except Exception:
        return ""


def parse_ipconfig(text: str) -> list[Adapter]:
    """Parse `ipconfig /all` output (Windows). Adapters with no IPv4 address
    (disconnected media) are skipped — an adapter you cannot send on is not a
    subnet you can scan."""
    out: list[Adapter] = []
    current: Optional[dict] = None

    def flush():
        if current and current.get("ip"):
            out.append(Adapter(
                name=current["name"], ip=current["ip"],
                prefix=_mask_to_prefix(current.get("mask", "255.255.255.0")),
                description=current.get("desc", ""), mac=current.get("mac", ""),
                kind=classify(current["name"], current.get("desc", ""), current["ip"]),
            ))

    for line in text.splitlines():
        m = re.match(r"^(?P<hdr>[A-Za-z].*?adapter (?P<name>.+?)):\s*$", line)
        if m:
            flush()
            current = {"name": m.group("name").strip()}
            continue
        if current is None:
            continue
        stripped = line.strip()
        if stripped.startswith("Media State") and "disconnected" in stripped.lower():
            current["ip"] = ""
            continue
        m = re.match(r"^Description[ .]*: (.+)$", stripped)
        if m:
            current["desc"] = m.group(1).strip()
            continue
        m = re.match(r"^Physical Address[ .]*: (.+)$", stripped)
        if m:
            current["mac"] = m.group(1).strip().lower().replace("-", ":")
            continue
        m = re.match(r"^IPv4 Address[ .]*: (\d+\.\d+\.\d+\.\d+)", stripped)
        if m and not current.get("ip"):
            current["ip"] = m.group(1)
            continue
        m = re.match(r"^Subnet Mask[ .]*: (\d+\.\d+\.\d+\.\d+)", stripped)
        if m and "mask" not in current:
            current["mask"] = m.group(1)
            continue
    flush()
    return out


def parse_ip_addr(text: str) -> list[Adapter]:
    """Parse `ip -4 -o addr show` (Linux): one line per address."""
    out: list[Adapter] = []
    for line in text.splitlines():
        m = re.match(r"^\d+:\s+(?P<name>\S+)\s+inet\s+(?P<ip>\d+\.\d+\.\d+\.\d+)/(?P<pfx>\d+)",
                     line.strip())
        if not m:
            continue
        name, ip, pfx = m.group("name"), m.group("ip"), int(m.group("pfx"))
        out.append(Adapter(name=name, ip=ip, prefix=pfx, kind=classify(name, "", ip)))
    return out


def parse_ifconfig(text: str) -> list[Adapter]:
    """Parse BSD/macOS `ifconfig` output."""
    out: list[Adapter] = []
    name = ""
    for line in text.splitlines():
        m = re.match(r"^(?P<name>[a-z0-9]+):\s+flags=", line)
        if m:
            name = m.group("name")
            continue
        m = re.search(r"inet (\d+\.\d+\.\d+\.\d+) netmask (0x[0-9a-fA-F]{8}|\d+\.\d+\.\d+\.\d+)",
                      line)
        if m and name:
            mask = m.group(2)
            if mask.startswith("0x"):
                mask = str(ipaddress.IPv4Address(int(mask, 16)))
            out.append(Adapter(name=name, ip=m.group(1), prefix=_mask_to_prefix(mask),
                               kind=classify(name, "", m.group(1))))
    return out


def _fallback_adapters() -> list[Adapter]:
    """When no OS tool answered: hostname resolution + default-route trick, mask
    assumed /24 (and SAID so in the description)."""
    seen: dict[str, Adapter] = {}
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            seen.setdefault(ip, Adapter(name="host", ip=ip, prefix=24,
                                        kind=classify("host", "", ip),
                                        description="mask unknown — /24 assumed"))
    except OSError:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))                 # no packet is sent
        ip = s.getsockname()[0]
        s.close()
        seen.setdefault(ip, Adapter(name="default-route", ip=ip, prefix=24,
                                    kind=classify("default-route", "", ip),
                                    description="mask unknown — /24 assumed"))
    except OSError:
        pass
    return list(seen.values())


def list_adapters(runner: Callable[[list[str]], str] = _run,
                  system: Optional[str] = None) -> list[Adapter]:
    """Every IPv4 adapter the OS reports, with its real mask. Never raises."""
    system = (system or platform.system()).lower()
    adapters: list[Adapter] = []
    try:
        if system == "windows":
            adapters = parse_ipconfig(runner(["ipconfig", "/all"]))
        elif system == "linux":
            adapters = parse_ip_addr(runner(["ip", "-4", "-o", "addr", "show"]))
        else:
            adapters = parse_ifconfig(runner(["ifconfig"]))
    except Exception:
        adapters = []
    if not adapters:
        adapters = _fallback_adapters()
    # stable order: eligible first, then by address
    return sorted(adapters, key=lambda a: (not a.eligible, a.ip))


# ── scan-target selection ────────────────────────────────────────────────────
class ScanRangeError(ValueError):
    """The requested range is not something discovery will sweep."""


@dataclass
class ScanTarget:
    subnet: str                 # CIDR actually swept
    adapter: Optional[str]      # adapter name the subnet belongs to (None for manual)
    adapter_ip: Optional[str]
    source: str                 # "adapter" | "manual_cidr" | "auto"
    kind: str = "unknown"

    @property
    def network(self) -> ipaddress.IPv4Network:
        return ipaddress.IPv4Network(self.subnet, strict=False)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["host_count"] = max(0, self.network.num_addresses - 2)
        return d


def validate_cidr(cidr: str) -> ipaddress.IPv4Network:
    """Refuse anything discovery must not sweep: IPv6, /0../21, a single
    address written without a prefix is accepted as /32."""
    text = (cidr or "").strip()
    if not text:
        raise ScanRangeError("empty subnet")
    try:
        net = ipaddress.ip_network(text, strict=False)
    except ValueError as e:
        raise ScanRangeError(f"not a valid IPv4 CIDR: {cidr!r}") from e
    if not isinstance(net, ipaddress.IPv4Network):
        raise ScanRangeError("only IPv4 ranges are scanned")
    if net.prefixlen < MIN_PREFIX or net.num_addresses - 2 > MAX_SCAN_HOSTS:
        raise ScanRangeError(
            f"{net} is too large to sweep (max /{MIN_PREFIX} = {MAX_SCAN_HOSTS} hosts) — "
            "narrow it to the segment the controller cabinet is on")
    if net.is_multicast or net.is_reserved:
        raise ScanRangeError(f"{net} is not a host range")
    return net


def resolve_scan_targets(adapters: list[Adapter], *, adapter_name: Optional[str] = None,
                         cidr: Optional[str] = None, include_virtual: bool = False
                         ) -> list[ScanTarget]:
    """The subnets discovery will sweep, in priority order.

    * `cidr` given → exactly that range, nothing else (no "helpful" extra subnets).
      It is attributed to the adapter whose subnet contains it, when there is one,
      so I-CAN probing can stay on the right interface.
    * `adapter_name` given → that adapter's real subnet only. Unknown name → error.
    * neither → every eligible adapter's subnet (virtual/VPN only if asked).
    """
    if cidr:
        net = validate_cidr(cidr)
        owner = next((a for a in adapters if a.network.overlaps(net)), None)
        return [ScanTarget(subnet=str(net), adapter=owner.name if owner else None,
                           adapter_ip=owner.ip if owner else None, source="manual_cidr",
                           kind=owner.kind if owner else "unknown")]
    if adapter_name:
        a = next((x for x in adapters if x.name == adapter_name), None)
        if a is None:
            raise ScanRangeError(f"no adapter named {adapter_name!r}")
        validate_cidr(a.subnet)
        return [ScanTarget(subnet=a.subnet, adapter=a.name, adapter_ip=a.ip,
                           source="adapter", kind=a.kind)]
    targets: list[ScanTarget] = []
    seen: set[str] = set()
    for a in adapters:
        if not (a.eligible or (include_virtual and a.kind in ("virtual", "vpn"))):
            continue
        try:
            validate_cidr(a.subnet)
        except ScanRangeError:
            continue                       # a /16 corporate LAN is skipped, not swept
        if a.subnet in seen:
            continue
        seen.add(a.subnet)
        targets.append(ScanTarget(subnet=a.subnet, adapter=a.name, adapter_ip=a.ip,
                                  source="auto", kind=a.kind))
    return targets
