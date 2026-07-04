# AquaFlow Studio — Current Status

**Date:** 2026-07-04
**Summary:** Recovery — AQ-X-001 Automatic DMX Address Assignment complete: conflict-free allocation for all fixture types with manual-override support.

## Completed
- **AQ-X-001 Automatic DMX Address Assignment (recovery) — DONE on `main`.**
  - New [services/dmx_assigner.py](aquaflow/backend/services/dmx_assigner.py): the conflict-free DMX
    allocator that turns a set of fixtures into concrete (universe, channel) addresses.
  - **Auto-assignment for all fixture types** — a profile/type → channel-width map (`channels_for`)
    sizes dimmers, RGB/RGBW/RGBA, moving heads, lasers, fog/haze, pixel bars, etc.; unknown fixtures
    fall back through a type-token guess to a safe default of 1.
  - **Conflict-free allocation** — a channel-occupancy grid reserves every used slot, unlocked
    fixtures are first-fit packed into the free gaps, universes roll at 512, and no two fixtures ever
    share a channel; genuine overlaps are reported rather than silently overwritten.
  - **Manual override** — any fixture with an explicit universe+channel (or `locked`) keeps its
    address; everything else packs *around* it. This closes the prior gap where
    `DeviceRegistry.auto_assign_dmx` packed from channel 1 and could land on top of a manually-pinned
    fixture. `auto_assign_dmx` now reserves already-registered DMX devices before packing, so the
    fixture-bridge path is conflict-free with manual addresses.
  - API: `POST /api/dmx/auto-assign`, `GET /api/dmx/profiles`
    ([dmx_routes.py](aquaflow/backend/api/routes/dmx_routes.py)), wired in main.py.
  - **Verification: 24/24** ([validate_dmx_assigner.py](aquaflow/backend/validate_dmx_assigner.py));
    **9 pytest cases** ([test_dmx_assigner.py](aquaflow/backend/tests/test_dmx_assigner.py)) →
    backend pytest now **117 passing**. Backend-only change; `npm run build` not applicable.


- **AQ-S3-010 Cloud Collaboration System — DONE on `main` (Stage 3).**
  - New [services/collaboration.py](aquaflow/backend/services/collaboration.py): shared show documents
    with optimistic concurrency (`CollabDocument` + `CollaborationHub`).
  - **Multi-user editing** — users join with presence + cursors; each edit is a dot-path field patch
    applied against the base version the user last saw; concurrent edits to different fields merge.
  - **Version history** — every applied change creates an immutable version (author, ts, message,
    snapshot, changed paths); inspect any version and `revert` to it (itself a new version).
  - **Conflict resolution** — three-way, field-level merge: patches to fields nobody else changed
    since base auto-merge; a field changed to a different value returns a conflict (base/mine/theirs);
    same-value edits are idempotent; `resolve_conflicts` force-applies the chosen values. Partial
    merges apply the clean fields and conflict only the rest.
  - API: `POST /api/collab/open|join|leave|cursor|edit|resolve|revert`, `GET /doc|history|users/{id}`
    ([collab_routes.py](aquaflow/backend/api/routes/collab_routes.py)), wired in main.py.
  - **Verification: 18/18** ([validate_collaboration.py](aquaflow/backend/validate_collaboration.py));
    **9 pytest cases** ([test_collaboration.py](aquaflow/backend/tests/test_collaboration.py)) → backend pytest now **108 passing**.

- **AQ-S3-009 Mobile Monitoring App — DONE on `main` (Stage 3).**
  - New [services/mobile_monitor.py](aquaflow/backend/services/mobile_monitor.py): turns the operator
    status into a phone-friendly monitoring feed, raises alerts, and gates remote commands.
  - **Live monitoring** — `build_snapshot(status)` condenses safety/transport/engine into a compact
    payload (health = estop/critical/warning/live/idle, playing, progress %, permit, fault count,
    per-subsystem enables, PLC online).
  - **Alerts** — `evaluate_alerts` derives prioritized alerts (E-stop, critical faults, hardware
    conflicts → critical; PLC comm loss → warning) and an `AlertManager` de-duplicates by code,
    tracks acknowledge, clears resolved conditions, and sorts critical-first.
  - **Remote control** — `validate_remote_command(cmd, status)` only allows commands the safety
    state permits (E-stop/stop always allowed; play blocked on hardware conflict / no permit / E-stop,
    tying into AQ-S1-003 + AQ-S1-007).
  - API: `GET /api/mobile/status|alerts`, `POST /api/mobile/command|alerts/ack`
    ([mobile_routes.py](aquaflow/backend/api/routes/mobile_routes.py)), wired in main.py; commands
    dispatch to the live safety/transport singletons.
  - **Verification: 25/25** ([validate_mobile_monitor.py](aquaflow/backend/validate_mobile_monitor.py));
    **7 pytest cases** ([test_mobile_monitor.py](aquaflow/backend/tests/test_mobile_monitor.py)) → backend pytest now **99 passing**.

