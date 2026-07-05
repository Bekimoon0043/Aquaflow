# Backend Test Coverage Map (AQ-FIX-003)

EVAL-AQ-001 §5 flagged that ~12 backend services have no same-named
`tests/test_<service>.py`, which makes a name-based coverage audit look like a gap.
In fact almost all are covered by a **differently-named** suite (a service is often
tested through the feature that owns it). This map records the real covering
suite(s) for every otherwise-"orphan" service so the audit is unambiguous, and
honestly lists the few services with **no direct automated coverage** as follow-ups.

> For an authoritative, always-current number, run a coverage report:
> `python -m pytest --cov=services --cov-report=term-missing`
> (`pytest-cov` is the recommended addition; this doc is the human-readable index.)

## Services without a same-named test file → their real coverage

| Service | Covered by | Kind |
|---|---|---|
| `deploy_verifier.py` | `tests/test_deploy_bundle.py` | pytest |
| `luxshow_compiler.py` | `tests/test_deploy_bundle.py` | pytest |
| `runtime_exporter.py` | `tests/test_deploy_bundle.py` | pytest |
| `hardware_verifier.py` | `tests/test_hardware_output.py` | pytest |
| `fixture_registry_bridge.py` | `tests/test_fixture_bridge.py` | pytest |
| `device_registry.py` | `tests/test_dmx_assigner.py`, `tests/test_fixture_bridge.py`, `tests/test_e2e_playback_smoke.py` | pytest |
| `geometry_service.py` | `validate_hydraulic.py` (real Hazen-Williams / Darcy-Weisbach cross-check) | validate harness |
| `compiler_bridge.py` | `validate_step3_runtime_bridge.py` | validate harness |
| `runtime_bridge.py` | `validate_step3_runtime_bridge.py` | validate harness |

Additionally, the persistence-backed services are now also exercised through the
real API by the cross-feature journey suite (`tests/test_journeys_e2e.py`,
AQ-FIX-006/007): `fleet_manager`, `asset_cloud`, `digital_twin`,
`generative_designer`, `engineering_package`, plus their route modules.

## Genuine gaps — no direct automated test (follow-up candidates)

These have **no dedicated** `test_*`/`validate_*` and are only reached indirectly
(routes / manual). Recommended as small future test additions:

| Service | Current status | Suggested test |
|---|---|---|
| `timing_engine.py` | no direct test | unit-test the timing math against hand calcs |
| `show_programmer_service.py` | no direct test | unit-test cue/step assembly |
| `diagnostics.py` | reached only via its route | add a `test_diagnostics.py` asserting the report shape |

## Note on naming convention

New engines follow the convention `services/<name>.py` → `tests/test_<name>.py` (+
optional `validate_<name>.py`). The services above predate or deviate from that
convention; renaming their suites is deferred to avoid churn, and this map is the
bridge in the meantime.
