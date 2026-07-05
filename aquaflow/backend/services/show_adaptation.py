"""
show_adaptation.py — AquaFlow Stage 5, AQ-S5-003

Autonomous Show Adaptation: given live context (weather, crowd, event) the engine
produces an adaptation plan that automatically re-scales a running show — jet heights,
intensity, tempo, and which effects are enabled — while always respecting safety
(the wind cutoff from AQ-X-012 dominates any crowd/event boost).

  * weather adaptation — high wind cuts tall jets and disables mist/fine jets, rain
    reduces intensity and drops fog, storms near-shut-down; night boosts lighting,
  * crowd adaptation — scales intensity/energy with crowd density (eco when empty,
    boost when packed),
  * event adaptation — profiles per event (quiet hours, celebration, finale, VIP,
    countdown) re-scale intensity/tempo and enable/disable feature effects.

Safety precedence: weather safety caps are applied last, so a finale never overrides a
high-wind jet-height cut. Pure and deterministic (operates on a context dict) so it is
fully unit-tested.
"""
from __future__ import annotations

from services.wind_drift import HIGH_WIND_SHUTDOWN_MS, MODERATE_WIND_MS

# Effects trimmed in strong wind (they atomise/drift the worst).
_WIND_TRIMMED_EFFECTS = ["mist", "laminar", "fine_jets"]

# Event profiles: intensity/tempo multipliers + effects to enable/disable.
EVENT_PROFILES = {
    "normal":      {"intensity": 1.0,  "tempo": 1.0,  "height": 1.0,  "enable": [], "disable": []},
    "quiet_hours": {"intensity": 0.5,  "tempo": 0.85, "height": 0.8,  "enable": [], "disable": ["flame", "laser"]},
    "celebration": {"intensity": 1.2,  "tempo": 1.05, "height": 1.1,  "enable": ["lighting"], "disable": []},
    "finale":      {"intensity": 1.3,  "tempo": 1.1,  "height": 1.15, "enable": ["flame", "laser", "fog"], "disable": []},
    "vip":         {"intensity": 1.15, "tempo": 1.0,  "height": 1.05, "enable": ["lighting"], "disable": []},
    "countdown":   {"intensity": 1.25, "tempo": 1.15, "height": 1.1,  "enable": [], "disable": []},
}

INTENSITY_CAP = 1.5


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ── Weather ─────────────────────────────────────────────────────────────────────

def adapt_weather(weather: dict) -> dict:
    wind = float(weather.get("wind_speed", 0))
    cond = str(weather.get("condition", "clear")).lower()
    ambient = weather.get("ambient_lux")

    height, intensity = 1.0, 1.0
    disabled, enabled = set(), set()
    triggers = []
    safe = True

    if wind >= HIGH_WIND_SHUTDOWN_MS:
        height = 0.4
        disabled.update(_WIND_TRIMMED_EFFECTS + ["flame"])   # no naked flame in high wind
        triggers.append({"source": "weather", "action": "reduce_tall_jets",
                         "reason": f"high wind {wind:.0f} m/s — cut jet heights, drop mist/fine jets"})
    elif wind >= MODERATE_WIND_MS:
        height = 0.7
        triggers.append({"source": "weather", "action": "trim_jet_height",
                         "reason": f"moderate wind {wind:.0f} m/s"})

    if cond in ("rain", "heavy_rain", "storm"):
        intensity *= 0.6
        disabled.add("fog")
        triggers.append({"source": "weather", "action": "reduce_for_rain", "reason": cond})
    if cond in ("storm", "dense_fog"):
        height = min(height, 0.2)
        intensity = min(intensity, 0.3)
        safe = False
        triggers.append({"source": "weather", "action": "emergency_reduce", "reason": cond})

    if ambient is not None and float(ambient) < 50:
        enabled.add("lighting")
        triggers.append({"source": "weather", "action": "boost_lighting",
                         "reason": "low ambient / night — lit water reads best"})

    return {"height_scale": height, "intensity_scale": intensity,
            "disabled": disabled, "enabled": enabled, "triggers": triggers,
            "safe": safe, "high_wind": wind >= HIGH_WIND_SHUTDOWN_MS}


# ── Crowd ───────────────────────────────────────────────────────────────────────

