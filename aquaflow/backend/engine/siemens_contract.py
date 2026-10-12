"""Byte-exact AquaFlow <-> S7-1200 runtime contract.

The PLC DB is created in TIA Portal with optimized access disabled.  AquaFlow owns
only the command bank.  The PLC owns the header/status and feedback bank.  Keeping
all offsets here prevents the runtime, generator and tests from inventing their own
addresses.
"""
from __future__ import annotations

from dataclasses import dataclass
import struct


MAGIC = 0xAF03
CONTRACT_VERSION = 2
PROGRAM_VERSION = 0x00020000
HEADER_SIZE = 64

PUMP_CAPACITY = 16
VALVE_CAPACITY = 512
LIGHT_CAPACITY = 32

PUMP_COMMAND_OFFSET = 64
PUMP_MODE_OFFSET = 96
VALVE_COMMAND_OFFSET = 112
LIGHT_COMMAND_OFFSET = 176
COMMAND_END = 272
COMMAND_SIZE = COMMAND_END - PUMP_COMMAND_OFFSET

PUMP_FEEDBACK_OFFSET = 272
PUMP_RUNNING_OFFSET = 304
PUMP_FAULT_OFFSET = 306
VALVE_FEEDBACK_OFFSET = 308
LIGHT_FEEDBACK_OFFSET = 372
LIGHT_ACTIVE_OFFSET = 468
DB_SIZE = 472
FEEDBACK_SIZE = DB_SIZE - PUMP_FEEDBACK_OFFSET

FLAG_RUN = 0x0001
FLAG_RESET = 0x0002
FLAG_STAGING = 0x8000

STATUS_RUNNING = 0x0001
STATUS_READY = 0x0002
STATUS_WATCHDOG_HEALTHY = 0x0004
STATUS_COMMAND_ACCEPTED = 0x0008
STATUS_FAULT = 0x0010

PERMIT_LOCAL = 0x0001
PERMIT_ESTOP = 0x0002
PERMIT_LEVEL = 0x0004
PERMIT_THERMAL = 0x0008
PERMIT_DRIVE = 0x0010
PERMIT_PRESSURE = 0x0020

FAULTS = {
    0: "none",
    1: "local_interlock_open",
    2: "command_watchdog_expired",
    3: "pump_fault",
    4: "invalid_command",
}

REJECTIONS = {
    0: "none",
    1: "local_permit_off",
    2: "off_handshake_required",
    3: "command_frame_unstable",
    4: "pump_has_no_open_outlet",
}

_HEADER = struct.Struct(">HHHHII14HI16s")


@dataclass(frozen=True)
class Header:
    magic: int
    contract_version: int
    header_size: int
    status: int
    site_signature: int
    program_version: int
    plc_heartbeat: int
    aquaflow_heartbeat: int
    permit: int
    fault_code: int
    ack_sequence: int
    command_sequence: int
    command_flags: int
    rejected_reason: int
    feedback_sequence: int
    cycle_ms: int
    pump_capacity: int
    valve_capacity: int
    light_capacity: int
    reserved: int
    last_command_age_ms: int
    reserved_bytes: bytes

    @property
    def running(self) -> bool:
        return bool(self.status & STATUS_RUNNING)

    @property
    def ready(self) -> bool:
        return bool(self.status & STATUS_READY)

    @property
    def watchdog_healthy(self) -> bool:
        return bool(self.status & STATUS_WATCHDOG_HEALTHY)

    @property
    def local_permit(self) -> bool:
        return bool(self.permit & PERMIT_LOCAL)


def parse_header(raw: bytes) -> Header:
    if len(raw) != HEADER_SIZE:
        raise ValueError(f"Siemens contract header is {len(raw)} bytes; expected {HEADER_SIZE}")
    return Header(*_HEADER.unpack(raw))


