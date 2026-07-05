"""
validate_fix_strategy.py — EVAL-AQ-002 verification

Checks the Fix Strategy engine against the PASS conditions from the task spec:
  * every issue has a fix approach (fix_strategy with the required template),
  * every issue has a priority band,
  * every issue has an effort estimate,
  * all P0/P1 issues appear first in the queue,
  * every fix has acceptance criteria,
  * every fix has a test plan,
  * every hardware/safety issue has a safety gate,
and additionally that the engine is deterministic and its scoring/override rules behave.

Run:  python backend/validate_fix_strategy.py   (from the aquaflow/ dir)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services import fix_strategy_engine as fse

_passed = 0
_failed = 0


def check(label, cond, detail=""):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  ok   {label}")
    else:
        _failed += 1
        print(f"  FAIL {label}" + (f"  [{detail}]" if detail else ""))


ROOT = fse.find_repo_root()
REPORT = os.path.join(ROOT, "EVALUATION_REPORT.md")
with open(REPORT, "r", encoding="utf-8") as fh:
    REPORT_TEXT = fh.read()

issues = fse.build_fix_strategy(REPORT_TEXT)
band_rank = {b: i for i, b in enumerate(fse.PRIORITY_BANDS)}

print("== 1. every issue extracted and normalized ==")
check("at least 7 issues extracted from the report", len(issues) >= 7, f"{len(issues)}")
check("issue ids are sequential AQ-FIX-00N",
      [i.issue_id for i in issues] == [f"AQ-FIX-{n:03d}" for n in range(1, len(issues) + 1)])

print("== 2. every issue has a fix approach ==")
for i in issues:
    ok = all(h in i.fix_strategy for h in
             ("## Fix Approach", "### Root Cause", "### Required Change",
              "### Implementation Logic", "### Files Likely Affected",
              "### Acceptance Criteria", "### Test Plan", "### Rollback Plan"))
    check(f"{i.issue_id} has full fix-approach template", ok)
    check(f"{i.issue_id} root cause is non-trivial", len(i.root_cause) > 20)

print("== 3. every issue has a priority band ==")
for i in issues:
    check(f"{i.issue_id} priority band valid", i.priority_band in fse.PRIORITY_BANDS,
          i.priority_band)

print("== 4. every issue has an effort estimate ==")
for i in issues:
    check(f"{i.issue_id} effort band + score + hours",
          i.effort_band in fse.EFFORT_PENALTY and i.effort_score > 0 and i.effort_person_hours > 0,
          f"{i.effort_band}/{i.effort_score}/{i.effort_person_hours}")

print("== 5. queue ordered by priority (P0/P1 first, non-decreasing band) ==")
ranks = [band_rank[i.priority_band] for i in issues]
check("priority bands are non-decreasing down the queue", ranks == sorted(ranks), str(ranks))
first_non_p0p1 = next((n for n, i in enumerate(issues)
                       if i.priority_band not in ("P0", "P1")), len(issues))
check("no P0/P1 appears after a lower-priority issue",
      all(i.priority_band in ("P0", "P1") for i in issues[:first_non_p0p1]))

print("== 6. every fix has acceptance criteria (>=3) and a test plan (>=1) ==")
for i in issues:
    check(f"{i.issue_id} >=3 acceptance criteria", len(i.acceptance_criteria) >= 3,
          str(len(i.acceptance_criteria)))
    check(f"{i.issue_id} >=1 test-plan step", len(i.test_plan) >= 1)
    check(f"{i.issue_id} >=1 rollback step", len(i.rollback_plan) >= 1)

print("== 7. every hardware/safety issue has a safety gate ==")
hw = [i for i in issues if fse._is_hardware_or_safety(i)]
check("at least one hardware/safety issue found", len(hw) >= 1, f"{len(hw)}")
for i in hw:
    check(f"{i.issue_id} carries a safety gate", bool(i.safety_gate))
    check(f"{i.issue_id} safety-gate acceptance mentions _safety_gate",
          any("_safety_gate" in c for c in i.acceptance_criteria))
    check(f"{i.issue_id} is at least P1", band_rank[i.priority_band] <= band_rank["P1"],
          i.priority_band)
# and non-hardware issues must NOT carry a spurious safety gate
for i in issues:
    if not fse._is_hardware_or_safety(i):
        check(f"{i.issue_id} (non-hw) has no safety gate", not i.safety_gate)

print("== 8. mandatory overrides + physical-hardware handling ==")
p0 = [i for i in issues if i.priority_band == "P0"]
check("physical-hardware verification is P0", any("hardware" in i.title.lower() for i in p0),
      str([i.title for i in p0]))
check("the P0 issue records an override reason", all(i.override_reason for i in p0))
merged = [i for i in issues if "§3" in i.source and "§5" in i.source]
check("duplicate hardware entries merged by root cause (edge case 7)", len(merged) >= 1)

print("== 9. determinism (same input → identical queue) ==")
again = fse.build_fix_strategy(REPORT_TEXT)
check("re-run yields identical ids/bands/effort",
      [(i.issue_id, i.priority_band, i.effort_band) for i in issues]
      == [(i.issue_id, i.priority_band, i.effort_band) for i in again])

print("== 10. exporters produce non-empty, parseable artifacts ==")
import json as _json
js = fse.export_fix_strategy_json(issues)
parsed = _json.loads(js)
check("json exporter parses and carries the queue", parsed["issue_count"] == len(issues))
check("json carries release_readiness verdict", "verdict" in parsed["release_readiness"])
csv_text = fse.export_fix_strategy_acceptance_matrix(issues)
check("csv has a header + one row per issue",
      len(csv_text.strip().splitlines()) == len(issues) + 1)
md = fse.export_fix_strategy_markdown(issues)
check("markdown has the required output table header", "| ID | Issue |" in md)
check("markdown lists a CEO escalation section", "CEO Escalation Flags" in md)

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
