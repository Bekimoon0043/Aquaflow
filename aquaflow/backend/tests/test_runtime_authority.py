"""
AF-HUB-006B — Runtime authority consolidation.

The single RuntimeAuthority is the one coordinator for stopping all hardware output.
These tests prove one call halts EVERY registered subsystem, tolerates a failing/absent
subsystem, and that the real E-stop entry points now route through it (closing the old
safety hole where each entry point stopped a different incomplete subset).
"""
import asyncio

import pytest

from engine.runtime_authority import RuntimeAuthority


class _Recorder:
    """Fake output actor recording which safe-state method fired, in order."""
    def __init__(self, log, name, methods, fail=None):
        self._log = log
        self._name = name
        self._fail = fail
        for m in methods:
            setattr(self, m, self._make(m))

    def _make(self, method):
        async def _call(*args):
            self._log.append((self._name, method))
            if self._fail == method:
                raise RuntimeError(f"{self._name}.{method} boom")
        return _call


def _authority_with(log, **fail):
    a = RuntimeAuthority()
    a.register(
        safety=_SyncSafety(log, fail.get("safety")),
        show_engine=_Recorder(log, "show_engine", ["emergency_stop"], fail.get("show_engine")),
        protocol_bus=_Recorder(log, "protocol_bus", ["emergency_stop", "blackout"], fail.get("protocol_bus")),
        hardware_output=_Recorder(log, "hardware_output", ["blackout_all"], fail.get("hardware_output")),
    )
    return a


class _SyncSafety:
    """Safety kernel's emergency_stop is synchronous in the real code — prove _invoke
    handles a sync callable too."""
    def __init__(self, log, fail=None):
        self._log = log
        self._fail = fail
    def emergency_stop(self, source="operator"):
        self._log.append(("safety", "emergency_stop"))
        if self._fail == "emergency_stop":
            raise RuntimeError("safety boom")


def test_emergency_stop_halts_every_registered_subsystem_in_order():
    log = []
    a = _authority_with(log)
    trip = asyncio.run(a.emergency_stop(source="test"))

    # order: safety first (latch), then show engine, protocol bus, hardware output
    assert log == [
        ("safety", "emergency_stop"),
        ("show_engine", "emergency_stop"),
        ("protocol_bus", "emergency_stop"),
        ("hardware_output", "blackout_all"),
    ]
    assert trip["source"] == "test"
    assert trip["kind"] == "emergency_stop"
    assert all(v == "ok" for k, v in trip["results"].items() if k != "device_manager")
    # device_manager was never registered
    assert trip["results"]["device_manager"] == "unregistered"


def test_one_failing_subsystem_never_blocks_the_others():
    log = []
    a = _authority_with(log, protocol_bus="emergency_stop")
    trip = asyncio.run(a.emergency_stop())

    # hardware_output (which comes AFTER the failing protocol_bus) still fired
    assert ("hardware_output", "blackout_all") in log
    assert trip["results"]["protocol_bus"].startswith("error:")
    assert trip["results"]["hardware_output"] == "ok"
    assert trip["results"]["show_engine"] == "ok"


def test_device_manager_without_estop_is_skipped_not_crashed():
    """The real DeviceManager has no emergency_stop — the old WS handler raised
    AttributeError here; the authority must skip it gracefully."""
    log = []
    a = _authority_with(log)

    class _NoEstop:
        async def stop(self):
            pass
    a.register(device_manager=_NoEstop())

    trip = asyncio.run(a.emergency_stop())
    assert trip["results"]["device_manager"] == "skipped (no emergency_stop)"


def test_blackout_only_zeroes_physical_outputs():
    log = []
    a = _authority_with(log)
    trip = asyncio.run(a.blackout(source="dmx"))
    assert log == [("protocol_bus", "blackout"), ("hardware_output", "blackout_all")]
    assert trip["kind"] == "blackout"
    # blackout must NOT trip the safety latch or stop the show engine
    assert ("safety", "emergency_stop") not in log
    assert ("show_engine", "emergency_stop") not in log


def test_get_status_reports_registration_and_last_trip():
    log = []
    a = _authority_with(log)
    assert a.get_status()["last_trip"] is None
    asyncio.run(a.emergency_stop(source="status-test"))
    st = a.get_status()
    assert st["registered"]["protocol_bus"] is True
    assert st["registered"]["device_manager"] is False
    assert st["last_trip"]["source"] == "status-test"


# ── Integration: the app's shared authority + real routes ───────────────────────

def test_app_state_registers_core_output_actors():
    from app_state import runtime_authority
    reg = runtime_authority.get_status()["registered"]
    assert reg["show_engine"] and reg["protocol_bus"] and reg["device_manager"]
    assert reg["hardware_output"], "hardware output not registered with the authority"


def test_shared_authority_stops_the_real_show_engine():
    from app_state import runtime_authority, show_engine
    from engine.show_engine import PlaybackState

    async def run():
        show_engine.load_show({"currentShow": {"id": "estop", "name": "E"}, "fixtures": []})
        started = await show_engine.play()
        assert started is True
        await runtime_authority.emergency_stop(source="integration")
        assert show_engine.show_state.state == PlaybackState.STOPPED

    asyncio.run(run())


def test_rest_emergency_stop_route_uses_the_authority():
    from app_state import runtime_authority
    from api.routes.devices import emergency_stop, dmx_blackout

    res = asyncio.run(emergency_stop())
    assert res["status"] == "emergency_stop_executed"
    assert runtime_authority.get_status()["last_trip"]["source"] == "rest-devices"

    res2 = asyncio.run(dmx_blackout())
    assert res2["status"] == "blackout"
    assert runtime_authority.get_status()["last_trip"]["kind"] == "blackout"
