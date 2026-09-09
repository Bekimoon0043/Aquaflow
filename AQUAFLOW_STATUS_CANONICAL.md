# AquaFlow Studio — Canonical Status (single source of truth)

**Date:** 2026-09-08
**Status:** **Tier A hardening; site I-CAN output verified, broader hardware commissioning pending.**
**Primary readiness number:** **Tier A readiness ≈ 55%** · **Overall technical maturity 7.7 / 10.**

> This document **supersedes** the three earlier, mutually-contradictory audits
> (see §4). It is the status the AI Command Hub and the CEO dashboard read from.
> The platform is **NOT "operational"** — it is in a stabilization/hardening pass
> whose only remaining Tier A gate after software work is real-hardware commissioning.


**Current site hardware evidence:** the reverse-engineered I-CAN output path was run
from this PC against gateway `192.168.5.2`; the fountain responded correctly to the
shortened capture, and AquaFlow 1.1.9 completed the embedded one-minute, 2,503-event
demo plus its manual Stop/blackout path. AquaFlow 1.2.1 adds operator-authored manual
patterns. The photographed 9-front / 2-rear-high / 64-middle physical layout is
recorded, while nozzle, pump and group-17 electrical addresses remain provisional
until one-channel-at-a-time site commissioning. PLC, Modbus and other site protocols
retain their separate commissioning requirements.

---

## 1. Agreed numbers (from two independent code-reading reviews: ChatGPT + Genspark)

### Architecture tier completion (five-tier stack, file-grounded)
| Tier | Area | Completion |
| --- | --- | --- |
| 1 | Hardware Abstraction | 62% |
| 2 | Real-Time Control | 68% |
| 3 | AI Orchestration | 45% |
| 4 | Design Studio | 78% |
| 5 | Cloud & Enterprise | 30% |

### Maturity ladder (product readiness — a different axis from the tiers above)
| Rung | Readiness |
| --- | --- |
| Code breadth exists | 90% |
| Integrated local studio | 80% |
| Internally verified simulation | 70% |
| **Tier A internal platform** | **55%** ← the headline number |
| Tier B commercial beta | 25% |

**Overall technical maturity: 7.7 / 10.**

**The core finding:** the risk is no longer feature absence — the code is broad and
real. The risk is **credibility of integration on real hardware**, plus a cluster of
data-consistency, runtime-authority, and stub issues to fix **before** the hardware
bench so bench time is not wasted debugging software.

---

## 2. Active plan — the AF-HUB Tier A Hardening sequence (26 tasks)

The old 65-task AquaFlow roadmap is **superseded** by this sequence (v3 + supplement +
Stage-7 corrective tasks from the independent ChatGPT review). Tasks 000–010, 013–018 are
software (Claude Code); 009 is an independent review; 011–012 are on-site hardware.

**Authoritative test evidence (single source):** backend pytest **830 passed, 21 skipped,
0 errors**; frontend vitest **440 passed (34 files)**; frontend `npm run build` green.
The 21 skips are the fix-strategy contract tests, which require a transient
`EVALUATION_REPORT.md` absent on a clean checkout.

