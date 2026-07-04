"""
Contract tests for the Mobile Monitoring App backend (AQ-S3-009).

Asserts live monitoring snapshots, alert generation/management, and remote-command
validation against the safety state.
"""
from services.mobile_monitor import (
    build_snapshot, evaluate_alerts, AlertManager, validate_remote_command,
    build_mobile_status,
)


def _status(**over):
    s = {
        "safety": {"state": "LIVE", "permit": True, "active_faults": [],
                   "pump_enable": True, "flame_enable": False,
                   "inputs": {"water_level_ok": True, "pressure_ok": True, "plc_heartbeat_ok": True}},
        "transport": {"state": "PLAYING", "position_ms": 30000, "duration_ms": 120000, "show_id": "s1"},
        "engine": {"state": "PLAYING", "duration": 120},
        "hardware_conflicts": [],
    }
    s.update(over)
    return s


def test_snapshot_live_and_progress():
    snap = build_snapshot(_status())
    assert snap["playing"] and abs(snap["progress_pct"] - 25.0) < 1e-6
    assert snap["health"] == "live"
    assert snap["subsystems"]["pump"] is True and snap["subsystems"]["flame"] is False


def test_snapshot_health_states():
    estop = build_snapshot(_status(safety={"state": "EMERGENCY_STOP", "active_faults": ["ESTOP_OPEN"], "inputs": {}}))
    assert estop["health"] == "estop"
    idle = build_snapshot(_status(transport={"state": "STOPPED", "position_ms": 0, "duration_ms": 0}, engine={"state": "STOPPED", "duration": 0}))
    assert idle["health"] == "idle" and idle["progress_pct"] == 0.0


def test_alerts_generated_by_severity():
    assert evaluate_alerts(_status()) == []
    over = _status(safety={"state": "FAULT", "active_faults": ["OVER_PRESSURE"], "inputs": {"pressure_ok": False}})
    al = evaluate_alerts(over)
    assert any(a["code"] == "OVER_PRESSURE" and a["severity"] == "critical" for a in al)
    plc = _status(safety={"state": "LIVE", "inputs": {"plc_heartbeat_ok": False}})
    assert any(a["code"] == "PLC_COMM_LOSS" and a["severity"] == "warning" for a in evaluate_alerts(plc))
    conf = _status(hardware_conflicts=["x"])
    assert any(a["code"] == "HW_CONFLICT" for a in evaluate_alerts(conf))


def test_alert_manager_dedupe_ack_clear():
    over = _status(safety={"state": "FAULT", "active_faults": ["OVER_PRESSURE"], "inputs": {"pressure_ok": False}})
    mgr = AlertManager()
    mgr.ingest(over); mgr.ingest(over)
    assert sum(1 for a in mgr.active() if a["code"] == "OVER_PRESSURE") == 1
    assert mgr.unacknowledged_count() == 1
    assert mgr.acknowledge("OVER_PRESSURE") is True
    assert mgr.unacknowledged_count() == 0
    mgr.ingest(_status())   # resolved
    assert mgr.active() == []


def test_alert_ordering_critical_first():
    multi = _status(safety={"state": "FAULT", "active_faults": ["VALVE_TIMEOUT", "OVER_PRESSURE"],
                            "inputs": {"pressure_ok": False, "plc_heartbeat_ok": False}})
    mgr = AlertManager(); mgr.ingest(multi)
    assert mgr.active()[0]["severity"] == "critical"


def test_remote_command_validation():
    armed = _status(safety={"state": "ARMED", "permit": True, "inputs": {}})
    assert validate_remote_command("play", armed)["allowed"] is True
    assert validate_remote_command("play", _status(safety={"state": "SAFE_IDLE", "permit": False, "inputs": {}}))["allowed"] is False
    assert validate_remote_command("play", _status(safety={"state": "ARMED", "permit": True, "inputs": {}}, hardware_conflicts=["x"]))["allowed"] is False
    estop = _status(safety={"state": "EMERGENCY_STOP", "permit": False, "inputs": {}})
    assert validate_remote_command("play", estop)["allowed"] is False
    assert validate_remote_command("estop", estop)["allowed"] is True
    assert validate_remote_command("stop", estop)["allowed"] is True
    assert validate_remote_command("arm", estop)["allowed"] is False
    assert validate_remote_command("nope", armed)["allowed"] is False


def test_build_mobile_status_payload():
    out = build_mobile_status(_status(safety={"state": "FAULT", "active_faults": ["OVER_PRESSURE"], "inputs": {"pressure_ok": False}}))
    assert "snapshot" in out and out["alert_count"] >= 1 and out["unacknowledged"] >= 1
