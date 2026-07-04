"""
validate_dmx_assigner.py — AQ-X-001 verification

Hand-checked scenarios for Automatic DMX Address Assignment:
  1. auto-assignment sizes every fixture type and packs conflict-free,
  2. manual overrides are honoured and everything else packs around them,
  3. universe rollover at 512, and
  4. the DeviceRegistry / fixture-bridge path is conflict-free with manual addresses.

Run:  python backend/validate_dmx_assigner.py   (from the aquaflow/ dir)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:                                    # ASCII-safe on Windows cp1252 consoles
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.dmx_assigner import (
    DMXFixture, assign_dmx, assign_from_dicts, channels_for,
)
from services.fixture_registry_bridge import build_registry_from_fixtures
from services.device_registry import Protocol

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


def occupied(fixtures):
    slots = set()
    for f in fixtures:
        for i in range(f.channels):
            slots.add((f.universe, f.channel + i))
    return slots


print("== 1. channel sizing (all fixture types) ==")
check("rgbw_4ch -> 4", channels_for("rgbw_4ch") == 4)
check("moving_head_16ch -> 16", channels_for("moving_head_16ch") == 16)
check("laser -> 2", channels_for("laser") == 2)
check("unknown profile falls back to type (light_rgb -> 4)",
      channels_for("nope", "light_rgb") == 4)
check("moving head by type -> 14", channels_for(None, "moving_head_wash") == 14)
check("unknown -> default 1", channels_for(None, None) == 1)

print("== 2. auto assignment is conflict-free ==")
fx = [DMXFixture(id=f"L{i}", channels=4) for i in range(10)]
assign_dmx(fx)
slots = occupied(fx)
check("10x4ch = 40 distinct channels", len(slots) == 40, f"{len(slots)} slots")
check("packed contiguously in universe 1", sorted(f.channel for f in fx)[:3] == [1, 5, 9])

print("== 3. manual override honoured + packed around ==")
pin = DMXFixture(id="PIN", channels=4, locked=True, universe=1, channel=1)
a1 = DMXFixture(id="A1", channels=4)
a2 = DMXFixture(id="A2", channels=4)
_, warns = assign_dmx([pin, a1, a2])
check("manual PIN kept at U1 Ch1", (pin.universe, pin.channel) == (1, 1))
check("A1 not on channels 1-4", not (a1.universe == 1 and 1 <= a1.channel <= 4),
      f"A1 -> U{a1.universe} Ch{a1.channel}")
check("A2 not on channels 1-4", not (a2.universe == 1 and 1 <= a2.channel <= 4),
      f"A2 -> U{a2.universe} Ch{a2.channel}")
check("no collisions", not any("collision" in w.lower() for w in warns), str(warns))
check("all 12 channels distinct", len(occupied([pin, a1, a2])) == 12)

print("== 4. manual-vs-manual collision reported ==")
m1 = DMXFixture(id="M1", channels=4, locked=True, universe=1, channel=1)
m2 = DMXFixture(id="M2", channels=4, locked=True, universe=1, channel=2)
_, warns2 = assign_dmx([m1, m2])
check("overlap flagged", any("collision" in w.lower() for w in warns2), str(warns2))

print("== 5. universe rollover at 512 ==")
big = [DMXFixture(id=f"B{i}", channels=4) for i in range(130)]  # 520 channels
_, warns3 = assign_dmx(big)
check("spills into universe 2", {f.universe for f in big} == {1, 2})
check("no channel exceeds 512", all(f.channel + f.channels - 1 <= 512 for f in big))
check("520 channels all distinct", len(occupied(big)) == 520)

print("== 6. dict adapter preserves order + sizes ==")
out, _ = assign_from_dicts([
    {"id": "mh1", "type": "moving_head_spot"},
    {"id": "rgb1", "profile": "rgbw_4ch"},
    {"id": "pin", "universe": 1, "channel": 1, "channels": 2},
])
check("order preserved", [a["id"] for a in out] == ["mh1", "rgb1", "pin"])
check("moving head sized to 14", next(a for a in out if a["id"] == "mh1")["channels"] == 14)
check("explicit pin marked locked", next(a for a in out if a["id"] == "pin")["locked"] is True)

print("== 7. fixture-bridge path conflict-free with a low manual address ==")
# rgb-lo pinned at U1 Ch1 (4ch); two auto RGB lights must pack around it.
fixtures = [
    {"id": "rgb-lo", "type": "light_rgb", "universe": 1, "channel": 1},
    {"id": "rgb-a", "type": "light_rgb"},
    {"id": "rgb-b", "type": "light_rgb"},
]
registry, w = build_registry_from_fixtures(fixtures)
by = {d.device_id: d for d in registry.all_devices()}
addrs = {(d.dmx_universe, d.dmx_channel) for d in registry.all_devices()
         if d.protocol in (Protocol.ARTNET, Protocol.DMX, Protocol.SACN)}
check("rgb-lo manual address preserved", (by["rgb-lo"].dmx_universe, by["rgb-lo"].dmx_channel) == (1, 1))
check("auto lights avoid the manual block",
      all(not (by[i].dmx_universe == 1 and 1 <= by[i].dmx_channel <= 4) for i in ("rgb-a", "rgb-b")),
      f'a->{by["rgb-a"].dmx_channel}, b->{by["rgb-b"].dmx_channel}')
check("all DMX start-addresses distinct", len(addrs) == 3, str(addrs))
check("no collision warnings from bridge", not any("collision" in x.lower() for x in w), str(w))

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
