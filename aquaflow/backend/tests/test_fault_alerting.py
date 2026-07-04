"""
Contract tests for Fault Alerting + Maintenance Log (AQ-X-005).

Asserts the three acceptance criteria:
  1. fault alerts trigger correctly (raise / ack / clear + live safety-kernel ingest),
  2. the maintenance log persists to disk and reloads,
  3. alert escalation advances by time and by recurrence (and ack freezes it).
"""
from pathlib import Path

from services.fault_alerting import (
    FaultAlertEngine, MaintenanceLog, RECUR_ESCALATION_THRESHOLD, get_fault_engine,
)


def _engine(tmp_path, name="m.json"):
    return FaultAlertEngine(log=MaintenanceLog(Path(tmp_path) / name))


# ── 1. alerts trigger correctly ───────────────────────────────────────────────

def test_raise_ack_clear(tmp_path):
    eng = _engine(tmp_path)
    eng.raise_fault("OVER_PRESSURE", severity="critical", now=0.0)
    eng.raise_fault("PLC_COMM_LOSS", severity="warning", now=0.0)
    active = eng.active(now=0.0)
    assert [a["code"] for a in active] == ["OVER_PRESSURE", "PLC_COMM_LOSS"]  # critical first
    assert eng.acknowledge("PLC_COMM_LOSS", by="alice", now=1.0) is True
    assert eng.get("PLC_COMM_LOSS").acknowledged_by == "alice"
    assert eng.unacknowledged_count() == 1
    assert eng.clear_fault("PLC_COMM_LOSS", now=2.0) is True
    assert len(eng.active(now=2.0)) == 1


def test_reraise_counts_occurrences_and_reopens(tmp_path):
    eng = _engine(tmp_path)
    eng.raise_fault("VFD_FAULT", severity="warning", now=0.0)
    eng.raise_fault("VFD_FAULT", severity="critical", now=1.0)   # re-raise bumps severity
    a = eng.get("VFD_FAULT")
    assert a.occurrences == 2
    assert a.severity == "critical"
    eng.clear_fault("VFD_FAULT", now=2.0)
    eng.raise_fault("VFD_FAULT", now=3.0)                        # reopens
    assert eng.get("VFD_FAULT").cleared is False
    assert eng.get("VFD_FAULT").occurrences == 3


def test_ingest_status_raises_and_clears(tmp_path):
    eng = _engine(tmp_path)
    status = {"safety": {"state": "FAULT", "active_faults": ["THERMAL_OVERLOAD"],
                         "inputs": {"water_level_ok": False}}}
    codes = {a["code"] for a in eng.ingest_status(status, now=0.0)}
    assert {"THERMAL_OVERLOAD", "LOW_WATER"} <= codes
    # condition resolves → alerts clear
    eng.ingest_status({"safety": {"state": "SAFE_IDLE", "active_faults": [], "inputs": {}}}, now=5.0)
    assert eng.active(now=5.0) == []


# ── 2. maintenance log persists ───────────────────────────────────────────────

def test_maintenance_log_persists_across_instances(tmp_path):
    path = Path(tmp_path) / "log.json"
    eng = FaultAlertEngine(log=MaintenanceLog(path))
    eng.raise_fault("LOW_WATER", severity="critical", now=0.0)
    eng.acknowledge("LOW_WATER", by="bob", now=1.0)
    eng.log.record_maintenance("Topped up reservoir", component="reservoir",
                               performed_by="bob", downtime_min=15, now=2.0)
    assert path.exists()
    # brand-new log object on the same file sees everything
    reloaded = MaintenanceLog(path)
    assert reloaded.count() == eng.log.count()
    maint = reloaded.entries(entry_type="maintenance")
    assert len(maint) == 1
    assert maint[0]["meta"]["performed_by"] == "bob"
    assert {e["type"] for e in reloaded.entries()} >= {"raised", "acknowledged", "maintenance"}


def test_log_entries_filter_and_order(tmp_path):
    log = MaintenanceLog(Path(tmp_path) / "l.json")
    log.append("raised", code="A", now=0.0)
    log.append("raised", code="B", now=1.0)
    log.append("cleared", code="A", now=2.0)
    assert [e["code"] for e in log.entries(entry_type="raised")] == ["B", "A"]  # newest first
    assert len(log.entries(code="A")) == 2
    assert len(log.entries(limit=1)) == 1


# ── 3. escalation ─────────────────────────────────────────────────────────────

def test_time_escalation_tiers(tmp_path):
    eng = _engine(tmp_path)
    eng.raise_fault("VFD_FAULT", severity="warning", now=0.0)
    eng.evaluate_escalations(now=10.0)
    assert eng.get("VFD_FAULT").escalation_level == 0
    eng.evaluate_escalations(now=70.0)
    assert eng.get("VFD_FAULT").escalation_level == 1
    assert eng.get("VFD_FAULT").notify == "supervisor"
    eng.evaluate_escalations(now=310.0)
    a = eng.get("VFD_FAULT")
    assert a.escalation_level == 2 and a.notify == "on_call"
    assert a.severity == "critical"          # top tier forces critical


def test_acknowledge_freezes_escalation(tmp_path):
    eng = _engine(tmp_path)
    eng.raise_fault("VALVE_TIMEOUT", severity="warning", now=0.0)
    eng.acknowledge("VALVE_TIMEOUT", now=1.0)
    eng.evaluate_escalations(now=100000.0)
    assert eng.get("VALVE_TIMEOUT").escalation_level == 0


def test_recurrence_escalation(tmp_path):
    eng = _engine(tmp_path)
    for i in range(RECUR_ESCALATION_THRESHOLD):
        eng.raise_fault("PUMP_DRY_RUN", severity="critical", now=float(i))
    eng.evaluate_escalations(now=5.0)        # time tier not reached, recurrence is
    assert eng.get("PUMP_DRY_RUN").escalation_level == 1


def test_escalation_events_are_logged(tmp_path):
    eng = _engine(tmp_path)
    eng.raise_fault("VFD_FAULT", severity="warning", now=0.0)
    eng.evaluate_escalations(now=70.0)
    esc = eng.log.entries(entry_type="escalated")
    assert len(esc) == 1 and esc[0]["meta"]["notify"] == "supervisor"


def test_summary_counts(tmp_path):
    eng = _engine(tmp_path)
    eng.raise_fault("OVER_PRESSURE", severity="critical", now=0.0)
    eng.raise_fault("PLC_COMM_LOSS", severity="warning", now=0.0)
    eng.evaluate_escalations(now=70.0)
    s = eng.summary(now=70.0)
    assert s["active"] == 2
    assert s["critical"] >= 1
    assert s["escalated"] >= 1
    assert s["maintenance_entries"] >= 2


def test_singleton():
    assert get_fault_engine() is get_fault_engine()
