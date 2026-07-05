"""
Contract tests for the Fix Strategy engine (EVAL-AQ-002).

Assert the task's PASS conditions against the real EVALUATION_REPORT.md:
  1. a fix approach is designed for every issue,
  2. every issue is prioritised (band) with the P0/P1 items first,
  3. every issue has an effort estimate,
  4. every fix has acceptance criteria and a test plan,
  5. every hardware/safety issue carries a safety gate,
plus the classifier/override/effort rules and determinism.
"""
import json
import os

import pytest

from services import fix_strategy_engine as fse

BAND_RANK = {b: i for i, b in enumerate(fse.PRIORITY_BANDS)}


@pytest.fixture(scope="module")
def report_text():
    root = fse.find_repo_root()
    with open(os.path.join(root, "EVALUATION_REPORT.md"), "r", encoding="utf-8") as fh:
        return fh.read()


@pytest.fixture(scope="module")
def issues(report_text):
    return fse.build_fix_strategy(report_text)


# ── 1. extraction ─────────────────────────────────────────────────────────────

def test_issues_extracted(issues):
    assert len(issues) >= 7
    assert [i.issue_id for i in issues] == [f"AQ-FIX-{n:03d}" for n in range(1, len(issues) + 1)]


def test_physical_hardware_entries_merge(issues):
    # §3 (AQ-X-002), §4 (#2) and §5 (High #1) collapse into one hardware fix (edge case 7).
    merged = [i for i in issues if "§3" in i.source and "§5" in i.source]
    assert len(merged) == 1
    assert fse._is_hardware_or_safety(merged[0])


# ── 2. fix approach for every issue ───────────────────────────────────────────

REQUIRED_SECTIONS = (
    "## Fix Approach", "### Root Cause", "### Required Change", "### Implementation Logic",
    "### Files Likely Affected", "### Acceptance Criteria", "### Test Plan", "### Rollback Plan",
)


@pytest.mark.parametrize("section", REQUIRED_SECTIONS)
def test_every_issue_has_fix_approach(issues, section):
    assert all(section in i.fix_strategy for i in issues)


# ── 3. priority + ordering ────────────────────────────────────────────────────

def test_every_issue_has_priority_band(issues):
    assert all(i.priority_band in fse.PRIORITY_BANDS for i in issues)


def test_queue_is_priority_ordered(issues):
    ranks = [BAND_RANK[i.priority_band] for i in issues]
    assert ranks == sorted(ranks)


def test_p0_p1_appear_first(issues):
    first_lower = next((n for n, i in enumerate(issues)
                        if i.priority_band not in ("P0", "P1")), len(issues))
    assert all(i.priority_band in ("P0", "P1") for i in issues[:first_lower])


# ── 4. effort ─────────────────────────────────────────────────────────────────

def test_every_issue_has_effort(issues):
    for i in issues:
        assert i.effort_band in fse.EFFORT_PENALTY
        assert i.effort_score > 0
        assert i.effort_person_hours > 0


# ── 5. acceptance / test / rollback ───────────────────────────────────────────

def test_every_issue_has_acceptance_and_tests(issues):
    for i in issues:
        assert len(i.acceptance_criteria) >= 3
        assert len(i.test_plan) >= 1
        assert len(i.rollback_plan) >= 1


# ── 6. safety gates ───────────────────────────────────────────────────────────

def test_hardware_issues_have_safety_gate(issues):
    hw = [i for i in issues if fse._is_hardware_or_safety(i)]
    assert hw, "expected at least one hardware/safety issue"
    for i in hw:
        assert i.safety_gate
        assert any("_safety_gate" in c for c in i.acceptance_criteria)
        assert BAND_RANK[i.priority_band] <= BAND_RANK["P1"]


def test_non_hardware_issues_have_no_spurious_gate(issues):
    # A test-coverage gap that merely mentions `hardware_verifier` must not become a
    # hardware/safety issue with a P0 override.
    for i in issues:
        if not fse._is_hardware_or_safety(i):
            assert not i.safety_gate


def test_physical_hardware_is_p0_with_override(issues):
    p0 = [i for i in issues if i.priority_band == "P0"]
    assert p0, "physical-hardware verification should force a P0"
    assert all(i.override_reason for i in p0)
    assert any("hardware" in i.title.lower() for i in p0)


# ── 7. classifier unit checks ─────────────────────────────────────────────────

def _mk(title, desc, severity="MEDIUM", action=""):
    return fse.normalize_issue(
        {"title": title, "description": desc, "severity": severity, "action": action,
         "band": severity.title(), "source": "unit", "module": ""}, 1)


def test_bundle_issue_is_performance_config_change():
    i = _mk("Large JS bundle", "main chunk exceeds 500 kB; code-split with manualChunks.")
    assert i.category == "PERFORMANCE"
    assert i.fix_type == "CONFIG_CHANGE"


def test_duplicate_files_is_frontend_refactor():
    i = _mk("Residual duplicate frontend files",
            "a second PreviewPanel.jsx component variant remains; archive the dead copy.")
    assert i.category == "FRONTEND_UI"
    assert i.fix_type == "REFACTOR"


def test_naming_gap_is_not_hardware_even_if_it_mentions_hardware():
    i = _mk("Naming mismatch between services and test files",
            "hardware_verifier maps to test_hardware_output.py; a coverage-audit hazard, cosmetic.")
    assert not fse._is_hardware_or_safety(i)
    assert not i.safety_gate
    assert i.priority_band != "P0"


def test_vague_issue_marks_discovery_and_min_medium_effort():
    i = _mk("Something unclear", "no file or root cause identifiable here.")
    assert i.needs_discovery is True
    assert i.effort_band != "Small"


# ── 8. determinism + quality gate ─────────────────────────────────────────────

def test_engine_is_deterministic(report_text):
    a = fse.build_fix_strategy(report_text)
    b = fse.build_fix_strategy(report_text)
    assert [(i.issue_id, i.priority_band, i.effort_band, i.category) for i in a] \
        == [(i.issue_id, i.priority_band, i.effort_band, i.category) for i in b]


def test_release_readiness_blocks_while_p0_open(issues):
    rr = fse.release_readiness(issues)
    # a P0 is open (physical hardware), so the portfolio must not be "Release allowed"
    assert rr["p0"] >= 1
    assert rr["verdict"] != "Release allowed"


def test_exporters_roundtrip(issues):
    parsed = json.loads(fse.export_fix_strategy_json(issues))
    assert parsed["issue_count"] == len(issues)
    csv_lines = fse.export_fix_strategy_acceptance_matrix(issues).strip().splitlines()
    assert len(csv_lines) == len(issues) + 1
    assert "| ID | Issue |" in fse.export_fix_strategy_markdown(issues)
