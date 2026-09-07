"""
engine/plc_verify.py — explicit, READ-ONLY verification of a configured PLC.

"Connected" is not "working". After the operator configures a PLC this module
answers the question that matters before commissioning: can AquaFlow read the
fields the contract declares, and is the PLC program actually RUNNING?

Siemens (AquaFlow S7 profile):
  * strict COTP/S7 handshake first (engine/s7_identify) so a failure is named
    precisely — unreachable, wrong rack/slot, not an S7 device, malformed reply;
  * then ONLY the profile's read-direction fields are read, one by one, and each
    refusal is classified: access denied (PUT/GET off), missing DB, optimized DB
    or DB too short (absolute address does not exist), timeout, malformed;
  * HEARTBEAT is sampled several times: it is verified ONLY when the value
    changes. A static readable value proves the CPU answers S7comm; it does not
    prove the cyclic program is running (a halted CPU serves static reads forever).

Modbus:
  * the operator names the input points to read (input/holding registers or
    discrete inputs). No address is ever guessed — reading an unknown register
    on an unknown device is exactly the "innocent poll" that has tripped drives.

This module contains no write path at all. It is for PLCs only; the I-CAN
fountain gateway has no comparable verification here by design.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field, asdict
from typing import Callable, Optional

from engine.s7_identify import s7_handshake, STAGE_ORDER

# Outcomes (mutually exclusive, most severe first).
UNREACHABLE = "unreachable"
WRONG_RACK_SLOT = "wrong_rack_slot"
NOT_S7 = "not_s7"
MALFORMED = "malformed"
TIMEOUT = "timeout"
ACCESS_DENIED = "access_denied"
MISSING_DB = "missing_db"
OPTIMIZED_OR_SHORT_DB = "optimized_or_short_db"
ITEM_ERROR = "item_error"
PARTIAL = "partial"
HEARTBEAT_STATIC = "heartbeat_static"
NO_POINTS = "no_points"
VERIFIED = "verified"

OUTCOME_TEXT = {
    UNREACHABLE: "device unreachable — no TCP connection (IP, cable, or firewall)",
    WRONG_RACK_SLOT: "the device refused the COTP connection — wrong rack/slot, or not an S7 CPU",
    NOT_S7: "the device answered but not with S7comm",
    MALFORMED: "the device sent a malformed or truncated reply",
    TIMEOUT: "the device stopped answering (timeout)",
    ACCESS_DENIED: "access denied — enable PUT/GET on the CPU (Protection & Security → Connection mechanisms)",
    MISSING_DB: "the data block does not exist on this CPU — DB1 \"AquaFlowIO\" is not downloaded",
    OPTIMIZED_OR_SHORT_DB: "the address is not accessible — DB1 is OPTIMIZED (absolute addressing off) or shorter than the contract",
    ITEM_ERROR: "the CPU refused one or more items",
    PARTIAL: "some fields read, some were refused — see fields",
    HEARTBEAT_STATIC: "fields read but HEARTBEAT did not change — the PLC program is not running (halted CPU or heartbeat not implemented)",
    NO_POINTS: "no input points selected — nothing was read (addresses are never guessed)",
    VERIFIED: "verified: every declared input read and the heartbeat is moving",
}


@dataclass
class FieldResult:
    id: str
    name: str
    address: str
    status: str                    # ok | access_denied | missing_db | optimized_or_short_db | item_error | timeout | malformed
    value: Optional[object] = None
    error: str = ""


@dataclass
class VerifyResult:
    protocol: str
    ip: str
    port: int
    outcome: str
    ok: bool
    message: str
    profile_id: str = ""
    rack: Optional[int] = None
    slot: Optional[int] = None
    unit_id: Optional[int] = None
    stage: str = ""
    identity: dict = field(default_factory=dict)
    fields: list = field(default_factory=list)          # FieldResult dicts
    heartbeat: dict = field(default_factory=dict)       # {"address", "samples", "changed"}
    warnings: list = field(default_factory=list)
    writes_performed: int = 0                           # always 0 — asserted by tests
    duration_s: float = 0.0
    verified_at: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


def _classify_item_code(code: int) -> str:
    if code == 0x03:
        return ACCESS_DENIED
    if code == 0x0A:
        return MISSING_DB
    if code == 0x05:
        return OPTIMIZED_OR_SHORT_DB
    return ITEM_ERROR


def _classify_handshake(stage: str, reason: str) -> str:
    r = (reason or "").lower()
    if stage == "none":
        return UNREACHABLE
    if stage == "tcp_open":
        if "disconnect" in r or "refused" in r or "closed" in r:
            return WRONG_RACK_SLOT
        if "timeout" in r:
            return TIMEOUT
        if "not a tpkt" in r or "not connection confirm" in r:
            return NOT_S7
        return MALFORMED
    # cotp_connected but setup not acknowledged
    if "timeout" in r:
        return TIMEOUT
    if "not s7comm" in r or "not ack-data" in r:
        return NOT_S7
    return MALFORMED


async def verify_s7_profile(ip: str, port: int, rack: int, slot: int, profile: dict, *,
                            samples: int = 4, interval_s: float = 0.3, timeout: float = 1.5,
                            connect_timeout: float = 2.0,
                            client_factory: Optional[Callable] = None,
                            handshake=s7_handshake) -> VerifyResult:
    """Read-only verification of a Siemens PLC against `profile`. Never writes."""
    from engine.s7_client import S7Client, S7FrameError, S7ItemError
    from plc.s7_profiles import heartbeat_field, read_fields

    t0 = time.monotonic()
    res = VerifyResult(protocol="siemens_s7", ip=ip, port=port, outcome=UNREACHABLE, ok=False,
                       message="", profile_id=profile.get("id", ""), rack=rack, slot=slot)

    hs = await handshake(ip, port, rack, slot, connect_timeout=connect_timeout, timeout=timeout)
    res.stage = hs.stage
    res.identity = dict(hs.identity)
    if not hs.s7_confirmed:
        res.outcome = _classify_handshake(hs.stage, hs.reason)
        res.message = f"{OUTCOME_TEXT[res.outcome]} ({hs.reason})"
        res.duration_s = round(time.monotonic() - t0, 3)
        return res
    prefix = profile.get("order_number_prefix")
    order = hs.identity.get("order_number", "")
    if prefix and order and not order.replace(" ", "").startswith(prefix.replace(" ", "")):
        res.warnings.append(f"CPU order number {order!r} is not the profile's {profile.get('cpu')}")

    client = (client_factory or S7Client)(ip, port, rack, slot, timeout=timeout,
                                          connect_timeout=connect_timeout)
    try:
        if not await client.connect():
            res.outcome = _classify_handshake("tcp_open", client.last_error)
            res.message = f"{OUTCOME_TEXT[res.outcome]} ({client.last_error})"
            return res

        transport_fault: Optional[str] = None
        for f in read_fields(profile):
            raw_type = "real" if f.get("type") == "real" else "uint16"
            try:
                value = await client.read_address(f["address"], raw_type)
                if f.get("type") == "bool":
                    value = bool(value)
                res.fields.append(asdict(FieldResult(f["id"], f["name"], f["address"], "ok", value)))
            except S7ItemError as e:
                status = _classify_item_code(e.code)
                res.fields.append(asdict(FieldResult(f["id"], f["name"], f["address"], status,
                                                     None, e.name)))
            except S7FrameError as e:
                status = TIMEOUT if "timeout" in str(e).lower() else MALFORMED
                res.fields.append(asdict(FieldResult(f["id"], f["name"], f["address"], status,
                                                     None, str(e))))
                transport_fault = status
                break                                  # the link is down; stop reading

        if transport_fault:
            res.outcome = transport_fault
            res.message = OUTCOME_TEXT[transport_fault]
            return res

        statuses = [x["status"] for x in res.fields]
        failed = [s for s in statuses if s != "ok"]
        if failed:
            if len(failed) == len(statuses) and len(set(failed)) == 1:
                res.outcome = failed[0]
            else:
                res.outcome = PARTIAL
            res.message = OUTCOME_TEXT[res.outcome]
            return res

        hb = heartbeat_field(profile)
        if hb is not None:
            values = []
            for i in range(max(2, samples)):
                if i:
                    await asyncio.sleep(max(0.0, interval_s))
                try:
                    values.append(await client.read_address(hb["address"], "uint16"))
                except S7FrameError as e:
                    res.outcome = TIMEOUT if "timeout" in str(e).lower() else MALFORMED
                    res.message = f"{OUTCOME_TEXT[res.outcome]} while sampling the heartbeat"
                    res.heartbeat = {"address": hb["address"], "samples": values, "changed": False}
                    return res
                except S7ItemError as e:
                    res.outcome = _classify_item_code(e.code)
                    res.message = OUTCOME_TEXT[res.outcome]
                    return res
            changed = len(set(values)) > 1
            res.heartbeat = {"address": hb["address"], "samples": values, "changed": changed,
                             "interval_s": interval_s}
            if not changed:
                res.outcome = HEARTBEAT_STATIC
                res.ok = False
                res.message = OUTCOME_TEXT[HEARTBEAT_STATIC]
                return res
        else:
            res.warnings.append("profile declares no heartbeat — program liveness not proven")

        res.outcome = VERIFIED
        res.ok = True
        res.message = OUTCOME_TEXT[VERIFIED]
        res.verified_at = time.time()
        return res
    finally:
        try:
            await client.close()
        except Exception:
            pass
        res.duration_s = round(time.monotonic() - t0, 3)


# ── Modbus: operator-selected input points only ──────────────────────────────
_MODBUS_KINDS = {
    "input_register": "read_input_registers",
    "holding_register": "read_holding_registers",
    "discrete_input": "read_discrete_inputs",
}


async def verify_modbus_points(ip: str, port: int, unit_id: int, points: list[dict], *,
                               timeout: float = 1.5, connect_timeout: float = 2.0,
                               client_factory: Optional[Callable] = None) -> VerifyResult:
    """Read exactly the points the operator selected (FC02/03/04). No writes,
    no guessed addresses. Empty `points` → NO_POINTS, nothing is sent."""
    from engine.modbus_client import (ModbusTCPClient, ModbusException, ModbusFrameError,
                                      parse_register_address)

    t0 = time.monotonic()
    res = VerifyResult(protocol="modbus_tcp", ip=ip, port=port, outcome=NO_POINTS, ok=False,
                       message=OUTCOME_TEXT[NO_POINTS], unit_id=unit_id)
    valid_points = []
    for p in points or []:
        kind = str(p.get("kind", "input_register"))
        if kind not in _MODBUS_KINDS:
            res.warnings.append(f"point {p.get('id') or p.get('address')}: unknown kind {kind!r} skipped")
            continue
        try:
            addr = parse_register_address(p.get("address"))
        except (ValueError, TypeError) as e:
            res.warnings.append(f"point {p.get('id') or p.get('address')}: {e}")
            continue
        valid_points.append({"id": str(p.get("id") or f"{kind}:{addr}"), "kind": kind,
                             "address": addr, "count": max(1, min(16, int(p.get("count", 1))))})
    if not valid_points:
        res.duration_s = round(time.monotonic() - t0, 3)
        return res

    client = (client_factory or ModbusTCPClient)(ip, port, unit_id, timeout=timeout,
                                                 connect_timeout=connect_timeout)
    try:
        if not await client.connect():
            res.outcome = UNREACHABLE
            res.message = f"{OUTCOME_TEXT[UNREACHABLE]} ({client.last_error})"
            return res
        res.stage = "port_open"
        for p in valid_points:
            method = getattr(client, _MODBUS_KINDS[p["kind"]])
            try:
                values = await method(p["address"], p["count"])
                res.fields.append(asdict(FieldResult(p["id"], p["kind"], str(p["address"]), "ok",
                                                     values if len(values) > 1 else values[0])))
                res.stage = "data_access_verified"
            except ModbusException as e:
                res.fields.append(asdict(FieldResult(p["id"], p["kind"], str(p["address"]),
                                                     "exception", None, e.name)))
                res.stage = res.stage or "protocol_confirmed"
            except ModbusFrameError as e:
                status = TIMEOUT if "timeout" in str(e).lower() else MALFORMED
                res.fields.append(asdict(FieldResult(p["id"], p["kind"], str(p["address"]),
                                                     status, None, str(e))))
                res.outcome = status
                res.message = OUTCOME_TEXT[status]
                return res
        bad = [f for f in res.fields if f["status"] != "ok"]
        if not bad:
            res.outcome, res.ok = VERIFIED, True
            res.message = "verified: every selected input point read"
            res.verified_at = time.time()
        elif len(bad) == len(res.fields):
            res.outcome = ITEM_ERROR
            res.message = "the server answered every point with a Modbus exception — check unit id, table and addresses"
        else:
            res.outcome = PARTIAL
            res.message = OUTCOME_TEXT[PARTIAL]
        return res
    finally:
        try:
            await client.close()
        except Exception:
            pass
        res.duration_s = round(time.monotonic() - t0, 3)
