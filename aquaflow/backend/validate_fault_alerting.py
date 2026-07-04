"""
validate_fault_alerting.py — AQ-X-005 verification

Hand-checked scenarios for fault alerting + maintenance log + escalation:
  1. fault alerts trigger correctly (raise/ack/clear, and live safety-kernel ingest),
  2. the maintenance log persists to disk and reloads in a fresh instance,
  3. alert escalation advances over time (operator → supervisor → on-call) and on
     persistent recurrence.

Run:  python backend/validate_fault_alerting.py   (from the aquaflow/ dir)
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from pathlib import Path
from services.fault_alerting import (
    FaultAlertEngine, MaintenanceLog, EscalationTier, RECUR_ESCALATION_THRESHOLD,
)

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


tmpdir = tempfile.mkdtemp()
log_path = Path(tmpdir) / "maint.json"

print("== 1. fault alerts trigger correctly ==")
eng = FaultAlertEngine(log=MaintenanceLog(log_path))
eng.raise_fault("OVER_PRESSURE", severity="critical", message="Manifold over limit", now=0.0)
eng.raise_fault("PLC_COMM_LOSS", severity="warning", now=0.0)
active = eng.active(now=0.0)
check("two alerts active", len(active) == 2, str([a["code"] for a in active]))
check("critical sorts before warning", active[0]["code"] == "OVER_PRESSURE")
check("acknowledge works", eng.acknowledge("PLC_COMM_LOSS", by="alice", now=1.0))
check("unacknowledged count drops to 1", eng.unacknowledged_count() == 1)
check("clear removes from active", eng.clear_fault("PLC_COMM_LOSS", now=2.0)
      and len(eng.active(now=2.0)) == 1)

print("== 1b. live safety-kernel ingest ==")
status = {"safety": {"state": "FAULT", "active_faults": ["THERMAL_OVERLOAD"],
                     "inputs": {"water_level_ok": False}}}
eng2 = FaultAlertEngine(log=MaintenanceLog(Path(tmpdir) / "m2.json"))
act = eng2.ingest_status(status, now=0.0)
codes = {a["code"] for a in act}
check("ingest raises THERMAL_OVERLOAD", "THERMAL_OVERLOAD" in codes, str(codes))
check("ingest raises LOW_WATER", "LOW_WATER" in codes, str(codes))
# Condition clears when it no longer holds.
eng2.ingest_status({"safety": {"state": "SAFE_IDLE", "active_faults": [], "inputs": {}}}, now=5.0)
check("cleared condition drops out of active", eng2.active(now=5.0) == [])

print("== 2. maintenance log persists ==")
eng.log.record_maintenance("Replaced pump-1 mechanical seal", component="pump-1",
                           performed_by="tech-bob", downtime_min=45, now=10.0)
raw_before = eng.log.count()
# A brand-new engine/log pointed at the same file must see all prior entries.
reloaded = MaintenanceLog(log_path)
check("log file exists on disk", log_path.exists())
check("reloaded log has same entry count", reloaded.count() == raw_before, f"{reloaded.count()}=={raw_before}")
maint = reloaded.entries(entry_type="maintenance")
check("maintenance action persisted", len(maint) == 1 and maint[0]["message"].startswith("Replaced"))
check("maintenance meta persisted", maint[0]["meta"]["performed_by"] == "tech-bob"
      and maint[0]["meta"]["downtime_min"] == 45)
check("raise/ack/clear events all logged",
      {e["type"] for e in reloaded.entries()} >= {"raised", "acknowledged", "cleared", "maintenance"})

print("== 3. alert escalation ==")
esc = FaultAlertEngine(log=MaintenanceLog(Path(tmpdir) / "m3.json"))
esc.raise_fault("VFD_FAULT", severity="warning", now=0.0)
esc.evaluate_escalations(now=10.0)
check("no escalation before first tier", esc.get("VFD_FAULT").escalation_level == 0)
esc.evaluate_escalations(now=70.0)
check("escalates to supervisor after 60s", esc.get("VFD_FAULT").escalation_level == 1
      and esc.get("VFD_FAULT").notify == "supervisor")
esc.evaluate_escalations(now=310.0)
a = esc.get("VFD_FAULT")
check("escalates to on-call after 300s", a.escalation_level == 2 and a.notify == "on_call")
check("severity bumped to critical at top tier", a.severity == "critical")

print("== 3b. acknowledge freezes escalation ==")
esc2 = FaultAlertEngine(log=MaintenanceLog(Path(tmpdir) / "m4.json"))
esc2.raise_fault("VALVE_TIMEOUT", severity="warning", now=0.0)
esc2.acknowledge("VALVE_TIMEOUT", now=1.0)
esc2.evaluate_escalations(now=1000.0)
check("acknowledged alert does not escalate on time", esc2.get("VALVE_TIMEOUT").escalation_level == 0)

print("== 3c. recurrence escalation ==")
esc3 = FaultAlertEngine(log=MaintenanceLog(Path(tmpdir) / "m5.json"))
for i in range(RECUR_ESCALATION_THRESHOLD):
    esc3.raise_fault("PUMP_DRY_RUN", severity="critical", now=float(i))
check(f"occurrence count reaches {RECUR_ESCALATION_THRESHOLD}",
      esc3.get("PUMP_DRY_RUN").occurrences == RECUR_ESCALATION_THRESHOLD)
esc3.evaluate_escalations(now=5.0)   # only 5s elapsed — time tier not reached
check("recurring fault escalates on occurrences alone",
      esc3.get("PUMP_DRY_RUN").escalation_level == 1)

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
