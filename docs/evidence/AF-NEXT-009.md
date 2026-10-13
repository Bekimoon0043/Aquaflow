# AF-NEXT-009 evidence: preflight compiler gate

Date: 2026-10-13. Scope: `aquaflow/backend`, `aquaflow/frontend/src`. No hardware was connected, armed, started, pulsed or deployed. Gate tests use capturing fake drivers, `mode: "simulated"` sites, or a PLCSIM-mode site whose start is refused before any S7 client is created.

## Behaviour before the change

- No preflight module existed. `siemens_site.compile_show` raised `ValueError` on the **first** failure, with no clip or fixture ID.
- `show_engine.play()` blocked only address conflicts (always) and unmapped fixtures (when commissioned).
- Pump/valve dependencies were checked only by `validate_site` (each valve names a pump). Nothing checked them over time: valve open with pump stopped, pump running with every outlet closed, or a valve closing against a running pump.
- The frontend `runtimeEventCompiler._validateSafety` checked only flame on/off event pairs ("TODO Phase 2"). `CompilePanel` listed messages with no way to jump to the problem.

## Data contract

The Diagnostic shape is shared with `engineering/showDiagnostics.js` (AF-NEXT-007/008):

```
{code, severity: "error"|"warning"|"info", timeMs|null, fixtureId|null, clipId|null,
 engineeringItemId|null, message, fix: {kind: "open_clip"|"open_engineering_item"|"open_panel", target}|null, source}
```

- **`POST /api/preflight`**
  - Body: `{project: {fixtures, clips, recipes?, groups?, tempo?, hydraulic_network?}, target: {kind, site_id?, translate?, mapped?}}`.
  - `kind` is one of `preview`, `siemens`, `dmx`, `artnet`, `ican`, `modbus` or `runtime`.
  - Returns `{ok, issues, summary{errors,warnings,infos,total,by_code}, resolved_revision, target, hardware, label}`.
  - `resolved_revision` is a CRC of the resolved clips, the routing fields and the target (the site id and revision for Siemens).
  - Read-only.
- **Failure behaviour.**
  - Errors block hardware output. Warnings and info never block.
  - For a preview target the same checks run, but nothing is ever refused, and the result carries `label: "PREVIEW ONLY — not sent to hardware"`.

## Delivered

- **`backend/services/preflight.py`.**
  - It resolves the show **once** with `engine.show_frame.prepare_show` (mute/solo, tempo, half-open windows), then runs every check on the resolved clips. Dependency findings are confirmed against `evaluate_show_frame_at` at the midpoint of the interval.
  - **Missing links.** A clip on a fixture that is not in the design, an unmapped fixture for a hardware target (`mapped` set or predicate), a valve without a pump, and a nozzle without a valve.
  - **Channel/address conflicts.**
    - DMX footprint overlap and overflow beyond 512.
    - PLC/Modbus register.
    - Valve/PLC `%Q` output.
    - I-CAN group/channel, including channel 0.
    - The Siemens site mapping (`validate_site`). Its fix is `open_panel: plc`.
    - `dependency_graph` missing dependencies and cycles.
  - **Dependencies over time.** It uses the topology from `supplyingPumpId`/`linkedValveId`, `engineering.pumpId`/`valveId`, `project.hydraulic_network.groups` and Siemens `pump_id`/`nozzle_ids`.
    - A valve that is open while its pump is stopped (warning).
    - A nozzle playing while its programmed valve is closed (warning).
    - A pump running with every outlet closed (`pump-deadhead`).
    - A valve closing against a running pump (`valve-close-against-pump`).
    - The last two are **errors** unless the pump has a bypass or the target has an outlet interlock (Siemens `frame_from_values` holds the pump at 0), in which case they are warnings.
    - A valve with no clips of its own follows its nozzles.
  - **Output limits.**
    - A clip above a fixture's `max_percent`/`maxPercent`/`maxIntensity`/`safety_max` produces a warning: the bus clamps it.
    - A Siemens pump above its ceiling is an error, as before.
  - **Minimum on/off.**
    - Fixture `min_on_ms`/`min_off_ms` (errors).
    - Siemens valve rules, unchanged.
    - Pump short-cycle within its minimum off time, with a default of 2000 ms (warning).
  - **Unsupported channels.**
    - Siemens track kinds, unbaked effects and fades or curves (errors).
    - DMX: water, pump and valve clips are not routed (warning).
    - I-CAN: lighting tracks, or levels and fades thresholded at 50% (warning).
  - **Flame rules.**
    - Bursts are merged across gaps of less than 0.5 s, as the bus does. A burst longer than 3.0 s (`ProtocolBus.FLAME_MAX_DURATION`) is an error.
    - A re-fire within 5 s is a warning.
  - **Hydraulics/splash.** It calls `services.show_hydraulics.get_hydraulic_diagnostics`/`get_splash_diagnostics` when that module exists. It is currently absent; the call is guarded.
  - **Fix targets.** A clip-related issue opens the Studio recipe (`studioRecipeId`) or the clip itself. A fixture or equipment issue opens the Engineering item.
  - **Adapters.** `engine_project(show_engine)` (track clips → resolved clips) and `ican_pattern_project(pattern, channel_map)`.
