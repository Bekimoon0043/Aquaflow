# AF-NEXT-005 evidence: state and timing parity

Date: 2026-10-13. The policies and clock ownership are in `docs/AF-NEXT-005-timing.md`. No hardware was touched.

## Tests

`aquaflow/frontend/src/show/__tests__/showTiming.test.js` (14 tests) and `aquaflow/backend/tests/test_show_frame.py` (31 tests). The golden files are shared from `frontend/src/show/__tests__/golden/`.

| Acceptance topic | Evidence |
| --- | --- |
| Mute/solo inheritance | Groups root→left/right plus an unrelated group are checked under five cases: no flags, root muted, root solo, child solo and recipe muted. `compileStudio` and the evaluator (given unfiltered clips plus `groups`/`recipes`) select the same fixtures in every case. |
| Overlapping clips | Three clips cover HTP, ties going to the later clip, the source and colour of the winner, and `sampleClips` agreement. 3 `overlap` diagnostics are reported. In the golden show the overlap surfaces in the frame, in the compiler `OVERLAP` warning and in the Python mirror. Siemens still rejects it. |
| Fades and curves | The curves show checks linear, ease-in, ease-out, ease-in-out and step at 0.5, 1.0, 4.0, 6.5 and 7.5 s against closed-form values. Compiled event lists reproduce every curve at 80 sample times (1e-9), excluding the exact step-switch instants. |
| Pattern phase | A 4-member wave recipe on a deliberately shuffled group: start offsets follow the left-to-right order. Timeline, 3D preview and canonical frame agree at 59 times. |
| Tempo changes | Tempo map 120→60 BPM at 4 s: beat 8 is 4 s, beat 16 is 12 s, and the inverse round-trips. A beat-timed clip turns on at 4 s and off at 12 s, with level 0.35 at 4.5 s. The backend matches. |
| Sections | `section: "intro"` past its end gives `ended` and all off. `section: "main", loop: true` at 13 s has the same hash as 5 s (pass 2). Pre-roll does not wrap. |
| Stop | `stopped` gives all off and valves closed. `icanPreviewStore.stop()` gives position 0, `stopped`, and no lights. |
| Deterministic replay | A generated show of **300 fixtures** (200 nozzles, 80 RGB lights, 10 pumps, 10 valves), **5 minutes**, more than 5,000 clips, with random fades, curves, colours and about 6 % overlaps. **400 random seeks** give identical `frameHash` values when cached, when evaluated in reverse order, and when rebuilt from a deep copy. More than 300 distinct frames confirm the show is not static. Python repeats the test with its own generator: 200 seeks, sha256. |
| Views agree | At 40 random times on that show, every fixture agrees: the timeline sampler matches the canonical maximum channel level; 3D nozzle intensity is within 1e-9; 3D light colour × intensity is within 1 byte of the PLC bytes and equal to `lightViewState`; and the 3D pump equals the maximum pump speed. |
| JS ↔ Python | `frame-trace.json`: 318 samples from 2 shows × 3 option sets, from 0 to 13 s every 250 ms. The mirror reproduces levels to 1e-12 and bytes, sources, valves and pumps exactly. Regenerate after an intentional change with `UPDATE_GOLDEN=1 npx vitest run src/show`. |

## Commands and results

| Command | Result |
| --- | --- |
| `npx vitest run src/show` | 95 passed. The replay test takes about 3.2 s, mostly hashing 1,200 frames of 300 fixtures. |
| `npx vitest run` | 90 files, 971 passed |
| `npx vite build` | OK |
| `python -m pytest tests/test_show_frame.py -q -o addopts=""` | 31 passed |
| `python -m pytest tests -q -o addopts=""` | 1201 passed, 21 skipped |
| Scratch benchmark (Node 24, this PC): 300 fixtures, 11,429 clips | Prepare 23 ms once; **0.37 ms per frame** evaluation (1,000 random seeks) |

## Limitations

- Clock unification is by contract, not by a shared clock object. Studio rAF and the preview store remain separate simulation clocks. The PLC follow display lags by up to one 400 ms poll plus one 100 ms frame, and that lag is not compensated.
- The Siemens runtime does not loop, seek or play sections; it plays once from 0, as documented.
- Studio does not author tempo-timed clips or named sections yet; the evaluator supports both.
- The `step` curve switches at each ramp midpoint. At that exact instant an event list and the frame may differ (measure-zero).
