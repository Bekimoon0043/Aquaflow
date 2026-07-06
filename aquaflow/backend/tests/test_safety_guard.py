"""
AF-HUB-008 — coverage for the runtime SafetyGuard.

SafetyGuard is per-device runtime safety enforcement in the show output path (fire
max-on-duration cutoff + cooldown, and per-device intensity clamping). It is
safety-critical and had no direct test — these lock its behavior down.
"""
import time

from services.runtime_bridge import SafetyGuard, CompiledEvent


def _ev(device_id, value):
    return CompiledEvent(time=0.0, device_id=device_id, channel_id="intensity", value=value)


def test_no_limit_passes_through_unchanged():
    g = SafetyGuard()
    allowed, reason, ev = g.check(_ev("d1", 0.9))
    assert allowed is True
    assert reason == "no_limit"
    assert ev.value == 0.9


def test_intensity_is_clamped_to_the_ceiling():
    g = SafetyGuard()
    g.load_limits({"d1": {"max_intensity": 0.5}})
    allowed, reason, ev = g.check(_ev("d1", 0.9))
    assert allowed is True
    assert ev.value == 0.5  # clamped, not blocked
    assert reason == "ok"


def test_intensity_below_ceiling_is_untouched():
    g = SafetyGuard()
    g.load_limits({"d1": {"max_intensity": 0.8}})
    _, _, ev = g.check(_ev("d1", 0.3))
    assert ev.value == 0.3


def test_fire_device_max_on_forces_off_and_enters_cooldown():
    g = SafetyGuard()
    # max_on_duration_ms < 60s marks this as a duration-limited (fire) device.
    g.load_limits({"flame1": {"max_on_duration_ms": 2000, "min_off_duration_ms": 5000}})
    # Simulate the flame having been on longer than its max-on ceiling.
    g._on_time_start["flame1"] = time.monotonic() - 10.0

    allowed, reason, _ = g.check(_ev("flame1", 1.0))
    assert allowed is False
    assert "max_on_exceeded" in reason

    # Now in cooldown — a fresh command is still blocked.
    allowed2, reason2, _ = g.check(_ev("flame1", 1.0))
    assert allowed2 is False
    assert "cooldown" in reason2


def test_turning_a_fire_device_off_clears_its_on_timer():
    g = SafetyGuard()
    g.load_limits({"flame1": {"max_on_duration_ms": 2000}})
    g._on_time_start["flame1"] = time.monotonic()

    allowed, _, _ = g.check(_ev("flame1", 0.0))  # value <= 0.01 → off
    assert allowed is True
    assert "flame1" not in g._on_time_start


def test_status_reports_blocked_devices():
    g = SafetyGuard()
    g.load_limits({"flame1": {"max_on_duration_ms": 2000, "min_off_duration_ms": 5000}})
    g._on_time_start["flame1"] = time.monotonic() - 10.0
    g.check(_ev("flame1", 1.0))  # trip the cutoff → cooldown
    status = g.get_status()
    assert "flame1" in status
    assert status["flame1"]["blocked"] is True
