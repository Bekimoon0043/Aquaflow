"""
validate_analytics_engine.py — AQ-S4-003 verification

Verifies the usage analytics engine:
  1. anonymous usage collected (session hashed, PII stripped, consent-gated),
  2. feature statistics collected (per-feature count + unique sessions),
  3. adoption metrics available (active-session windows + per-feature adoption rate).

Run:  python backend/validate_analytics_engine.py   (from the aquaflow/ dir)
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
from services.analytics_engine import (
    AnalyticsEngine, anonymise_id, sanitise_properties,
)

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


root = Path(tempfile.mkdtemp()) / "analytics"
eng = AnalyticsEngine(root)

print("== 1. anonymous usage collected ==")
r = eng.track("panel_open", {"panel": "hydraulics", "duration_ms": 1200}, session_id="operator@site.com")
check("event tracked", r["tracked"] is True)
check("session id is hashed, not the raw email",
      r["session"] == anonymise_id("operator@site.com") and "@" not in r["session"], r["session"])
# PII in properties is stripped; identifier values are hashed.
eng.track("login", {"email": "bob@x.com", "user_name": "Bob", "user_id": "u-42", "role": "operator"},
          session_id="s1")
ev = eng.events()[-1]
check("PII property keys dropped", "email" not in ev["props"] and "user_name" not in ev["props"], str(ev["props"]))
check("identifier value hashed", ev["props"].get("user_id") == anonymise_id("u-42"))
check("non-PII property kept", ev["props"].get("role") == "operator")
check("raw traceback/no-PII invariant: no '@' anywhere in stored props",
      not any("@" in str(v) for v in ev["props"].values()))

# Consent gating.
eng.set_consent(False)
blocked = eng.track("panel_open", {"panel": "bom"}, session_id="s2")
check("no collection without consent", blocked["tracked"] is False)
check("consent state persists", AnalyticsEngine(root).consent is False)
eng.set_consent(True)

print("== 2. feature statistics collected ==")
eng.clear(); eng.set_consent(True)
for s in ("s1", "s2", "s3"):
    eng.track("panel_open", {"panel": "hydraulics"}, session_id=s)
eng.track("panel_open", {"panel": "hydraulics"}, session_id="s1")   # repeat by s1
eng.track("export_dxf", {}, session_id="s1")
stats = {f["feature"]: f for f in eng.feature_stats()}
check("panel_open counted 4 times", stats["panel_open"]["count"] == 4, str(stats["panel_open"]["count"]))
check("panel_open has 3 unique sessions", stats["panel_open"]["unique_sessions"] == 3)
check("export_dxf tracked once", stats["export_dxf"]["count"] == 1)
check("feature stats sorted by count", eng.feature_stats()[0]["feature"] == "panel_open")

print("== 3. adoption metrics available ==")
# 4 sessions; hydraulics used by 3 → 75% adoption. Spread events across days for windows.
eng.clear()
now = datetime.now(timezone.utc)
def iso(d): return (now - timedelta(days=d)).isoformat()
eng.track("panel_open", {"panel": "hydraulics"}, session_id="a", timestamp=iso(0))
eng.track("panel_open", {"panel": "hydraulics"}, session_id="b", timestamp=iso(0))
eng.track("panel_open", {"panel": "hydraulics"}, session_id="c", timestamp=iso(10))
eng.track("open_app", {}, session_id="d", timestamp=iso(40))
m = eng.adoption_metrics()
check("total sessions = 4", m["total_sessions"] == 4, str(m["total_sessions"]))
check("DAU = 2 (today's sessions)", m["active"]["dau"] == 2, str(m["active"]["dau"]))
check("WAU = 2 (last 7 days)", m["active"]["wau"] == 2, str(m["active"]["wau"]))
check("MAU = 3 (last 30 days)", m["active"]["mau"] == 3, str(m["active"]["mau"]))
hy = next(f for f in m["feature_adoption"] if f["feature"] == "panel_open")
check("hydraulics adoption rate = 0.75 (3 of 4 sessions)", abs(hy["adoption_rate"] - 0.75) < 1e-9,
      str(hy["adoption_rate"]))
check("top features present", m["top_features"][0]["feature"] == "panel_open")
check("summary reports unique feature count", eng.summary()["unique_features"] == 2)

print("== 4. sanitisation unit ==")
clean = sanitise_properties({"panel": "weather", "ip": "10.0.0.1", "install_id": "abc", "count": 5})
check("ip dropped, install_id hashed, count kept",
      "ip" not in clean and clean["install_id"] == anonymise_id("abc") and clean["count"] == 5, str(clean))

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
