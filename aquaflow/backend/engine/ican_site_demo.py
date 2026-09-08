"""Server-side runner for the hardware-proven one-minute I-CAN site demo."""
from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Callable, Sequence

from engine.ican_site_demo_sequence import (
    SITE_DEMO_DURATION_S,
    SITE_DEMO_EVENTS,
    SITE_DEMO_GROUPS,
    SiteDemoEvent,
)


class SiteDemoStartError(RuntimeError):
    """The requested demo cannot start in the current connection/safety state."""


def _default_safety_permit() -> bool:
    from safety.safety_kernel import get_safety_kernel

    return bool(get_safety_kernel().outputs.permit)


class ICANSiteDemo:
    """Play captured absolute group states through the proven I-CAN connection.

    Playback lives in the backend, so changing panels or losing a browser render does
    not orphan a client-side timer. Every exit path blackouts every group the sequence
    touched. The connection remains armed after a normal/manual stop and therefore
    continues streaming the all-off state until the operator disarms or disconnects.
    """

    def __init__(
        self,
        events: Sequence[SiteDemoEvent] = SITE_DEMO_EVENTS,
        duration_s: float = SITE_DEMO_DURATION_S,
        safety_permit: Callable[[], bool] = _default_safety_permit,
    ):
        self.events = tuple(events)
        self.duration_s = float(duration_s)
        self.groups = tuple(sorted({event.group for event in self.events}))
        self._safety_permit = safety_permit
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._connection = None
        self._run_id = ""
        self._started_wall: float | None = None
        self._started_mono: float | None = None
        self._ended_wall: float | None = None
        self._frames_sent = 0
        self._last_event: SiteDemoEvent | None = None
        self._outcome = "idle"
        self._error = ""
        self._stop_reason = "operator"

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def _permit(self) -> bool:
        try:
            return bool(self._safety_permit())
        except Exception:
            return False

    def status(self) -> dict:
        elapsed = 0.0
        if self._started_mono is not None:
            if self.running:
                elapsed = min(self.duration_s, time.monotonic() - self._started_mono)
            elif self._started_wall is not None and self._ended_wall is not None:
                elapsed = min(self.duration_s, self._ended_wall - self._started_wall)
        return {
            "running": self.running,
            "run_id": self._run_id,
            "outcome": self._outcome,
            "duration_s": self.duration_s,
            "elapsed_s": round(max(0.0, elapsed), 2),
            "remaining_s": round(max(0.0, self.duration_s - elapsed), 2),
            "frames_sent": self._frames_sent,
            "total_events": len(self.events),
            "groups": list(self.groups or SITE_DEMO_GROUPS),
            "started_at": self._started_wall,
            "ended_at": self._ended_wall,
            "last_event": ({
                "at_s": self._last_event.at_s,
                "group": self._last_event.group,
                "channels": list(self._last_event.channels),
            } if self._last_event else None),
            "error": self._error,
        }

    async def start(self, connection) -> dict:
        if self.running:
            raise SiteDemoStartError("the one-minute fountain demo is already running")
        state = connection.status()
        if state.get("state") != "connected":
            raise SiteDemoStartError("connect the I-CAN gateway before starting the demo")
        if not state.get("output_enabled"):
            raise SiteDemoStartError("arm I-CAN output before starting the demo")
        if not self._permit():
            raise SiteDemoStartError("arm the safety system before starting the demo")
        if not self.events:
            raise SiteDemoStartError("the site demo contains no captured events")

        self._connection = connection
        self._stop_event = asyncio.Event()
        self._run_id = uuid.uuid4().hex[:12]
        self._started_wall = time.time()
        self._started_mono = time.monotonic()
        self._ended_wall = None
        self._frames_sent = 0
        self._last_event = None
        self._outcome = "running"
        self._error = ""
        self._stop_reason = "operator"
        self._task = asyncio.create_task(
            self._run(), name=f"ican-site-demo-{self._run_id}")
        # Let the zero-second events reach the socket before the API reports success.
        await asyncio.sleep(0)
        return self.status()
    async def _wait_until(self, target: float) -> str | None:
        """Wait in short slices so STOP and a lost safety permit take effect quickly."""
        while True:
            if self._stop_event is not None and self._stop_event.is_set():
                return "stopped"
            if not self._permit():
                return "safety_stopped"
            delay = target - time.monotonic()
            if delay <= 0:
                return None
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=min(delay, 0.1))
            except asyncio.TimeoutError:
                continue

    async def _run(self):
        connection = self._connection
        start = self._started_mono or time.monotonic()
        try:
            for event in self.events:
                interrupted = await self._wait_until(start + event.at_s)
                if interrupted:
                    self._outcome = (self._stop_reason if interrupted == "stopped"
                                     else "safety_stopped")
                    if interrupted == "safety_stopped":
                        self._error = "safety permit was withdrawn during the demo"
                    break
                ok = await connection.send_output(
                    event.group, event.channels, confirmed=True, user="site-demo")
                if not ok:
                    self._outcome = "error"
                    self._error = f"I-CAN output was refused at {event.at_s:.2f}s"
                    break
                self._frames_sent += 1
                self._last_event = event
            else:
                interrupted = await self._wait_until(start + self.duration_s)
                if interrupted:
                    self._outcome = (self._stop_reason if interrupted == "stopped"
                                     else "safety_stopped")
                    if interrupted == "safety_stopped":
                        self._error = "safety permit was withdrawn during the demo"
                else:
                    self._outcome = "completed"
        except asyncio.CancelledError:
            self._outcome = self._stop_reason or "cancelled"
        except Exception as exc:  # defensive: cleanup must still execute
            self._outcome = "error"
            self._error = str(exc)
        finally:
            try:
                ok = await asyncio.shield(connection.blackout())
                if not ok and not self._error:
                    self._error = "one or more final all-off frames failed"
                    if self._outcome == "completed":
                        self._outcome = "error"
            except Exception as exc:  # pragma: no cover - hardware/OS dependent
                self._error = f"final all-off failed: {exc}"
                self._outcome = "error"
            self._ended_wall = time.time()

    async def stop(self, reason: str = "stopped") -> dict:
        if self.running and self._stop_event is not None:
            self._stop_reason = reason
            self._stop_event.set()
            try:
                await asyncio.wait_for(asyncio.shield(self._task), timeout=3.0)
            except asyncio.TimeoutError:
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
        return self.status()
