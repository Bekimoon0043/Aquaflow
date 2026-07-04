"""
deploy_routes.py — AquaFlow Recovery, AQ-X-003

Compile-and-deploy verification API.

  GET  /api/deploy/verify         → run the full compile → bundle → runtime-export →
                                    on-site-playback verification and report readiness.
  POST /api/deploy/verify-bundle  → verify an already-compiled .luxshow bundle path.
"""
from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool

from services.deploy_verifier import run_deploy_verification
from services.luxshow_compiler import load_luxshow

router = APIRouter()


@router.get("/verify")
async def verify():
    """
    Run the AQ-X-003 verification: the compiler must produce a valid bundle, the
    runtime exporter must round-trip, and the compiled bundle must play on the
    ShowEngine. `deploy_ready` is True only when all three pass.
    """
    return await run_in_threadpool(run_deploy_verification)


@router.post("/verify-bundle")
async def verify_bundle(payload: dict):
    """Verify a compiled .luxshow bundle on disk (ZIP integrity + checksums)."""
    path = payload.get("bundle_path")
    if not path:
        raise HTTPException(400, "bundle_path required")
    loaded = load_luxshow(path)
    return {
        "valid": loaded["valid"],
        "checksum_ok": loaded["checksum_ok"],
        "errors": loaded["errors"],
        "manifest": loaded.get("manifest"),
    }
