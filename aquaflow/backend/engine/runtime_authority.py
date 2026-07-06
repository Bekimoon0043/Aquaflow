"""
runtime_authority.py — AF-HUB-006B single runtime output authority.

Before this, "stop all hardware output" was SPLIT across several entry points that each
halted a different, incomplete subset of the output actors:

    WS emergency_stop   → safety + show_engine.stop_playback + device_manager.emergency_stop
                          (device_manager has no emergency_stop → AttributeError mid-E-stop;
                           the protocol bus was only zeroed indirectly; hardware_output missed)
    REST /emergency-stop→ hardware_output.blackout_all ONLY (show loop + protocol bus keep running!)
    REST /dmx/blackout  → hardware_output.blackout_all ONLY
    REST /safety/estop  → safety kernel trip ONLY

So which hardware actually stopped depended on which button the operator hit — a real
safety hole. RuntimeAuthority is the ONE coordinator: emergency_stop()/blackout() fan out
to EVERY registered output subsystem in a safe, fault-tolerant order, so a single call
guarantees all outputs reach a safe state and one failing subsystem never prevents the
others from stopping.

Registration-based (no hard imports) so it stays dependency-light and unit-testable; the
app registers the real singletons in app_state / the lifespan.
"""
from __future__ import annotations

import inspect
import logging
import time

logger = logging.getLogger(__name__)


class RuntimeAuthority:
    def __init__(self):
        self._safety = None
        self._show_engine = None
        self._protocol_bus = None
        self._hardware_output = None
        self._device_manager = None
        self._last_trip: dict | None = None

    def register(self, *, safety=None, show_engine=None, protocol_bus=None,
                 hardware_output=None, device_manager=None) -> "RuntimeAuthority":
        """Register output actors. Idempotent; only non-None args overwrite."""
        if safety is not None:
            self._safety = safety
        if show_engine is not None:
            self._show_engine = show_engine
        if protocol_bus is not None:
            self._protocol_bus = protocol_bus
        if hardware_output is not None:
            self._hardware_output = hardware_output
        if device_manager is not None:
            self._device_manager = device_manager
        return self

    async def _invoke(self, results: dict, name: str, target, method: str, *args) -> None:
        """Call one subsystem's safe-state method, tolerating absence/failure so the
        remaining subsystems still get stopped."""
        if target is None:
            results[name] = "unregistered"
            return
        fn = getattr(target, method, None)
        if fn is None:
            results[name] = f"skipped (no {method})"
            return
        try:
            r = fn(*args)
            if inspect.isawaitable(r):
                await r
            results[name] = "ok"
        except Exception as exc:  # never let one subsystem block the rest
            results[name] = f"error: {exc}"
            logger.error("RuntimeAuthority: %s.%s failed: %s", name, method, exc)

    async def emergency_stop(self, source: str = "operator") -> dict:
        """Trip EVERY output subsystem to a safe state, in a safe order."""
        results: dict = {}
        # 1. latch the safety permit off first so nothing can re-emit
        await self._invoke(results, "safety", self._safety, "emergency_stop", source)
        # 2. halt the show playback loop (stops generating output commands)
        await self._invoke(results, "show_engine", self._show_engine, "emergency_stop")
        # 3. zero the protocol-bus drivers (Art-Net / DMX / Modbus)
        await self._invoke(results, "protocol_bus", self._protocol_bus, "emergency_stop")
        # 4. zero the hardware output manager
        await self._invoke(results, "hardware_output", self._hardware_output, "blackout_all")
        # 5. best-effort device-manager safe stop (no-op if it exposes no E-stop —
        #    this is what previously crashed the WS handler with AttributeError)
        await self._invoke(results, "device_manager", self._device_manager, "emergency_stop")
        trip = {"kind": "emergency_stop", "source": source, "at": time.time(), "results": results}
        self._last_trip = trip
        logger.critical("RuntimeAuthority EMERGENCY STOP by %s → %s", source, results)
        return trip

    async def blackout(self, source: str = "operator") -> dict:
        """Zero the physical outputs without latching the safety kernel or stopping the
        show engine — used by the plain DMX/blackout controls."""
        results: dict = {}
        await self._invoke(results, "protocol_bus", self._protocol_bus, "blackout")
        await self._invoke(results, "hardware_output", self._hardware_output, "blackout_all")
        trip = {"kind": "blackout", "source": source, "at": time.time(), "results": results}
        self._last_trip = trip
        return trip

    def get_status(self) -> dict:
        return {
            "registered": {
                "safety": self._safety is not None,
                "show_engine": self._show_engine is not None,
                "protocol_bus": self._protocol_bus is not None,
                "hardware_output": self._hardware_output is not None,
                "device_manager": self._device_manager is not None,
            },
            "last_trip": self._last_trip,
        }


# The one shared authority. Actors are registered in app_state (core singletons) and the
# application lifespan (safety kernel + hardware output).
runtime_authority = RuntimeAuthority()
