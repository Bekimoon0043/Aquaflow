# AF-NEXT-013 — Real GPU calibration: evidence note

Date: 2026-10-13. Ticket: `AQUAFLOW-AI-CODER-BUILD-PLAN.md` Wave 4. The coordinator added the entry-GPU scope: auto-detection, the eco tier, a particle budget and adaptive quality.

> **Only one PC was available.** It has an NVIDIA GeForce GT 730, which is an entry-level GPU. Every number below comes from that PC.
>
> - Midrange and high-end GPUs have **not** been measured.
> - Every quality recommendation in this note is **provisional** until they are. That includes the probe thresholds in `gpuTier.js`.
> - The "How to run" section below describes how to collect the missing data.

## 1. Status against the acceptance criteria

| Criterion | Status |
| --- | --- |
| 20/100/300-fixture benchmark on representative entry / midrange / high-end Windows GPUs | **Partial.** The real-GPU runner exists and was run on the entry GPU (GT 730). Midrange and high-end are not measured because no such machine was available. |
| Record resolution, driver, tier, median and worst frame, particles, draw calls, memory | **Done.** See `AF-NEXT-013-gpu-nvidia-geforce-gt-730.{md,json}`. |
| Fix the dense all-lights-on exposure washout | **Done** for the pool surface: energy normalisation by local overlap, plus a hue-preserving cap. Particles and core columns are normalised by overlap. 1–2 fixtures are unchanged. |
| Fixed-scene screenshot comparisons | **Done.** 17 named scenes, deterministic: re-renders are pixel-identical. Baseline comparison uses a pixel-diff tolerance. |
| Medium quality remains usable on the agreed target PC | **Not met on this PC.** Medium measures **4.0 fps** (mean) at 1080p with 100 fixtures, against a target of 30 fps. The GT 730 cannot run medium. It now starts on **eco**, which meets **33.1 fps** on the Lebu pilot at 1440×900. Medium's target PC needs to be agreed and measured. |
| Timeline colour and 3D emitted colour follow one documented colour pipeline | **Done.** See `docs/COLOR-PIPELINE.md`. One renderer bug was fixed: signal `{r,g,b}` values were treated as linear. |
| Coordinator 1: GPU auto-detection on first run | **Done.** `gpuTier.js` reads WEBGL_debug_renderer_info and runs a timed probe for unknown GPUs. The result is cached per GPU string. |
| Coordinator 2: eco tier | **Done.** See section 5. |
| Coordinator 3: shared particle budget | **Done, with a caveat.** See section 5. |
| Coordinator 4: dynamic resolution and adaptive quality, HUD and override | **Done in code and unit-tested.** It has not been exercised in a live app session (see section 7). |
| Coordinator 5: eco/low/medium numbers on the GT 730; Lebu eco ≥ 30 fps at 1440×900 | **Met.** Eco measured **33.1 fps mean** (30.2 ms). Median is 27.2 ms; p99 is 121 ms. |

## 2. Machine

| | |
| --- | --- |
| GPU | NVIDIA GeForce GT 730, 4 GB. Driver 23.21.13.9135 (NVIDIA 391.35) |
| WebGL | ANGLE (NVIDIA GeForce GT 730 Direct3D11 vs_5_0 ps_5_0, D3D11), WebGL 2, hardware accelerated (gpu_compositing enabled) |
| CPU / RAM | Intel Core i5-10505, 6C/12T / 15.8 GB |
| OS / display | Windows 11 Home 10.0.26200 / 1440×900 at 59 Hz |
| Runtime | Electron 33.4.11 (Chrome 130), the same binary as the desktop app. vsync and frame-rate cap off, device scale factor 1 |

## 3. Benchmark results (GT 730)

Full table and raw per-frame intervals: `docs/evidence/AF-NEXT-013-gpu-nvidia-geforce-gt-730.md` / `.json`.

All runs share these settings:

- All water and all lights on.
- Night environment with ACES.
- Fixed orbit camera (`benchCameraAt`).
- 4 s warm-up, then a 10 s sample.

**Mean** frame time is the honest throughput figure. With vsync off, Chrome lets the CPU run ahead, then blocks on the GPU queue. The individual intervals alternate between about 5 ms and several hundred ms, so the median flatters a GPU-bound tier.

