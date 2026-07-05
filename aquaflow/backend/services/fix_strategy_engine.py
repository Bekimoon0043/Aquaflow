"""
fix_strategy_engine.py — AquaFlow Stage 8, EVAL-AQ-002 (Fix Strategy)

Turns an evaluation report (EVALUATION_REPORT.md, produced by EVAL-AQ-001) into an
implementation-ready fix plan. For every issue found in the report it derives:

    issue → diagnosis → fix approach → criticality → effort → dependency → owner → acceptance test

This is a **rule-based + heuristic scoring engine**, not ML. Triage, safety sequencing and
engineering accountability must be deterministic, explainable and auditable — an ML model
would make none of those guarantees. The design follows two research inputs:

  * ChatGPT (strategy/design) — the issue schema, the category/fix-type rule tables, the
    weighted PriorityScore, the mandatory safety/blocker override gates, and the fix-strategy
    template. This is the canonical scoring path.
  * DeepSeek (data/analysis) — a complementary quantitative layer: Issue Severity Score
    (ISS), Fix Complexity Index (FCI), person-hour estimation (PH) and the release-readiness
    quality gate. These annotate each issue with concrete hours and a portfolio quality gate.

The engine is pure and deterministic: given the same report text it always produces the same
queue, so its output can be regression-tested. It emits three artifacts:

    fix_strategy_report.md              — human-readable plan (table + per-issue strategy)
    fix_strategy_queue.json             — machine-readable implementation queue
    fix_strategy_acceptance_matrix.csv  — acceptance/test/effort/priority matrix

Run:  python backend/services/fix_strategy_engine.py        (from the aquaflow/ dir)
      python -m services.fix_strategy_engine                (from aquaflow/backend/)
"""
from __future__ import annotations

import csv
import json
import math
import os
import re
from dataclasses import dataclass, field, asdict
from typing import List, Optional


# ═══════════════════════════════════════════════════════════════════════════════
#  Vocabularies (ChatGPT rule tables)
# ═══════════════════════════════════════════════════════════════════════════════

CATEGORIES = [
    "SAFETY", "LICENSING", "INSTALLER", "BACKEND_API", "FRONTEND_UI",
    "RUNTIME_COMPILER", "PROTOCOL_OUTPUT", "DMX_ARTNET", "PLC_MODBUS",
    "HYDRAULICS", "3D_PREVIEW", "DATA_MODEL", "PERFORMANCE", "TESTING",
    "DOCUMENTATION", "SECURITY",
]

FIX_TYPES = [
    "PATCH", "REFACTOR", "VALIDATION_RULE", "TEST_ADDITION", "CONFIG_CHANGE",
    "DATA_MODEL_CHANGE", "UI_CHANGE", "SECURITY_HARDENING", "DOCUMENTATION_UPDATE",
]

SEVERITY_WEIGHT = {"CRITICAL": 5, "HIGH": 4, "MEDIUM": 3, "LOW": 2, "COSMETIC": 1}
EFFORT_PENALTY = {"Small": 1, "Medium": 2, "Large": 3, "Very Large": 4, "Unknown": 3}
EFFORT_ORDER = {"Small": 0, "Medium": 1, "Large": 2, "Very Large": 3, "Unknown": 2}

# Category match order: highest-risk area wins the *primary* classification. A single issue
# may touch several categories; the first match here becomes primary, the rest secondary.
_CATEGORY_KEYWORDS = [
    ("SAFETY", [r"\bsafety\b", r"\bfault\b", r"watchdog", r"emergency", r"permit",
                r"safety gate", r"on-wire", r"unsafe output", r"safety limit"]),
    ("SECURITY", [r"\bsecret\b", r"private key", r"\bcredential", r"token exposure",
                  r"risky permission", r"exposure"]),
    ("LICENSING", [r"\blicense\b", r"licence", r"activation", r"fingerprint", r"signature"]),
    ("DMX_ARTNET", [r"\bDMX\b", r"art-net", r"artnet", r"sACN", r"universe", r"\b512\b",
                    r"\bchannel\b"]),
    ("PLC_MODBUS", [r"\bPLC\b", r"modbus", r"\bcoil\b", r"\bregister\b", r"\bI/O\b"]),
    ("INSTALLER", [r"installer", r"\binstall\b", r"clean install", r"deployment bundle"]),
    ("RUNTIME_COMPILER", [r"compiler", r"luxshow", r"\.luxshow", r"runtime bundle",
                          r"packager"]),
    ("HYDRAULICS", [r"hydraulic", r"hazen", r"darcy", r"\bpump\b", r"\bpipe\b",
                    r"head loss"]),
    ("PROTOCOL_OUTPUT", [r"output path", r"protocol_bus", r"on the wire", r"loopback"]),
    ("3D_PREVIEW", [r"webxr", r"\bVR\b", r"three\.js", r"mediarecorder", r"\bcapture\b",
                    r"headset", r"walkthrough", r"render"]),
    ("BACKEND_API", [r"\bapi\b", r"endpoint", r"\broute\b", r"fastapi"]),
    ("DATA_MODEL", [r"\bschema\b", r"data model", r"data contract", r"missing field"]),
    ("PERFORMANCE", [r"\bbundle\b", r"\bchunk\b", r"500 ?kb", r"\bvite\b", r"code-split",
                     r"code split", r"gzip", r"\bMB\b"]),
    ("TESTING", [r"pytest", r"vitest", r"test harness", r"test coverage", r"journey test",
                 r"\bcoverage\b", r"end-to-end", r"e2e", r"regression test",
                 r"third-party test", r"component test"]),
    ("FRONTEND_UI", [r"frontend", r"\bpanel\b", r"component", r"\breact\b", r"\.jsx",
                     r"\.js\b", r"preview panel", r"duplicate.*file"]),
    ("DOCUMENTATION", [r"\bdocs?\b", r"documentation", r"\bnaming\b", r"manual",
                       r"release note", r"README"]),
]

# Fix-type rules, evaluated in order; first match wins.
_FIXTYPE_RULES = [
    ("SECURITY_HARDENING", [r"\bsecret\b", r"private key", r"exposure", r"risky permission"]),
    ("TEST_ADDITION", [r"no test", r"no automated test", r"test coverage", r"journey test",
                       r"end-to-end", r"\be2e\b", r"regression test", r"add .*test",
                       r"component test", r"third-party test", r"coverage report",
                       r"commission", r"real hardware", r"physical.*fixture",
                       r"first.*bring-up"]),
    ("DATA_MODEL_CHANGE", [r"missing field", r"add .*schema", r"data model change"]),
    ("VALIDATION_RULE", [r"missing validation", r"add .*validation", r"validate input"]),
    ("CONFIG_CHANGE", [r"code-split", r"code split", r"manualchunks", r"dynamic import",
                       r"build setting", r"\bvite\b", r"env(ironment)? (var|path)",
                       r"wrong .*(url|path)", r"bundle"]),
    ("REFACTOR", [r"duplicate", r"dead (copy|component|file|variant)", r"archive",
                  r"single source of truth", r"fragile", r"refactor"]),
    ("UI_CHANGE", [r"display", r"\bUX\b", r"layout", r"screen"]),
    ("DOCUMENTATION_UPDATE", [r"documentation", r"\bdocs?\b", r"\bnaming\b", r"manual",
                              r"unclear procedure", r"release note"]),
    ("PATCH", [r"\bbug\b", r"\bbroken\b", r"incorrect", r"wrong behaviou?r", r"leak",
               r"crash"]),
]

