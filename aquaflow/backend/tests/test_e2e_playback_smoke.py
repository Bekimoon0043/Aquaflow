"""
End-to-end playback smoke test (AQ-S1-009).

Drives the real ShowEngine through a full load → play → tick → stop cycle with a
capturing protocol bus standing in for hardware, and asserts that:
  * a designed show loads and reports the right duration,
  * playback actually advances the playhead over real ticks,
  * timeline clips are evaluated and emitted to the output path during playback,
  * playback stops cleanly.

This is the backend half of the end-to-end path (timeline → engine → protocol bus)
that a live show depends on.
"""
import asyncio

from tests.sample_data import sample_aqua_show
from engine.show_engine import ShowEngine, PlaybackState


class CapturingBus:
    """Stand-in protocol bus that records every batch the engine emits."""
    def __init__(self):
        self.batches = []
    async def send_batch(self, commands):
        self.batches.append(list(commands))
    async def blackout(self):
        pass

    @property
    def all_commands(self):
        return [c for batch in self.batches for c in batch]


def test_end_to_end_playback_smoke():
    async def run():
        engine = ShowEngine()
        bus = CapturingBus()
        await engine.start(device_manager=None, protocol_bus=bus)

        # Load a designed show with an active pump clip at t=0.
        engine.load_show(sample_aqua_show())
        assert engine.show_state.duration >= 3.0
        assert engine.show_state.state == PlaybackState.STOPPED

        # Start playback — no hardware conflicts, so this must succeed.
        started = await engine.play()
        assert started is True
        assert engine.show_state.state == PlaybackState.PLAYING

        # Let it run for ~15 ticks (100 Hz → 0.15 s).
        await asyncio.sleep(0.15)

        assert engine.show_state.playhead > 0.0, "playhead did not advance"
        assert bus.all_commands, "no commands emitted during playback"

        # The active clip is a pump at 80% → normalized 0.8.
        pump_cmds = [c for c in bus.all_commands if c.get("type") == "pump"]
        assert pump_cmds, "pump clip was not emitted"
        assert abs(pump_cmds[0]["intensity"] - 0.8) < 1e-6

        # Stop cleanly.
        await engine.stop_playback()
        assert engine.show_state.state == PlaybackState.STOPPED
        await engine.stop()

    asyncio.run(run())


def test_playback_blocked_by_hardware_conflict():
    """A show with conflicting addresses must refuse to start (safety contract)."""
    async def run():
        engine = ShowEngine()
        engine.device_registry_summary = {
            "validation": ["DMX collision: Universe 1 Ch 1 used by 'a' and 'b'"],
        }
        started = await engine.play()
        assert started is False
        assert engine.show_state.state != PlaybackState.PLAYING
        assert "conflict" in engine.last_error.lower()

    asyncio.run(run())
