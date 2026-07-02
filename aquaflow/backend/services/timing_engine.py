"""
timing_engine.py — AquaFlow Team D
Multi-rate tick scheduler scaffold.

The existing show_engine.py runs one loop at 100Hz.
This module adds independent tick tiers for different subsystems,
allowing safety-critical ticks (1000Hz) to never be blocked by
slower show logic (100Hz) or telemetry (4Hz).

Architecture:
  ┌─────────────────────────────────────────────────────────────────┐
  │  TimingEngine                                                    │
  │    tick_tier[SAFETY]    — 1000Hz asyncio task (never blocked)   │
  │    tick_tier[DMX]       —   44Hz asyncio task                   │
  │    tick_tier[MOTION]    —   50Hz asyncio task                   │
  │    tick_tier[SHOW]      —  100Hz asyncio task (existing engine) │
  │    tick_tier[WATER]     —   10Hz asyncio task                   │
  │    tick_tier[TELEMETRY] —    4Hz asyncio task                   │
  └─────────────────────────────────────────────────────────────────┘

Does NOT touch:
  - Frontend code
  - ShowProgrammerPanel, showStore
  - Persistence routes
  - show_engine.py internals (wraps it, doesn't modify it)
"""

from __future__ import annotations

import asyncio
import time
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Awaitable, Callable, Optional

logger = logging.getLogger(__name__)


# ── Tick Tier Definitions ─────────────────────────────────────────────────────

class TickTier(str, Enum):
    SAFETY    = "safety"     # 1000 Hz — fire watchdog, E-stop
    DMX       = "dmx"        # 44 Hz   — DMX/Art-Net refresh
    MOTION    = "motion"     # 50 Hz   — pan/tilt motors
    SHOW      = "show"       # 100 Hz  — playhead, event scheduling
    WATER     = "water"      # 10 Hz   — pumps, solenoids, VFDs
    TELEMETRY = "telemetry"  # 4 Hz    — frontend state broadcast


TICK_INTERVALS: dict[TickTier, float] = {
    TickTier.SAFETY:    1 / 1000,    # 1ms
    TickTier.DMX:       1 / 44,      # 22.7ms
    TickTier.MOTION:    1 / 50,      # 20ms
    TickTier.SHOW:      1 / 100,     # 10ms
    TickTier.WATER:     1 / 10,      # 100ms
    TickTier.TELEMETRY: 1 / 4,       # 250ms
}

# Callback type: async fn(elapsed: float, delta: float) -> None
TickCallback = Callable[[float, float], Awaitable[None]]


# ── Tick Tier State ───────────────────────────────────────────────────────────

@dataclass
class TierStats:
    tier:          TickTier
    tick_count:    int   = 0
    missed_ticks:  int   = 0
    last_tick_at:  float = 0.0
    avg_drift_ms:  float = 0.0
    max_drift_ms:  float = 0.0


# ── Timing Engine ─────────────────────────────────────────────────────────────

