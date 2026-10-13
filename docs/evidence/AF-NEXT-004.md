# AF-NEXT-004 evidence: canonical evaluated show frame

Date: 2026-10-13. Scope: frontend `aquaflow/frontend/src`, backend `aquaflow/backend`. No hardware was connected, armed or written. All Siemens tests use `mode: "simulated"` sites and only encode frames.

## Behaviour before the change

There were seven evaluators with copies of the fade maths: `sampleClips`, `evaluateFullShowPreview`, `deriveRuntimeSignals`, the dry run/`runtimeEventCompiler`, `showProgrammerCompiler`, Siemens `frame_at`, and `show_engine._evaluate_timeline`. They differed as follows:

- **Window.** `deriveRuntimeSignals` used `[s, e]`; the others used `[s, e)`.
- **Overlap.** Policies included max, last-wins, latest event and refusal.
- **Fades.** The event compiler had no fade-in; its fade-in event ramped toward 0 across the whole hold.
- **Plain clips.** `showProgrammerCompiler` ignored plain clips completely.
- **Light colour.** Siemens dropped a light clip's `color` in `compile_show` and in `translate_show`. A Studio light (coloured `lighting_master`) therefore went to the PLC black.

## Delivered

- `frontend/src/show/evaluateShowFrame.js`: a pure module with versioned contract `aquaflow-show-frame` `1.0.0`. It provides `evaluateShowFrame(project, timeMs, opts)` returning `{version, timeMs, showTimeMs, state, passIndex, fixtures{level, channels, color{hex, srgb, linear, source}, output, motion, source{clipId, recipeId, trackId}}, pumps{speed, run}, valves{open}, diagnostics[]}`. It has one fade and curve implementation and one overlap policy (HTP, ties to the later clip, `overlap` diagnostics). It also handles mute/solo inheritance, loop, sections, stop and blackout, a tempo map, a cached per-second bucket index, `frameHash`, `lightBytes` and `lightViewState`. The policies are in `docs/AF-NEXT-005-timing.md`.
- `backend/engine/show_frame.py`: a line-for-line Python mirror.
- **Adapters.** Their public APIs and output shapes are unchanged; legacy `.aqua` loading is untouched because only clips are read.
  - `showModel.js`: `sampleClips` uses the canonical frame, and `compileStudio`/`groupFlag` use the shared `recipeAudible`/`groupInherits`.
  - `fullShowPreview.js`: canonical evaluation, and the supported curves are accepted.
  - `icanPatternPreview.js`: the `designClips` branch.
  - `runtimeSignalSelector.js`: shared `fadeFactor` and the half-open window. Studio track types `pump_speed`, `device_intensity`, `solenoid_open` and `lighting_master` are mapped.
  - `runtimeEventCompiler.js`: correct fade-in, hold and mirrored fade-out events; ordering for closing versus opening at the same instant (new additive `edge` field); `OVERLAP` warnings; `compiled.clips`.
  - `dryRunPreview.js`: canonical level channels.
  - `showProgrammerCompiler.js`: plain clips are evaluated canonically.
  - `show_engine.py`: canonical fades and HTP per device and type.
- **Siemens.**
  - `compile_show` keeps a validated light `color` (and `id`).
  - `frame_at` evaluates via `show_frame` (new `show_project`, `evaluate_site_frame`, `frame_values`; optional `loop` and `blackout` keyword arguments).
  - `translate_show` keeps a light colour.
  - The colour becomes the RGB output bytes (TIA tags `L<n>_Red`/`_Green`/`_Blue`, i.e. 3 consecutive `%QB`) as `round(srgb × master × 255)`.
