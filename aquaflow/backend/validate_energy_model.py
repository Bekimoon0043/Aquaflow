"""
validate_energy_model.py — AquaFlow Stage 2, Priority 13 (AQ-S2-013)

Proves the three acceptance criteria for the energy consumption model:
  1. kWh calculated (daily / annual energy).
  2. Annual operating cost generated (energy + demand + standing charges).
  3. Peak demand calculated (max coincident load, incl. hourly profiles).

Each result is cross-checked against an independent hand calculation. No server.
Exit code 0 = all pass.

Run:  python validate_energy_model.py
"""
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.energy_model import EnergyModel, Load, Tariff, model_energy, model_from_fixtures

PASS, FAIL = "PASS", "FAIL"
results = []


def check(name, ok, detail=""):
    results.append((name, PASS if ok else FAIL, detail))


# ── Criterion 1: kWh calculated ────────────────────────────────────────────────
def test_kwh():
    m = EnergyModel(Tariff(energy_rate=0.15))
    m.add_load(Load("pump", power_w=10000, hours_per_day=10, days_per_year=365))
    # 10 kW * 10 h = 100 kWh/day; * 365 = 36500 kWh/yr.
    check("kWh: daily energy = P*hours (100 kWh)", abs(m.daily_kwh() - 100.0) < 1e-9,
          f"daily={m.daily_kwh()}")
    check("kWh: annual energy (36500 kWh)", abs(m.annual_kwh() - 36500.0) < 1e-9,
          f"annual={m.annual_kwh()}")

    # Duty cycle scales energy.
    m2 = EnergyModel()
    m2.add_load(Load("l", power_w=10000, hours_per_day=10, duty_cycle=0.5))
    check("kWh: duty cycle scales energy (50 kWh/day)", abs(m2.daily_kwh() - 50.0) < 1e-9,
          f"daily={m2.daily_kwh()}")

    # Hourly profile energy = P * sum(profile).
    prof = [0] * 24
    for h in range(18, 23):
        prof[h] = 1.0            # on 18:00–23:00 → 5 h
    m3 = EnergyModel()
    m3.add_load(Load("lights", power_w=4000, hourly_profile=prof))
    check("kWh: hourly-profile energy (4 kW * 5 h = 20 kWh/day)",
          abs(m3.daily_kwh() - 20.0) < 1e-9, f"daily={m3.daily_kwh()}")


# ── Criterion 2: annual operating cost ─────────────────────────────────────────
def test_annual_cost():
    tariff = Tariff(energy_rate=0.15, demand_charge=12.0, standing_charge_per_year=500.0)
    m = EnergyModel(tariff)
    m.add_load(Load("pump", power_w=10000, hours_per_day=10, days_per_year=365, peak_fraction=1.0))

    energy_cost = 36500 * 0.15                # 5475
    demand_cost = 10.0 * 12.0 * 12.0          # peak 10 kW * $12/kW/mo * 12 = 1440
    total = energy_cost + demand_cost + 500.0  # 7415
    check("Cost: annual energy cost (36500 kWh * $0.15 = $5475)",
          abs(m.annual_energy_cost() - energy_cost) < 1e-6, f"e={m.annual_energy_cost()}")
    check("Cost: annual demand cost (10 kW * $12 * 12 = $1440)",
          abs(m.annual_demand_cost() - demand_cost) < 1e-6, f"d={m.annual_demand_cost()}")
    check("Cost: annual operating cost = energy + demand + standing ($7415)",
          abs(m.annual_operating_cost() - total) < 1e-6, f"total={m.annual_operating_cost()}")

    # CO2 emissions.
    check("Cost: annual CO2 (36500 kWh * 0.4 kg = 14.6 t)",
          abs(m.annual_co2_tonnes() - 14.6) < 1e-6, f"co2={m.annual_co2_tonnes()}")


