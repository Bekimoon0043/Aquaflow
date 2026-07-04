"""
validate_installer.py — AQ-S4-001 verification

Confirms the installer framework:
  1. one-click installation (single call provisions + verifies an install dir),
  2. auto updates (semver compare, check-for-update, apply + rollback),
  3. license activation (validates a signed key against the hardware fingerprint).

Run:  python backend/validate_installer.py   (from the aquaflow/ dir)
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.installer import (
    InstallManager, get_app_version, parse_version, compare_versions, is_newer,
    check_for_update, activate_license, INSTALL_DIRS,
)

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


tmp = Path(tempfile.mkdtemp()) / "AquaFlow"

print("== 1. one-click installation ==")
mgr = InstallManager(tmp)
check("not installed initially", not mgr.is_installed())
report = mgr.install(version="0.1.0", edition="beta")
check("install reports ok", report["ok"] and not report["already_installed"])
check("all install dirs created", all((tmp / d).is_dir() for d in INSTALL_DIRS))
check("app config written", (tmp / "config" / "app_config.json").exists())
check("manifest marks installed", mgr.is_installed())
check("install id assigned", bool(report["install_id"]))
check("verify() passes", mgr.verify()["ok"], str(mgr.verify()["problems"]))
# Idempotent: a second install is a no-op with the same id.
again = mgr.install()
check("re-install is idempotent (already installed)", again["already_installed"] is True)
check("install id stable across re-install", again["install_id"] == report["install_id"])

print("== 2. auto updates ==")
check("parse_version", parse_version("v1.2.3") == (1, 2, 3))
check("compare 0.1.0 < 0.2.0", compare_versions("0.1.0", "0.2.0") == -1)
check("compare 1.0.0 > 0.9.9", compare_versions("1.0.0", "0.9.9") == 1)
check("is_newer true for 0.2.0 over 0.1.0", is_newer("0.2.0", "0.1.0"))
check("is_newer false for equal", not is_newer("0.1.0", "0.1.0"))

upd = check_for_update("0.1.0", {"latest": "0.2.0", "channel": "stable", "notes": "New engines"})
check("update detected", upd["update_available"] and upd["latest_version"] == "0.2.0")
none = check_for_update("0.2.0", {"latest": "0.2.0"})
check("no update when current == latest", none["update_available"] is False)
mand = check_for_update("0.1.0", {"latest": "0.3.0", "min_supported": "0.2.0"})
check("mandatory when below min_supported", mand["mandatory"] is True)

check("manager check_update sees the update",
      mgr.check_update({"latest": "0.2.0"})["update_available"] is True)
ap = mgr.apply_update("0.2.0", notes="engines")
check("apply_update bumps version", ap["ok"] and mgr.info()["version"] == "0.2.0")
check("update history recorded", len(mgr.info()["update_history"]) == 1
      and mgr.info()["update_history"][0]["from"] == "0.1.0")
check("app_config version synced", __import__("json").loads(
      (tmp / "config" / "app_config.json").read_text())["version"] == "0.2.0")
check("apply_update rejects older version", mgr.apply_update("0.1.0")["ok"] is False)
rb = mgr.rollback()
check("rollback restores previous version", rb["ok"] and mgr.info()["version"] == "0.1.0")

print("== 3. license activation ==")
from license.license_engine import create_license, generate_hardware_fingerprint, EDITIONS
edition = "STUDIO" if "STUDIO" in EDITIONS else EDITIONS[0]
fp = generate_hardware_fingerprint()
lic = create_license("Test Operator", "LuxuryCon", edition, fp)
act = activate_license(lic, fingerprint=fp)
check("license activates on the matching fingerprint", act["activated"] is True, str(act["status"]))
check("activated edition matches", act["edition"] == edition)
check("features granted", len(act["features"]) >= 1)
bad = activate_license(lic, fingerprint="different-machine-fingerprint")
check("activation rejected on a different machine", bad["activated"] is False, str(bad["status"]))

print("== 4. app version ==")
check("get_app_version returns semver", parse_version(get_app_version()) != (0, 0, 0)
      or get_app_version() == "0.0.0", get_app_version())

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