- **Playhead.** `icanPreviewStore.replace()` now carries the live clock position while playing (it previously used the last ticked value), so an edit neither resets nor rewinds the playhead. The user's existing `replace()` work is preserved.
- **Golden show.** `frontend/src/show/__tests__/golden/golden-show.json` has 5 fixtures (pump, valve, nozzle, 2 RGB lights) and 7 clips. It covers fades, an overlap, a colour master and an RGB channel override. Its 11 checkpoints are start, fade-in midpoint, fade boundary, overlap, midpoint, fade-out midpoint, pump fade-out, end, loop boundary, second pass and blackout, each with hand-derived expectations.

## Commands and results (Windows 11, Node v24.20.0, Python 3.12)

| Command (cwd) | Result |
| --- | --- |
| `npx vitest run src/show` (frontend) | 2 files, **95 passed** (81 golden-parity + 14 timing/replay) |
| `npx vitest run` (frontend) | **90 files, 971 tests passed.** The previously known `referenceFountainShow.test.js` failure was green at this run; another agent owns it. |
| `npx vite build` (frontend) | built in 6.0 s (the existing chunk-size warning only) |
| `python -m pytest tests/test_show_frame.py -q -o addopts=""` (backend) | **31 passed** |
| `python -m pytest tests -q -o addopts="" -k "siemens or show or compile"` (backend) | 136 passed before the new file was added; included in the full run below |
| `python -m pytest tests -q -o addopts=""` (backend) | **1201 passed, 21 skipped** (90 s) |

The parity matrix in `evaluateShowFrame.golden.test.js` runs each checkpoint through every path, at the stated tolerance of 1/255 per level and 1 per byte:

| Path | start / fades / overlap / mid | loop boundary | end | blackout |
| --- | --- | --- | --- | --- |
| canonical (JS) and mirror (Python) | equal to the expectation | yes | yes | yes |
| Studio timeline `sampleClips` | yes | yes (Studio wraps time) | yes | N/A: no blackout in the editor |
| Embedded 3D (StudioPreview path) | yes | yes | yes | yes (shown as stopped) |
| Full 3D preview (store → `evaluateICANPreview`) | yes | yes (repeat 2 plan) | yes | yes (`stop()`) |
| Video sampler | yes | yes | yes | N/A: renders a show, not transport |
| Dry run | yes, including the overlapped nozzle (HTP) | yes | yes | N/A: no blackout command |
| Event compiler | yes for every non-overlapped channel; the overlapped channel is asserted as an `OVERLAP` warning | yes | yes | N/A |
| Frame compiler (`showProgrammerCompiler`) | yes | yes | outside frame range | N/A |
| `deriveRuntimeSignals` per clip | exact (1e-12) | yes | yes | N/A |
| Siemens `frame_at` (pump word, valve bit, RGB bytes) | yes | yes (`loop=True`) | yes | yes (`blackout=True`) |

`frame-trace.json` (318 samples over both golden shows, including loop, section and blackout variants) is reproduced by the Python mirror to 1e-12 for levels, exactly for bytes, sources and valve states.

The playhead test ("no playhead reset after an ordinary edit") does this: seek to 3.2, play, advance 0.3 s, edit a clip, then replace. It checks that the position is 3.5 and still playing, and that the edit is visible at that time. Pausing and replacing keeps both the position and the paused state.

## Behaviour changes

1. **Siemens/PLC.**
   - A coloured light master clip now drives the RGB bytes (it was black before).
   - A master clip without a colour now outputs white × master (it was black).
   - Light `values` report master 0 when no clip is active (they reported 100); the bytes are 0 in both cases.
   - Bench clips and existing tests are unchanged.
2. **3D preview.**
   - When RGB channel clips and a master play together, the emitted colour is RGB × master, the same as the PLC. Before, master was ignored.
   - RGB-channel light state is `{peak, normalised hex}`, so colour × intensity equals the PLC drive.
3. **Event compiler.** Fades now ramp correctly. Events gain an `edge` field. Overlaps produce warnings.
4. **`deriveRuntimeSignals`.**
   - A clip is off at exactly `end`.
   - Studio track types now project onto `pump`/`valve`/`lighting`. Previously they were dropped.
