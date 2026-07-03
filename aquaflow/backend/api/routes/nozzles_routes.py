"""
nozzles_routes.py — AquaFlow Stage 2, Priority 5 (AQ-S2-005)

API surface for the nozzle performance database: browse manufacturer catalogs,
look up nozzle models + K factors, query pressure↔flow (with interpolation across
tabulated catalog curves), and load additional manufacturer catalogs.
"""
from fastapi import APIRouter, HTTPException
from typing import Optional

from services.nozzle_database import get_nozzle_database

router = APIRouter()


@router.get("/manufacturers")
async def list_manufacturers():
    return {"manufacturers": get_nozzle_database().manufacturers()}


@router.get("/models")
async def list_models(manufacturer: Optional[str] = None):
    db = get_nozzle_database()
    return {"models": [m.to_dict() for m in db.list_models(manufacturer)]}


@router.get("/models/{model_id}")
async def get_model(model_id: str):
    m = get_nozzle_database().get(model_id)
    if m is None:
        raise HTTPException(404, f"Nozzle model '{model_id}' not found")
    return m.to_dict()


@router.post("/query")
async def query_nozzle(payload: dict):
    """
    Query a nozzle for flow at a pressure and/or the pressure required for a flow.

    Body: {"model_id": "...", "pressure": 2.0, "flow": 90.0}
    (pressure and flow are both optional; supply at least one.)
    """
    model_id = payload.get("model_id") or payload.get("id")
    if not model_id:
        raise HTTPException(400, "model_id is required")
    try:
        return get_nozzle_database().query(
            model_id,
            pressure=payload.get("pressure"),
            flow=payload.get("flow"),
        )
    except KeyError as e:
        raise HTTPException(404, detail=str(e))
    except ValueError as e:
        raise HTTPException(400, detail=str(e))


@router.post("/catalog")
async def load_catalog(payload: dict):
    """Load a manufacturer catalog (or {"catalogs": [...]}) into the database."""
    db = get_nozzle_database()
    try:
        # load_catalogs accepts either a single catalog dict, a {"catalogs": [...]}
        # wrapper, or a bare list of catalogs.
        count = db.load_catalogs(payload)
        return {"loaded": count, "manufacturers": db.manufacturers()}
    except Exception as e:
        raise HTTPException(400, detail=str(e))