class TimingEngine:
    """
    Manages independent async tick loops for each timing tier.

    Usage:
        engine = TimingEngine()

        @engine.on(TickTier.SHOW)
        async def show_tick(elapsed: float, delta: float):
            # advance playhead, dispatch events
            ...

        @engine.on(TickTier.SAFETY)
        async def safety_tick(elapsed: float, delta: float):
            # check fire watchdog, E-stop detection
            ...

        await engine.start()
        # ... show runs ...
        await engine.stop()
    """

    def __init__(self):
        self._callbacks: dict[TickTier, list[TickCallback]] = {t: [] for t in TickTier}
        self._tasks:     dict[TickTier, Optional[asyncio.Task]] = {t: None for t in TickTier}
        self._stats:     dict[TickTier, TierStats] = {t: TierStats(tier=t) for t in TickTier}
        self._running    = False
        self._start_time: float = 0.0

        # ESTOP flag: when set, the safety tier broadcasts blackout immediately.
        # Written by the safety tier, read by all other tiers.
        self.estop_active: bool = False

        # Immediate E-stop handlers.
        # These run as soon as trigger_estop() is called, before normal tick loops.
        # Later, RuntimeBridge._execute_estop can be registered here safely.
        self._estop_handlers: list[Callable] = []

    # ── Registration ──────────────────────────────────────────────────────────

    def on(self, tier: TickTier) -> Callable:
        """Decorator to register a callback for a tick tier."""
        def decorator(fn: TickCallback) -> TickCallback:
            self._callbacks[tier].append(fn)
            return fn
        return decorator

    def register(self, tier: TickTier, fn: TickCallback) -> None:
        """Register a callback imperatively."""
        self._callbacks[tier].append(fn)

    def register_estop_handler(self, fn: Callable) -> None:
        """
        Register a callable that fires immediately when trigger_estop() is called.

        This is needed because non-safety tiers are suspended during E-stop,
        so RuntimeBridge.tick() may not receive delta=-1 through the normal loop.
        """
        self._estop_handlers.append(fn)

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._running:
            return
        self._running    = True
        self._start_time = time.monotonic()

        for tier in TickTier:
            if self._callbacks[tier]:
                task = asyncio.create_task(
                    self._tick_loop(tier),
                    name=f"timing_{tier.value}",
                )
                self._tasks[tier] = task
                logger.info(
                    f"[TimingEngine] {tier.value} tick started "
                    f"at {1/TICK_INTERVALS[tier]:.0f}Hz"
                )

    async def stop(self) -> None:
        self._running = False
        for tier, task in self._tasks.items():
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self._tasks = {t: None for t in TickTier}
        logger.info("[TimingEngine] all tick loops stopped")

    # ── E-stop ────────────────────────────────────────────────────────────────

    def trigger_estop(self, source: str = "unknown") -> None:
        """
        Set the global E-stop flag and immediately fire all registered
        E-stop handlers.

        This keeps blackout responsive even when non-safety tick tiers
        are suspended.
        """
        if not self.estop_active:
            self.estop_active = True
            logger.critical(f"[TimingEngine] ESTOP triggered by: {source}")

            try:
                loop = asyncio.get_event_loop()

                for handler in self._estop_handlers:
                    if asyncio.iscoroutinefunction(handler):
                        loop.call_soon_threadsafe(
                            lambda h=handler: asyncio.ensure_future(h())
                        )
                    else:
                        loop.call_soon_threadsafe(handler)

            except RuntimeError:
                logger.warning(
                    "[TimingEngine] trigger_estop: no running event loop; "
                    "handlers will rely on safety tick fallback"
                )

    def clear_estop(self) -> None:
        """Clear E-stop flag (requires operator action + safety kernel reset)."""
        self.estop_active = False
        logger.info("[TimingEngine] ESTOP cleared")

    # ── Statistics ────────────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        return {
            tier.value: {
                "tick_count":   self._stats[tier].tick_count,
                "missed_ticks": self._stats[tier].missed_ticks,
                "avg_drift_ms": round(self._stats[tier].avg_drift_ms, 3),
                "max_drift_ms": round(self._stats[tier].max_drift_ms, 3),
            }
            for tier in TickTier
        }

    # ── Internal: Tick Loop ───────────────────────────────────────────────────

    async def _tick_loop(self, tier: TickTier) -> None:
        interval    = TICK_INTERVALS[tier]
        stats       = self._stats[tier]
        callbacks   = self._callbacks[tier]

        last_tick   = time.monotonic()
        elapsed     = 0.0

        while self._running:
            now   = time.monotonic()
            delta = now - last_tick

            # Detect missed ticks (frame took > 1.5× expected interval)
            if delta > interval * 1.5 and stats.tick_count > 0:
                stats.missed_ticks += 1
                missed = int(delta / interval) - 1
                if missed > 0:
                    logger.debug(
                        f"[TimingEngine] {tier.value}: {missed} missed tick(s), "
                        f"delta={delta*1000:.1f}ms"
                    )

            # Track drift statistics
            drift_ms = abs(delta - interval) * 1000
            stats.avg_drift_ms = stats.avg_drift_ms * 0.99 + drift_ms * 0.01  # EMA
            stats.max_drift_ms = max(stats.max_drift_ms, drift_ms)

            last_tick  = now
            elapsed    = now - self._start_time
            stats.tick_count += 1
            stats.last_tick_at = elapsed

            # E-stop: safety tier broadcasts blackout signal immediately
            if self.estop_active and tier == TickTier.SAFETY:
                for cb in callbacks:
                    try:
                        await cb(elapsed, -1.0)   # delta=-1 signals E-stop
                    except Exception:
                        logger.exception(f"[TimingEngine] SAFETY ESTOP callback error")
                # After E-stop, sleep briefly and re-check (keep broadcasting blackout)
                await asyncio.sleep(interval)
                continue

            # Skip non-safety ticks while E-stop is active
            if self.estop_active and tier != TickTier.SAFETY:
                await asyncio.sleep(interval)
                continue

            # Normal tick: call all registered callbacks
            for cb in callbacks:
                try:
                    await cb(elapsed, delta)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.exception(
                        f"[TimingEngine] Exception in {tier.value} tick callback"
                    )

            # Compute sleep time to hit next tick on schedule
            elapsed_this_tick = time.monotonic() - now
            sleep_time        = max(0, interval - elapsed_this_tick)
            await asyncio.sleep(sleep_time)


