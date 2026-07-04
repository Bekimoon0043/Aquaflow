"""
pump_routes.py — AquaFlow Recovery, AQ-X-006

Pump curve engine API.

  GET  /api/pumps/catalog     → built-in pump models (H–Q data)
  POST /api/pumps/operating-point → duty point of a pump (or pump system) on a system
                                    curve. Body: {pump:{...}, system:{...}} (see analyze).
"""
from fastapi import APIRouter, HTTPException

from services.pump_curve import analyze, PUMP_CATALOG, load_catalog_pump

router = APIRouter()


@router.get("/catalog")
async def catalog():
    """Return the built-in pump catalog with each model's fitted curve summary."""
    out = {}
    for model, data in PUMP_CATALOG.items():
        pc = load_catalog_pump(model)
        out[model] = {"points": data, **pc.to_dict()}
    return {"pumps": out}


@router.post("/operating-point")
async def operating_point(payload: dict):
    """
    Compute the duty point. Body:
      {
        "pump":   {"model": "fountain-medium"} | {"flows":[...],"heads":[...]}
                  (+ optional "speed_ratio", "count", "mode": parallel|series),
        "system": {"static_head":.., "k":..} | {"static_head":.., "q_design":.., "h_design":..}
      }
    """
    if not payload.get("pump") or not payload.get("system"):
        raise HTTPException(400, "both 'pump' and 'system' are required")
    try:
        return analyze(payload)
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, f"invalid pump/system request: {exc}")
