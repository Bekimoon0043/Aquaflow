"""
AQ-S1-001 — Backend fixture-aware architecture (emit-level regression).

The fixture-aware runtime (AF-HUB fixture unification) lets a DESIGNED show drive real
hardware addresses instead of only seed devices:
    designed fixtures → DeviceRegistry → ProtocolBus.configure_from_fixtures()
                       → _dmx_map / _fixture_registers → _route_command → driver.send()

Existing suites cover the Pattern-Designer map path (`update_dmx_map`) and the seed-device
path, and a harness checks the maps are *built*. What was NOT locked in by an automated test
is the acceptance criterion itself — that a command for a **designed** fixture actually EMITS
to that fixture's **designed** universe/channel (DMX) or host/register (Modbus). These tests
capture the driver emit and assert the address, so a regression in the fixture-aware routing
fails loudly.

Acceptance criteria proven here:
  1. show_engine.get_snapshot() carries fixtures + groups
  2. protocol_bus builds its routing maps from the designed fixtures (not seeds)
  3. a designed show reaches the designed real-hardware addresses
"""
import asyncio

from engine.protocol_bus import ProtocolBus
from engine.show_engine import ShowEngine
from services.fixture_registry_bridge import build_registry_from_fixtures


class _CapturingArtNet:
    name = "artnet"
    is_connected = True
    def __init__(self): self.sent = []
    async def send(self, data): self.sent.append(data)
    async def blackout(self): pass


class _CapturingModbus:
    name = "modbus"
    is_connected = True
    def __init__(self): self.sent = []
    async def send(self, data): self.sent.append(data)
    async def blackout(self): pass


# A small designed show: one Art-Net RGB light at an explicit address and one Modbus jet.
DESIGNED_FIXTURES = [
    {"id": "des-rgb", "type": "light_rgb", "groupId": "rgb", "label": "Designed RGB",
     "universe": 3, "channel": 15},                                   # explicit DMX address
    {"id": "des-jet", "type": "nozzle_straight_dn25", "groupId": "jets", "label": "Designed Jet",
     "engineering": {"plcChannel": "Q0.1"}},                          # Modbus, register 1
]


# ── Criterion 1 — snapshot carries designed fixtures + groups ────────────────────
def test_snapshot_carries_designed_fixtures_and_groups():
    eng = ShowEngine()
    eng.load_show({"show": {"id": "t", "name": "T"}, "fixtures": DESIGNED_FIXTURES})
    snap = eng.get_snapshot()
    assert "fixtures" in snap and "groups" in snap
    assert {f["id"] for f in snap["fixtures"]} == {"des-rgb", "des-jet"}
    group_ids = {g["id"] for g in snap["groups"]}
    assert {"rgb", "jets"} <= group_ids
    # the RGB group carries its designed member
    rgb = next(g for g in snap["groups"] if g["id"] == "rgb")
    assert "des-rgb" in rgb["memberIds"]


# ── Criterion 2 — maps built from designed fixtures, not seeds ────────────────────
def test_configure_builds_maps_from_designed_fixtures_not_seeds():
    registry, warnings = build_registry_from_fixtures(DESIGNED_FIXTURES)
    assert warnings == []          # clean design, no address collisions
    bus = ProtocolBus()
    counts = bus.configure_from_fixtures(registry)
    assert counts == {"dmx": 1, "modbus": 1}
    # the DESIGNED fixture ids are what routing keys on (not seed-device ids)
    assert "des-rgb" in {m["fixtureId"] for m in bus.get_dmx_map()}
    assert "des-jet" in bus._fixture_registers


# ── Criterion 3 — a designed fixture reaches its designed hardware address ────────
def test_designed_dmx_fixture_emits_to_designed_universe_and_channel():
    registry, _ = build_registry_from_fixtures(DESIGNED_FIXTURES)
    bus = ProtocolBus()
    bus.configure_from_fixtures(registry)
    art = _CapturingArtNet()
    bus._drivers["artnet"] = art

    asyncio.run(bus._route_command({"device_id": "des-rgb", "type": "lighting", "intensity": 1.0}))

    assert len(art.sent) == 1, "designed DMX fixture did not reach the driver"
    frame = art.sent[0]
    # registry is 1-indexed; Art-Net out is 0-indexed → universe 3 becomes 2
    assert frame["universe"] == 2
    # the designed channel (15) is the fixture's master/red address on the wire
    assert 15 in frame["channels"], f"designed channel not addressed: {sorted(frame['channels'])}"


def test_designed_modbus_fixture_emits_to_designed_register():
    registry, _ = build_registry_from_fixtures(DESIGNED_FIXTURES)
    bus = ProtocolBus()
    bus.configure_from_fixtures(registry)
    # configure_from_fixtures auto-assigned a PLC host for the jet — inject a capturing
    # driver at that host so the emit is observable.
    host = bus._fixture_registers["des-jet"]["host"]
    mod = _CapturingModbus()
    bus._drivers[f"modbus:{host}"] = mod

    asyncio.run(bus._route_command({"device_id": "des-jet", "type": "pump", "intensity": 1.0}))

    assert len(mod.sent) == 1, "designed Modbus fixture did not reach a driver"
    # Q0.1 → register 1: the command reached the DESIGNED register, not a default reg 1-of-any.
    assert mod.sent[0]["register"] == 1


def test_unconfigured_bus_does_not_route_designed_fixture_to_hardware():
    """Negative control: without configure_from_fixtures the same command must fail closed
    (proving the emit above came from the fixture-aware config, not a default)."""
    bus = ProtocolBus()
    art = _CapturingArtNet()
    bus._drivers["artnet"] = art
    asyncio.run(bus._route_command({"device_id": "des-rgb", "type": "lighting", "intensity": 1.0}))
    assert art.sent == []
    assert "des-rgb" in bus.get_status()["unmapped_output"]
