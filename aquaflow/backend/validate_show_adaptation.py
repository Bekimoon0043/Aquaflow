"""
validate_show_adaptation.py — AQ-S5-003 verification

Scenarios for the autonomous show adaptation engine:
  1. weather adaptation (high wind cuts jets + trims mist; rain drops fog; storm unsafe),
  2. crowd adaptation (eco when empty, boost when packed),
  3. event adaptation (quiet hours / finale profiles), and safety precedence.

Run:  python backend/validate_show_adaptation.py   (from the aquaflow/ dir)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.show_adaptation import adapt, adapt_weather, adapt_crowd, adapt_event

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


print("== 1. weather adaptation ==")
calm = adapt({"weather": {"wind_speed": 2, "condition": "clear"}})
check("calm clear weather leaves jets full",
      calm["modifications"]["jet_height_scale"] == 1.0 and calm["safe"], str(calm["modifications"]))

wind = adapt({"weather": {"wind_speed": 14, "condition": "clear"}})
check("high wind cuts jet height to 0.4", wind["modifications"]["jet_height_scale"] == 0.4)
check("high wind disables mist/fine jets",
      set(["mist", "fine_jets"]).issubset(set(wind["modifications"]["disabled_effects"])),
      str(wind["modifications"]["disabled_effects"]))
check("high wind flagged", wind["weather"]["high_wind"] is True)

mod = adapt({"weather": {"wind_speed": 9, "condition": "clear"}})
check("moderate wind trims height to 0.7", mod["modifications"]["jet_height_scale"] == 0.7)

rain = adapt({"weather": {"wind_speed": 2, "condition": "rain"}})
check("rain reduces intensity", rain["modifications"]["intensity_scale"] < 1.0)
check("rain disables fog", "fog" in rain["modifications"]["disabled_effects"])

storm = adapt({"weather": {"wind_speed": 20, "condition": "storm"}})
check("storm is unsafe", storm["safe"] is False)
check("storm caps jets very low", storm["modifications"]["jet_height_scale"] <= 0.2)

night = adapt({"weather": {"wind_speed": 1, "condition": "clear", "ambient_lux": 3}})
check("night boosts lighting", "lighting" in night["modifications"]["enabled_effects"])

print("== 2. crowd adaptation ==")
empty = adapt({"crowd": {"level": 0.0}})
check("empty crowd → eco (intensity < 1)", empty["modifications"]["intensity_scale"] < 1.0
      and empty["crowd"]["mode"] == "eco", str(empty["crowd"]))
packed = adapt({"crowd": {"level": 1.0}})
check("packed crowd → boost (intensity > 1)", packed["modifications"]["intensity_scale"] > 1.0
      and packed["crowd"]["mode"] == "boost")
count = adapt({"crowd": {"count": 250, "capacity": 500}})
check("crowd from count/capacity → 50% level", abs(count["crowd"]["level"] - 0.5) < 1e-6)

print("== 3. event adaptation ==")
quiet = adapt({"event": {"type": "quiet_hours"}})
check("quiet hours dims intensity", quiet["event"]["intensity_scale"] == 0.5)
check("quiet hours disables flame + laser",
      {"flame", "laser"}.issubset(set(quiet["modifications"]["disabled_effects"])))
finale = adapt({"event": {"type": "finale"}})
check("finale boosts intensity", finale["modifications"]["intensity_scale"] > 1.0)
check("finale enables flame/laser/fog", {"flame", "laser", "fog"}.issubset(set(finale["modifications"]["enabled_effects"])))
check("finale speeds tempo", finale["modifications"]["tempo_scale"] > 1.0)

print("== 4. safety precedence (weather beats event/crowd) ==")
combo = adapt({"weather": {"wind_speed": 15, "condition": "clear"},
               "event": {"type": "finale"}, "crowd": {"level": 1.0}})
check("finale cannot raise jets in high wind (height capped 0.4)",
      combo["modifications"]["jet_height_scale"] == 0.4, str(combo["modifications"]["jet_height_scale"]))
check("flame stays disabled in high wind despite the finale",
      "flame" in combo["modifications"]["disabled_effects"]
      and "flame" not in combo["modifications"]["enabled_effects"])
check("crowd+finale still boost intensity", combo["modifications"]["intensity_scale"] > 1.0,
      str(combo["modifications"]["intensity_scale"]))
check("intensity capped at 1.5", combo["modifications"]["intensity_scale"] <= 1.5)

print("== 5. summary + defaults ==")
d = adapt({})
check("empty context is safe and neutral",
      d["safe"] and d["modifications"]["jet_height_scale"] == 1.0
      and abs(d["modifications"]["intensity_scale"] - 0.85) < 1e-6, str(d["modifications"]))  # default crowd 0.5 → 0.85
check("summary string produced", isinstance(combo["summary"], str) and "HIGH WIND" in combo["summary"])
check("triggers aggregated across sources",
      {t["source"] for t in combo["triggers"]} == {"weather", "crowd", "event"})

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
