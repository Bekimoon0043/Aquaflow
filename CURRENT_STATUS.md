# AquaFlow Studio — Current Status

**Date:** 2026-07-03
**Summary:** Stage 2 — AQ-S2-007 Automatic P&ID Generator complete: auto ISA-5.1 symbols, printable SVG/HTML output, and revision tracking.

## Completed
- **AQ-S2-007 Automatic P&ID Generator — DONE on `main` (Stage 2).**
  - New [services/pid_generator.py](aquaflow/backend/services/pid_generator.py): builds a printable
    P&ID from an equipment model or straight from a hydraulic network.
  - **Generates ISA symbols automatically** — each equipment/instrument type maps to a standard
    ISA-5.1 symbol (centrifugal pump, valve bow-tie, vessel/reservoir, nozzle, instrument balloons
    PT/FT/LT/…) with no manual drawing; type aliases normalized automatically.
  - **Produces printable output** — well-formed **SVG** (validated as XML) with drawing border +
    title block, plus a **print-ready HTML** wrapper (`@page` A3, `@media print`, `window.print()`).
  - **Supports revision tracking** — auto-incrementing revisions (0,1,2 or A,B,C), a revision-history
    table, and the current revision stamped into the title block.
  - API: `POST /api/pid/generate` and `/from-network` (`?format=json|svg|html`)
    ([pid_routes.py](aquaflow/backend/api/routes/pid_routes.py)), wired in main.py.
  - **Verification: 25/25** ([validate_pid_generator.py](aquaflow/backend/validate_pid_generator.py))
    (XML-parsed structure checks); **7 pytest cases**
    ([test_pid_generator.py](aquaflow/backend/tests/test_pid_generator.py)) → backend pytest now **50 passing**.

- **AQ-S2-005 Nozzle Performance Database — DONE on `main` (Stage 2).**
  - New [services/nozzle_database.py](aquaflow/backend/services/nozzle_database.py): nozzle models
    keyed by manufacturer catalog, built on the orifice law **Q = K·√P**.
  - **Stores K factors** (explicit, or least-squares-derived from a catalog curve).
  - **Pressure-flow interpolation** across tabulated manufacturer points in the **sqrt(P) domain**
    (exact for an ideal nozzle), with a self-consistent forward/inverse round-trip and jet-height
    interpolation.
  - **Manufacturer catalogs** — multiple catalogs loadable from JSON; seed catalogs in
    [data/nozzle_catalogs.json](aquaflow/backend/data/nozzle_catalogs.json) (AquaFlow Standard + OASE).
  - API: `GET /api/nozzles/manufacturers|models|models/{id}`, `POST /api/nozzles/query|catalog`
    ([nozzles_routes.py](aquaflow/backend/api/routes/nozzles_routes.py)), wired in main.py.
  - **Verification: 18/18** ([validate_nozzle_database.py](aquaflow/backend/validate_nozzle_database.py))
    against independent Q=K√P + interpolation hand-calcs; **9 pytest cases**
    ([test_nozzle_database.py](aquaflow/backend/tests/test_nozzle_database.py)) → backend pytest now **43 passing**.

- **AQ-S2-003 Pipe Sizing Engine — DONE on `main` (Stage 2).**
  - New [services/pipe_sizing.py](aquaflow/backend/services/pipe_sizing.py): velocity-based sizing
    (`v = Q/A`) against a configurable [v_min, v_max, v_target] band and a standard DN catalog.
  - **Suggests optimal diameter** — rounds the target-velocity diameter up to the next standard
    size (velocity lands at/just below v_target, with head-loss margin).
  - **Detects undersized** (v > v_max) and **oversized** (v < v_min) pipes, each with a suggested
    replacement size and a clear message; limits fully configurable.
  - Integrates with the hydraulic solver: `size_network()` solves for flows (AQ-S2-001) then sizes
    every pipe. API: `POST /api/hydraulics/size` and `/size-network`
    ([hydraulics_routes.py](aquaflow/backend/api/routes/hydraulics_routes.py)).
  - **Verification: 18/18** ([validate_pipe_sizing.py](aquaflow/backend/validate_pipe_sizing.py))
    against independent velocity hand-calcs; **8 pytest cases**
    ([test_pipe_sizing.py](aquaflow/backend/tests/test_pipe_sizing.py)) → backend pytest now **34 passing**.

