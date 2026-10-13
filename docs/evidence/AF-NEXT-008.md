# AF-NEXT-008 evidence: safety and splash envelope

Date: 2026-10-13. **Advisory — not field calibrated.** Simulation only. No hardware was touched.

## What changed

| File | Change |
| --- | --- |
| `frontend/src/engineering/splashEnvelope.js` (new) | Pure envelope model (see Model). |
| `frontend/src/engineering/showDiagnostics.js` | `getSplashDiagnostics(project, show, opts)` reports `SPLASH_OUTSIDE_BASIN` (warning, or error at a spill of 1 m or more) with an `open_clip` fix. When the hydraulic timeline is unavailable it also reports `SPLASH_NOMINAL_HEIGHTS` (info). |
| `frontend/src/components/preview/splashOverlay3D.js` (new) | Ground rings at the landing regions: cyan when contained, red with a fill when outside. A red marker ring sits at the source of each offending jet. |
| `HydraulicPreviewPanel.jsx` | Adds a "Splash envelope" toggle, gust factor and nozzle uncertainty inputs, and an assumptions list (gust factor, uncertainty, wind source, coupling, landing radius, height basis, calibration). Shows the "Advisory — not field calibrated" label and lists the offending jets at the playhead. Wind comes from the preview's wind setting. |
| `preflight/preflight.js`, `PreflightPanel.jsx` | Pass each fixture's `x, y, rotation, provenance` and the basins/geometry, so splash runs in the Preflight panel. |

## Model

All calculations are in the plan frame.

1. **Height:** the AF-NEXT-007 delivered height when the timeline is available, otherwise level × design height (`jetHeightM`, or 0.8 × pressure head when that is absent).
2. **Uncertainty:** the nozzle uncertainty raises the height to h × (1 + u), with u = ±10 % by default.
3. **Throw:** the ballistic throw uses the renderer's own tilt and yaw (`fixturesToNozzleConfigs`).
4. **Wind drift:** `windDrift(h, wind × gust 1.4, coupling 0.5)` from `weather/windDrift.js`.
5. **Landing radius:** 0.5 m + 0.06 × h + u × throw.
6. **Containment:** 17 points (centre plus 16 on the rim) are tested with basinMask's polygon `contains`. This uses the true outlines, with islands as holes.
7. **Distance outside:** measured from the farthest outside point to the nearest basin or island edge.
8. **Recommended correction:** a bisection finds the largest height that stays contained. The result is given in metres and as a speed percentage (√ratio, because h ∝ v²). If no height stays contained, the recommendation is to move or re-aim the nozzle.

The report has one row per nozzle span:

`{timeMs, endMs, worstTimeMs, nozzleId, clipId, landingPoint, landingRadiusM, distanceOutsideM, heightM, heightBasis, recommendedHeightM, recommendedSpeedPct, recommendation}`

## Tests

The tests are in `src/engineering/__tests__/showDiagnostics.test.js` (12 tests) and `src/components/preview/__tests__/engineeringPreview.test.jsx`.

| Acceptance | Evidence |
| --- | --- |
| A jet predicted to leave the basin is highlighted at its source and landing region | Test setup: an L-shaped basin (10 × 10 with a 6 × 6 notch) and 3 m/s of wind toward +y. Jet A (8 m, in the horizontal arm) drifts into the notch, landing at x > 4 and y > 4. A bounding-rectangle test would have counted that point as water. The spill is attributed to A and `clipA` only; jet B stays inside. In 3D the overlay draws the red landing ring and the source marker. |
| Preflight reports the timestamp and recommended correction | The report row has `timeMs` 0 and `endMs` 2000, plus "Reduce jet height to X m (…), about Y% exit speed". The test re-runs the landing at the recommended height and confirms it is contained. The Diagnostic has an `open_clip` fix to `clipA` and includes the advisory label. |
| Assumptions visible | `assumptions` lists the gust factor (1.4), nozzle uncertainty, wind source and calibration, and the panel test checks the rendered labels. A higher gust factor gives a larger spill distance; calm air gives no spill. |
| Islands | A hole in the L-shaped basin catches jet B's drift, and the spill is reported. |
| Engineering heights | When the timeline gives starved jet A only 0.4 m, it does not spill. With nominal heights it spills, and `SPLASH_NOMINAL_HEIGHTS` is reported. |

The suite commands and results are the same as in `AF-NEXT-007.md`: 1035 frontend tests passed, the production build succeeded, and 1246 backend tests passed.

## Limitations

- The results are advisory until a field calibration verifies them. The coupling, the landing-radius spread and the uncertainty are assumptions. The splash-impact calibration in `splashMap.js` is not yet linked to this model.
- Wind is one uniform vector; terrain and buildings are not modelled. The preview uses the render wind setting. Preflight assumes calm air unless `opts.wind` is passed.
- Splash runs only in the frontend. The backend hardware gate (`services/preflight.py`) receives hydraulic diagnostics but no splash diagnostics.
- For motion nozzles the model uses the static aim; the show's pan and tilt are not yet applied to the throw direction.
