"""
mobile_routes.py — AquaFlow Stage 3, Priority 9 (AQ-S3-009)

Mobile Monitoring App API: a phone-friendly live status feed, active alerts, and
validated remote control. Consumes the same safety/transport/engine singletons as
the operator panel.
"""
from fastapi import APIRouter, HTTPException

from services.mobile_monitor import (
    build_mobile_status, validate_remote_command, get_alert_manager, build_snapshot,
)

router = APIRouter()


def _live_status() -> dict:
    """Assemble the operator status from the live singletons."""
    from safety.safety_kernel import get_safety_kernel
    from engine.runtime_transport import get_transport
    from app_state import show_engine
    safety = get_safety_kernel()
    transport = get_transport()
    return {
        "safety": safety.get_status(),
        "transport": transport.get_status(),
        "engine": show_engine.get_state(),
        "hardware_conflicts": show_engine.get_hardware_conflicts(),
    }


@router.get("/status")
async def mobile_status():
    """Live monitoring snapshot + active alerts for the mobile app."""
    try:
        return build_mobile_status(_live_status())
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@router.get("/alerts")
async def mobile_alerts():
    """Active alerts (prioritized)."""
    try:
        return {"alerts": get_alert_manager().ingest(_live_status()),
                "unacknowledged": get_alert_manager().unacknowledged_count()}
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@router.post("/alerts/ack")
async def mobile_ack(payload: dict):
    """Acknowledge an alert by code."""
    code = payload.get("code") or payload.get("id")
    if not code:
        raise HTTPException(400, "alert code required")
    ok = get_alert_manager().acknowledge(str(code))
    return {"acknowledged": ok, "code": code}


@router.post("/command")
async def mobile_command(payload: dict):
    """
    Remote control from the mobile app. Validates the command against the live
    safety state, then dispatches it. E-stop / stop are always permitted; play is
    blocked on hardware conflict, no permit, or E-stop.

    Body: {"command": "play|pause|stop|estop|arm|disarm|reset|blackout|seek", "position_ms"?: n}
    """
    command = str(payload.get("command", "")).lower().strip()
    status = _live_status()
    decision = validate_remote_command(command, status)
    if not decision["allowed"]:
        return {"executed": False, **decision}

    try:
        from safety.safety_kernel import get_safety_kernel
        from engine.runtime_transport import get_transport
        safety = get_safety_kernel()
        transport = get_transport()
        if command == "estop":
            safety.emergency_stop(source="mobile")
        elif command == "reset":
            safety.reset_faults()
        elif command == "arm":
            safety.arm()
        elif command == "disarm":
            safety.disarm()
        elif command == "play":
            transport.play()
        elif command == "pause":
            transport.pause()
        elif command == "stop":
            transport.stop()
        elif command == "seek":
            transport.seek(int(payload.get("position_ms", 0)))
        elif command == "blackout":
            from app_state import protocol_bus
            import asyncio
            try:
                asyncio.get_event_loop().create_task(protocol_bus.blackout())
            except Exception:
                pass
        return {"executed": True, **decision}
    except Exception as e:
        # The command was permitted; surface a dispatch error without 500-ing the app.
        return {"executed": False, "command": command, "allowed": True,
                "reason": "Dispatch error: " + str(e)}
