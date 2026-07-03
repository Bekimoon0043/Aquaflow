"""
Contract tests for the energy consumption model (AQ-S2-013).

Asserts kWh, annual operating cost, and peak demand are computed correctly,
including coincident vs non-coincident load profiles.
"""
from services.energy_model import EnergyModel, Load, Tariff, model_energy, model_from_fixtures


def test_kwh_daily_and_annual():
    m = EnergyModel().add_load(Load("p", power_w=10000, hours_per_day=10, days_per_year=365))
    assert abs(m.daily_kwh() - 100.0) < 1e-9
    assert abs(m.annual_kwh() - 36500.0) < 1e-9


def test_duty_cycle_and_profile_energy():
    assert abs(EnergyModel().add_load(
        Load("l", power_w=10000, hours_per_day=10, duty_cycle=0.5)).daily_kwh() - 50.0) < 1e-9
    prof = [0] * 24
    for h in range(18, 23):
        prof[h] = 1.0
    assert abs(EnergyModel().add_load(
        Load("x", power_w=4000, hourly_profile=prof)).daily_kwh() - 20.0) < 1e-9


def test_annual_operating_cost():
    m = EnergyModel(Tariff(energy_rate=0.15, demand_charge=12.0, standing_charge_per_year=500.0))
    m.add_load(Load("p", power_w=10000, hours_per_day=10, peak_fraction=1.0))
    assert abs(m.annual_energy_cost() - 5475.0) < 1e-6
    assert abs(m.annual_demand_cost() - 1440.0) < 1e-6
    assert abs(m.annual_operating_cost() - 7415.0) < 1e-6


def test_co2():
    m = EnergyModel(Tariff(co2_factor_kg_per_kwh=0.4))
    m.add_load(Load("p", power_w=10000, hours_per_day=10))
    assert abs(m.annual_co2_tonnes() - 14.6) < 1e-6


def test_peak_coincident_sum():
    m = EnergyModel()
    m.add_load(Load("a", power_w=10000, hours_per_day=10, peak_fraction=1.0))
    m.add_load(Load("b", power_w=5000, hours_per_day=6, peak_fraction=1.0))
    assert abs(m.peak_demand_kw() - 15.0) < 1e-9
    m.simultaneity_factor = 0.8
    assert abs(m.peak_demand_kw() - 12.0) < 1e-9


def test_peak_non_coincident_profiles():
    a = [0] * 24; a[10] = 1.0
    b = [0] * 24; b[20] = 1.0
    m = EnergyModel()
    m.add_load(Load("a", power_w=10000, hourly_profile=a))
    m.add_load(Load("b", power_w=5000, hourly_profile=b))
    assert abs(m.peak_demand_kw() - 10.0) < 1e-9   # max, not sum
    assert abs(m.connected_load_kw() - 15.0) < 1e-9


def test_dict_api_summary():
    out = model_energy({
        "loads": [{"id": "p", "power_w": 10000, "hours_per_day": 10}],
        "tariff": {"energy_rate": 0.15, "demand_charge": 12.0},
    })
    s = out["summary"]
    assert abs(s["annual_kwh"] - 36500.0) < 1e-6
    assert s["peak_demand_kw"] == 10.0
    assert abs(s["annual_operating_cost"] - 6915.0) < 1e-6


def test_from_fixtures_uses_electrical_power():
    fixtures = [{"key": "l1", "electrical": {"powerW": 100}},
                {"key": "l2", "electrical": {"powerW": 100}}]
    out = model_from_fixtures(fixtures, {"defaults": {"hours_per_day": 5}, "tariff": {"energy_rate": 0.20}})
    assert abs(out["summary"]["annual_kwh"] - 365.0) < 1e-6
    assert abs(out["summary"]["peak_demand_kw"] - 0.2) < 1e-9