OWNER_BY_CATEGORY = {
    "SAFETY": "Claude Code (safety)",
    "SECURITY": "Claude Code (security)",
    "DMX_ARTNET": "Claude Code (protocol)",
    "PLC_MODBUS": "Claude Code (protocol)",
    "PROTOCOL_OUTPUT": "Claude Code (protocol)",
    "HYDRAULICS": "Claude Code + DeepSeek",
    "PERFORMANCE": "Claude Code (frontend)",
    "FRONTEND_UI": "Claude Code (frontend)",
    "3D_PREVIEW": "Claude Code (frontend)",
    "TESTING": "Claude Code (QA)",
    "DOCUMENTATION": "Claude Code + ChatGPT",
    "INSTALLER": "Claude Code",
    "BACKEND_API": "Claude Code",
    "DATA_MODEL": "Claude Code",
    "LICENSING": "Claude Code",
    "RUNTIME_COMPILER": "Claude Code",
}

PRIORITY_BANDS = ["P0", "P1", "P2", "P3", "P4"]
_BAND_RANK = {b: i for i, b in enumerate(PRIORITY_BANDS)}


# ═══════════════════════════════════════════════════════════════════════════════
#  Issue model
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class Issue:
    issue_id: str = ""
    title: str = ""
    description: str = ""
    source: str = "evaluation_report"
    module: str = ""
    category: str = ""
    secondary_categories: List[str] = field(default_factory=list)
    severity: str = "MEDIUM"
    impact: str = ""
    root_cause: str = ""
    fix_type: str = ""
    fix_strategy: str = ""
    files_likely_affected: List[str] = field(default_factory=list)
    acceptance_criteria: List[str] = field(default_factory=list)
    test_plan: List[str] = field(default_factory=list)
    rollback_plan: List[str] = field(default_factory=list)
    dependencies: List[str] = field(default_factory=list)
    owner: str = ""
    effort_score: int = 0
    effort_band: str = "Medium"
    effort_person_hours: float = 0.0
    priority_score: int = 0
    priority_band: str = "P3"
    override_reason: str = ""
    safety_gate: str = ""
    needs_discovery: bool = False
    action_hint: str = ""       # the report's "Action:" seed, kept for provenance
    status: str = "queued"
    # DeepSeek quantitative annotations
    iss: float = 0.0            # Issue Severity Score (0-10)
    fci: float = 0.0            # Fix Complexity Index (0-10)


# ═══════════════════════════════════════════════════════════════════════════════
#  1. Extraction — pull issues out of the evaluation report
# ═══════════════════════════════════════════════════════════════════════════════

