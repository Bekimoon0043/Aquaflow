"""
hardware_routes.py — AquaFlow Recovery, AQ-X-002 (CRITICAL)

Hardware Output Verification API. Runs the loopback ("simulated hardware")
verification suite and reports whether the output path is deployment-ready.

  GET /api/hardware/verify   → run the full verification and return the report.
  GET /api/hardware/spec     → the DMX512 / Art-Net timing spec constants.
"""
from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from services.hardware_verifier import (
    run_full_verification, ARTNET_MAX_HZ, DMX512_MIN_FRAME_MS, DMX512_CHANNELS,
)

router = APIRouter()


@router.get("/verify")
async def verify():
    """
    Run the AQ-X-002 hardware-output verification against a UDP loopback node.

    Runs in a worker thread because the checks stand up real sockets and drive the
    async Art-Net/sACN loops. `deployment_ready` is True only when nothing failed.
    """
    return await run_in_threadpool(run_full_verification)


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