- **`siemens_site.compile_show`** delegates validation to the preflight.
  - It still raises `ValueError`, now `PreflightError(ValueError)`, carrying `.issues`, `.summary` and `.resolved_revision`.
  - One error keeps its original message text. Several errors read `"N preflight errors: a; b; c (+k more)"`. Several messages gained a parenthetical value, such as `(90% > 40%)` or `(100 ms < 500 ms)`.
  - The compiled output is unchanged.
- **Gates.** All of them fail closed.
  1. **`show_engine.play()`.** When commissioned it runs the preflight on the loaded show and refuses on any error. If the preflight cannot run, playback is refused. `get_state()["preflight"]` exposes the result. Simulation (uncommissioned) playback is unchanged.
  2. **`SiemensRuntime.start()`.** For a `plcsim` or `physical` site it re-runs the preflight on the saved show for the current revision, so a show saved by an older compiler gets today's rules. Internal `simulated` mode stays available, and `status()` carries `output_label: "PREVIEW ONLY — not sent to hardware"`. `test_outlet`/`test_device` compile through `compile_show` and are therefore gated too.
  3. **I-CAN `POST /api/ican/manual-pattern/run`.** The preflight runs before anything is stopped or sent. On errors the route returns 409 with `{message, issues}`.
  4. **DMX/Art-Net output.** There is no separate start route: show output reaches Art-Net only through `show_engine.play()` → `ProtocolBus.send_batch`, so gate 1 covers it.
- **`POST /api/siemens-sites/{sid}/compile`.**
  - Errors return HTTP 400 with `detail = {message, issues, summary, resolved_revision}`.
  - Success adds `preflight: {ok, issues, summary, resolved_revision}`. This key is additive.
  - `utils/siemensSite.siemensRequest` turns the object detail into `Error(message)` with `.issues`.
- **Frontend.**
  - **`src/preflight/preflight.js`.**
    - `buildPreflightProject` (Engineering fixtures and the resolved Studio clips, recipes and groups).
    - `runPreflight`: calls the backend and merges in the AF-NEXT-007/008 `getHydraulicDiagnostics`/`getSplashDiagnostics`, loaded through `import.meta.glob`, so the build and tests pass when the file is absent.
    - `mergeDiagnostics`, `groupBySeverity`.
    - `openDiagnosticFix`:
      - `open_clip` → `aquaflow:open-panel {show_programmer}`, plus `aquaflow:open-clip {clipId, itemId, timeMs}` and selection on the legacy `showStore` timeline.
      - `open_engineering_item` → `aquaflow:open-panel {geometry}` plus `aquaflow:select-engineering-item {id}`.
      - `open_panel` → `aquaflow:open-panel`.
      - A pending focus covers views that mount late.
  - **`components/panels/PreflightPanel.jsx`.** It is embedded at the top of `CompilePanel`. It offers a controller choice, a run button, and clickable issues grouped by severity, and shows the PREVIEW ONLY label for the preview target.
  - **`ShowStudio.jsx`.** An additive listener for `aquaflow:open-clip` selects the owning recipe or legacy clip and moves the playhead to the issue time.
  - **`runtimeEventCompiler._validateSafety`.** With resolved clips, it tracks continuous flame on-time on the canonical frame across back-to-back clips, and warns about a valve open while its pump is stopped and a pump dead-heading. It evaluates only the relevant fixtures. The event-pair fallback is kept.
  - **Labels.**
    - `SiemensLinkStatus` simulated: "PREVIEW ONLY — not sent to hardware · Internal AquaFlow preview only".
    - The simulated run button: "Run preview — PREVIEW ONLY, not sent to hardware".
    - The wizard badge: "PREVIEW ONLY — not sent to hardware".
  - **`App.jsx`** is unchanged; the panel is mounted through `CompilePanel`.
  - **`main.py`** gains one additive router line (`/api/preflight`).

## Commands and results (Windows 11, Python 3.12, Node v24)