- **AQ-S3-007 4K Video Export Engine — DONE on `main` (Stage 3).**
  - New testable engine [frontend/src/video/videoExport.js](aquaflow/frontend/src/video/videoExport.js)
    — pure, framework-agnostic export config + A/V sync:
    - **4K supported** — resolution presets incl. 4K UHD (3840×2160), `is4K`, custom `{w,h}`.
    - **60 FPS supported** — framerate presets (24/30/60), `frameCount`/`frameDurationMs`, and a
      resolution×fps bitrate estimate; `buildExportConfig` carries fps + bitrate + frame count.
    - **Audio synchronized** — `audioVideoSync` (A/V offset, in-tolerance flag, correction, latency)
      and `combineStreams` to mux a canvas video stream with an audio stream; MIME selection.
  - Wired into [FountainScene_v6.js](aquaflow/frontend/src/components/preview/FountainScene_v6.js):
    `startRecording({resolution,fps,audioStream})` renders at the export resolution (true 4K), sets
    fps + bitrate + MIME, and muxes audio; restores the preview size on stop. PreviewPanel adds
    resolution + fps selectors on the record button.
  - **Verification: 15 vitest cases**
    ([videoExport.test.js](aquaflow/frontend/src/video/__tests__/videoExport.test.js)) → frontend
    vitest now **74 passing**; `npm run build` clean.

- **AQ-S3-006 VR Walkthrough Mode — DONE on `main` (Stage 3).**
  - New testable engine [frontend/src/walkthrough/](aquaflow/frontend/src/walkthrough) — pure,
    framework-agnostic:
    - **Navigation supported** — `navigation.js`: first-person movement (`firstPersonStep` with
      heading + bounds clamp), waypoint-path interpolation for tours, look-at yaw, `NAV_MODES`.
    - **VR mode supported** — `vrMode.js`: WebXR capability detection (`isVRSupported`) + immersive-vr
      session options; `FountainScene` gained `renderer.xr.enabled`, `supportsVR()`, `enterVR()`,
      `exitVR()` (real WebXR session, headset-driven camera).
    - **Client presentation mode supported** — `presentationMode.js`: a scripted, auto-advancing,
      captioned cinematic tour (`DEFAULT_TOUR`, `tourStepAt`, looped). `FountainScene.startPresentation`
      cycles cinematic cameras + captions; PreviewPanel adds Present (fullscreen + caption overlay) and
      Enter-VR buttons.
  - Wired into [FountainScene_v6.js](aquaflow/frontend/src/components/preview/FountainScene_v6.js) and
    [PreviewPanel_v5.jsx](aquaflow/frontend/src/components/preview/PreviewPanel_v5.jsx).
  - **Verification: 19 vitest cases**
    ([walkthrough.test.js](aquaflow/frontend/src/walkthrough/__tests__/walkthrough.test.js)) →
    frontend vitest now **59 passing**; `npm run build` clean.

- **AQ-S3-005 Weather Simulation Engine — DONE on `main` (Stage 3).**
  - New [services/weather_engine.py](aquaflow/backend/services/weather_engine.py): computes the three
    weather effects on an outdoor show from ambient conditions.
  - **Wind simulated** — wind vector (from-direction → blows-toward), per-jet horizontal drift over
    flight time (`drift = coupling·wind·2√(2h/g)`), downwind landing offset, growing splash radius,
    gust drift, and a wind advisory.
  - **Evaporation estimated** — standard mass-transfer Θ model `E = (25+19v)·A·(x_s−x_air)` with
    Tetens saturation pressure + humidity ratios; reported as kg/h, L/day, and mm/day (verified
    ~0.3–0.6 kg/m²/h, zero at saturation).
  - **Visibility impact calculated** — Koschmieder visual range `V = 3.912/β` (β from condition +
    humidity + fountain spray) plus a show-clarity score from contrast transmission over the viewing
    distance (excellent on a clear night, poor in fog), and a show-suitability advisory.
  - API: `POST /api/weather/simulate` ([weather_routes.py](aquaflow/backend/api/routes/weather_routes.py)),
    wired in main.py.
  - **Verification: 25/25** ([validate_weather_engine.py](aquaflow/backend/validate_weather_engine.py))
    vs independent hand calcs; **11 pytest cases**
    ([test_weather_engine.py](aquaflow/backend/tests/test_weather_engine.py)) → backend pytest now **92 passing**.

