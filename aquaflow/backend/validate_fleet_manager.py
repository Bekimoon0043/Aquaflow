"""
validate_fleet_manager.py — AQ-S5-004 verification

Scenarios for the fleet management system:
  1. multiple sites monitored (register + report status + offline detection),
  2. central dashboard (site counts, online/offline, health breakdown),
  3. centralised alerts (merged, attributed, severity-ranked, acknowledgeable).

Run:  python backend/validate_fleet_manager.py   (from the aquaflow/ dir)
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
from services.fleet_manager import FleetManager

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


def _err(fn):
    try:
        fn()
        return False
    except Exception:
        return True


base = datetime(2026, 7, 5, 12, 0, tzinfo=timezone.utc)
def t(sec): return (base + timedelta(seconds=sec)).isoformat()

# A healthy playing site, and an E-stopped site.
LIVE = {"safety": {"state": "LIVE", "permit": True, "active_faults": [], "inputs": {"plc_heartbeat_ok": True}},
        "transport": {"state": "PLAYING", "position_ms": 5000, "duration_ms": 10000}}
ESTOP = {"safety": {"state": "EMERGENCY_STOP", "permit": False, "active_faults": ["ESTOP_OPEN"],
                    "inputs": {"plc_heartbeat_ok": True}}}

fm = FleetManager(Path(tempfile.mkdtemp()) / "fleet")

print("== 1. multiple sites monitored ==")
fm.register_site("dubai-mall", "Dubai Mall Fountain", "Dubai")
fm.register_site("marina-bay", "Marina Bay", "Singapore")
fm.register_site("vegas", "Bellagio", "Las Vegas")
fm.report_status("dubai-mall", LIVE, timestamp=t(0))
fm.report_status("marina-bay", ESTOP, timestamp=t(0))
# vegas never reports → offline.
check("three sites registered", len(fm._all()) == 3)
check("live site reports healthy", fm.get_site("dubai-mall", now=t(1))["snapshot"]["health"] == "live")
check("estop site reports estop", fm.get_site("marina-bay", now=t(1))["snapshot"]["health"] == "estop")
check("never-reported site is offline", fm.get_site("vegas", now=t(1))["online"] is False)
check("reporting for an unknown site errors",
      _err(lambda: fm.report_status("nope", LIVE)) )

print("== 1b. offline detection ==")
check("recently-reported site is online", fm.get_site("dubai-mall", now=t(60))["online"] is True)
check("site goes offline after the timeout", fm.get_site("dubai-mall", now=t(200))["online"] is False)

print("== 2. central dashboard ==")
d = fm.dashboard(now=t(1))
check("dashboard counts all sites", d["site_count"] == 3)
check("dashboard counts online/offline", d["online"] == 2 and d["offline"] == 1,
      f'online={d["online"]}, offline={d["offline"]}')
check("health breakdown has live + estop + offline",
      d["health"]["live"] == 1 and d["health"]["estop"] == 1 and d["health"]["offline"] == 1,
      str(d["health"]))
check("dashboard lists per-site rows", len(d["sites"]) == 3)
check("critical alerts counted", d["critical_alerts"] >= 1, str(d["critical_alerts"]))

print("== 3. centralised alerts ==")
alerts = fm.central_alerts(now=t(1))
codes = {(a["site_id"], a["code"]) for a in alerts}
check("estop site's ESTOP alert is centralised", any(c == ("marina-bay", "ESTOP") for c in codes),
      str([a["code"] for a in alerts]))
check("offline site raises a SITE_OFFLINE alert", any(c == ("vegas", "SITE_OFFLINE") for c in codes))
check("alerts carry the site attribution", all("site_name" in a for a in alerts))
check("critical alerts sort before warnings",
      alerts[0]["severity"] == "critical" if alerts else False)
# Acknowledge the E-stop alert.
fm.acknowledge("marina-bay", "ESTOP")
alerts2 = fm.central_alerts(now=t(1))
estop_alert = next(a for a in alerts2 if a["site_id"] == "marina-bay" and a["code"] == "ESTOP")
check("alert can be acknowledged", estop_alert["acknowledged"] is True)

print("== 3b. recovery clears alerts ==")
fm.report_status("marina-bay", LIVE, timestamp=t(2))
after = fm.central_alerts(now=t(3))
check("cleared site no longer raises ESTOP",
      not any(a["site_id"] == "marina-bay" and a["code"] == "ESTOP" for a in after))
check("ack dropped when the alert clears", fm._load("marina-bay")["acks"] == [])

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