# ── Show Clock ────────────────────────────────────────────────────────────────

class ShowClock:
    """
    Monotonic show playback clock with seek, rate control, and external sync.

    The show clock advances independently of wall time; it is driven by the
    SHOW tick tier callback.

    Sync model:
      show_time = (monotonic_now - start_monotonic) * rate + seek_offset
    """

    def __init__(self):
        self._start_monotonic: float = 0.0
        self._seek_offset:     float = 0.0
        self._rate:            float = 1.0
        self._playing:         bool  = False
        self._duration:        float = 0.0

    @property
    def position(self) -> float:
        """Current show time in seconds."""
        if not self._playing:
            return self._seek_offset
        elapsed = (time.monotonic() - self._start_monotonic) * self._rate
        return self._seek_offset + elapsed

    @property
    def is_playing(self) -> bool:
        return self._playing

    def play(self) -> None:
        if self._playing:
            return
        self._start_monotonic = time.monotonic()
        self._playing = True

    def pause(self) -> None:
        if not self._playing:
            return
        self._seek_offset = self.position
        self._playing = False

    def stop(self) -> None:
        self._playing = False
        self._seek_offset = 0.0

    def seek(self, t: float) -> None:
        """Jump playhead to position t (seconds)."""
        self._seek_offset     = max(0.0, min(t, self._duration))
        self._start_monotonic = time.monotonic()

    def set_rate(self, rate: float) -> None:
        """Change playback rate (1.0 = normal, 0.5 = half speed, 2.0 = double)."""
        if not self._playing:
            self._rate = rate
            return
        # Capture current position before changing rate
        current_pos   = self.position
        self._rate    = max(0.01, rate)
        self._seek_offset     = current_pos
        self._start_monotonic = time.monotonic()

    def set_duration(self, duration: float) -> None:
        self._duration = duration

    def sync_to(self, external_time: float, max_jump_s: float = 0.050) -> float:
        """
        Correct the show clock to match an external timecode.
        Applies soft correction if error < max_jump_s, hard seek if larger.

        Returns the correction applied (seconds).
        """
        current = self.position
        error   = external_time - current

        if abs(error) <= max_jump_s:
            # Soft correction: adjust rate slightly
            correction = error * 0.1    # 10% of error per call
            self._seek_offset += correction
            return correction
        else:
            # Hard seek
            self.seek(external_time)
            return error

    def get_state(self) -> dict:
        return {
            "position":  round(self.position, 4),
            "playing":   self._playing,
            "rate":      self._rate,
            "duration":  self._duration,
        }


# ── Singleton ─────────────────────────────────────────────────────────────────

_timing_engine: Optional[TimingEngine] = None
_show_clock:    Optional[ShowClock]    = None


def get_timing_engine() -> TimingEngine:
    global _timing_engine
    if _timing_engine is None:
        _timing_engine = TimingEngine()
    return _timing_engine


def get_show_clock() -> ShowClock:
    global _show_clock
    if _show_clock is None:
        _show_clock = ShowClock()
    return _show_clock
