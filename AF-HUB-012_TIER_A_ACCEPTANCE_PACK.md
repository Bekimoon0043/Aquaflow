# AF-HUB-012 — AquaFlow Tier A Acceptance Pack

> ## 🟡 ACCEPTANCE STATUS: NOT YET GRANTED — two gates outstanding
>
> This pack **assembles the evidence** for Tier A acceptance and **defines the acceptance
> criteria and sign-off**. It does **not** by itself grant Tier A. Two gates remain, and
> neither can be closed by Claude Code:
>
> 1. **AF-HUB-011 — real bench commissioning** is *deferred / not yet executed*. Real
>    DMX/Art-Net/Modbus output is still **UNVERIFIED**; `AQUAFLOW_HARDWARE_COMMISSIONED`
>    is **FALSE** and the system correctly reports `SIMULATED` / `deployment_ready:false`.
> 2. **AF-HUB-009 — independent GO/NO-GO verdict** is *pending* an external reviewer
>    (must not be Claude Code self-grading).
>
> Tier A is **accepted only** when both are closed and the sign-off below is completed.

- **Prepared:** 2026-07-06 · **Audit commit:** `f581333` · **Repo:** `burook-Luxury/aquaflow-studio`
- **Canonical status:** `AQUAFLOW_STATUS_CANONICAL.md` (~55% Tier A readiness at prep time)

---

## 1. Scope of Tier A

Tier A = the software is hardened, honest, and integration-complete, AND its real hardware
output + safe-shutdown behaviour are **verified on a real bench** and **independently
signed off** — the minimum bar before any live, hardware-driving fountain site.

## 2. Evidence inventory (verifiable)

### 2.1 Automated test + build evidence (post-corrective authoritative run)

| Item | Result | Reproduce |
| --- | --- | --- |
| Backend pytest (full, no ignores) | **525 passed, 21 skipped, 0 errors** | `aquaflow/backend`: `./.venv/Scripts/python.exe -m pytest` |
| Backend line coverage | **59%** (`pytest --cov`) | `aquaflow/backend`: `./.venv/Scripts/python.exe -m pytest --cov=.` |
| Frontend vitest | **231 passed (20 files)** | `aquaflow/frontend`: `npx vitest run` |
| Frontend production build | **green** | `aquaflow/frontend`: `npm run build` |

The 21 skips are the fix-strategy contract tests, which require the transient
`EVALUATION_REPORT.md` artifact (absent on a clean checkout — see AF-HUB-008).

### 2.2 Software hardening trail (AF-HUB-000 … 010)

