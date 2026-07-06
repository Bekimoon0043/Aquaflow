"""
AF-HUB-009B — Internal installer + license validation.

Covers the two hardened paths: (1) the installer's verify() now detects a CORRUPTED
tracked file via a recorded checksum, not just a missing one, and stays green across a
legitimate update; (2) license validation rejects a tampered signature, wrong hardware,
and an expired license; and (3) the running instance surfaces its license state in the
runtime health monitor.
"""
import copy

import pytest

from services.installer import InstallManager
from license import license_engine as le


# ── Installer integrity ─────────────────────────────────────────────────────────

def test_install_records_checksums():
    import tempfile, pathlib
    with tempfile.TemporaryDirectory() as d:
        mgr = InstallManager(pathlib.Path(d) / "app")
        mgr.install()
        info = mgr.info()
        assert "config/app_config.json" in info["checksums"]
        assert mgr.verify()["ok"] is True


def test_verify_detects_a_corrupted_file_not_just_a_missing_one():
    import tempfile, pathlib
    with tempfile.TemporaryDirectory() as d:
        mgr = InstallManager(pathlib.Path(d) / "app")
        mgr.install()
        cfg = pathlib.Path(d) / "app" / "config" / "app_config.json"
        # Tamper with the file contents (it still exists — old verify() would miss this).
        cfg.write_text(cfg.read_text(encoding="utf-8") + "\n// tampered", encoding="utf-8")
        v = mgr.verify()
        assert v["ok"] is False
        assert any("corrupted" in p and "app_config" in p for p in v["problems"])


def test_verify_stays_green_after_a_legitimate_update():
    import tempfile, pathlib
    with tempfile.TemporaryDirectory() as d:
        mgr = InstallManager(pathlib.Path(d) / "app")
        mgr.install(version="1.0.0")
        mgr.apply_update("1.1.0", notes="test")
        # apply_update rewrote the tracked config; checksums must have been refreshed.
        assert mgr.verify()["ok"] is True


# ── License validation robustness ───────────────────────────────────────────────

def _license():
    fp = le.generate_hardware_fingerprint()
    lic = le.create_license("Tester", "LuxuryCon", "STRONG_BETA", fp, valid_years=2)
    return lic, fp


def test_valid_license_passes():
    lic, fp = _license()
    res = le.validate_license(lic, fp)
    assert res["status"] == le.LicenseStatus.VALID


def test_tampered_signature_is_rejected():
    lic, fp = _license()
    tampered = copy.deepcopy(lic)
    tampered["edition"] = "STUDIO"  # change a signed field without re-signing
    res = le.validate_license(tampered, fp)
    assert res["status"] == le.LicenseStatus.INVALID_SIG


def test_forged_signature_is_rejected():
    lic, fp = _license()
    forged = copy.deepcopy(lic)
    forged["signature"] = "deadbeef" * 8
    res = le.validate_license(forged, fp)
    assert res["status"] == le.LicenseStatus.INVALID_SIG


def test_wrong_hardware_is_rejected():
    lic, _ = _license()
    res = le.validate_license(lic, "not-this-machine-fingerprint")
    assert res["status"] == le.LicenseStatus.INVALID_HW


def test_expired_license_is_rejected():
    fp = le.generate_hardware_fingerprint()
    expired = le.create_license("Tester", "LuxuryCon", "STRONG_BETA", fp,
                                expiry_date="2000-01-01")
    res = le.validate_license(expired, fp)
    assert res["status"] == le.LicenseStatus.EXPIRED


# ── License state surfaced in runtime health ────────────────────────────────────

def test_runtime_health_surfaces_license_state():
    from services.runtime_health import RuntimeHealthMonitor
    snap = RuntimeHealthMonitor().snapshot()
    assert "license" in snap["subsystems"]
    assert "status" in snap["subsystems"]["license"]
