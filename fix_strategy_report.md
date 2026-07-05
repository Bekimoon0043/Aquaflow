# AquaFlow Studio — Fix Strategy (EVAL-AQ-002)

**Source:** `EVALUATION_REPORT.md` (EVAL-AQ-001)  
**Engine:** `backend/services/fix_strategy_engine.py` — rule-based + heuristic scoring (deterministic, no ML).  
**Issues:** 9  
**Release readiness:** 0.3 → **BLOCK release** (P0=1, P1=0, P2=6).

Every issue below has a fix approach, a criticality band, an effort estimate, acceptance criteria, a test plan and a rollback plan. Hardware/safety issues carry an explicit safety gate. Order is the recommended implementation queue (P0 → P4; safety and blockers first; low-effort/high-impact before large refactors).

## Implementation Queue

| ID | Issue | Category | Fix type | Priority | Effort (hrs) | Owner | Safety gate | Status |
| -- | ----- | -------- | -------- | -------- | ------------ | ----- | ----------- | ------ |
| AQ-FIX-001 | Physical-hardware verification pending (Issue #2) | SAFETY | TEST_ADDITION | **P0** (425) | Very Large (~92.5h) | Claude Code (safety) | ⚠️ YES | queued |
| AQ-FIX-002 | Large JS bundle | PERFORMANCE | CONFIG_CHANGE | **P2** (165) | Medium (~10.5h) | Claude Code (frontend) | — | queued |
| AQ-FIX-003 | Naming mismatch between services and test files | DOCUMENTATION | TEST_ADDITION | **P2** (155) | Medium (~10.5h) | Claude Code + ChatGPT | — | queued |
| AQ-FIX-004 | VR walkthrough mode — real-world caveat (AQ-S3-006) | 3D_PREVIEW | PATCH | **P2** (150) | Medium (~10.5h) | Claude Code (frontend) | — | queued |
| AQ-FIX-005 | 4K video export — real-world caveat (AQ-S3-007) | 3D_PREVIEW | PATCH | **P2** (150) | Medium (~10.5h) | Claude Code (frontend) | — | queued |
| AQ-FIX-006 | Frontend test coverage is engine-focused | TESTING | TEST_ADDITION | **P2** (135) | Medium (~10.5h) | Claude Code (QA) | — | queued |
| AQ-FIX-007 | Self-authored verification | TESTING | TEST_ADDITION | **P2** (175) | Very Large (~96.0h) | Claude Code (QA) | — | queued |
| AQ-FIX-008 | Residual duplicate frontend files | FRONTEND_UI | REFACTOR | **P3** (105) | Medium (~10.5h) | Claude Code (frontend) | — | queued |
| AQ-FIX-009 | `WAU`/`MAU`, escalation timers, offline outboxes and similar are clock-injected and unit-tested | TESTING | TEST_ADDITION | **P3** (105) | Medium (~10.5h) | Claude Code (QA) | — | queued |

## CEO Escalation Flags

- **AQ-FIX-001 — Physical-hardware verification pending (Issue #2)**: requires real hardware access (commissioning session); effort >1 week — may delay stage completion
- **AQ-FIX-007 — Self-authored verification**: effort >1 week — may delay stage completion

## Per-Issue Fix Strategy

### AQ-FIX-001 — Physical-hardware verification pending (Issue #2)

- **Category:** SAFETY (secondary: DMX_ARTNET, PROTOCOL_OUTPUT)
- **Severity (report):** HIGH · **ISS:** 7.2 · **FCI:** 6.2
- **Priority:** P0 (score 425) — override: Real hardware cannot yet be tested (output path unproven in situ)
- **Effort:** Very Large (score 47, ~92.5 person-hours)
- **Owner:** Claude Code (safety)
- **Source:** evaluation_report §3 (AQ-X-002) + evaluation_report §4 + evaluation_report §5
- **Dependencies:** none

## Fix Approach

### Root Cause
Output path is verified only against a virtual loopback socket, never against a physical fixture on real cabling, so on-wire timing/levels are unproven in situ.

### Required Change
Add the missing automated coverage (and, for hardware, a real-target commissioning test) so the flagged behaviour is guarded by a failing-on-break test.

### Implementation Logic
1. Schedule a commissioning session with a real DMX/Art-Net/sACN fixture and cabling.
2. Keep the loopback test as the CI gate; add a real-hardware checklist run as a manual gate.
3. Assert on-wire values, ≤44 Hz refresh and the `_safety_gate` choke point during output.
4. Record device/universe/address map + measured timing in a commissioning report.

### Files Likely Affected
- backend/services/hardware_verifier.py
- backend/protocols/protocol_bus.py
- backend/validate_hardware_output.py
- docs/commissioning_checklist.md

### Acceptance Criteria
- AQ-X-002 verifies real socket output + on-wire safety gate against a **virtual loopback node** (20/20). **Physical-device bring-up is still outstanding** and should gate the first live site.
- Output verified on the target device (real or, if unavailable, an explicitly labelled simulator) with the `_safety_gate` choke point still enforced — no regression in per-fixture clamp or flame-duration limits.
- A commissioning checklist records device, cabling, universe/address map and measured on-wire timing; first bring-up is treated as a formal test.
- New automated test(s) added and green in the same suite run; failure of the underlying behaviour makes the test fail (verified by a deliberate break).

### Test Plan
- Hardware-output test: drive the fix through `protocol_bus` into the loopback node AND (when scheduled) a real DMX/Art-Net/sACN fixture; assert channel values, refresh rate ≤44 Hz and the safety gate on the wire.
- Safety regression: re-run `validate_safety_output_limits.py` and `validate_hardware_output.py`; both must stay green.
- Add integration/journey test(s) spanning UI→API→engine for the flagged flow; run in CI and confirm they fail when the path is deliberately broken.

### Rollback Plan
- Revert the fix commit (`git revert <sha>`); the change is isolated to backend/services/hardware_verifier.py, backend/protocols/protocol_bus.py, backend/validate_hardware_output.py, docs/commissioning_checklist.md.
- No physical risk on rollback: reverting only removes the new test/commissioning artifacts; the safety gate is unchanged.

### Safety Gate
SAFETY GATE — the `_safety_gate` choke point (per-fixture intensity clamp + flame duration) MUST remain enforced on every output frame; this fix may not weaken any safety limit for UX, and is not complete until an output test (real or labelled-simulator) passes.

---

### AQ-FIX-002 — Large JS bundle

- **Category:** PERFORMANCE (secondary: DOCUMENTATION)
- **Severity (report):** MEDIUM · **ISS:** 4.8 · **FCI:** 5.5
- **Priority:** P2 (score 165)
- **Effort:** Medium (score 7, ~10.5 person-hours)
- **Owner:** Claude Code (frontend)
- **Source:** evaluation_report §5
- **Dependencies:** none

## Fix Approach

### Root Cause
The frontend ships as one large chunk (>500 kB) because routes/panels are statically imported instead of code-split, inflating first load.

### Required Change
Change the build/config so the flagged budget or path is met without touching runtime behaviour.

### Implementation Logic
1. Introduce route-level dynamic `import()` / Vite `manualChunks` to split the bundle.
2. Set a per-chunk size budget and fail the build when exceeded.
3. Re-measure gzip size and confirm first-load improvement.

### Files Likely Affected
- frontend/vite.config.js
- frontend/src/main.jsx
- frontend/src/App.jsx

### Acceptance Criteria
- Code-split (dynamic `import()` / `manualChunks`) before scaling the user base.
- Main chunk < 500 kB (or largest route-chunk target met) after code-split; `npm run build` emits no chunk-size warning.
- Full backend `pytest` and frontend `vitest` suites remain green after the fix (403 + 158 baseline, no regressions).

### Test Plan
- Build-size assertion: parse `npm run build` output; fail CI if any chunk exceeds the configured budget.

### Rollback Plan
- Revert the fix commit (`git revert <sha>`); the change is isolated to frontend/vite.config.js, frontend/src/main.jsx, frontend/src/App.jsx.
- Restore the previous build config (single-bundle) — no runtime data affected.

---

### AQ-FIX-003 — Naming mismatch between services and test files

- **Category:** DOCUMENTATION (secondary: RUNTIME_COMPILER, TESTING)
- **Severity (report):** LOW · **ISS:** 3.3 · **FCI:** 6.0
- **Priority:** P2 (score 155)
- **Effort:** Medium (score 14, ~10.5 person-hours)
- **Owner:** Claude Code + ChatGPT
- **Source:** evaluation_report §5
- **Dependencies:** none

## Fix Approach

### Root Cause
The frontend ships as one large chunk (>500 kB) because routes/panels are statically imported instead of code-split, inflating first load.

### Required Change
Add the missing automated coverage (and, for hardware, a real-target commissioning test) so the flagged behaviour is guarded by a failing-on-break test.

### Implementation Logic
1. Enumerate the flagged flow's seams (UI action → API route → engine call → result).
2. Write an integration/journey test that drives the real stack end-to-end.
3. Prove it fails when the seam is deliberately broken, then wire it into CI.

### Files Likely Affected
- backend/pytest.ini
- backend/tests/

### Acceptance Criteria
- Optional — a coverage report (`pytest --cov`) would make true coverage unambiguous.
- New automated test(s) added and green in the same suite run; failure of the underlying behaviour makes the test fail (verified by a deliberate break).
- Full backend `pytest` and frontend `vitest` suites remain green after the fix (403 + 158 baseline, no regressions).

### Test Plan
- Add integration/journey test(s) spanning UI→API→engine for the flagged flow; run in CI and confirm they fail when the path is deliberately broken.

### Rollback Plan
- Revert the fix commit (`git revert <sha>`); the change is isolated to backend/pytest.ini, backend/tests/.

---

### AQ-FIX-004 — VR walkthrough mode — real-world caveat (AQ-S3-006)

- **Category:** 3D_PREVIEW (secondary: FRONTEND_UI)
- **Severity (report):** MEDIUM · **ISS:** 4.8 · **FCI:** 5.5
- **Priority:** P2 (score 150)
- **Effort:** Medium (score 8, ~10.5 person-hours)
- **Owner:** Claude Code (frontend)
- **Source:** evaluation_report §3 (AQ-S3-006)
- **Dependencies:** none

## Fix Approach

### Root Cause
WebXR paths are logic-verified but cannot be exercised without a physical VR headset.

### Required Change
Correct the faulty behaviour at its source and add a regression test.

### Implementation Logic
1. Locate the root-cause code path.
2. Apply the minimal corrective change.
3. Add a regression test and re-run the full suite.

### Files Likely Affected
- frontend/src/engines/walkthrough.js
- frontend/src/__tests__/walkthrough.test.js

### Acceptance Criteria
- Exercise VR walkthrough mode on real target hardware/runtime.
- Full backend `pytest` and frontend `vitest` suites remain green after the fix (403 + 158 baseline, no regressions).
- Full backend `pytest` and frontend `vitest` suites remain green after the fix (403 + 158 baseline, no regressions).

### Test Plan
- Add/extend a `validate_*.py` harness or `tests/test_*.py` module asserting the acceptance criteria; run the full suite.

### Rollback Plan
- Revert the fix commit (`git revert <sha>`); the change is isolated to frontend/src/engines/walkthrough.js, frontend/src/__tests__/walkthrough.test.js.

---

### AQ-FIX-005 — 4K video export — real-world caveat (AQ-S3-007)

- **Category:** 3D_PREVIEW (secondary: FRONTEND_UI)
- **Severity (report):** MEDIUM · **ISS:** 4.8 · **FCI:** 5.5
- **Priority:** P2 (score 150)
- **Effort:** Medium (score 8, ~10.5 person-hours)
- **Owner:** Claude Code (frontend)
- **Source:** evaluation_report §3 (AQ-S3-007)
- **Dependencies:** none

## Fix Approach

### Root Cause
Real frame capture depends on the browser MediaRecorder and is not exercised headlessly.

### Required Change
Correct the faulty behaviour at its source and add a regression test.

### Implementation Logic
1. Locate the root-cause code path.
2. Apply the minimal corrective change.
3. Add a regression test and re-run the full suite.

### Files Likely Affected
- frontend/src/engines/videoExport.js

### Acceptance Criteria
- Exercise 4K video export on real target hardware/runtime.
- Full backend `pytest` and frontend `vitest` suites remain green after the fix (403 + 158 baseline, no regressions).
- Full backend `pytest` and frontend `vitest` suites remain green after the fix (403 + 158 baseline, no regressions).

### Test Plan
- Add/extend a `validate_*.py` harness or `tests/test_*.py` module asserting the acceptance criteria; run the full suite.

### Rollback Plan
- Revert the fix commit (`git revert <sha>`); the change is isolated to frontend/src/engines/videoExport.js.

---

### AQ-FIX-006 — Frontend test coverage is engine-focused

- **Category:** TESTING (secondary: 3D_PREVIEW, FRONTEND_UI, DOCUMENTATION)
- **Severity (report):** MEDIUM · **ISS:** 4.8 · **FCI:** 5.5
- **Priority:** P2 (score 135)
- **Effort:** Medium (score 11, ~10.5 person-hours)
- **Owner:** Claude Code (QA)
- **Source:** evaluation_report §5
- **Dependencies:** none

## Fix Approach

### Root Cause
Frontend tests target pure engines; React panels are covered only by build + manual wiring, so component/interaction regressions can slip through.

### Required Change
Add the missing automated coverage (and, for hardware, a real-target commissioning test) so the flagged behaviour is guarded by a failing-on-break test.

### Implementation Logic
1. Enumerate the flagged flow's seams (UI action → API route → engine call → result).
2. Write an integration/journey test that drives the real stack end-to-end.
3. Prove it fails when the seam is deliberately broken, then wire it into CI.

### Files Likely Affected
- backend/tests/test_journeys_e2e.py
- frontend/src/__tests__/journeys.test.js

### Acceptance Criteria
- Add component tests for the highest-traffic panels.
- New automated test(s) added and green in the same suite run; failure of the underlying behaviour makes the test fail (verified by a deliberate break).
- Full backend `pytest` and frontend `vitest` suites remain green after the fix (403 + 158 baseline, no regressions).

### Test Plan
- Add integration/journey test(s) spanning UI→API→engine for the flagged flow; run in CI and confirm they fail when the path is deliberately broken.

### Rollback Plan
- Revert the fix commit (`git revert <sha>`); the change is isolated to backend/tests/test_journeys_e2e.py, frontend/src/__tests__/journeys.test.js.

---

### AQ-FIX-007 — Self-authored verification

- **Category:** TESTING (secondary: BACKEND_API)
- **Severity (report):** HIGH · **ISS:** 6.6 · **FCI:** 7.2
- **Priority:** P2 (score 175)
- **Effort:** Very Large (score 36, ~96.0 person-hours)
- **Owner:** Claude Code (QA)
- **Source:** evaluation_report §5
- **Dependencies:** none

## Fix Approach

### Root Cause
No test exercises a full UI→API→engine(→hardware) user journey; every harness was authored beside the unit it checks, leaving integration seams uncovered.

### Required Change
Add the missing automated coverage (and, for hardware, a real-target commissioning test) so the flagged behaviour is guarded by a failing-on-break test.

### Implementation Logic
1. Enumerate the flagged flow's seams (UI action → API route → engine call → result).
2. Write an integration/journey test that drives the real stack end-to-end.
3. Prove it fails when the seam is deliberately broken, then wire it into CI.

### Files Likely Affected
- backend/tests/test_journeys_e2e.py
- frontend/src/__tests__/journeys.test.js

### Acceptance Criteria
- Add a small number of cross-feature, end-to-end journey tests.
- New automated test(s) added and green in the same suite run; failure of the underlying behaviour makes the test fail (verified by a deliberate break).
- Full backend `pytest` and frontend `vitest` suites remain green after the fix (403 + 158 baseline, no regressions).

### Test Plan
- Add integration/journey test(s) spanning UI→API→engine for the flagged flow; run in CI and confirm they fail when the path is deliberately broken.

### Rollback Plan
- Revert the fix commit (`git revert <sha>`); the change is isolated to backend/tests/test_journeys_e2e.py, frontend/src/__tests__/journeys.test.js.

---

### AQ-FIX-008 — Residual duplicate frontend files

- **Category:** FRONTEND_UI
- **Severity (report):** MEDIUM · **ISS:** 4.8 · **FCI:** 5.5
- **Priority:** P3 (score 105)
- **Effort:** Medium (score 8, ~10.5 person-hours)
- **Owner:** Claude Code (frontend)
- **Source:** evaluation_report §5
- **Dependencies:** none

## Fix Approach

### Root Cause
More than one component variant remains mounted/available (a second PreviewPanel), so edits can be applied to a dead copy — no single source of truth.

### Required Change
Consolidate to a single source of truth and archive the dead variant.

### Implementation Logic
1. Identify the single panel/scene that is actually mounted.
2. Archive the unused variant(s) out of the live tree.
3. Grep for stale imports and update them to the retained source.

### Files Likely Affected
- frontend/src/components/preview/PreviewPanel_v5.jsx
- frontend/src/components/panels/PreviewPanel.jsx

### Acceptance Criteria
- Confirm the single source of truth for the preview panel and archive/remove the unused one to avoid editing a dead copy.
- Exactly one live source of truth remains; the dead variant is archived/removed and no import references it (grep clean); build + suites stay green.
- Full backend `pytest` and frontend `vitest` suites remain green after the fix (403 + 158 baseline, no regressions).

### Test Plan
- `npm run build` clean + a component test mounting the single retained panel; grep confirms no import of the archived variant.

### Rollback Plan
- Revert the fix commit (`git revert <sha>`); the change is isolated to frontend/src/components/preview/PreviewPanel_v5.jsx, frontend/src/components/panels/PreviewPanel.jsx.
- Restore the archived component variant from git history if the retained panel regresses.

---

### AQ-FIX-009 — `WAU`/`MAU`, escalation timers, offline outboxes and similar are clock-injected and unit-tested

- **Category:** TESTING
- **Severity (report):** LOW · **ISS:** 3.0 · **FCI:** 5.5
- **Priority:** P3 (score 105)
- **Effort:** Medium (score 11, ~10.5 person-hours)
- **Owner:** Claude Code (QA)
- **Source:** evaluation_report §5
- **Dependencies:** none

## Fix Approach

### Root Cause
Time-based metrics/timers are clock-injected and unit-tested but never observed over real elapsed calendar time in production.

### Required Change
Add the missing automated coverage (and, for hardware, a real-target commissioning test) so the flagged behaviour is guarded by a failing-on-break test.

### Implementation Logic
1. Enumerate the flagged flow's seams (UI action → API route → engine call → result).
2. Write an integration/journey test that drives the real stack end-to-end.
3. Prove it fails when the seam is deliberately broken, then wire it into CI.

### Files Likely Affected
- backend/tests/test_journeys_e2e.py
- frontend/src/__tests__/journeys.test.js

### Acceptance Criteria
- New automated test(s) added and green in the same suite run; failure of the underlying behaviour makes the test fail (verified by a deliberate break).
- Full backend `pytest` and frontend `vitest` suites remain green after the fix (403 + 158 baseline, no regressions).
- Full backend `pytest` and frontend `vitest` suites remain green after the fix (403 + 158 baseline, no regressions).

### Test Plan
- Add integration/journey test(s) spanning UI→API→engine for the flagged flow; run in CI and confirm they fail when the path is deliberately broken.

### Rollback Plan
- Revert the fix commit (`git revert <sha>`); the change is isolated to backend/tests/test_journeys_e2e.py, frontend/src/__tests__/journeys.test.js.

---
