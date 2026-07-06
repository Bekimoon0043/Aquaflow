"""
AF-HUB-007C — Failure mode recovery paths.

Recovery is the gated counterpart to the single-authority E-stop (AF-HUB-006B): the
runtime can only return to a safe idle state once the blocking conditions have cleared,
and a refused recovery must report exactly WHY (never a silent no-op) and must not wipe
the fault evidence while the hazard is still present.
"""
import asyncio

from safety.safety_kernel import SafetyKernel, SafetyState
from engine.runtime_authority import RuntimeAuthority


def _clear_inputs(k):
    k.inputs.estop_chain_closed = True
    k.inputs.plc_heartbeat_ok = True
    k.inputs.watchdog_ok = True
    k.inputs.water_level_ok = True
    k.inputs.pressure_ok = True
    k.inputs.pump_flow_ok = True
    k.inputs.valve_positions_ok = True
    k.inputs.vfd_ok = True
    k.inputs.thermal_ok = True


# ── Safety kernel: reset ordering + blocker reporting ───────────────────────────

def test_refused_reset_does_not_wipe_fault_evidence():
    """The old reset_faults cleared latched faults BEFORE checking inputs, hiding a
    still-present hazard. Now a refused reset leaves the record intact."""
    k = SafetyKernel()
    k.emergency_stop("test")            # latches ESTOP_OPEN
    k.inputs.water_level_ok = False     # a real hazard is present
    assert k.reset_faults() is False
    assert k.latched_faults, "refused recovery wiped the latched faults"
    assert k.state == SafetyState.EMERGENCY_STOP


def test_reset_succeeds_when_inputs_clear():
    k = SafetyKernel()
    k.emergency_stop("test")
    _clear_inputs(k)
    assert k.reset_faults() is True
    assert k.state == SafetyState.SAFE_IDLE
    assert not k.latched_faults


def test_recovery_blockers_names_each_failing_input():
    k = SafetyKernel()
    assert k.recovery_blockers() == []
    k.inputs.estop_chain_closed = False
    k.inputs.plc_heartbeat_ok = False
    blockers = k.recovery_blockers()
    assert "E-stop chain open" in blockers
    assert "PLC heartbeat lost" in blockers


# ── Runtime authority: coordinated recover() ────────────────────────────────────

def test_recover_blocked_reports_reasons_and_records_last_recovery():
    k = SafetyKernel()
    k.emergency_stop("t")
    k.inputs.estop_chain_closed = False
    auth = RuntimeAuthority().register(safety=k)
    r = asyncio.run(auth.recover(source="test"))
    assert r["recovered"] is False
    assert "E-stop chain open" in r["blocked_by"]
    assert auth.get_status()["last_recovery"]["source"] == "test"


def test_recover_succeeds_when_conditions_clear():
    k = SafetyKernel()
    k.emergency_stop("t")
    _clear_inputs(k)
    auth = RuntimeAuthority().register(safety=k)
    r = asyncio.run(auth.recover())
    assert r["recovered"] is True
    assert r["state"] == "SAFE_IDLE"


def test_recover_without_safety_is_blocked_not_crashed():
    auth = RuntimeAuthority()  # no safety registered
    r = asyncio.run(auth.recover())
    assert r["recovered"] is False
    assert r["blocked_by"] == ["safety kernel not registered"]


# ── Full round-trip: E-stop → recover through the shared authority + route ───────

def test_emergency_stop_then_recover_roundtrip():
    from app_state import runtime_authority
    from safety.safety_kernel import get_safety_kernel
    k = get_safety_kernel()

    asyncio.run(runtime_authority.emergency_stop("integration"))
    assert k.state == SafetyState.EMERGENCY_STOP

    # hazard present → recovery refused with a reason
    k.inputs.estop_chain_closed = False
    blocked = asyncio.run(runtime_authority.recover("integration"))
    assert blocked["recovered"] is False and blocked["blocked_by"]

    # conditions clear → recovery succeeds back to SAFE_IDLE
    _clear_inputs(k)
    ok = asyncio.run(runtime_authority.recover("integration"))
    assert ok["recovered"] is True
    assert k.state == SafetyState.SAFE_IDLE


def test_safety_reset_route_delegates_to_authority():
    from api.routes.phase6_routes import safety_reset
    from safety.safety_kernel import get_safety_kernel
    k = get_safety_kernel()

    k.emergency_stop("t")
    k.inputs.plc_heartbeat_ok = False
    res = asyncio.run(safety_reset())
    assert res["ok"] is False
    assert res["blocked_by"]

    _clear_inputs(k)
    res2 = asyncio.run(safety_reset())
    assert res2["ok"] is True
    assert res2["state"] == "SAFE_IDLE"
