"""
runtime_transport.py — AquaFlow Phase 6

AF-HUB-013 — DEMOTED to a DRIVEN transport-state + snapshot mirror. It is NOT a timing
authority and no longer runs an independent clock/loop.

The single playback timing + output authority is engine/show_engine.ShowEngine (its 100 Hz
_playback_loop advances the playhead AND dispatches to the protocol bus). RuntimeTransport
used to run a SECOND independent 100 Hz loop advancing its own position_ms — two loops
commanding the same show is exactly the split-authority problem the runtime hardening set
out to remove, and would be nondeterministic on real hardware.

Now: ShowEngine is the one clock; it pushes position/state into this transport via
sync_from_engine(). This class keeps the transport STATE machine, rollback snapshots, and
safety go_live/stop_live integration for the UI/API, but it never advances time on its own
and has NO output-dispatch path.
"""

import asyncio
import time
import logging
from enum import Enum, auto
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Callable, Any
from collections import deque

log = logging.getLogger("aquaflow.transport")


# ─── Transport States ─────────────────────────────────────────────────────────
class TransportState(str, Enum):
    IDLE     = "IDLE"     # no show loaded
    READY    = "READY"    # show loaded, safety armed, ready to play
    PLAYING  = "PLAYING"  # show running
    PAUSED   = "PAUSED"   # show paused, position held
    STOPPED  = "STOPPED"  # show stopped, position at 0
    FAULT    = "FAULT"    # stopped due to safety fault
    ENDED    = "ENDED"    # show reached end naturally


# ─── Snapshot ─────────────────────────────────────────────────────────────────
@dataclass
class TransportSnapshot:
    """Point-in-time snapshot of show state for rollback."""
    timestamp: float
    position_ms: int          # show position in milliseconds
    transport_state: TransportState
    signal_values: Dict[str, float] = field(default_factory=dict)
    device_states: Dict[str, Any]  = field(default_factory=dict)
    safety_state: str = "UNKNOWN"
    label: str = ""

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "position_ms": self.position_ms,
            "transport_state": self.transport_state,
            "signal_values": self.signal_values,
            "safety_state": self.safety_state,
            "label": self.label,
        }


