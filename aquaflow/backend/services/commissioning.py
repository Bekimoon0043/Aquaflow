"""
commissioning.py — AF-HUB-000C system-wide hardware-commissioning flag.

Single source of truth for one question: has AquaFlow's output been verified on
REAL physical hardware? Default is FALSE. Nothing anywhere in the platform may
claim real-hardware verification while this flag is FALSE — the loopback /
simulated checks (services/hardware_verifier.py) are genuine *output-path* evidence
but they run against a UDP loopback node, NOT physical fixtures, so they must be
labeled SIMULATED until a real bench commissioning run (AF-HUB-011) proves otherwise.

The flag is backed by the AQUAFLOW_HARDWARE_COMMISSIONED environment variable so it
survives restarts and can be flipped by the commissioning process (or an operator
with authority) without a code change or redeploy. It is intentionally NOT settable
from a normal API request — turning it TRUE is a deliberate, out-of-band act tied to
a real commissioning certificate.

Consumers:
  * hardware_verifier.run_full_verification() — labels its report SIMULATED and
    refuses to report deployment_ready while the flag is FALSE.
  * api/routes/hardware_routes.py GET /api/hardware/commissioning — exposes the
    status to the UI.
  * the frontend CommissioningBanner — shows a persistent banner on every screen
    ("Hardware not commissioned — simulated output only") while the flag is FALSE.
"""
from __future__ import annotations

import os

_TRUTHY = {"1", "true", "yes", "on"}

# The exact strings the review requires, kept in one place so backend + UI agree.
SIMULATED_LABEL = "SIMULATED — not verified on real hardware"
COMMISSION_BANNER = "Hardware not commissioned — simulated output only"


def is_hardware_commissioned() -> bool:
    """True only when a real hardware bench commissioning has been recorded.

    Reads the AQUAFLOW_HARDWARE_COMMISSIONED env var. Anything other than an
    explicit truthy value (1/true/yes/on) is treated as FALSE — the safe default.
    """
    return os.getenv("AQUAFLOW_HARDWARE_COMMISSIONED", "").strip().lower() in _TRUTHY


def verification_mode() -> str:
    """'REAL_HARDWARE' once commissioned, else the explicit SIMULATED label."""
    return "REAL_HARDWARE" if is_hardware_commissioned() else "SIMULATED"


def commissioning_status() -> dict:
    """Structured status for the API / UI. Never claims verification while FALSE."""
    commissioned = is_hardware_commissioned()
    return {
        "hardware_commissioned": commissioned,
        "verification_mode": "REAL_HARDWARE" if commissioned else "SIMULATED",
        # Non-null label/banner only while NOT commissioned, so the UI shows them then.
        "label": None if commissioned else SIMULATED_LABEL,
        "banner": None if commissioned else COMMISSION_BANNER,
        "flag_env": "AQUAFLOW_HARDWARE_COMMISSIONED",
    }
