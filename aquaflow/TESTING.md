# AquaFlow Automated Test Harness (AQ-S1-009)

Two fast unit/contract suites plus an end-to-end playback smoke test.

## Backend — pytest (contracts + e2e smoke)

```bash
cd aquaflow/backend
pip install -r requirements.txt   # includes pytest + httpx
python -m pytest
```

Config: [backend/pytest.ini](backend/pytest.ini). Tests live in `backend/tests/`:

| File | Covers |
|------|--------|
| `test_contracts.py` | Canonical schema adapters + runtime contract (aqua↔canonical round-trip, `RuntimeSession`/`RuntimeCommand` pydantic contracts). |
| `test_fixture_bridge.py` | Fixture → `DeviceRegistry` routing, DMX/Modbus auto-assignment, duplicate-address flagging. |
| `test_safety_output.py` | Output-path safety gate: per-fixture/global intensity clamp, flame duration cutoff, safety-kernel permit + enables. |
| `test_e2e_playback_smoke.py` | **End-to-end playback smoke test** — real `ShowEngine` load → play → tick → stop with a capturing protocol bus; asserts the playhead advances and timeline clips are emitted. Also asserts a hardware-conflict show refuses to start. |
| `test_hydraulic_solver.py` | Hydraulic network solver (AQ-S2-001) — flow + pressure at every node for series, branched, symmetric/asymmetric looped, and closed-loop-recirculating networks; conservation-law residuals. |
| `test_pipe_sizing.py` | Pipe sizing engine (AQ-S2-003) — suggests a standard diameter, detects undersized/oversized pipes via configurable velocity limits, sizes a solved network. |
| `test_nozzle_database.py` | Nozzle performance database (AQ-S2-005) — stores/derives K factors, sqrt(P)-domain pressure-flow interpolation with forward/inverse round-trip, manufacturer catalog loading + query. |
| `test_pid_generator.py` | Automatic P&ID generator (AQ-S2-007) — auto-selects ISA-5.1 symbols by type, well-formed printable SVG + print-ready HTML, revision tracking, generate-from-network. |
| `test_bom_generator.py` | Automatic BOM generator (AQ-S2-009) — auto-aggregated quantities, catalog supplier references + cost roll-up, `.xlsx` export validated by round-trip through openpyxl. |
| `test_energy_model.py` | Energy consumption model (AQ-S2-013) — kWh (daily/annual, duty cycle, hourly profiles), annual operating cost (energy + demand + standing + CO2), peak demand (coincident sum vs non-coincident max), fixture-driven loads. |
| `test_ai_show_generator.py` | AI show generator (AQ-S3-001) — free-text prompt parsing (effects/name/bpm/duration/negation), mood inference + shaping, and a generated timeline that plays on the real ShowEngine. |
| `test_choreography_engine.py` | AI Choreography Engine (AQ-S3-003) — full fixture-aware timelines (coverage), fixture constraints (absent fixtures skipped, intensity clamped, flame bursts within on-time), and prompt revisions (scale/add/remove with history); plays on the real ShowEngine. |
| `test_weather_engine.py` | Weather simulation engine (AQ-S3-005) — wind (vector, jet drift, splash), evaporation (Θ mass-transfer, L/day), and visibility (Koschmieder visual range + show clarity); all vs hand calcs. |

Standalone `validate_*.py` scripts in `backend/` remain as scenario harnesses; pytest is the canonical suite.

## Frontend — vitest (resolver + projections)

```bash
cd aquaflow/frontend
npm install        # includes vitest
npm test
```

Config: [frontend/vitest.config.js](frontend/vitest.config.js). Tests in `src/utils/__tests__/` and `src/data/__tests__/`:

| File | Covers |
|------|--------|
| `fixtureTypeResolver.test.js` | The fixture-type **resolver** — normalization, runtime/group/channel mapping, safe fallback for unknown types. |
| `runtimeSignalSelector.test.js` | The runtime-signal **projection** — `deriveRuntimeSignals` mapping timeline clips at a playhead into normalized signals (active/inactive, muted tracks, overlap max, 0..1 vs 0..100, lighting color). |
| `data/__tests__/fixtureLibrary.test.js` | The expanded fixture library (AQ-S2-011) — 500+ fixtures, every one with hydraulic + electrical metadata, unique keys, computed currents. |
| `rendering/__tests__/renderingEngine.test.js` | The Photorealistic Rendering Engine (AQ-S3-004) — water physics (projectile trajectory, apex, time-of-flight), reflections (mirror matrix + Fresnel), and scene modes incl. night; `buildRenderConfig` aggregation. |
| `walkthrough/__tests__/walkthrough.test.js` | The VR Walkthrough Engine (AQ-S3-006) — navigation (first-person step, bounds, waypoint path, look-at), VR/WebXR capability + session config, and client-presentation tour sequencing (auto-advance, loop). |
| `video/__tests__/videoExport.test.js` | The 4K Video Export Engine (AQ-S3-007) — 4K resolution presets, 60 fps (frame count/period/bitrate), audio A/V sync + stream muxing, MIME selection, `buildExportConfig`. |

## Fixture library (AQ-S2-011)

The generated fixtures live in `frontend/src/data/fixture_library_expanded.json`, produced deterministically by `aquaflow/tools/generate_fixture_library.py` and merged with the curated set in `fixtureLibrary.js`. Regenerate + validate:

```bash
cd aquaflow
python tools/generate_fixture_library.py
python tools/validate_fixture_library.py     # 7/7 — count >=500, hydraulic + electrical metadata
```