| Tier | Scene | Buffer | Mean ms (fps) | Median ms | p99 ms | Draw calls | Triangles | Particles | GPU mem est. | VRAM Δ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| eco | synthetic 20 | 1920×1080 | 36.0 (27.8) | 37.5 | 92 | 187 | 84k | 20,480 GPU | 86 MB | 303 MB |
| eco | synthetic 100 | 1920×1080 | 39.6 (25.2) | 35.4 | 176 | 356 | 190k | 20,480 GPU | 87 MB | 310 MB |
| eco | synthetic 300 | 1920×1080 | 46.4 (21.6) | 44.6 | 131 | 781 | 443k | 20,480 GPU | 89 MB | 310 MB |
| low | synthetic 20 | 1920×1080 | 28.1 (35.6) | 27.8 | 44 | 109 | 44k | 8.6k CPU | 23 MB | 213 MB |
| low | synthetic 100 | 1920×1080 | 59.6 (16.8) | 59.9 | 78 | 278 | 184k | 48k CPU | 24 MB | 220 MB |
| low | synthetic 300 | 1920×1080 | 90.1 (11.1) | 93.9 | 100 | 703 | 396k | 78k CPU | 25 MB | 222 MB |
| medium | synthetic 20 | 1920×1080 | 183 (5.5) | 147 | 1076 | 333 | 892k | 197k GPU | 314 MB | 613 MB |
| medium | synthetic 100 | 1920×1080 | 247 (4.0) | 174 | 1158 | 419 | 611k | 197k GPU | 315 MB | 597 MB |
| medium | synthetic 300 | 1920×1080 | 265 (3.8) | 200 | 694 | 1176 | 1.61M | 197k GPU | 317 MB | 595 MB |
| high | synthetic 20/100/300 | 1920×1080 | 514 / 714 / 685 (1.4–1.9) | | | 476–1562 | 2.3–3.3M | 394k GPU | 452 MB | 787 MB |
| **eco** | **Lebu pilot (39)** | **1440×900** | **30.2 (33.1)** | 27.2 | 121 | 318 | 120k | 20,480 GPU | 62 MB | 427 MB |
| low | Lebu pilot | 1440×900 | 36.1 (27.7) | 36.2 | 53 | 197 | 97k | 23k CPU | 23 MB | 249 MB |
| medium | Lebu pilot | 1440×900 | 248 (4.0) | 160 | 845 | 552 | 960k | 197k GPU | 225 MB | 447 MB |
| medium @ scale 0.6 | Lebu pilot | 864×540 | 181 (5.5) | 127 | 670 | 552 | 960k | 197k GPU | 128 MB | 397 MB |
| high | Lebu pilot | 1440×900 | 622 (1.6) | 622 | 1763 | 774 | 2.35M | 394k GPU | 320 MB | 664 MB |

Notes on the measures:

- **GPU mem est.** is the WebGL allocation tracker (`__bench__/gpuMemoryTracker.js`). It is a lower bound.
- **VRAM Δ** is the nvidia-smi peak minus idle, and covers the whole GPU. nvidia-smi reports no utilisation or clocks for this GPU/driver.

### Where medium's time goes (investigation)

Investigation runs on the GT 730 (`AF-NEXT-013-gpu-…-ablation.md`) measured medium with 100 fixtures, switching off one feature at a time.

- Run-to-run variance on this card is high. Fixed-time comparisons below ~30 % are not reliable.
- The robust signals were:
  - **4× MSAA on the fp16 composer target:** turning it off took the mean from about 250 ms to about 60–90 ms.
  - **Bloom:** turning it off took the mean to about 58 ms.
  - **The 197k GPU particles:** turning them off took the mean to about 76 ms.
  - Shadows, reflection, soft depth and beam cones were each below the noise.
- Eco therefore drops MSAA, runs bloom at a further half resolution and draws about 20k particles.

The eco ablation (`…-eco-ablation.md`) was measured on the first eco draft, which had 24k particles, 2.2× droplet size and all 16 fixtures per particle. It showed that particles were the remaining eco cost: 23.6 fps with them, 41 fps without. That led to the final eco settings: about 20k particles, 1.6× size cap, and the nearest 4 fixtures per particle. Lebu then went from 23.6 to 33.1 fps.

## 4. Dense all-on washout

**Cause.** On the pool surface, the fixture term passes through the AF-3D-022 knee (≤ 1.0). It is then multiplied by the bleed, caustic, lift and specular gains, which reach about 3.3 HDR in a dense layout. At the night exposure (1.55), three's ACES turns a saturated LED colour at that level almost white (`colorPipeline.test.js`).

