"""
analytics_routes.py — AquaFlow Stage 4, AQ-S4-003

Usage analytics API. The UI posts anonymous feature-usage events; the engine hashes
the session, strips PII, aggregates feature statistics and adoption metrics.

  POST /api/analytics/track        → record an event {name, properties, session_id}
  POST /api/analytics/consent      → set the collection consent flag
  GET  /api/analytics/feature-stats → per-feature usage stats
  GET  /api/analytics/adoption     → adoption metrics (active windows + adoption rate)
  GET  /api/analytics/summary      → compact summary
"""
from fastapi import APIRouter, HTTPException

from services.analytics_engine import get_analytics_engine

router = APIRouter()


@router.post("/track")
async def track(payload: dict):
    name = payload.get("name") or payload.get("event")
    if not name:
        raise HTTPException(400, "event name required")
    return get_analytics_engine().track(
        str(name), properties=payload.get("properties") or payload.get("props") or {},
        session_id=str(payload.get("session_id", "anon")))


@router.post("/consent")
async def consent(payload: dict):
    return get_analytics_engine().set_consent(bool(payload.get("enabled", True)))


@router.get("/feature-stats")
async def feature_stats():
    return {"features": get_analytics_engine().feature_stats()}


@router.get("/adoption")
async def adoption():
    return get_analytics_engine().adoption_metrics()


@router.get("/summary")
async def summary():
    return get_analytics_engine().summary()
