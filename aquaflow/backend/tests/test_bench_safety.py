"""
AF-HUB-018 — Bench safety environment lock.

The unsafe dev safety bypass must be impossible to enable on a commissioned/bench machine,
even if the environment variables are set, and disabled in production mode.
"""
from services import bench_safety as bs


def _env(**kw):
    return dict(kw)


def test_production_mode_disables_bypass(monkeypatch):
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "0")  # not commissioned, but no dev flag
    allowed, reason = bs.safety_bypass_allowed(_env())
    assert allowed is False
    assert "production" in reason


def test_commissioned_machine_always_blocks_bypass_even_with_flags(monkeypatch):
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "1")  # real hardware
    env = _env(AQUAFLOW_DEV_MODE="true", AQUAFLOW_UNSAFE_DEV="true", AQUAFLOW_ENV="dev")
    allowed, reason = bs.safety_bypass_allowed(env)
    assert allowed is False
    assert "commissioned" in reason.lower()


def test_dev_mode_without_unsafe_flag_keeps_safety(monkeypatch):
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "0")
    allowed, _ = bs.safety_bypass_allowed(_env(AQUAFLOW_DEV_MODE="true"))
    assert allowed is False


def test_bypass_allowed_only_on_noncommissioned_dev_with_unsafe_flag(monkeypatch):
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "0")
    allowed, _ = bs.safety_bypass_allowed(_env(AQUAFLOW_DEV_MODE="true", AQUAFLOW_UNSAFE_DEV="true"))
    assert allowed is True


def test_resolve_logs_when_unsafe_requested_but_blocked(monkeypatch, caplog):
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "1")  # commissioned → must block
    import logging
    with caplog.at_level(logging.WARNING):
        allowed = bs.resolve_safety_bypass(_env(AQUAFLOW_DEV_MODE="true", AQUAFLOW_UNSAFE_DEV="true"))
    assert allowed is False
    assert any("BENCH SAFETY LOCK" in r.message for r in caplog.records)


def test_startup_banner_reports_disabled_in_production(monkeypatch):
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "0")
    assert "DISABLED" in bs.startup_safety_banner(_env())


def test_startup_banner_reports_active_when_genuinely_dev(monkeypatch):
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "0")
    banner = bs.startup_safety_banner(_env(AQUAFLOW_DEV_MODE="true", AQUAFLOW_UNSAFE_DEV="true"))
    assert "ACTIVE" in banner


def test_every_weakening_flag_is_audited():
    # The audit list must name the flags the gate actually inspects.
    assert "AQUAFLOW_UNSAFE_DEV" in bs.SAFETY_WEAKENING_FLAGS
    assert "AQUAFLOW_DEV_MODE" in bs.SAFETY_WEAKENING_FLAGS
    assert "AQUAFLOW_ENV" in bs.SAFETY_WEAKENING_FLAGS