**Fix.** Implemented in `fixtureLightField.js` and the water shader; details in `docs/COLOR-PIPELINE.md` §3.

1. Shaders now get an overlap count `n = Σe_i / max e_i` with the fixture sum.
2. **`flDensityNormalize`** scales the sum by (2/n)^0.85 when n > 2, in particles, core columns and the pool surface. This is a uniform scale, so chroma is unchanged.
3. **`flDenseSurface`** caps the pool's *total* fixture term at 1.0 HDR (peak channel, soft knee from 0.6). It blends in between n = 2 and 4.

1–2 fixtures are bit-identical by construction (asserted).

**Numeric test** (`components/preview/__tests__/denseLightExposure.test.js`, render-free shader mirror) for 1, 2, 50 and 300 fixtures under ACES, AgX and Neutral:

| `#0066ff`, ACES | n | Peak HDR before → after | Display chroma before → after | Display luminance before → after |
| --- | --- | --- | --- | --- |
| 1 fixture | 1.0 | 3.24 → 3.24 | 0.415 → 0.415 | 0.711 → 0.711 |
| 2 fixtures | 2.0 | 3.28 → 3.28 | 0.412 → 0.412 | unchanged |
| 50 fixtures | 14.0 | 3.29 → 1.12 | 0.412 → 0.624 | 0.714 → 0.473 |
| 300 fixtures | 13.9 | 3.29 → 1.12 | 0.412 → 0.624 | 0.714 → 0.473 |

Other operators, 300 fixtures:

- AgX `#0066ff`: chroma 0.499 → 0.603.
- Neutral `#0066ff`: chroma 0.509 → 0.757.
- `#ff3366` and `#55bfff` improve similarly under all three operators.

Why 50 and 300 give identical numbers: a cluster cell evaluates its 16 nearest fixtures, so the local overlap is the same for both.

The test asserts four things:

- the dense fixture term stays at or below the 1.0 cap;
- display luminance is no higher than a single fixture's hottest point;
- chroma is at least the single-fixture chroma;
- chroma is higher than before the fix.

**Rendered evidence** (`docs/preview-realism/2026-10-13/manifest.json`). Mean saturation and near-white share of lit pixels, before → after:

| Scene | Mean saturation | Near-white share |
| --- | --- | --- |
| 300 all-on, mixed design colours | 0.374 → 0.401 | 18.3 % → **7.5 %** |
| 300 all-on, single runtime blue | 0.602 → 0.616 | 0.07 % → 0 % |
| 20 fixtures (sparse) | 0.29 % pixels differ (mean abs 0.23/255) | |
| Lebu (39) | 0.16 % pixels differ | |

Earlier visual check: the dense design-colour pool went from a white sheet to coloured.

**Residual: Lebu's jets stay white.** That is the single-fixture regime: one 36 W light at about 3.4 HDR under a jet with forward scattering. The "1–2 fixtures unchanged" rule leaves it as it was. Making single-fixture jets chromatic is a look decision (lower FIELD_GAIN or exposure), not a density fix. It needs an art-direction call.

**Additional bug found and fixed: Neutral rendered a black frame.**

- On medium, high and eco with bloom, the **Neutral** tone mapper rendered a completely black frame on this machine. Lit pixels: 0.
- Cause: a non-finite HDR texel went through NeutralToneMapping as NaN, and the bloom blur spread the NaN across the frame. Bloom disabled → image fine.
- Fix: `scenePost.sanitizedOutputPass()` clamps the OutputPass input to [0, 6e4].
- The ACES scenes' colour metrics (saturation, near-white share) are unchanged to 4 decimals after this change.
- Not verified on an unmodified HEAD.

**Colour-pipeline fix.** `sceneLighting.colorFromSignalColor` now decodes signal `{r,g,b}` as sRGB. It used to treat them as linear, which made every mid-tone runtime colour render paler than its hex.

## 5. Entry-GPU path (coordinator scope)

### Detection (`components/preview/gpuTier.js`)

- `classifyGpu` sorts the WebGL renderer string into software, entry, mid, high or unknown.
  - Entry includes GT 6xx/7xx/10xx, older GTX 7xx/6xx, Intel HD/UHD/Iris (not Iris Xe), AMD Radeon(TM) Graphics and Vega 3–8 iGPUs.
  - The GT 730 string classifies as **entry**, so it starts on eco.
