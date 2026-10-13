# AF-NEXT-001 — Baseline and test triage (evidence)

Date: 2026-10-13
Machine: Windows 11 Home 10.0.26200, Python 3.12.10, Node v24.20.0, vitest 2.1.9

## 1. Source and installed versions

| Item | Value | How obtained |
|---|---|---|
| Source revision | `a1086d05f87b31b3d872293752bc6db668afc0a0`<br>"Package and install 1.2.32 (engine with ezdxf CAD import)" | `git rev-parse HEAD` |
| Worktree | Heavily modified: 735 entries in `git status --short`. It was preserved: no reset, stash, checkout, clean or commit was run. Other agents (AF-NEXT-004/005/006/010/012) were editing it concurrently. | `git status --short \| wc -l` |
| Desktop package manifest | 1.2.32 | `aquaflow/desktop/package.json` |
| Installed desktop | 1.2.32.0, exe dated 2026-10-13 10:53. Location: `%LOCALAPPDATA%\Programs\AquaFlow Studio`, bundled engine in `resources\engine` | `(Get-Item "…\AquaFlow Studio.exe").VersionInfo.ProductVersion` |
| Update channel | generic, `https://luxuryconworld.com/updates/aquaflow/`, channel `latest` | `resources\app-update.yml` |

**Licensing.** `resources\app-config.json` ships a placeholder secret labelled *dev-only, not for production*. License-independent startup was **not** exercised in this ticket because no app was launched. This belongs in the AF-NEXT-016 release check.

## 2. Commands

From the repo root `C:\Users\user\Documents\aquaflow`:

```
cd aquaflow/frontend && npx vitest run
cd aquaflow/frontend && npx vite build
cd aquaflow/backend  && python -m pytest tests -q -o addopts=""
```

## 3. Baseline results (before any change)

| Suite | Result |
|---|---|
| Frontend `npx vitest run` | **2 failed** / 812 passed (814 tests, 82 files). Both failures are in `src/utils/__tests__/referenceFountainShow.test.js`. |
| Backend `pytest tests -q -o addopts=""` | **1 failed** / 1137 passed / 21 skipped (94.7 s). The failure is `tests/test_hardware_output.py::test_loopback_output_timing_within_spec`. |

## 4. Failure classification

### F1/F2 — `referenceFountainShow.test.js` (2 tests): test-fixture defect

**Cause.** The test read `<repo>/outputs/Reference_Keyhole_Crown_Fountain.aqua`:
- That file is produced by `aquaflow/tools/generate_reference_fountain_show.mjs`.
- `outputs/` is gitignored, and the file had never been generated on this PC, so the test failed with ENOENT.
- Product code is not involved.

**Fix.**
- The generator now exports a pure `buildReferenceFountainShow({ savedAt })`. Running the script directly still writes the same file.
- The test builds the show in memory, JSON round-trips it to match the old write/read, and then exercises the real `deserializeShow` and `deriveRuntimeSignals`.
- None of the assertions were changed.

**After.** 2/2 pass. `node -e "import('./tools/generate_reference_fountain_show.mjs')"` no longer writes to `outputs/` on import.

### F3 — `test_loopback_output_timing_within_spec`: product defect (plus a measurement defect)

**Hypothesis checked.** The suspected cause was Windows' 15.6 ms timer granularity. A scratch script ran the real `ArtNetDriver` against the loopback `VirtualDMXNode` 10 times for 0.3 s each. It stamped every received frame with both `time.monotonic()` and `time.perf_counter()`.

**Clock resolution on this PC:**

```
monotonic    GetTickCount64()           resolution=0.015625
perf_counter QueryPerformanceCounter()  resolution=1e-07
asyncio ProactorEventLoop._clock_resolution = 0.015625
```

**Before the fix** (perf_counter intervals, representative run):

```
13.03, 16.07, 15.18, 16.09, 15.43, 15.5, 15.55, 15.76, 16.49, ... ms
median 15.6-15.9 ms (≈ 64 Hz); minimum 7.2-15.2 ms; 10/10 runs out of spec
```

**Conclusion.** The driver was **really transmitting at about 64 Hz**, above the Art-Net 44 Hz per-universe ceiling. The coarse stamps were not the only problem.

