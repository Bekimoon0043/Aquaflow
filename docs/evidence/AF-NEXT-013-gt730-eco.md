# AF-NEXT-013 follow-up — GT 730 eco tier, re-measured on the real PC

Date: 2026-10-14. Machine: the same PC as `AF-NEXT-013.md` (NVIDIA GeForce GT 730 4 GB, Intel i5-10505, Windows 11, display 1440×900 at 59 Hz).

The user's installed AquaFlow 1.2.34 was running on the same PC throughout (it was not touched). Its GPU use is included in every number below. Run-to-run spread on this card is about ±5 %.

## What was measured

| Content | Source |
| --- | --- |
| **Lebu wave** | `Lebu_Fountain_Wave_SoftLights_30s.aquapkg` from the user's Desktop, copied to a temp folder first (read only). 12 × 2.5 m DN25 jets and 12 RGB lights, plus the GLB sculpture. |
| **Synthetic 100** | `siteForFixtureCount(100)` from `largeShowBench.js`: 64 nozzles of 10 types and 36 lights, all on. |

Two methods were used.

1. **Bench runner** (`aquaflow/tools/gpu-bench/run.mjs`). This is the AF-NEXT-013 Electron 33 runner with a full 1440×900 canvas and an orbit camera. Every jet and light is fully on. It is the worst case.
   - New options: `--aqua <file>`, `--width/--height`, `--vsync` and `--out-suffix`.
   - **vsync on** matches what the desktop app actually runs with. **vsync off** is the original throughput methodology.
   - Raw files: `AF-NEXT-013-gpu-nvidia-geforce-gt-730-gt730-{before,after}-{vsync,novsync}.{md,json}`.
2. **Real app.** `dist/win-unpacked` was copied to a temp folder. Its `app.asar` was repacked with this change's `main.js`, `preload.js`, `menu.js` and `open-queue.js`, and `web/` was rebuilt fresh. The app was launched with `--remote-debugging-port`, an isolated `--user-data-dir` and window occlusion detection off, and driven over CDP.
   - The Lebu package was passed on the command line, so it was also the issue-1 test (see below).
   - The show was playing in a loop (`Play preview`) with the Day environment and the saved "Design presentation view".
   - Frames are the page's `requestAnimationFrame` intervals: 8 s warm-up, then a 15 s sample.
   - The tier actually rendered was read from the Performance HUD.

**Mean fps** (frames ÷ seconds) is the number quoted. With vsync on, frame intervals snap to 16.7 / 33 / 50 / 67 ms. On this card the median interval is almost always 16.7 ms (≈60 fps) even when the real rate is half that, so the median is reported but must not be quoted alone.

## Bench runner, 1440×900, all on (worst case)

| Tier | Scene | Before: mean fps (vsync on) | After: mean fps (vsync on) | Before → after, vsync off (mean fps) | Draw calls before → after | Particles before → after |
| --- | --- | --- | --- | --- | --- | --- |
| **eco** | Lebu wave | **29.5 / 30.2** (two runs) | **35.2** | 32.1 → 37.9 | 450 → 263 | 20,480 → 14,336 GPU |
| **eco** | synthetic 100 | **33.2 / 33.1** | **38.9** | 35.7 → 42.5 | 356 → 297 | 20,480 → 14,336 GPU |
| low | Lebu wave | 33.2 / 33.7 | unchanged (tier not modified) | | 244 | ~3.6k CPU |
| low | synthetic 100 | 19.9 / 20.0 | unchanged | | 278 | ~48k CPU |

Before the change, eco on the Lebu wave was **below 30 fps** (29.5 in one run, 30.2 in the other). It was also *more expensive* than low on the same project: 450 vs 244 draw calls.

## Real app (Lebu wave, show playing)

| Layout | Tier setting | Rendered tier (HUD) | Before: mean fps | After: mean fps |
| --- | --- | --- | --- | --- |
| Design workspace (canvas 1056×396) | Eco, adaptive off | eco | 52.9 / 55.8 | — (not re-measured) |
| Design workspace | Low, adaptive off | low | 59.8–59.9 | — |
| Design workspace | Auto + adaptive | low (climbed from eco) | 59.9 | — |
| 3D view fullscreen (canvas 1240×874, sidebar visible) | **Eco, adaptive off** | eco | **34.4** | **36.0** |
| Fullscreen | Eco + adaptive | before: low (bug, see below); after: eco | 43.1 (rendered low) | 33.2 |
| Fullscreen | Low, adaptive off | low | 41.7–43.2 | 40.8 |
| Fullscreen | **Auto + adaptive** | low | **54.2** | **54.6** |

In the app, eco stays at or above 30 fps both before and after the change. The in-app gain is within run-to-run noise: the HUD's scene frame time was 26.6 ms before and 24.5–27.9 ms after. The worst-case bench gain (+5–6 fps) is clear.

The default on this PC is Auto + adaptive, and it gives the best result, about 54 fps. On a GT 730 the controller starts at eco and settles on low, because low is cheaper than eco for these projects.

Jets remain fully visible on eco after the change: all 12 wave jets were drawn at their 2.5 m design height in the fullscreen eco screenshot.

## Eco tuning applied (`sceneQuality.js`)

| Setting | Before | After | Why |
| --- | --- | --- | --- |
| `softDepth` | true | **false** | The depth probe re-renders every opaque mesh: 450 → 263 draw calls on the Lebu wave, 356 → 297 on the synthetic site. Particles now meet geometry with a hard edge. |
| `gpuWater` / `gpuSpray` | 16,384 / 4,096 | **12,288 / 2,048** | Particle fill was the largest remaining eco cost (the earlier eco ablation measured 23.6 → 41 fps with particles off). Droplets are still drawn at the 1.6× eco size cap, and the core-column meshes carry each jet, so no jet disappears. |

Everything else in eco is unchanged: pixel ratio 1, no MSAA, half-resolution bloom, half-resolution spray, the eco water shader, and the nearest 4 fixtures. The low, medium and high tiers are unchanged (asserted in `sceneAdaptive.test.js`).

## Bug found while measuring (fixed)

**Adaptive left the preview on a tier the user had not selected.**

- **What happened:** after adaptive quality climbed from eco to low, unticking *Adaptive* (or picking Eco again) left the preview rendering "low · fixed" while the panel showed **Eco** selected.
- **Cause:** `PreviewPanel_v5.jsx` re-synced the effective tier only when `startTier` changed. On an entry GPU the start tier is "eco" both before and after.
- **Fix:** it now also re-syncs when the quality choice or the adaptive setting changes.

The "Fullscreen, Eco + adaptive" before-row was affected by this bug (it rendered low).

## Not measured

- Synthetic 100 inside the real app. It has no project file, so it was measured only in the bench runner.
- A GPU other than the GT 730.
