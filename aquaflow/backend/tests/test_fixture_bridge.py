"""
Contract tests for the fixture → DeviceRegistry bridge and its address validation
(AQ-S1-009). This is the pipeline that turns a designed show into real hardware
addresses and flags conflicts (Stage 1, Priorities 1–3).
"""
from services.fixture_registry_bridge import build_registry_from_fixtures
from services.device_registry import Protocol


def _light(fid, universe=None, channel=None):
    fx = {"id": fid, "type": "rgb_light", "label": fid, "zone": "main"}
    if universe is not None:
        fx["universe"] = universe
    if channel is not None:
        fx["channel"] = channel
    return fx


def _pump(fid):
    return {"id": fid, "type": "center_jets", "label": fid, "zone": "main"}


def test_lighting_routes_to_dmx_and_pump_to_modbus():
    registry, _ = build_registry_from_fixtures([_light("L1"), _pump("P1")])
    by_id = {d.device_id: d for d in registry.all_devices()}
    assert by_id["L1"].protocol in (Protocol.ARTNET, Protocol.DMX, Protocol.SACN)
    assert by_id["P1"].protocol == Protocol.MODBUS


def test_auto_assignment_gives_unique_dmx_channels():
    registry, warnings = build_registry_from_fixtures([_light("L1"), _light("L2")])
    lights = [d for d in registry.all_devices() if d.protocol != Protocol.MODBUS]
    addrs = {(d.dmx_universe, d.dmx_channel) for d in lights}
    assert len(addrs) == len(lights), "auto-assigned DMX addresses collided"
    assert not any("collision" in w.lower() for w in warnings)


def test_duplicate_explicit_addresses_are_flagged():
    # Two RGB fixtures pinned to the same universe+channel must collide.
    registry, warnings = build_registry_from_fixtures([
        _light("L1", universe=1, channel=1),
        _light("L2", universe=1, channel=1),
    ])
    assert any("collision" in w.lower() for w in warnings), warnings


def test_modbus_registers_are_packed_uniquely():
    registry, _ = build_registry_from_fixtures([_pump("P1"), _pump("P2"), _pump("P3")])
    pumps = [d for d in registry.all_devices() if d.protocol == Protocol.MODBUS]
    regs = [(d.plc_host, d.plc_register) for d in pumps]
    assert len(set(regs)) == len(regs), "Modbus registers collided"
