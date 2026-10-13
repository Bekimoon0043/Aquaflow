# AF-NEXT-013 GPU benchmark — NVIDIA GeForce GT 730

Measured 2026-10-13T09:16:24.056Z with `node aquaflow/tools/gpu-bench/run.mjs --bench`.

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
| Window | warm-up 4000 ms, sample 8000 ms, camera: benchCameraAt() orbit r=30 m h=13 m |

Synthetic site (40 x 22 m basin, ~64 % nozzles / 36 % RGB lights, all water and all lights on, runtime colour #0066ff, night, ACES).

| Tier | Scene: fixtures (noz/lights) | Buffer | Mean ms (fps) | Median ms | p95 ms | p99 ms | Max ms | Frames | Draw calls | Triangles | Particles | GPU mem est. MB | VRAM used Δ MB (nvidia-smi) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| eco | Lebu pilot 39 (23/16) | 1440x900 | **42.37 (23.6)** | 38.5 | 80.9 | 191.4 | 197.7 | 192 | 318 | 128,572 | 24,665 GPU | 62.4 | 225 |
| eco − post=false | Lebu pilot 39 (23/16) | 1440x900 | **39.31 (25.44)** | 38.2 | 85.6 | 90.6 | 120 | 204 | 302 | 128,540 | 24,665 GPU | 23.2 | 221 |
| eco − bloom=false | Lebu pilot 39 (23/16) | 1440x900 | **39.08 (25.59)** | 35.2 | 85.8 | 160 | 176 | 205 | 305 | 128,565 | 24,665 GPU | 62.5 | 214 |
| eco − grade=false | Lebu pilot 39 (23/16) | 1440x900 | **41.29 (24.22)** | 38.1 | 78.7 | 175.9 | 192.5 | 194 | 318 | 128,590 | 24,665 GPU | 62.4 | 229 |
| eco − softDepth=false | Lebu pilot 39 (23/16) | 1440x900 | **40.93 (24.43)** | 40.4 | 77.3 | 165 | 183 | 196 | 217 | 102,828 | 24,665 GPU | 62.4 | 226 |
| eco − particles=false | Lebu pilot 39 (23/16) | 1440x900 | **24.36 (41.06)** | 22 | 50.4 | 101.4 | 118.2 | 332 | 315 | 76,560 | 24,665 GPU | 62.4 | 230 |
| eco @ scale 0.8 | Lebu pilot 39 (23/16) | 1152x720 | **32.99 (30.31)** | 29.1 | 68 | 152.3 | 155.2 | 243 | 318 | 128,668 | 24,665 GPU | 47.5 | 229 |

Frame time = interval between consecutive requestAnimationFrame callbacks (CPU + GPU, vsync off).
**Mean** (= sampled time / frames) is the throughput figure to quote: with vsync off Chrome lets the CPU run ahead and then blocks on the GPU queue, so on a GPU-bound machine single intervals alternate between ~5 ms and several hundred ms and the median can badly flatter the real frame rate.
GPU mem est. = bytes the page allocated through WebGL (textures, buffers, renderbuffers; drawing buffer excluded) — a lower bound.
VRAM used Δ = nvidia-smi memory.used peak during the run minus the idle reading before the bench started (whole GPU, includes the desktop).
