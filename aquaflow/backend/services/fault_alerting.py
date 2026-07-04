"""
fault_alerting.py — AquaFlow Recovery, AQ-X-005

Fault alerting system + persistent maintenance log with escalation.

The mobile monitor (AQ-S3-009) already derives alert *conditions* from the operator
status; this module is the authoritative, stateful fault-alerting engine on top of
it:

  * Fault alerts trigger correctly — `raise_fault` / `clear_fault` / `acknowledge`
    manage a de-duplicated alert store; `ingest_status` folds the live safety-kernel
    conditions (via the shared `evaluate_alerts`) into it so real faults raise alerts.
  * Maintenance log persists — every raise / recur / acknowledge / clear / escalation,
    plus explicit maintenance actions (repairs, downtime), is appended to a JSON log
    on disk that reloads on startup, so the history survives a restart.
  * Alert escalation — an unacknowledged alert escalates through tiers over time
    (operator → supervisor → on-call), and a persistently recurring fault escalates on
    occurrence count; escalation can bump severity. Everything is clock-injectable
    (`now` is passed in) so escalation is deterministic and unit-testable.
"""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from services.mobile_monitor import evaluate_alerts, CRITICAL_FAULTS  # shared derivation

# ── Severity + escalation policy ──────────────────────────────────────────────

SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}
_RANK_SEVERITY = {v: k for k, v in SEVERITY_RANK.items()}


def _max_severity(a: str, b: str) -> str:
    return a if SEVERITY_RANK.get(a, 0) >= SEVERITY_RANK.get(b, 0) else b


@dataclass
class EscalationTier:
    level: int
    after_s: float           # seconds unacknowledged before this tier applies
    notify: str              # who is notified at this tier
    severity: Optional[str] = None   # optional severity floor when reaching the tier


# Default policy: operator immediately, supervisor after 1 min, on-call after 5 min
# (which also forces the alert to critical).
DEFAULT_TIERS = [
    EscalationTier(level=1, after_s=60,  notify="supervisor"),
    EscalationTier(level=2, after_s=300, notify="on_call", severity="critical"),
]
# A fault that keeps recurring is escalated regardless of the clock.
RECUR_ESCALATION_THRESHOLD = 3


# ── Maintenance log (persistent) ──────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_LOG_PATH = BASE_DIR / "data" / "maintenance_log.json"


class MaintenanceLog:
    """
    Append-only, disk-backed log of fault + maintenance events.

    Persists as a JSON array so the full history survives a process restart; a fresh
    instance pointed at the same path reloads every prior entry.
    """

    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path else DEFAULT_LOG_PATH
        self._entries: list[dict] = []
        self._load()

    def _load(self):
        if self.path.exists():
            try:
                self._entries = json.loads(self.path.read_text(encoding="utf-8")) or []
            except (json.JSONDecodeError, OSError):
                self._entries = []

    def _persist(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self._entries, indent=2, ensure_ascii=False),
                             encoding="utf-8", newline="")

    def append(self, entry_type: str, *, code: str = "", message: str = "",
               severity: str = "", meta: Optional[dict] = None,
               now: Optional[float] = None) -> dict:
        entry = {
            "id": uuid.uuid4().hex[:12],
            "ts": time.time() if now is None else now,
            "type": entry_type,                     # raised|recurred|acknowledged|cleared|escalated|maintenance
            "code": code,
            "severity": severity,
            "message": message,
            "meta": meta or {},
        }
        self._entries.append(entry)
        self._persist()
        return entry

    def record_maintenance(self, action: str, *, component: str = "", performed_by: str = "",
                           downtime_min: float = 0.0, notes: str = "",
                           now: Optional[float] = None) -> dict:
        """Log an explicit maintenance action (repair, inspection, part swap …)."""
        return self.append(
            "maintenance", code=component, message=action, severity="info",
            meta={"component": component, "performed_by": performed_by,
                  "downtime_min": downtime_min, "notes": notes},
            now=now,
        )

    def entries(self, *, entry_type: Optional[str] = None, code: Optional[str] = None,
                limit: Optional[int] = None) -> list[dict]:
        rows = self._entries
        if entry_type:
            rows = [e for e in rows if e["type"] == entry_type]
        if code:
            rows = [e for e in rows if e["code"] == code]
        rows = list(reversed(rows))              # newest first
        return rows[:limit] if limit else rows

    def reload(self):
        """Re-read from disk (used to prove persistence across instances)."""
        self._entries = []
        self._load()

    def count(self) -> int:
        return len(self._entries)


# ── Fault alert ───────────────────────────────────────────────────────────────

@dataclass
class FaultAlert:
    code: str
    severity: str
    message: str
    source: str = "system"
    raised_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    acknowledged: bool = False
    acknowledged_at: Optional[float] = None
    acknowledged_by: str = ""
    cleared: bool = False
    cleared_at: Optional[float] = None
    occurrences: int = 1
    escalation_level: int = 0
    notify: str = "operator"

    def to_dict(self) -> dict:
        return {
            "code": self.code, "severity": self.severity, "message": self.message,
            "source": self.source, "raised_at": round(self.raised_at, 3),
            "updated_at": round(self.updated_at, 3),
            "acknowledged": self.acknowledged, "acknowledged_by": self.acknowledged_by,
            "cleared": self.cleared, "occurrences": self.occurrences,
            "escalation_level": self.escalation_level, "notify": self.notify,
            "active": not self.cleared,
        }


# ── Fault alert engine ────────────────────────────────────────────────────────

