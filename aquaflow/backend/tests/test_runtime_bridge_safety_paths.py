"""
AF-HUB-007 — Stub burn-down (safety paths real).

The runtime ProtocolRouter dispatches compiled events to hardware. Its Modbus
(pump/valve/flame) and relay paths used to `return True` unconditionally — a phantom
success that also dropped the command entirely (unlike the Art-Net path, which records
to the bus). These tests prove those safety-critical paths now dispatch through the bus
transport, record in the simulation, return the ACTUAL result, and fail closed (return
False) when no transport exists rather than faking success.
"""
import asyncio

from services.runtime_bridge import ProtocolRouter, CompiledEvent, _create_virtual_bus


def _router_with_devices():
    bus = _create_virtual_bus()
    router = ProtocolRouter(bus)
    router.load_device_map({
        "pump-1":  {"protocol": "modbus", "plc_host": "10.0.0.5", "plc_port": 502,
                    "plc_unit_id": 1, "plc_register": 40001, "plc_data_type": "uint16"},
        "flame-1": {"protocol": "modbus", "plc_host": "10.0.0.6", "plc_register": 40002,
                    "plc_data_type": "coil"},
        "relay-1": {"protocol": "relay", "relay_board_id": "boardA", "relay_index": 3},
        "light-1": {"protocol": "artnet", "dmx_universe": 1, "dmx_channel": 1,
                    "dmx_profile": "dimmer_1ch"},
    })
    return router, bus


def _ev(device_id, value, channel_id="intensity"):
    return CompiledEvent(time=0.0, device_id=device_id, channel_id=channel_id, value=value)


def test_modbus_dispatch_reaches_the_bus_and_reports_real_result():
    router, bus = _router_with_devices()
    ok = asyncio.run(router.dispatch(_ev("pump-1", 1.0, channel_id="pump_speed")))
    assert ok is True
    state = bus.get_modbus_state()
    # the command was actually recorded (not silently dropped)
    assert (("10.0.0.5", 1, 40001)) in state
    assert state[("10.0.0.5", 1, 40001)] == 65535  # 1.0 → full-scale uint16


def test_relay_dispatch_reaches_the_bus():
    router, bus = _router_with_devices()
    ok = asyncio.run(router.dispatch(_ev("relay-1", 1.0)))
    assert ok is True
    assert bus.get_relay_state()[("boardA", 3)] is True

    # value below threshold → relay OFF, still recorded
    asyncio.run(router.dispatch(_ev("relay-1", 0.0)))
    assert bus.get_relay_state()[("boardA", 3)] is False


def test_modbus_dispatch_fails_closed_when_bus_has_no_transport():
    """A bus with no send_modbus must NOT report phantom success."""
    class _DmxOnlyBus:
        async def send_artnet(self, data):
            return True
    router = ProtocolRouter(_DmxOnlyBus())
    router.load_device_map({"pump-1": {"protocol": "modbus", "plc_register": 40001}})
    ok = asyncio.run(router.dispatch(_ev("pump-1", 1.0)))
    assert ok is False, "Modbus dispatch faked success with no transport"


def test_relay_dispatch_fails_closed_when_bus_has_no_transport():
    class _DmxOnlyBus:
        async def send_artnet(self, data):
            return True
    router = ProtocolRouter(_DmxOnlyBus())
    router.load_device_map({"relay-1": {"protocol": "relay", "relay_index": 1}})
    ok = asyncio.run(router.dispatch(_ev("relay-1", 1.0)))
    assert ok is False


def test_blackout_zeros_modbus_and_relay_not_just_dmx():
    router, bus = _router_with_devices()
    asyncio.run(router.dispatch(_ev("pump-1", 1.0, channel_id="pump_speed")))
    asyncio.run(router.dispatch(_ev("relay-1", 1.0)))
    assert bus.get_modbus_state()[("10.0.0.5", 1, 40001)] == 65535
    assert bus.get_relay_state()[("boardA", 3)] is True

    asyncio.run(bus.blackout())
    # a blackout must zero every output path
    assert bus.get_modbus_state()[("10.0.0.5", 1, 40001)] == 0
    assert bus.get_relay_state()[("boardA", 3)] is False


def test_get_state_surfaces_modbus_and_relay():
    router, bus = _router_with_devices()
    asyncio.run(router.dispatch(_ev("pump-1", 0.5, channel_id="pump_speed")))
    asyncio.run(router.dispatch(_ev("relay-1", 1.0)))
    st = bus.get_state()
    assert "modbus" in st and "relay" in st
    assert st["modbus"]["10.0.0.5:1:40001"] == int(0.5 * 65535)
    assert st["relay"]["boardA:3"] is True
    assert st["stats"]["command_count"] == 2
