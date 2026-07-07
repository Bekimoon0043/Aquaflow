# AF-HUB-009 — Independent Re-Audit: Evidence Pack

**Status of this document:** EVIDENCE PACK ONLY — prepared by Claude Code (the same agent
that implemented AF-HUB-001…008). It is **not** a verdict.

> ## GO / NO-GO VERDICT: ⛔ PENDING — INDEPENDENT REVIEW REQUIRED
>
> Per the CEO's standing directive, AF-HUB-009 must be an **independent** re-audit and
> **must not be Claude Code self-grading**. Claude Code therefore does **not** issue the
> GO/NO-GO here. This document assembles the objective, reproducible evidence an outside
> reviewer needs to render that verdict. The verdict field below is intentionally left
> blank for the independent reviewer.

- **Audit target commit:** `074dd4a` (branch `main`, repo `burook-Luxury/aquaflow-studio`)
- **Date prepared:** 2026-07-06
- **Canonical status doc:** `AQUAFLOW_STATUS_CANONICAL.md` (claims ~55% Tier A readiness)
- **Independent reviewer:** ______________________  **Verdict:** ☐ GO ☐ NO-GO  **Date:** __________

---

## 1. Why this is not a self-grade

The agent that wrote the code cannot be the authority that certifies it is safe to run on
real hardware at a live site. This pack contains **facts that can be independently
re-verified** (test runs, diffs, commit hashes) plus an **honest list of what is still
unproven**. The reviewer forms the verdict; nothing here should be read as a claim that
AquaFlow is cleared for live operation.

## 2. How to reproduce the evidence (do not trust — verify)

```bash
# Backend (Python) — from aquaflow/backend
./.venv/Scripts/python.exe -m pytest            # expect: 525 passed, 21 skipped, 0 errors

# Frontend (JS) — from aquaflow/frontend
npx vitest run                                  # expect: 231 passed (20 files)
npm run build                                   # expect: build succeeds
```

The 21 skips are `test_fix_strategy_engine.py`, which requires the transient
`EVALUATION_REPORT.md` artifact (untracked; absent on a clean checkout). See AF-HUB-008.

## 3. Test evidence (post-corrective authoritative run, commit `88d9c52`)

| Suite | Result | Notes |
| --- | --- | --- |
| Backend pytest | **525 passed, 21 skipped, 0 errors** | Full suite, no `--ignore`. Was 42 collection errors before AF-HUB-008. |
| Backend coverage | **59%** line coverage | `pytest --cov` (measured in AF-HUB-017). |
| Frontend vitest | **231 passed (20 files)** | Node env; no DOM. |
| Frontend build | **green** | Vite production build. |

> **Update (post independent reviews):** two independent reviews ran — ChatGPT (code-read,
> CONDITIONAL-GO) and Genspark (cloned + ran on Linux). Both found incomplete work reported
> as done. The Stage-7 corrective tasks **AF-HUB-013…020** fix everything they flagged: one
> 100 Hz playback loop, protocol honesty gate, fail-closed output routing, singleton
> lockdown, evidence-consistency pass (installed pytest-cov, 59% above), bench safety lock,
> the cross-platform crash-fingerprint fix (Genspark), and retiring the test-only
> runtime_bridge from the supported surface (Genspark). The numbers above are the
> post-corrective authoritative run (green on Windows; the crash-fingerprint fix makes the
> one Linux failure Genspark measured pass too).

## 4. What each AF-HUB task changed (Stages 1–5 software)

