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
# Contract v3 (frame-accurate): the PLC keeps its own show clock in a 10-ms cyclic OB and
# applies timestamped command banks from a lookahead ring the PC keeps filled.  Contract v2
# (streamed: one bank per 100-ms commit) is still read and driven for PLCs that have not been
# updated; the runtime falls back to streaming and says so.
CONTRACT_VERSION = 3
PROGRAM_VERSION = 0x00030000
LEGACY_CONTRACT_VERSION = 2
LEGACY_PROGRAM_VERSION = 0x00020000
HEADER_SIZE = 64
CYCLE_MS = 10                 # v3 fast cyclic OB (AquaFlowCycle) period
LEGACY_CYCLE_MS = 100         # v2 cyclic OB period
WATCHDOG_MS = 1000            # command/keepalive freshness, both contracts
UNDERRUN_LIMIT_MS = 1000      # v3: hold the last bank this long past ValidUntilMs, then safe-stop

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
FEEDBACK_END = 472
LEGACY_DB_SIZE = FEEDBACK_END
FEEDBACK_SIZE = FEEDBACK_END - PUMP_FEEDBACK_OFFSET

# v3 PLC-owned clock/buffer status (bytes that were reserved in the v2 header).
LAST_LATE_OFFSET = 42         # UInt  lateness (ms) of the last applied bank
SHOW_CLOCK_OFFSET = 48        # UDInt PLC show clock, ms since the buffered RUN was accepted
BUFFER_READ_OFFSET = 52       # UInt  ring read counter (PLC advances it)
BUFFER_CAPACITY_OFFSET = 54   # UInt  ring slots (constant)
WORST_LATE_OFFSET = 56        # UInt  worst lateness (ms) since RUN
BUFFER_STATUS_OFFSET = 58     # Word  BUFFER_* bits
APPLIED_AT_OFFSET = 60        # UDInt AtMs of the last applied bank

# v3 PC-owned stream control.  One 8-byte write commits new slots, the keepalive and the horizon.
STREAM_CONTROL_OFFSET = 472
BUFFER_WRITE_OFFSET = 472     # UInt  ring write counter (PC advances it after writing the slots)
STREAM_KEEPALIVE_OFFSET = 474 # UInt  changes on every refill; resets the PLC watchdog while buffered
VALID_UNTIL_OFFSET = 476      # UDInt the ring holds every bank up to this show time (ms)
STREAM_CONTROL_SIZE = 8
RING_OFFSET = 488
BUFFER_CAPACITY = 32
SLOT_SIZE = 4 + COMMAND_SIZE  # AtMs UDInt + the unchanged command bank = 212 bytes = one S7 PUT
DB_SIZE = RING_OFFSET + BUFFER_CAPACITY * SLOT_SIZE

# Largest single Write Var payload at the S7-1200's negotiated 240-byte PDU.
MAX_S7_WRITE = 212

BUFFER_ACTIVE = 0x0001        # buffered RUN, PLC clock running
BUFFER_UNDERRUN = 0x0002      # clock passed ValidUntilMs: holding the last bank
BUFFER_LATE = 0x0004          # a bank was applied a full cycle or more after its AtMs

FLAG_RUN = 0x0001
FLAG_RESET = 0x0002
FLAG_BUFFERED = 0x0004       # v3: RUN from the timestamped ring on the PLC clock
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
    5: "buffer_underrun",
}

