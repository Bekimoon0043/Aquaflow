"""
fault_routes.py — AquaFlow Recovery, AQ-X-005

Fault alerting + maintenance log API.

  GET  /api/faults/alerts              → active alerts (escalation applied)
  GET  /api/faults/summary             → active / unacked / escalated / critical counts
  POST /api/faults/raise               → raise a fault {code, severity?, message?}
  POST /api/faults/{code}/acknowledge  → acknowledge an alert {by?}
  POST /api/faults/{code}/clear        → clear an alert
  POST /api/faults/ingest              → fold a live operator status dict into alerts
  GET  /api/faults/maintenance-log     → the persistent log (?type= &code= &limit=)
  POST /api/faults/maintenance-log     → record a maintenance action
"""
import time

from fastapi import APIRouter, HTTPException

from services.fault_alerting import get_fault_engine

router = APIRouter()


@router.get("/alerts")
async def alerts():
    eng = get_fault_engine()
    eng.evaluate_escalations()
    return {"alerts": eng.active(), "summary": eng.summary()}


@router.get("/summary")
async def summary():
    return get_fault_engine().summary()


@router.post("/raise")
async def raise_fault(payload: dict):
    code = payload.get("code")
    if not code:
        raise HTTPException(400, "code required")
    a = get_fault_engine().raise_fault(
        str(code), severity=payload.get("severity", "warning"),
        message=payload.get("message", ""), source=payload.get("source", "manual"))
    return a.to_dict()


@router.post("/{code}/acknowledge")
async def acknowledge(code: str, payload: dict = None):
    by = (payload or {}).get("by", "operator")
    ok = get_fault_engine().acknowledge(code, by=by)
    if not ok:
        raise HTTPException(404, f"no unacknowledged alert '{code}'")
    return {"acknowledged": True, "code": code, "by": by}


@router.post("/{code}/clear")
async def clear(code: str):
    ok = get_fault_engine().clear_fault(code)
    if not ok:
        raise HTTPException(404, f"no active alert '{code}'")
    return {"cleared": True, "code": code}


@router.post("/ingest")
async def ingest(payload: dict):
    """Fold a live operator status dict into the alert store and run escalation."""
    return {"alerts": get_fault_engine().ingest_status(payload or {})}


@router.get("/maintenance-log")
async def maintenance_log(type: str = None, code: str = None, limit: int = 100):
    log = get_fault_engine().log
    return {"entries": log.entries(entry_type=type, code=code, limit=limit),
            "total": log.count()}


@router.post("/maintenance-log")
async def add_maintenance(payload: dict):
    action = payload.get("action")
    if not action:
        raise HTTPException(400, "action required")
    entry = get_fault_engine().log.record_maintenance(
        str(action), component=payload.get("component", ""),
        performed_by=payload.get("performed_by", ""),
        downtime_min=float(payload.get("downtime_min", 0)),
        notes=payload.get("notes", ""))
    return entry