- **AQ-S3-004 Photorealistic Rendering Engine — DONE on `main` (Stage 3).**
  - New testable engine under [frontend/src/rendering/](aquaflow/frontend/src/rendering) — pure,
    framework-agnostic, and the single source of truth for the 3D preview:
    - **Water physics rendered** — `waterPhysics.js`: projectile droplet trajectories (`dropletPosition`,
      `simulateJet`), apex height, time-of-flight, launch velocity from jet height. The scene's
      `GPUParticleSystem` gravity is now sourced from the engine (`RE_GRAVITY`).
    - **Reflections rendered** — `reflections.js`: water-surface mirror matrix + `reflectPoint`, and
      Schlick **Fresnel** reflectance (near-mirror at grazing angles, ~2% looking straight down).
    - **Night scenes supported** — `sceneModes.js`: day/dusk/night/arena presets (dark sky, low
      ambient, starfield, stronger bloom/fixture-glow for night); `FountainScene.ENVIRONMENTS` is now
      sourced from the engine.
    - `index.js`: `buildRenderConfig()` aggregates scene mode + reflection + per-jet water physics
      into one renderer-agnostic config.
  - Wired into [FountainScene_v6.js](aquaflow/frontend/src/components/preview/FountainScene_v6.js)
    (imports `ENVIRONMENTS` + `GRAVITY` from the engine).
  - **Verification: 16 vitest cases**
    ([renderingEngine.test.js](aquaflow/frontend/src/rendering/__tests__/renderingEngine.test.js)) vs
    hand calcs → frontend vitest now **40 passing**; `npm run build` clean (116 modules).

