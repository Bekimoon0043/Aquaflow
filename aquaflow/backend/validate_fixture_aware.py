"""
validate_fixture_aware.py — Stage 1, Priority 1 verification

Exercises the fixture-aware runtime path without any hardware:
  1. designed fixtures → DeviceRegistry (protocol + address derivation)
  2. DMX auto-assignment + Modbus register derivation
  3. address-collision detection
  4. ShowEngine carries fixtures/groups into its snapshot + state
  5. ProtocolBus.configure_from_fixtures populates DMX + Modbus routing maps

Run:  python backend/validate_fixture_aware.py   (from the aquaflow/ dir)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

from services.fixture_registry_bridge import (
    build_registry_from_fixtures, parse_plc_register, derive_device_type,
)
from services.device_registry import Protocol
from engine.show_engine import ShowEngine
from engine.protocol_bus import ProtocolBus

FIXTURES = [
    {"id": "jet-1",  "type": "nozzle_straight_dn25", "groupId": "center_jets", "label": "Jet 1",  "engineering": {"plcChannel": "Q0.1"}},
    {"id": "jet-2",  "type": "nozzle_geyser",        "groupId": "center_jets", "label": "Jet 2",  "engineering": {"plcChannel": "Q0.2"}},
    {"id": "valve-1","type": "valve",                "groupId": "valves",      "label": "Valve 1","engineering": {"plcChannel": "Q1.0"}},
    {"id": "rgb-1",  "type": "light_rgb",            "groupId": "rgb_lights",  "label": "RGB 1"},   # auto DMX (4ch)
    {"id": "rgb-2",  "type": "light_rgb",            "groupId": "rgb_lights",  "label": "RGB 2"},   # auto DMX (4ch)
    {"id": "spot-1", "type": "light_underwater",     "groupId": "rgb_lights",  "label": "Spot 1", "universe": 1, "channel": 20},  # explicit
    {"id": "laser-1","type": "laser",                "groupId": "laser_units", "label": "Laser 1"}, # auto DMX (1ch)
]

_passed = 0
_failed = 0

def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


print("== 1. registry build + address derivation ==")
registry, warnings = build_registry_from_fixtures(FIXTURES)
by_id = {d.device_id: d for d in registry.all_devices()}

check("all fixtures registered", registry.to_dict()["device_count"] == len(FIXTURES),
      f'{registry.to_dict()["device_count"]}/{len(FIXTURES)}')
check("jet-1 is Modbus", by_id["jet-1"].protocol == Protocol.MODBUS)
check("jet-1 register parsed from Q0.1 == 1", by_id["jet-1"].plc_register == 1,
      f'got {by_id["jet-1"].plc_register}')
check("valve-1 register from Q1.0 == 8", by_id["valve-1"].plc_register == 8,
      f'got {by_id["valve-1"].plc_register}')
check("rgb-1 is Art-Net/DMX", by_id["rgb-1"].protocol in (Protocol.ARTNET, Protocol.DMX, Protocol.SACN))
check("rgb-1 uses 4 DMX channels", by_id["rgb-1"].dmx_channels == 4)

print("== 2. auto-assignment ==")
check("rgb-1 and rgb-2 got distinct channels",
      by_id["rgb-1"].dmx_channel != by_id["rgb-2"].dmx_channel,
      f'rgb-1 ch{by_id["rgb-1"].dmx_channel}, rgb-2 ch{by_id["rgb-2"].dmx_channel}')
check("explicit spot-1 channel preserved (20)", by_id["spot-1"].dmx_channel == 20)
check("clean design has no collision warnings", len(warnings) == 0, str(warnings))
check("derive_device_type(nozzle_arch) == pump", derive_device_type("nozzle_arch") == "pump")
check("parse_plc_register('%QW10') == 10", parse_plc_register("%QW10") == 10)

print("== 3. collision detection ==")
clash = FIXTURES + [{"id": "dup-1", "type": "light_rgb", "universe": 1, "channel": 20}]  # clashes w/ spot-1
_, warn2 = build_registry_from_fixtures(clash)
check("collision detected", any("collision" in w.lower() for w in warn2), str(warn2))

print("== 4. show engine carries fixtures/groups ==")
eng = ShowEngine()
eng.load_show({"show": {"id": "t", "name": "T"}, "fixtures": FIXTURES})
snap = eng.get_snapshot()
check("snapshot has fixtures", len(snap.get("fixtures", [])) == len(FIXTURES))
check("snapshot has derived groups", len(snap.get("groups", [])) >= 3,
      f'{len(snap.get("groups", []))} groups')
check("get_state fixture_count", eng.get_state().get("fixture_count") == len(FIXTURES))
# accepts the engineeringFixtures alias too
eng2 = ShowEngine()
eng2.load_show({"engineeringFixtures": FIXTURES})
check("engineeringFixtures alias accepted", len(eng2.get_snapshot().get("fixtures", [])) == len(FIXTURES))

print("== 5. protocol bus routing maps ==")
bus = ProtocolBus()
result = bus.configure_from_fixtures(registry)
dmx_ids = {m["fixtureId"] for m in bus.get_dmx_map()}
check("DMX map has rgb-1", "rgb-1" in dmx_ids)
check("DMX map has laser-1", "laser-1" in dmx_ids)
check("Modbus fixture-register map has jet-1", "jet-1" in bus._fixture_registers)
check("jet-1 routed to a host", bool(bus._fixture_registers.get("jet-1", {}).get("host")))
check("configure returned counts", result.get("modbus", 0) >= 3 and result.get("dmx", 0) >= 3, str(result))

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