def adapt_crowd(crowd: dict) -> dict:
    level = crowd.get("level")
    if level is None and crowd.get("count") is not None:
        cap = max(1.0, float(crowd.get("capacity", crowd["count"])))
        level = float(crowd["count"]) / cap
    level = 0.5 if level is None else _clamp(float(level), 0.0, 1.0)
    # Eco (0.5×) when empty → boost (1.2×) when packed.
    intensity = 0.5 + level * 0.7
    mode = "eco" if level < 0.25 else ("boost" if level > 0.75 else "normal")
    return {"intensity_scale": round(intensity, 3), "level": round(level, 3), "mode": mode,
            "triggers": [{"source": "crowd", "action": mode,
                          "reason": f"crowd level {level:.0%} → {mode}"}]}


# ── Event ───────────────────────────────────────────────────────────────────────

def adapt_event(event: dict) -> dict:
    etype = str(event.get("type", "normal")).lower()
    p = EVENT_PROFILES.get(etype, EVENT_PROFILES["normal"])
    return {"type": etype, "intensity_scale": p["intensity"], "tempo_scale": p["tempo"],
            "height_scale": p["height"], "enabled": set(p["enable"]), "disabled": set(p["disable"]),
            "triggers": ([{"source": "event", "action": etype,
                           "reason": f"event '{etype}' profile applied"}] if etype != "normal" else [])}


# ── Combined autonomous plan ─────────────────────────────────────────────────────

def adapt(context: dict) -> dict:
    weather = adapt_weather(context.get("weather", {}) or {})
    crowd = adapt_crowd(context.get("crowd", {}) or {})
    event = adapt_event(context.get("event", {}) or {})

    intensity = weather["intensity_scale"] * crowd["intensity_scale"] * event["intensity_scale"]
    height = weather["height_scale"] * event["height_scale"]
    tempo = event["tempo_scale"]

    disabled = set(weather["disabled"]) | set(event["disabled"])
    enabled = (set(weather["enabled"]) | set(event["enabled"])) - disabled

    # ── Safety precedence: weather caps override crowd/event boosts. ──────────────
    if weather["high_wind"]:
        height = min(height, 0.4)         # a finale cannot raise jets in high wind
    if not weather["safe"]:               # storm / dense fog
        height = min(height, 0.2)
        intensity = min(intensity, 0.3)

    intensity = round(_clamp(intensity, 0.0, INTENSITY_CAP), 3)
    height = round(_clamp(height, 0.0, 1.3), 3)
    tempo = round(_clamp(tempo, 0.5, 1.5), 3)

    triggers = weather["triggers"] + crowd["triggers"] + event["triggers"]
    return {
        "modifications": {
            "intensity_scale": intensity,
            "jet_height_scale": height,
            "tempo_scale": tempo,
            "disabled_effects": sorted(disabled),
            "enabled_effects": sorted(enabled),
        },
        "weather": {"height_scale": weather["height_scale"], "intensity_scale": weather["intensity_scale"],
                    "high_wind": weather["high_wind"], "safe": weather["safe"]},
        "crowd": {"level": crowd["level"], "mode": crowd["mode"], "intensity_scale": crowd["intensity_scale"]},
        "event": {"type": event["type"], "intensity_scale": event["intensity_scale"], "tempo_scale": event["tempo_scale"]},
        "triggers": triggers,
        "safe": weather["safe"],
        "summary": _summary(intensity, height, tempo, disabled, enabled, weather, crowd, event),
    }


def _summary(intensity, height, tempo, disabled, enabled, weather, crowd, event) -> str:
    parts = [f"intensity ×{intensity}", f"jet height ×{height}", f"tempo ×{tempo}"]
    if disabled:
        parts.append("disabled " + ", ".join(sorted(disabled)))
    if enabled:
        parts.append("enabled " + ", ".join(sorted(enabled)))
    tag = []
    if weather["high_wind"]:
        tag.append("HIGH WIND")
    if not weather["safe"]:
        tag.append("UNSAFE WEATHER")
    tag.append(crowd["mode"].upper())
    if event["type"] != "normal":
        tag.append(event["type"].upper())
    return f"[{' · '.join(tag)}] " + "; ".join(parts) + "."
