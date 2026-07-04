"""
mobile_monitor.py — AquaFlow Stage 3, Priority 9 (AQ-S3-009)

Backend for the Mobile Monitoring App. Turns the operator status (safety kernel,
transport, show engine — see /api/operator/status) into a compact, phone-friendly
monitoring feed, raises prioritized alerts from faults/interlocks, and validates
remote-control commands against the live safety state before they touch hardware.

Three responsibilities, matching the acceptance criteria:
  * Live monitoring   — build_snapshot(status): condensed live state + progress.
  * Alerts            — evaluate_alerts(status) + AlertManager: prioritized,
                        de-duplicated, acknowledgeable alerts.
  * Remote control    — validate_remote_command(cmd, status): only allow a command
                        the current safety state permits (E-stop always allowed,
                        play blocked on conflict / no permit / E-stop).

Pure and framework-agnostic (operates on a status dict) so it is fully unit-tested
without a running server; the route wires it to the live singletons.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

ESTOP_STATES = {"EMERGENCY_STOP", "ESTOP"}
# Faults that are safety-critical vs. merely a warning on the phone.
CRITICAL_FAULTS = {
    "ESTOP_OPEN", "OVER_PRESSURE", "PUMP_DRY_RUN", "THERMAL_OVERLOAD",
    "VFD_FAULT", "LOW_WATER", "FLAME_INHIBIT", "LASER_INHIBIT",
}
SUBSYSTEMS = ["pump", "valve", "flame", "laser", "fog", "lighting"]

REMOTE_COMMANDS = {"play", "pause", "stop", "seek", "arm", "disarm",
                   "estop", "reset", "blackout"}
# Commands allowed regardless of state (safety actions).
ALWAYS_ALLOWED = {"estop", "stop", "blackout", "disarm"}


# ── Live monitoring ─────────────────────────────────────────────────────────────
def build_snapshot(status: dict) -> dict:
    """Condense the full operator status into a mobile monitoring snapshot."""
    safety = status.get("safety", {}) or {}
    transport = status.get("transport", {}) or {}
    engine = status.get("engine", {}) or {}
    inputs = safety.get("inputs", {}) or {}

    faults = list(safety.get("active_faults") or safety.get("latched_faults") or [])
    conflicts = status.get("hardware_conflicts") or engine.get("hardware_conflicts") or []
    state = str(safety.get("state", "UNKNOWN"))
    playing = (str(transport.get("state", "")).upper() == "PLAYING"
               or str(engine.get("state", "")).upper() in ("PLAYING", "RUNNING"))

    pos = float(transport.get("position_ms", 0) or 0)
    dur = float(transport.get("duration_ms", 0) or (float(engine.get("duration", 0) or 0) * 1000))
    plc_online = bool(inputs.get("plc_heartbeat_ok", True))

    if state in ESTOP_STATES:
        health = "estop"
    elif conflicts or any(str(f) in CRITICAL_FAULTS for f in faults):
        health = "critical"
    elif faults or not plc_online:
        health = "warning"
    elif playing:
        health = "live"
    else:
        health = "idle"

    return {
        "timestamp": time.time(),
        "state": state,
        "health": health,               # estop|critical|warning|live|idle
        "playing": playing,
        "position_ms": round(pos, 1),
        "duration_ms": round(dur, 1),
        "progress_pct": round(pos / dur * 100.0, 1) if dur > 0 else 0.0,
        "permit": bool(safety.get("permit", False)),
        "fault_count": len(faults),
        "faults": [str(f) for f in faults[:10]],
        "hardware_conflicts": len(conflicts),
        "plc_online": plc_online,
        "show_id": transport.get("show_id") or engine.get("show_id"),
        "subsystems": {k: bool(safety.get(k + "_enable", False)) for k in SUBSYSTEMS},
    }


# ── Alerts ──────────────────────────────────────────────────────────────────────
def evaluate_alerts(status: dict) -> list[dict]:
    """Derive the current alert conditions from the status (pure, order-stable)."""
    safety = status.get("safety", {}) or {}
    inputs = safety.get("inputs", {}) or {}
    state = str(safety.get("state", ""))
    faults = list(safety.get("active_faults") or [])
    conflicts = status.get("hardware_conflicts") or []
    out: list[dict] = []
    seen = set()

    def add(code, severity, message):
        if code in seen:
            return
        seen.add(code)
        out.append({"code": code, "severity": severity, "message": message})

    if state in ESTOP_STATES:
        add("ESTOP", "critical", "Emergency stop active — all hardware output inhibited.")
    if conflicts:
        add("HW_CONFLICT", "critical",
            f"Hardware address conflict — {len(conflicts)} issue(s). Show is blocked.")
    for f in faults:
        fs = str(f)
        sev = "critical" if fs in CRITICAL_FAULTS else "warning"
        add(fs, sev, "Fault: " + fs.replace("_", " ").title())
    if inputs.get("water_level_ok", True) is False:
        add("LOW_WATER", "critical", "Low water level detected.")
    if inputs.get("pressure_ok", True) is False:
        add("OVER_PRESSURE", "critical", "Manifold pressure over limit.")
    if inputs.get("plc_heartbeat_ok", True) is False:
        add("PLC_COMM_LOSS", "warning", "PLC heartbeat lost — communications degraded.")
    return out


@dataclass
class Alert:
    code: str
    severity: str
    message: str
    raised_at: float = field(default_factory=time.time)
    acknowledged: bool = False
    cleared: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.code, "code": self.code, "severity": self.severity,
            "message": self.message, "raised_at": round(self.raised_at, 3),
            "acknowledged": self.acknowledged, "cleared": self.cleared,
        }


class AlertManager:
    """Stateful alert store: de-duplicates by code, tracks ack, clears resolved."""
    SEV_RANK = {"critical": 0, "warning": 1, "info": 2}

    def __init__(self):
        self._alerts: dict[str, Alert] = {}

    def ingest(self, status: dict) -> list[dict]:
        """Fold the current evaluated conditions into the store; return active alerts."""
        current = {a["code"]: a for a in evaluate_alerts(status)}
        # Raise/keep current conditions.
        for code, a in current.items():
            ex = self._alerts.get(code)
            if ex and not ex.cleared:
                ex.severity, ex.message = a["severity"], a["message"]
            else:
                self._alerts[code] = Alert(code=code, severity=a["severity"], message=a["message"])
        # Clear conditions that no longer hold.
        for code, al in self._alerts.items():
            if code not in current:
                al.cleared = True
        return self.active()

    def active(self) -> list[dict]:
        act = [a for a in self._alerts.values() if not a.cleared]
        act.sort(key=lambda a: (self.SEV_RANK.get(a.severity, 9), a.raised_at))
        return [a.to_dict() for a in act]

    def all(self) -> list[dict]:
        return [a.to_dict() for a in sorted(self._alerts.values(), key=lambda a: a.raised_at)]

    def acknowledge(self, code: str) -> bool:
        a = self._alerts.get(code)
        if a:
            a.acknowledged = True
            return True
        return False

    def unacknowledged_count(self) -> int:
        return sum(1 for a in self._alerts.values() if not a.cleared and not a.acknowledged)


# ── Remote control ──────────────────────────────────────────────────────────────
def validate_remote_command(command: str, status: dict) -> dict:
    """
    Decide whether a remote command may run given the current safety state.
    Returns {allowed, reason, command}. Safety actions (estop/stop/blackout/
    disarm) are always allowed; play is gated on permit, hardware conflicts and
    E-stop.
    """
    cmd = str(command or "").lower().strip()
    safety = status.get("safety", {}) or {}
    state = str(safety.get("state", ""))
    conflicts = status.get("hardware_conflicts") or []

    if cmd not in REMOTE_COMMANDS:
        return {"allowed": False, "reason": f"Unknown command '{command}'.", "command": cmd}
    if cmd in ALWAYS_ALLOWED or cmd == "reset":
        return {"allowed": True, "reason": "Safety/permitted action.", "command": cmd}

    if state in ESTOP_STATES and cmd in ("play", "arm"):
        return {"allowed": False, "reason": "Emergency stop active — reset before starting.", "command": cmd}
    if cmd == "play":
        if conflicts:
            return {"allowed": False,
                    "reason": f"Hardware address conflict ({len(conflicts)}) — resolve before playing.",
                    "command": cmd}
        if not safety.get("permit", False):
            return {"allowed": False, "reason": "System not armed — no live permit.", "command": cmd}
    if cmd == "arm" and state in ESTOP_STATES:
        return {"allowed": False, "reason": "Cannot arm during emergency stop.", "command": cmd}

    return {"allowed": True, "reason": "OK.", "command": cmd}


# ── Module singleton for the route ──────────────────────────────────────────────
_manager: Optional[AlertManager] = None


def get_alert_manager() -> AlertManager:
    global _manager
    if _manager is None:
        _manager = AlertManager()
    return _manager


def build_mobile_status(status: dict) -> dict:
    """Full mobile payload: snapshot + active alerts + unacked count."""
    mgr = get_alert_manager()
    alerts = mgr.ingest(status)
    return {
        "snapshot": build_snapshot(status),
        "alerts": alerts,
        "alert_count": len(alerts),
        "unacknowledged": mgr.unacknowledged_count(),
    }
