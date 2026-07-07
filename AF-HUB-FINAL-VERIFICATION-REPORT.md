# AF-HUB-FINAL-VERIFY — Complete Product Verification Report

**Date:** 2026-07-07 · **Verifier:** Claude Code · **Repo:** `burook-Luxury/aquaflow-studio`
**Method:** clean-cache test runs, file:line architecture walk, full stub audit, doc-consistency
grep, live production-mode server run, live installer tamper/license demo.
**Ground rule applied:** every problem found was **fixed first**, then re-verified (4 fixes — §0).

---

## 0. Problems FOUND AND FIXED during this verification

The point of this pass was to find things before the reviewers do. It found four:

| # | Finding | Severity | Fix |
| --- | --- | --- | --- |
| V1 | `/api/mobile/command` bypassed every single authority: `estop` tripped only the safety kernel (partial E-stop), `blackout` zeroed only the bus, `reset` skipped gated recovery, and **play/pause/stop/seek drove the demoted RuntimeTransport mirror — post-013 they no longer controlled playback at all** | **BUG (safety + functional)** | All mobile commands now route through `runtime_authority` / `show_engine` (the same authorities as every other entry point) + 4 regression tests (`tests/test_mobile_command_authority.py`) |
| V2 | phase6 `artnet/sacn blackout` endpoints called `protocol_bus.blackout()` directly — a partial blackout (missed hardware_output), i.e. a second blackout path | **BUG (split authority)** | Both delegate to `runtime_authority.blackout()`; test updated to the richer contract |
| V3 | DMX-class **seed device without an explicit `dmxAddress` (fog-01)** fell through to channel 1 / universe 0 — the exact AF-HUB-015 hazard surviving via the seed path; and `update_dmx_map` **clamped** invalid entries onto channel 1 instead of rejecting them | **BUG (fail-open output)** | Seed devices count as mapped only with an explicit `dmxAddress`; invalid map entries are rejected (fail-closed) + 3 regression tests |
| V4 | Protocol matrix said "OPC UA: no implementation exists" while `plc/plc_engine.py::OPCUADriver` is a real PLC tag client — a reviewer would call that a contradiction | WARNING (doc precision) | Matrix now distinguishes the bus transport (UNSUPPORTED) from the real, fail-closed PLC tag client |

All four are committed in this verification's commit. Suite re-run green after each fix.

---

## Part 1 — Full test suite (clean run, caches deleted first)

```
Backend:  532 passed / 21 skipped / 0 failed / 0 errors / 59% line coverage
Frontend: 231 passed / 0 failed  (20 files)
Build:    clean (vite production build, no warnings)
```

- The 21 skips: `test_fix_strategy_engine.py` needs the transient `EVALUATION_REPORT.md`
  (absent on a clean checkout — AF-HUB-008 behavior, intentional).
- The 1 pytest warning is a **third-party** deprecation inside FastAPI's own
  `testclient.py` (`.venv`), not our code.
- Cross-platform note: this run is Windows. The one Linux-only failure Genspark measured
  (`test_path_style_does_not_change_fingerprint`) is fixed by AF-HUB-019 with a
  host-agnostic implementation (never calls `os.path`), locked by
  `test_basename_is_host_agnostic`.

## Part 2 — Architecture integrity walk (file:line for every claim)

**2A. Single playback authority — VERIFIED**
- The only playback loop: `engine/show_engine.py:33` (`TICK_RATE = 100`), `:341`
  (`_playback_loop`), created at `:291`/`:302` (play/record — same loop fn, prior task
  cancelled first). The only other `create_task` in engine/ is
  `device_manager.py:71` — a health monitor, not playback/output.
- Transport demoted: `engine/runtime_transport.py:75` (`TIMING_AUTHORITY = False`), `:243`
  (`start()` sets `_running = False`, no loop), `:255` (`sync_from_engine` — the only way
  its position advances). No dispatch path (asserted by `test_playback_authority.py`).
- Architecture doc: `aquaflow/docs/RUNTIME_ARCHITECTURE.md` names ShowEngine.

