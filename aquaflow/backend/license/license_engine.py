"""
backend/license/license_engine.py  — BETA EDITION
────────────────────────────────────────────────────
AquaFlow Studio machine-locked beta license engine.

Security rules enforced:
  - LICENSE_SECRET must come from environment variable only (never hardcoded)
  - Hardware fingerprint locks license to one machine
  - STRONG_BETA edition with expiry enforcement
  - No dev bypass of any kind
"""

import hashlib
import hmac
import json
import os
import platform
import subprocess
import uuid
from base64 import b64decode, b64encode
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

# ─── secret key ───────────────────────────────────────────────────────────────
# MUST be set as an environment variable — never hardcoded.
# Set in your backend .env file or system environment:
#   AQUAFLOW_LICENSE_SECRET=<your-long-random-secret>

LICENSE_SECRET = os.getenv("AQUAFLOW_LICENSE_SECRET")
if not LICENSE_SECRET:
    raise RuntimeError(
        "AQUAFLOW_LICENSE_SECRET environment variable is not set. "
        "Add it to your backend .env file before starting the server."
    )

# ─── configuration ────────────────────────────────────────────────────────────

CACHE_DIR  = Path(os.getenv("AQUAFLOW_LICENSE_DIR", Path.home() / ".aquaflow"))
CACHE_FILE = CACHE_DIR / "license.cache"
GRACE_FILE = CACHE_DIR / "grace.json"

GRACE_PERIOD_DAYS = 30

# ─── editions ─────────────────────────────────────────────────────────────────

EDITIONS = ["STRONG_BETA", "PLAYER", "STUDIO"]

STRONG_BETA_FEATURES = [
    "play", "stop", "pause", "schedule",
    "load_show", "device_status", "basic_monitoring",
    "engineering_designer", "show_programmer",
    "save", "load", "export", "import",
    "dry_run_preview", "3d_preview",
]

PLAYER_FEATURES = [
    "play", "stop", "pause", "schedule",
    "load_show", "device_status", "basic_monitoring",
]

STUDIO_FEATURES = [
    "play", "stop", "pause", "schedule",
    "load_show", "device_status", "basic_monitoring",
    "engineering_designer", "show_programmer",
    "save", "load", "export", "import",
    "dry_run_preview", "3d_preview",
    "ai_choreography", "pattern_designer",
    "timeline_editor", "audio_panel", "hydraulics", "bom_export",
]

EDITION_FEATURES = {
    "STRONG_BETA": STRONG_BETA_FEATURES,
    "PLAYER":      PLAYER_FEATURES,
    "STUDIO":      STUDIO_FEATURES,
}

# ─── hardware fingerprint ─────────────────────────────────────────────────────

from license import fingerprint as _fp


def _get_mac_address() -> str:
    return _fp.getnode_mac()


def _get_cpu_id() -> str:
    return _fp.cpu_id()


def _get_motherboard_id() -> str:
    return _fp.board_serial()


def generate_hardware_fingerprint() -> str:
    """
    The stable machine ID (v2): CPU id, board serial and host name — no network adapter,
    so plugging in a USB/VPN adapter no longer changes it. Shown on the Activation screen.
    """
    return _fp.stable_fingerprint()


def machine_fingerprints() -> set:
    """Every fingerprint this machine answers to: v2 plus the legacy v1 one for each adapter."""
    return _fp.machine_fingerprints()


# ─── signing ──────────────────────────────────────────────────────────────────