def validate_header(header: Header, site_signature: int) -> None:
    if header.magic != MAGIC:
        raise ValueError(
            f"PLC DB magic 0x{header.magic:04X} is incompatible; expected 0x{MAGIC:04X}. "
            "Download the current AquaFlow TIA package."
        )
    if header.contract_version != CONTRACT_VERSION or header.header_size != HEADER_SIZE:
        raise ValueError(
            f"PLC runtime contract v{header.contract_version}/header {header.header_size} is incompatible "
            f"with AquaFlow v{CONTRACT_VERSION}/header {HEADER_SIZE}"
        )
    if header.program_version != PROGRAM_VERSION:
        raise ValueError(
            f"PLC program version 0x{header.program_version:08X} is incompatible with "
            f"AquaFlow 0x{PROGRAM_VERSION:08X}"
        )
    if header.site_signature != site_signature:
        raise ValueError("PLC program/DB does not match this site's exported TIA package")
    expected = (PUMP_CAPACITY, VALVE_CAPACITY, LIGHT_CAPACITY)
    actual = (header.pump_capacity, header.valve_capacity, header.light_capacity)
    if actual != expected:
        raise ValueError(f"PLC contract capacities {actual} do not match AquaFlow {expected}")
    if header.cycle_ms != 100:
        raise ValueError(f"PLC reports a {header.cycle_ms} ms control cycle; 100 ms is required")


def blank_command() -> bytearray:
    return bytearray(COMMAND_SIZE)


def bit_is_set(buffer: bytes, byte_offset: int, index: int) -> bool:
    return bool(buffer[byte_offset + index // 8] & (1 << (index % 8)))


def set_bit(buffer: bytearray, byte_offset: int, index: int, value: bool) -> None:
    mask = 1 << (index % 8)
    pos = byte_offset + index // 8
    if value:
        buffer[pos] |= mask
    else:
        buffer[pos] &= ~mask


def decode_feedback(raw: bytes, channels: list[dict]) -> dict:
    if len(raw) != FEEDBACK_SIZE:
        raise ValueError(f"Siemens feedback is {len(raw)} bytes; expected {FEEDBACK_SIZE}")
    result = {}
    pump_running_base = PUMP_RUNNING_OFFSET - PUMP_FEEDBACK_OFFSET
    pump_fault_base = PUMP_FAULT_OFFSET - PUMP_FEEDBACK_OFFSET
    valve_base = VALVE_FEEDBACK_OFFSET - PUMP_FEEDBACK_OFFSET
    light_base = LIGHT_FEEDBACK_OFFSET - PUMP_FEEDBACK_OFFSET
    light_active_base = LIGHT_ACTIVE_OFFSET - PUMP_FEEDBACK_OFFSET
    for channel in channels:
        index = channel["index"]
        if channel["kind"] == "pump":
            raw_speed = struct.unpack_from(">H", raw, index * 2)[0]
            result[channel["id"]] = {
                "kind": "pump",
                "applied_percent": round(raw_speed * 100 / 27648, 3),
                "running": bit_is_set(raw, pump_running_base, index),
                "fault": bit_is_set(raw, pump_fault_base, index),
                "source": "physical" if channel.get("feedback_input") else "plc_applied",
            }
        elif channel["kind"] == "valve":
            result[channel["id"]] = {
                "kind": "valve",
                "open": bit_is_set(raw, valve_base, index),
                "source": "physical" if channel.get("feedback_input") else "plc_applied",
            }
        else:
            start = light_base + index * 3
            result[channel["id"]] = {
                "kind": "light",
                "rgb": list(raw[start:start + 3]),
                "active": bit_is_set(raw, light_active_base, index),
                "source": "plc_applied",
            }
    return result


def describe_header(header: Header) -> dict:
    return {
        "contract_version": header.contract_version,
        "program_version": f"{header.program_version >> 16}.{header.program_version & 0xFFFF}",
        "plc_heartbeat": header.plc_heartbeat,
        "aquaflow_heartbeat": header.aquaflow_heartbeat,
        "plc_permit": header.local_permit,
        "permit_bits": header.permit,
        "status_bits": header.status,
        "plc_running": header.running,
        "plc_ready": header.ready,
        "watchdog_healthy": header.watchdog_healthy,
        "fault_code": header.fault_code,
        "fault": FAULTS.get(header.fault_code, f"unknown_{header.fault_code}"),
        "rejected_reason_code": header.rejected_reason,
        "rejected_reason": REJECTIONS.get(header.rejected_reason, f"unknown_{header.rejected_reason}"),
        "ack": header.ack_sequence,
        "command_sequence": header.command_sequence,
        "command_flags": header.command_flags,
        "feedback_sequence": header.feedback_sequence,
        "last_command_age_ms": header.last_command_age_ms,
    }
