"""
fleet_routes.py — AquaFlow Stage 5, AQ-S5-004

Fleet Management API: register sites, ingest per-site status, and read the central
dashboard + centralised alerts.

  POST /api/fleet/sites              → register a site
  POST /api/fleet/sites/{id}/status  → report a site's operator status
  GET  /api/fleet/sites/{id}         → one site's mirror
  GET  /api/fleet/dashboard          → central fleet dashboard
  GET  /api/fleet/alerts             → centralised alert feed
  POST /api/fleet/alerts/ack         → acknowledge a site alert {site_id, code}
"""
from fastapi import APIRouter, HTTPException

from services.fleet_manager import get_fleet_manager, FleetManager

router = APIRouter()


@router.post("/sites")
async def register(payload: dict):
    if not payload.get("id"):
        raise HTTPException(400, "id required")
    return get_fleet_manager().register_site(
        str(payload["id"]), name=payload.get("name", ""),
        location=payload.get("location", ""), timezone_name=payload.get("timezone", ""))


@router.post("/sites/{site_id}/status")
async def report(site_id: str, payload: dict):
    try:
        return get_fleet_manager().report_status(site_id, payload.get("status") or payload)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/sites/{site_id}")
async def site(site_id: str):
    s = get_fleet_manager().get_site(site_id)
    if not s:
        raise HTTPException(404, f"site '{site_id}' not found")
    return s


@router.get("/dashboard")
async def dashboard():
    return get_fleet_manager().dashboard()


@router.get("/alerts")
async def alerts():
    return {"alerts": get_fleet_manager().central_alerts()}


@router.post("/alerts/ack")
async def ack(payload: dict):
    try:
        return get_fleet_manager().acknowledge(str(payload.get("site_id")), str(payload.get("code")))
    except ValueError as e:
        raise HTTPException(404, str(e))
