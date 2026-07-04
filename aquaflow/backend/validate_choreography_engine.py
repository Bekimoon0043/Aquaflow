"""
validate_choreography_engine.py — AquaFlow Stage 3, Priority 3 (AQ-S3-003)

Proves the three acceptance criteria for the AI Choreography Engine:
  1. Full timelines generated (multi-track, full-duration coverage, plays on the
     real ShowEngine).
  2. Fixture constraints respected (no track for absent fixtures; intensity
     clamped to per-fixture caps; flame bursts within the hardware on-time limit).
  3. Prompt revisions supported (calmer/energetic scaling, add/remove tracks
     honouring fixtures, revision history).

No server. Exit code 0 = all pass.
Run:  python validate_choreography_engine.py
"""
import asyncio
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.choreography_engine import (
    generate_choreography, revise_show, derive_track_type, FLAME_MAX_ON_TIME,
)
from engine.show_engine import ShowEngine, PlaybackState

PASS, FAIL = "PASS", "FAIL"
results = []


def check(name, ok, detail=""):
    results.append((name, PASS if ok else FAIL, detail))


class CapturingBus:
    def __init__(self): self.batches = []
    async def send_batch(self, cmds): self.batches.append(list(cmds))
    async def blackout(self): pass
    @property
    def all(self): return [c for b in self.batches for c in b]


def full_fixtures():
    return [
        {"id": "jet-1", "type": "geyser", "groupId": "center_jets"},
        {"id": "jet-2", "type": "laminar", "groupId": "center_jets"},
        {"id": "light-1", "type": "rgb_light", "groupId": "rgb_lights"},
        {"id": "flame-1", "type": "flame_unit", "groupId": "flame_units", "maxOnTime": 3.0},
        {"id": "laser-1", "type": "laser_unit", "groupId": "laser_units"},
    ]


# ── Criterion 1: full timelines ────────────────────────────────────────────────
def test_full_timeline():
    out = generate_choreography("energetic dramatic show with fire and lasers, 60 seconds",
                                full_fixtures())
    types = {t["type"] for t in out["timelineTracks"]}
    check("Full: multi-track timeline generated", out["stats"]["track_count"] >= 3, f"{out['stats']}")
    check("Full: water + lighting tracks present", {"pump", "lighting"} <= types, f"{types}")
    check("Full: clips generated", out["stats"]["clip_count"] > 0, f"{out['stats']}")

    # Coverage: the pump track spans (nearly) the whole duration.
    dur = out["show"]["duration"]
    pump = next(t for t in out["timelineTracks"] if t["type"] == "pump")
    covered = sum(c["end"] - c["start"] for c in pump["clips"])
    check("Full: pump track covers the full duration", covered >= dur * 0.95,
          f"covered={covered:.1f} of {dur}")

    # Plays on the real ShowEngine.
    async def run():
        eng = ShowEngine(); bus = CapturingBus()
        await eng.start(device_manager=None, protocol_bus=bus)
        eng.load_show({"show": out["show"], "timelineTracks": out["timelineTracks"]})
        started = await eng.play()
        check("Full: generated timeline plays on ShowEngine", started is True, "")
        await asyncio.sleep(0.15)
        check("Full: playhead advances + clips emit",
              eng.show_state.playhead > 0 and len(bus.all) > 0, f"emitted={len(bus.all)}")
        await eng.stop_playback(); await eng.stop()
    asyncio.run(run())


# ── Criterion 2: fixture constraints respected ─────────────────────────────────
def test_constraints():
    # No flame fixture — prompt asks for fire, but no flame track may appear.
    no_flame = [{"id": "jet-1", "type": "geyser"}, {"id": "light-1", "type": "rgb_light"}]
    out = generate_choreography("dramatic show with lots of fire", no_flame)
    types = {t["type"] for t in out["timelineTracks"]}
    check("Constraint: no flame track without a flame fixture", "flame" not in types, f"{types}")
    check("Constraint: warning recorded for missing flame fixture",
          any("flame" in w for w in out["warnings"]), f"{out['warnings']}")
    check("Constraint: no laser track without a laser fixture", "laser" not in types, f"{types}")

    # Per-fixture intensity cap — pump capped at 50%.
    capped = [{"id": "jet-1", "type": "geyser", "maxIntensity": 0.5},
              {"id": "light-1", "type": "rgb_light"}]
    out2 = generate_choreography("maximum energy full power show", capped)
    pump = next(t for t in out2["timelineTracks"] if t["type"] == "pump")
    peak = max(c["intensity"] for c in pump["clips"])
    check("Constraint: pump intensity clamped to fixture max (<=50)", peak <= 50, f"peak={peak}")
    light = next(t for t in out2["timelineTracks"] if t["type"] == "lighting")
    lpeak = max(c["intensity"] for c in light["clips"])
    check("Constraint: uncapped lighting can exceed the pump cap", lpeak > 50, f"lpeak={lpeak}")

    # Flame bursts never exceed the hardware max on-time.
    out3 = generate_choreography("epic dramatic show with continuous fire, 60 seconds",
                                 full_fixtures())
    flame = next(t for t in out3["timelineTracks"] if t["type"] == "flame")
    longest = max((c["end"] - c["start"]) for c in flame["clips"])
    check("Constraint: flame bursts within hardware max on-time",
          longest <= FLAME_MAX_ON_TIME + 1e-6, f"longest={longest:.2f} max={FLAME_MAX_ON_TIME}")
    check("Constraint: flame track actually generated (fixture present + requested)",
          len(flame["clips"]) > 0, "")

    check("Constraint: fixture→track mapping (geyser→pump, rgb→lighting)",
          derive_track_type({"type": "geyser"}) == "pump"
          and derive_track_type({"type": "rgb_light"}) == "lighting"
          and derive_track_type({"type": "flame_unit"}) == "flame", "")


