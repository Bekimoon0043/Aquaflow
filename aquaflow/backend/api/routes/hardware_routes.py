"""
hardware_routes.py — AquaFlow Recovery, AQ-X-002 (CRITICAL)

Hardware Output Verification API. Runs the loopback ("simulated hardware")
verification suite. Per AF-HUB-000C this is labeled SIMULATED and never claims
real-hardware verification until the system-wide commissioning flag is set.

  GET /api/hardware/verify         → run the full (SIMULATED) verification.
  GET /api/hardware/commissioning  → the hardware-commissioning status + banner.
  GET /api/hardware/spec           → the DMX512 / Art-Net timing spec constants.
  GET /api/hardware/protocols      → the honest four-tier protocol support matrix.
"""
from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from services.hardware_verifier import (
    run_full_verification, ARTNET_MAX_HZ, DMX512_MIN_FRAME_MS, DMX512_CHANNELS,
)
from services.commissioning import commissioning_status

router = APIRouter()


@router.get("/verify")
async def verify():
    """
    Run the AQ-X-002 hardware-output verification against a UDP loopback node.

    Runs in a worker thread because the checks stand up real sockets and drive the
    async Art-Net/sACN loops. AF-HUB-000C: the result is SIMULATED output-path
    evidence — `loopback_checks_passed` reports the raw result, and
    `deployment_ready` / `real_hardware_verified` stay False until the
    hardware-commissioning flag is set by a real bench run (AF-HUB-011).
    """
    return await run_in_threadpool(run_full_verification)


@router.get("/commissioning")
async def commissioning():
    """
    Report whether real-hardware commissioning has been completed (AF-HUB-000C).

    Default is FALSE — while FALSE the UI shows a persistent banner and no path
    claims real-hardware verification. Flipped TRUE out-of-band (env flag) only
    after a real bench commissioning run.
    """
    return commissioning_status()


@router.get("/protocols")
async def protocols():
    """AF-HUB-014 — the honest protocol support matrix (REAL / SIMULATED / GATED /
    UNSUPPORTED). No protocol is reported as ready unless it genuinely is."""
    from app_state import protocol_bus
    return protocol_bus.protocol_support_matrix()


@router.get("/spec")
async def spec():
    """Return the DMX512 / Art-Net output-timing spec the verifier checks against."""
    return {
        "artnet_max_hz": ARTNET_MAX_HZ,
        "dmx512_min_frame_ms": round(DMX512_MIN_FRAME_MS, 3),
        "dmx512_channels": DMX512_CHANNELS,
        "note": "Output must not exceed 44 Hz/universe; one full DMX512 frame is "
                "~22.7 ms (512 slots x 44 us + break/MAB).",
    }