- **AQ-S2-001 Hydraulic Network Solver — DONE on `main` (Stage 2).**
  - New [services/hydraulic_solver.py](aquaflow/backend/services/hydraulic_solver.py): steady-state
    pipe-network solver via the **Global Gradient Algorithm** (Todini-Pilati, the EPANET method) —
    a Newton-Raphson solve of the coupled energy+continuity system on the weighted graph Laplacian,
    so branched (tree), looped, and closed-loop recirculating topologies are handled uniformly.
  - Computes **flow at every pipe/node** (mass conserved at every node) and **head/pressure at every
    node** (reported in m, kPa, bar). Hazen-Williams (default) and Darcy-Weisbach head-loss models,
    optional minor losses; topology auto-classified (independent loops via circuit rank).
  - API: `POST /api/hydraulics/solve` ([hydraulics_routes.py](aquaflow/backend/api/routes/hydraulics_routes.py)),
    wired in [main.py](aquaflow/backend/main.py).
  - **Verification: 26/26** ([validate_hydraulic_solver.py](aquaflow/backend/validate_hydraulic_solver.py)) —
    each scenario checked against an independent hand calc + conservation laws (series, branched tree,
    symmetric loop even-split, asymmetric loop analytic split under Darcy, pump recirculation loop).
    Also **7 pytest cases** ([test_hydraulic_solver.py](aquaflow/backend/tests/test_hydraulic_solver.py))
    folded into the suite → backend pytest now **26 passing**.

## Prior (Stage 1)
- **AQ-S1-009 Automated test harness — DONE on `main`.**
  - **Backend pytest suite** (`backend/tests/`, config [pytest.ini](aquaflow/backend/pytest.ini)) —
    schema/runtime contracts (aqua↔canonical round-trip, `RuntimeSession`/
    `RuntimeCommand`), fixture→registry routing + conflict flagging, output-path safety gate,
    and an **end-to-end playback smoke test** ([test_e2e_playback_smoke.py](aquaflow/backend/tests/test_e2e_playback_smoke.py))
    driving the real `ShowEngine` load→play→tick→stop with a capturing bus.
  - **Frontend vitest suite** (`src/utils/__tests__/`, config [vitest.config.js](aquaflow/frontend/vitest.config.js)) —
    **17 passing**: the fixture-type **resolver** and the runtime-signal **projection**
    (`deriveRuntimeSignals`).
  - Test deps added to [requirements.txt](aquaflow/backend/requirements.txt) (pytest, httpx) and
    `package.json` (vitest); `.venv`/`.pytest_cache`/coverage gitignored; how-to in
    [TESTING.md](aquaflow/TESTING.md).

- **AQ-S1-007 Safety limits in output path — DONE on `main`.**
  - `ProtocolBus._route_command` now routes every command through `_safety_gate()`,
    the single choke point before hardware emit
    ([protocol_bus.py](aquaflow/backend/engine/protocol_bus.py)).
  - **Per-fixture intensity clamped:** per-fixture ceilings (`set_fixture_limit`) plus a
    global cap are applied and clamped to [0,1]; caps are carried from designed fixtures'
    `maxIntensity` in `apply_show_payload` ([app_state.py](aquaflow/backend/app_state.py)).
  - **Flame duration enforced at hardware level:** `_enforce_flame_duration` cuts a flame
    off after `FLAME_MAX_DURATION` (3 s) of continuous on-time and latches it off until the
    show drops it to zero / a command gap ends the burst — independent of the safety kernel.
  - **Safety kernel active during all output:** the bus is wired to the kernel at startup
    ([main.py](aquaflow/backend/main.py)); no master permit → all output zeroed, and each
    per-subsystem enable (pump/valve/flame/laser/fog/lighting) gates its emits.
  - **Validation harness: 15 / 15 PASS** ([validate_safety_output_limits.py](aquaflow/backend/validate_safety_output_limits.py)).