# ─── Runtime Transport ────────────────────────────────────────────────────────
class RuntimeTransport:
    """
    Driven transport-state + snapshot mirror (AF-HUB-013 — NOT a timing authority).
    - PLAY / PAUSE / STOP / SEEK operations reflect state for the UI/API
    - Safety kernel integration — transport cannot enter PLAYING without permit
    - Position/state are pushed by the single authority (ShowEngine) via sync_from_engine()
    - Rollback snapshot ring buffer (last 50 snapshots)
    - Callbacks for position updates and state changes
    """
    # AF-HUB-013 — this component does NOT own playback timing.
    TIMING_AUTHORITY = False
    SNAPSHOT_INTERVAL = 2.0    # seconds between automatic snapshots
    MAX_SNAPSHOTS = 50

    def __init__(self, safety_kernel=None):
        self._safety = safety_kernel
        self._state = TransportState.IDLE
        self._position_ms: int = 0
        self._duration_ms: int = 0
        self._show_id: Optional[str] = None
        self._play_start_mono: float = 0.0   # monotonic time when play began
        self._play_start_pos: int = 0        # position_ms at play start
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._snapshots: deque = deque(maxlen=self.MAX_SNAPSHOTS)
        self._last_snapshot_time: float = 0.0
        self._position_callbacks: List[Callable] = []
        self._state_callbacks: List[Callable] = []
        self._tick_count = 0
        self._current_signals: Dict[str, float] = {}
        log.info("RuntimeTransport initialised")

    # ─── Public transport API ─────────────────────────────────────────────────
    def load_show(self, show_id: str, duration_ms: int):
        """Load a show. Must be called before play."""
        self._show_id = show_id
        self._duration_ms = duration_ms
        self._position_ms = 0
        self._transition(TransportState.READY)
        log.info(f"Show loaded: {show_id} duration={duration_ms}ms")

    def play(self) -> bool:
        """Start or resume playback. Requires safety permit."""
        if self._state not in (TransportState.READY, TransportState.PAUSED,
                                TransportState.STOPPED, TransportState.ENDED):
            log.warning(f"PLAY rejected — state: {self._state}")
            return False
        if not self._safety_permit():
            log.warning("PLAY rejected — no safety permit")
            return False

        # Safety integration:
        # If the safety kernel is ARMED, runtime playback must move it to LIVE.
        # This allows LIVE-only subsystems such as flame/laser permits to work correctly.
        if self._safety is not None and hasattr(self._safety, "go_live"):
            safety_state = getattr(getattr(self._safety, "state", ""), "value", str(getattr(self._safety, "state", "")))
            if safety_state == "ARMED":
                if not self._safety.go_live():
                    log.warning("PLAY rejected — safety kernel refused LIVE transition")
                    return False

        # AF-HUB-013 — no independent clock: PLAYING is a state; the playhead is advanced
        # only by the single authority (ShowEngine) via sync_from_engine().
        self._transition(TransportState.PLAYING)
        self._take_snapshot("play_start")
        log.info(f"PLAY — position: {self._position_ms}ms")
        return True

    def pause(self) -> bool:
        if self._state != TransportState.PLAYING:
            return False

        # Position is already whatever the authority last synced — just freeze the state.

        # Safety integration:
        # Pausing removes active LIVE output state but keeps the system armed.
        if self._safety is not None and hasattr(self._safety, "stop_live"):
            safety_state = getattr(getattr(self._safety, "state", ""), "value", str(getattr(self._safety, "state", "")))
            if safety_state == "LIVE":
                self._safety.stop_live()

        self._transition(TransportState.PAUSED)
        self._take_snapshot("pause")
        log.info(f"PAUSE — position: {self._position_ms}ms")
        return True

    def stop(self) -> bool:
        if self._state == TransportState.IDLE:
            return False

        self._take_snapshot("stop")
        self._position_ms = 0

        # Safety integration:
        # If runtime stops while safety is LIVE, return safety to ARMED.
        if self._safety is not None and hasattr(self._safety, "stop_live"):
            safety_state = getattr(getattr(self._safety, "state", ""), "value", str(getattr(self._safety, "state", "")))
            if safety_state == "LIVE":
                self._safety.stop_live()

        self._transition(TransportState.STOPPED)
        log.info("STOP")
        return True

    def seek(self, position_ms: int) -> bool:
        """Seek to position. Works in PAUSED, STOPPED, READY states."""
        if self._state == TransportState.IDLE:
            return False
        position_ms = max(0, min(position_ms, self._duration_ms))
        was_playing = self._state == TransportState.PLAYING
        if was_playing:
            # Pause, seek, resume
            self.pause()
        self._position_ms = position_ms
        self._take_snapshot(f"seek_{position_ms}")
        if was_playing:
            self.play()
        log.info(f"SEEK → {position_ms}ms")
        return True

    def emergency_stop(self):
        """Hard stop from safety kernel — immediate regardless of state."""
        log.critical("Transport EMERGENCY STOP")
        self._take_snapshot("emergency_stop")
        self._position_ms = 0
        self._transition(TransportState.FAULT)

    def recover(self) -> bool:
        """Recover from FAULT back to READY if safety permits."""
        if self._state != TransportState.FAULT:
            return False
        if not self._safety_permit():
            return False
        self._position_ms = 0
        self._transition(TransportState.READY)
        log.info("Transport recovered from FAULT → READY")
        return True

    # ─── Rollback API ─────────────────────────────────────────────────────────
    def rollback(self, steps: int = 1) -> Optional[TransportSnapshot]:
        """Roll back N snapshots and restore that position."""
        if len(self._snapshots) < steps + 1:
            log.warning(f"Rollback {steps} steps impossible — only {len(self._snapshots)} snapshots")
            return None
        target = list(self._snapshots)[-(steps + 1)]
        self._position_ms = target.position_ms
        if self._state == TransportState.PLAYING:
            # Re-sync play clock to rolled-back position
            self._play_start_mono = time.monotonic()
            self._play_start_pos = self._position_ms
        log.info(f"Rollback {steps} steps → pos={target.position_ms}ms label={target.label}")
        return target

    def get_snapshots(self) -> List[dict]:
        return [s.to_dict() for s in self._snapshots]

    def get_latest_snapshot(self) -> Optional[TransportSnapshot]:
        return self._snapshots[-1] if self._snapshots else None

    # ─── Signal feed ──────────────────────────────────────────────────────────
    def update_signals(self, signals: Dict[str, float]):
        """Called by show engine each tick with current signal values."""
        self._current_signals = signals

    # ─── Callbacks ────────────────────────────────────────────────────────────
    def on_position(self, cb: Callable):
        """Callback(position_ms, state) called every tick."""
        self._position_callbacks.append(cb)

    def on_state_change(self, cb: Callable):
        """Callback(old_state, new_state) on transitions."""
        self._state_callbacks.append(cb)

    # ─── Lifecycle (AF-HUB-013: NO independent timing loop) ────────────────────
    async def start(self):
        """DEMOTED — starts NO independent clock. The single playback authority
        (ShowEngine) drives this transport via sync_from_engine(). Kept async so the
        application lifespan can call it uniformly."""
        self._running = False
        log.info("RuntimeTransport in DRIVEN mode (no independent 100 Hz loop) — "
                 "ShowEngine is the sole playback authority")

    async def stop_loop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try: await self._task
            except asyncio.CancelledError: pass
        self._task = None

    def sync_from_engine(self, position_ms: int, is_playing: bool,
                         duration_ms: Optional[int] = None) -> None:
        """The single playback authority (ShowEngine) pushes its playhead + play-state here
        each tick. This is the ONLY way the transport position advances — the transport has
        no clock of its own, so two loops can never command the fixtures independently."""
        self._tick_count += 1
        if duration_ms is not None:
            self._duration_ms = duration_ms

        if is_playing:
            # Safety permit lost mid-play → fault (mirrors the engine's own output gate).
            if not self._safety_permit():
                log.error("Safety permit lost during playback — transport FAULT")
                self.emergency_stop()
                return
            if self._state in (TransportState.READY, TransportState.PAUSED,
                               TransportState.STOPPED, TransportState.ENDED):
                self._transition(TransportState.PLAYING)
            self._position_ms = max(0, min(position_ms, self._duration_ms or position_ms))
            if self._duration_ms and self._position_ms >= self._duration_ms:
                self._position_ms = self._duration_ms
                self._transition(TransportState.ENDED)
                self._take_snapshot("show_end")
            now = time.time()
            if now - self._last_snapshot_time >= self.SNAPSHOT_INTERVAL:
                self._take_snapshot("auto")
                self._last_snapshot_time = now
        else:
            self._position_ms = max(0, position_ms)
            if self._state == TransportState.PLAYING:
                self._transition(TransportState.PAUSED)

        for cb in self._position_callbacks:
            try: cb(self._position_ms, self._state)
            except: pass

    def _safety_permit(self) -> bool:
        if self._safety is None:
            return True   # no safety kernel attached — allow (dev mode)
        return self._safety.outputs.permit

    def _take_snapshot(self, label: str = ""):
        snap = TransportSnapshot(
            timestamp=time.time(),
            position_ms=self._position_ms,
            transport_state=self._state,
            signal_values=dict(self._current_signals),
            safety_state=self._safety.state if self._safety else "NO_SAFETY",
            label=label,
        )
        self._snapshots.append(snap)

    def _transition(self, new_state: TransportState):
        if new_state == self._state:
            return
        old = self._state
        self._state = new_state
        log.info(f"Transport: {old} → {new_state}")
        for cb in self._state_callbacks:
            try: cb(old, new_state)
            except: pass

    # ─── Status ───────────────────────────────────────────────────────────────
    def get_status(self) -> dict:
        return {
            "state": self._state,
            "position_ms": self._position_ms,
            "duration_ms": self._duration_ms,
            "show_id": self._show_id,
            "tick_count": self._tick_count,
            "snapshot_count": len(self._snapshots),
            "safety_permit": self._safety_permit(),
        }


# ─── Singleton ────────────────────────────────────────────────────────────────
_transport: Optional[RuntimeTransport] = None

def get_transport() -> RuntimeTransport:
    global _transport
    if _transport is None:
        from safety.safety_kernel import get_safety_kernel
        _transport = RuntimeTransport(safety_kernel=get_safety_kernel())
    return _transport