| ID | Title | Pri | Stage | Type | Status |
| --- | --- | --- | --- | --- | --- |
| AF-HUB-000 | Green the backend suite | P0 | 0 Pre-flight | code | **DONE** `feec4b4` |
| AF-HUB-000B | Production startup mode (no reload) | P0 | 0 Pre-flight | code | **DONE** `026c8b1` |
| AF-HUB-000C | Honest hardware labeling + flag | P0 | 0 Pre-flight | code | **DONE** `4246006` |
| AF-HUB-001 | Archive stale frontend variants | P0 | 1 Frontend | code | **DONE** `151c34b` |
| AF-HUB-002 | Canonical fixture-type resolver | P0 | 2 Contracts | code | **DONE** `addc913` |
| AF-HUB-003 | Geometry / axis contract | P0 | 2 Contracts | code | **DONE** `2f00a30` |
| AF-HUB-004 | Fixture store unification + projection | P0 | 3 Stores | code | **DONE** `04be522` |
| AF-HUB-004B | DMX patch system unification | P0 | 3 Stores | code | **DONE** `a010785` |
| AF-HUB-005 | Backend fixture-aware sync pipeline | P0 | 3 Stores | code | **DONE** `bef93c6` |
| AF-HUB-006 | Route / singleton wiring repair | P1 | 4 Wiring/Runtime | code | **DONE** `e8ddf89` |
| AF-HUB-006B | Runtime authority consolidation | P0 | 4 Wiring/Runtime | code | **DONE** `0928606` |
| AF-HUB-007 | Stub burn-down (safety paths real) | P0 | 4 Wiring/Runtime | code | **DONE** `19912bd` |
| AF-HUB-007B | Runtime health monitoring | P0 | 4 Wiring/Runtime | code | **DONE** `7ed3858` |
| AF-HUB-007C | Failure mode recovery paths | P0 | 4 Wiring/Runtime | code | **DONE** `0537cc1` |
| AF-HUB-008 | Test stabilization + coverage | P1 | 5 Tests/Audit | code | **DONE** `074dd4a` |
| AF-HUB-009 | INDEPENDENT re-audit (GO/NO-GO) | P0 | 5 Tests/Audit | independent | Awaiting reviewer (evidence `dd886ac`; returned CONDITIONAL-GO → corrective 013–018) |
| AF-HUB-009B | Internal installer + license validation | P0 | 5.5 Installer | code | **DONE** `d66a7da` |
| AF-HUB-010 | Hardware verification harness prep | P0 | 6 Hardware | code (prep) | **DONE** `334a24c` |
| AF-HUB-011 | Real bench commissioning (= AQ-X-002) | P0 | 6 Hardware | on-site | Deferred — on-site (record template `f581333`) |
| AF-HUB-012 | Tier A acceptance pack | P0 | 6 Hardware | code+on-site | Pack delivered `4bf7607`; acceptance pending 011+009 |
| AF-HUB-013 | Playback authority lockdown (one 100Hz loop) | P0 | 7 Corrective | code | **DONE** `b077c49` |
| AF-HUB-014 | Protocol support honesty gate | P0 | 7 Corrective | code | **DONE** `9ddfa7a` |
| AF-HUB-015 | Hardware output fail-closed routing | P0 | 7 Corrective | code | **DONE** `672a866` |
| AF-HUB-016 | Protocol bus singleton lockdown | P1 | 7 Corrective | code | **DONE** `83c5883` |
| AF-HUB-017 | Evidence consistency pass | P1 | 7 Corrective | code | In progress |
| AF-HUB-018 | Bench safety environment lock | P1 | 7 Corrective | code | Queued |

**Completed: 20 / 26 code tasks done.** Remaining: AF-HUB-017/018 (corrective, code),
AF-HUB-009 (independent verdict), AF-HUB-011 (on-site bench), AF-HUB-012 final sign-off.
Hardware output remains UNVERIFIED (commissioning flag FALSE / SIMULATED).

---

## 3. Superseded task sets (marked, not deleted — history preserved in git)

- The old **65-task AquaFlow roadmap** → superseded by the AF-HUB series.
- **AQ-X-001 … AQ-X-016** → most folded into AF-HUB tasks (all AQ-X recovery work is done in code).
- **AQ-X-002** → now **AF-HUB-011** (real bench commissioning).
- **AQ-RT-001** (runtime authority) → now **AF-HUB-006B**.
- **AQ-RT-002** (production startup) → now **AF-HUB-000B** (done).
- **AQ-REPAIR-003/004** (frontend testing, coverage) → now **AF-HUB-008**.
- **DeepSeek AQ-TEST / AQ-VAL series** → **DISCARDED** (premise wrong: claimed "zero tests / no 3D engine"; the repo has 532 backend + 231 frontend tests and a real Three.js engine).

---

## 4. Reconciliation of the three old audits (what each got right)

| Old doc | Verdict | What it got right | Why superseded |
| --- | --- | --- | --- |
| `docs/AUDIT_20260702.md` (says **33%**) | Too pessimistic | Correctly flagged the top Stage-1 integration gaps (fixture-awareness, hardware verification, tests). | The 33% is a stale static-audit number from 2026-07-02; two later code-reading reviews put honest Tier A readiness at ~55%. |
| `AquaFlow_Architecture_Review.md` | **Most accurate** | Correctly identified the real risks: duplicate frontend variants, ad-hoc fixture-type resolution, geometry/axis inconsistency, store divergence, split runtime authority, stubs. These drive the AF-HUB plan. | Not a full status number; folded into this doc + the AF-HUB plan. |
| `EVALUATION_REPORT.md` | Optimistic but directionally right on breadth | Correctly captured how broad and real the code is (Stages 1–5, AQ-X recovery series). | Understates the integration/credibility risk that the AF-HUB plan targets. |

Net: **breadth is real (EVALUATION_REPORT), the integration risks are real
(Architecture_Review), and the honest number is ~55% Tier A (not 33%).**

The three docs are archived under `docs/audits_archive/` and remain in git history.

---

## 5. What "done" means for Tier A

Deterministic repeatability, safe shutdown (single-authority E-stop/blackout/watchdog),
data consistency (one fixture store → timeline/backend/runtime), no fake-success stubs,
honest hardware labeling (done: AF-HUB-000C), and finally a **real bench commissioning
run** (AF-HUB-011) — after which the hardware-commissioning flag flips TRUE and the
"simulated output only" banner clears.
