"""
validate_asset_cloud.py — AQ-S5-005 verification

Scenarios for the Global Asset Cloud:
  1. cloud backups work (versioned, checksummed, restore round-trip, corruption caught,
     retention),
  2. multi-company support (tenant isolation — assets/backups/diagnostics never leak),
  3. remote diagnostics (report status → run a full remote bundle with recommendations).

Run:  python backend/validate_asset_cloud.py   (from the aquaflow/ dir)
"""
import json
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
from services.asset_cloud import AssetCloud, CloudError

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

LIVE = {"safety": {"state": "LIVE", "permit": True, "active_faults": [], "inputs": {"plc_heartbeat_ok": True}},
        "transport": {"state": "PLAYING", "position_ms": 5000, "duration_ms": 10000}}
ESTOP = {"safety": {"state": "EMERGENCY_STOP", "permit": False, "active_faults": ["ESTOP_OPEN"],
                    "inputs": {"plc_heartbeat_ok": True}}}

cloud = AssetCloud(Path(tempfile.mkdtemp()) / "cloud")

print("== 2. multi-company support ==")
cloud.register_company("acme", "ACME Fountains", plan="enterprise")
cloud.register_company("globex", "Globex Water")
check("two companies registered", len(cloud.list_companies()) == 2)
check("company metadata read back", cloud.get_company("acme")["name"] == "ACME Fountains")
check("registering for backup under unknown company errors",
      _err(lambda: cloud.create_backup("nobody", "assetX", {"a": 1})))

print("== 1. cloud backups work ==")
design_v1 = {"name": "Dubai Show", "jets": [1, 2, 3], "tempo": 120}
b1 = cloud.create_backup("acme", "dubai-show", design_v1, label="initial", timestamp=t(0))
check("first backup is version 1", b1["version"] == 1)
check("backup records a checksum", len(b1["checksum"]) == 64)
design_v2 = {"name": "Dubai Show", "jets": [1, 2, 3, 4], "tempo": 128}
b2 = cloud.create_backup("acme", "dubai-show", design_v2, label="added jet", timestamp=t(10))
check("second backup increments version", b2["version"] == 2)
restored = cloud.restore_backup("acme", b2["backup_id"])
check("restore returns the exact stored data", restored["data"] == design_v2)
check("restore verifies integrity", restored["verified"] is True)
latest = cloud.latest_backup("acme", "dubai-show")
check("latest_backup returns the newest version", latest["version"] == 2 and latest["data"] == design_v2)
check("list_backups lists both versions", len(cloud.list_backups("acme", "dubai-show")) == 2)

# corruption is caught
bpath = cloud._backups_dir("acme") / f"{b1['backup_id']}.json"
rec = json.loads(bpath.read_text(encoding="utf-8"))
rec["data"]["tempo"] = 999                       # tamper without updating checksum
bpath.write_text(json.dumps(rec), encoding="utf-8")
check("corrupted backup fails checksum on restore",
      _err(lambda: cloud.restore_backup("acme", b1["backup_id"])))

# retention: keep only the newest RETENTION_PER_ASSET versions
for i in range(15):
    cloud.create_backup("acme", "many", {"v": i}, timestamp=t(100 + i))
kept = cloud.list_backups("acme", "many")
check("retention prunes to 10 versions", len(kept) == 10, str(len(kept)))
check("retention keeps the newest versions", max(b["version"] for b in kept) == 15)

print("== 2b. tenant isolation ==")
cloud.create_backup("globex", "dubai-show", {"name": "different company"}, timestamp=t(0))
check("globex cannot see acme's backups",
      all(b["asset_id"] != "dubai-show" or b["backup_id"] != b2["backup_id"]
          for b in cloud.list_backups("globex")))
check("acme's asset count is isolated", len(cloud.list_backups("acme", "dubai-show")) == 2)
check("cross-tenant restore is refused",
      _err(lambda: cloud.restore_backup("globex", b2["backup_id"])))

print("== 3. remote diagnostics ==")
cloud.report_diagnostics("acme", "dubai-mall", LIVE, site_name="Dubai Mall", timestamp=t(0))
cloud.report_diagnostics("acme", "marina", ESTOP, site_name="Marina Bay", timestamp=t(0))
diag = cloud.run_remote_diagnostic("acme", "marina", now=t(1))
check("remote diagnostic reports estop health", diag["health"] == "estop")
check("remote diagnostic surfaces the estop alert",
      any(a["code"] == "ESTOP" for a in diag["alerts"]))
check("remote diagnostic recommends a technician",
      any("technician" in r.lower() for r in diag["recommendations"]))
check("remote diagnostic is reachable when recent", diag["reachable"] is True)
stale = cloud.run_remote_diagnostic("acme", "dubai-mall", now=t(1000))
check("site goes unreachable after the timeout", stale["reachable"] is False)
check("unreachable site is flagged in recommendations",
      any("unreachable" in r.lower() for r in stale["recommendations"]))
listed = cloud.list_diagnostics("acme", now=t(1))
check("diagnostics list is scoped to the company", len(listed) == 2)
check("running diagnostics for an unreported site errors",
      _err(lambda: cloud.run_remote_diagnostic("acme", "ghost", now=t(1))))
check("diagnostics under another tenant are isolated", len(cloud.list_diagnostics("globex")) == 0)

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
