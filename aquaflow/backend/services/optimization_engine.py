"""
optimization_engine.py — AquaFlow Stage 5, AQ-S5-002

AI Optimization Engine: analyses a fountain design/show and recommends changes that
cut energy and water use while preserving (or improving) visual performance.

Each optimiser is grounded in real physics so the savings are concrete and checkable:

  * energy optimised — pump power follows the affinity laws (P ∝ N³), so trimming a
    pump's speed to the flow actually needed yields large savings; incandescent →
    LED and off-peak scheduling add more,
  * water optimised — an open (non-recirculating) design wastes all the pumped water;
    recirculation cuts makeup to just evaporation + wind drift, and reducing tall jets
    in wind trims overspray,
  * performance optimised — trims low-impact / high-flow jets (low impact-per-flow) to
    raise the show's visual efficiency, and caps the output frame rate to the 44 Hz
    Art-Net ceiling.

Pure and deterministic (operates on a design dict) so it is fully unit-tested.
"""
from __future__ import annotations

from statistics import median
from typing import Optional


# ── Energy ──────────────────────────────────────────────────────────────────────

def optimize_energy(design: dict) -> dict:
    tariff = design.get("tariff", {}) or {}
    rate = float(tariff.get("energy_rate", 0.15))       # currency / kWh
    recs = []
    base_kwh = 0.0
    opt_kwh = 0.0

    for p in design.get("pumps", []):
        rated = float(p.get("power_w", 0))              # power at full speed (s=1)
        s0 = float(p.get("speed", 1.0))
        req = float(p.get("required_flow_fraction", s0))
        hpd = float(p.get("hours_per_day", 8))
        cur_w = rated * s0 ** 3
        opt_speed = min(s0, max(0.0, req))
        opt_w = rated * opt_speed ** 3
        base_kwh += cur_w / 1000.0 * hpd
        opt_kwh += opt_w / 1000.0 * hpd
        if opt_speed < s0 - 1e-9:
            saved = (cur_w - opt_w) / 1000.0 * hpd
            recs.append({"category": "energy", "action": f"Reduce pump {p.get('id','?')} speed "
                         f"{s0:.0%}→{opt_speed:.0%} to match demand (affinity law P∝N³)",
                         "saving_kwh_day": round(saved, 2)})

    for l in design.get("lights", []):
        rated = float(l.get("power_w", 0))
        hpd = float(l.get("hours_per_day", 6))
        base_kwh += rated / 1000.0 * hpd
        if str(l.get("type", "")).lower() in ("incandescent", "halogen"):
            opt_w = rated * 0.2                          # LED ≈ 20% of incandescent power
            opt_kwh += opt_w / 1000.0 * hpd
            recs.append({"category": "energy", "action": f"Replace {l.get('id','?')} incandescent "
                         "with LED (~80% less power)",
                         "saving_kwh_day": round((rated - opt_w) / 1000.0 * hpd, 2)})
        else:
            opt_kwh += rated / 1000.0 * hpd

    if tariff.get("peak_rate") and tariff.get("off_peak_rate"):
        recs.append({"category": "energy", "action": "Schedule non-essential runtime off-peak "
                     f"({tariff['off_peak_rate']} vs {tariff['peak_rate']} /kWh)"})

    saved = base_kwh - opt_kwh
    return {
        "baseline_kwh_day": round(base_kwh, 3),
        "optimized_kwh_day": round(opt_kwh, 3),
        "savings_kwh_day": round(saved, 3),
        "savings_percent": round(saved / base_kwh * 100, 1) if base_kwh > 0 else 0.0,
        "cost_saving_per_day": round(saved * rate, 2),
        "recommendations": recs,
    }


# ── Water ───────────────────────────────────────────────────────────────────────

