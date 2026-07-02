"""
diagnostics.py — AquaFlow Phase 7
Persistent fault history and runtime incident logging.
Records every safety state change, transport event, device error,
and protocol fault with timestamp. Survives backend restarts.
"""

import json
import time
import logging
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional
from collections import deque

log = logging.getLogger("aquaflow.diagnostics")

DIAG_DIR  = Path(__file__).parent.parent.parent / "diagnostics"
DIAG_DIR.mkdir(exist_ok=True)
DIAG_FILE = DIAG_DIR / "fault_history.jsonl"


@dataclass
class DiagEvent:
    id: str
    timestamp: float
    level: str          # info | warning | error | critical
    category: str       # safety | transport | device | protocol | compiler | system
    source: str         # which subsystem
    message: str
    data: dict = field(default_factory=dict)

    def to_dict(self):
        return asdict(self)


class DiagnosticsService:
    """
    Persistent diagnostic event store.
    - In-memory ring buffer (last 500 events)
    - Appends to fault_history.jsonl for persistence across restarts
    - Provides filtered query API
    """
    MAX_MEMORY = 500

    def __init__(self):
        self._events: deque = deque(maxlen=self.MAX_MEMORY)
        self._counter = 0
        self._load_recent()
        log.info(f"DiagnosticsService ready — {len(self._events)} events loaded")

    def _load_recent(self):
        """Load last 200 events from disk on startup."""
        if not DIAG_FILE.exists():
            return
        try:
            lines = DIAG_FILE.read_text(encoding="utf-8").strip().splitlines()
            for line in lines[-200:]:
                try:
                    ev = json.loads(line)
                    self._events.append(DiagEvent(**ev))
                except Exception:
                    pass
        except Exception as e:
            log.warning(f"Could not load diagnostic history: {e}")

    def record(
        self,
        level: str,
        category: str,
        source: str,
        message: str,
        data: dict = None,
    ) -> DiagEvent:
        self._counter += 1
        ev = DiagEvent(
            id=f"ev-{int(time.time())}-{self._counter}",
            timestamp=time.time(),
            level=level,
            category=category,
            source=source,
            message=message,
            data=data or {},
        )
        self._events.append(ev)
        # Persist to disk
        try:
            with open(DIAG_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(ev.to_dict()) + "\n")
        except Exception as e:
            log.warning(f"Could not persist diagnostic event: {e}")
        if level in ("error", "critical"):
            log.error(f"[{category}] {source}: {message}")
        return ev

    def get_events(
        self,
        limit: int = 100,
        level: Optional[str] = None,
        category: Optional[str] = None,
        since: Optional[float] = None,
    ) -> list:
        events = list(self._events)
        if level:
            events = [e for e in events if e.level == level]
        if category:
            events = [e for e in events if e.category == category]
        if since:
            events = [e for e in events if e.timestamp >= since]
        events = sorted(events, key=lambda e: e.timestamp, reverse=True)
        return [e.to_dict() for e in events[:limit]]

    def get_summary(self) -> dict:
        events = list(self._events)
        now = time.time()
        last_hour = [e for e in events if e.timestamp >= now - 3600]
        return {
            "total_events": len(events),
            "last_hour": len(last_hour),
            "errors_last_hour": len([e for e in last_hour if e.level in ("error","critical")]),
            "warnings_last_hour": len([e for e in last_hour if e.level == "warning"]),
            "categories": list({e.category for e in events}),
            "latest": events[-1].to_dict() if events else None,
        }

    def clear(self):
        self._events.clear()
        try:
            DIAG_FILE.write_text("", encoding="utf-8")
        except Exception:
            pass


# ─── Singleton ────────────────────────────────────────────────────────────────
_diag: Optional[DiagnosticsService] = None

def get_diagnostics() -> DiagnosticsService:
    global _diag
    if _diag is None:
        _diag = DiagnosticsService()
    return _diag
