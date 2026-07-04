"""
Contract tests for the AI Choreography Engine (AQ-S3-003).

Asserts full timelines are generated, fixture constraints are respected, and
prompt revisions work — including that the output plays on the real ShowEngine.
"""
import asyncio

from services.choreography_engine import (
    generate_choreography, revise_show, derive_track_type, FLAME_MAX_ON_TIME,
)
from engine.show_engine import ShowEngine, PlaybackState


class CapturingBus:
    def __init__(self): self.batches = []
    async def send_batch(self, cmds): self.batches.append(list(cmds))
    async def blackout(self): pass
    @property
    def all(self): return [c for b in self.batches for c in b]


def _fixtures():
    return [
        {"id": "jet-1", "type": "geyser", "groupId": "center_jets"},
        {"id": "light-1", "type": "rgb_light", "groupId": "rgb_lights"},
        {"id": "flame-1", "type": "flame_unit", "groupId": "flame_units", "maxOnTime": 3.0},
        {"id": "laser-1", "type": "laser_unit", "groupId": "laser_units"},
    ]


def test_full_timeline_and_coverage():
    out = generate_choreography("energetic dramatic show with fire and lasers, 60 seconds", _fixtures())
    types = {t["type"] for t in out["timelineTracks"]}
    assert {"pump", "lighting"} <= types
    assert out["stats"]["clip_count"] > 0
    dur = out["show"]["duration"]
    pump = next(t for t in out["timelineTracks"] if t["type"] == "pump")
    covered = sum(c["end"] - c["start"] for c in pump["clips"])
    assert covered >= dur * 0.95


def test_fixture_mapping():
    assert derive_track_type({"type": "geyser"}) == "pump"
    assert derive_track_type({"type": "rgb_light"}) == "lighting"
    assert derive_track_type({"type": "flame_unit"}) == "flame"
    assert derive_track_type({"type": "laser_beam"}) == "laser"
    assert derive_track_type({"type": "fog_machine"}) == "fog"


def test_absent_fixture_not_choreographed():
    out = generate_choreography("dramatic show with lots of fire and lasers",
                                [{"id": "j", "type": "geyser"}, {"id": "l", "type": "rgb_light"}])
    types = {t["type"] for t in out["timelineTracks"]}
    assert "flame" not in types and "laser" not in types
    assert any("flame" in w for w in out["warnings"])


def test_intensity_clamped_to_fixture_cap():
    out = generate_choreography("maximum energy full power show",
                                [{"id": "j", "type": "geyser", "maxIntensity": 0.5},
                                 {"id": "l", "type": "rgb_light"}])
    pump = next(t for t in out["timelineTracks"] if t["type"] == "pump")
    assert max(c["intensity"] for c in pump["clips"]) <= 50


def test_flame_bursts_within_hardware_limit():
    out = generate_choreography("epic show with continuous fire, 60 seconds", _fixtures())
    flame = next(t for t in out["timelineTracks"] if t["type"] == "flame")
    assert flame["clips"]
    assert max(c["end"] - c["start"] for c in flame["clips"]) <= FLAME_MAX_ON_TIME + 1e-6


def test_revision_scaling_and_history():
    base = generate_choreography("energetic show, 60 seconds",
                                 [{"id": "j", "type": "geyser"}, {"id": "l", "type": "rgb_light"}])
    peak = max(c["intensity"] for t in base["timelineTracks"] if t["type"] == "pump" for c in t["clips"])
    calmer = revise_show(base, "make it much calmer",
                         [{"id": "j", "type": "geyser"}, {"id": "l", "type": "rgb_light"}])
    calm_peak = max(c["intensity"] for t in calmer["timelineTracks"] if t["type"] == "pump" for c in t["clips"])
    assert calm_peak < peak
    assert calmer["revisionCount"] == 1
    assert calmer["revisions"][-1]["changes"]


def test_revision_remove_and_add_respect_fixtures():
    base = generate_choreography("energetic show with fire, 60 seconds", _fixtures())
    nofire = revise_show(base, "remove the flames", _fixtures())
    assert "flame" not in {t["type"] for t in nofire["timelineTracks"]}

    with_fog = _fixtures() + [{"id": "fog-1", "type": "fog_machine"}]
    added = revise_show(base, "add fog for atmosphere", with_fog)
    assert "fog" in {t["type"] for t in added["timelineTracks"]}

    # Cannot add laser with no laser fixture.
    base2 = generate_choreography("energetic show", [{"id": "j", "type": "geyser"}, {"id": "l", "type": "rgb_light"}])
    refused = revise_show(base2, "add lasers", [{"id": "j", "type": "geyser"}, {"id": "l", "type": "rgb_light"}])
    assert "laser" not in {t["type"] for t in refused["timelineTracks"]}
    assert any("laser" in w for w in refused["warnings"])


def test_generated_timeline_plays():
    out = generate_choreography("energetic celebration with water and lights, 40 seconds", _fixtures())

    async def run():
        eng = ShowEngine(); bus = CapturingBus()
        await eng.start(device_manager=None, protocol_bus=bus)
        eng.load_show({"show": out["show"], "timelineTracks": out["timelineTracks"]})
        assert await eng.play() is True
        assert eng.show_state.state == PlaybackState.PLAYING
        await asyncio.sleep(0.12)
        assert eng.show_state.playhead > 0 and len(bus.all) > 0
        await eng.stop_playback(); await eng.stop()

    asyncio.run(run())
