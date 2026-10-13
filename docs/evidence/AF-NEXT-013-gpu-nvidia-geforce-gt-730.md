# AF-NEXT-013 GPU benchmark — NVIDIA GeForce GT 730

Measured 2026-10-13T09:20:57.216Z with `node aquaflow/tools/gpu-bench/run.mjs --bench`.

| Machine | |
| --- | --- |
| GPU (Win32_VideoController) | NVIDIA GeForce GT 730 (driver 23.21.13.9135) |
| WebGL renderer | ANGLE (NVIDIA, NVIDIA GeForce GT 730 (0x00000F02) Direct3D11 vs_5_0 ps_5_0, D3D11) (Google Inc. (NVIDIA)), WebGL 2 |
| CPU | Intel(R) Core(TM) i5-10505 CPU @ 3.20GHz (6C/12T) |
| RAM | 15.8 GB |
| OS | Microsoft Windows 11 Home 10.0.26200 |
| Runtime | Electron 33.4.11 / Chrome 130.0.6723.191, vsync off, frame-rate limit off, device scale 1 |
| GPU feature status | webgl2: enabled, gpu_compositing: enabled |
| Window / canvas | canvas 1920x1080 CSS px, pixel ratio 1 |
| Window | warm-up 4000 ms, sample 10000 ms, camera: benchCameraAt() orbit r=30 m h=13 m |

Synthetic site (40 x 22 m basin, ~64 % nozzles / 36 % RGB lights, all water and all lights on, runtime colour #0066ff, night, ACES).

| Tier | Scene: fixtures (noz/lights) | Buffer | Mean ms (fps) | Median ms | p95 ms | p99 ms | Max ms | Frames | Draw calls | Triangles | Particles | GPU mem est. MB | VRAM used Δ MB (nvidia-smi) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| eco | 20 (12/8) | 1920x1080 | **36.01 (27.77)** | 37.5 | 69.6 | 92.3 | 124.5 | 278 | 187 | 84,042 | 20,480 GPU | 86.4 | 303 |
| eco | 100 (63/37) | 1920x1080 | **39.62 (25.24)** | 35.4 | 92.1 | 175.8 | 190.8 | 253 | 356 | 189,980 | 20,480 GPU | 87.1 | 310 |
| eco | 300 (192/108) | 1920x1080 | **46.39 (21.56)** | 44.6 | 99.5 | 131.1 | 132.3 | 217 | 781 | 443,000 | 20,480 GPU | 88.9 | 310 |
| low | 20 (12/8) | 1920x1080 | **28.11 (35.57)** | 27.8 | 34.7 | 44 | 46.3 | 356 | 109 | 44,127 | 8,648 CPU | 22.7 | 213 |
| low | 100 (63/37) | 1920x1080 | **59.63 (16.77)** | 59.9 | 70.5 | 77.7 | 78.9 | 168 | 278 | 184,209 | 48,092 CPU | 23.5 | 220 |
| low | 300 (192/108) | 1920x1080 | **90.13 (11.1)** | 93.9 | 98.5 | 99.9 | 101.5 | 111 | 703 | 395,755 | 77,854 CPU | 25.3 | 222 |
| medium | 20 (12/8) | 1920x1080 | **183.28 (5.46)** | 146.9 | 838.1 | 1076.1 | 1076.1 | 55 | 333 | 892,276 | 196,942 GPU | 314.3 | 613 |
| medium | 100 (63/37) | 1920x1080 | **247.46 (4.04)** | 173.8 | 610.4 | 1158.4 | 1158.4 | 41 | 419 | 610,781 | 196,942 GPU | 315 | 597 |
| medium | 300 (192/108) | 1920x1080 | **264.58 (3.78)** | 200.2 | 693.6 | 693.7 | 693.7 | 38 | 1176 | 1,610,776 | 196,942 GPU | 316.9 | 595 |
| high | 20 (12/8) | 1920x1080 | **513.58 (1.95)** | 339.7 | 1545.4 | 2050.5 | 2050.5 | 23 | 476 | 2,250,487 | 393,550 GPU | 451.9 | 787 |
| high | 100 (63/37) | 1920x1080 | **714.49 (1.4)** | 661.1 | 1507.7 | 1507.7 | 1507.7 | 14 | 803 | 2,569,339 | 393,550 GPU | 452.6 | 786 |
| high | 300 (192/108) | 1920x1080 | **685.2 (1.46)** | 562.2 | 1443.3 | 1443.3 | 1443.3 | 15 | 1562 | 3,325,669 | 393,550 GPU | 454.4 | 787 |
| eco | Lebu pilot 39 (23/16) | 1440x900 | **30.21 (33.1)** | 27.2 | 53.7 | 121.2 | 139.8 | 332 | 318 | 120,342 | 20,480 GPU | 62.1 | 427 |
| low | Lebu pilot 39 (23/16) | 1440x900 | **36.05 (27.74)** | 36.2 | 52.5 | 53 | 53.5 | 278 | 197 | 96,780 | 22,979 CPU | 23.2 | 249 |
| medium | Lebu pilot 39 (23/16) | 1440x900 | **248.33 (4.03)** | 159.9 | 720.2 | 845.1 | 845.1 | 42 | 552 | 959,779 | 196,942 GPU | 224.6 | 447 |
| medium @ scale 0.6 | Lebu pilot 39 (23/16) | 864x540 | **181.4 (5.51)** | 127.2 | 595.9 | 669.6 | 669.6 | 56 | 552 | 959,743 | 196,942 GPU | 128.2 | 397 |
| high | Lebu pilot 39 (23/16) | 1440x900 | **621.95 (1.61)** | 621.6 | 1762.9 | 1762.9 | 1762.9 | 17 | 774 | 2,353,753 | 393,550 GPU | 319.6 | 664 |
| high @ scale 0.6 | Lebu pilot 39 (23/16) | 864x540 | **473.32 (2.11)** | 296.4 | 1052 | 1376.3 | 1376.3 | 22 | 774 | 2,354,005 | 393,550 GPU | 178.1 | 660 |

Frame time = interval between consecutive requestAnimationFrame callbacks (CPU + GPU, vsync off).
**Mean** (= sampled time / frames) is the throughput figure to quote: with vsync off Chrome lets the CPU run ahead and then blocks on the GPU queue, so on a GPU-bound machine single intervals alternate between ~5 ms and several hundred ms and the median can badly flatter the real frame rate.
GPU mem est. = bytes the page allocated through WebGL (textures, buffers, renderbuffers; drawing buffer excluded) — a lower bound.
VRAM used Δ = nvidia-smi memory.used peak during the run minus the idle reading before the bench started (whole GPU, includes the desktop).
