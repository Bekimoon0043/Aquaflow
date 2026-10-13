"""
frame_pacing.py — precise frame pacing for the DMX-over-IP send loops (AF-NEXT-001).

Why this exists
---------------
asyncio schedules timers on ``time.monotonic()``. On Windows that clock is
GetTickCount64 with a 15.625 ms resolution, and the event loop treats any timer
due within one clock-resolution of "now" as ready. A ``asyncio.sleep(0.0227)``
therefore regularly wakes after ~15.6 ms. Measured on the loopback node
(docs/evidence/AF-NEXT-001-baseline-2026-10-13.md) the Art-Net driver was really
transmitting every ~15.6 ms (~64 Hz) — above the Art-Net 44 Hz per-universe
ceiling — not just appearing to because of coarse receive timestamps.

``sleep_until`` waits on the high-resolution ``time.perf_counter()`` clock and
never returns before the deadline: the coarse part of the wait is done with
``asyncio.sleep`` and the final sub-tick remainder with a high-resolution
``time.sleep`` in the default executor (Python >= 3.11 uses a high-resolution
waitable timer on Windows), so the event loop is never blocked or busy-spun.
"""
from __future__ import annotations

import asyncio
import time

# Granularity of the event-loop timer clock (≈0.0156 s on Windows, ~1e-9 on Linux).
LOOP_CLOCK_RESOLUTION = time.get_clock_info("monotonic").resolution
_FINE_THRESHOLD = 0.001   # below this the loop clock is precise enough on its own


async def sleep_until(deadline: float) -> None:
    """Sleep until ``time.perf_counter() >= deadline`` (never earlier)."""
    while True:
        remaining = deadline - time.perf_counter()
        if remaining <= 0:
            return
        if LOOP_CLOCK_RESOLUTION <= _FINE_THRESHOLD:
            await asyncio.sleep(remaining)
        elif remaining > LOOP_CLOCK_RESOLUTION:
            # Coarse wait; may wake up to one clock tick early — loop re-checks.
            await asyncio.sleep(remaining - LOOP_CLOCK_RESOLUTION)
        else:
            await asyncio.get_running_loop().run_in_executor(None, time.sleep, remaining)


async def paced_loop(is_running, tick, max_hz: float) -> None:
    """
    Call ``await tick()`` at most ``max_hz`` times per second while
    ``is_running()`` is true. Ticks are spaced at least ``1/max_hz`` apart on the
    perf_counter clock; a late tick re-anchors instead of bursting to catch up.
    """
    interval = 1.0 / max_hz
    next_tick = time.perf_counter()
    while is_running():
        await tick()
        next_tick += interval
        now = time.perf_counter()
        if next_tick < now:          # overran (slow send) — don't burst to catch up
            next_tick = now
        await sleep_until(next_tick)