- Unknown GPUs get a ~100 ms timed probe: 8 blended full-screen passes at 960×540, synchronised with readPixels.
- The result is cached in `localStorage` under `aquaflow.gpuProfile.v1` and re-detected when the GPU string changes.
- The probe thresholds (eco ≥ 40 ms, low ≥ 15 ms) are **provisional**. Only the GT 730 was available, and it is classified by name, so the probe never ran on real hardware here.

### Settings (`PreviewPanel_v5.jsx`, `projectStore.js`)

- **Quality:** Auto, Eco, Low, Medium, High. New projects default to `auto`. Saved projects keep their tier.
- **Adaptive quality** checkbox, on by default.
- With adaptive on, a known-weak GPU starts on its detected tier even if the project says medium; adaptive then climbs if there is headroom.
- With adaptive off, the user's tier is used exactly. This is the override.
- The panel shows the GPU name, its class and the tier actually rendered.
- The perf HUD shows tier · backend · auto/adaptive/fixed, and the render scale.

### Eco tier (`sceneQuality.js`, `scenePost.js`, `sceneAdaptive.js`, `sceneShaders.js`)

- Pixel ratio 1.
- No shadows, AO, planar reflection, beam cones, stars or IBL.
- Composer **without MSAA** (`msaa: 0`).
- Bloom at half its usual size (`bloomScale: 0.5`).
- Half-res spray.
- About **20,480 GPU particles** (16,384 water + 4,096 spray), drawn up to 1.6× larger and slightly more opaque ("fewer, larger droplets").
- Core-column meshes still carry each vertical jet.
- Each particle and pixel evaluates the nearest 4 fixtures instead of 16 (`uFieldMaxGroups`).
- The eco water shader (`uEcoWater`) uses one fixture group and skips the refraction/floor ray.
- The low, medium and high tiers are unchanged (asserted in `sceneAdaptive.test.js`).

### Particle budget

- **GPU path** (eco, medium, high): this was already one fixed pool, split between emitters by static type weight (`allocatePool`). It can never exceed the tier budget. Particles only respawn while their emitter runs, so fill cost follows the jets that are actually active.
- **Caveat:** the allocation itself is static, not re-split live. That is deliberate, to stop the field reshuffling. The pre-existing 96-emitter texture limit still drops the tail of very large designs.
- **CPU path:** `attachParticleBudget` steers spawn acceptance so the live total converges on `cpuParticleBudget` (24k), shared evenly across running jets.
  - It applies only when eco's CPU systems are the renderers, i.e. when GPU particles are unsupported.
  - The low tier is left unchanged as instructed.

### Adaptive quality (`AdaptiveQualityController`)

- If the median frame time stays above 33.3 ms for 2 s, it steps the scale 1 → 0.8 → 0.6, then drops one tier and the floor is eco.
- If the median stays below 20 ms for 5 s, it steps back up, never above the user's or auto ceiling.
- 20–33 ms is a dead band, so it does not oscillate.
- A tier change rebuilds the scene, as a manual quality change does. A scale change is applied live (`applyRenderScale`).

## 6. Provisional quality recommendations

Measured on the GT 730 only. Midrange and high-end rows are not measured and must be replaced with measurements.

| GPU class | Start tier | Basis |
| --- | --- | --- |
| Entry (GT 730 measured; GT 1030, Intel UHD by class) | **eco** | GT 730: eco 33 fps on Lebu at 1440×900, 22–28 fps synthetic at 1080p. Low is 11–17 fps at 100–300 fixtures. Medium 4 fps. |
| Midrange (GTX 1660 / RTX 3050 class) | medium (unchanged default) | **Not measured** |
| High-end (RTX 3070+ / RX 6800+) | medium (user may select high) | **Not measured** |

## 7. How to run

On each new machine:

```
cd <repo>
node aquaflow/tools/gpu-bench/run.mjs --bench      # all tiers x 20/100/300 + Lebu @1440x900  (~6 min)
node aquaflow/tools/gpu-bench/run.mjs --shots      # 17 fixed scenes vs this machine's baseline (~2 min)
```

**Requirements:**

- `aquaflow/frontend/node_modules` (vite).
- An Electron 33 binary. The runner looks in this order:
  1. `ELECTRON_PATH`
  2. `aquaflow/desktop/node_modules/electron/dist`
  3. `.build-cache/electron-dist-*`
