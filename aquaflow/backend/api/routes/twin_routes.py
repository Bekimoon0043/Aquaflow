"""
twin_routes.py — AquaFlow Stage 5, AQ-S5-001

Digital Twin API: mirror real assets, ingest telemetry, replay history, and get
predictive-maintenance forecasts.

  POST /api/twin/assets                → register an asset
  POST /api/twin/ingest                → ingest telemetry for an asset
  GET  /api/twin/mirror                → live mirrored state of all assets
  GET  /api/twin/assets/{id}           → one asset's mirror
  GET  /api/twin/assets/{id}/replay    → state as-of ?at= (or ?start=&end= for a range)
  GET  /api/twin/assets/{id}/forecast  → maintenance forecast + anomaly alerts
  POST /api/twin/assets/{id}/service   → record a service (resets the countdown)
  GET  /api/twin/summary               → fleet summary
"""
from fastapi import APIRouter, HTTPException

from services.digital_twin import get_digital_twin

router = APIRouter()


@router.post("/assets")
async def register(payload: dict):
    if not payload.get("id") or not payload.get("type"):
        raise HTTPException(400, "id and type required")
    return get_digital_twin().register_asset(
        str(payload["id"]), str(payload["type"]), name=payload.get("name", ""),
        service_interval_hours=float(payload.get("service_interval_hours", 2000)),
        max_temp_c=float(payload.get("max_temp_c", 85)),
        max_pressure_bar=float(payload.get("max_pressure_bar", 10)))


@router.post("/ingest")
async def ingest(payload: dict):
    aid = payload.get("asset_id") or payload.get("id")
    if not aid:
        raise HTTPException(400, "asset_id required")
    try:
        return get_digital_twin().ingest(str(aid), payload.get("telemetry") or payload,
                                         timestamp=payload.get("timestamp"))
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/mirror")
async def mirror():
    return {"assets": get_digital_twin().mirror()}


@router.get("/assets/{asset_id}")
async def asset(asset_id: str):
    a = get_digital_twin().get_asset(asset_id)
    if not a:
        raise HTTPException(404, f"asset '{asset_id}' not found")
    return a


@router.get("/assets/{asset_id}/replay")
async def replay(asset_id: str, at: str = None, start: str = None, end: str = None):
    tw = get_digital_twin()
    try:
        if start and end:
            return tw.replay_range(asset_id, start, end)
        if at:
            r = tw.replay_at(asset_id, at)
            if r is None:
                raise HTTPException(404, "no data at or before that time")
            return r
        raise HTTPException(400, "provide ?at= or ?start=&end=")
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/assets/{asset_id}/forecast")
async def forecast(asset_id: str):
    tw = get_digital_twin()
    try:
        return {"forecast": tw.maintenance_forecast(asset_id),
                "alerts": tw.predict_anomalies(asset_id)}
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/assets/{asset_id}/service")
async def service(asset_id: str):
    try:
        return get_digital_twin().mark_serviced(asset_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/summary")
async def summary():
    return get_digital_twin().summary()