- **AQ-S1-005 Multi-universe + audio end-to-end — DONE on `main`.**
  - Art-Net `ArtNetDriver` no longer wraps universes at `% 4`; buffers are allocated
    on demand across the full 15-bit space (0–32767), with out-of-range frames rejected
    ([protocol_bus.py:37](aquaflow/backend/engine/protocol_bus.py#L37)).
  - Audio route hardened so the **real** librosa/numpy path is actually taken:
    tempo unwrapped for numpy 2.x (`np.atleast_1d(tempo)[0]`), profile normalizers
    guarded against divide-by-zero, and section segmentation isolated so a
    sklearn/segmentation hiccup can no longer discard real BPM/beats
    ([audio.py](aquaflow/backend/api/routes/audio.py)).
  - numpy 2.4.5 / librosa 0.11.0 / soundfile / scikit-learn 1.8.0 all present and exercised.
  - **Validation harness: 18 / 18 PASS** ([validate_multiuniverse_audio.py](aquaflow/backend/validate_multiuniverse_audio.py)) — 8 live universes with no aliasing + a generated 120 BPM click track analysed to real beats (confidence 0.92, BPM ≈ 117).

- **AQ-S1-003 Hardware conflict detection — DONE on `main`.**
  - `ShowEngine.get_hardware_conflicts()` derives duplicate/overflow addresses from the
    DeviceRegistry validation computed at show-apply time
    ([show_engine.py:161](aquaflow/backend/engine/show_engine.py#L161)).
  - `ShowEngine.play()` is now a pre-flight gate: it refuses to start and returns `False`
    when conflicts exist, setting a clear operator error in `last_error`
    ([show_engine.py:181](aquaflow/backend/engine/show_engine.py#L181)).
  - `get_state()` exposes `hardware_conflicts` + `error`; `load_show()` clears the block for a fresh show.
  - `main.py` WS `play` handler and `scheduler_start_show` broadcast the error and abort when blocked.
  - `/operator/status` returns an explicit `hardware_conflicts` list
    ([phase7_routes.py:184](aquaflow/backend/api/routes/phase7_routes.py#L184)).
  - Operator panel shows a red **HARDWARE ADDRESS CONFLICT — SHOW BLOCKED** banner and
    disables PLAY while conflicts exist
    ([OperatorPanel.jsx](aquaflow/frontend/src/components/panels/OperatorPanel.jsx)).
  - **Validation harness: 9 / 9 PASS** ([validate_hardware_conflict.py](aquaflow/backend/validate_hardware_conflict.py)); AQ-S1-001 harness still 21 / 21; frontend build clean.

- **AQ-S1-001 Backend fixture-aware architecture — verified DONE on `main` (commit `118ba6e`).**
  - `show_engine.get_snapshot()` carries `fixtures` + `groups` + `deviceRegistry` summary
    ([show_engine.py:492-494](aquaflow/backend/engine/show_engine.py#L492)).
  - `protocol_bus.configure_from_fixtures()` populates `_fixture_registers` from the designed
    fixtures, and `_route_command` routes Modbus to those first
    ([protocol_bus.py:292](aquaflow/backend/engine/protocol_bus.py#L292),
    [:394](aquaflow/backend/engine/protocol_bus.py#L394)).
  - `apply_show_payload` builds a `DeviceRegistry` via the new
    `services/fixture_registry_bridge.py` and hands it to the bus, so a designed show reaches
    real hardware addresses.
  - **Validation harness: 21 / 21 PASS** ([validate_fixture_aware.py](aquaflow/backend/validate_fixture_aware.py)).

## Prior sessions (recap)
- 2026-07-02: full setup — repo, Claude Code, 3 bug fixes, codebase audit (33%),
  AI Command Hub v2.9 (8 tabs, 129 tasks, DeepSeek Forex math framework, auto-report bridge).
- Detailed engineering audit preserved in [aquaflow/docs/AUDIT_20260702.md](aquaflow/docs/AUDIT_20260702.md).
- Chief Architect roadmap preserved in [aquaflow/docs/MASTER_ROADMAP_ChatGPT_v1.0.txt](aquaflow/docs/MASTER_ROADMAP_ChatGPT_v1.0.txt).

## Next session starts with
**AQ-S2-002 — Pump curve import & duty-point (Stage 2).** Depends on AQ-S2-001 (done).
Acceptance: imports manufacturer pump curves · auto-calculates duty point · flags off-curve
operation. The hydraulic solver's system head (from
[hydraulic_solver.py](aquaflow/backend/services/hydraulic_solver.py)) provides the system curve
to intersect with the pump curve for the duty point. The pipe sizing engine (AQ-S2-003) sizes the
network, and the nozzle database (AQ-S2-005) provides nozzle Q=K√P demands feeding the system curve.

Also still open in Stage 1: **AQ-S1-002 — Automatic DMX address assignment** (foundation exists in
`fixture_registry_bridge.build_registry_from_fixtures()`; extends into the UI + WS surface).

## Standing workflow
Defined in [CLAUDE.md](CLAUDE.md): update `CURRENT_STATUS.md`, write
`session-report.json` (in the hub's bridge folder), commit, push — every session end.
