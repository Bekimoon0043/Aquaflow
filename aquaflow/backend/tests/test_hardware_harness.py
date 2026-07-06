"""
AF-HUB-010 — hardware verification harness (prep) tests.

The harness is a tool the on-site team runs; these tests lock in its argument parsing,
its report assembly, and — critically — that it stays HONEST: it never self-certifies
hardware (deployment_ready / real_hardware_verified stay False without the commissioning
flag) and it labels un-commissioned output SIMULATED.
"""
import json

import hardware_verification_harness as harness


def test_default_args_run_loopback_selftest():
    args = harness.parse_args([])
    assert args.target is None  # no target → self-test mode


def test_target_args_parse_for_real_mode():
    args = harness.parse_args(["--target", "192.168.1.50", "--universe", "3", "--protocol", "sacn"])
    assert args.target == "192.168.1.50"
    assert args.universe == 3
    assert args.protocol == "sacn"


def test_report_never_self_certifies_without_commissioning(monkeypatch):
    # Force the uncommissioned (default) state.
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "0")
    report = harness.build_harness_report("real_target", {"transmitted": True})
    assert report["hardware_commissioned"] is False
    assert report["verification_mode"] == "SIMULATED"
    assert report["real_hardware_verified"] is False
    assert report["deployment_ready"] is False
    assert report["label"]  # carries the SIMULATED label


def test_report_defers_readiness_to_commissioning_flag_even_when_transmitted(monkeypatch):
    # Even a perfect transmission must not flip deployment_ready — only AF-HUB-011 does.
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "0")
    report = harness.build_harness_report("real_target",
                                          {"transmitted": True, "frames_sent": 10})
    assert report["deployment_ready"] is False


def test_loopback_selftest_runs_and_is_labelled_simulated(monkeypatch):
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "0")
    result = harness.run_loopback_selftest()
    # The underlying verifier reports honestly; readiness is gated on commissioning.
    assert "loopback_checks_passed" in result
    assert result["deployment_ready"] is False
    assert result["simulated"] is True


def test_main_writes_json_and_returns_exit_code(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "0")
    out = tmp_path / "result.json"
    code = harness.main(["--out", str(out)])
    assert out.exists()
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["mode"] == "loopback_selftest"
    assert data["deployment_ready"] is False
    # exit code reflects the run's own checks, not hardware readiness
    assert code in (0, 1)
