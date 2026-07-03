"""
energy_model.py — AquaFlow Stage 2, Priority 13 (AQ-S2-013)

Energy consumption model for a fountain installation.

Given the electrical loads (pumps, lights, effects — each with a power rating and
an operating schedule) and an electricity tariff, this computes:

  * energy consumption (kWh) — daily, monthly, and annual,
  * annual operating cost — energy charge + demand charge + standing charge,
  * peak electrical demand (kW) — the maximum coincident load, from either an
    hourly load profile or a coincidence/simultaneity factor.

It plugs into the expanded fixture library (AQ-S2-011): each fixture's
`electrical.powerW` becomes a load via ``model_from_fixtures``.

Governing relations
--------------------
  * per-load daily energy: E = (P/1000) * hours * duty   [kWh]
    (or E = (P/1000) * Σ profile if an hourly profile is given)
  * annual energy: E_year = E_day * days_per_year
  * peak demand: D = max_h Σ_loads (P/1000 * coincidence_at_h) * simultaneity
  * annual cost: energy*rate + peak*demand_charge*12 + standing_charge
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

HOURS_PER_DAY = 24


@dataclass
class Load:
    id: str
    power_w: float
    hours_per_day: float = 0.0          # used when no hourly_profile is given
    days_per_year: int = 365
    duty_cycle: float = 1.0             # 0..1 average on-fraction while running
    category: str = ""
    peak_fraction: float = 1.0          # fraction of P drawn at the system peak
    hourly_profile: Optional[list] = None  # 24 fractions (0..1); overrides hours/peak

    def daily_kwh(self) -> float:
        kw = self.power_w / 1000.0
        if self.hourly_profile:
            return kw * sum(self.hourly_profile) * self.duty_cycle
        return kw * self.hours_per_day * self.duty_cycle

    def annual_kwh(self) -> float:
        return self.daily_kwh() * self.days_per_year

    def demand_at_hour(self, h: int) -> float:
        """Coincident demand (kW) this load contributes at hour h."""
        kw = self.power_w / 1000.0
        if self.hourly_profile:
            return kw * self.hourly_profile[h % HOURS_PER_DAY]
        # No profile → assume it can be coincident at the system peak at
        # peak_fraction throughout the day.
        return kw * self.peak_fraction


@dataclass
class Tariff:
    energy_rate: float = 0.15                # $/kWh
    demand_charge: float = 0.0               # $/kW/month (billed on peak demand)
    standing_charge_per_year: float = 0.0    # fixed annual charge
    currency: str = "USD"
    co2_factor_kg_per_kwh: float = 0.40      # grid emission factor


class EnergyModel:
    def __init__(self, tariff: Optional[Tariff] = None, simultaneity_factor: float = 1.0):
        self.tariff = tariff or Tariff()
        self.simultaneity_factor = max(0.0, min(1.0, float(simultaneity_factor)))
        self.loads: list[Load] = []

    def add_load(self, load: Load) -> "EnergyModel":
        self.loads.append(load)
        return self

    # ── Core quantities ────────────────────────────────────────────────────────
    def annual_kwh(self) -> float:
        return sum(l.annual_kwh() for l in self.loads)

    def daily_kwh(self) -> float:
        return sum(l.daily_kwh() for l in self.loads)

    def connected_load_kw(self) -> float:
        """Total installed capacity (all loads at full power)."""
        return sum(l.power_w for l in self.loads) / 1000.0

    def peak_demand_kw(self) -> float:
        """Maximum coincident demand across the 24-hour day."""
        if not self.loads:
            return 0.0
        peak = max(
            sum(l.demand_at_hour(h) for l in self.loads)
            for h in range(HOURS_PER_DAY)
        )
        return peak * self.simultaneity_factor

    # ── Costs ───────────────────────────────────────────────────────────────────
    def annual_energy_cost(self) -> float:
        return self.annual_kwh() * self.tariff.energy_rate

    def annual_demand_cost(self) -> float:
        return self.peak_demand_kw() * self.tariff.demand_charge * 12.0

    def annual_operating_cost(self) -> float:
        return (self.annual_energy_cost()
                + self.annual_demand_cost()
                + self.tariff.standing_charge_per_year)

    def annual_co2_tonnes(self) -> float:
        return self.annual_kwh() * self.tariff.co2_factor_kg_per_kwh / 1000.0

    # ── Reporting ────────────────────────────────────────────────────────────────
    def per_load(self) -> list[dict]:
        rate = self.tariff.energy_rate
        out = []
        for l in self.loads:
            akwh = l.annual_kwh()
            out.append({
                "id": l.id,
                "category": l.category,
                "power_kw": round(l.power_w / 1000.0, 4),
                "annual_kwh": round(akwh, 2),
                "annual_energy_cost": round(akwh * rate, 2),
                "peak_contribution_kw": round(max(
                    (l.demand_at_hour(h) for h in range(HOURS_PER_DAY)), default=0.0), 4),
            })
        return out

    def summary(self) -> dict:
        annual_kwh = self.annual_kwh()
        peak = self.peak_demand_kw()
        connected = self.connected_load_kw()
        return {
            "currency": self.tariff.currency,
            "connected_load_kw": round(connected, 3),
            "peak_demand_kw": round(peak, 3),
            "load_factor": round(annual_kwh / (peak * 8760), 4) if peak > 0 else 0.0,
            "diversity_factor": round(connected / peak, 4) if peak > 0 else 0.0,
            "daily_kwh": round(self.daily_kwh(), 3),
            "monthly_kwh": round(annual_kwh / 12.0, 2),
            "annual_kwh": round(annual_kwh, 2),
            "annual_energy_cost": round(self.annual_energy_cost(), 2),
            "annual_demand_cost": round(self.annual_demand_cost(), 2),
            "annual_standing_charge": round(self.tariff.standing_charge_per_year, 2),
            "annual_operating_cost": round(self.annual_operating_cost(), 2),
            "annual_co2_tonnes": round(self.annual_co2_tonnes(), 3),
            "tariff": {
                "energy_rate": self.tariff.energy_rate,
                "demand_charge": self.tariff.demand_charge,
                "standing_charge_per_year": self.tariff.standing_charge_per_year,
            },
        }


# ── Dict / fixture-library convenience APIs ────────────────────────────────────
def _tariff_from(payload: dict) -> Tariff:
    t = payload.get("tariff", {}) or {}
    return Tariff(
        energy_rate=float(t.get("energy_rate", 0.15)),
        demand_charge=float(t.get("demand_charge", 0.0)),
        standing_charge_per_year=float(t.get("standing_charge_per_year", 0.0)),
        currency=str(t.get("currency", "USD")),
        co2_factor_kg_per_kwh=float(t.get("co2_factor_kg_per_kwh", 0.40)),
    )


def _load_from_dict(d: dict, defaults: dict) -> Load:
    return Load(
        id=str(d.get("id", d.get("key", "load"))),
        power_w=float(d.get("power_w", d.get("powerW", 0.0)) or 0.0),
        hours_per_day=float(d.get("hours_per_day", defaults.get("hours_per_day", 0.0))),
        days_per_year=int(d.get("days_per_year", defaults.get("days_per_year", 365))),
        duty_cycle=float(d.get("duty_cycle", defaults.get("duty_cycle", 1.0))),
        category=str(d.get("category", "")),
        peak_fraction=float(d.get("peak_fraction", 1.0)),
        hourly_profile=d.get("hourly_profile"),
    )


def model_energy(payload: dict) -> dict:
    """
    Build and evaluate an energy model from a dict.

    payload = {
      "loads": [{"id","power_w","hours_per_day","days_per_year","duty_cycle",
                 "peak_fraction","hourly_profile","category"}, ...],
      "defaults": {"hours_per_day": 8, "days_per_year": 365, "duty_cycle": 1.0},
      "simultaneity_factor": 1.0,
      "tariff": {"energy_rate","demand_charge","standing_charge_per_year",
                 "currency","co2_factor_kg_per_kwh"}
    }
    """
    defaults = payload.get("defaults", {}) or {}
    model = EnergyModel(tariff=_tariff_from(payload),
                        simultaneity_factor=float(payload.get("simultaneity_factor", 1.0)))
    for d in payload.get("loads", []):
        model.add_load(_load_from_dict(d, defaults))
    return {"summary": model.summary(), "loads": model.per_load()}


def model_from_fixtures(fixtures: list, payload: Optional[dict] = None) -> dict:
    """
    Build an energy model from fixture-library entries carrying `electrical.powerW`
    (AQ-S2-011). Each fixture's operating schedule may be supplied per-fixture or
    via `payload["defaults"]`.
    """
    payload = payload or {}
    defaults = payload.get("defaults", {"hours_per_day": 8, "days_per_year": 365, "duty_cycle": 1.0})
    model = EnergyModel(tariff=_tariff_from(payload),
                        simultaneity_factor=float(payload.get("simultaneity_factor", 1.0)))
    for fx in fixtures or []:
        elec = (fx.get("electrical") or {})
        power = float(elec.get("powerW", 0.0) or 0.0)
        model.add_load(Load(
            id=str(fx.get("key") or fx.get("id") or "fixture"),
            power_w=power,
            hours_per_day=float(fx.get("hours_per_day", defaults.get("hours_per_day", 8))),
            days_per_year=int(fx.get("days_per_year", defaults.get("days_per_year", 365))),
            duty_cycle=float(fx.get("duty_cycle", defaults.get("duty_cycle", 1.0))),
            category=str(fx.get("category", "")),
            peak_fraction=float(fx.get("peak_fraction", 1.0)),
            hourly_profile=fx.get("hourly_profile"),
        ))
    return {"summary": model.summary(), "loads": model.per_load()}
