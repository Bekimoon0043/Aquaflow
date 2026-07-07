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
        # AF-HUB-FINAL-VERIFY — this route previously bypassed the single authorities:
        # estop tripped only the safety kernel (partial), blackout zeroed only the bus,
        # reset skipped the gated recovery, and play/pause/stop/seek drove the DEMOTED
        # RuntimeTransport mirror (post AF-HUB-013 that no longer controls playback).
        # All commands now go through the same authorities as every other entry point.
        from safety.safety_kernel import get_safety_kernel
        from app_state import runtime_authority, show_engine
        safety = get_safety_kernel()
        if command == "estop":
            await runtime_authority.emergency_stop(source="mobile")
        elif command == "reset":
            result = await runtime_authority.recover(source="mobile")
            if not result["recovered"]:
                return {"executed": False, "command": command, "allowed": True,
                        "reason": "Recovery blocked: " + "; ".join(result["blocked_by"])}
        elif command == "arm":
            safety.arm()
        elif command == "disarm":
            safety.disarm()
        elif command == "play":
            started = await show_engine.play()
            if not started:
                return {"executed": False, "command": command, "allowed": True,
                        "reason": show_engine.last_error or "Playback refused"}
        elif command == "pause":
            await show_engine.pause()
        elif command == "stop":
            await show_engine.stop_playback()
        elif command == "seek":
            await show_engine.seek(int(payload.get("position_ms", 0)) / 1000.0)
        elif command == "blackout":
            await runtime_authority.blackout(source="mobile")
        return {"executed": True, **decision}
    except Exception as e:
        # The command was permitted; surface a dispatch error without 500-ing the app.
        return {"executed": False, "command": command, "allowed": True,
                "reason": "Dispatch error: " + str(e)}
