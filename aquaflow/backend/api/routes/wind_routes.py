"""
wind_routes.py — AquaFlow Recovery, AQ-X-012

Wind drift safety API.

  POST /api/wind/drift  → compute drifted safety zones + operator warnings from
                          {fountain:{keep_clear_m, jets:[...], barriers?:[...]}, weather:{...}}
"""
from fastapi import APIRouter, HTTPException

from services.wind_drift import analyze

router = APIRouter()


@router.post("/drift")
async def drift(payload: dict):
    """Compute wind-drift safety zones + operator warnings for a fountain."""
    if not (payload or {}).get("fountain"):
        raise HTTPException(400, "'fountain' (with jets) is required")
    try:
        return analyze(payload)
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(400, f"invalid wind-drift request: {exc}")
