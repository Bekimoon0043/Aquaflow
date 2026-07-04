"""
validate_weather_engine.py — AquaFlow Stage 3, Priority 5 (AQ-S3-005)

Proves the three acceptance criteria for the weather simulation engine:
  1. Wind simulated (wind vector + jet drift + splash radius).
  2. Evaporation estimated (mass-transfer Θ model, L/day).
  3. Visibility impact calculated (Koschmieder visual range + show clarity).

Each figure is cross-checked against an independent hand calculation. No server.
Exit code 0 = all pass.

Run:  python validate_weather_engine.py
"""
import math
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.weather_engine import (
    WeatherConditions, wind_vector, jet_time_of_flight, wind_drift, simulate_wind,
    saturation_vapor_pressure_kpa, humidity_ratio, evaporation_rate_kg_per_h,
    estimate_evaporation, extinction_coefficient, meteorological_visibility_km,
    visibility_impact, simulate_weather, GRAVITY, KOSCHMIEDER,
)

PASS, FAIL = "PASS", "FAIL"
results = []


def check(name, ok, detail=""):
    results.append((name, PASS if ok else FAIL, detail))


# ── Criterion 1: wind simulated ────────────────────────────────────────────────
def test_wind():
    # Wind FROM north (0°) blows TO south → north component negative, east ~0.
    n = wind_vector(10, 0)
    check("Wind: 'from north' blows south (−north, ~0 east)",
          n["north"] < -9.9 and abs(n["east"]) < 1e-6, f"{n}")
    e = wind_vector(10, 90)   # from east → blows west → east component negative
    check("Wind: 'from east' blows west (−east)", e["east"] < -9.9, f"{e}")

    # Time of flight for a 5 m jet = 2*sqrt(2h/g).
    t = jet_time_of_flight(5)
    check("Wind: jet time-of-flight matches 2·√(2h/g)",
          abs(t - 2 * math.sqrt(2 * 5 / GRAVITY)) < 1e-9, f"t={t:.4f}")

    # Drift = coupling·wind·t. For h=5, wind=5, coupling=0.5.
    d = wind_drift(5, 5, coupling=0.5)
    check("Wind: drift = coupling·wind·time-of-flight",
          abs(d - 0.5 * 5 * t) < 1e-9, f"drift={d:.4f}")

    sim = simulate_wind(WeatherConditions(wind_speed=5, wind_direction=90), jet_height_m=5,
                        base_splash_radius_m=0.5)
    check("Wind: splash radius grows with drift", sim["splash_radius_m"] > 0.5, f"{sim['splash_radius_m']}")
    check("Wind: gust drift exceeds mean drift", sim["gust_drift_m"] > sim["drift_m"], "")
    check("Wind: landing offset points downwind (west → −east)",
          sim["landing_offset"]["east"] < 0, f"{sim['landing_offset']}")
    check("Wind: high wind triggers an advisory",
          "High wind" in simulate_wind(WeatherConditions(wind_speed=15), 5)["wind_advisory"], "")


# ── Criterion 2: evaporation estimated ─────────────────────────────────────────
def test_evaporation():
    # Saturation vapour pressure at 20°C ≈ 2.338 kPa (Tetens).
    check("Evap: p_ws(20°C) ≈ 2.34 kPa",
          abs(saturation_vapor_pressure_kpa(20) - 2.338) < 0.02,
          f"{saturation_vapor_pressure_kpa(20):.4f}")

    # Hand calc: pool 50 m², 20°C water & air, 50% RH, wind 2 m/s.
    cond = WeatherConditions(wind_speed=2, temperature_c=20, humidity_pct=50)
    theta = 25 + 19 * 2
    x_s = humidity_ratio(20, 100)
    x_air = humidity_ratio(20, 50)
    expected = theta * 50 * (x_s - x_air)
    got = evaporation_rate_kg_per_h(50, cond)
    check("Evap: rate matches Θ·A·(x_s−x_air) hand calc",
          abs(got - expected) < 1e-6, f"got={got:.4f} exp={expected:.4f}")
    check("Evap: rate is physically plausible (~0.3–0.6 kg/m²/h)",
          0.2 < got / 50 < 0.8, f"per_m2={got/50:.4f}")

    # More wind and drier air → more evaporation.
    windy = evaporation_rate_kg_per_h(50, WeatherConditions(wind_speed=8, temperature_c=20, humidity_pct=50))
    dry = evaporation_rate_kg_per_h(50, WeatherConditions(wind_speed=2, temperature_c=20, humidity_pct=20))
    check("Evap: higher wind increases evaporation", windy > got, f"windy={windy:.3f} base={got:.3f}")
    check("Evap: drier air increases evaporation", dry > got, f"dry={dry:.3f} base={got:.3f}")

    # 100% humidity, equal temps → ~zero evaporation.
    sat = evaporation_rate_kg_per_h(50, WeatherConditions(wind_speed=2, temperature_c=20, humidity_pct=100))
    check("Evap: saturated air → ~zero evaporation", sat < 1e-6, f"{sat}")

    ev = estimate_evaporation(50, cond)
    check("Evap: L/day = kg/h·24 and mm/day = L/m²/day",
          abs(ev["l_per_day"] - got * 24) < 0.5 and abs(ev["mm_per_day"] - ev["l_per_m2_per_day"]) < 1e-9,
          f"{ev}")


