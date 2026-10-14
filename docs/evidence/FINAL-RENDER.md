# AF-3D-VID-002 — Final render quality for video export (measured on the GT 730)

Date: 2026-10-14. PC: NVIDIA GeForce GT 730 4 GB, Intel i5-10505, 15.8 GB RAM, Windows 11.
The live preview on this PC runs on eco (or low, which adaptive quality sometimes picks).

## What was built

In the 3D preview sidebar, open **Video export** (it is folded by default). The section now has:

| Control | What it does |
| --- | --- |
| **Preview / Final / Ultra** | The render quality. **Preview** works as before and uses the live tier. **Final** renders at `high`. **Ultra** is an export-only profile: high plus 2x GPU particles, full-res spray, a full-res soft-depth probe, a 2048 px reflection, 4096 px shadows, 32-sample AO and up to 2x supersampling (downscaled to the output size). |
| **Video / PNG seq** | The output. **Video** is MP4/WebM, as before. **PNG seq** writes numbered PNG frames plus a `_README.txt` with an ffmpeg command. When ♪ is ticked and the site preview has music, it also writes an `_audio.wav`. |
| Progress | Frames done/total, elapsed time and time remaining. The tooltip shows s/frame, the tier and the supersampling factor. **Cancel** works at any time, including while the file is being written. |
| Summary | A short line, for example `✓ 1920×1080 · 30 fps · Final (high) · 5.0 s`, plus the file name. The tooltip shows the folder, codec, size, render time, s/frame and any fallback. |

How a Final render works (`components/preview/finalRender.js`, `finalRenderJob.js`, `useBakeTier.js`):

