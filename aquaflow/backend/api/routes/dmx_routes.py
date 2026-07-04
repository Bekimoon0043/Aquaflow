"""
dmx_routes.py — AquaFlow Recovery, AQ-X-001

Automatic DMX address assignment API.

  POST /api/dmx/auto-assign   → assign conflict-free addresses to a set of fixtures,
                                honouring any manually-pinned ones.
  GET  /api/dmx/profiles      → the profile → channel-width map used for auto-sizing.
"""
from fastapi import APIRouter, HTTPException

from services.dmx_assigner import (
    assign_from_dicts, channels_for, PROFILE_CHANNELS, DEFAULT_UNIVERSE_SIZE,
)

router = APIRouter()


@router.post("/auto-assign")
async def auto_assign(payload: dict):
    """
    Body: {
      "fixtures": [ {id, type?, profile?, channels?, locked?, universe?, channel?}, ... ],
      "start_universe": 1, "start_channel": 1, "universe_size": 512
    }

    Fixtures carrying an explicit universe+channel (or "locked": true) keep their
    address; every other fixture is packed conflict-free into the free channels.
    """
    fixtures = payload.get("fixtures")
    if not isinstance(fixtures, list) or not fixtures:
        raise HTTPException(400, "fixtures: a non-empty list is required")

    try:
        assignments, warnings = assign_from_dicts(
            fixtures,
            start_universe=int(payload.get("start_universe", 1)),
            start_channel=int(payload.get("start_channel", 1)),
            universe_size=int(payload.get("universe_size", DEFAULT_UNIVERSE_SIZE)),
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, f"invalid assignment request: {exc}")

    return {
        "count": len(assignments),
        "assignments": assignments,
        "warnings": warnings,
        "conflict_free": not any("collision" in w.lower() for w in warnings),
    }


@router.get("/profiles")
async def profiles():
    """Return the known DMX personalities and their channel widths."""
    return {
        "profiles": PROFILE_CHANNELS,
        "universe_size": DEFAULT_UNIVERSE_SIZE,
        "example_widths": {
            "rgbw_4ch": channels_for("rgbw_4ch"),
            "moving_head_16ch": channels_for("moving_head_16ch"),
            "unknown_light_type": channels_for(None, "light_underwater_rgb"),
        },
    }
