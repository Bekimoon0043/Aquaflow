"""
Contract tests for the Installer Framework (AQ-S4-001).

Asserts the three acceptance criteria:
  1. one-click installation (single call provisions + verifies an install),
  2. auto updates supported (semver compare, check-for-update, apply + rollback),
  3. license activation supported (validated against the hardware fingerprint).
"""
import json

import pytest

from services.installer import (
    InstallManager, get_app_version, parse_version, compare_versions, is_newer,
    check_for_update, activate_license, activation_status, INSTALL_DIRS,
)


# ── 1. one-click installation ─────────────────────────────────────────────────

def test_one_click_install(tmp_path):
    mgr = InstallManager(tmp_path / "app")
    assert mgr.is_installed() is False
    report = mgr.install(version="0.1.0", edition="beta")
    assert report["ok"] and report["already_installed"] is False
    for d in INSTALL_DIRS:
        assert (tmp_path / "app" / d).is_dir()
    assert (tmp_path / "app" / "config" / "app_config.json").exists()
    assert mgr.is_installed() is True
    assert report["install_id"]
    assert mgr.verify()["ok"] is True


def test_install_is_idempotent(tmp_path):
    mgr = InstallManager(tmp_path / "app")
    first = mgr.install()
    second = mgr.install()
    assert second["already_installed"] is True
    assert second["install_id"] == first["install_id"]


def test_verify_detects_damage(tmp_path):
    mgr = InstallManager(tmp_path / "app")
    mgr.install()
    (tmp_path / "app" / "config" / "app_config.json").unlink()
    v = mgr.verify()
    assert v["ok"] is False
    assert any("app_config" in p for p in v["problems"])


# ── 2. auto updates ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("a,b,expected", [
    ("0.1.0", "0.2.0", -1), ("1.0.0", "0.9.9", 1), ("1.2.3", "1.2.3", 0),
    ("v2.0.0", "1.9.9", 1),
])
def test_compare_versions(a, b, expected):
    assert compare_versions(a, b) == expected


def test_check_for_update():
    up = check_for_update("0.1.0", {"latest": "0.2.0", "notes": "x"})
    assert up["update_available"] is True and up["latest_version"] == "0.2.0"
    assert check_for_update("0.2.0", {"latest": "0.2.0"})["update_available"] is False


def test_mandatory_update_below_min_supported():
    up = check_for_update("0.1.0", {"latest": "0.3.0", "min_supported": "0.2.0"})
    assert up["mandatory"] is True


def test_apply_update_and_rollback(tmp_path):
    mgr = InstallManager(tmp_path / "app")
    mgr.install(version="0.1.0")
    assert mgr.check_update({"latest": "0.2.0"})["update_available"] is True
    res = mgr.apply_update("0.2.0", notes="engines")
    assert res["ok"] and mgr.info()["version"] == "0.2.0"
    assert mgr.info()["update_history"][0]["from"] == "0.1.0"
    cfg = json.loads((tmp_path / "app" / "config" / "app_config.json").read_text())
    assert cfg["version"] == "0.2.0"                 # config kept in sync
    assert mgr.apply_update("0.1.0")["ok"] is False  # cannot downgrade via update
    rb = mgr.rollback()
    assert rb["ok"] and mgr.info()["version"] == "0.1.0"


def test_apply_update_requires_install(tmp_path):
    mgr = InstallManager(tmp_path / "app")
    with pytest.raises(RuntimeError):
        mgr.apply_update("0.2.0")


# ── 3. license activation ─────────────────────────────────────────────────────

def _license(edition, fp):
    from license.license_engine import create_license
    return create_license("Test Operator", "LuxuryCon", edition, fp)


def test_license_activation_on_matching_machine():
    from license.license_engine import generate_hardware_fingerprint, EDITIONS
    edition = "STUDIO" if "STUDIO" in EDITIONS else EDITIONS[0]
    fp = generate_hardware_fingerprint()
    act = activate_license(_license(edition, fp), fingerprint=fp)
    assert act["activated"] is True
    assert act["edition"] == edition
    assert len(act["features"]) >= 1


def test_license_rejected_on_different_machine():
    from license.license_engine import generate_hardware_fingerprint, EDITIONS
    edition = "STUDIO" if "STUDIO" in EDITIONS else EDITIONS[0]
    fp = generate_hardware_fingerprint()
    act = activate_license(_license(edition, fp), fingerprint="another-machine")
    assert act["activated"] is False
    assert act["status"] == "INVALID_HW"


def test_activation_status_shape():
    s = activation_status()
    assert set(s) >= {"activated", "status", "edition"}


# ── app version ───────────────────────────────────────────────────────────────

def test_get_app_version_is_semver():
    assert parse_version(get_app_version()) != (0, 0, 0) or get_app_version() == "0.0.0"
