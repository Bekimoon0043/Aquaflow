"""
engine/controller_catalog.py — AF-CAT-001: the fountain-controller catalog.

The operator's promise: plug in the Ethernet cable and AquaFlow tells you what is
on the wire; when it can't, you pick the controller from this catalog and get a
pre-filled configuration instead of a blank form.

Every entry is HONEST about three separate things, which people conflate:
  * detectable — can AquaFlow *identify* it on the network (and how)?
  * drivable   — can AquaFlow *command* it (tier REAL, via which driver)?
  * config     — what settings actually make it work (defaults + the traps)?

Tiers reuse the AF-HUB-014 / AF-IO-006 vocabulary and are asserted consistent
with PROTOCOL_SUPPORT / PLC_SUPPORT by test — the catalog can never advertise a
drivability the runtime doesn't have. A controller can be detectable but not
drivable (Allen-Bradley: we can read its identity, we cannot run a show on it) —
the UI must show that difference, not blur it.

The `ican-music-fountain` entry is special: its config is not from a datasheet,
it is the REVERSE-ENGINEERED profile of the running site cabinet (AF-ICAN-003..008,
packet captures of the vendor software). That knowledge lives HERE now, not only
in commit messages.

Research base (2026-09): fountain industry practice is PLC control (Siemens S7 /
Allen-Bradley Logix / Beckhoff CX) for pumps+valves, DMX/Art-Net for lighting and
show sync (OASE WECS III, Safe-Rain, Symphony), Modbus TCP remote I/O and VFDs,
plus Chinese music-fountain controllers (I-CAN class) on CAN behind Ethernet
gateways.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional

# The runtime truth these entries must agree with (asserted by test).
from engine.protocol_bus import PROTOCOL_SUPPORT
from plc.plc_engine import PLC_SUPPORT


@dataclass
class ControllerEntry:
    id: str                       # stable catalog key
    vendor: str
    model: str
    category: str                 # plc | fountain_controller | remote_io | show_transport | vfd
    protocol: str                 # AquaFlow driver name, or the identify-only protocol
    tier: str                     # REAL | GATED | UNSUPPORTED (drivability, honest)
    detect_method: str            # how discovery recognises it (see identify module)
    detect_ports: list = field(default_factory=list)       # TCP ports
    detect_udp_ports: list = field(default_factory=list)   # UDP ports (info/manual)
    default_config: dict = field(default_factory=dict)     # pre-fill for the connect form
    configure_in: str = ""        # which AquaFlow panel drives it once configured
    notes: str = ""
    source: str = ""              # where this knowledge comes from

    def to_dict(self) -> dict:
        return asdict(self)


CATALOG: list[ControllerEntry] = [
    # ── The running site cabinet — reverse-engineered, field knowledge ────────
    ControllerEntry(
        id="ican-music-fountain",
        vendor="I-CAN (音乐喷泉控制系统)",
        model="32-ch Music Fountain Control System + NETCAN Ethernet/CAN gateway",
        category="fountain_controller",
        protocol="ican",
        tier=PROTOCOL_SUPPORT.get("ican", "UNSUPPORTED"),
        detect_method="ican_probe",         # engine/ican_discovery safe probe
        detect_udp_ports=[200],
        default_config={
            "gateway_ip": "192.168.5.2",
            "gateway_port": 200,
            "local_port": 2002,            # the gateway replies HERE; binding it is mandatory
            "group": 0,                    # site capture: ~30 live channels, all group 0
            "channels": "1-32",            # 0x08 frame carries a 40-bit mask, 1-based
            "refresh_hz": 10,              # stream state like the vendor software (AF-ICAN-008)
        },
        configure_in="Fountain Control panel (I-CAN)",
        notes=(
            "Protocol facts that took a packet capture to learn: control is "
            "FIRE-AND-FORGET UDP — the gateway NEVER acknowledges 0x08 output "
            "frames, so nothing may gate on a reply. Group id is a BIG-ENDIAN "
            "uint32 at bytes[1..4]. The vendor software STREAMS full absolute "
            "state ~every 250 ms; a relay watchdog drops outputs when the stream "
            "stops — AquaFlow refreshes at 10 Hz while armed and streams OFF for "
            "blackout (silence is not an off-command). The local port must be "
            "genuinely free: binding 2002 while the vendor software owns it "
            "succeeds under SO_REUSEADDR and silently does nothing."
        ),
        source="Reverse-engineered from the running fountain (AF-ICAN-003..008, 2026-08/09)",
    ),

    # ── Siemens S7 family — the permanent-install path ────────────────────────
    ControllerEntry(
        id="siemens-s7-1200",
        vendor="Siemens",
        model="SIMATIC S7-1200 (e.g. CPU 1215C 6ES7215-1AG40-0XB0)",
        category="plc",
        protocol="siemens_s7",
        tier=PLC_SUPPORT.get("siemens_s7", "UNSUPPORTED"),
        detect_method="s7_handshake",
        detect_ports=[102],
        default_config={"ip": "192.168.5.10", "port": 102, "rack": 0, "slot": 1},
        configure_in="PLC panel / Field I/O",
        notes=(
            "The three settings that break everything: enable PUT/GET (off by "
            "default on FW 4.x), DBs must be NON-OPTIMIZED for absolute "
            "addressing, and the heartbeat must be a counter, not a constant. "
            "Full layout: docs/S7_DB_CONTRACT.md; program sources: docs/plc/."
        ),
        source="Siemens datasheet 6ES7215-1AG40-0XB0 + AF-IO series",
    ),
    ControllerEntry(
        id="siemens-s7-1500",
        vendor="Siemens",
        model="SIMATIC S7-1500",
        category="plc",
        protocol="siemens_s7",
        tier=PLC_SUPPORT.get("siemens_s7", "UNSUPPORTED"),
        detect_method="s7_handshake",
        detect_ports=[102],
        default_config={"ip": "", "port": 102, "rack": 0, "slot": 1},
        configure_in="PLC panel / Field I/O",
        notes="Same driver and DB rules as the S7-1200 (PUT/GET + non-optimized DBs).",
    ),
    ControllerEntry(
        id="siemens-s7-300-400",
        vendor="Siemens",
        model="SIMATIC S7-300 / S7-400 (legacy installs)",
        category="plc",
        protocol="siemens_s7",
        tier=PLC_SUPPORT.get("siemens_s7", "UNSUPPORTED"),
        detect_method="s7_handshake",
        detect_ports=[102],
        default_config={"ip": "", "port": 102, "rack": 0, "slot": 2},
        configure_in="PLC panel / Field I/O",
        notes="Classic fountain-plant PLCs. Slot 2 is the usual CPU slot on 300-series racks.",
    ),

    # ── Modbus TCP class — remote I/O, VFD gateways, many PLC families ────────
    ControllerEntry(
        id="modbus-generic",
        vendor="(any)",
        model="Generic Modbus TCP server",
        category="plc",
        protocol="modbus_tcp",
        tier=PLC_SUPPORT.get("modbus_tcp", "UNSUPPORTED"),
        detect_method="modbus_ident",       # FC43/14 device identification, read-only
        detect_ports=[502],
        default_config={"ip": "", "port": 502, "unit_id": 1},
        configure_in="PLC panel / Field I/O",
        notes="FC02/03/04/05/06 supported. Identification via FC43/14 when the device implements it.",
    ),
    ControllerEntry(
        id="advantech-adam-6000",
        vendor="Advantech",
        model="ADAM-6017 (8×AI 4-20mA/0-10V, 2×DO) / ADAM-6050 (12×DI, 6×DO)",
        category="remote_io",
        protocol="modbus_tcp",
        tier=PLC_SUPPORT.get("modbus_tcp", "UNSUPPORTED"),
        detect_method="modbus_ident",
        detect_ports=[502],
        default_config={
            "ip": "", "port": 502, "unit_id": 1,
            "ai_registers": "40001-40008 (FC03)",
            "signal_note": "prefer 4-20 mA: <3.5 mA reads FAULT (broken wire); 0-10 V cannot detect it",
        },
        configure_in="Field I/O panel",
        notes="The Option-B bench I/O class. Field points: FC03 AI, FC02 DI, FC05 DO.",
    ),
    ControllerEntry(
        id="moxa-iologik-e1200",
        vendor="Moxa",
        model="ioLogik E1240 (8×AI) / E1212 (8×DI+8×DIO)",
        category="remote_io",
        protocol="modbus_tcp",
        tier=PLC_SUPPORT.get("modbus_tcp", "UNSUPPORTED"),
        detect_method="modbus_ident",
        detect_ports=[502],
        default_config={"ip": "", "port": 502, "unit_id": 1,
                        "ai_registers": "input registers 30001+ (FC04)"},
        configure_in="Field I/O panel",
        notes="AI typically lives in INPUT registers (FC04) — use 3xxxx addresses in field points.",
    ),
    ControllerEntry(
        id="schneider-modicon",
        vendor="Schneider Electric",
        model="Modicon M221/M241/M251",
        category="plc",
        protocol="modbus_tcp",
        tier=PLC_SUPPORT.get("modbus_tcp", "UNSUPPORTED"),
        detect_method="modbus_ident",
        detect_ports=[502],
        default_config={"ip": "", "port": 502, "unit_id": 1},
        configure_in="PLC panel / Field I/O",
        notes="Native Modbus TCP; %MW addressing maps directly to holding registers.",
    ),
    ControllerEntry(
        id="delta-dvp",
        vendor="Delta",
        model="DVP / AS series (Ethernet models)",
        category="plc",
        protocol="modbus_tcp",
        tier=PLC_SUPPORT.get("modbus_tcp", "UNSUPPORTED"),
        detect_method="modbus_ident",
        detect_ports=[502],
        default_config={"ip": "", "port": 502, "unit_id": 1},
        configure_in="PLC panel / Field I/O",
        notes="Connect as modbus_tcp explicitly (AF-IO-006): the Delta-specific protocol is not implemented.",
    ),
    ControllerEntry(
        id="wago-750",
        vendor="WAGO",
        model="750-series fieldbus coupler (Modbus TCP)",
        category="remote_io",
        protocol="modbus_tcp",
        tier=PLC_SUPPORT.get("modbus_tcp", "UNSUPPORTED"),
        detect_method="modbus_ident",
        detect_ports=[502],
        default_config={"ip": "", "port": 502, "unit_id": 1},
        configure_in="Field I/O panel",
    ),

    # ── Show transports (fountain lighting / DMX-class rigs) ──────────────────
    ControllerEntry(
        id="artnet-node",
        vendor="(any)",
        model="Art-Net node / DMX gateway",
        category="show_transport",
        protocol="artnet",
        tier=PROTOCOL_SUPPORT.get("artnet", "UNSUPPORTED"),
        detect_method="artnet_poll",        # already implemented in NetworkScanner
        detect_udp_ports=[6454],
        default_config={"target_ip": "broadcast", "universe": 0},
        configure_in="Pattern Designer / DMX map",
        notes="Standard ArtPoll discovery. Fountain lighting rigs (incl. OASE/Safe-Rain DMX gear behind a gateway) attach here.",
    ),
    ControllerEntry(
        id="sacn-node",
        vendor="(any)",
        model="sACN (E1.31) receiver",
        category="show_transport",
        protocol="sacn",
        tier=PROTOCOL_SUPPORT.get("sacn", "UNSUPPORTED"),
        detect_method="port_hint",
        detect_udp_ports=[5568],
        default_config={"universe": 1},
        configure_in="Pattern Designer / DMX map",
    ),
    ControllerEntry(
        id="oase-wecs-iii",
        vendor="OASE",
        model="WECS III (64/512/1024/4096 DMX-RDM channels)",
        category="fountain_controller",
        protocol="dmx_only",
        tier="UNSUPPORTED",
        detect_method="manual",
        default_config={"note": "drive its fixtures via an Art-Net→DMX gateway on the same universes"},
        configure_in="(via Art-Net gateway)",
        notes=(
            "The flagship European fountain controller. Its own network surface is "
            "proprietary; the honest integration is at the DMX layer — AquaFlow "
            "outputs Art-Net/sACN into the same DMX universes its fixtures listen on."
        ),
        source="oase-professional.com product data (2026-09 research)",
    ),
    ControllerEntry(
        id="safe-rain-dmx",
        vendor="Safe-Rain",
        model="RGB/RGBW DMX fountain controllers",
        category="fountain_controller",
        protocol="dmx_only",
        tier="UNSUPPORTED",
        detect_method="manual",
        default_config={"note": "addressable DMX channel devices — drive via Art-Net→DMX gateway"},
        configure_in="(via Art-Net gateway)",
        source="saferain.com product data (2026-09 research)",
    ),

    # ── Identify-only PLC families (detectable, NOT drivable — say so) ────────
    ControllerEntry(
        id="allen-bradley-logix",
        vendor="Allen-Bradley / Rockwell",
        model="ControlLogix / CompactLogix",
        category="plc",
        protocol="ethernet_ip",
        tier=PLC_SUPPORT.get("allen_bradley", "UNSUPPORTED"),
        detect_method="enip_list_identity",  # standard, read-only
        detect_ports=[44818],
        default_config={},
        notes=(
            "Common in North-American fountain plants (Grand Haven ran PLC-2/PLC-5). "
            "AquaFlow can IDENTIFY it via EtherNet/IP ListIdentity but has no "
            "EtherNet/IP driver — detected units are shown as not drivable."
        ),
        source="ghfountain.org + industry research (2026-09)",
    ),
    ControllerEntry(
        id="opcua-server",
        vendor="(any)",
        model="OPC UA server (Beckhoff CX, S7-1500 OPC UA, ...)",
        category="plc",
        protocol="opc_ua",
        tier=PLC_SUPPORT.get("opc_ua", "UNSUPPORTED"),
        detect_method="port_hint",
        detect_ports=[4840],
        default_config={},
        notes="Driver code exists but is GATED (untested, undeclared dependency) — identify-only for now.",
    ),
    ControllerEntry(
        id="mitsubishi-melsec",
        vendor="Mitsubishi",
        model="MELSEC iQ-R / Q / FX5 (MC protocol)",
        category="plc",
        protocol="melsec_mc",
        tier=PLC_SUPPORT.get("mitsubishi", "UNSUPPORTED"),
        detect_method="port_hint",
        detect_ports=[5007],
        default_config={},
        notes="MC-protocol port varies per config (1025-4999 / 5007+). If the unit also speaks Modbus TCP, connect it as modbus_tcp.",
    ),
    ControllerEntry(
        id="omron-fins",
        vendor="Omron",
        model="CJ/CS/NX (FINS)",
        category="plc",
        protocol="omron_fins",
        tier=PLC_SUPPORT.get("omron", "UNSUPPORTED"),
        detect_method="manual",
        detect_udp_ports=[9600],
        default_config={},
        notes="FINS is UDP 9600 — not visible to the TCP sweep; add manually. Modbus-capable units: connect as modbus_tcp.",
    ),
    ControllerEntry(
        id="beckhoff-ads",
        vendor="Beckhoff",
        model="CX embedded PC (TwinCAT ADS)",
        category="plc",
        protocol="beckhoff_ads",
        tier=PLC_SUPPORT.get("beckhoff", "UNSUPPORTED"),
        detect_method="port_hint",
        detect_ports=[48898],
        default_config={},
        notes="Used in high-end show fountains. ADS is not implemented — identify-only.",
    ),

    # ── VFDs ──────────────────────────────────────────────────────────────────
    ControllerEntry(
        id="fountain-vfd",
        vendor="ZONCEN / FRECON / (any)",
        model="Fountain pump VFD",
        category="vfd",
        protocol="modbus_tcp",
        tier=PLC_SUPPORT.get("modbus_tcp", "UNSUPPORTED"),
        detect_method="modbus_ident",
        detect_ports=[502],
        default_config={"ip": "", "port": 502, "unit_id": 1,
                        "speed_register": "check drive manual (FC06 write)"},
        configure_in="PLC panel, or via PLC AO (AF-IO-009)",
        notes=(
            "Two honest routes: direct Modbus TCP where the drive (or an RTU/TCP "
            "gateway) offers it, or the safety-gated PLC analog-output path "
            "(AF-IO-009) — 1215C AO is 0-20 mA; a 0-10 V reference input needs "
            "the drive's current input or a 500 Ω resistor."
        ),
        source="FRECON music-fountain VFD solution + site ZONCEN unit (2026-09 research)",
    ),
]


def all_entries() -> list[ControllerEntry]:
    return list(CATALOG)


def get_entry(entry_id: str) -> Optional[ControllerEntry]:
    return next((e for e in CATALOG if e.id == entry_id), None)


def entries_for_tcp_port(port: int) -> list[ControllerEntry]:
    return [e for e in CATALOG if port in e.detect_ports]


def catalog_dict() -> dict:
    tiers: dict[str, int] = {}
    for e in CATALOG:
        tiers[e.tier] = tiers.get(e.tier, 0) + 1
    return {
        "entries": [e.to_dict() for e in CATALOG],
        "count": len(CATALOG),
        "by_tier": tiers,
        "drivable": [e.id for e in CATALOG if e.tier == "REAL"],
    }