**2B. Single E-stop / blackout / recovery authority — VERIFIED (after V1+V2 fixes)**
- E-stop: `engine/runtime_authority.py:76`; chain = safety.emergency_stop →
  show_engine.emergency_stop → protocol_bus.emergency_stop → hardware_output.blackout_all
  → device_manager (skip-if-absent). Entry points all delegate: `main.py:568` (WS),
  `api/routes/devices.py:160`, `api/routes/phase6_routes.py:47`, and (fixed here)
  `api/routes/mobile_routes.py`.
- Blackout: `engine/runtime_authority.py:95`; delegated from `devices.py:111`, phase6
  artnet/sacn blackout (fixed here), mobile (fixed here).
- Recovery: `engine/runtime_authority.py:105`; blockers checked at `:118` **before**
  `reset_faults` at `:125`; `safety/safety_kernel.py:161` itself also checks inputs first
  and `:173` names each blocker. Refused recovery preserves fault evidence
  (`test_failure_recovery.py`).

**2C. Fixture store integrity — VERIFIED**
- Master: `frontend/src/store/engineeringStore.js:48`. Dead mirror deprecated:
  `showStore.js:1063` (comment above bars new callers).
- Divergence guard: `runtime/fixtureProjection.js` (`assertFixtureConsistency`), called on
  sync at `hooks/useServerShowSync.js:44`.
- Propagation master → timeline/backend payload/runtime registry proven by
  `runtime/__tests__/fixtureProjection.test.js` (edit propagates to all three).

**2D. DMX patch integrity — VERIFIED (after V3 fix)**
- One patch reader: `frontend/src/runtime/dmxPatch.js` (`readPatch`); conflict detection
  `dmxPatch.js:103` (`findAddressConflicts`), agrees with the dependency graph (tested).
- Fail-closed routing: `backend/engine/protocol_bus.py:624` (Modbus) and `:660` region
  (DMX) — unmapped → `_note_unmapped` → **zero output**; real-hardware mode blocks playback
  (`show_engine.play` unmapped check; `test_fail_closed_routing.py`).
- Channel-1 fallback grep: the last survivor (seed device without explicit address, and
  map-entry clamping) **found and removed in this verification (V3)**.

**2E. Protocol honesty — VERIFIED**
- `PROTOCOL_SUPPORT` map: `engine/protocol_bus.py:29`; `SUPPORTED = REAL_PROTOCOLS` at
  `:286` (dmx/artnet/sacn/modbus only). MQTT fails closed (`connect`→False `:104`,
  `send`→False `:118`, `is_connected` always False). OPC UA `:35` / BACnet `:36`
  UNSUPPORTED. Endpoint: `GET /api/hardware/protocols`
  (`api/routes/hardware_routes.py:50`) — *note: the task text guessed
  `/support-matrix`; the actual path is `/protocols`.* Live-verified in Part 5.

**2F. Honest hardware labeling — VERIFIED**
- Flag read-only from env: `services/commissioning.py:42` (`os.getenv`, default FALSE —
  anything non-truthy is FALSE). Grep confirms **no API can set it**.
- SIMULATED while FALSE: `hardware_verifier.run_full_verification` gates
  `deployment_ready`/`real_hardware_verified`; live-verified in Part 5
  (`verification_mode: SIMULATED`, `commissioned: false`, banner text served).
- UI banner: `frontend/src/App.jsx:49/:69` (`CommissioningBanner`).

**2G. Safety environment lock — VERIFIED (live)**
- Gate: `services/bench_safety.py:52` (`safety_bypass_allowed`) — commissioned ⇒ always
  refused; production (no dev flag) ⇒ refused; only dev+unsafe+uncommissioned allows.
- Live test (Part 5): started production server **with `AQUAFLOW_UNSAFE_DEV=true` set** →
  log shows `BENCH SAFETY LOCK — unsafe dev flag(s) requested but BLOCKED`.

**2H. Protocol bus singleton — VERIFIED**
- Primary guard: `engine/protocol_bus.py:300` (second primary → RuntimeError); accessor
  `:820` returns the app singleton, never creates (`test_protocol_bus_singleton.py`).

**2I. Runtime bridge status — VERIFIED**
- `services/runtime_bridge.py:63` (`IS_PRODUCTION_PATH = False`), INTERNAL/TEST-ONLY
  banner in the module docstring; grep-test proves **zero production imports**
  (`test_runtime_bridge_decision.py`).

