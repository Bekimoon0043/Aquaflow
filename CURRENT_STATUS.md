# AquaFlow Studio — Current Status

_Last reviewed: 2026-07-02 · Branch: `main` · Reviewer: engineering pass over full frontend `src/` + backend tree._

This document supersedes the status claims in `aquaflow/README.md` (which marks every
module "✅ Complete") and the `AquaFlow_Architecture_Review.md` / `AquaFlow Studio review 1.docx`
Round‑1 review (which predates the current code and is now largely **stale** — most of the
critical seam bugs it flagged are fixed, see below).

---

## 1. Executive summary

AquaFlow Studio is a professional multimedia fountain show-control platform: a React/Vite
studio front end talking over REST + WebSocket to a Python FastAPI backend that runs a
deterministic show engine and drives hardware via Art‑Net / Modbus / MQTT.

The platform is **substantially built and internally coherent**. The backend has advanced
to "Phase 9" (safety kernel, runtime transport, diagnostics, license engine, compiler /
runtime-export pipeline). The frontend **builds cleanly** (`npm run build` → 111 modules,
~7 s) and mounts ~17 functional panels.

Status this pass is based on **static review + a successful frontend build**. A full
runtime smoke test (backend up, show loaded, playback observed) has **not** yet been run —
so "working" below means "built and correctly wired," not "confirmed live."

---

## 2. Verified findings (2026-07-02)

- **Frontend builds green.** Vite production build succeeds. One **pre-existing** non-fatal
  warning remains: duplicate `groupId` key in `PoolGeometryDesigner.jsx:1446` (see Known Issues).
- **Backend is well past the README.** `backend/main.py` wires safety kernel, runtime
  transport, diagnostics, phase6/7/9 routes, pattern routes, show-programmer, and license
  routes; `pattern_routes` is imported at module load and `protocol_bus.update_dmx_map` is
  wired, so the seam the Round‑1 review called "dead" now resolves.
- **Round‑1 critical bugs — re-verified against current code:**

  | Round‑1 bug | Status today |
  |---|---|
  | #1 Fixture-type vocab mismatch ("everything → center_jets") | ✅ Fixed — canonical `resolveFixtureGroup` / `fixtureTypeResolver.js` used across runtime layer |
  | #2 Pattern Designer reads non-existent `poolGeometry` store key | ✅ Fixed — now reads `s.geometry` |
  | #3 No fixtures→tracks projection; backend never sees fixtures | ◑ Largely addressed — client-side `autoTrackGenerator` / `fixtureRuntimeMapper` project fixtures→tracks (backend stays track-centric, see Known Issues) |
  | #4 Axis convention applied inconsistently (2D map ≠ 3D view) | ✅ **Fixed today** — see §3 |
  | #6 `pattern_routes` broken imports / missing singletons | ✅ Fixed — imports resolve, `update_dmx_map` exists |

---

## 3. Changes landed today

