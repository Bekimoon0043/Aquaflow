"""
fixture_registry_bridge.py — AquaFlow Stage 1, Priority 1 (fixture-aware backend)

Converts *designed* engineering fixtures (as placed in the Pool Geometry / Pattern
Designer and carried in the show payload) into a populated DeviceRegistry:

  - derives a control protocol (Modbus for pumps/valves/flame, Art-Net/DMX for
    lighting/fog/laser) from the fixture type + engineering block,
  - derives a hardware address (Modbus host+register, or DMX universe+channel),
    honouring any explicit address fields on the fixture,
  - auto-assigns DMX channels and Modbus registers where none were supplied
    (Stage 1, Priority 2 foundation),
  - returns the DeviceRegistry plus a list of validation warnings — including
    address collisions (Stage 1, Priority 3 foundation).

This is the missing link that lets a designed show reach real hardware instead of
only the 10 hard-coded SEED_DEVICES.
"""
from __future__ import annotations

import re
from typing import Optional

from services.device_registry import DeviceRegistry, DeviceAddress, Protocol

# Protocols that live in the DMX/Art-Net/sACN address space.
_DMX_PROTOCOLS = (Protocol.DMX, Protocol.ARTNET, Protocol.SACN)

# Default PLC/Modbus host used when a jet/valve/flame fixture does not carry its
# own host. Real sites override this per fixture; this keeps a single-PLC design
# fully routable out of the box (matches the seed "Master Pump Array" host).
DEFAULT_PLC_HOST = "192.168.1.10"


def _first_int(*vals) -> Optional[int]:
    """Return the first value that cleanly converts to int, else None."""
    for v in vals:
        if v is None or v == "":
            continue
        try:
            return int(v)
        except (ValueError, TypeError):
            continue
    return None


def derive_device_type(raw_type: str) -> str:
    """Normalise a fixture library key / type token into a control class."""
    t = str(raw_type or "").strip().lower()
    if any(k in t for k in ("light", "rgb", "under", "led", "spot")):
        return "lighting"
    if "laser" in t:
        return "laser"
    if any(k in t for k in ("flame", "fire")):
        return "flame"
    if any(k in t for k in ("fog", "mist", "haze", "smoke")):
        return "fog"
    if any(k in t for k in ("valve", "solenoid")):
        return "valve"
    if any(k in t for k in ("pump", "vfd")):
        return "pump"
    if "sensor" in t:
        return "sensor"
    # Water jets are driven by pumps/valves on a PLC → Modbus control class.
    if any(k in t for k in ("nozzle", "jet", "geyser", "foam", "laminar",
                            "running", "fan", "arch", "spray")):
        return "pump"
    return "aux"


def derive_protocol(device_type: str) -> Protocol:
    if device_type in ("lighting", "fog", "laser"):
        return Protocol.ARTNET
    if device_type in ("pump", "valve", "flame", "sensor"):
        return Protocol.MODBUS
    return Protocol.RELAY


def _dmx_channels_for(device_type: str) -> int:
    # RGB lighting fixtures need master + R + G + B; everything else is 1 channel.
    return 4 if device_type == "lighting" else 1


def parse_plc_register(plc_channel) -> Optional[int]:
    """
    Derive a Modbus holding-register offset from a PLC channel tag.

    Convention: "Q0.1" (byte.bit) → byte*8 + bit = 1 ; "QW2" / "%QW10" → 2 / 10.
    Returns None when no number can be parsed (caller then auto-assigns).
    """
    nums = re.findall(r"\d+", str(plc_channel or ""))
    if not nums:
        return None
    if len(nums) >= 2:
        return int(nums[0]) * 8 + int(nums[1])
    return int(nums[0])


def _has_explicit_dmx(fx: dict) -> bool:
    return _first_int(fx.get("channel"), fx.get("dmxAddress"),
                      fx.get("dmxChannel"),
                      (fx.get("engineering") or {}).get("dmxChannel")) is not None