# ── Criterion 3: prompt revisions ──────────────────────────────────────────────
def test_revisions():
    base = generate_choreography("energetic show with fire and lasers, 60 seconds", full_fixtures())
    base_pump_peak = max(c["intensity"] for t in base["timelineTracks"]
                         if t["type"] == "pump" for c in t["clips"])

    # Calmer → intensities drop.
    calmer = revise_show(base, "make it calmer and more relaxed", full_fixtures())
    calm_peak = max(c["intensity"] for t in calmer["timelineTracks"]
                    if t["type"] == "pump" for c in t["clips"])
    check("Revision: 'calmer' lowers intensity", calm_peak < base_pump_peak,
          f"base={base_pump_peak} calm={calm_peak}")
    check("Revision: revision history incremented", calmer["revisionCount"] == 1,
          f"count={calmer['revisionCount']}")

    # Remove flames.
    nofire = revise_show(base, "remove the flames", full_fixtures())
    check("Revision: 'remove the flames' drops the flame track",
          "flame" not in {t["type"] for t in nofire["timelineTracks"]},
          f"{[t['type'] for t in nofire['timelineTracks']]}")
    check("Revision: removal recorded in history",
          any("removed flame" in c for c in nofire["revisions"][-1]["changes"]),
          f"{nofire['revisions'][-1]['changes']}")

    # Add fog (fixture present) — start from a show without fog.
    with_fog_fixtures = full_fixtures() + [{"id": "fog-1", "type": "fog_machine"}]
    added = revise_show(base, "add fog for atmosphere", with_fog_fixtures)
    check("Revision: 'add fog' adds a fog track when a fog fixture exists",
          "fog" in {t["type"] for t in added["timelineTracks"]},
          f"{[t['type'] for t in added['timelineTracks']]}")

    # Add lasers but NO laser fixture → refused with a warning.
    base_no_laser = generate_choreography("energetic show, 60 seconds",
                                          [{"id": "jet-1", "type": "geyser"}, {"id": "l", "type": "rgb_light"}])
    refused = revise_show(base_no_laser, "add lasers at the finale",
                          [{"id": "jet-1", "type": "geyser"}, {"id": "l", "type": "rgb_light"}])
    check("Revision: cannot add laser without a laser fixture (constraint respected)",
          "laser" not in {t["type"] for t in refused["timelineTracks"]}
          and any("laser" in w for w in refused["warnings"]), f"{refused['warnings']}")

    # Energetic → intensities rise.
    hotter = revise_show(base_no_laser, "make it more energetic and powerful",
                         [{"id": "jet-1", "type": "geyser"}, {"id": "l", "type": "rgb_light"}])
    base2_peak = max(c["intensity"] for t in base_no_laser["timelineTracks"]
                     if t["type"] == "pump" for c in t["clips"])
    hot_peak = max(c["intensity"] for t in hotter["timelineTracks"]
                   if t["type"] == "pump" for c in t["clips"])
    check("Revision: 'more energetic' raises intensity (clamped ≤100)",
          hot_peak >= base2_peak and hot_peak <= 100, f"base={base2_peak} hot={hot_peak}")

    # Revised show still plays.
    async def run():
        eng = ShowEngine(); bus = CapturingBus()
        await eng.start(device_manager=None, protocol_bus=bus)
        eng.load_show({"show": added["show"], "timelineTracks": added["timelineTracks"]})
        check("Revision: revised timeline still plays", await eng.play() is True, "")
        await asyncio.sleep(0.1)
        await eng.stop_playback(); await eng.stop()
    asyncio.run(run())


def main() -> int:
    for fn in (test_full_timeline, test_constraints, test_revisions):
        fn()
    print("\n" + "=" * 72)
    print("AQ-S3-003 AI Choreography Engine — Verification")
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
