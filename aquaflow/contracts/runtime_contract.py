from __future__ import annotations

from enum import Enum
from typing import Any, Literal
from pydantic import BaseModel, Field


class RuntimeMode(str, Enum):
    DESIGN = "design"
    SIMULATION = "simulation"
    LIVE = "live"


class TransportState(str, Enum):
    STOPPED = "stopped"
    ARMED = "armed"
    PLAYING = "playing"
    PAUSED = "paused"
    FAULT = "fault"
    EMERGENCY_STOP = "emergency_stop"


class SafetyState(str, Enum):
    BOOT = "boot"
    SAFE_IDLE = "safe_idle"
    ARMED = "armed"
    LIVE = "live"
    FAULT = "fault"
    EMERGENCY_STOP = "emergency_stop"
    RECOVERY_REQUIRED = "recovery_required"
    MAINTENANCE = "maintenance"
    DRY_RUN = "dry_run"


class SyncSource(str, Enum):
    INTERNAL = "internal"
    NTP = "ntp"
    PTP = "ptp"
    SMPTE = "smpte"
    LTC = "ltc"
    MTC = "mtc"


class RuntimeCommand(BaseModel):
    command_id: str
    timestamp_us: int = Field(ge=0)
    device_id: str
    action: str
    value: float
    safety_class: Literal["normal", "critical", "inhibit", "rollback"] = "normal"
    metadata: dict[str, Any] = Field(default_factory=dict)


class RuntimeHealth(BaseModel):
    nominal_fps: int = 60
    loop_jitter_us: int = 0
    queue_depth: int = 0
    fault_count: int = 0
    safety_permit: bool = False


class RuntimeSyncStatus(BaseModel):
    source: SyncSource = SyncSource.INTERNAL
    locked: bool = False
    offset_us: int = 0
    confidence: float = 0.0


class RuntimeSafetyStatus(BaseModel):
    state: SafetyState = SafetyState.BOOT
    permit_live: bool = False
    active_faults: list[str] = Field(default_factory=list)


class RuntimeSession(BaseModel):
    session_id: str
    mode: RuntimeMode = RuntimeMode.DESIGN
    transport: TransportState = TransportState.STOPPED
    bundle_id: str
    sync: RuntimeSyncStatus = Field(default_factory=RuntimeSyncStatus)
    safety: RuntimeSafetyStatus = Field(default_factory=RuntimeSafetyStatus)
    commands: list[RuntimeCommand] = Field(default_factory=list)


class RuntimeDeployRequest(BaseModel):
    bundle_id: str
    runtime_target: Literal["industrial_pc", "embedded_controller", "offline_kiosk", "cloud_runtime"]
    mode: RuntimeMode = RuntimeMode.LIVE
    safety_profile: str
    operator_ack_required: bool = True


class RuntimeAck(BaseModel):
    accepted: bool
    session_id: str | None = None
    message: str = ""


class RuntimeFault(BaseModel):
    fault_id: str
    severity: Literal["info", "warning", "fault", "critical"]
    source: str
    message: str
    rollback_required: bool = False
    safe_state_applied: bool = False
