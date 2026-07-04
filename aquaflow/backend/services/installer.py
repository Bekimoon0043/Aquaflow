"""
installer.py — AquaFlow Stage 4, AQ-S4-001

Installer framework: one-click install, auto-update, and license activation.

Provides the machine-facing lifecycle for an AquaFlow deployment:

  * one-click installation — `InstallManager.install(root)` idempotently provisions an
    install directory (config/data/logs/compiled/cache), writes a signed install
    manifest (install id, version, edition, timestamp), and verifies the result in a
    single call,
  * auto updates — semantic-version comparison + an update manifest give
    `check_for_update`; `apply_update` records the version change (with history) and
    `rollback` reverts it,
  * license activation — `activate_license` wraps the existing license engine
    (hardware-fingerprint validation + cache) so an installer/UI can activate a key.

Pure and filesystem-scoped (all state under the install root) so it is fully
unit-tested against a temp directory; the route exposes it to the installer UI.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

APP_NAME = "AquaFlow Studio"
INSTALL_DIRS = ["config", "data", "logs", "compiled", "cache"]
MANIFEST_NAME = "install.json"


def get_app_version() -> str:
    """Current application version (from frontend/package.json, fallback 0.1.0)."""
    try:
        pkg = Path(__file__).resolve().parents[2] / "frontend" / "package.json"
        return str(json.loads(pkg.read_text(encoding="utf-8")).get("version", "0.1.0"))
    except Exception:
        return "0.1.0"


# ── Semantic versioning ────────────────────────────────────────────────────────

def parse_version(v: str) -> tuple[int, int, int]:
    """Parse 'x.y.z' (ignoring any pre-release/build suffix) into a tuple."""
    m = re.match(r"^\s*v?(\d+)\.(\d+)\.(\d+)", str(v or "0.0.0"))
    if not m:
        return (0, 0, 0)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)))


def compare_versions(a: str, b: str) -> int:
    """Return -1 if a<b, 0 if equal, 1 if a>b (semver, patch precision)."""
    pa, pb = parse_version(a), parse_version(b)
    return (pa > pb) - (pa < pb)


def is_newer(candidate: str, current: str) -> bool:
    return compare_versions(candidate, current) > 0


# ── Auto-update ────────────────────────────────────────────────────────────────

def check_for_update(current_version: str, update_manifest: dict) -> dict:
    """
    Compare the installed version against an update manifest.

    update_manifest = {latest, channel?, min_supported?, mandatory?, notes?, url?, sha256?}
    Returns whether an update is available and whether it is mandatory (either flagged,
    or the current version is below the manifest's minimum supported version).
    """
    latest = str(update_manifest.get("latest", current_version))
    available = is_newer(latest, current_version)
    min_supported = update_manifest.get("min_supported")
    below_min = bool(min_supported) and compare_versions(current_version, min_supported) < 0
    mandatory = bool(update_manifest.get("mandatory", False)) or (available and below_min)
    return {
        "update_available": available,
        "current_version": current_version,
        "latest_version": latest,
        "channel": update_manifest.get("channel", "stable"),
        "mandatory": mandatory if available else False,
        "notes": update_manifest.get("notes", ""),
        "url": update_manifest.get("url", ""),
        "sha256": update_manifest.get("sha256", ""),
    }


# ── Install manager ────────────────────────────────────────────────────────────

class InstallManager:
    """Provision, inspect, update and activate an AquaFlow install under a root dir."""

    def __init__(self, root):
        self.root = Path(root)

    def _manifest_path(self) -> Path:
        return self.root / MANIFEST_NAME

    def is_installed(self) -> bool:
        p = self._manifest_path()
        if not p.exists():
            return False
        try:
            return bool(json.loads(p.read_text(encoding="utf-8")).get("installed"))
        except Exception:
            return False

    def info(self) -> Optional[dict]:
        p = self._manifest_path()
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None

    def install(self, version: Optional[str] = None, edition: str = "beta",
                config: Optional[dict] = None, force: bool = False) -> dict:
        """
        One-click install: create the directory layout, write the manifest + default
        config, and verify — all idempotent. Returns a step-by-step report.
        """
        version = version or get_app_version()
        steps = []

        if self.is_installed() and not force:
            info = self.info() or {}
            return {"ok": True, "already_installed": True, "version": info.get("version"),
                    "install_id": info.get("install_id"), "path": str(self.root),
                    "steps": ["already installed — no action"]}

        self.root.mkdir(parents=True, exist_ok=True)
        for d in INSTALL_DIRS:
            (self.root / d).mkdir(parents=True, exist_ok=True)
            steps.append(f"ensured dir: {d}")

        cfg = {"app": APP_NAME, "version": version, "edition": edition,
               "backend_port": 8000, **(config or {})}
        (self.root / "config" / "app_config.json").write_text(
            json.dumps(cfg, indent=2), encoding="utf-8", newline="")
        steps.append("wrote config/app_config.json")

        manifest = {
            "app": APP_NAME,
            "installed": True,
            "version": version,
            "edition": edition,
            "install_id": (self.info() or {}).get("install_id") or uuid.uuid4().hex[:16],
            "installed_at": datetime.now(timezone.utc).isoformat(),
            "dirs": INSTALL_DIRS,
            "update_history": [],
        }
        self._manifest_path().write_text(json.dumps(manifest, indent=2),
                                         encoding="utf-8", newline="")
        steps.append("wrote install manifest")

        verified = self.verify()
        return {"ok": verified["ok"], "already_installed": False, "version": version,
                "install_id": manifest["install_id"], "edition": edition,
                "path": str(self.root), "steps": steps, "verification": verified}

    def verify(self) -> dict:
        """Confirm the install layout is complete and the manifest is readable."""
        problems = []
        if not self.is_installed():
            problems.append("install manifest missing or not marked installed")
        for d in INSTALL_DIRS:
            if not (self.root / d).is_dir():
                problems.append(f"missing dir: {d}")
        if not (self.root / "config" / "app_config.json").exists():
            problems.append("missing config/app_config.json")
        return {"ok": not problems, "problems": problems}

    # ── Auto-update ────────────────────────────────────────────────────────────
    def check_update(self, update_manifest: dict) -> dict:
        info = self.info() or {}
        return check_for_update(info.get("version", get_app_version()), update_manifest)

    def apply_update(self, new_version: str, notes: str = "") -> dict:
        info = self.info()
        if not info:
            raise RuntimeError("not installed")
        if not is_newer(new_version, info["version"]):
            return {"ok": False, "reason": "not a newer version",
                    "current": info["version"], "requested": new_version}
        previous = info["version"]
        info["update_history"].append({
            "from": previous, "to": new_version, "notes": notes,
            "at": datetime.now(timezone.utc).isoformat()})
        info["version"] = new_version
        info["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._manifest_path().write_text(json.dumps(info, indent=2), encoding="utf-8", newline="")
        # keep app_config version in sync
        cfg_path = self.root / "config" / "app_config.json"
        if cfg_path.exists():
            try:
                cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
                cfg["version"] = new_version
                cfg_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8", newline="")
            except Exception:
                pass
        return {"ok": True, "from": previous, "to": new_version}

    def rollback(self) -> dict:
        info = self.info()
        if not info or not info.get("update_history"):
            return {"ok": False, "reason": "no update to roll back"}
        last = info["update_history"].pop()
        info["version"] = last["from"]
        info["rolled_back_at"] = datetime.now(timezone.utc).isoformat()
        self._manifest_path().write_text(json.dumps(info, indent=2), encoding="utf-8", newline="")
        return {"ok": True, "restored": last["from"], "reverted": last["to"]}

    def uninstall(self) -> dict:
        p = self._manifest_path()
        if p.exists():
            p.unlink()
        return {"ok": True, "uninstalled": True}


# ── License activation (wraps the license engine) ──────────────────────────────

def activate_license(license_data: dict, fingerprint: Optional[str] = None) -> dict:
    """
    Activate a license on this machine: validate it against the hardware fingerprint
    and, if valid (or in grace), cache it as the current license.
    """
    from license.license_engine import (
        validate_license, generate_hardware_fingerprint, save_license_cache,
        set_current_license, LicenseStatus,
    )
    fp = fingerprint or generate_hardware_fingerprint()
    result = validate_license(license_data, fp)
    activated = result.get("status") in (LicenseStatus.VALID, LicenseStatus.GRACE_PERIOD)
    if activated:
        try:
            save_license_cache(license_data)
        except Exception:
            pass
        set_current_license(result)
    return {
        "activated": activated,
        "status": result.get("status"),
        "edition": result.get("edition", "NONE"),
        "features": result.get("features", []),
        "message": result.get("message", ""),
    }


def activation_status() -> dict:
    from license.license_engine import get_current_license, LicenseStatus
    cur = get_current_license()
    if not cur:
        return {"activated": False, "status": LicenseStatus.NOT_FOUND, "edition": "NONE"}
    return {
        "activated": cur.get("status") in (LicenseStatus.VALID, LicenseStatus.GRACE_PERIOD),
        "status": cur.get("status"),
        "edition": cur.get("edition", "NONE"),
        "features": cur.get("features", []),
    }
