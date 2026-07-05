"""
generative_routes.py — AquaFlow Stage 5, AQ-S5-006

Generative Fountain Designer API: generate concepts from a brief, then download the
engineering or construction package for a chosen concept.

  POST /api/generative/concepts                 → generate concepts {brief, count}
  POST /api/generative/engineering-package      → engineering ZIP for a concept {concept}
  POST /api/generative/construction-package     → construction ZIP for a concept {concept}
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from services import generative_designer as gd

router = APIRouter()


@router.post("/concepts")
async def concepts(payload: dict):
    brief = payload.get("brief") or payload or {}
    count = int(payload.get("count", 3))
    return {"concepts": gd.generate_concepts(brief, count=count)}


@router.post("/engineering-package")
async def engineering_package(payload: dict):
    concept = payload.get("concept") or payload
    if not concept.get("fixtures"):
        raise HTTPException(400, "concept with fixtures required")
    zip_bytes, manifest = gd.build_engineering_package(concept)
    return Response(
        content=zip_bytes, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{gd.package_filename(concept, "engineering")}"',
                 "X-Package-Complete": str(manifest["complete"]).lower(),
                 "X-Document-Count": str(manifest["document_count"])})


@router.post("/construction-package")
async def construction_package(payload: dict):
    concept = payload.get("concept") or payload
    if not concept.get("fixtures"):
        raise HTTPException(400, "concept with fixtures required")
    zip_bytes, manifest = gd.build_construction_package(concept)
    return Response(
        content=zip_bytes, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{gd.package_filename(concept, "construction")}"',
                 "X-Package-Complete": str(manifest["complete"]).lower(),
                 "X-Document-Count": str(manifest["document_count"])})
