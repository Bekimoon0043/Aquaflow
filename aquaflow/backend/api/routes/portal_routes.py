"""
portal_routes.py — AquaFlow Stage 4, AQ-S4-004

Online license portal API: create accounts, online activation, license transfer, and
seat management.

  POST /api/portal/accounts          → create a multi-seat license account
  GET  /api/portal/accounts/{key}    → account summary
  POST /api/portal/activate          → online-activate a machine on a license
  POST /api/portal/deactivate        → free a machine's seat
  POST /api/portal/transfer          → transfer an activation between machines
  GET  /api/portal/seats/{key}       → seat usage + active machines
  POST /api/portal/seats             → set/add seats {key, total_seats? , add?}
"""
from fastapi import APIRouter, HTTPException

from services.license_portal import get_license_portal, SeatError

router = APIRouter()


def _portal():
    return get_license_portal()


@router.post("/accounts")
async def create_account(payload: dict):
    key = payload.get("key")
    edition = payload.get("edition")
    if not key or not edition:
        raise HTTPException(400, "key and edition are required")
    try:
        return _portal().create_account(
            str(key), str(edition), total_seats=int(payload.get("total_seats", 1)),
            user_name=payload.get("user_name", ""), company_name=payload.get("company_name", ""))
    except SeatError as e:
        raise HTTPException(409, str(e))


@router.get("/accounts/{key}")
async def account(key: str):
    acc = _portal().get_account(key)
    if not acc:
        raise HTTPException(404, f"license '{key}' not found")
    return acc


@router.post("/activate")
async def activate(payload: dict):
    key, fp = payload.get("key"), payload.get("fingerprint")
    if not key or not fp:
        raise HTTPException(400, "key and fingerprint are required")
    try:
        return _portal().activate(str(key), str(fp), machine_name=payload.get("machine_name", ""))
    except SeatError as e:
        raise HTTPException(409, str(e))


@router.post("/deactivate")
async def deactivate(payload: dict):
    try:
        return _portal().deactivate(str(payload.get("key")), str(payload.get("fingerprint")))
    except SeatError as e:
        raise HTTPException(409, str(e))


@router.post("/transfer")
async def transfer(payload: dict):
    try:
        return _portal().transfer(str(payload.get("key")), str(payload.get("from_fingerprint")),
                                  str(payload.get("to_fingerprint")),
                                  machine_name=payload.get("machine_name", ""))
    except SeatError as e:
        raise HTTPException(409, str(e))


@router.get("/seats/{key}")
async def seats(key: str):
    try:
        return _portal().seats(key)
    except SeatError as e:
        raise HTTPException(404, str(e))


@router.post("/seats")
async def manage_seats(payload: dict):
    key = payload.get("key")
    if not key:
        raise HTTPException(400, "key required")
    try:
        if payload.get("add") is not None:
            return _portal().add_seats(str(key), int(payload["add"]))
        if payload.get("total_seats") is not None:
            return _portal().set_seats(str(key), int(payload["total_seats"]))
        raise HTTPException(400, "provide total_seats or add")
    except SeatError as e:
        raise HTTPException(409, str(e))
