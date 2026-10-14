# AF-NEXT-013 GPU benchmark — NVIDIA GeForce GT 730

Measured 2026-10-14T06:09:11.182Z with `node aquaflow/tools/gpu-bench/run.mjs --bench`.

| Machine | |
| --- | --- |
| GPU (Win32_VideoController) | NVIDIA GeForce GT 730 (driver 23.21.13.9135) |
| WebGL renderer | ANGLE (NVIDIA, NVIDIA GeForce GT 730 (0x00000F02) Direct3D11 vs_5_0 ps_5_0, D3D11) (Google Inc. (NVIDIA)), WebGL 2 |
| CPU | Intel(R) Core(TM) i5-10505 CPU @ 3.20GHz (6C/12T) |
| RAM | 15.8 GB |
| OS | Microsoft Windows 11 Home 10.0.26200 |
| Runtime | Electron 33.4.11 / Chrome 130.0.6723.191, vsync off, frame-rate limit off, device scale 1 |
| GPU feature status | webgl2: enabled, gpu_compositing: enabled |
| Window / canvas | canvas 1440x900 CSS px, pixel ratio 1 |
| Window | warm-up 4000 ms, sample 10000 ms, camera: benchCameraAt() orbit r=30 m h=13 m |

Synthetic site (40 x 22 m basin, ~64 % nozzles / 36 % RGB lights, all water and all lights on, runtime colour #0066ff, night, ACES).

| Tier | Scene: fixtures (noz/lights) | Buffer | Mean ms (fps) | Median ms | p95 ms | p99 ms | Max ms | Frames | Draw calls | Triangles | Particles | GPU mem est. MB | VRAM used Δ MB (nvidia-smi) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| eco | 100 (63/37) | 1440x900 | **27.98 (35.74)** | 24.7 | 62 | 117 | 150.4 | 359 | 356 | 190,452 | 20,480 GPU | 62.2 | 248 |
| eco | Lebu_Fountain_Wave_SoftLights_30s.aqua 24 (12/12) | 1440x900 | **31.18 (32.07)** | 30 | 65.7 | 90.4 | 119.5 | 321 | 450 | 101,470 | 20,480 GPU | 62 | 239 |

Frame time = interval between consecutive requestAnimationFrame callbacks (CPU + GPU, vsync off).
**Mean** (= sampled time / frames) is the throughput figure to quote: with vsync off Chrome lets the CPU run ahead and then blocks on the GPU queue, so on a GPU-bound machine single intervals alternate between ~5 ms and several hundred ms and the median can badly flatter the real frame rate.
GPU mem est. = bytes the page allocated through WebGL (textures, buffers, renderbuffers; drawing buffer excluded) — a lower bound.
VRAM used Δ = nvidia-smi memory.used peak during the run minus the idle reading before the bench started (whole GPU, includes the desktop).