REJECTIONS = {
    0: "none",
    1: "local_permit_off",
    2: "off_handshake_required",
    3: "command_frame_unstable",
    4: "pump_has_no_open_outlet",
    5: "stream_mode_change",
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


# Supported PLC programs: contract version → program version, cyclic OB period, DB size, mode.
PROFILES = {
    CONTRACT_VERSION: {"contract_version": CONTRACT_VERSION, "program_version": PROGRAM_VERSION,
                       "cycle_ms": CYCLE_MS, "db_size": DB_SIZE, "buffered": True},
    LEGACY_CONTRACT_VERSION: {"contract_version": LEGACY_CONTRACT_VERSION,
                              "program_version": LEGACY_PROGRAM_VERSION,
                              "cycle_ms": LEGACY_CYCLE_MS, "db_size": LEGACY_DB_SIZE, "buffered": False},
}

UPDATE_NOTICE = ("This PLC runs the older streamed program (contract v2): cues land within about "
                 "±75 ms. Download the current AquaFlow TIA package to the PLC for frame-accurate "
                 "timing on the PLC clock.")


def validate_header(header: Header, site_signature: int) -> dict:
    """Check the PLC program against AquaFlow and return its profile (see PROFILES)."""
    if header.magic != MAGIC:
        raise ValueError(
            f"PLC DB magic 0x{header.magic:04X} is incompatible; expected 0x{MAGIC:04X}. "
            "Download the current AquaFlow TIA package."
        )
    profile = PROFILES.get(header.contract_version)
    if profile is None or header.header_size != HEADER_SIZE:
        raise ValueError(
            f"PLC runtime contract v{header.contract_version}/header {header.header_size} is incompatible "
            f"with AquaFlow v{CONTRACT_VERSION} (or v{LEGACY_CONTRACT_VERSION})/header {HEADER_SIZE}"
        )
    if header.program_version != profile["program_version"]:
        raise ValueError(
            f"PLC program version 0x{header.program_version:08X} is incompatible with "
            f"AquaFlow 0x{profile['program_version']:08X} for contract v{header.contract_version}"
        )
    if header.site_signature != site_signature:
        raise ValueError("PLC program/DB does not match this site's exported TIA package")
    expected = (PUMP_CAPACITY, VALVE_CAPACITY, LIGHT_CAPACITY)
    actual = (header.pump_capacity, header.valve_capacity, header.light_capacity)
    if actual != expected:
        raise ValueError(f"PLC contract capacities {actual} do not match AquaFlow {expected}")
    if header.cycle_ms != profile["cycle_ms"]:
        raise ValueError(f"PLC reports a {header.cycle_ms} ms control cycle; contract v{header.contract_version} "
                         f"requires {profile['cycle_ms']} ms")
    if profile["buffered"] and buffer_fields(header)["buffer_capacity"] != BUFFER_CAPACITY:
        raise ValueError(f"PLC reports {buffer_fields(header)['buffer_capacity']} buffer slots; "
                         f"AquaFlow requires {BUFFER_CAPACITY}")
    return profile


def buffer_fields(header: Header) -> dict:
    """The v3 clock/buffer fields (meaningless zeros on a v2 PLC)."""
    clock, read, capacity, worst, status, applied = struct.unpack(">IHHHHI", header.reserved_bytes)
    return {"show_clock_ms": clock, "buffer_read_index": read, "buffer_capacity": capacity,
            "worst_late_ms": worst, "buffer_status": status, "applied_at_ms": applied,
            "last_late_ms": header.reserved,
            "buffer_active": bool(status & BUFFER_ACTIVE), "buffer_underrun": bool(status & BUFFER_UNDERRUN),
            "buffer_late": bool(status & BUFFER_LATE)}


def slot_offset(index: int) -> int:
    """Byte offset of ring slot for the (wrapping 16-bit) buffer counter `index`."""
    return RING_OFFSET + (index % BUFFER_CAPACITY) * SLOT_SIZE


def encode_slot(at_ms: int, bank: bytes) -> bytes:
    if len(bank) != COMMAND_SIZE:
        raise ValueError(f"Command bank must be {COMMAND_SIZE} bytes")
    if not 0 <= int(at_ms) <= 0xFFFFFFFF:
        raise ValueError("Bank time is out of range")
    return struct.pack(">I", int(at_ms)) + bytes(bank)


def encode_stream_control(write_index: int, keepalive: int, valid_until_ms: int) -> bytes:
    return struct.pack(">HHI", write_index & 0xFFFF, keepalive & 0xFFFF,
                       max(0, min(0xFFFFFFFF, int(valid_until_ms))))


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
    buffered = header.contract_version == CONTRACT_VERSION
    described = {
        "contract_version": header.contract_version,
        "timing_mode": "buffered" if buffered else "streamed",
        "cycle_ms": header.cycle_ms,
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
    if buffered:
        described.update(buffer_fields(header))
    return described
