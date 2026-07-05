"""
Contract tests for Autonomous Show Adaptation (AQ-S5-003).

Asserts the three acceptance criteria:
  1. weather adaptation works, 2. crowd adaptation works, 3. event adaptation works,
  plus safety precedence (weather caps override crowd/event boosts).
"""
from services.show_adaptation import adapt, adapt_crowd, adapt_event, adapt_weather


# ── 1. weather ────────────────────────────────────────────────────────────────

def test_calm_weather_no_reduction():
    r = adapt({"weather": {"wind_speed": 2, "condition": "clear"}})
    assert r["modifications"]["jet_height_scale"] == 1.0
    assert r["safe"] is True


def test_high_wind_cuts_jets_and_trims_effects():
    r = adapt({"weather": {"wind_speed": 14, "condition": "clear"}})
    assert r["modifications"]["jet_height_scale"] == 0.4
    assert {"mist", "fine_jets"}.issubset(set(r["modifications"]["disabled_effects"]))
    assert r["weather"]["high_wind"] is True


def test_moderate_wind_trims_height():
    assert adapt({"weather": {"wind_speed": 9}})["modifications"]["jet_height_scale"] == 0.7


def test_rain_reduces_and_drops_fog():
    r = adapt({"weather": {"wind_speed": 2, "condition": "rain"}})
    assert r["modifications"]["intensity_scale"] < 1.0
    assert "fog" in r["modifications"]["disabled_effects"]


def test_storm_is_unsafe():
    r = adapt({"weather": {"wind_speed": 20, "condition": "storm"}})
    assert r["safe"] is False
    assert r["modifications"]["jet_height_scale"] <= 0.2


def test_night_boosts_lighting():
    r = adapt({"weather": {"wind_speed": 1, "ambient_lux": 3}})
    assert "lighting" in r["modifications"]["enabled_effects"]


# ── 2. crowd ──────────────────────────────────────────────────────────────────

def test_empty_crowd_eco():
    r = adapt({"crowd": {"level": 0.0}})
    assert r["crowd"]["mode"] == "eco"
    assert r["modifications"]["intensity_scale"] < 1.0


def test_packed_crowd_boost():
    r = adapt({"crowd": {"level": 1.0}})
    assert r["crowd"]["mode"] == "boost"
    assert r["modifications"]["intensity_scale"] > 1.0


def test_crowd_from_count_and_capacity():
    assert abs(adapt_crowd({"count": 250, "capacity": 500})["level"] - 0.5) < 1e-6
    assert adapt_crowd({"count": 900, "capacity": 500})["level"] == 1.0     # clamped


# ── 3. event ──────────────────────────────────────────────────────────────────

def test_quiet_hours_dims_and_disables():
    r = adapt({"event": {"type": "quiet_hours"}})
    assert r["event"]["intensity_scale"] == 0.5
    assert {"flame", "laser"}.issubset(set(r["modifications"]["disabled_effects"]))


def test_finale_boosts_and_enables():
    r = adapt({"event": {"type": "finale"}})
    assert r["modifications"]["intensity_scale"] > 1.0
    assert r["modifications"]["tempo_scale"] > 1.0
    assert {"flame", "laser", "fog"}.issubset(set(r["modifications"]["enabled_effects"]))


def test_unknown_event_is_normal():
    assert adapt_event({"type": "nope"})["intensity_scale"] == 1.0


# ── safety precedence ─────────────────────────────────────────────────────────

def test_weather_safety_beats_event_and_crowd():
    r = adapt({"weather": {"wind_speed": 15}, "event": {"type": "finale"}, "crowd": {"level": 1.0}})
    assert r["modifications"]["jet_height_scale"] == 0.4       # finale can't raise jets in high wind
    assert "flame" in r["modifications"]["disabled_effects"]   # and can't ignite flame
    assert "flame" not in r["modifications"]["enabled_effects"]
    assert r["modifications"]["intensity_scale"] <= 1.5        # capped


def test_default_context_is_neutral_and_safe():
    r = adapt({})
    assert r["safe"] is True
    assert r["modifications"]["jet_height_scale"] == 1.0
    assert abs(r["modifications"]["intensity_scale"] - 0.85) < 1e-6   # default crowd 0.5


def test_triggers_and_summary():
    r = adapt({"weather": {"wind_speed": 15}, "event": {"type": "finale"}, "crowd": {"level": 1.0}})
    assert {t["source"] for t in r["triggers"]} == {"weather", "crowd", "event"}
    assert "HIGH WIND" in r["summary"]
