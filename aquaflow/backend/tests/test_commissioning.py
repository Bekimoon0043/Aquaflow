"""
test_commissioning.py — AF-HUB-000C honest hardware labeling.

Proves the credibility guarantees:
  * the hardware-commissioning flag defaults FALSE,
  * commissioning_status() carries the SIMULATED label + banner while FALSE,
  * the verifier never claims deployment_ready / real_hardware_verified while the
    flag is FALSE (even if every loopback check passes),
  * setting the flag flips the labels to REAL_HARDWARE.
"""
import importlib

import services.commissioning as commissioning
from services.commissioning import (
    is_hardware_commissioned, commissioning_status, verification_mode,
    SIMULATED_LABEL, COMMISSION_BANNER,
)
from services.hardware_verifier import run_full_verification

FLAG = "AQUAFLOW_HARDWARE_COMMISSIONED"


def test_flag_defaults_false(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    assert is_hardware_commissioned() is False
    assert verification_mode() == "SIMULATED"


def test_status_shows_banner_and_label_while_uncommissioned(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    s = commissioning_status()
    assert s["hardware_commissioned"] is False
    assert s["verification_mode"] == "SIMULATED"
    assert s["label"] == SIMULATED_LABEL
    assert s["banner"] == COMMISSION_BANNER


def test_flag_truthy_values(monkeypatch):
    for val in ("1", "true", "TRUE", "Yes", "on"):
        monkeypatch.setenv(FLAG, val)
        assert is_hardware_commissioned() is True
    for val in ("", "0", "false", "no", "off", "maybe"):
        monkeypatch.setenv(FLAG, val)
        assert is_hardware_commissioned() is False


def test_status_when_commissioned(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    s = commissioning_status()
    assert s["hardware_commissioned"] is True
    assert s["verification_mode"] == "REAL_HARDWARE"
    assert s["label"] is None
    assert s["banner"] is None


def test_verifier_is_simulated_and_not_deployment_ready_while_uncommissioned(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    report = run_full_verification()
    # Explicitly labeled simulated.
    assert report["verification_mode"] == "SIMULATED"
    assert report["simulated"] is True
    assert report["hardware_commissioned"] is False
    assert report["label"] == SIMULATED_LABEL
    # The raw simulated result is still exposed honestly...
    assert "loopback_checks_passed" in report
    # ...but nothing claims real-hardware readiness while the flag is FALSE.
    assert report["deployment_ready"] is False
    assert report["real_hardware_verified"] is False


def test_verifier_can_be_deployment_ready_only_when_commissioned(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    report = run_full_verification()
    assert report["verification_mode"] == "REAL_HARDWARE"
    assert report["simulated"] is False
    # With the flag set, readiness follows the loopback result (no failed checks).
    assert report["deployment_ready"] == report["loopback_checks_passed"]
    assert report["real_hardware_verified"] == report["loopback_checks_passed"]
