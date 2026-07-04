"""
Contract tests for the weather simulation engine (AQ-S3-005).

Asserts wind is simulated (vector + drift + splash), evaporation is estimated
(Θ mass-transfer), and visibility impact is calculated (Koschmieder + clarity).
"""
import math

from services.weather_engine import (
    WeatherConditions, wind_vector, jet_time_of_flight, wind_drift, simulate_wind,
    saturation_vapor_pressure_kpa, humidity_ratio, evaporation_rate_kg_per_h,
    estimate_evaporation, meteorological_visibility_km, visibility_impact,
    simulate_weather, simulate_weather_dict, GRAVITY,
)


def test_wind_vector_direction():
    assert wind_vector(10, 0)["north"] < -9.9     # from N → blows S
    assert wind_vector(10, 90)["east"] < -9.9      # from E → blows W


def test_wind_drift_matches_model():
    t = jet_time_of_flight(5)
    assert abs(t - 2 * math.sqrt(2 * 5 / GRAVITY)) < 1e-9
    assert abs(wind_drift(5, 5, coupling=0.5) - 0.5 * 5 * t) < 1e-9


def test_wind_splash_and_gust():
    sim = simulate_wind(WeatherConditions(wind_speed=5, wind_direction=90), 5, base_splash_radius_m=0.5)
    assert sim["splash_radius_m"] > 0.5
    assert sim["gust_drift_m"] > sim["drift_m"]
    assert sim["landing_offset"]["east"] < 0     # downwind = west


def test_saturation_pressure():
    assert abs(saturation_vapor_pressure_kpa(20) - 2.338) < 0.02


def test_evaporation_hand_calc():
    cond = WeatherConditions(wind_speed=2, temperature_c=20, humidity_pct=50)
    expected = (25 + 19 * 2) * 50 * (humidity_ratio(20, 100) - humidity_ratio(20, 50))
    assert abs(evaporation_rate_kg_per_h(50, cond) - expected) < 1e-6


def test_evaporation_monotonic():
    base = evaporation_rate_kg_per_h(50, WeatherConditions(wind_speed=2, temperature_c=20, humidity_pct=50))
    windy = evaporation_rate_kg_per_h(50, WeatherConditions(wind_speed=8, temperature_c=20, humidity_pct=50))
    dry = evaporation_rate_kg_per_h(50, WeatherConditions(wind_speed=2, temperature_c=20, humidity_pct=20))
    sat = evaporation_rate_kg_per_h(50, WeatherConditions(wind_speed=2, temperature_c=20, humidity_pct=100))
    assert windy > base and dry > base and sat < 1e-6


def test_evaporation_units():
    ev = estimate_evaporation(50, WeatherConditions(wind_speed=2, temperature_c=20, humidity_pct=50))
    assert ev["l_per_day"] > 0
    assert abs(ev["mm_per_day"] - ev["l_per_m2_per_day"]) < 1e-9


def test_visibility_koschmieder():
    assert meteorological_visibility_km(WeatherConditions(condition="fog", humidity_pct=95)) < 0.3
    assert meteorological_visibility_km(WeatherConditions(condition="clear", humidity_pct=40)) > 10


def test_show_clarity_ratings():
    clear = visibility_impact(WeatherConditions(condition="clear", humidity_pct=40), spray_density=0.2, night=True)
    fog = visibility_impact(WeatherConditions(condition="fog", humidity_pct=95), spray_density=0.2, night=True)
    assert clear["rating"] == "excellent" and clear["show_clarity_pct"] >= 85
    assert fog["rating"] == "poor" and fog["show_clarity_pct"] < 40


def test_aggregate_and_suitability():
    good = simulate_weather(WeatherConditions(wind_speed=3, condition="clear", humidity_pct=45))
    bad = simulate_weather(WeatherConditions(wind_speed=15, condition="fog", humidity_pct=98))
    assert good["show_suitability"]["suitable"] is True
    assert bad["show_suitability"]["suitable"] is False


def test_dict_api():
    out = simulate_weather_dict({
        "conditions": {"wind_speed": 4, "wind_direction": 270, "condition": "clear", "humidity_pct": 50},
        "jet_height_m": 6, "pool_area_m2": 40, "spray_density": 0.3, "night": True,
    })
    assert "wind" in out and "evaporation" in out and "visibility" in out
    assert out["evaporation"]["l_per_day"] > 0
