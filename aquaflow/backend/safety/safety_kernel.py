"""
safety_kernel.py — AquaFlow Phase 6
Deterministic safety state machine with interlocks, watchdogs, and E-stop chain.
This module runs as a separate fast loop (50 Hz) inside the backend process.
In a future Rust runtime this logic moves to lux-safety, but for now it lives here
and provides the authoritative safety permit that the show engine must check before
every output tick.
"""

import asyncio
import time
import logging
from enum import Enum, auto
from dataclasses import dataclass, field
from typing import Dict, Optional, Callable, List

log = logging.getLogger("aquaflow.safety")


# ─── Safety States ────────────────────────────────────────────────────────────
class SafetyState(str, Enum):
    BOOT            = "BOOT"           # initialising, no outputs
    SAFE_IDLE       = "SAFE_IDLE"      # online, all outputs at safe defaults
    ARMED           = "ARMED"          # operator has armed the system
    LIVE            = "LIVE"           # show running, outputs active
    FAULT           = "FAULT"          # recoverable fault, outputs zeroed
    EMERGENCY_STOP  = "EMERGENCY_STOP" # E-stop chain open, hard inhibit
    RECOVERY        = "RECOVERY"       # manual recovery required before re-arm
    MAINTENANCE     = "MAINTENANCE"    # maintenance mode, limited outputs
    DRY_RUN         = "DRY_RUN"        # simulation only, no real hardware output


# ─── Fault codes ─────────────────────────────────────────────────────────────
class FaultCode(str, Enum):
    NONE                = "NONE"
    LOW_WATER           = "LOW_WATER"
    OVER_PRESSURE       = "OVER_PRESSURE"
    PUMP_DRY_RUN        = "PUMP_DRY_RUN"
    VALVE_TIMEOUT       = "VALVE_TIMEOUT"
    VFD_FAULT           = "VFD_FAULT"
    PLC_COMM_LOSS       = "PLC_COMM_LOSS"
    THERMAL_OVERLOAD    = "THERMAL_OVERLOAD"
    FLAME_INHIBIT       = "FLAME_INHIBIT"
    LASER_INHIBIT       = "LASER_INHIBIT"
    ESTOP_OPEN          = "ESTOP_OPEN"
    WATCHDOG_MISSED     = "WATCHDOG_MISSED"
    RUNTIME_FAULT       = "RUNTIME_FAULT"
    DEVICE_COMM_LOSS    = "DEVICE_COMM_LOSS"
    SENSOR_FAULT        = "SENSOR_FAULT"    # AF-IO-004: a REQUIRED field sensor is not GOOD
    UNKNOWN             = "UNKNOWN"


@dataclass
class FaultEvent:
    code: FaultCode
    message: str
    timestamp: float = field(default_factory=time.time)
    latched: bool = False    # latched faults require manual reset
    source: str = "kernel"


@dataclass
class SafetyInputs:
    """Live sensor/status inputs fed into the safety kernel each tick."""
    water_level_ok:      bool = True
    pressure_ok:         bool = True
    pump_running:        bool = False
    pump_flow_ok:        bool = True    # flow sensor confirms water moving
    valve_positions_ok:  bool = True
    vfd_ok:              bool = True
    plc_heartbeat_ok:    bool = True
    thermal_ok:          bool = True
    flame_permit:        bool = False   # must be explicitly granted
    laser_permit:        bool = False   # must be explicitly granted
    estop_chain_closed:  bool = True    # True = chain closed = safe
    watchdog_ok:         bool = True
    operator_arm:        bool = False   # operator intentionally armed


@dataclass
class SafetyOutputs:
    """What the safety kernel exports to the show engine each tick."""
    permit:           bool = False   # master permit — engine must not output if False
    pump_enable:      bool = False
    valve_enable:     bool = False
    flame_enable:     bool = False
    laser_enable:     bool = False
    fog_enable:       bool = True    # fog is low-risk, permit by default
    lighting_enable:  bool = True    # lighting is safe always
    state:            SafetyState = SafetyState.BOOT
    active_faults:    List[FaultCode] = field(default_factory=list)
    fault_message:    str = ""


