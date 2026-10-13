# AF-NEXT-013 GPU benchmark — NVIDIA GeForce GT 730

Measured 2026-10-13T08:45:09.562Z with `node aquaflow/tools/gpu-bench/run.mjs --bench`.

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
| Window | warm-up 5000 ms, sample 8000 ms, camera: benchCameraAt() orbit r=30 m h=13 m |

Synthetic site (40 x 22 m basin, ~64 % nozzles / 36 % RGB lights, all water and all lights on, runtime colour #0066ff, night, ACES).

| Tier | Fixtures (noz/lights) | Buffer | Median ms (fps) | p95 ms | p99 ms | Max ms | Frames | Draw calls | Triangles | Particles | GPU mem est. MB | VRAM used Δ MB (nvidia-smi) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medium | 100 (63/37) | 1920x1080 | 178.8 (5.59) | 493.5 | 1113.6 | 1113.6 | 33 | 419 | 610,771 | 196,942 GPU | 315 | 599 |
| medium − post=false | 100 (63/37) | 1920x1080 | 239.4 (4.18) | 530.6 | 913.2 | 913.2 | 37 | 404 | 610,488 | 196,942 GPU | 77.6 | 325 |
| medium − shadows=false | 100 (63/37) | 1920x1080 | 188.6 (5.3) | 545.7 | 600.6 | 600.6 | 38 | 538 | 1,054,608 | 196,942 GPU | 315.1 | 612 |
| medium − reflection=false | 100 (63/37) | 1920x1080 | 186.2 (5.37) | 370.8 | 746.3 | 746.3 | 42 | 419 | 610,255 | 196,942 GPU | 315.1 | 607 |
| medium − softDepth=false | 100 (63/37) | 1920x1080 | 177.9 (5.62) | 613.2 | 616.4 | 616.4 | 35 | 527 | 1,040,605 | 196,942 GPU | 315.1 | 599 |
| medium − cones=false | 100 (63/37) | 1920x1080 | 186.8 (5.35) | 620.6 | 643.6 | 643.6 | 34 | 553 | 1,101,968 | 196,942 GPU | 315 | 589 |
| medium − particles=false | 100 (63/37) | 1920x1080 | 75 (13.33) | 151.3 | 263.8 | 271.8 | 105 | 579 | 303,080 | 196,942 GPU | 315 | 585 |
| medium − halfResSpray=true | 100 (63/37) | 1920x1080 | 168.5 (5.93) | 862.8 | 1003 | 1003 | 32 | 586 | 1,103,537 | 196,942 GPU | 329.4 | 687 |
| medium − post=false, shadows=false, reflection=false | 100 (63/37) | 1920x1080 | 139.4 (7.17) | 306.2 | 720.3 | 720.3 | 53 | 357 | 561,422 | 196,942 GPU | 77.6 | 382 |
| medium − msaa=0 | 100 (63/37) | 1920x1080 | 7.6 (131.58) | 387.7 | 561.9 | 561.9 | 92 | 585 | 1,094,400 | 196,942 GPU | 141 | 649 |
| medium − bloom=false | 100 (63/37) | 1920x1080 | 150.4 (6.65) | 539.4 | 722.2 | 722.2 | 39 | 572 | 1,103,655 | 196,942 GPU | 315.1 | 591 |
| medium − grade=false | 100 (63/37) | 1920x1080 | 203.3 (4.92) | 639.4 | 873.1 | 873.1 | 35 | 419 | 610,855 | 196,942 GPU | 315.1 | 590 |
| medium − msaa=0, halfResSpray=true | 100 (63/37) | 1920x1080 | 124.3 (8.05) | 746.6 | 783.1 | 783.1 | 39 | 420 | 610,978 | 196,942 GPU | 155.3 | 610 |

Frame time = interval between consecutive requestAnimationFrame callbacks (CPU + GPU, vsync off).
GPU mem est. = bytes the page allocated through WebGL (textures, buffers, renderbuffers; drawing buffer excluded) — a lower bound.
VRAM used Δ = nvidia-smi memory.used peak during the run minus the idle reading before the bench started (whole GPU, includes the desktop).