5. **`showProgrammerCompiler`.** Plain clips, and clips whose only effect is the redundant `basic` effect, now produce frames and commands. Previously they produced nothing, or full intensity on all fixtures.
6. **Dry run.** It reports audience-time levels, so latency-shifted event times do not change levels.
7. **`show_engine`.** One command per device and type (HTP). Fades are applied.
8. **3D and `fullShowPreview`.** They accept the ease and step curves instead of throwing.

## AF-NEXT-003 journey-map items (scope of this ticket)

| Item | Status |
| --- | --- |
| 004-01 Siemens drops light colour (`compile_show`, `frame_at`, `translate_show`) | **Fixed** |
| 004-02 Event compiler fade envelope | **Fixed** (and all curves covered by a test) |
| 004-03 Six (seven) evaluators, different maths | **Fixed for maths and policy.** All paths call one envelope and one overlap rule. `deriveRuntimeSignals` still guesses 0–1 versus 0–100 for legacy track clips (deferred: changing it would rescale saved legacy shows). |
| 004-04 Mute/solo | **Fixed in the canonical frame and `compileStudio`.** Clip mute is honoured by every canonical consumer. Deferred: `deriveRuntimeSignals` track solo, and Siemens solo (Siemens receives already-resolved clips with no group data, so this is not applicable). |
| 004-05 Studio clips never reach `showStore`/`show_engine` | **Deferred.** This needs a store migration plan (plan rule: no new store or clock without one). The maths is now shared. |
| 004-06 `showProgrammerCompiler` dead and divergent | **Routed through the canonical frame** for plain clips. There is still no production caller; retiring it is recommended (deferred to the reviewer's decision). |
| 004-07 sRGB hex versus linear `{r,g,b}` | **Partly.** The frame carries both `srgb` and `linear` explicitly. The renderer's `colorFromSignalColor` is deferred to AF-NEXT-013 (renderer colour pipeline); changing it changes every lit scene. |
| 004-08 Unmastered light defaults | **Fixed in the frame.** An inactive light has level 0 and output 0 (colour white); RGB-only means master 1.0. Legacy non-frame defaults are untouched. |
| 004-09 DMX intensity² | **Verified, deferred.** `protocol_bus._route_command` (about :790-824) sends master = `int(scale×255)` and also scales R/G/B by the same `scale`, so a fixture that multiplies master × RGB sees intensity². The RGB scaling is the AQ-X-002 safety fix (dark without a dimmer channel). Changing it alters physical DMX output, so it needs a fixture-profile decision and bench verification (AF-NEXT-015). |
| 004-10 DMX universe off by one | **Verified the registry path subtracts 1** (`protocol_bus` about :539, 1-based to Art-Net 0-based). `update_dmx_map` was not changed. It affects hardware addressing and needs bench confirmation; deferred. |
| 004-11 Renderer drops fixture fields | Out of scope (renderer/CAD); deferred to AF-NEXT-010/013. |
| 004-12 `setSignals` merge leaves stale state | Deferred (renderer). PreviewPanel already passes explicit `null`s when the site preview is inactive. |
| Seventh evaluator `show_engine._evaluate_timeline` | **Fixed** (canonical fades and HTP); covered by `test_show_frame.py`. |
| 005-01 Five clocks | **Documented** in `docs/AF-NEXT-005-timing.md` §3 |

## Limitations and rollback

- The 3D views do not draw valves; pumps appear as the global `pump` signal.
- Event lists cannot express HTP, so overlaps are warnings.
- Siemens compile still requires linear fades and no overlaps; these are safety gates and are unchanged.
- **Rollback.** Revert the adapter edits listed above and delete `frontend/src/show/` and `backend/engine/show_frame.py`. `compile_show` output only adds optional `color` and `id` keys, so saved site shows stay readable in both directions.
