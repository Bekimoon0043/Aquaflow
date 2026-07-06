"""
AF-HUB-007B — Runtime health monitoring.

The RuntimeHealthMonitor aggregates every runtime subsystem into one verdict
(ok / degraded / critical) with the specific reasons. These tests prove the verdict
logic, that one broken subsystem getter degrades gracefully instead of crashing the
health check, and that the app's shared monitor + /api/health are wired to it.
"""
import asyncio

from services.runtime_health import RuntimeHealthMonitor, OK, DEGRADED, CRITICAL


class _Fake:
    def __init__(self, status):
        self._status = status
    def get_status(self):
        return self._status


class _FakeDevices:
    def __init__(self, summary):
        self._summary = summary
    def get_summary(self):
        return self._summary


class _FakeEngine:
    def __init__(self, state):
        self._state = state
    def get_state(self):
        return self._state


def _healthy_monitor():
    m = RuntimeHealthMonitor()
    m.register(
        safety=_Fake({"state": "SAFE_IDLE", "permit": True, "active_faults": [],
                      "inputs": {"plc_heartbeat_ok": True, "estop_chain_closed": True,
                                 "water_level_ok": True, "pressure_ok": True}}),
        protocol_bus=_Fake({"running": True, "drivers": {"artnet": {"connected": True, "protocol": "artnet"}}}),
        device_manager=_FakeDevices({"total": 3, "online": 3, "offline": 0, "warn": 0}),
        show_engine=_FakeEngine({"state": "stopped", "hardware_conflicts": [], "error": ""}),
    )
    return m


def test_all_green_is_ok():
    snap = _healthy_monitor().snapshot()
    assert snap["status"] == OK
    assert snap["healthy"] is True
    assert snap["issues"] == []
    assert snap["subsystems"]["protocol_bus"]["connected"] == 1


def test_hardware_conflict_is_critical():
    m = _healthy_monitor()
    m.register(show_engine=_FakeEngine(
        {"state": "stopped", "hardware_conflicts": ["DMX U1 Ch1 shared by a,b"], "error": ""}))
    snap = m.snapshot()
    assert snap["status"] == CRITICAL
    assert any(i["subsystem"] == "show_engine" and "conflict" in i["message"].lower()
               for i in snap["issues"])


def test_emergency_stop_and_plc_loss_are_critical():
    m = _healthy_monitor()
    m.register(safety=_Fake({"state": "EMERGENCY_STOP", "active_faults": ["ESTOP_OPEN"],
                             "inputs": {"plc_heartbeat_ok": False, "estop_chain_closed": False}}))
    snap = m.snapshot()
    assert snap["status"] == CRITICAL
    msgs = " ".join(i["message"] for i in snap["issues"])
    assert "Emergency stop" in msgs and "PLC heartbeat" in msgs and "E-stop chain" in msgs


def test_offline_devices_and_no_drivers_are_degraded_not_critical():
    m = _healthy_monitor()
    m.register(
        device_manager=_FakeDevices({"total": 4, "online": 2, "offline": 2, "warn": 0}),
        protocol_bus=_Fake({"running": True, "drivers": {}}),
    )
    snap = m.snapshot()
    assert snap["status"] == DEGRADED
    subs = {i["subsystem"] for i in snap["issues"]}
    assert "devices" in subs and "protocol_bus" in subs


def test_worst_severity_wins():
    m = _healthy_monitor()
    m.register(
        device_manager=_FakeDevices({"total": 2, "online": 1, "offline": 1, "warn": 0}),  # degraded
        show_engine=_FakeEngine({"state": "stopped", "hardware_conflicts": ["x"], "error": ""}),  # critical
    )
    assert m.snapshot()["status"] == CRITICAL


def test_broken_subsystem_getter_degrades_not_crashes():
    class _Broken:
        def get_status(self):
            raise RuntimeError("driver exploded")
    m = _healthy_monitor()
    m.register(protocol_bus=_Broken())
    snap = m.snapshot()  # must not raise
    assert snap["status"] in (DEGRADED, CRITICAL)
    assert any("Health read failed" in i["message"] for i in snap["issues"])


def test_unregistered_subsystem_is_marked_not_crashed():
    m = RuntimeHealthMonitor()  # nothing registered
    snap = m.snapshot()
    assert snap["subsystems"]["safety"] == {"registered": False}
    # commissioning has no registration gate — it always reports
    assert "commissioning" in snap["subsystems"]


# ── App wiring ──────────────────────────────────────────────────────────────────

def test_app_state_registers_the_monitor():
    from app_state import runtime_health
    snap = runtime_health.snapshot()
    assert "status" in snap and "subsystems" in snap
    # core actors wired at import
    assert "show_engine" in snap["subsystems"]
    assert "protocol_bus" in snap["subsystems"]
    assert "devices" in snap["subsystems"]


def test_health_endpoint_reports_the_runtime_verdict():
    from main import health
    result = asyncio.run(health())
    assert result["api"] == "ok"
    assert "runtime_health" in result
    assert result["status"] == result["runtime_health"]["status"]