- **Axis-convention centralization (Round‑1 #4).** Added a single canonical helper
  `fixturePlanCoords(fixture)` in `frontend/src/hooks/fixtureTypeMap.js` documenting the
  one axis contract: engineering/plan `(x, y)` → world `(x, height, z=y)`; Nozzle Map top
  view uses `y = engineering y`. Routed **both** the 3D converter
  (`fixturesToNozzleConfigs`, nozzle + light branches) and the Pattern Designer
  (`buildGroupsFromFixtures`, formerly `PatternDesignerPanel.jsx:84`) through it, removing
  the ad-hoc `?? fixture.z ??` fallback that let the 2D top view and 3D view place the same
  nozzle in different spots. Uses `??` so an explicit `0` coordinate is respected.

---

## 4. Module status

| Module | State | Notes |
|---|---|---|
| Studio shell / panel routing (`App.jsx`) | ✅ Built | 17 panels mounted |
| Node editor, Timeline, Inspector | ✅ Built | |
| Pool Geometry Designer | ◑ Built, 1 warning | duplicate `groupId` key (Known Issues) |
| Pattern Designer + Nozzle Map | ✅ Built | axis conversion now centralized |
| 3D Preview (`FountainScene_v6`) | ✅ Built | driven by `fixturesToNozzleConfigs` |
| Fixture library + type resolver | ✅ Built | `fixtureTypeResolver.js` v2 = single source |
| Show engine / playback / record | ✅ Built | deterministic loop, WS snapshot broadcast |
| Device manager + protocol bus | ✅ Built | Art‑Net / Modbus / MQTT; seed devices |
| Safety kernel + runtime transport | ✅ Built | E‑stop, watchdog, fault latch, state machine |
| PLC engine | ◑ Partial | ~5 TODO/placeholder markers; `plcChannel` not yet read by drivers |
| Scheduler | ✅ Built | slot-based auto shows |
| Audio engine / analysis | ◑ Partial | `librosa` optional/commented → heuristic path only |
| AI choreography + learning | ◑ Partial | `torch`/`transformers` optional/commented → rule-based path |
| Compiler / runtime-export pipeline | ◑ Built, unverified | `luxshow_compiler`, `runtime_exporter`, step2/3/4 contracts |
| License engine + routes (backend) | ✅ Built | **UI gate intentionally not wired — deferred** |
| Diagnostics | ✅ Built | |

Legend: ✅ built & wired · ◑ partial / needs work · (runtime behavior unverified this pass)

---

## 5. Known issues / risks

1. **Backend remains track-centric, not fixture-centric.** `show_engine.get_snapshot()`
   carries `timelineTracks` but not `fixtures`/`groups`; the engineering model lives only in
   the frontend `engineeringStore`. Works via client-side projection, but the backend cannot
   independently rebuild a show from fixtures (matters for headless / deployed runtime).
2. **Duplicate `groupId` object key** in `PoolGeometryDesigner.jsx:1446` — esbuild warning,
   last write wins; verify the intended value and remove the duplicate.
3. **License gate not enforced in the UI.** Backend license engine/routes exist; `main.jsx`
   renders `<App/>` directly with no gate. **Deferred to a later phase by decision.**
4. **~45 TODO / placeholder / mock markers across 25 files** — heaviest in `plc_engine.py`
   (5) and `services/runtime_bridge.py` (4).
5. **No automated test suite.** Only author scripts `validate_step2/3/4_contracts.py` and
   `verify_backend_syntax.py`. Highest risk for a hardware-driving, safety-relevant system.
6. **Large JS bundle** (~1.5 MB / ~397 kB gzip, single chunk). Consider code-splitting.
7. **Runtime not yet verified this pass** — no end-to-end backend+frontend smoke test on record.

---

## 6. Recommended next actions by team

**Frontend**
- Remove the duplicate `groupId` key in `PoolGeometryDesigner.jsx:1446`.
- Audit remaining coordinate math (`deviceGroupSelector`, runtime graph) for any other
  ad-hoc axis fallbacks; route through `fixturePlanCoords`.
- Begin code-splitting to bring the main chunk under the 500 kB warning threshold.

**Backend / runtime**
- Extend the show payload/snapshot contract to carry `fixtures` + `groups` so the backend
  is fixture-aware (unblocks headless runtime, PLC mapping, Push-To-Devices for real fixtures).
- Burn down TODO/placeholder markers in `plc_engine.py` and `services/runtime_bridge.py`.
- Wire `plcChannel` (already authored in the fixture library) into real PLC I/O mapping.

**Hardware / PLC / protocols**
- Validate Art‑Net / Modbus routing against real (or simulated) hardware; confirm
  `protocol_bus` builds its device map from designed fixtures, not just seed devices.
- Add a pump-curve / hydraulic duty model to move sizing beyond "preliminary."

**QA**
- Stand up a test harness: pytest for backend contracts/engine, vitest for the resolver +
  `fixturePlanCoords` + track projection. Add an end-to-end playback smoke test.

**DevOps / release**
- Repo is clean (large binaries + secrets purged from history). Keep `dist/`, `build/`,
  `.env.local`, licenses, and audio out of commits via `.gitignore`.
- Add a CI job: frontend `npm run build` + backend `verify_backend_syntax.py` on every PR.

**Deferred (do not action yet)**
- Front-end license gate wiring — scheduled for a later phase.

---

## 7. Suggested immediate next step

Run the end-to-end smoke test (backend `uvicorn` + frontend `npm run dev`, hit
`/api/health`, load a show, run playback while watching WS telemetry) to convert the
"built and wired" assessment above into verified runtime fact.
