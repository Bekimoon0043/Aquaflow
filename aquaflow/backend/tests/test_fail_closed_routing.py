"""
AF-HUB-015 — Hardware output fail-closed routing.

An unmapped fixture command must NEVER reach hardware. Previously an unmapped DMX fixture
fell back to universe 0 / channel 1 (a real device on the wire), and an unmapped Modbus
fixture was sent to "any modbus driver" at register 1. Both are now fail-closed: no
mapping = no output + explicit record; on real hardware, playback is blocked.
"""
import asyncio

import pytest

from engine.protocol_bus import ProtocolBus
from engine.show_engine import ShowEngine, PlaybackState


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


def test_unmapped_dmx_fixture_sends_zero_output():
    bus = ProtocolBus()
    art = _CapturingArtNet()
    bus._drivers["artnet"] = art
    # No _dmx_map entry, not a seed device → must fail closed.
    asyncio.run(bus._route_command({"device_id": "ghost-light", "type": "lighting", "intensity": 1.0}))
    assert art.sent == [], "unmapped DMX fixture reached the wire (fail-open)"
    assert "ghost-light" in bus.get_status()["unmapped_output"]


def test_unmapped_modbus_fixture_sends_zero_output():
    bus = ProtocolBus()
    # A modbus driver exists but the fixture has no register/device mapping → must NOT
    # fall back to 'any modbus driver'.
    mod = _CapturingModbus()
    bus._drivers["modbus:10.0.0.1"] = mod
    asyncio.run(bus._route_command({"device_id": "ghost-pump", "type": "pump", "intensity": 1.0}))
    assert mod.sent == [], "unmapped Modbus fixture reached a driver (fail-open)"
    assert "ghost-pump" in bus.get_status()["unmapped_output"]


def test_mapped_dmx_fixture_still_emits():
    bus = ProtocolBus()
    art = _CapturingArtNet()
    bus._drivers["artnet"] = art
    bus.update_dmx_map([{"fixtureId": "L1", "universe": 2, "channel": 5}])
    asyncio.run(bus._route_command({"device_id": "L1", "type": "lighting", "intensity": 1.0}))
    assert len(art.sent) == 1
    assert art.sent[0]["universe"] == 2


def test_unmapped_fixtures_lists_the_unmapped_ones():
    bus = ProtocolBus()
    bus.update_dmx_map([{"fixtureId": "L1", "universe": 0, "channel": 1}])
    fixtures = [{"id": "L1", "type": "light_rgb"}, {"id": "ghost", "type": "light_rgb"}]
    assert bus.unmapped_fixtures(fixtures) == ["ghost"]


# ── Real-hardware vs simulation mode gating (via ShowEngine.play) ────────────────

def _engine_with_unmapped():
    eng = ShowEngine()
    bus = ProtocolBus()
    bus._drivers["artnet"] = _CapturingArtNet()
    eng.load_show({"currentShow": {"id": "s", "name": "S", "duration": 5},
                   "fixtures": [{"id": "ghost", "type": "light_rgb"}]})
    return eng, bus


def test_simulation_mode_allows_playback_with_unmapped_fixtures(monkeypatch):
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "0")  # simulation
    async def run():
        eng, bus = _engine_with_unmapped()
        await eng.start(device_manager=None, protocol_bus=bus)
        started = await eng.play()
        assert started is True   # design workflow continues
        await eng.stop_playback(); await eng.stop()
    asyncio.run(run())


def test_real_hardware_mode_blocks_playback_with_unmapped_fixtures(monkeypatch):
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "1")  # real hardware
    async def run():
        eng, bus = _engine_with_unmapped()
        await eng.start(device_manager=None, protocol_bus=bus)
        started = await eng.play()
        assert started is False
        assert "unmapped" in eng.last_error.lower()
        assert eng.show_state.state != PlaybackState.PLAYING
        await eng.stop()
    asyncio.run(run())
