"""
AF-HUB-013 — Playback authority lockdown.

Invariant: ShowEngine is the ONE playback/timing/output authority. RuntimeTransport is
demoted to a driven mirror — it has no independent clock and no output-dispatch path, so
two loops can never command the fixtures independently. These tests enforce that.
"""
import asyncio
import inspect

from engine.runtime_transport import RuntimeTransport, TransportState
from engine.show_engine import ShowEngine, PlaybackState


# ── RuntimeTransport is demoted ─────────────────────────────────────────────────

def test_transport_is_not_a_timing_authority():
    assert RuntimeTransport.TIMING_AUTHORITY is False


def test_transport_start_launches_no_independent_loop():
    t = RuntimeTransport()
    asyncio.run(t.start())
    assert t._running is False          # no loop running
    assert t._task is None              # no asyncio task created


def test_transport_has_no_output_dispatch_path():
    t = RuntimeTransport()
    # It must not hold a protocol bus or expose a send/dispatch/emit method.
    for attr in ("send_batch", "dispatch", "emit", "send_artnet", "protocol_bus", "_bus"):
        assert not hasattr(t, attr), f"transport unexpectedly has an output path: {attr}"


def test_transport_position_only_advances_when_the_engine_drives_it():
    t = RuntimeTransport()
    t.load_show("s1", duration_ms=10_000)
    assert t.play() is True
    # No clock of its own: without a sync, position stays put across real wall-clock time.
    import time
    before = t.get_status()["position_ms"]
    time.sleep(0.05)
    assert t.get_status()["position_ms"] == before == 0

    # The single authority pushes the playhead — only now does it advance.
    t.sync_from_engine(2500, is_playing=True, duration_ms=10_000)
    assert t.get_status()["position_ms"] == 2500
    assert t.get_status()["state"] == TransportState.PLAYING


def test_sync_from_engine_detects_end_and_pause():
    t = RuntimeTransport()
    t.load_show("s1", duration_ms=1000)
    t.play()
    t.sync_from_engine(1000, is_playing=True, duration_ms=1000)
    assert t.get_status()["state"] == TransportState.ENDED
    # a not-playing sync from PLAYING pauses
    t2 = RuntimeTransport()
    t2.load_show("s2", duration_ms=1000); t2.play()
    t2.sync_from_engine(400, is_playing=True, duration_ms=1000)
    t2.sync_from_engine(400, is_playing=False, duration_ms=1000)
    assert t2.get_status()["state"] == TransportState.PAUSED


def test_transport_has_no_advancing_loop_method():
    # The old independent 100 Hz loop is gone.
    assert not hasattr(RuntimeTransport, "_tick")
    assert not hasattr(RuntimeTransport, "_calc_position")
    assert not hasattr(RuntimeTransport, "LOOP_HZ")


# ── ShowEngine is the single authority driving the mirror ───────────────────────

def test_show_engine_is_the_single_100hz_authority():
    assert ShowEngine.TICK_RATE == 100  # the one playback loop


def test_show_engine_drives_the_transport_mirror():
    async def run():
        eng = ShowEngine()
        t = RuntimeTransport()
        t.load_show("s1", duration_ms=10_000)
        eng.attach_transport(t)
        await eng.start(device_manager=None, protocol_bus=None)
        eng.load_show({"currentShow": {"id": "s1", "name": "S", "duration": 10},
                       "timelineTracks": [], "fixtures": []})
        started = await eng.play()
        assert started is True
        await asyncio.sleep(0.12)          # let the ONE loop run a few ticks
        # the transport mirror advanced because the engine drove it (not its own clock)
        assert t.get_status()["position_ms"] > 0
        assert t.get_status()["state"] == TransportState.PLAYING
        await eng.stop_playback()
        # stop is mirrored
        assert t.get_status()["state"] in (TransportState.STOPPED, TransportState.PAUSED)
        await eng.stop()

    asyncio.run(run())


def test_engine_emergency_stop_faults_the_transport_mirror():
    async def run():
        eng = ShowEngine()
        t = RuntimeTransport()
        t.load_show("s1", duration_ms=10_000)
        eng.attach_transport(t)
        await eng.start(device_manager=None, protocol_bus=None)
        eng.load_show({"currentShow": {"id": "s1", "name": "S", "duration": 10}, "fixtures": []})
        await eng.play()
        await eng.emergency_stop()
        assert t.get_status()["state"] == TransportState.FAULT
        await eng.stop()

    asyncio.run(run())
