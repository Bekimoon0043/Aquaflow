"""
backend/license/license_routes.py  — BETA EDITION
────────────────────────────────────────────────────
FastAPI license routes for AquaFlow Studio beta.

SECURITY: All dev bypass code removed.
          No studio_dev.token check.
          No AQUAFLOW_DEV_STUDIO env bypass.

License file location on client machine:
  backend/license/active_license.json   ← PRIMARY
  C:/AquaFlow/license.json              ← FALLBACK
  ~/.aquaflow/license.json              ← FALLBACK
"""

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from license.license_engine import (
    validate_license,
    validate_for_this_machine,
    generate_hardware_fingerprint,
    save_license_cache,
    load_license_cache,
    check_grace_period,
    set_current_license,
    get_current_license,
    LicenseStatus,
    STRONG_BETA_FEATURES,
)

router = APIRouter()

# ─── license file search order ────────────────────────────────────────────────
# PRIMARY location — place active_license.json here after installation
CLIENT_LICENSE_PATHS = [
    Path(__file__).parent / "active_license.json",   # backend/license/active_license.json
    Path("C:/AquaFlow/license.json"),
    Path.home() / ".aquaflow" / "license.json",
    Path("license.json"),
    Path("data/license.json"),
]


# ─── models ───────────────────────────────────────────────────────────────────

class ValidateRequest(BaseModel):
    license_data: dict
    hardware_fingerprint: Optional[str] = None


class ActivateRequest(BaseModel):
    license_path: Optional[str] = None


# ─── helpers ──────────────────────────────────────────────────────────────────

def _find_license_file() -> Optional[dict]:
    for path in CLIENT_LICENSE_PATHS:
        if path.exists():
            try:
                with open(path) as f:
                    return json.load(f)
            except Exception:
                continue
    return None


def _build_response(result: dict) -> dict:
    return {
        "status":        result["status"],
        "valid":         result["status"] in (LicenseStatus.VALID, LicenseStatus.GRACE_PERIOD),
        "edition":       result.get("edition", "NONE"),
        "features":      result.get("features", []),
        "user_name":     result.get("user_name", ""),
        "company_name":  result.get("company_name", ""),
        "license_key":   result.get("license_key", ""),
        "expires_at":    result.get("expires_at", ""),
        "days_remaining": result.get("days_remaining", 0),
        "message":       result.get("message", ""),
    }


# ─── routes ───────────────────────────────────────────────────────────────────

@router.get("/api/license/fingerprint")
def get_fingerprint():
    """
    Returns this machine's hardware fingerprint.
    Run on the CLIENT machine and send the value to LuxuryCon.
    """
    return {
        "fingerprint": generate_hardware_fingerprint(),
        "env_var":     "AQUAFLOW_MACHINE_FINGERPRINT",
        "instructions": (
            "Copy the fingerprint value above and send it to LuxuryCon "
            "Fountain Systems to generate your beta license."
        ),
    }


@router.get("/api/license/status")
def get_license_status():
    """
    Get current license status.
    Flow: in-memory → license file → cached → grace period → blocked.
    NO dev bypass. NO fallback to open access.
    """
    fp = generate_hardware_fingerprint()

    # 1. Already validated this session
    current = get_current_license()
    if current and current["status"] == LicenseStatus.VALID:
        return _build_response(current)

    # 2. Try license file
    license_data = _find_license_file()
    if license_data:
        result = validate_for_this_machine(license_data)
        if result["status"] == LicenseStatus.VALID:
            save_license_cache(license_data)
            set_current_license(result)
            return _build_response(result)
        else:
            # File found but invalid — return the specific error (wrong machine, expired, etc.)
            return _build_response(result)

    # 3. Fall back to cache
    cached = load_license_cache()
    if cached:
        result = validate_for_this_machine(cached)
        if result["status"] == LicenseStatus.VALID:
            grace = check_grace_period()
            if grace["within_grace"]:
                result["status"]  = LicenseStatus.GRACE_PERIOD
                result["message"] = (
                    f"Offline mode — {grace['days_remaining']} days until "
                    "re-validation required"
                )
                set_current_license(result)
                return _build_response(result)
            else:
                return _build_response({
                    "status":  LicenseStatus.GRACE_EXPIRED,
                    "edition": "NONE",
                    "features": [],
                    "message": "This AquaFlow Studio beta license has expired.",
                })

    # 4. Nothing found — block access
    return _build_response({
        "status":   LicenseStatus.NOT_FOUND,
        "edition":  "NONE",
        "features": [],
        "message":  (
            "No license file found. Place your active_license.json in "
            "the backend/license/ folder."
        ),
    })


@router.post("/api/license/activate")
def activate_license(req: ActivateRequest):
    """
    Activate a license file. Validates and caches it for offline use.
    """
    license_data = None

    if req.license_path:
        try:
            with open(req.license_path) as f:
                license_data = json.load(f)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail=f"Could not read license file at: {req.license_path}"
            )
    else:
        license_data = _find_license_file()

    if not license_data:
        raise HTTPException(
            status_code=404,
            detail=(
                "No license file found. Place active_license.json in "
                "backend/license/ and restart the server."
            ),
        )

    fp     = generate_hardware_fingerprint()
    result = validate_for_this_machine(license_data)

    if result["status"] != LicenseStatus.VALID:
        raise HTTPException(status_code=403, detail=result["message"])

    save_license_cache(license_data)
    set_current_license(result)
    return {"activated": True, **_build_response(result)}


@router.post("/api/license/validate")
def validate_endpoint(req: ValidateRequest):
    """Server-side validation endpoint (used by license server)."""
    result = (validate_license(req.license_data, req.hardware_fingerprint) if req.hardware_fingerprint
              else validate_for_this_machine(req.license_data))
    return _build_response(result)


@router.get("/api/license/features")
def get_features():
    current = get_current_license()
    if not current:
        return {"features": [], "edition": "NONE"}
    return {
        "features": current.get("features", []),
        "edition":  current.get("edition", "NONE"),
    }