| Command (cwd) | Result |
| --- | --- |
| `python -m pytest tests/test_preflight.py -q -o addopts=""` (backend) | **34 passed** |
| `python -m pytest tests/test_siemens_site.py tests/test_show_frame.py tests/test_siemens_devices.py -q -o addopts=""` | **101 passed**, with no assertion changes |
| `python -m pytest tests -q -o addopts=""` (backend) | **1243 passed, 21 skipped** (90 s) |
| `npx vitest run src/preflight` (frontend) | **12 passed** |
| `npx vitest run` (frontend) | **92 files, 996 tests passed** |
| `npx vite build` (frontend) | built in 5.9 s; the only warning is the existing chunk-size one |

The pytest categories cover:
- the Diagnostic shape and the preview label;
- missing and unmapped links;
- six address-conflict cases;
- the dependency graph;
- valve without pump and nozzle without valve;
- CAD topology groups;
- valve open with pump off;
- valve close against pump (error, or warning with a bypass) and dead-head;
- a valve following its nozzles;
- nozzle while valve closed;
- output limits;
- minimum on/off;
- unsupported channels for DMX and I-CAN;
- the flame burst limit and re-fire;
- pump short-cycle;
- recipe fix target and muted groups;
- revision stability;
- Siemens compile collecting every error with IDs;
- Siemens site-invalid → PLC panel;
- the Siemens interlock warning;
- the `show_engine` gate: refuses with no driver output, allows a clean real show and simulation, and fails closed when the preflight raises;
- the Siemens `start` gate (plcsim) and the simulated label;
- the I-CAN flame relay gate;
- the endpoint and the structured compile route.

The vitest tests cover the merge with `showDiagnostics` present, absent and failing; `runPreflight`; each fix-navigation kind, including pending focus and legacy timeline selection; grouped rendering; and frame-based flame and dependency safety.

## Behaviour changes

1. **Siemens compile.**
   - Every error is reported at once.
   - The exception is `PreflightError`, a subclass of `ValueError`.
   - A site with an invalid mapping no longer compiles (`site-invalid`). `validate_site` already prevents such sites from being saved.
   - The HTTP 400 `detail` for a refused compile is now an object (`message` plus `issues`). Other Siemens errors still return a string.
2. **Commissioned `show_engine.play()`.** It now also refuses on any of the following:
   - flame bursts longer than 3 s;
   - a pump dead-heading or a valve closing against a running pump with no bypass;
   - clips on devices that are neither in the design nor mapped;
   - DMX, PLC or I-CAN address conflicts;
   - minimum on/off violations;
   - a valve with no supplying pump.

   Uncommissioned playback is unchanged.
3. **Siemens `start()`** for PLCSIM and physical sites re-validates the saved show.
4. **I-CAN manual pattern run.** It returns 409 when the preflight finds errors, such as a relay labelled `flame` on for longer than 3 s.
5. **Event compiler.** Flame on-time spans back-to-back clips; previously only adjacent event pairs were checked. It now also adds dependency warnings.

## Limitations and follow-ups

- **Engineering item selection.** `aquaflow:select-engineering-item` and `takePendingFocus("engineering")` are dispatched, and the geometry panel opens. However, `PoolGeometryDesigner.jsx` keeps its selection in local state and is owned by AF-NEXT-011, so its listener (`setSelectedFixture`) is not added here. The issue still names the item and opens the designer.
- **`services/show_hydraulics.py`** (AF-NEXT-007/008) does not exist yet. The backend hook is guarded, and the frontend merges `showDiagnostics.js`, which is currently a stub returning `[]`.
- **Siemens TIA download (`engineering/download`)** is not show-gated. It deploys the generic site PLC program, not show data. Show output is gated at `start()`.
- **The I-CAN single-channel commissioning toggle (`/output/channel`)** is not preflight-gated. It is an explicit, operator-confirmed single-relay test that passes through the bus safety gate.
- **Pump short-cycle** and the **flame minimum off-time** are warnings rather than errors; existing shows had no such rule.
- **Engineering items** have no 3D selection affordance, so `open_engineering_item` navigation is to the designer panel.
- **Rollback.**
  - Delete `services/preflight.py`, `api/routes/preflight_routes.py`, `src/preflight/` and `PreflightPanel.jsx`.
  - Restore the previous `compile_show` body, which is in git.
  - Remove the `show_engine.play`, `SiemensRuntime.start` and `run_manual_pattern` gate blocks, the `main.py` router lines, the `CompilePanel` mount and the `ShowStudio` listener.
  - Saved shows are unchanged in both directions.

No bug was found in `evaluateShowFrame.js` or `show_frame.py`.
