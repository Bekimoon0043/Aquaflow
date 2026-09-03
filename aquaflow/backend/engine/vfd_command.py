"""
engine/vfd_command.py — AF-IO-009: the safety-gated write path to the VFD.

AquaFlow commands the ZONCEN speed reference by writing the PLC command area
(docs/S7_DB_CONTRACT.md: DBW12 CMD_PUMP_SPEED 0..27648, DBX14.0 output enable);
the PLC's cyclic program copies CMD_PUMP_SPEED to its analog output. The 1215C's
onboard AO are 0-20 mA — if the ZONCEN reference input is 0-10 V, use its current
input or a 500 Ω dropping resistor (see the contract).

The gate, in one sentence: **a speed command needs the safety kernel's master
permit AND pump_enable; a STOP needs nothing.** Refusing to stop because the
permit is gone would be exactly backwards — stopping is the fail-safe direction
and is always allowed, permit or no permit, config or no config.

Command points are ordinary FieldPoints (kind AO/DO — the poll loop already skips
them) with the reserved ids:
    cmd_pump_speed  (AO)  — raw span raw_min..raw_max maps fraction 0..1
    cmd_enable      (DO)  — the output-enable bit
declared in the same inventory as the inputs, so one config file describes the
whole rack. Both transports work: an s7: source writes the DB address, a modbus:
source writes the holding register.

Every accepted or refused command is audited (capped ring), and status() says
what the LAST thing on the wire was — the operator must never have to guess
whether a speed command left the machine.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from engine.field_points import PointKind
from engine.modbus_client import ModbusTCPClient, parse_register_address

logger = logging.getLogger("aquaflow.vfd")

SPEED_POINT_ID = "cmd_pump_speed"
ENABLE_POINT_ID = "cmd_enable"


class VFDCommander:
    """The one writer to the PLC command area. Pull-gated: every speed command
    consults the safety kernel at call time — there is no cached permission."""

    AUDIT_CAP = 200

    def __init__(self, manager, safety_kernel=None):
        self._manager = manager
        self._kernel = safety_kernel
        self._audit: list[dict] = []
        self.last_command: Optional[dict] = None

    def set_safety_kernel(self, kernel) -> None:
        self._kernel = kernel

    # ── the gate ─────────────────────────────────────────────────────────────
    def _gate(self) -> Optional[str]:
        """None = permitted; otherwise the refusal reason. STOP never calls this."""
        k = self._kernel
        if k is None:
            return "no safety kernel attached — speed commands refused"
        try:
            if not k.outputs.permit:
                return "safety permit not granted"
            if not k.outputs.pump_enable:
                return "pump_enable not granted"
        except Exception:
            return "safety kernel unreadable — refusing (fail closed)"
        return None

    def _point(self, point_id: str, kinds: tuple):
        p = self._manager.store.get(point_id)
        if p is None:
            return None, (f"command point {point_id!r} not declared — add it to the "
                          f"field-point inventory (see docs/S7_DB_CONTRACT.md)")
        if p.kind not in kinds:
            return None, f"command point {point_id!r} must be kind {kinds}, is {p.kind}"
        return p, None

    async def _write_point(self, p, value) -> bool:
        client = self._manager._client_for(p.source)
        if client is None:
            raise RuntimeError(f"no transport for source {p.source!r}")
        if not await client.ensure_connected():
            raise RuntimeError(f"source {p.source!r} not reachable: {client.last_error}")
        if isinstance(client, ModbusTCPClient):
            if p.kind == PointKind.DO:
                return await client.write_coil(int(str(p.address).strip()), bool(value))
            return await client.write_register(
                parse_register_address(p.address), int(value))
        # S7 — the address dialect carries bit vs word.
        return await client.write_address(str(p.address).upper(), value, p.raw_type)

    def _note(self, action: str, ok: bool, detail: str, user: str):
        entry = {"ts": time.time(), "action": action, "ok": ok,
                 "detail": detail, "user": user}
        self._audit.append(entry)
        del self._audit[:-self.AUDIT_CAP]
        self.last_command = entry
        (logger.info if ok else logger.warning)("VFD %s %s — %s (user=%s)",
                                                action, "OK" if ok else "REFUSED/FAILED",
                                                detail, user)

    # ── commands ─────────────────────────────────────────────────────────────
    async def set_speed(self, fraction: float, *, user: str = "operator") -> dict:
        """Command the speed reference as a 0..1 fraction of the point's raw span.
        Gated on permit + pump_enable at call time."""
        refusal = self._gate()
        if refusal:
            self._note("set_speed", False, refusal, user)
            return {"ok": False, "refused": refusal}
        p, err = self._point(SPEED_POINT_ID, (PointKind.AO,))
        if err:
            self._note("set_speed", False, err, user)
            return {"ok": False, "refused": err}
        try:
            frac = max(0.0, min(1.0, float(fraction)))
        except (TypeError, ValueError):
            return {"ok": False, "refused": f"not a number: {fraction!r}"}
        raw = round(p.raw_min + frac * (p.raw_max - p.raw_min))
        try:
            await self._write_point(p, raw)
        except Exception as e:
            self._note("set_speed", False, str(e), user)
            return {"ok": False, "error": str(e)}
        self._note("set_speed", True, f"fraction={frac:.3f} raw={raw} → {p.address}", user)
        return {"ok": True, "fraction": frac, "raw": raw, "address": p.address}

    async def set_enabled(self, enabled: bool, *, user: str = "operator") -> dict:
        """Set the output-enable bit. Enabling is gated; DISABLING never is."""
        if enabled:
            refusal = self._gate()
            if refusal:
                self._note("set_enabled", False, refusal, user)
                return {"ok": False, "refused": refusal}
        p, err = self._point(ENABLE_POINT_ID, (PointKind.DO,))
        if err:
            self._note("set_enabled", False, err, user)
            return {"ok": False, "refused": err}
        try:
            await self._write_point(p, bool(enabled))
        except Exception as e:
            self._note("set_enabled", False, str(e), user)
            return {"ok": False, "error": str(e)}
        self._note("set_enabled", True, f"enabled={bool(enabled)} → {p.address}", user)
        return {"ok": True, "enabled": bool(enabled)}

    async def stop(self, *, user: str = "operator") -> dict:
        """Zero the speed reference and clear the enable bit. NEVER gated — stopping
        is the fail-safe direction and must work with no permit, a broken kernel,
        or a half-declared config (each half is attempted independently)."""
        results = {}
        p, err = self._point(SPEED_POINT_ID, (PointKind.AO,))
        if p is not None:
            try:
                await self._write_point(p, p.raw_min)
                results["speed_zeroed"] = True
            except Exception as e:
                results["speed_zeroed"] = False
                results["speed_error"] = str(e)
        else:
            results["speed_zeroed"] = None       # not declared — nothing to zero
        pe, err2 = self._point(ENABLE_POINT_ID, (PointKind.DO,))
        if pe is not None:
            try:
                await self._write_point(pe, False)
                results["disabled"] = True
            except Exception as e:
                results["disabled"] = False
                results["disable_error"] = str(e)
        else:
            results["disabled"] = None
        ok = (results.get("speed_zeroed") is not False
              and results.get("disabled") is not False)
        self._note("stop", ok, str(results), user)
        return {"ok": ok, **results}

    # ── visibility ───────────────────────────────────────────────────────────
    def status(self) -> dict:
        speed_p, _ = self._point(SPEED_POINT_ID, (PointKind.AO,))
        enable_p, _ = self._point(ENABLE_POINT_ID, (PointKind.DO,))
        return {
            "configured": speed_p is not None,
            "speed_point": speed_p.to_dict() if speed_p else None,
            "enable_point": enable_p.to_dict() if enable_p else None,
            "gate": self._gate(),                # None = commands would pass now
            "last_command": self.last_command,
            "audit_len": len(self._audit),
        }

    def audit(self, limit: int = 50) -> list[dict]:
        return self._audit[-int(limit):]
