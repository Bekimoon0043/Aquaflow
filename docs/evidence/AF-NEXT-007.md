# AF-NEXT-007 evidence: time-dependent hydraulic evaluator

Date: 2026-10-13. Simulation only. No hardware was connected, armed or driven.

## What changed

| Layer | File | Change |
| --- | --- | --- |
| Backend evaluator | `aquaflow/backend/services/show_hydraulics.py` (new) | Samples the show at 10 Hz plus every clip and fade boundary, with a budget of 3,000 samples. At each sample it reads the canonical frame (`engine/show_frame.py`), applies pump and valve dynamics, and solves each pump group quasi-steady, with results cached by state signature. It then applies pipe fill. Output is SI, with a provenance citation on every result. |
| API | `api/routes/hydraulics_routes.py` | `POST /api/hydraulics/show-timeline`, cached per payload revision (sha256, 8-entry LRU). |
| Preflight hook | `show_hydraulics.get_hydraulic_diagnostics(project, show=None)` | Called by `services/preflight.py::_hydraulics`. It builds the same request as the frontend, so the backend gate and the Preflight panel de-duplicate. |
| Frontend client | `frontend/src/engineering/showHydraulicsClient.js` (new) | Builds the payload, caches per revision and samples the timeline at the playhead. It interpolates within one state, steps across a state change, and lists the diagnostics active at the playhead. |
| Diagnostics | `frontend/src/engineering/showDiagnostics.js` (new) | `getHydraulicDiagnostics(project, show)` returns the exact shared Diagnostic shape. An unreachable backend produces one `HYDRAULICS_UNAVAILABLE` warning. |
| Preview | `components/preview/HydraulicPreviewPanel.jsx`, `engineeringJets.js` (new); `jetPhysics.js` | Toggle between "Creative (instant response)" and "Engineering preview". In engineering mode each jet's launch speed is capped (`engineeringCapMs`) at `sqrt(2 g h_delivered)`, and `engineeringGate = 0` removes jets that get no water. The status panel consumes `getPhysicsStatus()` and lists named diagnostics with timestamps. |
| Wiring | `FountainScene_v6.js`, `PreviewPanel_v5.jsx` | Minimal edits. In the scene, `setIntensity` applies the gate (one line plus an import); the scene is 3,199 lines against a guard of 4,387. PreviewPanel gains the hook and the panel in its sidebar. |
| Preflight (AF-NEXT-009 hook) | `preflight/preflight.js`, `PreflightPanel.jsx` | The slimmed fixtures keep `x, y, rotation, provenance`. The project carries basins and geometry for splash. Local diagnostics receive the full project (recipes, groups, tempo) as the show. |

## Model and policies

- **Pump.** The pump is a `PumpCurve` scaled by the affinity laws (`at_speed`), not a fixed head. The curve comes from `engineering.pumpCurve` points, else the catalog `curveModel`, else the duty point (`flowLpm`/`headM`). A duty-point curve is a generic quadratic with shutoff head = 1.25 × duty head, labelled `PUMP_CURVE_ASSUMED`. The operating point is the root of `H − H_pump(Q_sys(H))`, found by Illinois regula falsi over the Hazen-Williams GGA solve (`hydraulic_solver.HydraulicNetworkSolver`).
- **Commands.** A programmed pump follows `pump_speed`. An unprogrammed pump runs at `sqrt(max nozzle level)`, labelled `implicit`, because head scales with N². A programmed valve follows its channel. An unprogrammed valve is open while any jet behind it is demanded.
- **Network.** Each pump group is solved as pump → main → valve → branch → nozzle emitter. The valve minor loss is `K/f²`, with K = 2.0 by default or `kOpen` when given. The emitter is `k = Q_d/√p_d`.
  - Closed valves and closed nozzles drop their branches.
  - Pipe lengths are straight-line distances (labelled as an assumption).
  - Links come from `engineering.pumpId/valveId`, `hydraulic_network.groups`, and the preflight aliases `supplyingPumpId` and `linkedValveId`. A nozzle inherits the pump of its valve.
  - With a single pump, every nozzle is assumed to be fed by it. With no pump, a fixed design head is used (labelled). With several pumps and no link, the nozzle gets `NOZZLE_NOT_CONNECTED`.
- **Jet height.** `h = min(level × design height, design height × p_available / p_design)`. Exit velocity is `Cd·√(2 g p_eff)` and flow is `k·√p_eff`.
- **Dynamics.**
  - The pump follows a first-order lag. τ comes from `rampTimeConstantS`, else `rampTimeS/3`, else a DEFAULT of 1.5 s.
  - A valve strokes linearly over `responseTimeS`, else a DEFAULT of 0.3 s for a solenoid or 6 s for a motorised valve.
  - For the solve cache, speed is quantised to 2 % and valve position to 25 %.
  - Pipe fill: pipes start empty (configurable) and branches drain when idle. A jet appears only once the volume of its path has been filled at the solved flow.
