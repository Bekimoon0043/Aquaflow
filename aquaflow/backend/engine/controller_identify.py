"""
engine/controller_identify.py — AF-CAT-001: auto-detection against the catalog.

"Plug in the cable and AquaFlow tells you what's there." A TCP sweep of the
catalog's detection ports across the local /24 (or a requested subnet), then a
protocol-level identification of every open port — so a web server on 502 never
masquerades as a PLC, and a real S7 says so by completing a real handshake.

Every probe is READ-ONLY by construction:
  s7_handshake       — COTP CR + S7 setup (what any HMI does on connect), then close
  modbus_ident       — FC43/14 Read Device Identification; devices without it are
                       still valid 'generic Modbus' (the refusal is itself proof
                       a Modbus stack answered with a well-formed exception)
  enip_list_identity — EtherNet/IP ListIdentity (0x0063), the standard discovery
                       request; identifies Allen-Bradley class devices we can
                       NAME but not DRIVE (the result says so)
  ican_probe         — the existing safe probe in engine/ican_discovery (never
                       the 0x08 output opcode)
  port_hint          — port-open only; reported with low confidence

Nothing here writes a register, a coil, an output frame, or a tag. Discovery
that can actuate hardware is how the old I-CAN scan sprayed relay commands
across the subnet (fixed in AF-ICAN-005); this module keeps that lesson.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import struct
import time
from dataclasses import dataclass, field, asdict
from typing import Optional

from engine.controller_catalog import (
    ControllerEntry,
    all_entries,
    entries_for_tcp_port,
    get_entry,
)

logger = logging.getLogger("aquaflow.controllers")

CONNECT_TIMEOUT = 1.0
PROBE_TIMEOUT = 1.5
MAX_PARALLEL_HOSTS = 64


@dataclass
class DetectedController:
    ip: str
    port: int
    catalog_id: str
    label: str
    tier: str                     # REAL / GATED / UNSUPPORTED (drivability)
    drivable: bool
    confidence: str               # confirmed (protocol handshake) | probable (ident) | port_only
    identity: dict = field(default_factory=dict)   # vendor/product/etc. read from the device
    suggested_config: dict = field(default_factory=dict)
    configure_in: str = ""
    notes: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _from_entry(entry: ControllerEntry, ip: str, port: int, confidence: str,
                identity: Optional[dict] = None) -> DetectedController:
    cfg = dict(entry.default_config)
    # Pre-fill the address we actually found it at.
    for key in ("ip", "gateway_ip"):
        if key in cfg:
            cfg[key] = ip
    return DetectedController(
        ip=ip, port=port, catalog_id=entry.id,
        label=f"{entry.vendor} {entry.model}",
        tier=entry.tier, drivable=(entry.tier == "REAL"),
        confidence=confidence, identity=identity or {},
        suggested_config=cfg, configure_in=entry.configure_in, notes=entry.notes,
    )


# ── per-protocol identifiers (each read-only, each self-contained) ────────────
async def _identify_s7(ip: str, port: int) -> Optional[DetectedController]:
    from engine.s7_client import S7Client
    client = S7Client(ip, port, 0, 1, connect_timeout=CONNECT_TIMEOUT,
                      timeout=PROBE_TIMEOUT)
    try:
        if await client.connect():                 # full COTP + S7 setup = proof
            entry = get_entry("siemens-s7-1200")   # family entry; model unknown
            det = _from_entry(entry, ip, port, "confirmed",
                              {"handshake": "COTP + S7 setup acknowledged"})
            det.label = "Siemens SIMATIC S7 family (S7comm)"
            return det
    finally:
        await client.close()
    return None


async def _identify_modbus(ip: str, port: int) -> Optional[DetectedController]:
    from engine.modbus_client import ModbusTCPClient, ModbusException, ModbusError
    client = ModbusTCPClient(ip, port, connect_timeout=CONNECT_TIMEOUT,
                             timeout=PROBE_TIMEOUT)
    try:
        if not await client.connect():
            return None
        try:
            ident = await client.read_device_identification()
        except ModbusException:
            # A well-formed exception IS a Modbus stack talking — generic entry.
            return _from_entry(get_entry("modbus-generic"), ip, port, "confirmed",
                              {"ident": "device does not implement FC43"})
        except ModbusError:
            return None                            # not Modbus framing at all
        vendor = (ident.get("vendor") or "").lower()
        if "advantech" in vendor:
            return _from_entry(get_entry("advantech-adam-6000"), ip, port,
                              "confirmed", ident)
        if "moxa" in vendor:
            return _from_entry(get_entry("moxa-iologik-e1200"), ip, port,
                              "confirmed", ident)
        if "schneider" in vendor:
            return _from_entry(get_entry("schneider-modicon"), ip, port,
                              "confirmed", ident)
        det = _from_entry(get_entry("modbus-generic"), ip, port, "confirmed", ident)
        if ident.get("vendor"):
            det.label = f"{ident.get('vendor')} {ident.get('product', '')} (Modbus TCP)".strip()
        return det
    finally:
        await client.close()


async def _identify_enip(ip: str, port: int) -> Optional[DetectedController]:
    """EtherNet/IP ListIdentity over TCP — the standard, read-only discovery."""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=CONNECT_TIMEOUT)
    except Exception:
        return None
    try:
        # Encapsulation header: command 0x0063, everything else zero.
        writer.write(struct.pack("<HHIIQI", 0x0063, 0, 0, 0, 0, 0))
        await writer.drain()
        reply = await asyncio.wait_for(reader.read(512), timeout=PROBE_TIMEOUT)
        if len(reply) < 24 or struct.unpack("<H", reply[0:2])[0] != 0x0063:
            return None
        identity: dict = {"raw_len": len(reply)}
        # Best-effort product-name extraction (CPF identity item carries a
        # short-string product name near the end of the item).
        if len(reply) > 63:
            try:
                name_len = reply[62]
                name = reply[63:63 + name_len].decode("ascii", errors="replace")
                if name.strip():
                    identity["product"] = name
            except Exception:
                pass
        det = _from_entry(get_entry("allen-bradley-logix"), ip, port,
                          "confirmed", identity)
        if identity.get("product"):
            det.label = f"{identity['product']} (EtherNet/IP — identify-only)"
        return det
    except Exception:
        return None
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def identify_service(ip: str, port: int, well_known_port: int
                           ) -> list[DetectedController]:
    """Identify one open TCP port. `well_known_port` selects the probe (tests
    run fake servers on ephemeral ports)."""
    if well_known_port == 102:
        det = await _identify_s7(ip, port)
        return [det] if det else []
    if well_known_port == 502:
        det = await _identify_modbus(ip, port)
        return [det] if det else []
    if well_known_port == 44818:
        det = await _identify_enip(ip, port)
        return [det] if det else []
    # port_hint entries: open port is all the evidence there is — low confidence.
    return [_from_entry(e, ip, port, "port_only")
            for e in entries_for_tcp_port(well_known_port)
            if e.detect_method == "port_hint"]


# ── the sweep ─────────────────────────────────────────────────────────────────
def _local_subnets() -> list[str]:
    subnets = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                net = ipaddress.ip_network(f"{ip}/24", strict=False)
                if str(net) not in subnets:
                    subnets.append(str(net))
    except Exception:
        pass
    return subnets


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


async def discover_controllers(subnet: Optional[str] = None, *,
                               include_ican: bool = True) -> dict:
    """Sweep the subnet(s) for every catalog detection port, identify each hit,
    and fold in the I-CAN safe-probe discovery. Read-only throughout."""
    started = time.monotonic()
    subnets = [subnet] if subnet else _local_subnets()
    ports = _catalog_tcp_ports()
    detected: list[DetectedController] = []
    hosts_scanned = 0
    sem = asyncio.Semaphore(MAX_PARALLEL_HOSTS)

    async def sweep_host(ip: str):
        nonlocal hosts_scanned
        async with sem:
            hosts_scanned += 1
            for port in ports:
                if await _port_open(ip, port):
                    try:
                        detected.extend(await identify_service(ip, port, port))
                    except Exception as e:  # pragma: no cover - defensive
                        logger.debug("identify %s:%s failed: %s", ip, port, e)

    tasks = []
    for net in subnets:
        try:
            network = ipaddress.ip_network(net, strict=False)
        except ValueError:
            continue
        for host in network.hosts():
            tasks.append(asyncio.create_task(sweep_host(str(host))))
    if tasks:
        await asyncio.gather(*tasks)

    if include_ican:
        try:
            from engine.ican_discovery import discover as ican_discover
            report = await ican_discover()
            entry = get_entry("ican-music-fountain")
            for cand in getattr(report, "candidates", []) or []:
                c = cand.to_dict() if hasattr(cand, "to_dict") else dict(cand)
                ip = c.get("ip", "")
                if not ip:
                    continue
                det = _from_entry(entry, ip, entry.detect_udp_ports[0],
                                  "confirmed" if c.get("protocol_valid") else "probable",
                                  {k: v for k, v in c.items() if k != "ip"})
                detected.append(det)
        except Exception as e:  # pragma: no cover - env-dependent
            logger.debug("ican discovery skipped: %s", e)

    return {
        "detected": [d.to_dict() for d in detected],
        "hosts_scanned": hosts_scanned,
        "subnets": subnets,
        "tcp_ports": ports,
        "duration_s": round(time.monotonic() - started, 2),
    }
