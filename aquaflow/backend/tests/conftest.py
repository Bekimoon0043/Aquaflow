"""
Shared pytest fixtures/config for the AquaFlow backend suite (AQ-S1-009).

The backend runs with cwd=backend and imports its modules as top-level packages
(schema_adapter, services.*, engine.*, safety.*). Ensure that same import root is
on sys.path regardless of where pytest is invoked from.

AF-HUB-000 — License secret for the test suite.
  license/license_engine.py raises at import time when AQUAFLOW_LICENSE_SECRET is
  unset. Several suites import the full app (e.g. test_journeys_e2e imports main.py,
  which mounts the license routes), so a clean checkout with no secret in the
  environment fails at *collection*, not with a normal assertion. We provide a
  deterministic TEST-ONLY secret here via setdefault so the suite is green from a
  clean checkout with zero manual setup. This does NOT weaken production: a real
  AQUAFLOW_LICENSE_SECRET in the environment (deployment/CI) always takes precedence,
  and the engine still hard-fails in production when the secret is genuinely absent.
"""
import os
import sys
from pathlib import Path

# Must run before any test module imports the app / license engine (conftest is
# imported before collection, so top-level here is early enough).
os.environ.setdefault(
    "AQUAFLOW_LICENSE_SECRET",
    "aquaflow-test-only-license-secret-not-for-production",
)

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
