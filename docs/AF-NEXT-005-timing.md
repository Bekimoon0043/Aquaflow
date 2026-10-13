# AF-NEXT-005: show time, evaluation policies and clock ownership

Date: 2026-10-13. Applies to the canonical show frame `aquaflow/frontend/src/show/evaluateShowFrame.js` (contract version `1.0.0`) and its Python mirror `aquaflow/backend/engine/show_frame.py`.

## 1. One evaluator, one time base

Every view asks the same question: "what is fixture X doing at show time t?" The canonical frame answers it. The views below now consume the canonical frame:

| View | Adapter | Notes |
| --- | --- | --- |
| Show Studio timeline and plan | `studio/showModel.js` `sampleClips` | value = highest active channel level; colour = evaluated colour |
| Embedded 3D preview (Studio) | `utils/fullShowPreview.js` `evaluateFullShowPreview` | maps the frame onto the renderer's `fixtureIntensities` / `fixtureLightStates` / `fixtureMotion` |
| Full 3D preview (PreviewPanel) and design preview | `utils/icanPatternPreview.js` → the above; `designClips` branch evaluated canonically | |
| Video export | `video/bakeSignalSampler.js` → `evaluateICANPreview` | no code change; inherits the adapter |
| Legacy track timeline | `utils/runtimeSignalSelector.js` `deriveRuntimeSignals` | uses the canonical fade/curve function and `[start, end)` window; its group/global signal model is unchanged |
| Dry run | `utils/dryRunPreview.js` | level channels come from the canonical frame; motion positions remain event-evaluated |
| Event compiler | `utils/runtimeEventCompiler.js` | fade events reproduce the canonical envelope; overlaps become `OVERLAP` warnings |
| Frame compiler | `utils/showProgrammerCompiler.js` | ordinary clips are evaluated canonically; effect templates unchanged |
| Siemens PLC frames | `backend/engine/siemens_site.py` `frame_at` → `show_frame.py` | |
| Legacy backend timeline | `backend/engine/show_engine.py` `_evaluate_timeline` | canonical fades plus highest-takes-precedence per device and type |

Time units: clips store seconds; the public contract is `evaluateShowFrame(project, timeMs, opts)`. Adapters that already work in seconds call `evaluateShowFrameAt(project, seconds, opts)`. This avoids a ms→s round trip that could move a sample across a clip boundary.

## 2. Policies

