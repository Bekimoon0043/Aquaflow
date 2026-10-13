"""
equipment_routes.py — AF-NEXT-012 (Fixture data trust)

The verified equipment set (manufacturer-datasheet / user-measured models).

  GET    /api/equipment/schema                → provenance schema + unit sets for the UI form
  GET    /api/equipment/models?kind=nozzle    → verified models (bundled + user)
  POST   /api/equipment/models                → add a model (validated; refused if it does
                                                not meet the trust rules). ?replace=true updates.
  DELETE /api/equipment/models/{kind}/{id}    → remove a user-entered model
  POST   /api/equipment/provenance/validate   → check a provenance block without saving
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from services.equipment_provenance import normalize_provenance, validate_provenance
from services.equipment_registry import KINDS, get_equipment_registry, schema_description

router = APIRouter()


def _reload_dependents(kind: str) -> None:
    if kind == "nozzle":
        from services.nozzle_database import reload_nozzle_database
        reload_nozzle_database()


@router.get("/schema")
async def schema():
    return schema_description()


@router.get("/models")
async def list_models(kind: Optional[str] = None):
    if kind is not None and kind not in KINDS:
        raise HTTPException(400, f"kind must be one of {', '.join(KINDS)}")
    models = get_equipment_registry().list(kind)
    return {"models": models, "count": len(models)}


@router.post("/models")
async def add_model(payload: dict, replace: bool = Query(False)):
    try:
        model = get_equipment_registry().add(payload, replace=replace)
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))
    _reload_dependents(model["kind"])
    return {"model": model}


@router.delete("/models/{kind}/{model_id}")
async def delete_model(kind: str, model_id: str):
    if kind not in KINDS:
        raise HTTPException(400, f"kind must be one of {', '.join(KINDS)}")
    if not get_equipment_registry().delete(kind, model_id):
        raise HTTPException(404, f"user model '{model_id}' not found")
    _reload_dependents(kind)
    return {"deleted": model_id}


@router.post("/provenance/validate")
async def validate(payload: dict):
    kind = str(payload.get("kind") or "equipment")
    prov = payload.get("provenance", payload)
    return {"errors": validate_provenance(prov),
            "normalized": normalize_provenance(prov, kind=kind)}
