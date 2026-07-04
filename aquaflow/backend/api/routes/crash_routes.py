"""
crash_routes.py — AquaFlow Stage 4, AQ-S4-002

Crash reporting API. The frontend (and any component) posts an uncaught error here;
the reporter fingerprints it, spools + uploads it, and can produce a support report.

  POST /api/crash/report        → submit a crash {exc_type, message, traceback, context}
  GET  /api/crash/reports       → recent crash reports
  GET  /api/crash/summary       → crashes grouped by fingerprint (recurring bugs)
  GET  /api/crash/support/{id}  → readable support report for a crash
  POST /api/crash/flush         → retry uploading the offline outbox
"""
from fastapi import APIRouter, HTTPException

from services.crash_reporter import get_crash_reporter, generate_support_report

router = APIRouter()


@router.post("/report")
async def report(payload: dict):
    """Submit a crash report. `traceback` may be a JS stack or a Python traceback."""
    exc_type = payload.get("exc_type") or payload.get("name") or "Error"
    message = payload.get("message", "")
    tb = payload.get("traceback") or payload.get("stack") or ""
    r = get_crash_reporter().report(str(exc_type), str(message), str(tb),
                                    context=payload.get("context") or {})
    return r


@router.get("/reports")
async def reports(limit: int = 50):
    return {"reports": get_crash_reporter().list_reports(limit=limit)}


@router.get("/summary")
async def summary():
    return get_crash_reporter().summary()


@router.get("/support/{report_id}")
async def support(report_id: str):
    rep = get_crash_reporter().get_report(report_id)
    if not rep:
        raise HTTPException(404, f"crash report '{report_id}' not found")
    return generate_support_report(rep)


@router.post("/flush")
async def flush():
    return get_crash_reporter().flush()
