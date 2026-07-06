"""
runtime_health.py — AF-HUB-007B runtime health monitoring.

Health signals were scattered across subsystems (protocol bus driver connectivity, the
safety kernel state + faults, device online/offline counts, show-engine hardware
conflicts) and /api/health simply returned a hardcoded "status": "ok" — so a degraded
runtime (disconnected drivers, PLC heartbeat lost, address conflicts blocking playback,
an E-stop latched) reported healthy.

RuntimeHealthMonitor is one aggregator that reads every registered subsystem, records the
issues, and produces a single verdict — ok / degraded / critical — with the specific
reasons. Registration-based (dependency-light, unit-testable); each subsystem read is
isolated so one broken getter surfaces as an issue instead of crashing the health check.
"""
from __future__ import annotations

import time

OK = "ok"
DEGRADED = "degraded"
CRITICAL = "critical"
_RANK = {OK: 0, DEGRADED: 1, CRITICAL: 2}


class RuntimeHealthMonitor:
    def __init__(self):
        self._safety = None
        self._protocol_bus = None
        self._device_manager = None
        self._show_engine = None
        self._runtime_authority = None

    def register(self, *, safety=None, protocol_bus=None, device_manager=None,
                 show_engine=None, runtime_authority=None) -> "RuntimeHealthMonitor":
        if safety is not None:
            self._safety = safety
        if protocol_bus is not None:
            self._protocol_bus = protocol_bus
        if device_manager is not None:
            self._device_manager = device_manager
        if show_engine is not None:
            self._show_engine = show_engine
        if runtime_authority is not None:
            self._runtime_authority = runtime_authority
        return self

    # ── individual checks (each isolated by _guard) ────────────────────────────
    def _check_safety(self, issues, subsystems):
        st = self._safety.get_status()
        state = str(st.get("state", "UNKNOWN"))
        inputs = st.get("inputs", {}) or {}
        active = list(st.get("active_faults", []) or [])
        subsystems["safety"] = {
            "state": state, "permit": st.get("permit"),
            "active_faults": active, "latched_faults": list(st.get("latched_faults", []) or []),
        }
        if state == "EMERGENCY_STOP":
            issues.append((CRITICAL, "safety", "Emergency stop active — hardware output inhibited"))
        elif state in ("FAULT", "RECOVERY"):
            issues.append((CRITICAL, "safety", f"Safety {state} — outputs zeroed, recovery required"))
        elif state == "MAINTENANCE":
            issues.append((DEGRADED, "safety", "Maintenance mode — outputs limited"))
        if inputs.get("plc_heartbeat_ok") is False:
            issues.append((CRITICAL, "safety", "PLC heartbeat lost"))
        if inputs.get("estop_chain_closed") is False:
            issues.append((CRITICAL, "safety", "E-stop chain open"))
        if inputs.get("water_level_ok") is False:
            issues.append((CRITICAL, "safety", "Low water level"))
        if inputs.get("pressure_ok") is False:
            issues.append((DEGRADED, "safety", "Pressure out of range"))
        for f in active:
            issues.append((CRITICAL, "safety", f"Active fault: {f}"))

    def _check_protocol_bus(self, issues, subsystems):
        st = self._protocol_bus.get_status()
        drivers = st.get("drivers", {}) or {}
        running = bool(st.get("running"))
        connected = sum(1 for d in drivers.values() if isinstance(d, dict) and d.get("connected"))
        subsystems["protocol_bus"] = {
            "running": running, "driver_count": len(drivers), "connected": connected,
        }
        if running and len(drivers) == 0:
            issues.append((DEGRADED, "protocol_bus", "No protocol drivers connected"))
        elif len(drivers) > 0 and connected == 0:
            issues.append((DEGRADED, "protocol_bus", f"All {len(drivers)} protocol drivers disconnected"))

    def _check_devices(self, issues, subsystems):
        summ = self._device_manager.get_summary()
        subsystems["devices"] = summ
        if summ.get("offline"):
            issues.append((DEGRADED, "devices", f"{summ['offline']} device(s) offline"))
        if summ.get("warn"):
            issues.append((DEGRADED, "devices", f"{summ['warn']} device(s) in warning"))

    def _check_show_engine(self, issues, subsystems):
        st = self._show_engine.get_state()
        conflicts = list(st.get("hardware_conflicts", []) or [])
        error = st.get("error")
        subsystems["show_engine"] = {
            "state": st.get("state"), "conflict_count": len(conflicts), "error": error or "",
        }
        if conflicts:
            issues.append((CRITICAL, "show_engine",
                           f"{len(conflicts)} hardware address conflict(s) — playback blocked"))
        if error:
            issues.append((DEGRADED, "show_engine", f"Engine error: {error}"))

    def _check_commissioning(self, issues, subsystems):
        # Informational only — simulated (uncommissioned) output is the expected pre-bench
        # state, not a health failure, so it never degrades the verdict.
        from services.commissioning import commissioning_status
        subsystems["commissioning"] = commissioning_status()

    def _check_runtime_authority(self, issues, subsystems):
        subsystems["runtime_authority"] = self._runtime_authority.get_status()

    def snapshot(self) -> dict:
        issues: list[tuple[str, str, str]] = []
        subsystems: dict = {}
        checks = [
            ("safety", self._safety, self._check_safety),
            ("protocol_bus", self._protocol_bus, self._check_protocol_bus),
            ("devices", self._device_manager, self._check_devices),
            ("show_engine", self._show_engine, self._check_show_engine),
            ("commissioning", True, self._check_commissioning),
            ("runtime_authority", self._runtime_authority, self._check_runtime_authority),
        ]
        for name, target, fn in checks:
            if target is None:
                subsystems[name] = {"registered": False}
                continue
            try:
                fn(issues, subsystems)
            except Exception as exc:  # a broken getter must not crash the health check
                subsystems[name] = {"error": str(exc)}
                issues.append((DEGRADED, name, f"Health read failed: {exc}"))

        status = OK
        for sev, _, _ in issues:
            if _RANK[sev] > _RANK[status]:
                status = sev
        return {
            "status": status,
            "healthy": status == OK,
            "issues": [{"severity": s, "subsystem": sub, "message": m} for s, sub, m in issues],
            "subsystems": subsystems,
            "checked_at": time.time(),
        }


# The one shared monitor. Core actors register in app_state; the safety kernel registers
# in the application lifespan.
runtime_health = RuntimeHealthMonitor()