# ─── Safety Kernel ────────────────────────────────────────────────────────────
class SafetyKernel:
    """
    Runs at 50 Hz. Evaluates all interlocks, manages the state machine,
    latches faults, and exports a SafetyOutputs object that the show engine
    reads before every output frame.
    """
    LOOP_HZ = 50
    WATCHDOG_TIMEOUT = 2.0    # seconds before watchdog fault
    PLC_HEARTBEAT_TIMEOUT = 3.0

    def __init__(self):
        self.state = SafetyState.BOOT
        self.inputs = SafetyInputs()
        self.outputs = SafetyOutputs()
        self.fault_log: List[FaultEvent] = []
        self.latched_faults: List[FaultCode] = []
        self._last_watchdog_kick = time.time()
        self._last_plc_heartbeat = time.time()
        self._watchdog_enabled = False
        self._plc_watchdog_enabled = False
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._state_change_callbacks: List[Callable] = []
        self._fault_callbacks: List[Callable] = []
        self._tick_count = 0
        # ── AF-IO-004: field-I/O binding ─────────────────────────────────────
        # The FieldIOManager (engine/field_io.py) is attached by the lifespan; its
        # accessors are sync dict work, so pulling from it inside the 50 Hz tick
        # never blocks. Until attached (or with no required points), behaviour is
        # bit-identical to the pre-AF-IO kernel.
        self._field_io = None
        self._blind_required: List[str] = []   # required points currently not GOOD
        self._sensor_fault_active = False      # edge detection — no 50 Hz log spam
        self._hb_fault_active = False
        self._safety_bypass = False            # mirrored from main.SAFETY_BYPASS
        log.info("SafetyKernel initialised — state: BOOT")

    # ─── Public control API ───────────────────────────────────────────────────
    def arm(self) -> bool:
        """Operator requests ARM. Only allowed from SAFE_IDLE with no faults."""
        if self.state != SafetyState.SAFE_IDLE:
            log.warning(f"ARM rejected — current state: {self.state}")
            return False
        if self.latched_faults:
            log.warning(f"ARM rejected — latched faults: {self.latched_faults}")
            return False
        if not self.inputs.estop_chain_closed:
            log.warning("ARM rejected — E-stop chain open")
            return False
        self._transition(SafetyState.ARMED)
        return True

    def disarm(self):
        """Drop back to SAFE_IDLE from ARMED."""
        if self.state in (SafetyState.ARMED, SafetyState.DRY_RUN):
            self._transition(SafetyState.SAFE_IDLE)

    def go_live(self) -> bool:
        """Transition from ARMED to LIVE. Called by runtime when show starts."""
        if self.state != SafetyState.ARMED:
            log.warning(f"GO_LIVE rejected — not ARMED (state={self.state})")
            return False
        self._transition(SafetyState.LIVE)
        return True

    def stop_live(self):
        """Drop from LIVE back to ARMED."""
        if self.state == SafetyState.LIVE:
            self._transition(SafetyState.ARMED)

    def emergency_stop(self, source: str = "operator"):
        """Hard E-stop — immediate transition regardless of current state."""
        log.critical(f"EMERGENCY STOP triggered by: {source}")
        self._add_fault(FaultCode.ESTOP_OPEN, f"E-stop: {source}", latched=True)
        self._transition(SafetyState.EMERGENCY_STOP)

    def reset_faults(self) -> bool:
        """Attempt fault recovery. AF-HUB-007C — check the input conditions FIRST and
        only clear the latched faults / return to SAFE_IDLE when they are actually clear.
        A refused recovery leaves the fault record intact (previously it wiped the latched
        faults before checking inputs, hiding a still-present hazard)."""
        if not self._inputs_clear():
            return False
        self.latched_faults.clear()
        self.fault_log.clear()
        self._transition(SafetyState.SAFE_IDLE)
        return True

    def recovery_blockers(self) -> list[str]:
        """The input conditions currently preventing fault recovery — empty means recovery
        is possible. Lets the operator see WHY a reset was refused instead of a silent
        False (AF-HUB-007C)."""
        i = self.inputs
        checks = [
            (i.estop_chain_closed, "E-stop chain open"),
            (i.plc_heartbeat_ok,   "PLC heartbeat lost"),
            (i.watchdog_ok,        "Runtime watchdog not healthy"),
            (i.water_level_ok,     "Low water level"),
            (i.pressure_ok,        "Pressure out of range"),
            (i.pump_flow_ok,       "No pump flow"),
            (i.valve_positions_ok, "Valve position fault"),
            (i.vfd_ok,             "VFD fault"),
            (i.thermal_ok,         "Thermal overload"),
        ]
        return [msg for ok, msg in checks if not ok]

    def enter_maintenance(self):
        if self.state in (SafetyState.SAFE_IDLE, SafetyState.ARMED):
            self._transition(SafetyState.MAINTENANCE)

    def enter_dry_run(self):
        if self.state in (SafetyState.SAFE_IDLE, SafetyState.ARMED):
            self._transition(SafetyState.DRY_RUN)

    def kick_watchdog(self):
        """Runtime must call this every tick to confirm it is alive."""
        self._watchdog_enabled = True
        self._last_watchdog_kick = time.time()

    def update_plc_heartbeat(self):
        """PLC driver calls this on each successful heartbeat."""
        self._plc_watchdog_enabled = True
        self._last_plc_heartbeat = time.time()

    def update_inputs(self, **kwargs):
        """Feed fresh sensor values into the kernel."""
        for k, v in kwargs.items():
            if hasattr(self.inputs, k):
                setattr(self.inputs, k, v)

    def on_state_change(self, cb: Callable):
        self._state_change_callbacks.append(cb)

    def on_fault(self, cb: Callable):
        self._fault_callbacks.append(cb)

    # ─── Async loop ───────────────────────────────────────────────────────────
    async def start(self):
        self._running = True
        self._task = asyncio.create_task(self._loop())
        log.info("SafetyKernel loop started at 50 Hz")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try: await self._task
            except asyncio.CancelledError: pass

    async def _loop(self):
        interval = 1.0 / self.LOOP_HZ
        while self._running:
            t0 = time.monotonic()
            try:
                self._tick()
            except Exception as e:
                log.error(f"SafetyKernel tick exception: {e}")
                self._add_fault(FaultCode.RUNTIME_FAULT, str(e), latched=True)
            elapsed = time.monotonic() - t0
            await asyncio.sleep(max(0, interval - elapsed))

    def _tick(self):
        self._tick_count += 1
        self._ingest_field_io()
        self._check_watchdog()
        self._check_interlocks()
        self._evaluate_state()
        self._build_outputs()

    # ─── AF-IO-004: field-I/O ingestion ──────────────────────────────────────
    def attach_field_io(self, manager) -> None:
        """Attach the FieldIOManager so real sensor readings feed the interlocks."""
        self._field_io = manager
        log.info("SafetyKernel: field I/O attached (%d bound point(s))",
                 len(manager.store.bound_points()) if manager else 0)

    def set_safety_bypass(self, active: bool) -> None:
        """Mirror main's SAFETY_BYPASS so the status payload can never look clean
        while the dev bypass is quietly scrubbing faults (AF-IO-004)."""
        self._safety_bypass = bool(active)

    def _ingest_field_io(self):
        """Pull the latest quality-tagged readings into the safety inputs.

        Fail-closed rules:
          * a bound DI with a GOOD reading writes its boolean into the input field
            (so a real E-stop contact drives the real interlock);
          * a REQUIRED point whose reading is not GOOD (UNKNOWN/STALE/FAULT) joins
            _blind_required — _build_outputs withdraws the master permit while that
            list is non-empty. Non-required points never affect the permit; they
            are surfaced as "unmonitored" in get_status() instead;
          * PLC liveness comes from the heartbeat COUNTER advancing
            (FieldIOManager.heartbeat_alive) — this replaces nothing less than the
            old faked update_plc_heartbeat() path.
        """
        mgr = self._field_io
        if mgr is None:
            return
        from engine.field_points import Quality

        blind: List[str] = []
        try:
            hb_alive = mgr.heartbeat_alive()
            for p in mgr.store.bound_points():
                if p.binds_to == "heartbeat":
                    # Judged on change, not on value: dead heartbeat on a REQUIRED
                    # point blinds the permit like any other required sensor.
                    if p.required and hb_alive is False:
                        blind.append(f"{p.id}(HEARTBEAT_DEAD)")
                    continue
                r = mgr.get(p.id)
                if r.quality == Quality.GOOD and isinstance(r.value, bool):
                    setattr(self.inputs, p.binds_to, r.value)
                if p.required and r.quality != Quality.GOOD:
                    blind.append(f"{p.id}({r.quality.value})")
        except Exception as e:  # pragma: no cover - defensive
            # A broken manager is a blind input side: everything required is blind.
            log.error("field I/O ingestion failed: %s", e)
            blind = [f"{p.id}(INGEST_ERROR)"
                     for p in getattr(mgr.store, "required_points", list)()] or ["field_io"]
            hb_alive = None

        self._blind_required = blind
        if blind and not self._sensor_fault_active:
            self._add_fault(FaultCode.SENSOR_FAULT,
                            f"required sensor(s) not GOOD: {', '.join(blind)}")
        self._sensor_fault_active = bool(blind)

        if hb_alive is True:
            self.update_plc_heartbeat()          # REAL liveness feeds the old path
            self.inputs.plc_heartbeat_ok = True
            self._hb_fault_active = False
        elif hb_alive is False:
            self.inputs.plc_heartbeat_ok = False
            if not self._hb_fault_active:
                self._add_fault(FaultCode.PLC_COMM_LOSS,
                                "PLC heartbeat counter frozen (field I/O)")
            self._hb_fault_active = True

    # ─── Interlock evaluation ─────────────────────────────────────────────────
    def _check_watchdog(self):
        if self._watchdog_enabled:
            age = time.time() - self._last_watchdog_kick
            if age > self.WATCHDOG_TIMEOUT:
                if FaultCode.WATCHDOG_MISSED not in self.latched_faults:
                    self._add_fault(
                        FaultCode.WATCHDOG_MISSED,
                        f"Watchdog missed — {age:.1f}s since last kick", latched=True,)

        if self._plc_watchdog_enabled:
            plc_age = time.time() - self._last_plc_heartbeat
            if plc_age > self.PLC_HEARTBEAT_TIMEOUT:
                if FaultCode.PLC_COMM_LOSS not in self.latched_faults:
                    self._add_fault(
                        FaultCode.PLC_COMM_LOSS,
                        f"PLC heartbeat lost — {plc_age:.1f}s", latched=False,)

    def _check_interlocks(self):
        i = self.inputs
        if not i.estop_chain_closed:
            if self.state not in (SafetyState.EMERGENCY_STOP,):
                self.emergency_stop("hardware-estop")
        if not i.water_level_ok:
            self._add_fault(FaultCode.LOW_WATER, "Water level sensor low", latched=False)
        if not i.pressure_ok:
            self._add_fault(FaultCode.OVER_PRESSURE, "Pressure sensor over limit", latched=True)
        if i.pump_running and not i.pump_flow_ok:
            self._add_fault(FaultCode.PUMP_DRY_RUN, "Pump running but no flow detected", latched=True)
        if not i.valve_positions_ok:
            self._add_fault(FaultCode.VALVE_TIMEOUT, "Valve position mismatch", latched=False)
        if not i.vfd_ok:
            self._add_fault(FaultCode.VFD_FAULT, "VFD reported fault", latched=True)
        if not i.thermal_ok:
            self._add_fault(FaultCode.THERMAL_OVERLOAD, "Thermal overload detected", latched=True)

    def _evaluate_state(self):
        """Drive state transitions based on current faults and inputs."""
        if self.state == SafetyState.BOOT:
            # Auto-advance to SAFE_IDLE after first tick if inputs clear
            if self._tick_count > 5 and self._inputs_clear():
                self._transition(SafetyState.SAFE_IDLE)
            return

        # Any latched fault (except in ESTOP/RECOVERY) triggers FAULT state
        if self.latched_faults and self.state not in (
            SafetyState.EMERGENCY_STOP, SafetyState.RECOVERY, SafetyState.FAULT
        ):
            self._transition(SafetyState.FAULT)

        # FAULT → RECOVERY if fault is still active (requires manual reset)
        if self.state == SafetyState.FAULT:
            if not self.latched_faults and self._inputs_clear():
                self._transition(SafetyState.RECOVERY)

    def _build_outputs(self):
        s = self.state
        o = self.outputs
        o.state = s
        o.active_faults = list(set(self.latched_faults + [
            f.code for f in self.fault_log[-10:] if not f.latched
        ]))
        o.fault_message = self.fault_log[-1].message if self.fault_log else ""

        # Master permit
        o.permit = s in (SafetyState.ARMED, SafetyState.LIVE, SafetyState.DRY_RUN)

        # AF-IO-004 — a REQUIRED field sensor that is not GOOD withdraws the permit.
        # This is the input-side fail-closed rule: an absent reading is not a permit.
        # The state machine is untouched (the fault is non-latched), so the permit
        # returns by itself the moment the sensor reads GOOD again.
        if self._blind_required:
            o.permit = False

        # Per-subsystem enables
        i = self.inputs
        o.pump_enable   = o.permit and i.water_level_ok and i.pressure_ok and i.vfd_ok
        o.valve_enable  = o.permit and i.pressure_ok
        o.flame_enable  = o.permit and i.flame_permit and s == SafetyState.LIVE
        o.laser_enable  = o.permit and i.laser_permit and s == SafetyState.LIVE
        o.fog_enable    = s not in (SafetyState.EMERGENCY_STOP, SafetyState.BOOT)
        o.lighting_enable = s not in (SafetyState.EMERGENCY_STOP, SafetyState.BOOT)

        # DRY_RUN: permits but no real hardware (show engine checks this flag)
        if s == SafetyState.DRY_RUN:
            o.pump_enable = False
            o.valve_enable = False
            o.flame_enable = False
            o.laser_enable = False

    # ─── Helpers ──────────────────────────────────────────────────────────────
    def _inputs_clear(self) -> bool:
        i = self.inputs
        return (i.water_level_ok and i.pressure_ok and i.pump_flow_ok
                and i.valve_positions_ok and i.vfd_ok and i.plc_heartbeat_ok
                and i.thermal_ok and i.estop_chain_closed and i.watchdog_ok)

    def _add_fault(self, code: FaultCode, message: str, latched: bool = False):
        ev = FaultEvent(code=code, message=message, latched=latched)
        self.fault_log.append(ev)
        if latched and code not in self.latched_faults:
            self.latched_faults.append(code)
            log.error(f"LATCHED FAULT [{code}]: {message}")
            for cb in self._fault_callbacks:
                try: cb(ev)
                except: pass

    def _transition(self, new_state: SafetyState):
        if new_state == self.state:
            return
        old = self.state
        self.state = new_state
        log.info(f"Safety state: {old} → {new_state}")
        for cb in self._state_change_callbacks:
            try: cb(old, new_state)
            except: pass

    def _field_io_status(self) -> dict:
        mgr = self._field_io
        if mgr is None:
            return {"attached": False, "monitored": [], "unmonitored": [],
                    "blind_required": [], "heartbeat_alive": None}
        try:
            bound = mgr.store.bound_points()
            return {
                "attached": True,
                # monitored = the sensors the permit actually depends on
                "monitored": [p.id for p in bound if p.required],
                # unmonitored = wired and read, but NOT gating the permit — shown
                # so nobody mistakes a green board for a guarded one
                "unmonitored": [p.id for p in bound if not p.required],
                "blind_required": list(self._blind_required),
                "heartbeat_alive": mgr.heartbeat_alive(),
            }
        except Exception:  # pragma: no cover - defensive
            return {"attached": True, "monitored": [], "unmonitored": [],
                    "blind_required": list(self._blind_required),
                    "heartbeat_alive": None}

    def get_status(self) -> dict:
        return {
            "state": self.state,
            "permit": self.outputs.permit,
            "pump_enable": self.outputs.pump_enable,
            "valve_enable": self.outputs.valve_enable,
            "flame_enable": self.outputs.flame_enable,
            "laser_enable": self.outputs.laser_enable,
            "fog_enable": self.outputs.fog_enable,
            "lighting_enable": self.outputs.lighting_enable,
            "latched_faults": self.latched_faults,
            "active_faults": self.outputs.active_faults,
            "fault_message": self.outputs.fault_message,
            "tick_count": self._tick_count,
            # AF-IO-004 — the input side must be visible: whether the dev bypass is
            # scrubbing faults, and which sensors the permit currently trusts/lacks.
            "safety_bypass": self._safety_bypass,
            "field_io": self._field_io_status(),
            "inputs": {
                "water_level_ok":     self.inputs.water_level_ok,
                "pressure_ok":        self.inputs.pressure_ok,
                "estop_chain_closed": self.inputs.estop_chain_closed,
                "plc_heartbeat_ok":   self.inputs.plc_heartbeat_ok,
                "flame_permit":       self.inputs.flame_permit,
                "laser_permit":       self.inputs.laser_permit,
            }
        }


# ─── Singleton ────────────────────────────────────────────────────────────────
_kernel: Optional[SafetyKernel] = None

def get_safety_kernel() -> SafetyKernel:
    global _kernel
    if _kernel is None:
        _kernel = SafetyKernel()
    return _kernel