- **Diagnostics.** Each finding is merged into a time span and emitted in the shared shape plus `endMs`. Pump duty findings are raised only at steady state.

  | Code | Severity | Raised when |
  | --- | --- | --- |
  | `PUMP_OVERLOAD` | error with verified/measured curve data; warning with an assumed or generic curve (asks for verified pump data) | The duty exceeds the operating point by more than 5 % (`check_pump_adequacy`), or the pump runs past the end of its curve. |
  | `PUMP_BELOW_MIN_FLOW` | warning | The pump runs below its minimum flow. |
  | `PUMP_NOT_RUNNING` | warning | A jet is demanded while its pump is off. |
  | `VALVE_CLOSED_UPSTREAM` | warning | A jet is demanded behind a closed valve. |
  | `SOLVER_NOT_CONVERGED` | error | The GGA solve or the operating-point search did not converge. |
  | `NOZZLE_UNDER_PRESSURE` | warning | The jet is more than 10 % short of its demanded height. |
  | `JET_DELAYED` | info | A lag of at least 1 s; reported once per jet. |
  | `NOZZLE_NOT_CONNECTED` | static | The nozzle has no link to a pump. |
  | `HYDRAULIC_DATA_MISSING` | static | Hydraulic data is missing. |
  | `PUMP_CURVE_ASSUMED` | static | The pump curve is a generic duty-point curve. |

- **Reports.** `solves[]` records every unique solve: convergence, iterations, continuity and loop residuals, and the operating point with its own iterations and residual (m). Pumps and nozzles carry AF-NEXT-012 citations, summarised in `data_provenance`. `assumptions[]` lists every default or assumed value.

## Tests

| Command | Result |
| --- | --- |
| `python -m pytest tests/test_show_hydraulics.py -q -o addopts=""` | 12 passed |
| `npx vitest run src/engineering/__tests__/showDiagnostics.test.js src/components/preview/__tests__/engineeringPreview.test.jsx src/preflight` | 31 passed |
| `npx vitest run` | 1045 passed |
| `npx vite build` | OK (only the existing chunk-size warning) |
| `python -m pytest tests -q -o addopts=""` | 1247 passed, 21 skipped |

| Acceptance | Evidence |
| --- | --- |
| An overloaded pump lowers the affected jets and creates a named diagnostic | `test_overloaded_pump_lowers_jets_and_reports_overload`: eight DN25 jets. On a 1.5 kW pump each reaches 6.07 m; on an adequate pump, 9.79 m. `PUMP_OVERLOAD` carries the time, clip and pump. It is a warning on the assumed duty-point curve and an error on a measured curve (`test_overload_severity_follows_curve_verification`). `NOZZLE_UNDER_PRESSURE` is also raised. The operating head lies on the affinity-scaled curve. |
| A closed upstream valve removes the affected jets | `test_closed_upstream_valve_removes_jets`: after the valve clip ends at 5 s, the jets behind V1 drop to 0 m (`valve_closed`). A jet on another branch keeps running. `VALVE_CLOSED_UPSTREAM` is raised at 5000 ms with an `open_clip` fix. |
| Ramp, valve response and fill delay | `test_pump_ramp_and_pipe_fill_delay_jets`: with τ = 2 s the jet is below 50 % of its final height at +0.5 s, and `JET_DELAYED` is raised at 1000 ms. With empty pipes the jet appears after volume / flow (≈10.5 L). The default τ is labelled DEFAULT. |
| SI units, convergence and error reports preserved | `test_si_units_provenance_and_convergence_reports`: v = Cd√(2gp) and Q = k√p hold; residuals are below 1e-6 and the operating-point residual is below 1e-3 m; citations are present. `test_solver_non_convergence_is_reported`: with `max_iter = 1` the result has `converged: false` and a `SOLVER_NOT_CONVERGED` error. |
| Affinity laws and pump state | `test_programmed_pump_speed_follows_affinity_laws_and_min_flow`, plus tests for the fixed-head fallback and for missing data. |
| Engineering preview in 3D | `engineeringPreview.test.jsx` (jsdom): the toggle; the cap lowering a jet and the gate removing it; creative mode restoring the jets; the status panel listing diagnostics with timestamps. |
| Preflight end to end | Backend: `test_overloaded_pump_is_a_preflight_issue_end_to_end`, where `run_preflight` returns a `PUMP_OVERLOAD` warning with `ok: true` on an assumed curve, and an error with `ok: false` on a verified curve. Frontend: `src/preflight/__tests__/hydraulicsPreflight.test.js` runs `runPreflight` → `showDiagnostics.js` → `/hydraulics/show-timeline` against the backend's recorded response, `golden/overload-timeline.json`. `backend/tests/golden_show_timeline.py` regenerates the golden, and a backend test asserts the golden still equals the evaluator's output. |

Benchmark on this PC: a 5-minute show with 48 nozzles, 4 pumps and 1,500 clips took 5.3 s to evaluate from cold. It produced 3,799 samples and 2,992 unique solves (12,208 cache hits), and the timeline is 6.6 MB of JSON. The result is cached per revision.

## Limitations (field verification required)

- **Topology and pipes.** Pump groups are solved independently, so a manifold shared between pumps is not modelled. Pipe lengths are straight-line distances unless `mainLengthM` is set. The fill model assumes upstream pipes stay full and branches drain when idle.
- **Assumed equipment data.** Duty-point curves are generic and are labelled as such. Ramp and valve defaults are labelled DEFAULT. A `PUMP_OVERLOAD` on an assumed or generic curve is a warning (overload lowers jets; it is not a safety hazard), so it does not block hardware output. It becomes an error only when the curve has verified provenance (manufacturer datasheet or user-measured).
- **Implicit pump drive.** `sqrt(level)` approximates a VFD under pressure control; it is not a measured controller.
- **Steady-state findings.** A programmed pump is never at steady state while its fade is running, so pump duty findings are not raised there.
- **Sample budget.** Boundary samples are added on top of the 3,000-sample budget.
