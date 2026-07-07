"""
AF-HUB-FINAL-VERIFY — mobile remote commands must use the single authorities.

The final verification walk found /api/mobile/command bypassing them: estop tripped only
the safety kernel (partial E-stop), blackout zeroed only the protocol bus, reset skipped
the gated recovery, and play/pause/stop/seek drove the DEMOTED RuntimeTransport mirror —
which, post AF-HUB-013, no longer controls playback at all. These tests lock the fix.
"""
import asyncio

from api.routes.mobile_routes import mobile_command


def test_mobile_estop_goes_through_the_single_authority():
    from app_state import runtime_authority
    res = asyncio.run(mobile_command({"command": "estop"}))
    assert res["executed"] is True
    trip = runtime_authority.get_status()["last_trip"]
    assert trip["kind"] == "emergency_stop"
    assert trip["source"] == "mobile"
    # full fan-out — not just the safety kernel
    assert "show_engine" in trip["results"]
    assert "protocol_bus" in trip["results"]


def test_mobile_blackout_goes_through_the_single_authority():
    from app_state import runtime_authority
    res = asyncio.run(mobile_command({"command": "blackout"}))
    assert res["executed"] is True
    trip = runtime_authority.get_status()["last_trip"]
    assert trip["kind"] == "blackout"
    assert trip["source"] == "mobile"


def test_mobile_reset_uses_gated_recovery_and_reports_blockers():
    from safety.safety_kernel import get_safety_kernel
    k = get_safety_kernel()
    k.emergency_stop("test")
    k.inputs.estop_chain_closed = False  # hazard still present → recovery must refuse
    res = asyncio.run(mobile_command({"command": "reset"}))
    assert res["executed"] is False
    assert "blocked" in res["reason"].lower()
    # restore for other tests
    k.inputs.estop_chain_closed = True
    k.reset_faults()


def test_mobile_stop_drives_the_playback_authority_not_the_mirror():
    from app_state import show_engine
    from engine.show_engine import PlaybackState
    res = asyncio.run(mobile_command({"command": "stop"}))
    assert res["executed"] is True
    assert show_engine.show_state.state == PlaybackState.STOPPED
