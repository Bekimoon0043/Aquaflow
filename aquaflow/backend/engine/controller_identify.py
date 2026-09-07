"""
engine/controller_identify.py — AF-CAT-001: auto-detection against the catalog.

"Plug in the cable and AquaFlow tells you what's there." A TCP sweep of the
catalog's detection ports across the SELECTED subnet, then a protocol-level
identification of every open port — so a web server on 502 never masquerades
as a PLC, and a real S7 says so by completing a real, fully validated handshake.

Every probe is READ-ONLY by construction:
  s7_handshake       — strict COTP CR/CC + S7 setup, then SZL identity (what any
                       HMI does on connect), then close   → engine/s7_identify
  profinet_dcp       — one DCP Identify-All multicast on the SELECTED adapter
                       (Linux AF_PACKET / Windows Npcap runtime via ctypes; fails
                       closed with an install hint when absent — never a
                       fallback sweep of other subnets)     → engine/profinet_dcp
  modbus_ident       — FC43/14 Read Device Identification, fully parsed; devices
                       without it are still valid 'generic Modbus' (the refusal
                       is itself proof a Modbus stack answered with a well-formed
                       exception)                            → engine/modbus_client
  enip_list_identity — EtherNet/IP ListIdentity (0x0063), strictly validated;
                       identifies Allen-Bradley class devices we can NAME but not
                       DRIVE (the result says so)            → engine/enip_identify
  ican_probe         — the existing safe probe in engine/ican_discovery (never
                       the 0x08 output opcode); only an ACCEPTED (protocol-valid)
                       candidate becomes a controller
  port_hint          — port-open only; reported with low confidence as
                       "port match only"

Nothing here writes a register, a coil, an output frame, or a tag. Discovery
that can actuate hardware is how the old I-CAN scan sprayed relay commands
across the subnet (fixed in AF-ICAN-005); this module keeps that lesson.

Result model (AF-DISC): every DetectedController carries a discovery id, the
adapter/subnet it was seen on, the EVIDENCE that justifies the claim, a
connection STAGE (host_seen → port_open → protocol_confirmed →
identity_confirmed → data_access_verified → configured → commissioned), the
honest drivability tier, and a prefill for the PLC panel. A freshly discovered
device is never "online", "healthy", "configured" or "commissioned" — those are
earned later, by verification and commissioning, not by answering a SYN.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Callable, Optional

from engine.controller_catalog import (
    ControllerEntry,
    all_entries,
    entries_for_tcp_port,
    get_entry,
)
from engine.net_adapters import (
    Adapter,
    ScanRangeError,
    ScanTarget,
    list_adapters,
    resolve_scan_targets,
)

logger = logging.getLogger("aquaflow.controllers")

CONNECT_TIMEOUT = 1.0
PROBE_TIMEOUT = 1.5
MAX_PARALLEL_HOSTS = 64
MAX_PARALLEL_CONNECTS = 256
DEFAULT_MAX_SECONDS = 120.0
DEFAULT_UNIT_IDS = (1,)
MAX_UNIT_IDS = 8

STAGES = ("host_seen", "port_open", "protocol_confirmed", "identity_confirmed",
          "data_access_verified", "configured", "commissioned")

# Catalog protocols the PLC panel can actually configure (REAL drivers only).
CONFIGURABLE_PROTOCOLS = {"siemens_s7": "siemens_s7", "modbus_tcp": "modbus_tcp"}


@dataclass
class DetectedController:
    ip: str
    port: int
    catalog_id: str
    label: str
    tier: str                     # REAL / GATED / UNSUPPORTED (drivability)
    drivable: bool
    confidence: str               # confirmed (protocol handshake) | probable | port_only
    identity: dict = field(default_factory=dict)   # vendor/product/etc. read from the device
    suggested_config: dict = field(default_factory=dict)
    configure_in: str = ""
    notes: str = ""
    # ── normalized evidence-based fields (AF-DISC) ─────────────────────────
    discovery_id: str = ""
    mac: str = ""
    protocol: str = ""
    vendor: str = ""
    product: str = ""
    model: str = ""
    revision: str = ""
    adapter: str = ""
    subnet: str = ""
    evidence: list = field(default_factory=list)
    stage: str = "port_open"
    drivability: str = ""
    warnings: list = field(default_factory=list)
    last_verified: float = 0.0
    status: str = "unverified"    # never "online"/"healthy" from discovery
    health: Optional[float] = None   # never assigned by discovery
    configurable: bool = False
    plc_prefill: dict = field(default_factory=dict)

    def __post_init__(self):
        if not self.discovery_id:
            self.discovery_id = uuid.uuid4().hex[:12]
        if not self.drivability:
            self.drivability = self.tier
        if not self.last_verified:
            self.last_verified = time.time()

    def to_dict(self) -> dict:
        d = asdict(self)
        d["confidence_label"] = confidence_label(self.confidence, self.stage)
        return d


def confidence_label(confidence: str, stage: str = "") -> str:
    if confidence == "port_only" or stage == "port_open":
        return "port match only (unverified service)"
    if stage == "identity_confirmed":
        return "identity confirmed"
    if stage == "data_access_verified":
        return "data access verified"
    if confidence == "confirmed":
        return "protocol confirmed"
    if confidence == "probable":
        return "probable"
    return "unverified"


def _from_entry(entry: ControllerEntry, ip: str, port: int, confidence: str,
                identity: Optional[dict] = None, *, stage: str = "port_open",
                evidence: Optional[list] = None) -> DetectedController:
    cfg = dict(entry.default_config)
    # Pre-fill the address we actually found it at.
    for key in ("ip", "gateway_ip"):
        if key in cfg:
            cfg[key] = ip
    det = DetectedController(
        ip=ip, port=port, catalog_id=entry.id,
        label=f"{entry.vendor} {entry.model}",
        tier=entry.tier, drivable=(entry.tier == "REAL"),
        confidence=confidence, identity=identity or {},
        suggested_config=cfg, configure_in=entry.configure_in, notes=entry.notes,
        protocol=entry.protocol, vendor=entry.vendor, model=entry.model,
        stage=stage, evidence=list(evidence or []),
    )
    if entry.protocol in CONFIGURABLE_PROTOCOLS and entry.tier == "REAL":
        det.configurable = True
        det.plc_prefill = {
            "plc_type": CONFIGURABLE_PROTOCOLS[entry.protocol], "ip": ip,
            "port": cfg.get("port", port), "rack": cfg.get("rack", 0),
            "slot": cfg.get("slot", 1), "unit_id": cfg.get("unit_id", 1),
            "vendor": entry.vendor, "model": entry.model, "catalog_id": entry.id,
            "name": f"{entry.vendor} @ {ip}",
        }
    return det


# ── per-protocol identifiers (each read-only, each self-contained) ────────────
async def _identify_s7(ip: str, port: int) -> Optional[DetectedController]:
    from engine.s7_identify import s7_identify
    r = await s7_identify(ip, port, connect_timeout=CONNECT_TIMEOUT, timeout=PROBE_TIMEOUT)
    if not r.s7_confirmed:
        logger.debug("S7 %s:%s not confirmed at %s: %s", ip, port, r.stage, r.reason)
        return None
    entry = get_entry("siemens-s7-1200")             # family entry; model unknown
    identity = {"handshake": "COTP + S7 setup acknowledged", "profile": r.profile,
                "pdu_size": r.pdu_size, **r.identity}
    det = _from_entry(entry, ip, port, "confirmed", identity,
                      stage="identity_confirmed" if r.stage == "identity_confirmed"
                      else "protocol_confirmed", evidence=r.evidence)
    det.label = "Siemens SIMATIC S7 family (S7comm)"
    det.warnings.extend(r.warnings)
    det.suggested_config["rack"], det.suggested_config["slot"] = r.rack, r.slot
    det.plc_prefill.update({"rack": r.rack, "slot": r.slot, "profile_hint": r.profile})
    if r.identity:
        order = r.identity.get("order_number", "")
        det.model = order or r.identity.get("module_name", "") or det.model
        det.product = r.identity.get("module_name", "") or r.identity.get("plc_name", "")
        det.revision = r.identity.get("firmware_version", "")
        if order:
            det.label = f"Siemens {r.identity.get('module_name') or 'S7 CPU'} ({order})"
            det.plc_prefill["model"] = order
    else:
        det.warnings.append("CPU model not claimed: a generic S7 handshake does not identify the CPU")
    return det


async def _identify_modbus(ip: str, port: int, unit_ids=DEFAULT_UNIT_IDS
                           ) -> Optional[DetectedController]:
    from engine.modbus_client import ModbusTCPClient, ModbusException, ModbusFrameError, ModbusError
    generic_seen: Optional[tuple[int, str]] = None
    for unit in list(unit_ids)[:MAX_UNIT_IDS]:
        client = ModbusTCPClient(ip, port, unit, connect_timeout=CONNECT_TIMEOUT,
                                 timeout=PROBE_TIMEOUT)
        try:
            if not await client.connect():
                return None
            try:
                ident = await client.read_device_identification_full()
            except ModbusException as e:
                # A well-formed exception IS a Modbus stack talking — generic entry.
                if generic_seen is None:
                    generic_seen = (unit, e.name)
                continue
            except ModbusFrameError as e:
                logger.debug("Modbus %s:%s unit %s: %s", ip, port, unit, e)
                continue                                # not Modbus framing at all
            except ModbusError:
                continue
            det = _modbus_from_ident(ip, port, unit, ident)
            return det
        finally:
            await client.close()
    if generic_seen is not None:
        unit, exc = generic_seen
        det = _from_entry(get_entry("modbus-generic"), ip, port, "confirmed",
                          {"ident": "device does not implement FC43", "exception": exc,
                           "unit_id": unit},
                          stage="protocol_confirmed",
                          evidence=[f"unit {unit}: well-formed Modbus exception {exc} to FC43/14"])
        det.warnings.append("generic Modbus server — vendor and model are NOT identified")
        det.plc_prefill["unit_id"] = unit
        det.suggested_config["unit_id"] = unit
        return det
    return None


def _modbus_from_ident(ip: str, port: int, unit: int, ident: dict) -> DetectedController:
    vendor = (ident.get("vendor") or "").lower()
    entry_id = "modbus-generic"
    if "advantech" in vendor:
        entry_id = "advantech-adam-6000"
    elif "moxa" in vendor:
        entry_id = "moxa-iologik-e1200"
    elif "schneider" in vendor:
        entry_id = "schneider-modicon"
    elif "wago" in vendor:
        entry_id = "wago-750"
    elif "delta" in vendor:
        entry_id = "delta-dvp"
    evidence = [f"unit {unit}: FC43/14 identification, conformity {ident.get('conformity_name')}, "
                f"{len(ident.get('objects', {}))} object(s) in {ident.get('frames')} frame(s)"]
    flat = {k: v for k, v in ident.items() if k not in ("objects", "object_lengths")}
    flat["unit_id"] = unit
    det = _from_entry(get_entry(entry_id), ip, port, "confirmed", flat,
                      stage="identity_confirmed", evidence=evidence)
    if ident.get("vendor"):
        det.vendor = ident["vendor"]
        det.product = ident.get("product", "")
        det.model = ident.get("product", "") or det.model
        det.revision = ident.get("revision", "")
        det.label = f"{ident['vendor']} {ident.get('product', '')} (Modbus TCP)".strip()
        det.plc_prefill.update({"vendor": ident["vendor"], "model": ident.get("product", "")})
    det.plc_prefill["unit_id"] = unit
    det.suggested_config["unit_id"] = unit
    return det


async def _identify_enip(ip: str, port: int) -> Optional[DetectedController]:
    """EtherNet/IP ListIdentity over TCP — standard, read-only, strictly parsed."""
    from engine.enip_identify import list_identity
    identity, reason, raw = await list_identity(ip, port, connect_timeout=CONNECT_TIMEOUT,
                                                timeout=PROBE_TIMEOUT)
    if identity is None:
        logger.debug("ENIP %s:%s rejected: %s", ip, port, reason)
        return None
    det = _from_entry(get_entry("allen-bradley-logix"), ip, port, "confirmed",
                      identity.to_dict(), stage="identity_confirmed",
                      evidence=[f"ListIdentity: {reason}; vendor {identity.vendor}, "
                                f"{identity.device_type_name}, product code {identity.product_code}"])
    det.vendor = identity.vendor
    det.product = identity.product_name
    det.model = identity.product_name or det.model
    det.revision = identity.revision
    det.label = f"{identity.product_name or identity.vendor} (EtherNet/IP — identify-only)"
    det.warnings.extend(identity.warnings)
    det.warnings.append("identify-only: AquaFlow has no EtherNet/IP control driver")
    return det


async def identify_service(ip: str, port: int, well_known_port: int, *,
                           unit_ids=DEFAULT_UNIT_IDS) -> list[DetectedController]:
    """Identify one open TCP port. `well_known_port` selects the probe (tests
    run fake servers on ephemeral ports)."""
    if well_known_port == 102:
        det = await _identify_s7(ip, port)
        return [det] if det else []
    if well_known_port == 502:
        det = await _identify_modbus(ip, port, unit_ids)
        return [det] if det else []
    if well_known_port == 44818:
        det = await _identify_enip(ip, port)
        return [det] if det else []
    # port_hint entries: open port is all the evidence there is — low confidence.
    out = []
    for e in entries_for_tcp_port(well_known_port):
        if e.detect_method == "port_hint":
            det = _from_entry(e, ip, port, "port_only", stage="port_open",
                              evidence=[f"TCP {well_known_port} open — no protocol exchange performed"])
            det.warnings.append("port match only: an open port does not identify the device")
            det.configurable = False
            det.plc_prefill = {}
            out.append(det)
    return out


# ── I-CAN aggregation (read-only; only ACCEPTED candidates become controllers) ─
def ican_controllers_from_report(report, *, adapter: str = "", subnet: str = ""
                                 ) -> tuple[list[DetectedController], dict]:
    """Fold an I-CAN discovery report into the controller list.

    Only a candidate with `accepted == True` — i.e. a reply that passed
    engine/ican_protocol.validate_gateway_response — becomes a detected
    controller. Timeouts, socket errors, malformed or unrelated datagrams stay
    in the diagnostics and never in the list. Repeated replies from the same
    gateway collapse to one controller.
    """
    entry = get_entry("ican-music-fountain")
    controllers: list[DetectedController] = []
    seen: set[str] = set()
    candidates = list(getattr(report, "candidates", []) or [])
    rejected: list[dict] = []
    for cand in candidates:
        c = cand.to_dict() if hasattr(cand, "to_dict") else dict(cand)
        ip = c.get("ip", "")
        if not ip:
            continue
        if not c.get("accepted"):
            rejected.append({"ip": ip, "reason": c.get("reason", ""), "interface": c.get("interface", "")})
            continue
        if ip in seen:
            continue                                    # duplicate reply, same gateway
        seen.add(ip)
        gateway_port = int(c.get("gateway_port") or entry.detect_udp_ports[0])
        identity = {k: v for k, v in c.items() if k != "ip"}
        evidence = [f"validated I-CAN reply ({c.get('reason', '')})"]
        if c.get("signature"):
            evidence.append(f"reply signature {c['signature']}")
        if c.get("latency_ms") is not None:
            evidence.append(f"latency {c['latency_ms']:.1f} ms")
        evidence.append(f"local port {c.get('local_port')} → gateway port {gateway_port}")
        if c.get("interface"):
            evidence.append(f"via {c['interface']}")
        det = _from_entry(entry, ip, gateway_port, "confirmed", identity,
                          stage="protocol_confirmed", evidence=evidence)
        det.mac = c.get("mac") or ""
        iface = c.get("interface") or ""
        det.adapter = adapter or (iface if iface not in ("manual", "control-connection") else "")
        det.subnet = subnet
        det.suggested_config["gateway_port"] = gateway_port
        if c.get("local_port"):
            det.suggested_config["local_port"] = int(c["local_port"])
        if c.get("source") == "control_status":
            det.evidence.append("reported by the active Fountain Control connection (read-only status)")
        det.configurable = False                       # configured in the Fountain Control panel
        det.plc_prefill = {}
        det.label = f"{entry.vendor} — NETCAN gateway (validated I-CAN reply)"
        controllers.append(det)
    diagnostics = {
        "found": bool(controllers),
        "scanned": getattr(report, "scanned", len(candidates)),
        "accepted": [d.ip for d in controllers],
        "rejected_count": len(rejected),
        "rejected_sample": rejected[:20],
        "note": getattr(report, "note", ""),
        "local_port_used": getattr(report, "local_port_used", None),
        "local_port_fallback": getattr(report, "local_port_fallback", False),
        "control_owns_port": getattr(report, "control_owns_port", False),
        "cancelled": getattr(report, "cancelled", False),
        "deadline_hit": getattr(report, "deadline_hit", False),
        "probe_hex": getattr(report, "probe_hex", ""),
        "elapsed_ms": getattr(report, "elapsed_ms", 0.0),
    }
    return controllers, diagnostics


def _default_control_status() -> Optional[dict]:
    """Read-only look at the Fountain Control connection manager's status, so a
    Controllers scan never competes with an active control link for port 2002.
    Reads a module attribute only — ican_routes itself is untouched."""
    try:
        from api.routes import ican_routes
        mgr = getattr(ican_routes, "_conn", None)
        return mgr.status() if mgr is not None else None
    except Exception:
        return None


# ── the sweep ─────────────────────────────────────────────────────────────────
def _local_subnets() -> list[str]:
    """Legacy helper: the /24 around every local address (kept for callers)."""
    return [a.subnet for a in list_adapters() if a.eligible]


async def _port_open(ip: str, port: int) -> bool:
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=CONNECT_TIMEOUT)
        writer.close()
        return True
    except Exception:
        return False


def _catalog_tcp_ports() -> list[int]:
    ports: set[int] = set()
    for e in all_entries():
        ports.update(e.detect_ports)
    return sorted(ports)


def _dedupe(detected: list[DetectedController]) -> list[DetectedController]:
    out: list[DetectedController] = []
    seen: set[tuple] = set()
    for d in detected:
        # DCP works below IP and can expose the duplicate-address fault we most
        # need commissioning to see. Preserve two PROFINET devices with the same
        # IP when their source MACs differ; normal TCP findings still dedupe by
        # endpoint + catalog identity.
        key = ((d.protocol, d.mac.lower())
               if d.protocol == "profinet_dcp" and d.mac
               else (d.ip, d.port, d.catalog_id))
        if key in seen:
            continue
        seen.add(key)
        out.append(d)
    return out


async def discover_controllers(
    subnet: Optional[str] = None, *,
    include_ican: bool = True,
    adapter: Optional[str] = None,
    include_virtual: bool = False,
    unit_ids=DEFAULT_UNIT_IDS,
    max_seconds: float = DEFAULT_MAX_SECONDS,
    cancel: Optional[asyncio.Event] = None,
    progress: Optional[Callable[[float, str], None]] = None,
    adapters_provider: Callable[[], list[Adapter]] = list_adapters,
    ican_discover: Optional[Callable] = None,
    control_status_provider: Optional[Callable[[], Optional[dict]]] = None,
    dcp_scanner: Optional[Callable] = None,
    arp_provider: Optional[Callable] = None,
    port_checker: Callable = _port_open,
    identifier: Callable = identify_service,
    ports: Optional[list[int]] = None,
) -> dict:
    """Sweep the selected subnet(s) for every catalog detection port, identify
    each hit, and fold in the I-CAN safe-probe discovery. Read-only throughout.

    Raises ScanRangeError for an unusable subnet/adapter selection — the caller
    turns that into a 400, never into a silent scan of something else.
    """
    started = time.monotonic()
    discovery_id = uuid.uuid4().hex[:12]
    adapters = adapters_provider()
    targets: list[ScanTarget] = resolve_scan_targets(
        adapters, adapter_name=adapter, cidr=subnet, include_virtual=include_virtual)
    ports = sorted(ports) if ports is not None else _catalog_tcp_ports()
    unit_ids = tuple(int(u) for u in (unit_ids or DEFAULT_UNIT_IDS))[:MAX_UNIT_IDS] or DEFAULT_UNIT_IDS
    detected: list[DetectedController] = []
    warnings: list[str] = []
    diagnostics: dict = {"discovery_id": discovery_id}
    hosts_scanned = 0
    cancelled = False
    deadline_hit = False
    deadline = started + max_seconds if max_seconds else None
    host_sem = asyncio.Semaphore(MAX_PARALLEL_HOSTS)
    conn_sem = asyncio.Semaphore(MAX_PARALLEL_CONNECTS)

    def report(frac: float, msg: str):
        if progress:
            try:
                progress(max(0.0, min(1.0, frac)), msg)
            except Exception:
                pass

    def stopped() -> bool:
        nonlocal cancelled, deadline_hit
        if cancel is not None and cancel.is_set():
            cancelled = True
            return True
        if deadline is not None and time.monotonic() > deadline:
            deadline_hit = True
            return True
        return False

    if not targets:
        return {
            "discovery_id": discovery_id, "detected": [], "hosts_scanned": 0,
            "subnets": [], "targets": [], "adapters": [a.to_dict() for a in adapters],
            "tcp_ports": ports, "duration_s": round(time.monotonic() - started, 2),
            "cancelled": False, "deadline_hit": False, "diagnostics": diagnostics,
            "warnings": ["no eligible network adapter — select an adapter or type a subnet"],
        }

    # ── PROFINET DCP (layer-2, per SELECTED adapter) — before the TCP sweep ──
    # Finds PLCs with no IP or a foreign IP. Bound to the adapter object (name,
    # IP, MAC) so the provider can never pick "the first NIC"; cancellable.
    dcp_devices: list[dict] = []
    dcp_seen: set[tuple] = set()
    if dcp_scanner is not False:
        from engine.profinet_dcp import dcp_identify_all
        scanner = dcp_scanner or dcp_identify_all
        adapter_objs = {a.name: a for a in adapters}
        dcp_diag = []
        for t in targets:
            if not t.adapter or t.adapter not in adapter_objs:
                continue
            adapter_obj = adapter_objs[t.adapter]
            try:
                loop = asyncio.get_running_loop()
                res = await loop.run_in_executor(
                    None, lambda a=adapter_obj: scanner(a, should_stop=stopped))
            except TypeError:
                loop = asyncio.get_running_loop()
                res = await loop.run_in_executor(None, lambda a=adapter_obj: scanner(a))
            except Exception as e:                       # pragma: no cover - defensive
                dcp_diag.append({"interface": t.adapter, "available": False, "reason": str(e)})
                continue
            d_res = res.to_dict() if hasattr(res, "to_dict") else dict(res)
            dcp_diag.append(d_res)
            for dev in getattr(res, "devices", []) or []:
                d = dev.to_dict() if hasattr(dev, "to_dict") else dict(dev)
                d.update({"_adapter": t.adapter, "_subnet": t.subnet})
                # A duplicate IP is valuable evidence of a configuration conflict;
                # never collapse two physical devices merely because their address
                # is the same. DCP identity is the source MAC on one adapter.
                key = (t.adapter, (d.get("mac") or "").lower())
                if key[1] and key not in dcp_seen:
                    dcp_seen.add(key)
                    dcp_devices.append(d)
        diagnostics["dcp"] = dcp_diag
        if dcp_diag and not any(x.get("available") for x in dcp_diag):
            warnings.append(f"PROFINET DCP unavailable: {dcp_diag[0].get('reason', 'unavailable')}")
        elif any(x.get("cancelled") for x in dcp_diag):
            warnings.append("PROFINET DCP listen was cancelled — layer-2 results are partial")

    # ── TCP sweep + identification ───────────────────────────────────────────
    hosts: list[tuple[str, ScanTarget]] = []
    for t in targets:
        for h in t.network.hosts():
            ip = str(h)
            if ip == t.adapter_ip:
                continue
            hosts.append((ip, t))
    total = len(hosts)
    done = 0
    lock = asyncio.Lock()

    async def check_port(ip: str, port: int) -> Optional[int]:
        async with conn_sem:
            if stopped():
                return None
            return port if await port_checker(ip, port) else None

    async def sweep_host(ip: str, target: ScanTarget):
        nonlocal hosts_scanned, done
        async with host_sem:
            if stopped():
                return
            hosts_scanned += 1
            opens = [p for p in await asyncio.gather(*(check_port(ip, p) for p in ports)) if p]
            for port in opens:
                if stopped():
                    break
                try:
                    found = await identifier(ip, port, port, unit_ids=unit_ids)
                except TypeError:
                    found = await identifier(ip, port, port)
                except Exception as e:  # pragma: no cover - defensive
                    logger.debug("identify %s:%s failed: %s", ip, port, e)
                    continue
                for det in found:
                    det.adapter = target.adapter or ""
                    det.subnet = target.subnet
                    detected.append(det)
            async with lock:
                done += 1
                if done % 8 == 0 or done == total:
                    report(0.1 + 0.8 * done / max(1, total), f"scanned {done}/{total} hosts on {target.subnet}")

    report(0.05, f"sweeping {total} host(s) on {', '.join(t.subnet for t in targets)}")
    if hosts:
        await asyncio.gather(*(sweep_host(ip, t) for ip, t in hosts))

    # ── merge DCP-discovered devices ─────────────────────────────────────────
    by_ip = {d.ip: d for d in detected}
    for d in dcp_devices:
        ip = d.get("ip") or ""
        evidence = [f"PROFINET DCP Identify on {d.get('_adapter')}: station '{d.get('station_name')}', "
                    f"vendor {d.get('vendor')}, device id 0x{(d.get('device_id') or 0):04X}, "
                    f"role {d.get('role') or '?'}, MAC {d.get('mac')}"
                    + (f", IP {ip}/{d.get('netmask')} gw {d.get('gateway')}" if ip else ", no IP configured")]
        existing = by_ip.get(ip) if ip else None
        if existing is not None and existing.protocol == "siemens_s7":
            existing.mac = existing.mac or d.get("mac", "")
            existing.identity.update({"station_name": d.get("station_name"), "dcp_vendor": d.get("vendor_name")})
            existing.evidence.extend(evidence)
            continue
        in_subnet = False
        if ip:
            try:
                addr = ipaddress.IPv4Address(ip)
                in_subnet = any(addr in t.network for t in targets)
            except ValueError:
                in_subnet = False
        is_siemens = d.get("vendor_id") == 0x002A
        if is_siemens and ip and not in_subnet:
            # One direct S7comm attempt at the DCP-reported address (a single host,
            # never a sweep of that foreign subnet). Only this validated handshake
            # may promote a Siemens PROFINET device to a drivable S7 PLC.
            if not stopped():
                try:
                    found = await identifier(ip, 102, 102, unit_ids=unit_ids)
                except TypeError:
                    found = await identifier(ip, 102, 102)
                except Exception:
                    found = []
                for f in found:
                    f.mac = f.mac or d.get("mac", "")
                    f.adapter, f.subnet = d.get("_adapter", ""), d.get("_subnet", "")
                    f.identity.update({"station_name": d.get("station_name"),
                                       "dcp_vendor": d.get("vendor_name")})
                    f.evidence.extend(evidence)
                    f.evidence.append("S7comm confirmed at the DCP-reported address (direct, routed)")
                    detected.append(f)
                if found:
                    continue

        # DCP proves that a PROFINET device exists and identifies its vendor. It
        # does not prove that a Siemens device is an S7 PLC: an ET 200 remote-I/O
        # station carries the same Siemens vendor id. Keep DCP-only results
        # identify-only until TCP/102 completes the strict S7comm handshake.
        station = d.get("station_name") or "unnamed"
        vendor = d.get("vendor") or "unknown vendor"
        warnings_for_device = [
            "PROFINET identity confirmed; no controller driver selected from DCP evidence alone"
        ]
        if is_siemens:
            warnings_for_device.append(
                "Siemens device detected, but S7comm on TCP 102 is not confirmed; "
                "it may be a PLC, remote I/O, or another PROFINET device")
        else:
            warnings_for_device.append(
                "PROFINET device discovered — no AquaFlow driver for this family")
        if not ip:
            warnings_for_device.append(
                "device has no IP address — assign one in TIA Portal before AquaFlow can connect")
        elif not in_subnet:
            warnings_for_device.append(
                f"IP {ip} is outside the selected subnet — no foreign subnet was scanned")
        det = DetectedController(
            ip=ip, port=0,
            catalog_id="siemens-profinet-device" if is_siemens else "profinet-device",
            label=f"{vendor} PROFINET device '{station}'",
            tier="UNSUPPORTED", drivable=False, confidence="confirmed", identity=d,
            protocol="profinet_dcp", vendor=vendor,
            product=d.get("vendor_name", ""), model=d.get("device_family", ""),
            stage="identity_confirmed", evidence=evidence,
            adapter=d.get("_adapter", ""), subnet=d.get("_subnet", ""),
            mac=d.get("mac", ""), warnings=warnings_for_device,
            configurable=False, plc_prefill={})
        detected.append(det)

    # ── I-CAN safe probe, limited to the selected adapter/subnet ─────────────
    if include_ican and not stopped():
        report(0.92, "probing for the I-CAN gateway (read-only 0x03 poll)")
        try:
            from engine import ican_discovery as disco
            run_disco = ican_discover or disco.discover
            status_provider = control_status_provider or _default_control_status
            ican_targets = targets
            all_ican: list[DetectedController] = []
            ican_diag: list[dict] = []
            for t in ican_targets:
                if stopped():
                    break
                ifaces = [disco.Interface(name=t.adapter or "manual", ip=t.adapter_ip or "0.0.0.0",
                                          prefix=t.network.prefixlen)]
                kwargs = dict(interfaces=ifaces, cancel=cancel,
                              max_seconds=max(1.0, (deadline - time.monotonic()) if deadline else 30.0),
                              control_status_provider=status_provider,
                              bind_ip=t.adapter_ip or "")
                if arp_provider is not None:
                    kwargs["arp_provider"] = arp_provider
                if t.adapter_ip is None:
                    # manual CIDR not on any adapter: enumerate the range explicitly
                    kwargs.pop("interfaces")
                    kwargs["candidate_ips"] = [str(h) for h in t.network.hosts()]
                    kwargs["bind_ip"] = ""
                rep = await run_disco(**kwargs)
                found, diag = ican_controllers_from_report(rep, adapter=t.adapter or "", subnet=t.subnet)
                diag["subnet"] = t.subnet
                ican_diag.append(diag)
                all_ican.extend(found)
                if diag.get("control_owns_port"):
                    warnings.append(f"I-CAN: {diag.get('note')}")
                elif diag.get("local_port_fallback"):
                    warnings.append("I-CAN: local port 2002 is busy (vendor software?) — probed from an "
                                    "ephemeral port; a gateway that only answers 2002 may be missed")
            detected.extend(all_ican)
            diagnostics["ican"] = ican_diag
        except Exception as e:  # pragma: no cover - env-dependent
            logger.debug("ican discovery skipped: %s", e)
            diagnostics["ican"] = [{"error": str(e)}]

    # ── MACs from the ARP table the sweep just populated ─────────────────────
    try:
        from engine.ican_discovery import arp_neighbours
        arp = arp_provider or arp_neighbours
        for t in targets:
            table = arp(t.network)
            for d in detected:
                if not d.mac and d.ip in table:
                    d.mac = table[d.ip]
    except Exception:
        pass

    detected = _dedupe(detected)
    for d in detected:
        d.status = "unverified"
        d.health = None
    if cancelled:
        warnings.append("discovery cancelled by operator — results are partial")
    if deadline_hit:
        warnings.append(f"discovery time budget of {max_seconds:.0f}s exhausted — results are partial")
    report(1.0, f"done: {len(detected)} controller(s)")
    return {
        "discovery_id": discovery_id,
        "detected": [d.to_dict() for d in detected],
        "hosts_scanned": hosts_scanned,
        "subnets": [t.subnet for t in targets],
        "targets": [t.to_dict() for t in targets],
        "adapters": [a.to_dict() for a in adapters],
        "tcp_ports": ports,
        "unit_ids": list(unit_ids),
        "duration_s": round(time.monotonic() - started, 2),
        "cancelled": cancelled,
        "deadline_hit": deadline_hit,
        "diagnostics": diagnostics,
        "warnings": warnings,
    }
