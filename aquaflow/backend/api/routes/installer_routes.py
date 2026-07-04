"""
installer_routes.py — AquaFlow Stage 4, AQ-S4-001

Installer framework API: version/status, one-click install, auto-update check/apply,
and license activation.

  GET  /api/installer/version        → app + installer version
  POST /api/installer/install        → one-click install into a target dir
  POST /api/installer/check-update   → compare installed version to an update manifest
  POST /api/installer/apply-update   → apply an update (records history)
  POST /api/installer/activate       → activate a license key
  GET  /api/installer/activation     → current activation status
"""
from pathlib import Path

from fastapi import APIRouter, HTTPException

from services.installer import (
    InstallManager, get_app_version, check_for_update, activate_license,
    activation_status, APP_NAME,
)

router = APIRouter()

_DEFAULT_ROOT = Path.home() / ".aquaflow" / "install"


@router.get("/version")
async def version():
    return {"app": APP_NAME, "version": get_app_version(), "installer": "1.0"}


@router.post("/install")
async def install(payload: dict = None):
    payload = payload or {}
    root = payload.get("target_dir") or str(_DEFAULT_ROOT)
    mgr = InstallManager(root)
    return mgr.install(version=payload.get("version"), edition=payload.get("edition", "beta"),
                       config=payload.get("config"), force=bool(payload.get("force", False)))


@router.post("/check-update")
async def check_update(payload: dict):
    manifest = payload.get("update_manifest") or payload
    current = payload.get("current_version") or get_app_version()
    root = payload.get("target_dir")
    if root:
        return InstallManager(root).check_update(manifest)
    return check_for_update(current, manifest)


@router.post("/apply-update")
async def apply_update(payload: dict):
    root = payload.get("target_dir") or str(_DEFAULT_ROOT)
    new_version = payload.get("new_version")
    if not new_version:
        raise HTTPException(400, "new_version required")
    try:
        return InstallManager(root).apply_update(new_version, notes=payload.get("notes", ""))
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@router.post("/activate")
async def activate(payload: dict):
    license_data = payload.get("license_data") or payload.get("license")
    if not license_data:
        raise HTTPException(400, "license_data required")
    return activate_license(license_data, fingerprint=payload.get("hardware_fingerprint"))


@router.get("/activation")
async def activation():
    return activation_status()