- **AQ-S3-003 AI Choreography Engine — DONE on `main` (Stage 3).**
  - New [services/choreography_engine.py](aquaflow/backend/services/choreography_engine.py): builds a
    full show timeline from a prompt + the *designed fixtures*, and revises an existing show from a
    follow-up prompt.
  - **Full timelines generated** — multi-track (pump/lighting + requested effects) over a mood-shaped
    arc; pump track covers the whole duration; output loads into a real `ShowEngine` and plays.
  - **Fixture constraints respected** — only choreographs track types with fixtures present (a prompt
    asking for fire with no flame fixture is skipped + warned); clip intensity clamped to each
    fixture's `maxIntensity`; flame bursts never exceed the hardware max on-time (`FLAME_MAX_ON_TIME`,
    with cooldown gaps).
  - **Prompt revisions supported** — `revise_show` applies calmer/energetic intensity scaling,
    add/remove effect tracks (honouring fixtures — can't add a laser with no laser fixture), and
    tempo changes, with a revision history.
  - API: `POST /api/choreography/generate` + `/revise`
    ([choreography_routes.py](aquaflow/backend/api/routes/choreography_routes.py)), wired in main.py.
  - **Verification: 22/22** ([validate_choreography_engine.py](aquaflow/backend/validate_choreography_engine.py))
    incl. real ShowEngine playback; **8 pytest cases**
    ([test_choreography_engine.py](aquaflow/backend/tests/test_choreography_engine.py)) → backend pytest now **81 passing**.

- **AQ-S3-001 AI Show Generator — DONE on `main` (Stage 3).**
  - New [services/ai_show_generator.py](aquaflow/backend/services/ai_show_generator.py): interprets a
    natural-language prompt into a `ShowIntent` (mood, energy, tempo, duration, effects, palette,
    name) and generates a timeline over a mood-shaped energy arc.
  - **Supports text prompts** — extracts effects (flame/fog/laser/lighting/water incl. negation like
    "no fire"), explicit BPM/duration, and a show name from free text; deterministic (seeded).
  - **Supports mood descriptions** — a mood lexicon maps phrases ("serene zen" → calm, "high-energy
    party" → energetic, "romantic wedding" → romantic, "epic cinematic" → dramatic, mysterious,
    patriotic); mood sets energy, tempo, palette, and effect emphasis.
  - **Generates playable timelines** — output is the canonical show payload (`{show, timelineTracks}`)
    that **loads into a real `ShowEngine` and drives clips during playback** (proven in the harness).
  - API: `POST /api/ai-show/generate` + `/interpret`, `GET /api/ai-show/moods`
    ([ai_show_routes.py](aquaflow/backend/api/routes/ai_show_routes.py)), wired in main.py.
  - **Verification: 22/22** ([validate_ai_show_generator.py](aquaflow/backend/validate_ai_show_generator.py))
    incl. a real ShowEngine load→play→tick; **7 pytest cases**
    ([test_ai_show_generator.py](aquaflow/backend/tests/test_ai_show_generator.py)) → backend pytest now **73 passing**.

- **AQ-S2-013 Energy Consumption Modelling — DONE on `main` (Stage 2).**
  - New [services/energy_model.py](aquaflow/backend/services/energy_model.py): builds a load model
    (each load has power, schedule/duty or a 24-h profile) and evaluates it against a tariff.
  - **kWh calculated** — per-load and total daily/monthly/annual energy (`E = P·hours·duty`, or
    `P·Σprofile`).
  - **Annual operating cost generated** — energy charge + demand charge (peak·$/kW/mo·12) +
    standing charge, plus annual CO₂.
  - **Peak demand calculated** — maximum *coincident* load across the 24-h day: overlapping loads
    sum, non-coincident profiles take the max (not the sum); optional simultaneity factor. Also
    reports connected load, load factor, diversity factor.
  - Pulls loads straight from fixture `electrical.powerW` (AQ-S2-011) via `model_from_fixtures`.
    API: `POST /api/energy/model` and `/from-fixtures`
    ([energy_routes.py](aquaflow/backend/api/routes/energy_routes.py)), wired in main.py.
  - **Verification: 17/17** ([validate_energy_model.py](aquaflow/backend/validate_energy_model.py))
    against independent hand-calcs; **8 pytest cases**
    ([test_energy_model.py](aquaflow/backend/tests/test_energy_model.py)) → backend pytest now **66 passing**.

- **AQ-S2-011 Fixture Library Expansion — DONE on `main` (Stage 2).**
  - Deterministic generator [tools/generate_fixture_library.py](aquaflow/tools/generate_fixture_library.py)
    emits **524 fixtures** across 16 categories (jets/nozzles, lights, pumps, valves, flame, fog,
    laser, sensors, controls, power, filtration, air, water treatment, effects, motion, safety) to
    [fixture_library_expanded.json](aquaflow/frontend/src/data/fixture_library_expanded.json).
  - **Minimum 500 fixtures** — merged `FIXTURE_LIBRARY` (curated + generated) = **596**
    ([fixtureLibrary.js](aquaflow/frontend/src/data/fixtureLibrary.js) normalizes both sets).
  - **Hydraulic metadata** on every fixture (flow, pressure, jet height, nozzle dia, connection
    size, K factor Q=K√P) and **electrical metadata** on every fixture (voltage, power, computed
    current, phase, control protocol, DMX channels, IP rating).
  - **Verification: 7/7** ([tools/validate_fixture_library.py](aquaflow/tools/validate_fixture_library.py))
    + **7 vitest cases** ([data/__tests__/fixtureLibrary.test.js](aquaflow/frontend/src/data/__tests__/fixtureLibrary.test.js))
    → frontend vitest now **24 passing**; production build clean.

- **AQ-S2-009 Automatic BOM Generator — DONE on `main` (Stage 2).**
  - New [services/bom_generator.py](aquaflow/backend/services/bom_generator.py): rolls a design
    (equipment, pipes, nozzles, valves, fittings, instruments — or a hydraulic network) into a
    costed bill of materials.
  - **Quantities generated automatically** — identical items counted, pipe runs summed by
    diameter/material, nozzles grouped by model.
  - **Supplier references supported** — each line enriched with manufacturer / part number /
    supplier / unit cost from [data/parts_catalog.json](aquaflow/backend/data/parts_catalog.json)
    + the nozzle DB; per-line and category cost roll-ups.
  - **Excel export supported** — a **self-contained minimal XLSX writer** (zip of OOXML, no runtime
    dependency) plus CSV/JSON; the `.xlsx` reads back cleanly in openpyxl (independent verifier).
  - API: `POST /api/bom/generate` and `/from-network` (`?format=json|csv|xlsx`, xlsx downloads)
    ([bom_routes.py](aquaflow/backend/api/routes/bom_routes.py)), wired in main.py.
  - **Verification: 19/19** ([validate_bom_generator.py](aquaflow/backend/validate_bom_generator.py))
    incl. openpyxl read-back and hand-calc totals; **8 pytest cases**
    ([test_bom_generator.py](aquaflow/backend/tests/test_bom_generator.py)) → backend pytest now **58 passing**.

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
**AQ-S3-003 (next Stage 3 item) or AQ-S2-002 — Pump curve import & duty-point (Stage 2).**
AQ-S2-002 depends on AQ-S2-001 (done).
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