def _sign(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hmac.new(
        LICENSE_SECRET.encode(), canonical.encode(), hashlib.sha256
    ).hexdigest()


def _verify_signature(license_data: dict) -> bool:
    try:
        payload  = {k: v for k, v in license_data.items() if k != "signature"}
        expected = _sign(payload)
        return hmac.compare_digest(expected, license_data.get("signature", ""))
    except Exception:
        return False


# ─── license creation ─────────────────────────────────────────────────────────

def _generate_license_key() -> str:
    raw = hashlib.sha256(os.urandom(32)).hexdigest().upper()
    return "-".join(raw[i:i+4] for i in range(0, 16, 4))


def create_license(
    user_name: str,
    company_name: str,
    edition: str,
    hardware_fingerprint: str,
    expiry_date: Optional[str] = None,   # ISO date string e.g. "2027-06-01"
    valid_years: int = 2,
    issued_by: str = "LuxuryCon Fountain Systems",
) -> dict:
    """
    Create and sign a beta license.

    Args:
        user_name:            e.g. "John Smith"
        company_name:         e.g. "Dubai Mall Operations"
        edition:              "STRONG_BETA", "PLAYER", or "STUDIO"
        hardware_fingerprint: from get_fingerprint.py on the target machine
        expiry_date:          ISO string override, or None to use valid_years
        valid_years:          years until expiry (default 2)
        issued_by:            issuing company name
    """
    if edition not in EDITIONS:
        raise ValueError(f"edition must be one of {EDITIONS}")

    now    = datetime.utcnow()
    if expiry_date:
        expiry = datetime.fromisoformat(expiry_date)
    else:
        expiry = now + timedelta(days=365 * valid_years)

    features = EDITION_FEATURES[edition]

    payload = {
        "license_version":      "1.0",
        "license_key":          _generate_license_key(),
        "user_name":            user_name,
        "company_name":         company_name,
        "edition":              edition,
        "hardware_fingerprint": hardware_fingerprint,
        "issued_by":            issued_by,
        "issued_at":            now.isoformat(),
        "expires_at":           expiry.isoformat(),
        "features":             features,
    }

    payload["signature"] = _sign(payload)
    return payload


# ─── validation ───────────────────────────────────────────────────────────────

class LicenseStatus:
    VALID        = "VALID"
    EXPIRED      = "EXPIRED"
    INVALID_HW   = "INVALID_HW"
    INVALID_SIG  = "INVALID_SIG"
    NOT_FOUND    = "NOT_FOUND"
    GRACE_PERIOD = "GRACE_PERIOD"
    GRACE_EXPIRED= "GRACE_EXPIRED"
    ERROR        = "ERROR"


def validate_license(license_data: dict, current_fingerprint: str, alternatives=None) -> dict:
    """
    Validate a license against a machine fingerprint.
    `alternatives` lists other fingerprints the SAME machine answers to (legacy v1 per
    network adapter); pass machine_fingerprints() only when validating for this machine.
    Returns a result dict with status, features, and messages.
    """
    # 1. Signature
    if not _verify_signature(license_data):
        return _fail(
            LicenseStatus.INVALID_SIG,
            "This AquaFlow Studio beta license is not valid for this computer."
        )

    # 2. Hardware fingerprint
    accepted = {current_fingerprint, *(alternatives or ())}
    if license_data.get("hardware_fingerprint") not in accepted:
        return _fail(
            LicenseStatus.INVALID_HW,
            "This AquaFlow Studio beta license is not valid for this computer."
        )

    # 3. Expiry
    try:
        expires_at    = datetime.fromisoformat(license_data["expires_at"])
        now           = datetime.utcnow()
        days_remaining = (expires_at - now).days
        if now > expires_at:
            return _fail(
                LicenseStatus.EXPIRED,
                "This AquaFlow Studio beta license has expired."
            )
    except Exception:
        return _fail(LicenseStatus.ERROR, "License date format invalid.")

    # 4. Valid
    return {
        "status":        LicenseStatus.VALID,
        "edition":       license_data.get("edition", "STRONG_BETA"),
        "features":      license_data.get("features", STRONG_BETA_FEATURES),
        "user_name":     license_data.get("user_name", ""),
        "company_name":  license_data.get("company_name", ""),
        "license_key":   license_data.get("license_key", ""),
        "expires_at":    license_data.get("expires_at", ""),
        "days_remaining": days_remaining,
        "message":       f"License valid — {days_remaining} days remaining",
    }


def validate_for_this_machine(license_data: dict) -> dict:
    """Validate a license for the machine AquaFlow is running on (v2 or any legacy v1 fingerprint)."""
    return validate_license(license_data, generate_hardware_fingerprint(), machine_fingerprints())


def _fail(status: str, message: str) -> dict:
    return {
        "status":        status,
        "edition":       "NONE",
        "features":      [],
        "message":       message,
        "expires_at":    "",
        "days_remaining": 0,
    }


# ─── local cache ──────────────────────────────────────────────────────────────

def _cache_key() -> bytes:
    fp  = generate_hardware_fingerprint()
    key = hashlib.sha256(f"{fp}:{LICENSE_SECRET}".encode()).digest()
    return key


def _xor_encrypt(data: bytes, key: bytes) -> bytes:
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))


def save_license_cache(license_data: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    raw       = json.dumps(license_data).encode()
    encrypted = _xor_encrypt(raw, _cache_key())
    CACHE_FILE.write_text(b64encode(encrypted).decode())
    grace = {"last_online": datetime.utcnow().isoformat()}
    GRACE_FILE.write_text(json.dumps(grace))


def load_license_cache() -> Optional[dict]:
    try:
        encrypted = b64decode(CACHE_FILE.read_text())
        raw       = _xor_encrypt(encrypted, _cache_key())
        return json.loads(raw.decode())
    except Exception:
        return None


def check_grace_period() -> dict:
    try:
        grace        = json.loads(GRACE_FILE.read_text())
        last_online  = datetime.fromisoformat(grace["last_online"])
        days_offline = (datetime.utcnow() - last_online).days
        return {
            "within_grace":   days_offline <= GRACE_PERIOD_DAYS,
            "days_offline":   days_offline,
            "days_remaining": max(0, GRACE_PERIOD_DAYS - days_offline),
        }
    except Exception:
        return {"within_grace": False, "days_offline": 999, "days_remaining": 0}


# ─── singleton state ──────────────────────────────────────────────────────────

_current_license: Optional[dict] = None


def get_current_license() -> Optional[dict]:
    return _current_license


def set_current_license(result: dict) -> None:
    global _current_license
    _current_license = result


def has_feature(feature: str) -> bool:
    if _current_license is None:
        return False
    return feature in _current_license.get("features", [])


def get_edition() -> str:
    if _current_license is None:
        return "NONE"
    return _current_license.get("edition", "NONE")
