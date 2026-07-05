"""
cloud_routes.py — AquaFlow Stage 5, AQ-S5-005

Global Asset Cloud API: multi-tenant companies, versioned cloud backups, and remote
diagnostics.

  POST /api/cloud/companies                       → register a company (tenant)
  GET  /api/cloud/companies                       → list companies
  GET  /api/cloud/companies/{cid}                 → one company
  POST /api/cloud/companies/{cid}/backups         → create a backup {asset_id, data, ...}
  GET  /api/cloud/companies/{cid}/backups         → list backups (?asset_id= optional)
  GET  /api/cloud/companies/{cid}/backups/{bid}   → restore a backup (verified)
  POST /api/cloud/companies/{cid}/diagnostics     → report a site's status {site_id, status}
  GET  /api/cloud/companies/{cid}/diagnostics     → list reported sites
  GET  /api/cloud/companies/{cid}/diagnostics/{sid} → run a remote diagnostic bundle
"""
from fastapi import APIRouter, HTTPException

from services.asset_cloud import get_asset_cloud, CloudError

router = APIRouter()


@router.post("/companies")
async def register_company(payload: dict):
    if not payload.get("id"):
        raise HTTPException(400, "id required")
    return get_asset_cloud().register_company(
        str(payload["id"]), name=payload.get("name", ""), plan=payload.get("plan", "standard"))


@router.get("/companies")
async def list_companies():
    return {"companies": get_asset_cloud().list_companies()}


@router.get("/companies/{cid}")
async def get_company(cid: str):
    c = get_asset_cloud().get_company(cid)
    if not c:
        raise HTTPException(404, f"company '{cid}' not found")
    return c


@router.post("/companies/{cid}/backups")
async def create_backup(cid: str, payload: dict):
    try:
        return get_asset_cloud().create_backup(
            cid, str(payload.get("asset_id", "")), payload.get("data"),
            label=payload.get("label", ""), asset_type=payload.get("asset_type", "design"))
    except CloudError as e:
        raise HTTPException(404, str(e))


@router.get("/companies/{cid}/backups")
async def list_backups(cid: str, asset_id: str = None):
    try:
        return {"backups": get_asset_cloud().list_backups(cid, asset_id)}
    except CloudError as e:
        raise HTTPException(404, str(e))


@router.get("/companies/{cid}/backups/{bid}")
async def restore_backup(cid: str, bid: str):
    try:
        return get_asset_cloud().restore_backup(cid, bid)
    except CloudError as e:
        raise HTTPException(404, str(e))


@router.post("/companies/{cid}/diagnostics")
async def report_diagnostics(cid: str, payload: dict):
    try:
        return get_asset_cloud().report_diagnostics(
            cid, str(payload.get("site_id", "")), payload.get("status") or {},
            site_name=payload.get("site_name", ""))
    except CloudError as e:
        raise HTTPException(404, str(e))


@router.get("/companies/{cid}/diagnostics")
async def list_diagnostics(cid: str):
    try:
        return {"sites": get_asset_cloud().list_diagnostics(cid)}
    except CloudError as e:
        raise HTTPException(404, str(e))


@router.get("/companies/{cid}/diagnostics/{sid}")
async def run_diagnostic(cid: str, sid: str):
    try:
        return get_asset_cloud().run_remote_diagnostic(cid, sid)
    except CloudError as e:
        raise HTTPException(404, str(e))
