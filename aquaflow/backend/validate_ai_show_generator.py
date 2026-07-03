"""
validate_ai_show_generator.py — AquaFlow Stage 3, Priority 1 (AQ-S3-001)

Proves the three acceptance criteria for the AI show generator:
  1. Supports text prompts (free-text → a full show, extracting effects/name).
  2. Supports mood descriptions (distinct moods → distinct show parameters).
  3. Generates playable timelines (the output loads into a real ShowEngine and
     drives clips during playback).

The "playable" check is the strongest: the generated payload is fed to the actual
ShowEngine (load → play → tick) with a capturing bus, and we assert clips emit.
No server. Exit code 0 = all pass.

Run:  python validate_ai_show_generator.py
"""
import asyncio
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.ai_show_generator import generate_show, interpret_prompt
from engine.show_engine import ShowEngine, PlaybackState

PASS, FAIL = "PASS", "FAIL"
results = []


def check(name, ok, detail=""):
    results.append((name, PASS if ok else FAIL, detail))


class CapturingBus:
    def __init__(self):
        self.batches = []
    async def send_batch(self, commands):
        self.batches.append(list(commands))
    async def blackout(self):
        pass
    @property
    def all(self):
        return [c for b in self.batches for c in b]


# ── Criterion 1: text prompts ──────────────────────────────────────────────────
def test_text_prompts():
    out = generate_show("A dramatic cinematic fountain show with fire bursts and lasers, 90 seconds")
    check("Prompt: produces a show with tracks + clips",
          out["stats"]["track_count"] > 0 and out["stats"]["clip_count"] > 0, f"{out['stats']}")
    types = {t["type"] for t in out["timelineTracks"]}
    check("Prompt: requested flame effect appears as a track", "flame" in types, f"{types}")
    check("Prompt: requested laser effect appears as a track", "laser" in types, f"{types}")
    check("Prompt: parsed duration from text (90 s)", abs(out["show"]["duration"] - 90.0) < 1e-6,
          f"dur={out['show']['duration']}")

    named = generate_show('Make a show called "Ocean Dreams", calm and gentle')
    check("Prompt: extracts an explicit name", named["show"]["name"] == "Ocean Dreams",
          f"name={named['show']['name']}")

    # Explicit negation removes an effect.
    no_fire = generate_show("epic dramatic show but no fire", duration=60)
    check("Prompt: negation removes an effect ('no fire')",
          "flame" not in {t["type"] for t in no_fire["timelineTracks"]},
          f"{[t['type'] for t in no_fire['timelineTracks']]}")

    # Explicit bpm parsed.
    bpmshow = generate_show("energetic party at 140 bpm")
    check("Prompt: parses explicit BPM (140)", abs(bpmshow["show"]["bpm"] - 140.0) < 1e-6,
          f"bpm={bpmshow['show']['bpm']}")


# ── Criterion 2: mood descriptions ─────────────────────────────────────────────
def test_mood_descriptions():
    calm = interpret_prompt("a serene, peaceful zen garden at dusk")
    energetic = interpret_prompt("high-energy party celebration, vibrant and lively")
    romantic = interpret_prompt("an intimate romantic wedding evening")
    dramatic = interpret_prompt("epic cinematic monumental spectacle")

    check("Mood: 'zen/peaceful/serene' → calm", calm.mood == "calm", f"{calm.mood}")
    check("Mood: 'party/high-energy' → energetic", energetic.mood == "energetic", f"{energetic.mood}")
    check("Mood: 'romantic/wedding' → romantic", romantic.mood == "romantic", f"{romantic.mood}")
    check("Mood: 'epic/cinematic' → dramatic", dramatic.mood == "dramatic", f"{dramatic.mood}")

    # Distinct energy + tempo per mood.
    check("Mood: calm has lower energy than energetic", calm.energy < energetic.energy,
          f"calm={calm.energy} energetic={energetic.energy}")
    check("Mood: calm has slower tempo than energetic", calm.bpm < energetic.bpm,
          f"calm={calm.bpm} energetic={energetic.bpm}")
    # Palettes differ by mood.
    check("Mood: palettes differ between moods", calm.palette != energetic.palette, "")

    # Mood shapes the generated show intensity: calm peaks lower than dramatic.
    calm_show = generate_show("calm serene", duration=60)
    dramatic_show = generate_show("epic dramatic", duration=60)
    calm_peak = max(c["intensity"] for t in calm_show["timelineTracks"] for c in t["clips"])
    dram_peak = max(c["intensity"] for t in dramatic_show["timelineTracks"] for c in t["clips"])
    check("Mood: calm show peaks below dramatic show", calm_peak < dram_peak,
          f"calm_peak={calm_peak} dramatic_peak={dram_peak}")


# ── Criterion 3: playable timelines (real ShowEngine) ──────────────────────────
def test_playable_timeline():
    out = generate_show("energetic celebration with lights and water, 40 seconds")
    payload = {"show": out["show"], "timelineTracks": out["timelineTracks"]}

    # Schema sanity: clips are well-formed and within the show duration.
    dur = out["show"]["duration"]
    all_clips = [c for t in out["timelineTracks"] for c in t["clips"]]
    check("Playable: every clip has start<end within duration and intensity 0..100",
          all(0 <= c["start"] < c["end"] <= dur + 1e-6 and 0 <= c["intensity"] <= 100
              for c in all_clips), "malformed clip found")

    async def run():
        engine = ShowEngine()
        bus = CapturingBus()
        await engine.start(device_manager=None, protocol_bus=bus)
        engine.load_show(payload)
        check("Playable: ShowEngine loaded the generated show",
              engine.show_state.duration >= dur - 1e-6, f"dur={engine.show_state.duration}")
        started = await engine.play()
        check("Playable: playback started", started is True, "")
        await asyncio.sleep(0.15)
        check("Playable: playhead advanced during playback", engine.show_state.playhead > 0.0,
              f"playhead={engine.show_state.playhead}")
        check("Playable: generated clips emitted to the output path", len(bus.all) > 0,
              f"emitted={len(bus.all)}")
        # A pump (water) command should be among the emitted commands early on.
        types = {c.get("type") for c in bus.all}
        check("Playable: water/pump clips drive commands", "pump" in types, f"types={types}")
        await engine.stop_playback()
        await engine.stop()

    asyncio.run(run())


def test_determinism():
    a = generate_show("a mysterious moody night show")
    b = generate_show("a mysterious moody night show")
    check("Determinism: same prompt → identical show",
          a["timelineTracks"] == b["timelineTracks"] and a["show"] == b["show"], "")


def main() -> int:
    for fn in (test_text_prompts, test_mood_descriptions, test_playable_timeline, test_determinism):
        fn()

    print("\n" + "=" * 72)
    print("AQ-S3-001 AI Show Generator — Verification")
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