def optimize_water(design: dict) -> dict:
    pool = design.get("pool", {}) or {}
    jets = design.get("jets", [])
    weather = design.get("weather", {}) or {}
    recirc = bool(design.get("recirculation", False))
    hpd = float(design.get("operating_hours_per_day", 8))
    water_rate = float((design.get("tariff", {}) or {}).get("water_rate", 0.002))  # /L

    jet_flow_lps = sum(float(j.get("flow_lps", 0)) for j in jets)
    jet_flow_lpd = jet_flow_lps * 3600.0 * hpd
    evap = float(pool.get("evaporation_lpd", pool.get("surface_area_m2", 0) * 4.0))  # ~4 mm/day
    wind = float(weather.get("wind_speed", 0))
    tall = sum(1 for j in jets if float(j.get("height_m", 0)) > 3)
    drift_frac = min(0.15, 0.01 * wind * (1 + tall * 0.1))

    recs = []
    if not recirc:
        baseline = jet_flow_lpd + evap
        optimized = evap + jet_flow_lpd * 0.02          # recirc: makeup ≈ evap + small loss
        if jet_flow_lpd > 0:                             # nothing to recirculate on an empty design
            recs.append({"category": "water", "action": "Enable recirculation — reuse pumped water; "
                         "makeup only replaces evaporation + drift", "saving_l_day": round(baseline - optimized, 1)})
    else:
        drift = jet_flow_lpd * drift_frac
        baseline = evap + drift
        optimized = evap * 0.9 + drift * 0.5
        if wind >= 8 and tall:
            recs.append({"category": "water", "action": f"Reduce tall-jet heights in {wind:.0f} m/s "
                         "wind to cut overspray/drift", "saving_l_day": round(drift * 0.5, 1)})
        recs.append({"category": "water", "action": "Run during low-evaporation hours (cooler, "
                     "less wind) to reduce loss", "saving_l_day": round(evap * 0.1, 1)})

    saved = baseline - optimized
    return {
        "baseline_l_day": round(baseline, 1),
        "optimized_l_day": round(optimized, 1),
        "savings_l_day": round(saved, 1),
        "savings_percent": round(saved / baseline * 100, 1) if baseline > 0 else 0.0,
        "cost_saving_per_day": round(saved * water_rate, 2),
        "recirculation_enabled": recirc,
        "recommendations": recs,
    }


# ── Performance ─────────────────────────────────────────────────────────────────

def optimize_performance(design: dict) -> dict:
    jets = design.get("jets", [])
    recs = []
    total_impact = sum(float(j.get("impact", 1.0)) for j in jets)
    total_flow = sum(float(j.get("flow_lps", 1.0)) for j in jets)

    kept, dropped = jets, []
    if len(jets) >= 3:
        ratios = [float(j.get("impact", 1.0)) / max(0.01, float(j.get("flow_lps", 1.0))) for j in jets]
        med = median(ratios)
        kept = [j for j, r in zip(jets, ratios) if r >= 0.5 * med]
        dropped = [j for j, r in zip(jets, ratios) if r < 0.5 * med]

    kept_impact = sum(float(j.get("impact", 1.0)) for j in kept)
    kept_flow = sum(float(j.get("flow_lps", 1.0)) for j in kept)
    base_eff = total_impact / total_flow if total_flow > 0 else 0.0
    opt_eff = kept_impact / kept_flow if kept_flow > 0 else base_eff

    if dropped:
        recs.append({"category": "performance", "action": f"Trim {len(dropped)} low-impact jet(s) "
                     "(impact-per-flow below half the median) — most of the visual impact for far "
                     "less flow", "impact_retained_percent": round(kept_impact / total_impact * 100, 1)
                     if total_impact else 100.0})

    fps = float(design.get("output_hz", 44))
    if fps > 44:
        recs.append({"category": "performance", "action": f"Cap output to 44 Hz (was {fps:.0f} Hz) — "
                     "the Art-Net ceiling; removes redundant frames"})

    return {
        "impact_baseline": round(total_impact, 3),
        "impact_retained": round(kept_impact, 3),
        "impact_retained_percent": round(kept_impact / total_impact * 100, 1) if total_impact else 100.0,
        "efficiency_baseline": round(base_eff, 4),
        "efficiency_optimized": round(opt_eff, 4),
        "improvement_percent": round((opt_eff - base_eff) / base_eff * 100, 1) if base_eff > 0 else 0.0,
        "recommendations": recs,
    }


# ── Aggregate ───────────────────────────────────────────────────────────────────

def analyze(design: dict) -> dict:
    energy = optimize_energy(design)
    water = optimize_water(design)
    performance = optimize_performance(design)
    all_recs = energy["recommendations"] + water["recommendations"] + performance["recommendations"]
    return {
        "energy": energy,
        "water": water,
        "performance": performance,
        "summary": {
            "energy_savings_percent": energy["savings_percent"],
            "water_savings_percent": water["savings_percent"],
            "performance_improvement_percent": performance["improvement_percent"],
            "total_cost_saving_per_day": round(energy["cost_saving_per_day"] + water["cost_saving_per_day"], 2),
            "recommendation_count": len(all_recs),
        },
        "recommendations": all_recs,
    }