# ── Criterion 3: visibility impact ─────────────────────────────────────────────
def test_visibility():
    fog = WeatherConditions(condition="fog", humidity_pct=95)
    clear = WeatherConditions(condition="clear", humidity_pct=40)

    # Koschmieder: V = 3.912 / beta. Fog beta≈20 (+humidity) → V < 0.25 km.
    vfog = meteorological_visibility_km(fog)
    check("Vis: fog gives short visual range (<0.3 km)", vfog < 0.3, f"{vfog:.3f} km")
    vclear = meteorological_visibility_km(clear)
    check("Vis: clear air gives long visual range (>10 km)", vclear > 10, f"{vclear:.3f} km")
    check("Vis: V = 3.912/β identity holds",
          abs(vclear - min(50, KOSCHMIEDER / extinction_coefficient(clear))) < 1e-9, "")

    # Show clarity: clear night = excellent, fog = poor.
    clarity_clear = visibility_impact(clear, spray_density=0.2, viewing_distance_m=80, night=True)
    clarity_fog = visibility_impact(fog, spray_density=0.2, viewing_distance_m=80, night=True)
    check("Vis: clear night → high show clarity", clarity_clear["show_clarity_pct"] >= 85,
          f"{clarity_clear['show_clarity_pct']}")
    check("Vis: fog → poor show clarity", clarity_fog["show_clarity_pct"] < 40,
          f"{clarity_fog['show_clarity_pct']}")
    check("Vis: ratings assigned (excellent vs poor)",
          clarity_clear["rating"] == "excellent" and clarity_fog["rating"] == "poor", "")
    check("Vis: heavier spray lowers clarity",
          visibility_impact(clear, spray_density=0.9)["show_clarity_pct"]
          < visibility_impact(clear, spray_density=0.0)["show_clarity_pct"], "")


# ── Aggregate ──────────────────────────────────────────────────────────────────
def test_aggregate():
    rep = simulate_weather(WeatherConditions(wind_speed=3, wind_direction=90, condition="clear",
                                             humidity_pct=45, temperature_c=22),
                           jet_height_m=5, pool_area_m2=60, spray_density=0.3, night=True)
    check("Aggregate: report has wind + evaporation + visibility",
          "wind" in rep and "evaporation" in rep and "visibility" in rep, "")
    check("Aggregate: good conditions marked suitable", rep["show_suitability"]["suitable"] is True,
          f"{rep['show_suitability']}")
    bad = simulate_weather(WeatherConditions(wind_speed=15, condition="fog", humidity_pct=98))
    check("Aggregate: high wind + fog flagged unsuitable", bad["show_suitability"]["suitable"] is False,
          f"{bad['show_suitability']}")


def main() -> int:
    for fn in (test_wind, test_evaporation, test_visibility, test_aggregate):
        fn()
    print("\n" + "=" * 72)
    print("AQ-S3-005 Weather Simulation Engine — Verification")
    print("=" * 72)
    passed = 0
    for name, status, detail in results:
        mark = "[PASS]" if status == PASS else "[FAIL]"
        line = f"{mark} {name}"
        if status == FAIL and detail:
            line += f"  --> {detail}"
        print(line)
        if status == PASS:
            passed += 1
    print("-" * 72)
    print(f"{passed}/{len(results)} checks passed")
    print("=" * 72)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