class FaultAlertEngine:
    """Authoritative fault-alert store with escalation and a persistent maintenance log."""

    def __init__(self, log: Optional[MaintenanceLog] = None,
                 tiers: Optional[list[EscalationTier]] = None):
        self._alerts: dict[str, FaultAlert] = {}
        self.log = log if log is not None else MaintenanceLog()
        self.tiers = sorted(tiers if tiers is not None else DEFAULT_TIERS,
                            key=lambda t: t.level)

    # ── Raise / clear / acknowledge ───────────────────────────────────────────
    def raise_fault(self, code: str, severity: str = "warning", message: str = "",
                    source: str = "system", now: Optional[float] = None) -> FaultAlert:
        now = time.time() if now is None else now
        message = message or code.replace("_", " ").title()
        a = self._alerts.get(code)
        if a is None:
            a = FaultAlert(code=code, severity=severity, message=message, source=source,
                           raised_at=now, updated_at=now)
            self._alerts[code] = a
            self.log.append("raised", code=code, severity=severity, message=message, now=now)
        else:
            # Re-raise of a known condition: count the occurrence.
            a.occurrences += 1
            a.updated_at = now
            a.severity = _max_severity(a.severity, severity)
            if a.cleared:                        # reopened after being cleared
                a.cleared = False
                a.cleared_at = None
                a.raised_at = now
            self.log.append("recurred", code=code, severity=a.severity,
                            message=f"Recurred (x{a.occurrences})", now=now)
        return a

    def clear_fault(self, code: str, now: Optional[float] = None) -> bool:
        now = time.time() if now is None else now
        a = self._alerts.get(code)
        if not a or a.cleared:
            return False
        a.cleared = True
        a.cleared_at = now
        a.updated_at = now
        self.log.append("cleared", code=code, severity=a.severity, message="Cleared", now=now)
        return True

    def acknowledge(self, code: str, by: str = "operator", now: Optional[float] = None) -> bool:
        now = time.time() if now is None else now
        a = self._alerts.get(code)
        if not a or a.acknowledged:
            return False
        a.acknowledged = True
        a.acknowledged_at = now
        a.acknowledged_by = by
        a.updated_at = now
        self.log.append("acknowledged", code=code, severity=a.severity,
                        message=f"Acknowledged by {by}", meta={"by": by}, now=now)
        return True

    # ── Escalation ────────────────────────────────────────────────────────────
    def _target_level(self, a: FaultAlert, now: float) -> int:
        """Highest escalation tier this alert qualifies for (time + recurrence)."""
        level = 0
        if not a.acknowledged:
            elapsed = now - a.raised_at
            for tier in self.tiers:
                if elapsed >= tier.after_s:
                    level = max(level, tier.level)
        if a.occurrences >= RECUR_ESCALATION_THRESHOLD:
            level = max(level, 1)                # recurring fault → at least supervisor
        return level

    def evaluate_escalations(self, now: Optional[float] = None) -> list[dict]:
        """Advance escalation for every active alert; log and return the ones that moved."""
        now = time.time() if now is None else now
        moved = []
        for a in self._alerts.values():
            if a.cleared:
                continue
            target = self._target_level(a, now)
            while a.escalation_level < target:
                a.escalation_level += 1
                tier = next((t for t in self.tiers if t.level == a.escalation_level), None)
                if tier:
                    a.notify = tier.notify
                    if tier.severity:
                        a.severity = _max_severity(a.severity, tier.severity)
                a.updated_at = now
                self.log.append("escalated", code=a.code, severity=a.severity,
                                message=f"Escalated to level {a.escalation_level} → {a.notify}",
                                meta={"level": a.escalation_level, "notify": a.notify}, now=now)
                moved.append(a.to_dict())
        return moved

    # ── Live integration ──────────────────────────────────────────────────────
    def ingest_status(self, status: dict, now: Optional[float] = None) -> list[dict]:
        """
        Fold live safety-kernel conditions into the alert store: raise alerts for
        current conditions, clear ones that no longer hold, then run escalation.
        """
        now = time.time() if now is None else now
        conditions = {c["code"]: c for c in evaluate_alerts(status)}
        for code, c in conditions.items():
            self.raise_fault(code, severity=c["severity"], message=c["message"],
                             source="safety_kernel", now=now)
        # Clear active alerts (from the kernel) whose condition no longer holds.
        for code, a in list(self._alerts.items()):
            if a.source == "safety_kernel" and not a.cleared and code not in conditions:
                self.clear_fault(code, now=now)
        self.evaluate_escalations(now=now)
        return self.active(now=now)

    # ── Queries ───────────────────────────────────────────────────────────────
    def active(self, now: Optional[float] = None) -> list[dict]:
        act = [a for a in self._alerts.values() if not a.cleared]
        act.sort(key=lambda a: (-a.escalation_level,
                                -SEVERITY_RANK.get(a.severity, 0), a.raised_at))
        return [a.to_dict() for a in act]

    def all(self) -> list[dict]:
        return [a.to_dict() for a in sorted(self._alerts.values(), key=lambda a: a.raised_at)]

    def get(self, code: str) -> Optional[FaultAlert]:
        return self._alerts.get(code)

    def unacknowledged_count(self) -> int:
        return sum(1 for a in self._alerts.values() if not a.cleared and not a.acknowledged)

    def summary(self, now: Optional[float] = None) -> dict:
        now = time.time() if now is None else now
        act = self.active(now=now)
        return {
            "active": len(act),
            "unacknowledged": self.unacknowledged_count(),
            "escalated": sum(1 for a in act if a["escalation_level"] > 0),
            "critical": sum(1 for a in act if a["severity"] == "critical"),
            "maintenance_entries": self.log.count(),
        }


# ── Singleton ─────────────────────────────────────────────────────────────────

_engine: Optional[FaultAlertEngine] = None


def get_fault_engine() -> FaultAlertEngine:
    global _engine
    if _engine is None:
        _engine = FaultAlertEngine()
    return _engine
