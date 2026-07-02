"""API Routes — Runtime Compiler Bridge

Step 3/4 endpoints that bridge the current prototype payloads to the future
canonical show package, runtime session, and deployment bundle flow.
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app_state import load_saved_show, show_engine
from contracts.runtime_contract import RuntimeAck
from services.compiler_bridge import (
    build_canonical_package,
    build_compile_report,
    build_deploy_request,
    build_deployment_bundle,
    build_runtime_session,
)
from services.runtime_exporter import (
    list_compiled_artifacts,
    load_bundle_artifact,
    load_bundle_manifest,
    persist_compiled_artifacts,
)

router = APIRouter()


class SnapshotCompileRequest(BaseModel):
    payload: dict[str, Any]
    mode: Literal["design", "simulation", "live"] = "simulation"
    runtime_target: Literal["industrial_pc", "embedded_controller", "offline_kiosk", "cloud_runtime"] = "industrial_pc"


class SavedShowCompileRequest(BaseModel):
    show_id: str
    mode: Literal["design", "simulation", "live"] = "simulation"
    runtime_target: Literal["industrial_pc", "embedded_controller", "offline_kiosk", "cloud_runtime"] = "industrial_pc"


class DeployPreviewRequest(BaseModel):
    payload: dict[str, Any]
    runtime_target: Literal["industrial_pc", "embedded_controller", "offline_kiosk", "cloud_runtime"] = "industrial_pc"
    mode: Literal["design", "simulation", "live"] = "live"
    operator_ack_required: bool = True
    safety_profile: str = Field(default="default-field-profile", min_length=1)


@router.get("/status")
async def runtime_bridge_status():
    return {
        "status": "ready",
        "step": 4,
        "capabilities": {
            "canonical_export": True,
            "runtime_session_build": True,
            "deployment_bundle_preview": True,
            "saved_show_compile": True,
            "artifact_persistence": True,
            "artifact_listing": True,
        },
        "current_engine": show_engine.get_state(),
    }


@router.get("/snapshot/current")
async def current_snapshot():
    snapshot = show_engine.get_snapshot()
    return {
        "snapshot": snapshot,
        "canonical_package": build_canonical_package(snapshot),
    }


@router.post("/compile/snapshot")
async def compile_snapshot(req: SnapshotCompileRequest):
    return build_compile_report(req.payload, mode=req.mode, runtime_target=req.runtime_target)


@router.post("/compile/saved-show")
async def compile_saved_show(req: SavedShowCompileRequest):
    payload = load_saved_show(req.show_id)
    if not payload:
        raise HTTPException(404, f"Show '{req.show_id}' not found")
    return build_compile_report(payload, mode=req.mode, runtime_target=req.runtime_target)


@router.get("/export/{show_id}/canonical")
async def export_saved_show_canonical(show_id: str):
    payload = load_saved_show(show_id)
    if not payload:
        raise HTTPException(404, f"Show '{show_id}' not found")
    canonical = build_canonical_package(payload)
    return {
        "show_id": show_id,
        "canonical_package": canonical,
    }


@router.post("/session/snapshot")
async def build_snapshot_session(req: SnapshotCompileRequest):
    session = build_runtime_session(req.payload, mode=req.mode)
    return {
        "runtime_session": session.model_dump(mode="json"),
        "command_count": len(session.commands),
    }


@router.post("/deploy/preview")
async def preview_deploy(req: DeployPreviewRequest):
    bundle = build_deployment_bundle(
        req.payload,
        runtime_target=req.runtime_target,
        safety_profile=req.safety_profile,
        operator_ack_required=req.operator_ack_required,
    )
    deploy_request = build_deploy_request(req.payload, runtime_target=req.runtime_target, mode=req.mode)
    ack = RuntimeAck(
        accepted=True,
        session_id=f"preview-{bundle['bundle_id']}",
        message="Deployment preview generated. Native runtime handoff is not live yet.",
    )
    return {
        "deployment_bundle": bundle,
        "deploy_request": deploy_request.model_dump(mode="json"),
        "ack": ack.model_dump(mode="json"),
    }


@router.get("/artifacts/list")
async def list_runtime_artifacts():
    return {"artifacts": list_compiled_artifacts()}


@router.post("/artifacts/compile/snapshot")
async def compile_and_save_snapshot(req: SnapshotCompileRequest):
    manifest = persist_compiled_artifacts(req.payload, mode=req.mode, runtime_target=req.runtime_target)
    return {"status": "persisted", "manifest": manifest}


@router.post("/artifacts/compile/saved-show")
async def compile_and_save_saved_show(req: SavedShowCompileRequest):
    payload = load_saved_show(req.show_id)
    if not payload:
        raise HTTPException(404, f"Show '{req.show_id}' not found")
    manifest = persist_compiled_artifacts(payload, mode=req.mode, runtime_target=req.runtime_target)
    return {"status": "persisted", "manifest": manifest}


@router.get("/artifacts/{bundle_id}/manifest")
async def get_artifact_manifest(bundle_id: str):
    manifest = load_bundle_manifest(bundle_id)
    if not manifest:
        raise HTTPException(404, f"Bundle '{bundle_id}' not found")
    return manifest


def _artifact_or_404(bundle_id: str, kind: str) -> dict[str, Any]:
    artifact = load_bundle_artifact(bundle_id, kind)
    if not artifact:
        raise HTTPException(404, f"Artifact '{kind}' for bundle '{bundle_id}' not found")
    return artifact


@router.get("/artifacts/{bundle_id}/canonical")
async def get_artifact_canonical(bundle_id: str):
    return _artifact_or_404(bundle_id, "canonical")


@router.get("/artifacts/{bundle_id}/session")
async def get_artifact_session(bundle_id: str):
    return _artifact_or_404(bundle_id, "session")


@router.get("/artifacts/{bundle_id}/report")
async def get_artifact_report(bundle_id: str):
    return _artifact_or_404(bundle_id, "report")


@router.get("/artifacts/{bundle_id}/bundle")
async def get_artifact_bundle(bundle_id: str):
    return _artifact_or_404(bundle_id, "bundle")