**2J. Crash fingerprinting — VERIFIED**
- `services/crash_reporter.py:47` (`_basename` splits on both `/` and `\`); **no live
  `os.path.basename` call remains** (docstring mention only).

## Part 3 — Stub and fake-success audit (full backend grep)

| Finding | Location | Classification |
| --- | --- | --- |
| `raise NotImplementedError` ×5 | `plc/plc_engine.py:89–101` | **OK** — abstract driver base; real subclasses exist (SiemensS7 `:104`, ModbusTCP `:306`, OPCUA `:400` — the OPC UA client is real: requires `asyncua`, fails closed without it) |
| `scan_network` "stub" | `engine/device_manager.py:118` | **WARNING (disclosed)** — network "scan" returns already-known devices; no real discovery. Not a safety path; disclosed here and in §4 of the pack |
| MQTT "stub" mentions | `engine/protocol_bus.py:7/:34/:244` | **OK** — that's the GATED fail-closed documentation itself |
| `_analyze_bpm` placeholder | `services/show_programmer_service.py:389` | **WARNING (disclosed)** — audio-BPM analysis returns a synthetic 128.0 (AI/audio feature, not a safety path). Real analysis is a future feature |
| AI choreography placeholder | `services/show_programmer_service.py:1132` | **WARNING (disclosed)** — deterministic heuristic generation labeled as AI-to-be-enhanced; produces real clips, not fake success |
| checksum/fileSize "placeholder" | `services/show_programmer_service.py:1747` | **OK** — two-pass pattern; real SHA + size filled immediately after (`show.calculate_checksum()`) |
| "stubs" in `pid_generator.py:245` | — | **OK** — domain term (pipe suction/discharge stubs in an ISA drawing) |
| TODO/FIXME/HACK/XXX in engine/ + services/ | — | **ZERO hits** |

**No undisclosed fake-success on any production or safety path remains.** (The one found
— seed-device channel-1 fallback — is V3, fixed.)

## Part 4 — Document consistency

- Test counts: every current-claim reference across all `.md` files = **532 / 21 / 231 /
  59%** (grep for every historical number — 437/473/488/513/521/525 — returns only
  explicitly-marked point-in-time/HISTORICAL entries; zero stale current-claims).
- README production startup: `python main.py` (no reload); `--reload` appears **only**
  in the explicit developer-mode section.
- Canonical status ⇄ acceptance pack ⇄ audit evidence: all agree (same numbers, same task
  states, same commit hashes).
- Support-matrix doc ⇄ live endpoint: verified identical in Part 5 (usable =
  dmx/artnet/sacn/modbus; mqtt GATED; opcua/bacnet UNSUPPORTED) + OPC UA nuance added (V4).

## Part 5 — Production startup verification — PASS (live run)

Started `python main.py` in production mode **with `AQUAFLOW_UNSAFE_DEV=true` deliberately
set** to prove the lock:

- ✅ `[startup] PRODUCTION MODE — no reload, no dev watchers` (no reloader/watchfiles in log)
- ✅ `BENCH SAFETY LOCK — unsafe dev flag(s) requested but BLOCKED` (flag ignored + logged)
- ✅ `/api/health` → `api: ok`, `status: degraded` — **honestly** degraded (2 seed devices
  offline + 1 warning at cold start), commissioning `SIMULATED`
- ✅ `/api/hardware/protocols` → usable `[dmx, artnet, sacn, modbus]`, mqtt GATED, opcua UNSUPPORTED
- ✅ `/api/hardware/commissioning` → `commissioned: false` + banner text
- ✅ Clean shutdown — **no orphaned processes**

## Part 6 — Installer integrity — PASS (tests + live demo)

- ✅ 37 installer/license tests green (`test_installer.py`, `test_installer_integrity_license.py`, `test_license_portal.py`)
- ✅ **Live tamper demo:** fresh install verifies ok → appended bytes to
  `config/app_config.json` → `verify()` reports `corrupted (checksum mismatch)`
- ✅ **Live license edge cases (no crashes, graceful statuses):** valid→VALID, wrong
  machine→INVALID_HW, tampered field→INVALID_SIG, garbage/missing→INVALID_SIG,
  expired→EXPIRED. Machine lock = hardware fingerprint binding.
- Honest note: what exists is the install/update/rollback/activation **framework**
  (manifest, checksums, semver updates, license engine + seat portal), fully tested. A
  packaged standalone `.exe/.msi` installer is the future product-packaging task, not
  claimed here.

## Part 7 — Evidence package updates

- `AF-HUB-012_TIER_A_ACCEPTANCE_PACK.md` — final counts (532/21/0, 59%, 231), full
  corrective trail 013–020 with hashes, live-path §2.4, this verification appended.
- `AF-HUB-009_AUDIT_EVIDENCE.md` — final numbers + both-reviewers note.
- `AQUAFLOW_STATUS_CANONICAL.md` — final state; `CURRENT_STATUS.md` / `HANDOVER.md`
  banners updated. All three primary docs agree (Part 4 grep).
- Corrective commits: 013 `b077c49` · 014 `9ddfa7a` · 015 `672a866` · 016 `83c5883` ·
  017 `ef2d20d` · 018 `88d9c52` · 019 `7fb874e` · 020 `9fdec68` · this verification —
  the commit containing this report.

## Part 8 — Honest self-assessment

**1. Actual Tier A software readiness:** ~**60%** overall Tier A. The *software* half of
Tier A is now substantially complete and verified (integration, data contracts, single
authorities, fail-closed output, honest labeling, environment lock — all with file:line
evidence and regression tests). But Tier A *by definition* includes verified real-hardware
output and live-hardware safety behavior, and that half is 0% until the AF-HUB-011 bench.
I will not inflate the number because the software half went well. (The canonical 55% was
set before the corrective rounds; ~60% is my honest post-corrective estimate — the
independent reviewer should set the final number.)

**2. Known limitations to state upfront (scope, not bugs):**
- Real DMX/Art-Net/Modbus hardware output is UNVERIFIED (flag FALSE; SIMULATED banner) — bench pending.
- Hydraulic engine uses linear approximations (no Hazen-Williams / Darcy-Weisbach).
- Device "network scan" returns known devices; no real discovery protocol.
- Audio BPM analysis and "AI" choreography are deterministic placeholders (feature, not safety).
- Licensing is HMAC-SHA256 with a server-side env secret, not the Ed25519 the older docs
  claimed (fine for internal; reconcile before external claims).
- Backend line coverage is 59% — honest, not great; the safety-critical paths are the
  best-covered, but plenty of service code is validate-harness-covered only.
- MQTT/OPC UA/BACnet are not show-output transports (GATED/UNSUPPORTED); the PLC subsystem's
  OPC UA tag client is real but optional-dependency-gated.

**3. Residual uncertainty (disclosed, not hidden):**
- Linux run: I fixed the one failure Genspark measured with a host-independent
  implementation, but I could not re-run the full suite on Linux from this Windows
  machine — Genspark should confirm 532/21/0 on their runner.
- The E2E playback smoke and playback-authority tests use real asyncio timing
  (~0.1–0.35 s sleeps); on a heavily loaded CI machine they could in principle be flaky.
  I have not observed a flake across the many full runs this session.
- The frontend has no DOM-level tests (node-env only) — UI rendering regressions would
  not be caught by the suite.
- `validate_*.py` harnesses (~40 scripts) are not part of the pytest count; I did not
  re-run all of them this pass.

**4. "If I were the reviewer, what would I attack first?"** — The mobile/remote-control
route (an entry point added before the authority consolidation and easy to miss). I
attacked it: **it was indeed broken** (V1 — partial E-stop, dead play path) and is now
fixed with regression tests. Second attack: seed-device address defaults around the
fail-closed routing — **also broken** (V3), also fixed. Third: doc-vs-code contradictions
(OPC UA) — found (V4), fixed.

**5. Is the acceptance pack honest?** Yes — every claim in it now has a file:line or a
test name behind it (Part 2 above is that mapping), the limitations are stated in the pack
itself, and the two things it does NOT claim are exactly the two that remain: real-hardware
verification (011) and the independent verdict (009).

---

*Verification performed 2026-07-07. Four defects found were fixed and regression-tested
before this report was written; the final numbers above are from the post-fix run.*