def _section(report_text: str, header_regex: str) -> str:
    """Return the body of a `## ...` section matching header_regex, up to the next `## `."""
    m = re.search(header_regex, report_text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    start = m.end()
    nxt = re.search(r"\n##\s", report_text[start:])
    return report_text[start: start + nxt.start()] if nxt else report_text[start:]


def extract_issues(report_text: str) -> List[dict]:
    """
    Deterministically extract the actionable issues from the evaluation report:

      * §5 "Broken / Missing / Risks" — the numbered High/Medium/Low items (primary source),
      * §3 feature table rows carrying a ⚠️ "Works, with caveat" verdict,
      * §4 "known issues" rows that are not fully ✅ Resolved.

    Returns a list of raw dicts {title, description, band, severity, source, module,
    action}. Downstream, normalize_issue() turns each into a full Issue.
    """
    raw: List[dict] = []

    # ── §5 numbered risk items, grouped by band header ──
    risks = _section(report_text, r"^##\s*5\..*Risk", )
    if not risks:
        risks = _section(report_text, r"Broken\s*/\s*Missing\s*/\s*Risks")
    band_map = {"High": "HIGH", "Medium": "MEDIUM", "Low": "LOW", "Informational": "LOW"}
    # split into band blocks by `### <band>` headings
    band_blocks = re.split(r"\n###\s+", "\n" + risks)
    for block in band_blocks:
        bm = re.match(r"(High|Medium|Low[\s/]*(?:Informational)?|Informational)",
                      block.strip(), re.IGNORECASE)
        if not bm:
            continue
        band_label = bm.group(1).split()[0].capitalize()
        severity = band_map.get(band_label, "MEDIUM")
        # numbered items: `1. **Title.** body...` until the next `\n<num>. ` or end
        for im in re.finditer(r"\n\s*\d+\.\s+\*\*(.+?)\*\*\s*(.*?)(?=\n\s*\d+\.\s+\*\*|\Z)",
                              block, re.DOTALL):
            title = re.sub(r"\s+", " ", im.group(1)).strip().rstrip(".")
            body = re.sub(r"\s+", " ", im.group(2)).strip()
            action = ""
            am = re.search(r"\*Action:\*\s*(.+)$", body)
            if am:
                action = am.group(1).strip()
            raw.append({
                "title": title, "description": body, "band": band_label,
                "severity": severity, "source": "evaluation_report §5",
                "module": "", "action": action,
            })

    # ── §3 caveat rows (⚠️) ──
    features = _section(report_text, r"^##\s*3\..*Feature")
    for line in features.splitlines():
        if "⚠️" not in line or not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 5:
            continue
        task_id, feature, criteria, verdict, evidence = cells[0], cells[1], cells[2], cells[3], cells[4]
        raw.append({
            "title": f"{feature} — real-world caveat ({task_id})",
            "description": f"{criteria}. Verdict: {verdict}. {evidence}",
            "band": "Medium", "severity": "MEDIUM",
            "source": f"evaluation_report §3 ({task_id})",
            "module": task_id, "action": f"Exercise {feature} on real target hardware/runtime.",
        })

    # ── §4 known issues not fully resolved ──
    known = _section(report_text, r"^##\s*4\..*Known")
    for line in known.splitlines():
        if not line.strip().startswith("|"):
            continue
        if "Resolved" not in line and "resolved" not in line:
            continue
        if "Partially" not in line and "⚠️" not in line:
            continue  # only the not-fully-resolved rows
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 4:
            continue
        _num, issue, status, notes = cells[0], cells[1], cells[2], cells[3]
        raw.append({
            "title": re.sub(r"\*\*", "", issue).strip().rstrip("."),
            "description": f"{re.sub(r'[*]+', '', issue).strip()}. Status: {status}. {notes}",
            "band": "High", "severity": "HIGH",
            "source": "evaluation_report §4",
            "module": "", "action": notes,
        })

    return _merge_by_root_cause(raw)


def _merge_by_root_cause(raw: List[dict]) -> List[dict]:
    """
    Edge case 7 — multiple report entries that share one root cause become one fix.
    Here the physical-hardware verification appears in §5(High), §4(#2) and §3(AQ-X-002);
    they collapse to a single hardware-commissioning fix (keeping the strongest severity
    and merging provenance).
    """
    def sig(d: dict) -> Optional[str]:
        t = (d["title"] + " " + d["description"]).lower()
        if re.search(r"hardware", t) and re.search(r"physical|loopback|commission|on-wire|on the wire|real .*device|real .*fixture", t):
            return "physical-hardware-verification"
        return None

    merged: List[dict] = []
    by_sig: dict = {}
    for d in raw:
        s = sig(d)
        if s is None:
            merged.append(d)
            continue
        if s not in by_sig:
            d = dict(d)
            d["_merged_sources"] = [d["source"]]
            by_sig[s] = d
            merged.append(d)
        else:
            tgt = by_sig[s]
            tgt["_merged_sources"].append(d["source"])
            # keep the highest severity / most descriptive
            if SEVERITY_WEIGHT.get(d["severity"], 0) > SEVERITY_WEIGHT.get(tgt["severity"], 0):
                tgt["severity"] = d["severity"]
                tgt["band"] = d["band"]
            if len(d["description"]) > len(tgt["description"]):
                tgt["description"] = d["description"]
            if d.get("action") and len(d["action"]) > len(tgt.get("action", "")):
                tgt["action"] = d["action"]
    for d in merged:
        if d.get("_merged_sources"):
            d["source"] = " + ".join(sorted(set(d["_merged_sources"])))
            d.pop("_merged_sources", None)
    return merged


# ═══════════════════════════════════════════════════════════════════════════════
#  2. Normalization + classification
# ═══════════════════════════════════════════════════════════════════════════════

def _matches(patterns: List[str], text: str) -> bool:
    return any(re.search(p, text, re.IGNORECASE) for p in patterns)


def classify_category(issue: Issue) -> str:
    """
    Primary category = the issue's fundamental *nature*, decided by strong signal gates so
    an issue is not miscategorised just because its text happens to *mention* another area
    (e.g. a test-coverage gap that lists `hardware_verifier` as an example is TESTING, not a
    hardware issue). All keyword hits are still recorded as secondary categories for
    provenance.
    """
    text = f"{issue.title} {issue.description} {issue.action_hint}".lower()
    matched = [cat for cat, pats in _CATEGORY_KEYWORDS if _matches(pats, text)]

    def has(*pats) -> bool:
        return any(re.search(p, text) for p in pats)

    primary: Optional[str] = None
    # 1) genuine physical hardware / safety output-path work (commissioning)
    if has(r"\bhardware\b") and has(r"physical", r"real hardware", r"loopback", r"commission",
                                    r"on-wire", r"on the wire", r"before any live",
                                    r"first.*bring-up", r"output path"):
        primary = "SAFETY" if has(r"safety", r"on-wire", r"unsafe", r"permit",
                                  r"safety gate") else "DMX_ARTNET"
    # 2) frontend bundle / performance
    elif has(r"\bbundle\b", r"\bchunk\b", r"code-split", r"code split", r"gzip", r"500 ?kb"):
        primary = "PERFORMANCE"
    # 3) duplicate frontend source files
    elif has(r"duplicate") and has(r"\bfile", r"component", r"panel", r"variant", r"\bcopy\b"):
        primary = "FRONTEND_UI"
    # 4) docs / naming / coverage-audit clarity (not a behavioural test gap)
    elif has(r"naming mismatch", r"coverage-audit", r"\bnaming\b", r"unclear procedure",
             r"release note") and not has(r"test coverage"):
        primary = "DOCUMENTATION"
    # 5) test authorship / coverage / journey gaps
    elif has(r"test coverage", r"journey", r"end-to-end", r"\be2e\b", r"third-party test",
             r"component test", r"self-authored", r"test authorship", r"regression test",
             r"no (automated )?test", r"cross-feature", r"test files"):
        primary = "TESTING"
    # 6) 3D / VR / video-capture caveats
    elif has(r"webxr", r"\bvr\b", r"headset", r"walkthrough", r"mediarecorder",
             r"video export", r"\bcapture\b", r"three\.js"):
        primary = "3D_PREVIEW"
    # 7) time-based observability gaps ⇒ verification nature
    elif has(r"clock-injected", r"elapsed", r"calendar time", r"\bwau\b", r"\bmau\b",
             r"escalation timer", r"offline outbox"):
        primary = "TESTING"

    if primary is None:
        primary = matched[0] if matched else "DOCUMENTATION"
    issue.secondary_categories = [c for c in matched if c != primary]
    return primary


def classify_fix_type(issue: Issue) -> str:
    text = f"{issue.title} {issue.description} {issue.action_hint}"
    for ft, pats in _FIXTYPE_RULES:
        if _matches(pats, text):
            return ft
    # category fallbacks
    return {
        "TESTING": "TEST_ADDITION",
        "PERFORMANCE": "CONFIG_CHANGE",
        "FRONTEND_UI": "REFACTOR",
        "DOCUMENTATION": "DOCUMENTATION_UPDATE",
        "SAFETY": "TEST_ADDITION",
        "SECURITY": "SECURITY_HARDENING",
    }.get(issue.category, "PATCH")


def _is_hardware_or_safety(issue: Issue) -> bool:
    """
    True only when the issue is about the physical/safety **output path** itself — not merely
    because its text mentions a service called `hardware_verifier` or lists "hardware" as the
    tail of a journey. Primary category in the hardware/safety set is decisive; otherwise the
    word "hardware" must co-occur with an output-path/commissioning qualifier.
    """
    if issue.category in ("SAFETY", "DMX_ARTNET", "PLC_MODBUS", "PROTOCOL_OUTPUT"):
        return True
    text = f"{issue.title} {issue.description}".lower()
    return bool(re.search(r"\bhardware\b", text) and re.search(
        r"physical|loopback|commission|on-wire|on the wire|output path|before any live", text))


def infer_root_cause(issue: Issue) -> str:
    text = f"{issue.title} {issue.description}".lower()
    if re.search(r"hardware", text) and re.search(r"loopback|physical|commission", text):
        return ("Output path is verified only against a virtual loopback socket, never against "
                "a physical fixture on real cabling, so on-wire timing/levels are unproven in situ.")
    if re.search(r"journey|end-to-end|e2e|third-party test|cross-feature", text):
        return ("No test exercises a full UI→API→engine(→hardware) user journey; every harness "
                "was authored beside the unit it checks, leaving integration seams uncovered.")
    if re.search(r"duplicate", text) and re.search(r"panel|component|file", text):
        return ("More than one component variant remains mounted/available (a second "
                "PreviewPanel), so edits can be applied to a dead copy — no single source of truth.")
    if re.search(r"bundle|chunk|500 ?kb|gzip", text):
        return ("The frontend ships as one large chunk (>500 kB) because routes/panels are "
                "statically imported instead of code-split, inflating first load.")
    if re.search(r"component test|react .*test|interaction test|coverage.*(engine|frontend)", text):
        return ("Frontend tests target pure engines; React panels are covered only by build + "
                "manual wiring, so component/interaction regressions can slip through.")
    if re.search(r"naming", text):
        return ("A dozen services lack a same-named test file (covered under differently-named "
                "suites), so name-based coverage inference under-reports true coverage.")
    if re.search(r"webxr|\bvr\b|headset", text):
        return "WebXR paths are logic-verified but cannot be exercised without a physical VR headset."
    if re.search(r"mediarecorder|capture|video export", text):
        return "Real frame capture depends on the browser MediaRecorder and is not exercised headlessly."
    if re.search(r"clock-injected|elapsed|calendar time|wau|mau|escalation timer", text):
        return ("Time-based metrics/timers are clock-injected and unit-tested but never observed "
                "over real elapsed calendar time in production.")
    # vague → discovery
    issue.needs_discovery = True
    return "Root cause not identifiable from the report text alone — requires a discovery pass."


# ═══════════════════════════════════════════════════════════════════════════════
#  3. Effort estimation (ChatGPT EffortScore + DeepSeek person-hours)
# ═══════════════════════════════════════════════════════════════════════════════

def _subsystem_count(issue: Issue) -> int:
    cats = set([issue.category] + issue.secondary_categories)
    text = f"{issue.title} {issue.description}".lower()
    subs = 0
    if cats & {"FRONTEND_UI", "3D_PREVIEW", "PERFORMANCE"} or "frontend" in text:
        subs += 1
    if cats & {"BACKEND_API", "HYDRAULICS", "DATA_MODEL", "LICENSING", "INSTALLER"} or "backend" in text:
        subs += 1
    if cats & {"RUNTIME_COMPILER", "PROTOCOL_OUTPUT"} or "runtime" in text:
        subs += 1
    if _is_hardware_or_safety(issue) or "hardware" in text:
        subs += 1
    if re.search(r"journey|end-to-end|ui.?api|ui .*engine", text):
        subs = max(subs, 3)
    return max(1, subs)


def _hardware_test_need(issue: Issue) -> int:
    text = f"{issue.title} {issue.description}".lower()
    if re.search(r"physical.*(fixture|device)|real hardware|commission|first.*bring-up", text):
        return 5
    if re.search(r"plc|modbus|safety hardware", text):
        return 5
    if re.search(r"simulat|loopback|art-net|dmx|journey|end-to-end", text):
        return 3
    if re.search(r"dry-run", text):
        return 1
    return 0


def _test_complexity(issue: Issue) -> int:
    text = f"{issue.title} {issue.description}".lower()
    if _is_hardware_or_safety(issue) and re.search(r"safety", text):
        return 5
    if _is_hardware_or_safety(issue) or re.search(r"output path|on-wire", text):
        return 5
    if re.search(r"installer|clean install", text):
        return 4
    if re.search(r"journey|end-to-end|integration|cross-feature", text):
        return 3
    return 1


def _file_count(issue: Issue) -> int:
    """Rough file-touch estimate → 1..~14."""
    if issue.needs_discovery:
        return 8  # unknown ⇒ assume broad
    ft = issue.fix_type
    if ft == "REFACTOR":
        return 3
    if ft == "CONFIG_CHANGE":
        return 2
    if ft == "TEST_ADDITION":
        return 6
    if ft == "DOCUMENTATION_UPDATE":
        return 2
    if ft in ("DATA_MODEL_CHANGE",):
        return 5
    return 3


def estimate_effort(issue: Issue) -> int:
    """
    EffortScore = FileCount·1 + SubsystemCount·3 + DataMigrationRisk·5 + HardwareTestNeed·5
                  + UnknownCodeRisk·3 + TestComplexity·2
    Bands: Small 1-6, Medium 7-14, Large 15-25, Very Large 26+.
    Edge cases: vague issue ⇒ needs_discovery, min band Medium; any hardware-output issue
    ⇒ min band Medium.
    """
    text = f"{issue.title} {issue.description}".lower()
    file_count = _file_count(issue)
    subsystem = _subsystem_count(issue)
    data_migration = 1 if re.search(r"migrat|backfill|schema change|data model change", text) else 0
    hw_need = _hardware_test_need(issue)
    unknown = 3 if issue.needs_discovery else 0
    test_cx = _test_complexity(issue)

    score = (file_count * 1) + (subsystem * 3) + (data_migration * 5) + (hw_need * 5) \
        + (unknown * 3) + (test_cx * 2)

    if score <= 6:
        band = "Small"
    elif score <= 14:
        band = "Medium"
    elif score <= 25:
        band = "Large"
    else:
        band = "Very Large"

    # Edge cases: never estimate a vague or hardware-output issue as Small.
    if (issue.needs_discovery or _is_hardware_or_safety(issue)) and band == "Small":
        band = "Medium"

    issue.effort_band = band
    issue.effort_person_hours = _person_hours(issue, score)
    return score


def _person_hours(issue: Issue, effort_score: int) -> float:
    """
    DeepSeek PH layer. LOC-to-fix is estimated from the effort band; the FCI complexity
    multiplier inflates raw dev hours, then test/review/deploy overhead is added.
        PH = (LOC/50)·(1 + (FCI/10)·0.5); Total = PH·(1 + .3 + .2 + .1)
    Result rounded up to the nearest 0.5 h.
    """
    loc = {"Small": 60, "Medium": 250, "Large": 900, "Very Large": 2200}.get(issue.effort_band, 250)
    fci = issue.fci or 5.0
    ph = (loc / 50.0) * (1 + (fci / 10.0) * 0.5)
    total = ph * (1 + 0.3 + 0.2 + 0.1)
    return math.ceil(total * 2) / 2.0


# ── DeepSeek ISS / FCI (annotations) ──────────────────────────────────────────

def compute_iss(issue: Issue) -> float:
    """ISS = I·.4 + F·.3 + U·.2 + S·.1 on 1-10 scales."""
    sev = issue.severity
    impact = {"CRITICAL": 9, "HIGH": 7, "MEDIUM": 5, "LOW": 3, "COSMETIC": 2}.get(sev, 5)
    urgency = {"CRITICAL": 9, "HIGH": 7, "MEDIUM": 5, "LOW": 3, "COSMETIC": 2}.get(sev, 5)
    frequency = 8 if _is_hardware_or_safety(issue) else (5 if issue.severity in ("HIGH", "MEDIUM") else 3)
    scope = min(10, _subsystem_count(issue) * 3)
    return round(impact * 0.4 + frequency * 0.3 + urgency * 0.2 + scope * 0.1, 2)


def compute_fci(issue: Issue, effort_score: int) -> float:
    """FCI = L·.35 + T·.25 + D·.25 + R·.15 (0-10)."""
    loc = {"Small": 60, "Medium": 250, "Large": 900, "Very Large": 2200}.get(issue.effort_band, 250)
    L = min(10, math.log10(loc + 1) * 3.33)
    # test coverage proxy: hardware/discovery ⇒ weak coverage, testing fixes ⇒ they *add* it
    R = 8.0 if (issue.needs_discovery or _is_hardware_or_safety(issue)) else 3.0
    T = max(0.0, 10 - R)
    D = min(10, _subsystem_count(issue) * 2)
    return round(L * 0.35 + T * 0.25 + D * 0.25 + R * 0.15, 2)


# ═══════════════════════════════════════════════════════════════════════════════
#  4. Priority scoring + mandatory overrides (ChatGPT)
# ═══════════════════════════════════════════════════════════════════════════════

def _safety_weight(issue: Issue) -> int:
    text = f"{issue.title} {issue.description}".lower()
    if issue.category == "SAFETY" or re.search(r"unsafe output|safety gate|output path", text):
        # possible unsafe output until verified on real hardware
        return 5 if re.search(r"unsafe|emergency|permit", text) else 4
    if _is_hardware_or_safety(issue):
        return 4
    if re.search(r"reliability|operational", text):
        return 3
    return 0


def _blocker_weight(issue: Issue) -> int:
    text = f"{issue.title} {issue.description} {issue.action_hint}".lower()
    if re.search(r"real hardware|live (site|deployment)|commission|before any live|"
                 r"blocks .*hardware", text) or (_is_hardware_or_safety(issue)
                                                 and re.search(r"pending|unverified", text)):
        return 5
    if re.search(r"installer|deployment", text):
        return 4
    if re.search(r"workflow|blocks .*user", text):
        return 3
    if re.search(r"documentation|naming|coverage-audit|cosmetic", text):
        return 1
    return 0


def _customer_impact_weight(issue: Issue) -> int:
    text = f"{issue.title} {issue.description}".lower()
    if _is_hardware_or_safety(issue) or re.search(r"bundle|first load|all users|performance", text):
        return 5
    if re.search(r"beta", text):
        return 4
    if re.search(r"export|webxr|\bvr\b|video", text):
        return 4
    if re.search(r"engineering|journey|end-to-end", text):
        return 3
    if re.search(r"duplicate|naming|internal|developer", text):
        return 1
    return 3


def _dependency_weight(issue: Issue) -> int:
    text = f"{issue.title} {issue.description}".lower()
    if re.search(r"before any live|gate .*live|blocks .*(all|every) ", text) or _is_hardware_or_safety(issue):
        return 5
    if re.search(r"journey|end-to-end|cross-feature|several|3-4|3–4", text):
        return 3
    return 1


def assign_priority_band(score: int) -> str:
    if score >= 240:
        return "P0"
    if score >= 180:
        return "P1"
    if score >= 120:
        return "P2"
    if score >= 60:
        return "P3"
    return "P4"


def calculate_priority(issue: Issue) -> int:
    """
    PriorityScore = Sev·30 + Safety·25 + Blocker·20 + CustomerImpact·15 + Dependency·10
                    − EffortPenalty·5
    """
    sev = SEVERITY_WEIGHT.get(issue.severity, 3)
    safety = _safety_weight(issue)
    blocker = _blocker_weight(issue)
    customer = _customer_impact_weight(issue)
    dependency = _dependency_weight(issue)
    penalty = EFFORT_PENALTY.get(issue.effort_band, 3)
    score = sev * 30 + safety * 25 + blocker * 20 + customer * 15 + dependency * 10 - penalty * 5
    return int(score)


def apply_mandatory_overrides(issue: Issue) -> str:
    """
    Regardless of score, force P0/P1 for the non-negotiable gates. Returns the band (and
    records the reason on the issue). These are the safety/blocker guarantees that make the
    triage trustworthy.
    """
    text = f"{issue.title} {issue.description} {issue.action_hint}".lower()
    band = issue.priority_band
    reason = ""

    def promote(to: str, why: str):
        nonlocal band, reason
        if _BAND_RANK[to] < _BAND_RANK[band]:
            band, reason = to, why
        elif not reason and to == band:
            reason = why

    if re.search(r"unsafe|safety (permit|output) .*(unsafe|fail)", text):
        promote("P0", "Unsafe safety permit/output path")
    if re.search(r"real hardware|physical.*(fixture|device)|cannot be tested|commission|before any live", text) and _is_hardware_or_safety(issue):
        promote("P0", "Real hardware cannot yet be tested (output path unproven in situ)")
    if re.search(r"license.*(startup|prevents|lock)", text):
        promote("P0", "License prevents app startup")
    if re.search(r"installer cannot (launch|start)|clean install .*fail", text):
        promote("P0", "Installer cannot launch")
    if re.search(r"cannot reach .*fixture|not reach designed fixture|center_jets", text):
        promote("P0", "Generated show cannot reach designed fixtures")
    if re.search(r"secret|private key|credential.*expos", text):
        promote("P0", "Secret/private-key exposure")
    # hardware-output path with no automated test ⇒ min P1
    if _is_hardware_or_safety(issue) and re.search(r"no (automated )?test|untested|no regression", text):
        if _BAND_RANK[band] > _BAND_RANK["P1"]:
            band, reason = "P1", "Hardware-output path lacks an automated test (min P1)"

    issue.override_reason = reason
    return band


# ═══════════════════════════════════════════════════════════════════════════════
#  5. Strategy / acceptance / test / rollback generation
# ═══════════════════════════════════════════════════════════════════════════════

def generate_acceptance_criteria(issue: Issue) -> List[str]:
    crit: List[str] = []
    a = issue.action_hint.strip().rstrip(".")
    if a:
        crit.append(f"{a[0].upper()}{a[1:]}.")
    cat, ft = issue.category, issue.fix_type
    if cat in ("SAFETY", "DMX_ARTNET", "PLC_MODBUS", "PROTOCOL_OUTPUT") or _is_hardware_or_safety(issue):
        crit.append("Output verified on the target device (real or, if unavailable, an explicitly "
                    "labelled simulator) with the `_safety_gate` choke point still enforced — no "
                    "regression in per-fixture clamp or flame-duration limits.")
        crit.append("A commissioning checklist records device, cabling, universe/address map and "
                    "measured on-wire timing; first bring-up is treated as a formal test.")
    if ft == "TEST_ADDITION":
        crit.append("New automated test(s) added and green in the same suite run; failure of the "
                    "underlying behaviour makes the test fail (verified by a deliberate break).")
    if ft == "CONFIG_CHANGE" and cat == "PERFORMANCE":
        crit.append("Main chunk < 500 kB (or largest route-chunk target met) after code-split; "
                    "`npm run build` emits no chunk-size warning.")
    if ft == "REFACTOR":
        crit.append("Exactly one live source of truth remains; the dead variant is archived/removed "
                    "and no import references it (grep clean); build + suites stay green.")
    if ft == "DOCUMENTATION_UPDATE":
        crit.append("Coverage/naming made unambiguous (e.g. `pytest --cov` report checked in or "
                    "service↔test naming reconciled); no behaviour change.")
    # guarantee ≥3 measurable criteria
    while len(crit) < 3:
        crit.append("Full backend `pytest` and frontend `vitest` suites remain green after the fix "
                    "(403 + 158 baseline, no regressions).")
    return crit[:5]


def generate_test_plan(issue: Issue) -> List[str]:
    plan: List[str] = []
    if _is_hardware_or_safety(issue):
        plan.append("Hardware-output test: drive the fix through `protocol_bus` into the "
                    "loopback node AND (when scheduled) a real DMX/Art-Net/sACN fixture; assert "
                    "channel values, refresh rate ≤44 Hz and the safety gate on the wire.")
        plan.append("Safety regression: re-run `validate_safety_output_limits.py` and "
                    "`validate_hardware_output.py`; both must stay green.")
    if issue.fix_type == "TEST_ADDITION":
        plan.append("Add integration/journey test(s) spanning UI→API→engine for the flagged flow; "
                    "run in CI and confirm they fail when the path is deliberately broken.")
    if issue.category == "PERFORMANCE":
        plan.append("Build-size assertion: parse `npm run build` output; fail CI if any chunk "
                    "exceeds the configured budget.")
    if issue.category == "FRONTEND_UI":
        plan.append("`npm run build` clean + a component test mounting the single retained panel; "
                    "grep confirms no import of the archived variant.")
    if issue.needs_discovery:
        plan.append("Discovery spike first: locate affected files, then write the test that "
                    "reproduces the gap before fixing.")
    if not plan:
        plan.append("Add/extend a `validate_*.py` harness or `tests/test_*.py` module asserting "
                    "the acceptance criteria; run the full suite.")
    return plan


def generate_rollback_plan(issue: Issue) -> List[str]:
    steps = [f"Revert the fix commit (`git revert <sha>`); the change is isolated to "
             f"{', '.join(issue.files_likely_affected) or 'the listed files'}."]
    if issue.fix_type == "REFACTOR":
        steps.append("Restore the archived component variant from git history if the retained "
                     "panel regresses.")
    if issue.fix_type == "CONFIG_CHANGE":
        steps.append("Restore the previous build config (single-bundle) — no runtime data affected.")
    if re.search(r"migrat|backfill|schema change", f"{issue.title} {issue.description}".lower()):
        steps.append("Restore from the pre-migration backup; run the down-migration.")
    if _is_hardware_or_safety(issue):
        steps.append("No physical risk on rollback: reverting only removes the new test/commissioning "
                     "artifacts; the safety gate is unchanged.")
    return steps


def _files_for(issue: Issue) -> List[str]:
    cat = issue.category
    text = f"{issue.title} {issue.description}".lower()
    if _is_hardware_or_safety(issue):
        return ["backend/services/hardware_verifier.py", "backend/protocols/protocol_bus.py",
                "backend/validate_hardware_output.py", "docs/commissioning_checklist.md"]
    if "journey" in text or "end-to-end" in text or issue.fix_type == "TEST_ADDITION" and cat == "TESTING":
        return ["backend/tests/test_journeys_e2e.py", "frontend/src/__tests__/journeys.test.js"]
    if cat == "PERFORMANCE":
        return ["frontend/vite.config.js", "frontend/src/main.jsx", "frontend/src/App.jsx"]
    if cat == "FRONTEND_UI":
        return ["frontend/src/components/preview/PreviewPanel_v5.jsx",
                "frontend/src/components/panels/PreviewPanel.jsx"]
    if "component test" in text or "react" in text:
        return ["frontend/src/**/__tests__/*.test.jsx"]
    if "naming" in text or "coverage" in text:
        return ["backend/pytest.ini", "backend/tests/"]
    if re.search(r"webxr|\bvr\b|headset", text):
        return ["frontend/src/engines/walkthrough.js", "frontend/src/__tests__/walkthrough.test.js"]
    if re.search(r"mediarecorder|capture|video", text):
        return ["frontend/src/engines/videoExport.js"]
    if re.search(r"clock|elapsed|timer|wau|mau", text):
        return ["backend/services/analytics_engine.py", "backend/services/fault_alerting.py"]
    return []


def generate_fix_strategy(issue: Issue) -> str:
    impl_steps = _implementation_logic(issue)
    files = issue.files_likely_affected or ["(discovery required — see test plan)"]
    lines = [
        "## Fix Approach",
        "",
        "### Root Cause",
        issue.root_cause,
        "",
        "### Required Change",
        _required_change(issue),
        "",
        "### Implementation Logic",
    ]
    lines += [f"{i}. {s}" for i, s in enumerate(impl_steps, 1)]
    lines += ["", "### Files Likely Affected"]
    lines += [f"- {f}" for f in files]
    lines += ["", "### Acceptance Criteria"]
    lines += [f"- {c}" for c in issue.acceptance_criteria]
    lines += ["", "### Test Plan"]
    lines += [f"- {t}" for t in issue.test_plan]
    lines += ["", "### Rollback Plan"]
    lines += [f"- {r}" for r in issue.rollback_plan]
    if issue.safety_gate:
        lines += ["", "### Safety Gate", issue.safety_gate]
    return "\n".join(lines)


def _required_change(issue: Issue) -> str:
    return {
        "TEST_ADDITION": "Add the missing automated coverage (and, for hardware, a real-target "
                         "commissioning test) so the flagged behaviour is guarded by a failing-on-break test.",
        "CONFIG_CHANGE": "Change the build/config so the flagged budget or path is met without "
                         "touching runtime behaviour.",
        "REFACTOR": "Consolidate to a single source of truth and archive the dead variant.",
        "DOCUMENTATION_UPDATE": "Make the coverage/procedure unambiguous; no behaviour change.",
        "SECURITY_HARDENING": "Remove the exposure and add a guard so it cannot recur.",
        "PATCH": "Correct the faulty behaviour at its source and add a regression test.",
        "VALIDATION_RULE": "Add the missing validation with clear operator feedback.",
        "DATA_MODEL_CHANGE": "Introduce the field/schema with a migration and rollback.",
        "UI_CHANGE": "Fix the display/UX without weakening any safety limit.",
    }.get(issue.fix_type, "Address the root cause and protect it with a test.")


def _implementation_logic(issue: Issue) -> List[str]:
    if _is_hardware_or_safety(issue):
        return [
            "Schedule a commissioning session with a real DMX/Art-Net/sACN fixture and cabling.",
            "Keep the loopback test as the CI gate; add a real-hardware checklist run as a manual gate.",
            "Assert on-wire values, ≤44 Hz refresh and the `_safety_gate` choke point during output.",
            "Record device/universe/address map + measured timing in a commissioning report.",
        ]
    if issue.fix_type == "TEST_ADDITION":
        return [
            "Enumerate the flagged flow's seams (UI action → API route → engine call → result).",
            "Write an integration/journey test that drives the real stack end-to-end.",
            "Prove it fails when the seam is deliberately broken, then wire it into CI.",
        ]
    if issue.category == "PERFORMANCE":
        return [
            "Introduce route-level dynamic `import()` / Vite `manualChunks` to split the bundle.",
            "Set a per-chunk size budget and fail the build when exceeded.",
            "Re-measure gzip size and confirm first-load improvement.",
        ]
    if issue.fix_type == "REFACTOR":
        return [
            "Identify the single panel/scene that is actually mounted.",
            "Archive the unused variant(s) out of the live tree.",
            "Grep for stale imports and update them to the retained source.",
        ]
    if issue.fix_type == "DOCUMENTATION_UPDATE":
        return [
            "Generate a real coverage report (`pytest --cov`, vitest coverage).",
            "Reconcile service↔test naming or document the mapping.",
            "Check the report/mapping into the repo so coverage is unambiguous.",
        ]
    if issue.needs_discovery:
        return [
            "Run a short discovery spike to locate the affected files/behaviour.",
            "Reproduce the gap with a failing test.",
            "Implement the smallest fix that turns it green.",
        ]
    return [
        "Locate the root-cause code path.",
        "Apply the minimal corrective change.",
        "Add a regression test and re-run the full suite.",
    ]


# ═══════════════════════════════════════════════════════════════════════════════
#  Pipeline
# ═══════════════════════════════════════════════════════════════════════════════

def normalize_issue(raw: dict, index: int) -> Issue:
    issue = Issue(
        issue_id=f"AQ-FIX-{index:03d}",
        title=raw["title"].strip(),
        description=raw["description"].strip(),
        source=raw.get("source", "evaluation_report"),
        module=raw.get("module", ""),
        severity=raw.get("severity", "MEDIUM"),
        action_hint=raw.get("action", ""),
    )
    issue.category = classify_category(issue)
    issue.fix_type = classify_fix_type(issue)
    issue.root_cause = infer_root_cause(issue)
    issue.owner = OWNER_BY_CATEGORY.get(issue.category, "Claude Code")
    issue.impact = raw.get("band", "") and f"{raw['band']} risk (per evaluation report)"
    # effort → fci needs effort_band; compute effort first, then fci uses band, then hours
    effort_score = estimate_effort(issue)
    issue.fci = compute_fci(issue, effort_score)
    issue.iss = compute_iss(issue)
    issue.effort_person_hours = _person_hours(issue, effort_score)  # recompute with real fci
    issue.effort_score = effort_score
    issue.files_likely_affected = _files_for(issue)
    if _is_hardware_or_safety(issue):
        issue.safety_gate = ("SAFETY GATE — the `_safety_gate` choke point (per-fixture intensity "
                             "clamp + flame duration) MUST remain enforced on every output frame; "
                             "this fix may not weaken any safety limit for UX, and is not complete "
                             "until an output test (real or labelled-simulator) passes.")
    issue.acceptance_criteria = generate_acceptance_criteria(issue)
    issue.test_plan = generate_test_plan(issue)
    issue.rollback_plan = generate_rollback_plan(issue)
    # priority
    issue.priority_score = calculate_priority(issue)
    issue.priority_band = assign_priority_band(issue.priority_score)
    issue.priority_band = apply_mandatory_overrides(issue)
    issue.fix_strategy = generate_fix_strategy(issue)
    return issue


def sort_by_priority_and_dependency(issues: List[Issue]) -> List[Issue]:
    """
    Queue order: P0 first; within a band safety before non-safety, blockers before
    enhancements, then low-effort/high-impact before large refactors (cheaper first, then
    higher priority score). Deterministic and stable.
    """
    def key(i: Issue):
        return (
            _BAND_RANK.get(i.priority_band, 9),
            0 if _is_hardware_or_safety(i) else 1,
            0 if _blocker_weight(i) >= 3 else 1,
            EFFORT_ORDER.get(i.effort_band, 2),
            -i.priority_score,
            i.issue_id,
        )
    ordered = sorted(issues, key=key)
    # re-id in queue order so AQ-FIX-001 is the first thing to build
    for n, iss in enumerate(ordered, 1):
        iss.issue_id = f"AQ-FIX-{n:03d}"
        iss.fix_strategy = re.sub(r"^", "", iss.fix_strategy)  # id not embedded; keep as-is
    return ordered


def build_fix_strategy(report_text: str) -> List[Issue]:
    raw_issues = extract_issues(report_text)
    normalized = [normalize_issue(r, i) for i, r in enumerate(raw_issues, 1)]
    return sort_by_priority_and_dependency(normalized)


# ═══════════════════════════════════════════════════════════════════════════════
#  Portfolio quality gate (DeepSeek)
# ═══════════════════════════════════════════════════════════════════════════════

def release_readiness(issues: List[Issue]) -> dict:
    p0 = sum(1 for i in issues if i.priority_band == "P0")
    p1 = sum(1 for i in issues if i.priority_band == "P1")
    p2 = sum(1 for i in issues if i.priority_band == "P2")
    score = 1 - (p0 * 0.4 + p1 * 0.2 + p2 * 0.05)
    if score < 0.70:
        verdict = "BLOCK release"
    elif score < 0.85:
        verdict = "Review required"
    else:
        verdict = "Release allowed"
    return {"p0": p0, "p1": p1, "p2": p2, "score": round(score, 3), "verdict": verdict}


# ═══════════════════════════════════════════════════════════════════════════════
#  Exporters
# ═══════════════════════════════════════════════════════════════════════════════

def export_fix_strategy_json(issues: List[Issue]) -> str:
    payload = {
        "task": "EVAL-AQ-002",
        "generated_from": "EVALUATION_REPORT.md",
        "issue_count": len(issues),
        "release_readiness": release_readiness(issues),
        "queue": [asdict(i) for i in issues],
    }
    return json.dumps(payload, indent=2, ensure_ascii=False)


def export_fix_strategy_acceptance_matrix(issues: List[Issue]) -> str:
    from io import StringIO
    buf = StringIO()
    w = csv.writer(buf)
    w.writerow(["ID", "Title", "Category", "FixType", "Priority", "PriorityScore",
                "Effort", "EffortScore", "PersonHours", "Owner", "Dependencies",
                "SafetyGate", "AcceptanceCriteria", "TestPlan", "Status"])
    for i in issues:
        w.writerow([
            i.issue_id, i.title, i.category, i.fix_type, i.priority_band, i.priority_score,
            i.effort_band, i.effort_score, i.effort_person_hours, i.owner,
            "; ".join(i.dependencies) or "none",
            "YES" if i.safety_gate else "no",
            " | ".join(i.acceptance_criteria),
            " | ".join(i.test_plan),
            i.status,
        ])
    return buf.getvalue()


def export_fix_strategy_markdown(issues: List[Issue]) -> str:
    rr = release_readiness(issues)
    lines = [
        "# AquaFlow Studio — Fix Strategy (EVAL-AQ-002)",
        "",
        "**Source:** `EVALUATION_REPORT.md` (EVAL-AQ-001)  ",
        "**Engine:** `backend/services/fix_strategy_engine.py` — rule-based + heuristic scoring "
        "(deterministic, no ML).  ",
        f"**Issues:** {len(issues)}  ",
        f"**Release readiness:** {rr['score']} → **{rr['verdict']}** "
        f"(P0={rr['p0']}, P1={rr['p1']}, P2={rr['p2']}).",
        "",
        "Every issue below has a fix approach, a criticality band, an effort estimate, "
        "acceptance criteria, a test plan and a rollback plan. Hardware/safety issues carry an "
        "explicit safety gate. Order is the recommended implementation queue (P0 → P4; safety "
        "and blockers first; low-effort/high-impact before large refactors).",
        "",
        "## Implementation Queue",
        "",
        "| ID | Issue | Category | Fix type | Priority | Effort (hrs) | Owner | Safety gate | Status |",
        "| -- | ----- | -------- | -------- | -------- | ------------ | ----- | ----------- | ------ |",
    ]
    for i in issues:
        lines.append(
            f"| {i.issue_id} | {i.title} | {i.category} | {i.fix_type} | "
            f"**{i.priority_band}** ({i.priority_score}) | {i.effort_band} "
            f"(~{i.effort_person_hours}h) | {i.owner} | "
            f"{'⚠️ YES' if i.safety_gate else '—'} | {i.status} |"
        )
    lines += ["", "## CEO Escalation Flags", ""]
    esc = _escalations(issues)
    if esc:
        for e in esc:
            lines.append(f"- **{e['id']} — {e['title']}**: {e['reason']}")
    else:
        lines.append("- None.")
    lines += ["", "## Per-Issue Fix Strategy", ""]
    for i in issues:
        lines += [
            f"### {i.issue_id} — {i.title}",
            "",
            f"- **Category:** {i.category}"
            + (f" (secondary: {', '.join(i.secondary_categories)})" if i.secondary_categories else ""),
            f"- **Severity (report):** {i.severity} · **ISS:** {i.iss} · **FCI:** {i.fci}",
            f"- **Priority:** {i.priority_band} (score {i.priority_score})"
            + (f" — override: {i.override_reason}" if i.override_reason else ""),
            f"- **Effort:** {i.effort_band} (score {i.effort_score}, ~{i.effort_person_hours} person-hours)",
            f"- **Owner:** {i.owner}",
            f"- **Source:** {i.source}",
            f"- **Dependencies:** {', '.join(i.dependencies) or 'none'}",
            "",
            i.fix_strategy,
            "",
            "---",
            "",
        ]
    return "\n".join(lines)


def _escalations(issues: List[Issue]) -> List[dict]:
    """CEO escalation gates: hardware access, >1wk delay (Very Large), policy/direction changes."""
    out = []
    for i in issues:
        reasons = []
        if _hardware_test_need(i) >= 5:
            reasons.append("requires real hardware access (commissioning session)")
        if i.effort_band == "Very Large":
            reasons.append("effort >1 week — may delay stage completion")
        if i.category in ("LICENSING", "SECURITY"):
            reasons.append("touches licensing/security policy")
        if reasons:
            out.append({"id": i.issue_id, "title": i.title, "reason": "; ".join(reasons)})
    return out


# ═══════════════════════════════════════════════════════════════════════════════
#  Paths + CLI
# ═══════════════════════════════════════════════════════════════════════════════

def find_repo_root(start: Optional[str] = None) -> str:
    """Walk upward from `start` (or this file) until EVALUATION_REPORT.md is found."""
    here = os.path.abspath(start or os.path.dirname(__file__))
    cur = here
    for _ in range(8):
        if os.path.exists(os.path.join(cur, "EVALUATION_REPORT.md")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    # fall back to cwd
    return os.getcwd()


def run(report_path: Optional[str] = None, out_dir: Optional[str] = None) -> dict:
    root = find_repo_root()
    report_path = report_path or os.path.join(root, "EVALUATION_REPORT.md")
    out_dir = out_dir or root
    with open(report_path, "r", encoding="utf-8") as fh:
        report_text = fh.read()

    issues = build_fix_strategy(report_text)

    md_path = os.path.join(out_dir, "fix_strategy_report.md")
    json_path = os.path.join(out_dir, "fix_strategy_queue.json")
    csv_path = os.path.join(out_dir, "fix_strategy_acceptance_matrix.csv")

    with open(md_path, "w", encoding="utf-8") as fh:
        fh.write(export_fix_strategy_markdown(issues))
    with open(json_path, "w", encoding="utf-8") as fh:
        fh.write(export_fix_strategy_json(issues))
    with open(csv_path, "w", encoding="utf-8", newline="") as fh:
        fh.write(export_fix_strategy_acceptance_matrix(issues))

    return {
        "issues": issues,
        "report_path": report_path,
        "outputs": [md_path, json_path, csv_path],
        "release_readiness": release_readiness(issues),
    }


if __name__ == "__main__":
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    arg_report = sys.argv[1] if len(sys.argv) > 1 else None
    result = run(arg_report)
    issues = result["issues"]
    print(f"Fix strategy generated from {result['report_path']}")
    print(f"Issues: {len(issues)}")
    rr = result["release_readiness"]
    print(f"Release readiness: {rr['score']} → {rr['verdict']} "
          f"(P0={rr['p0']}, P1={rr['p1']}, P2={rr['p2']})")
    print("\nImplementation queue:")
    for i in issues:
        gate = " [SAFETY GATE]" if i.safety_gate else ""
        print(f"  {i.issue_id}  {i.priority_band}  {i.effort_band:<10} "
              f"{i.category:<14} {i.title}{gate}")
    print("\nOutputs:")
    for p in result["outputs"]:
        print(f"  {p}")
