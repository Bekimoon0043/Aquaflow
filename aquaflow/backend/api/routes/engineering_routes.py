"""
engineering_routes.py — AquaFlow Recovery, AQ-X-010

Engineering package export API.

  POST /api/engineering/package      → build the package, return its manifest (JSON)
  POST /api/engineering/package.zip  → download the full package ZIP
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from services.engineering_package import build_package, build_manifest, build_documents, package_filename

router = APIRouter()


@router.post("/package")
async def package(payload: dict):
    """Build the engineering package and return its manifest (document list + checksums)."""
    try:
        docs, warnings = build_documents(payload or {})
        return build_manifest(payload or {}, {**docs, "manifest.json": b"{}"}, warnings)
    except Exception as exc:
        raise HTTPException(400, f"package build failed: {exc}")


@router.post("/package.zip")
async def package_zip(payload: dict):
    """Build and download the full engineering package as a ZIP."""
    try:
        zip_bytes, _ = build_package(payload or {})
    except Exception as exc:
        raise HTTPException(400, f"package build failed: {exc}")
    return Response(
        content=zip_bytes, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{package_filename(payload or {})}"'})
