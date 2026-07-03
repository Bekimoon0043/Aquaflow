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

Standalone `validate_*.py` scripts in `backend/` remain as scenario harnesses; pytest is the canonical suite.

## Frontend — vitest (resolver + projections)

```bash
cd aquaflow/frontend
npm install        # includes vitest
npm test
```

Config: [frontend/vitest.config.js](frontend/vitest.config.js). Tests in `src/utils/__tests__/`:

| File | Covers |
|------|--------|
| `fixtureTypeResolver.test.js` | The fixture-type **resolver** — normalization, runtime/group/channel mapping, safe fallback for unknown types. |
| `runtimeSignalSelector.test.js` | The runtime-signal **projection** — `deriveRuntimeSignals` mapping timeline clips at a playhead into normalized signals (active/inactive, muted tracks, overlap max, 0..1 vs 0..100, lighting color). |