Why it happens:
- `ArtNetDriver._loop` (and the identical `SACNDriver._loop`) slept with `asyncio.sleep(1/44 − elapsed)`.
- asyncio schedules on `time.monotonic()` and treats any timer due within one clock resolution (15.6 ms) as ready.
- So a 22.7 ms sleep wakes after about 15.6 ms.

There was also a separate measurement problem. The verifier stamped receive times with `time.monotonic()`, so every interval measured as either 15.0 or 16.0 ms.

This was not caused by the stop() blackout frame. That frame goes out on the next paced tick, and excluding it made no difference.

**Fix** (narrow; no safety threshold changed):
- **New `aquaflow/backend/protocols/frame_pacing.py`.**
  - `sleep_until(deadline)` waits on `perf_counter` and never returns early.
  - The coarse part uses `asyncio.sleep`. The final sub-tick uses `time.sleep` in the executor, which is a high-resolution waitable timer on Windows (Python ≥ 3.11).
  - There is no busy-spin and the event loop is never blocked.
  - `paced_loop(is_running, tick, max_hz)` re-anchors on overrun instead of bursting.
- **`protocols/artnet_driver.py` and `protocols/sacn_driver.py`.** `_loop` now calls `paced_loop(...)`.
- **`services/hardware_verifier.py`.** `VirtualDMXNode` stamps with `perf_counter`.
- **Unchanged:** `analyze_timing` limits (44 Hz × 1.2 ceiling, 0.7 × 22.676 ms floor) and every other check.

**After the fix** (same script, 10 runs):

```
median 22.67-23.01 ms (≈ 43.6-44.1 Hz); minimum 18.7-22.4 ms; 10/10 runs within spec
(monotonic stamps would still read 15/16/31 ms; hence the perf_counter stamp)
```

`pytest tests/test_hardware_output.py` passed 5 times in a row (19/19 each).

### F4 (found during triage) — `test_ican.py::test_blackout_streams_off_rather_than_going_silent`: test race

This test passed in the baseline run but failed in the next full run.

**Flake rate.** 16 of 30 isolated runs failed. The test imports none of the modules changed above (checked through `sys.modules`).

**Instrumentation** (scratch probe, 30 runs). The leaked frame was always the first one received. In every case it had been *sent before* `blackout()` returned:
- 0 ON frames were sent after blackout.
- The test then cleared `gw.received` while that datagram was still in the fake gateway's receive thread.

**Product race ruled out.** A tentative product hypothesis was a refresh-loop snapshot taken under `_tx_lock`. Changing that did not alter the flake rate (19/30), so it was reverted. `engine/ican_connection.py` is unchanged.

**Fix (test only).** The test no longer clears the buffer. It checks wire order instead, which is stricter:
- the ON state streamed before blackout
- an OFF frame arrived
- every frame after the first OFF is OFF
- at least 2 frames streamed after it

**After.** 0/30 failures, and test_ican is 28/28.

## 5. Results after this ticket

| Suite | Result |
|---|---|
| Backend full suite | **1160 passed / 21 skipped / 0 failed** (86.9 s). The count went up because concurrent agents added tests. |
| Frontend `npx vitest run` | **819 passed / 1 failed** (820 tests, 83 files). The failure is listed below. |
| Frontend `npx vite build` | **OK**, built in 9.5 s. |

**Remaining frontend failure, not owned by this ticket.** `src/utils/__tests__/showFileEngineering.test.js > round-trips the full engineering project`. A restored depth zone now carries `basinId: "basin-1"`.
- It comes from the in-flight AF-NEXT-010 multi-basin work in `engineering/engineeringProject.js` (`reconcileBasins` / `scopeDepthZones`). That file is modified and new `engineering/basins.js` is untracked.
- It is not present at baseline and not caused by these changes.
- **Owner:** the AF-NEXT-010 agent. Either the test's expectation must accept `basinId` or the save path must strip it.

**Reproducing without touching user changes.** Run the three commands in §2. No step requires reset, clean or deletion.

## 6. Sample-project inventory