def fixture_to_address(fx: dict, default_plc_host: str = DEFAULT_PLC_HOST) -> Optional[DeviceAddress]:
    """Build one DeviceAddress from a designed fixture dict (None if unusable)."""
    if not isinstance(fx, dict):
        return None
    fid = fx.get("id") or fx.get("fixtureId")
    if not fid:
        return None

    raw_type = fx.get("type") or fx.get("fixtureType") or ""
    dtype = derive_device_type(raw_type)
    proto = derive_protocol(dtype)
    eng = fx.get("engineering") or {}

    addr = DeviceAddress(
        device_id=str(fid),
        device_type=str(raw_type) or dtype,
        zone=str(fx.get("zone") or "main"),
        group_id=str(fx.get("groupId") or ""),
        label=str(fx.get("label") or fid),
        protocol=proto,
    )

    if proto in _DMX_PROTOCOLS:
        addr.dmx_channels = _dmx_channels_for(dtype)
        addr.dmx_profile = "rgb_4ch" if dtype == "lighting" else "dimmer_1ch"
        u = _first_int(fx.get("universe"), fx.get("dmxUniverse"), eng.get("dmxUniverse"))
        c = _first_int(fx.get("channel"), fx.get("dmxAddress"), fx.get("dmxChannel"), eng.get("dmxChannel"))
        if u is not None:
            addr.dmx_universe = u
        if c is not None:
            addr.dmx_channel = c
    elif proto == Protocol.MODBUS:
        addr.plc_host = str(fx.get("plcHost") or eng.get("plcHost") or fx.get("ip") or default_plc_host)
        addr.plc_port = _first_int(fx.get("plcPort"), eng.get("plcPort")) or 502
        addr.plc_unit_id = _first_int(fx.get("unitId"), eng.get("unitId")) or 1
        reg = _first_int(fx.get("register"), fx.get("plcRegister"), eng.get("register"))
        if reg is None:
            reg = parse_plc_register(eng.get("plcChannel") or fx.get("plcChannel"))
        addr.plc_register = reg if reg is not None else 0

    return addr


def _auto_assign_modbus(registry: DeviceRegistry) -> None:
    """Give any Modbus device without a register a unique one, packed per host."""
    used: dict[str, set] = {}
    # First record explicitly-set registers so we don't collide with them.
    for d in registry.all_devices():
        if d.protocol == Protocol.MODBUS and d.plc_register:
            used.setdefault(d.plc_host, set()).add(d.plc_register)
    next_reg: dict[str, int] = {}
    for d in registry.all_devices():
        if d.protocol != Protocol.MODBUS or d.plc_register:
            continue
        host_used = used.setdefault(d.plc_host, set())
        r = next_reg.get(d.plc_host, 1)
        while r in host_used:
            r += 1
        d.plc_register = r
        host_used.add(r)
        next_reg[d.plc_host] = r + 1


def build_registry_from_fixtures(
    fixtures: list,
    groups: Optional[list] = None,
    default_plc_host: str = DEFAULT_PLC_HOST,
    auto_assign: bool = True,
) -> tuple[DeviceRegistry, list[str]]:
    """
    Build an in-memory DeviceRegistry from designed fixtures.

    Returns (registry, warnings). `warnings` includes auto-assignment overflow
    notes plus any address collisions found by registry.validate().
    """
    registry = DeviceRegistry()
    registry._devices.clear()
    registry._limits.clear()

    warnings: list[str] = []
    dmx_pending: list[DeviceAddress] = []

    for fx in fixtures or []:
        addr = fixture_to_address(fx, default_plc_host)
        if addr is None:
            continue
        if addr.protocol in _DMX_PROTOCOLS and auto_assign and not _has_explicit_dmx(fx):
            dmx_pending.append(addr)   # channel assigned in a packed pass below
        else:
            registry.register(addr)

    if dmx_pending:
        # Pack DMX fixtures after the explicitly-addressed ones. Registry uses a
        # 1-indexed universe convention.
        warnings += registry.auto_assign_dmx(dmx_pending, start_universe=1, start_channel=1)

    _auto_assign_modbus(registry)

    warnings += registry.validate()
    return registry, warnings