# ── Criterion 3: peak demand ───────────────────────────────────────────────────
def test_peak_demand():
    # Two coincident loads: 10 kW + 5 kW = 15 kW peak.
    m = EnergyModel()
    m.add_load(Load("pump", power_w=10000, hours_per_day=10, peak_fraction=1.0))
    m.add_load(Load("lights", power_w=5000, hours_per_day=6, peak_fraction=1.0))
    check("Peak: coincident loads sum (10 + 5 = 15 kW)", abs(m.peak_demand_kw() - 15.0) < 1e-9,
          f"peak={m.peak_demand_kw()}")

    # Simultaneity factor derates the peak.
    m.simultaneity_factor = 0.8
    check("Peak: simultaneity factor applied (15 * 0.8 = 12 kW)",
          abs(m.peak_demand_kw() - 12.0) < 1e-9, f"peak={m.peak_demand_kw()}")

    # Non-coincident profiles: peaks at different hours → peak is the larger, not the sum.
    a = [0] * 24; a[10] = 1.0     # pump runs at 10:00
    b = [0] * 24; b[20] = 1.0     # lights run at 20:00
    m2 = EnergyModel()
    m2.add_load(Load("pump", power_w=10000, hourly_profile=a))
    m2.add_load(Load("lights", power_w=5000, hourly_profile=b))
    check("Peak: non-coincident profiles → max not sum (10 kW)",
          abs(m2.peak_demand_kw() - 10.0) < 1e-9, f"peak={m2.peak_demand_kw()}")

    # Overlapping profiles → coincident sum at the overlap hour.
    c = [0] * 24; c[20] = 1.0
    m3 = EnergyModel()
    m3.add_load(Load("pump", power_w=10000, hourly_profile=c))
    m3.add_load(Load("lights", power_w=5000, hourly_profile=c))
    check("Peak: overlapping profiles coincide (15 kW at 20:00)",
          abs(m3.peak_demand_kw() - 15.0) < 1e-9, f"peak={m3.peak_demand_kw()}")

    check("Peak: connected load = sum of all ratings (15 kW)",
          abs(m3.connected_load_kw() - 15.0) < 1e-9, f"conn={m3.connected_load_kw()}")


# ── Integration: dict API + fixtures ───────────────────────────────────────────
def test_dict_and_fixtures():
    out = model_energy({
        "loads": [{"id": "p", "power_w": 10000, "hours_per_day": 10}],
        "tariff": {"energy_rate": 0.15, "demand_charge": 12.0},
    })
    s = out["summary"]
    check("API: summary reports kWh, cost, and peak",
          abs(s["annual_kwh"] - 36500.0) < 1e-6
          and s["peak_demand_kw"] == 10.0
          and abs(s["annual_operating_cost"] - (5475 + 1440)) < 1e-6, f"{s}")
    check("API: per-load breakdown present", len(out["loads"]) == 1
          and out["loads"][0]["annual_kwh"] == 36500.0, f"{out['loads']}")

    # From fixture-library entries (electrical.powerW).
    fixtures = [
        {"key": "light1", "category": "Lights", "electrical": {"powerW": 100}},
        {"key": "light2", "category": "Lights", "electrical": {"powerW": 100}},
    ]
    fo = model_from_fixtures(fixtures, {"defaults": {"hours_per_day": 5, "days_per_year": 365},
                                        "tariff": {"energy_rate": 0.20}})
    # 2 * 0.1 kW * 5 h * 365 = 365 kWh; cost = 365*0.2 = 73.
    check("Fixtures: energy pulled from electrical.powerW (365 kWh)",
          abs(fo["summary"]["annual_kwh"] - 365.0) < 1e-6, f"{fo['summary']}")
    check("Fixtures: peak demand from fixtures (0.2 kW)",
          abs(fo["summary"]["peak_demand_kw"] - 0.2) < 1e-9, f"{fo['summary']}")


def main() -> int:
    for fn in (test_kwh, test_annual_cost, test_peak_demand, test_dict_and_fixtures):
        fn()

    print("\n" + "=" * 72)
    print("AQ-S2-013 Energy Consumption Modelling — Verification")
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