1. **Temporary tier.** The scene is rebuilt at the chosen tier through a tier *override* (`useBakeTier`). The user's quality setting and the adaptive tier (`effectiveQuality`) are never changed. The camera view (orbit, named view, pose, editor focus) and the wind are copied onto the rebuilt scene.
2. **Adaptive quality stays off.** While the override is set, adaptive quality and dynamic resolution do not run (`adaptiveAllowed`, plus the existing `_baking` guard).
3. **Warm-up.** The water simulation warms up for 4 s (instead of 3 s) before frame 0, so the denser fields are full on the first frame.
4. **Restore.** The override is always cleared afterwards: on success, on cancel, on error and after a failed fallback (`runFinalRender`'s `finally`). Clearing it rebuilds the preview at its previous tier, with the same camera, and re-applies the adaptive render scale.
5. **GPU limits.**
   - If a tier cannot be built, the GPU particle buffers are missing, the context is lost, or `getError()` reports OUT_OF_MEMORY, the render falls back: ultra → high → medium → the preview tier. Each step shows a short ⚠ notice.
   - The context-loss check runs on every frame, so a GPU reset never encodes black frames.
   - `encoder.finish()` has a watchdog. Without it, a GPU reset left the UI stuck on "Writing file…".
   - The desktop shell now calls `app.disableDomainBlockingFor3DAPIs()`. Otherwise Chromium blocks WebGL after a GPU reset and the preview cannot come back until the app is restarted.
   - On entry GPUs (GT 7xx/10xx, Intel HD, …) a measured cap avoids known resets: Final up to 1440p, Ultra up to 1080p (larger sizes use high), and 4K uses the preview tier.
6. **PNG sequence.** On desktop, a folder dialog appears once. The new preload/main IPC (`render:choose-folder`, `render:write-file`, `desktop/render-export.js`) only writes bare `*.png|*.wav|*.txt` names into the folder behind an opaque token. In the browser, the frames go into a STORE ZIP (`zipStore`), which is capped at 1.5 GB.

`FountainScene_v6.js` gained no lines (sceneGuard). It has three in-place edits: a `pixelRatio` option in `bakeVideo`, `setPR(pixelRatio)` and the ultra heightfield resolution.

## Method

- `dist-1.2.35/win-unpacked` was copied to a temp folder.
- `app.asar` was repacked with this change's `main.js`, `preload.js` and `render-export.js`. `app.asar.unpacked/web` was replaced with a fresh Vite build (`--base=./`).
- The app was launched with `--remote-debugging-port`, an isolated `--user-data-dir` and `Lebu_Fountain_Wave_SoftLights_30s.aquapkg`. The package was a temp copy; the Desktop file was not touched.
- The app was driven over CDP: 3D preview → Play preview → Video export, with real UI clicks.
- Blob downloads were intercepted in the page so no files landed in the user's Downloads folder.
- For the PNG run, the folder dialog was stubbed in the main process (via `--inspect`) to return a temp folder.
- Day environment and the default fitted orbit view. The user's installed AquaFlow was not touched.

## Results (Lebu wave, 30 fps)

s/frame is the frame loop only, read from the progress tooltip. "Total" includes the tier switch, warm-up, encoding and the restore.

| Output | Quality | Frames | s/frame | Total | Result |
| --- | --- | --- | --- | --- | --- |
| 1080p, 4 s | Preview (eco) | 120 | 0.05 | 6 s | ✓ MP4, 2.7 MB |
| **1080p, 4 s** | **Final (high)** | 120 | **0.51** | 1:12 | ✓ MP4 1920×1080, 4.0 s, 2.5 MB |
| **1080p, 5 s** | **Final (high)** | 150 | **0.51** | 1:24 | ✓ MP4 1920×1080, 5.0 s, 3.3 MB (final build) |
| 1080p, 2 s | Final (high), PNG seq | 60 | ~0.62 | 0:42 | ✓ 60 PNGs `…_00000.png…_00059.png` + README, 88 MB |
| 1080p, 3 s | Final (ultra), 2x SS (3840×2160) | 90 | 1.73–1.75 | 2:41 | ✓ (two runs) |
| 1440p, 1 s | Final (high) | 30 | 0.72–0.74 | 0:30 | ✓ |
| 1440p, 1 s | Final (ultra) | 30 | — | — | Before the cap: the GPU reset, it fell back to high and completed ✓. After the cap: rendered at high directly, no reset ✓ |
| 4K, 1 s | Preview (eco) | 30 | 0.03–0.18 | 0:06 | ✓ |
| 4K, 1 s | Final (high) | 30 | 1.25 | — | First build: the GPU process exited (D3D11 E_OUTOFMEMORY) and the UI hung on "Writing file…". With the watchdog + 3D-API unblock: high → medium (also reset) → low, completed ✓. With the entry cap: rendered at the preview tier straight away with a notice, no reset ✓ |

Rule of thumb on this PC: **Final (high) ≈ 0.5 s per 1080p frame**, so a 30 s show at 30 fps (900 frames) takes about 8 minutes. **Ultra at 1080p ≈ 1.75 s/frame**, so the same show takes about 26 minutes.

Other checks:

- **Responsiveness.** During a Final 1080p render, a 100 ms page timer measured: median 100 ms, p95 111 ms, max 2.2 s. The single long stall is the tier rebuild (shader compile).
- **Cancel.** Cancel during an Ultra render returned to the preview in under 3 s. The next Preview render reported tier Eco, so the restore was exact.
- **Restore.** After every Final render, "Restoring preview…" showed Eco, and later Preview renders confirmed the eco scene.
- **Look.** Final shows planar reflections of the sculpture, ripples, shadows and AO. Eco draws fewer, larger droplets, so its jets read *thicker* than high's. Ultra's droplets are scaled ×0.84 (`FINAL_SIZE_EXPONENT = 0.25`). The first try used exact coverage-preserving scaling (×0.71), which made ultra's jets visibly thinner than high's.

## Limitations

- **Tier rebuild.** A Final render rebuilds the 3D scene twice (into and out of the final tier), about 2–10 s each on this card. The live view is unusable while rendering, as before.
- **Entry-GPU caps.** The 1440p / 1080p-ultra / 4K caps were measured on one GT 730 only. Other entry GPUs may allow more or less. The fallback chain still covers them, at the cost of a GPU reset (screen flicker, ~10 s).
- **Downscaling.** Supersampled frames are downscaled with the browser's high-quality `drawImage` (single pass), not a custom filter.
- **Browser ZIP.** The browser PNG fallback holds every frame in memory (capped at 1.5 GB). Use the desktop app for long sequences.
- **WAV.** The WAV is only written when the site preview has a music file. The Lebu package had none in this test, so the audio WAV path is unit-tested only.
- **Video location.** Videos still save to Downloads, as before. The PNG sequence goes to a folder the user chooses.
- **System RAM.** During the Ultra and 4K runs, other Node processes on the PC (not AquaFlow) briefly hit out-of-memory; the AquaFlow render itself completed.