| Topic | Policy |
| --- | --- |
| Active window | Half-open: `start <= t < end`, with `end = start + duration`. Back-to-back clips never both play at the seam. `deriveRuntimeSignals` used `<= end` before this change. |
| Fades | `factor = shape(min(1, (t-start)/fadeIn, (end-t)/fadeOut))`. One shape applies to both ramps, and the level is `clamp01(value/100 × factor)`. |
| Curves (`clip.curveType`) | `linear`; `ease-in` (x²); `ease-out` (1-(1-x)²); `ease-in-out` (2x² below 0.5, else 1-(-2x+2)²/2); `step` (switches at the midpoint of each ramp). Aliases such as `ease_in` and `ease_both` are accepted. An unknown name is evaluated as linear and produces an `unsupported-curve` diagnostic. The event compiler mirrors the curve on fade-out: ease-in becomes `EASE_OUT` and ease-out becomes `EASE_IN`. Siemens compile still accepts only linear fades (unchanged gate). |
| Overlap | Highest takes precedence per fixture and channel type. On a tie, the clip later in the clip array wins. The fixture's `source` and decorative colour come from the winning clip. Every overlap is a static `overlap` diagnostic and also appears in each frame where it is active. Event lists cannot express HTP, so the event compiler emits an `OVERLAP:` warning. The Siemens compiler still refuses overlaps on one output. |
| Lights | When any `lighting_red`, `lighting_green` or `lighting_blue` clip is active, the colour comes only from those channels; channels that are not driven are 0. Otherwise the colour is the winning master clip's `color`, or white when the clip has none. Master is `lighting_master` (or `device_intensity`); it is 1.0 when only RGB channels play. Emitted drive is `output = color.srgb × level`, and bytes are `round(output × 255)`. |
| Colour space | `color.srgb` is the gamma-encoded value stored in the hex and written unchanged to 8-bit DMX and PLC outputs. `color.linear` is the IEC 61966-2-1 linearisation for renderers. `lightViewState()` returns `{intensity, color}` such that colour × intensity equals `output`. |
| Motion | Pan/tilt are positions, not levels. The latest active clip in array order wins. A water clip on a `motion*` fixture sets the pose from its `pan` and `tilt`. Values are clamped to ±45°. |
| Pattern phase | Phase is resolved once by `compileStudio`: per-member offsets from the ordered group (`orderMembers`), `spread` and `cycles`. The evaluator plays the resolved clips, so every view sees the same phase. A test checks that a 4-member wave agrees across timeline, 3D and canonical at 59 sample times. |
| Tempo map | `tempo: [{time (s), bpm}]`, with bpm 20–300 and a default of 120 from 0. `beatsToSeconds`/`secondsToBeats` integrate it piecewise. A clip may be timed by `startBeat`/`durationBeats` (resolved through the map), but Studio still stores seconds. Fades stay in seconds. `snapBeat` keeps its own per-section snapping. |
| Sections | `project.sections: [{id, start, end}]`; `opts.section` selects one. Without a loop, `t >= end` gives state `ended` (all off). With `opts.loop`, playback wraps inside the section. `t` is always absolute show time, and times before the range start do not wrap. |
| Loop | `opts.loop = true | {startMs, endMs, repeat}`. Show time is `(startMs + (tMs - startMs) % spanMs) / 1000`; this is the same arithmetic as the old `fullShowPreview`, and it is mirrored in Python with `math.fmod`. Reaching `repeat` passes gives `ended`. |
| Stop / blackout | `opts.stopped` gives `stopped`, `opts.blackout` or `project.blackout` gives `blackout`, and the end of a bounded range gives `ended`. Each produces an all-off frame: levels 0, valves closed, pumps stopped, lights output 0. Blackout keeps time running; stop is a transport action. `icanPreviewStore.stop()` returns the playhead to 0, and the Siemens runtime sends an explicit off frame. |
| Mute / solo | Clip `muted`/`disabled`/`isMuted` is skipped. A recipe is silent if it is muted or any ancestor group is muted (`parentId` chain, cycle-safe). If any group is soloed, a recipe plays only when its group or an ancestor is soloed. `compileStudio` and the evaluator share `recipeAudible`. |
| Tolerance | Paths are expected to agree exactly; the documented tolerance is 1/255 for levels and 1 for 8-bit bytes. JS `Math.round` and Python `_round_half_up` both round half up. The Siemens encoder uses Python `round` (banker's rounding) on master×RGB, which accounts for any difference of one byte. |

## 3. Clock ownership: simulation time vs PLC follow time

AF-NEXT-003 counted five clocks. This change keeps them, but each now has one owner and one purpose. All of them evaluate the same canonical frame, so the only state they share is a position in seconds.

| Clock | Owner | Used when | Authority |
| --- | --- | --- | --- |
| **Simulation time**: Show Studio `timeRef` (rAF, `ShowStudio.jsx`) | Frontend | Programming and previewing in Show Studio | Authoritative for the Studio timeline, the plan and the embedded 3D. Loops reset to 0 at `end`. |
| **Simulation time**: `icanPreviewStore` (anchor + `performance.now()`) | Frontend | 3D Preview workspace, embedded preview timeline, video bake | Authoritative for PreviewPanel. `replace()` keeps the live position across edits, so an edit never resets or rewinds the playhead. |
| **PLC follow time**: `siemens_runtime._play` (`time.monotonic()` since start, 10 Hz frames) | Backend | A compiled Siemens show is running (simulated, PLCSIM or physical) | **Sole authority for hardware output.** It does not loop and stops at `show.duration`. The UI never writes it. |
| PLC follow display (`followPlc`, about 400 ms status poll) | Frontend (read-only) | While the PLC runs a show | The Studio playhead mirrors `status.elapsed`. Expected lag is up to one poll plus one 100 ms frame. Local playback is not authoritative in this mode. |
| Legacy `show_engine` tick | Backend | Legacy track runtime (not the Studio path; see AF-NEXT-004-05) | Its own clock; now uses canonical fades and HTP. |

Rules:

1. Simulation time never drives hardware. Preview stores have no network or hardware client; an existing test asserts that no `fetch` is made.
2. PLC follow time never takes input from the browser clock. The PLC frame at `elapsed` is `frame_at(site, show, elapsed)`, the same canonical frame the preview shows at that time.
3. Seeking, looping and sections are simulation-time features. The Siemens runtime plays once from 0, and `frame_at(..., loop=True)` is available but not used by the runtime.
4. Latency compensation (`runtimeEventCompiler` `latencyMs`) shifts event times for transport only. The dry run reports audience-time (unshifted) levels.

## 4. Limitations

- Studio clips still do not reach `showStore.timelineTracks` or the backend `show_engine` (AF-NEXT-004-05). Both remain separate legacy paths; they now share only the fade and overlap maths.
- The 3D renderer still interprets `{r,g,b}` signal objects as linear while the frame carries sRGB (AF-NEXT-004-07). The full colour pipeline belongs to AF-NEXT-013.
- Valves, pumps and equipment have no 3D drawing. In the 3D views a pump is the global `pump` signal.
- Event lists cannot represent HTP. Overlapping channels are therefore warned about, not compiled exactly.
- Tempo-timed clips (`startBeat`) are supported by the evaluator but not created by the Studio UI, and the Siemens compiler requires seconds.
