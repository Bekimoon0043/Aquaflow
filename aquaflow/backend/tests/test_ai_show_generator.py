"""
Contract tests for the AI show generator (AQ-S3-001).

Asserts free-text prompts and mood descriptions are interpreted correctly and
that the generated timeline is playable by the real ShowEngine.
"""
import asyncio

from services.ai_show_generator import generate_show, interpret_prompt
from engine.show_engine import ShowEngine, PlaybackState


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


def test_prompt_produces_show_with_effects():
    out = generate_show("dramatic cinematic show with fire and lasers, 90 seconds")
    types = {t["type"] for t in out["timelineTracks"]}
    assert out["stats"]["clip_count"] > 0
    assert "flame" in types and "laser" in types
    assert abs(out["show"]["duration"] - 90.0) < 1e-6


def test_prompt_name_and_bpm_and_negation():
    assert generate_show('a show called "Ocean Dreams", calm')["show"]["name"] == "Ocean Dreams"
    assert abs(generate_show("party at 140 bpm")["show"]["bpm"] - 140.0) < 1e-6
    types = {t["type"] for t in generate_show("epic show but no fire", duration=60)["timelineTracks"]}
    assert "flame" not in types


def test_mood_inference():
    assert interpret_prompt("serene peaceful zen garden").mood == "calm"
    assert interpret_prompt("high-energy vibrant party").mood == "energetic"
    assert interpret_prompt("intimate romantic wedding").mood == "romantic"
    assert interpret_prompt("epic cinematic spectacle").mood == "dramatic"


def test_mood_shapes_energy_and_tempo():
    calm = interpret_prompt("calm serene")
    energetic = interpret_prompt("energetic party")
    assert calm.energy < energetic.energy
    assert calm.bpm < energetic.bpm
    assert calm.palette != energetic.palette


def test_determinism():
    a = generate_show("mysterious moody night")
    b = generate_show("mysterious moody night")
    assert a["timelineTracks"] == b["timelineTracks"] and a["show"] == b["show"]


def test_clips_are_well_formed():
    out = generate_show("energetic celebration", duration=60)
    dur = out["show"]["duration"]
    for t in out["timelineTracks"]:
        for c in t["clips"]:
            assert 0 <= c["start"] < c["end"] <= dur + 1e-6
            assert 0 <= c["intensity"] <= 100


def test_generated_timeline_is_playable():
    out = generate_show("energetic celebration with lights and water, 40 seconds")
    payload = {"show": out["show"], "timelineTracks": out["timelineTracks"]}

    async def run():
        engine = ShowEngine()
        bus = CapturingBus()
        await engine.start(device_manager=None, protocol_bus=bus)
        engine.load_show(payload)
        assert await engine.play() is True
        assert engine.show_state.state == PlaybackState.PLAYING
        await asyncio.sleep(0.12)
        assert engine.show_state.playhead > 0.0
        assert len(bus.all) > 0
        assert "pump" in {c.get("type") for c in bus.all}
        await engine.stop_playback()
        await engine.stop()

    asyncio.run(run())