| Task | Commit | What it did | How it's evidenced |
| --- | --- | --- | --- |
| AF-HUB-000 | `feec4b4` | Green the backend suite (license-secret test fixture) | suite green |
| AF-HUB-000B | `026c8b1` | Production startup: no auto-reload/watchers by default | `main.py` `__main__` gated behind `AQUAFLOW_DEV` |
| AF-HUB-000C | `4246006` | Honest hardware labeling + commissioning flag (**default FALSE**) | `services/commissioning.py`; banner; `hardware_verifier` gates `deployment_ready` on the flag |
| AF-HUB-001 | `151c34b` | Archive stale/dead frontend variants | `_archive/` + README |
| AF-HUB-002 | `addc913` | Canonical fixture-type resolver | `fixtureTypeMap` consolidation + consistency tests |
| AF-HUB-003 | `2f00a30` | Geometry / axis contract (one engineering→3D rule) | `engineering/geometryContract.js` + tests |
| AF-HUB-004 | `04be522` | Fixture store unification + deterministic projection | `runtime/fixtureProjection.js`; killed the dead `showStore.engineeringFixtures` mirror |
| AF-HUB-004B | `a010785` | DMX patch system unification | `runtime/dmxPatch.js`; single-sourced constants |
| AF-HUB-005 | `bef93c6` | Backend fixture-aware sync pipeline | designed fixtures → device registry → conflict gating; group-shape normalization + e2e test |
| AF-HUB-006 | `e8ddf89` | Route / singleton wiring repair | routes use the one shared `app_state` singleton; orphan accessors removed |
| AF-HUB-006B | `0928606` | Runtime authority consolidation | one `RuntimeAuthority.emergency_stop()` halts every output subsystem, fault-tolerant |
| AF-HUB-007 | `19912bd` | Stub burn-down (safety paths real) | Modbus/relay dispatch no longer fakes success; fails closed |
| AF-HUB-007B | `7ed3858` | Runtime health monitoring | `/api/health` reports a real ok/degraded/critical verdict |
| AF-HUB-007C | `0537cc1` | Failure mode recovery paths | gated `RuntimeAuthority.recover()`; `reset_faults` no longer wipes fault evidence |
| AF-HUB-008 | `074dd4a` | Test stabilization + coverage | suite green with no ignores; SafetyGuard now tested |

## 5. Known gaps NOT closed by software (these gate the Tier A verdict)

These are the reasons a reasonable reviewer would withhold an unconditional GO. They are
**out of scope for AF-HUB-001…008** and require the on-site hardware tasks (010–012):

1. **[CRITICAL] Real hardware output is UNVERIFIED.** No task in this series drove a real
   DMX/Art-Net fixture or a real Modbus PLC and confirmed the physical result. The
   fixture-aware pipeline (005), the honest dispatch (007), and the simulation bus are all
   verified *in software only*. The commissioning flag defaults **FALSE** and the UI shows a
   SIMULATED banner precisely because this is unproven. → **AF-HUB-011 (on-site bench).**
2. **[HIGH] Hydraulic engine uses linear approximations**, not real Hazen-Williams /
   Darcy-Weisbach. Not addressed in this series.
3. **Coverage measured** at 59% line coverage (AF-HUB-017) — improvement welcome, not a blocker.
4. **AF-HUB-009B / 010 / 011 / 012 remain** (installer+license validation, hardware harness
   prep, real bench commissioning, acceptance pack).

## 6. What an independent reviewer should verify before deciding

- [ ] Re-run both suites at current `main` HEAD and confirm the counts in §3.
- [ ] Spot-check 2–3 AF-HUB diffs against their claims in §4 (e.g. `git show 0928606`).
- [ ] Confirm the commissioning flag defaults FALSE and gates `deployment_ready`.
- [ ] Confirm no task in this series claims real-hardware verification (it must not).
- [ ] Independently judge whether the software-integration state justifies the ~55% Tier A
      number in `AQUAFLOW_STATUS_CANONICAL.md` — or set a different number.
- [ ] Confirm the git history contains no secrets/keys before any repo is made public
      (separate CEO action item).

## 7. Claude Code's non-binding self-assessment (explicitly NOT the verdict)

For transparency only, and to be weighed critically by the reviewer: the **software
integration and data-contract risks** the architecture review flagged (duplicate variants,
ad-hoc fixture resolution, geometry/axis drift, store divergence, split runtime authority,
safety-path stubs) now have consolidated implementations and regression tests. The
**hardware-verification and hydraulic-fidelity risks remain open** and are the dominant
reason live-operation readiness is **not** established. A defensible reviewer position is:
**GO for continued software hardening / internal simulation use; NO-GO for any live,
hardware-driving site until AF-HUB-011 (real bench commissioning) passes.**

*— End of evidence pack. Verdict to be completed by the independent reviewer in §0/§6.*