| Project | Location | Tracked? | Notes |
|---|---|---|---|
| **Lebu pilot** (new, AF-NEXT-002) | `aquaflow/samples/lebu-pilot/Lebu_Fountain_Pilot.aqua` + `manifest.json` + README | to be committed | The portable pilot. |
| Lebu CAD pattern (original) | `outputs/Lebu_Fountain_CAD_Pattern.aqua` and an identical `.aquashow` (50,326 B) | gitignored | Made by untracked `.tools/generate_lebu_fountain.mjs`. |
| Lebu DXF | `outputs/lebu_fountain_converted.dxf` (81.9 MB) | gitignored | Made by LibreDWG `dwg2dxf` from `lebu fountain.dwg`. `$INSUNITS` = 6, AC1021. |
| Lebu LibreDWG JSON | `outputs/lebu_fountain.min.json` (202.5 MB) | gitignored | Read by `.tools/analyze_libredwg_json.py`. |
| Lebu source DWG / `Scene 9_1.png` render | — | **missing** | Not found on this PC. They are recorded as missing in the manifest. |
| Reference Keyhole Crown | generated in memory; `node aquaflow/tools/generate_reference_fountain_show.mjs` → `outputs/` | generator tracked | Concept reconstruction from reference frames. |
| PLCSIM training project | `aquaflow/tools/migrate_plcsim_training_project.mjs` | tracked | Siemens training material, not a fountain sample. |

No `.aqua` sample is bundled in the installed 1.2.32 package.

## 7. Files Wave 1 (AF-NEXT-004..006) will change

See `docs/AF-NEXT-003-journey-map.md` for the evidence behind each one.

**AF-NEXT-004/005 (canonical frame and timing parity):**
- FE `components/programmer/studio/showModel.js` (`compileStudio`, `sampleClips`)
- FE `utils/fullShowPreview.js`
- FE `utils/runtimeSignalSelector.js`
- FE `utils/runtimeEventCompiler.js`
- FE `utils/showProgrammerCompiler.js`
- FE `utils/dryRunPreview.js`
- FE `video/bakeSignalSampler.js`
- FE `components/preview/FountainScene_v6.js` (`setSignals`)
- FE `components/preview/sceneLighting.js` (`colorFromSignalColor`)
- FE `components/programmer/studio/StudioPreview.jsx`
- FE `components/preview/PreviewPanel_v5.jsx`
- BE `engine/siemens_site.py` (`compile_show` / `frame_at`)
- BE `engine/siemens_devices.py` (`translate_show`)
- BE `engine/show_engine.py` (`_evaluate_timeline`)
- BE `engine/show_frame.py` (new, in flight)
- BE `engine/protocol_bus.py` (`_route_command`)

**AF-NEXT-006 (recovery and dependencies):**
- FE `utils/showFile.js`
- FE `hooks/useAutoSave.js`
- FE `store/projectStore.js`
- FE `utils/projectRecovery.js` and `components/ProjectRecoveryHost.jsx` (both new, in flight)
- desktop `main.js`
- BE `schemas/autosave_schemas.py`

## 8. Files changed by this ticket set (001–003)

- `aquaflow/tools/generate_reference_fountain_show.mjs`: pure builder plus main guard
- `aquaflow/frontend/src/utils/__tests__/referenceFountainShow.test.js`: in-memory artifact
- `aquaflow/backend/protocols/frame_pacing.py` (new), `protocols/artnet_driver.py`, `protocols/sacn_driver.py`
- `aquaflow/backend/services/hardware_verifier.py`: perf_counter receive stamps
- `aquaflow/backend/tests/test_ican.py`: order-based blackout assertion
- AF-NEXT-002/003 files: see their own notes

## 9. Remaining risks

- **Precise sleep on Windows** relies on Python ≥ 3.11 high-resolution `time.sleep`. The bundled engine must use the same Python. Re-run `validate_hardware_output.py` on the packaged engine before 1.2.33.
- **Physical hardware.** The loopback node proves on-wire cadence only. Physical DMX/Art-Net nodes remain unverified, and no hardware was contacted.
- **The installed 1.2.32 still has the 64 Hz Art-Net/sACN cadence** until it is repackaged.
