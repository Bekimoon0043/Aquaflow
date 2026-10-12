"""A license must not break when a network adapter is plugged in, unplugged or re-ordered."""
import hashlib

import pytest

from license import fingerprint as fp
from license import license_engine as engine


@pytest.fixture
def machine(monkeypatch):
    state = {"macs": {"64:5d:86:8d:d5:51", "00:ff:f3:7c:8a:52"}, "getnode": "64:5d:86:8d:d5:51"}
    fp.clear_cache()
    monkeypatch.setattr(fp, "cpu_id", lambda: "BFEBFBFF000806EA")
    monkeypatch.setattr(fp, "board_serial", lambda: "PHHZUAA0GBF8R5")
    monkeypatch.setattr(fp.platform, "node", lambda: "DESKTOP-TEST")
    monkeypatch.setattr(fp, "getnode_mac", lambda: state["getnode"])
    monkeypatch.setattr(fp, "adapter_macs", lambda: set(state["macs"]) | {state["getnode"], "00:00:00:00:00:00"})
    yield state
    fp.clear_cache()


def legacy(mac):
    return hashlib.sha256(f"{mac}|BFEBFBFF000806EA|PHHZUAA0GBF8R5|DESKTOP-TEST".encode()).hexdigest()


def test_stable_id_ignores_network_adapters(machine):
    first = engine.generate_hardware_fingerprint()
    machine["macs"].add("aa:bb:cc:dd:ee:ff"); machine["getnode"] = "aa:bb:cc:dd:ee:ff"   # USB dongle plugged in
    fp.clear_cache()
    assert engine.generate_hardware_fingerprint() == first
    assert first == hashlib.sha256(b"aquaflow-fp-v2|BFEBFBFF000806EA|PHHZUAA0GBF8R5|DESKTOP-TEST").hexdigest()


def test_v2_license_survives_adapter_changes(machine):
    lic = engine.create_license("Client", "Co", "STUDIO", engine.generate_hardware_fingerprint(), expiry_date="2030-01-01")
    assert engine.validate_for_this_machine(lic)["status"] == "VALID"
    machine["macs"] = {"11:22:33:44:55:66"}; machine["getnode"] = "11:22:33:44:55:66"
    fp.clear_cache()
    assert engine.validate_for_this_machine(lic)["status"] == "VALID"


def test_legacy_v1_license_is_accepted_for_any_adapter_of_this_machine(machine):
    old = engine.create_license("Client", "Co", "STUDIO", legacy("00:ff:f3:7c:8a:52"), expiry_date="2030-01-01")
    # uuid.getnode() now returns the Wi-Fi MAC, but the license was issued while another adapter was first.
    assert engine.validate_for_this_machine(old)["status"] == "VALID"


def test_another_machine_is_still_rejected(machine):
    other = engine.create_license("Client", "Co", "STUDIO", "f" * 64, expiry_date="2030-01-01")
    assert engine.validate_for_this_machine(other)["status"] == "INVALID_HW"
    # Explicit remote validation never borrows this machine's alternatives.
    lic = engine.create_license("Client", "Co", "STUDIO", legacy("00:ff:f3:7c:8a:52"), expiry_date="2030-01-01")
    assert engine.validate_license(lic, "e" * 64)["status"] == "INVALID_HW"


def test_tampered_license_still_fails_signature(machine):
    lic = engine.create_license("Client", "Co", "PLAYER", engine.generate_hardware_fingerprint(), expiry_date="2030-01-01")
    lic["edition"] = "STUDIO"
    assert engine.validate_for_this_machine(lic)["status"] == "INVALID_SIG"