| Task | Commit | Deliverable |
| --- | --- | --- |
| 000 / 000B / 000C | feec4b4 / 026c8b1 / 4246006 | Green suite · production startup · honest hardware labeling (commissioning flag, default FALSE) |
| 001 / 002 / 003 | 151c34b / addc913 / 2f00a30 | Archived dead variants · canonical fixture-type resolver · geometry/axis contract |
| 004 / 004B / 005 | 04be522 / a010785 / bef93c6 | Fixture-store unification + projection · DMX patch unification · backend fixture-aware sync pipeline |
| 006 / 006B | e8ddf89 / 0928606 | Route/singleton wiring repair · single runtime-authority E-stop |
| 007 / 007B / 007C | 19912bd / 7ed3858 / 0537cc1 | Safety-path stub burn-down · runtime health verdict · gated failure recovery |
| 008 / 009B / 010 | 074dd4a / d66a7da / 334a24c | Test stabilization + coverage · internal installer + license validation · hardware verification harness prep |
| **013 / 014 / 015** | b077c49 / 9ddfa7a / 672a866 | **Stage-7 corrective (ChatGPT review):** playback authority locked to one 100 Hz loop · protocol support honesty gate (MQTT fails closed) · fail-closed output routing (unmapped fixtures cannot reach hardware) |
| **016 / 017 / 018** | 83c5883 / ef2d20d / 88d9c52 | **Stage-7 corrective (ChatGPT review):** protocol-bus singleton lockdown · evidence consistency pass · bench safety environment lock |
| **019 / 020** | 7fb874e / 9fdec68 | **Stage-7 corrective (Genspark review — ran on Linux):** cross-platform crash fingerprint (split on `/` and `\`) · runtime-bridge retired from the supported surface (test-only; live path documented) |

### 2.3 Hardware-readiness artifacts (prepared; execution pending)

- `aquaflow/backend/hardware_verification_harness.py` — on-site verification harness (loopback self-test + real-target transmission), honestly gated (never self-certifies).
- `HARDWARE_COMMISSIONING_CHECKLIST.md` — on-site runbook + two-signature sign-off.
- `AF-HUB-011_COMMISSIONING_RECORD.md` — blank results record for the bench run.
- `AF-HUB-009_AUDIT_EVIDENCE.md` — evidence pack for the independent reviewer.

### 2.4 Live production output path (AF-HUB-020)

The ONE supported live path from a playing show to hardware is:

```
show_engine._playback_loop (single 100 Hz authority) → protocol_bus._route_command → real drivers
```

`services/runtime_bridge.py` (ProtocolRouter / RuntimeBridge) is **INTERNAL / TEST-ONLY**
and is **not** part of the supported production surface: it dispatches through a bus
interface only the in-memory `VirtualProtocolBus` implements, so it runs in unit tests
only, never in the live runtime (`runtime_bridge.IS_PRODUCTION_PATH == False`, asserted by
tests). No API route exposes it (the `/runtime/status` endpoint is the unrelated
compiler-bridge). See `aquaflow/docs/RUNTIME_ARCHITECTURE.md`.

## 3. Tier A acceptance criteria (checklist)

| # | Criterion | State | Source of truth |
| --- | --- | --- | --- |
| 1 | Automated test suite green (backend + frontend) | ✅ MET | §2.1 |
| 2 | Backend fixture-aware; designed shows build a hardware address registry | ✅ MET | AF-HUB-005 + tests |
| 3 | Single-authority E-stop halts ALL output; gated recovery | ✅ MET | AF-HUB-006B / 007C + tests |
| 4 | No safety-path fakes success; runtime health verdict honest | ✅ MET | AF-HUB-007 / 007B + tests |
| 5 | Honest hardware labeling (SIMULATED until commissioned) | ✅ MET | AF-HUB-000C |
| 6 | Internal installer + license validation | ✅ MET | AF-HUB-009B + tests |
| 7 | **Real DMX/Art-Net/Modbus output verified on a real bench** | ⛔ **NOT MET** | **AF-HUB-011 (deferred)** |
| 8 | **Live-hardware safety verified (E-stop/blackout/flame cutoff on real fixtures)** | ⛔ **NOT MET** | **AF-HUB-011 (deferred)** |
| 9 | **Independent GO/NO-GO verdict recorded** | ⛔ **NOT MET** | **AF-HUB-009 (pending reviewer)** |

**6 of 9 criteria met.** Criteria 7–9 are the hardware/independent gates and cannot be
met by software work.

## 4. Known open items carried into acceptance (disclose, do not hide)

- **[CRITICAL] Real hardware output unverified** until AF-HUB-011 (bench). Commissioning flag FALSE.
- **[HIGH] Hydraulic engine** uses linear approximations, not Hazen-Williams / Darcy-Weisbach. Not in the AF-HUB plan; open.
- **Coverage** now measured (AF-HUB-017): backend line coverage **59%** (`pytest --cov`).
- **Licensing doc discrepancy** — docs say Ed25519; implementation is HMAC-SHA256 (env secret, server-side). Acceptable for internal use; reconcile before external claims.

## 5. Final acceptance & sign-off (completed only after gates 7–9 close)

Attach: the signed `HARDWARE_COMMISSIONING_CHECKLIST.md` + `AF-HUB-011_COMMISSIONING_RECORD.md`,
all harness `*.json` outputs, and the independent AF-HUB-009 verdict.

- [ ] AF-HUB-011 completed on real hardware; `AQUAFLOW_HARDWARE_COMMISSIONED=1`; `/api/hardware/verify` → `real_hardware_verified: true`, `deployment_ready: true`.
- [ ] AF-HUB-009 independent verdict = **GO**, recorded and attached.
- [ ] All 9 criteria in §3 now MET.

**Tier A ACCEPTED:** ☐ YES ☐ NO
- **Independent reviewer (009):** ____________________  **Signature:** __________  **Date:** __________
- **Commissioning engineer (011):** ____________________  **Signature:** __________  **Date:** __________
- **Accepting authority (CEO / site owner):** ____________________  **Signature:** __________  **Date:** __________

> Until all three signatures are present with every criterion MET, AquaFlow is **NOT**
> Tier A accepted and **no live, hardware-driving show may run**. Software may continue to
> be used for design and SIMULATED operation.