- On this PC, `desktop/node_modules/electron` has no `dist`. The runner used `.build-cache/electron-dist-33.4.11`.

**What it does:**

- Starts its own Vite dev server on port 5317+. It does not use 3000.
- Opens a 1920×1080 Electron window with hardware acceleration on and vsync off.
- Writes `docs/evidence/AF-NEXT-013-gpu-<gpu-slug>.{md,json}`.
- Closes everything it started.
- Collect one run per GPU class (entry, midrange, high-end) and commit the generated `.md`/`.json`.

**Options:**

- `--tiers`, `--sizes`, `--sample-ms`, `--warmup-ms`, `--no-lebu`.
- `--ablate` (medium cost breakdown) and `--ablate-eco`.
- `--angle d3d11`.
- `--ignore-gpu-blocklist`. Off by default, so the blocklist behaves as in the shipped app.

**Screenshot set and baselines:**

- 17 scenes. Each has a fixed camera, t = 4.0 s, seed 1234, medium unless named eco, 960×540, night. They cover:
  - the synthetic 300/20 sites, before and after the fix;
  - ACES, AgX and Neutral;
  - the 4 saved Lebu views;
  - eco.
- Re-rendering is deterministic: all 17 scenes diff 0.00000 against the baseline on a second run.
- Comparison counts pixels whose largest channel differs by more than 24/255. A scene passes when ≤ 2 % differ. Use `--update-baseline` to accept a change and `--only <name>` to render a subset.
- Baselines are per machine.
- Committed: the JPEG review copies (≤ 300 KB, `docs/preview-realism/<date>/`) and `manifest.json`, which holds hashes, sizes, colour metrics and before/after pairs.
- Every PNG baseline is 345–690 KB, over the 300 KB limit. They stay in the gitignored `docs/preview-realism/_local/`, and `baseline/baseline-manifest.json` records their sha256.

## 8. Files

**New:**

- `aquaflow/tools/gpu-bench/run.mjs`
- `aquaflow/tools/gpu-bench/electron-main.cjs`
- `frontend/src/components/preview/__bench__/gpuBench.html`
- `frontend/src/components/preview/__bench__/gpuBenchPage.js`
- `frontend/src/components/preview/__bench__/gpuMemoryTracker.js`
- `frontend/src/components/preview/gpuTier.js`
- `frontend/src/components/preview/sceneAdaptive.js`
- `frontend/src/rendering/colorPipeline.js`
- Tests:
  - `__tests__/denseLightExposure.test.js`
  - `__tests__/gpuTier.test.js`
  - `__tests__/sceneAdaptive.test.js`
  - `rendering/__tests__/colorPipeline.test.js`
- Docs and output:
  - `docs/COLOR-PIPELINE.md`
  - this note
  - `docs/evidence/AF-NEXT-013-gpu-nvidia-geforce-gt-730*.{md,json}`
  - `docs/preview-realism/**`

**Changed:**

- `fixtureLightField.js`: fieldLightN, density normalisation, surface cap, JS mirrors and the new uniforms.
- `sceneShaders.js`: water and core column.
- `particlesBillboard.js`
- `scenePost.js`: msaa, bloomScale and the sanitised OutputPass.
- `sceneQuality.js`: eco and TIER_ORDER.
- `sceneLighting.js`: sRGB signal colours.
- `halfResParticles.js`, `modelLibrary.js`, `venueModels.js`: eco handling.
- `PreviewPanel_v5.jsx`: auto/eco, adaptive, HUD.
- `store/projectStore.js`: quality defaults to auto; `adaptiveQuality` added.
- `__bench__/largeShowBench.js`: sizes, camera path, stats.
- `__tests__/largeShowBench.test.js`

**Not touched:**

- `FountainScene_v6.js`, so the line-count guard is unaffected.
- `sceneBasin.js`, `basinMask.js`, `basinGeometry.js`
- `engineering/*`, `show/*`, `data/fixtureLibrary.js`
- `App.jsx`, `programmer/studio/*`, `icanPreviewStore.js`
- three.js stays at r165.

**Verification:**

- `npx vitest run`: 104 files, **1100 passed**, 0 failed.
- `npx vite build`: OK. The 830 kB three.js chunk-size warning is unchanged.
- **Not done:** the adaptive controller, auto-detection and the eco extras have not been watched in a live AquaFlow app session. Their logic is unit-tested, and the eco path is exercised by the bench page through the same `applyTierExtras`.
