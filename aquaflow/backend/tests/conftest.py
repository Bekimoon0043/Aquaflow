"""
Shared pytest fixtures/config for the AquaFlow backend suite (AQ-S1-009).

The backend runs with cwd=backend and imports its modules as top-level packages
(schema_adapter, services.*, engine.*, safety.*). Ensure that same import root is
on sys.path regardless of where pytest is invoked from.
"""
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
