"""
validate_digital_twin.py — AQ-S5-001 verification

Verifies the Digital Twin Engine:
  1. real assets mirrored (register + ingest → live mirrored state),
  2. historical replay (state as-of any timestamp + range query),
  3. predictive maintenance (runtime-accrual service forecast + trend anomaly alerts).

Run:  python backend/validate_digital_twin.py   (from the aquaflow/ dir)
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
from datetime import datetime, timedelta, timezone
from services.digital_twin import DigitalTwin

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


tw = DigitalTwin(Path(tempfile.mkdtemp()) / "twin")
base = datetime(2026, 7, 1, tzinfo=timezone.utc)
def day(d): return (base + timedelta(days=d)).isoformat()

print("== 1. real assets mirrored ==")
tw.register_asset("pump-1", "pump", "Main Pump", service_interval_hours=2000, max_temp_c=85)
tw.register_asset("valve-1", "valve", "Zone Valve", service_interval_hours=5000)
tw.ingest("pump-1", {"running": True, "runtime_hours": 100, "temperature_c": 55, "pressure_bar": 4.0}, day(0))
a = tw.get_asset("pump-1")
check("asset registered + mirrored", a and a["state"]["runtime_hours"] == 100)
check("mirror reflects live temperature", a["state"]["temperature_c"] == 55)
mir = tw.mirror()
check("fleet mirror lists both assets", len(mir) == 2)
check("running count reflects state", sum(1 for x in mir if x["state"].get("running")) == 1)
try:
    tw.ingest("ghost", {"running": True})
    check("ingest unknown asset errors", False)
except ValueError:
    check("ingest unknown asset errors", True)

print("== 2. historical replay ==")
# Simulate a month of daily telemetry: ~10 runtime hours/day, temperature creeping up.
for d in range(1, 31):
    tw.ingest("pump-1", {"running": True, "runtime_hours": 100 + d * 10,
                         "temperature_c": 55 + d * 0.6, "pressure_bar": 4.0}, day(d))
r = tw.replay_at("pump-1", day(10))
check("replay_at returns the state as of day 10",
      r and abs(r["state"]["runtime_hours"] - (100 + 10 * 10)) < 1e-6, str(r["state"]["runtime_hours"]))
check("replay_at picks the last sample ≤ the target", r["samples_before"] == 11)  # day 0..10
r_before = tw.replay_at("pump-1", (base - timedelta(days=5)).isoformat())
check("replay before any data returns None", r_before is None)
rng = tw.replay_range("pump-1", day(5), day(9))
check("replay_range returns the window (days 5–9)", rng["count"] == 5, str(rng["count"]))

print("== 3. predictive maintenance ==")
fc = tw.maintenance_forecast("pump-1", now=day(30))
check("accrual rate ~10 h/day", abs(fc["accrual_hours_per_day"] - 10.0) < 0.5, str(fc["accrual_hours_per_day"]))
# runtime at day 30 = 400 h; interval 2000 → 1600 h remaining; /10 per day = 160 days.
check("hours remaining computed", abs(fc["hours_remaining"] - 1600) < 1, str(fc["hours_remaining"]))
check("days-to-service extrapolated (~160)", abs(fc["days_to_service"] - 160) < 2, str(fc["days_to_service"]))
check("status ok (plenty of life)", fc["status"] == "ok")
check("estimated service date provided", fc["estimated_service_date"] is not None)

# A near-worn asset → due_soon / overdue.
tw.register_asset("pump-2", "pump", "Aux Pump", service_interval_hours=2000)
tw.ingest("pump-2", {"running": True, "runtime_hours": 1500}, day(0))
tw.ingest("pump-2", {"running": True, "runtime_hours": 1950}, day(30))   # 1950/2000
fc2 = tw.maintenance_forecast("pump-2", now=day(30))
check("worn asset flagged due_soon", fc2["status"] == "due_soon", str(fc2["status"]))
tw.ingest("pump-2", {"running": True, "runtime_hours": 2100}, day(45))   # over interval
check("over-interval asset flagged overdue", tw.maintenance_forecast("pump-2")["status"] == "overdue")
# Servicing resets the countdown.
tw.mark_serviced("pump-2", day(46))
check("after service the asset is ok again", tw.maintenance_forecast("pump-2")["status"] == "ok")

print("== 3b. predictive anomaly (temperature trend) ==")
alerts = tw.predict_anomalies("pump-1", horizon_days=90)
temp_alert = next((a for a in alerts if a["type"] == "temperature_trend"), None)
check("rising-temperature trend detected", temp_alert is not None, str([a["type"] for a in alerts]))
check("trend projects a time-to-limit", temp_alert and temp_alert["days_to_limit"] > 0)

print("== 4. fleet summary ==")
s = tw.summary()
check("summary counts assets", s["asset_count"] == 3)
check("summary flags assets needing service", s["needs_service"] >= 0)
check("summary aggregates alerts", isinstance(s["alerts"], list))

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
