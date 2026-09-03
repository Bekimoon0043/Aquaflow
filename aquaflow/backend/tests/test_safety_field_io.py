"""
AF-IO-004 — tests for the field-I/O → safety-kernel wiring.

The contract:
  * no manager attached / nothing required → behaviour bit-identical to today;
  * a REQUIRED point that is not GOOD (UNKNOWN/STALE/FAULT/dead heartbeat)
    withdraws the master permit and raises SENSOR_FAULT — non-latched, so the
    permit returns BY ITSELF when the sensor reads GOOD again;
  * a non-required point never touches the permit and is listed "unmonitored";
  * a GOOD boolean reading plumbs into the named safety input (a real E-stop
    contact drives the real interlock, including the emergency-stop transition);
  * PLC liveness = the heartbeat counter CHANGING, via FieldIOManager;
  * SAFETY_BYPASS is visible in the status payload;
  * end to end: a live rack goes dark → readings age to STALE → permit drops,
    with the real FieldIOManager and the real scripted Modbus server.
"""
import asyncio

from engine.field_io import FieldIOManager
from engine.field_points import FieldPointStore, Quality
from safety.safety_kernel import SafetyKernel, SafetyState, FaultCode
from tests.test_modbus_client import ScriptedModbusServer


def _armed_kernel() -> SafetyKernel:
    """A fresh kernel driven to ARMED by ticking it directly (no 50 Hz loop)."""
    k = SafetyKernel()
    for _ in range(8):
        k._tick()
    assert k.state == SafetyState.SAFE_IDLE
    assert k.arm()
    k._tick()
    assert k.outputs.permit is True
    return k


class StubFieldIO:
    """Duck-typed stand-in for FieldIOManager: store + get + heartbeat_alive."""

    def __init__(self, tmp_path):
        self.store = FieldPointStore(tmp_path / "fp.json")
        self.readings = {}
        self.hb = None

    def get(self, pid, now=None):
        from engine.field_points import UNKNOWN_READING
        return self.readings.get(pid, UNKNOWN_READING)

    def heartbeat_alive(self):
        return self.hb


def _reading(value, quality):
    from engine.field_points import Reading
    import time
    return Reading(value, quality, time.time(), None)


# ── identity when nothing is attached or required ───────────────────────────────
def test_no_field_io_behaviour_unchanged():
    k = _armed_kernel()
    status = k.get_status()
    assert status["permit"] is True
    assert status["safety_bypass"] is False
    assert status["field_io"]["attached"] is False


def test_attached_but_nothing_required_keeps_permit(tmp_path):
    k = _armed_kernel()
    stub = StubFieldIO(tmp_path)
    stub.store.upsert(id="level", source="modbus:1.2.3.4", address="0", kind="AI",
                      binds_to="water_level_ok")            # bound, NOT required
    k.attach_field_io(stub)
    k._tick()                                               # reading is UNKNOWN
    assert k.outputs.permit is True                         # permit untouched
    fio = k.get_status()["field_io"]
    assert fio["unmonitored"] == ["level"]
    assert fio["monitored"] == []
    assert fio["blind_required"] == []


# ── the fail-closed rule ────────────────────────────────────────────────────────
def test_required_unknown_withdraws_permit_and_recovers(tmp_path):
    k = _armed_kernel()
    stub = StubFieldIO(tmp_path)
    stub.store.upsert(id="pressure", source="modbus:1.2.3.4", address="0", kind="AI",
                      required=True, binds_to="pressure_ok")
    k.attach_field_io(stub)

    k._tick()                                               # UNKNOWN → blind
    assert k.outputs.permit is False
    assert k.state == SafetyState.ARMED                     # state machine untouched
    assert any(f.code == FaultCode.SENSOR_FAULT for f in k.fault_log)
    assert k.get_status()["field_io"]["blind_required"] == ["pressure(UNKNOWN)"]

    stub.readings["pressure"] = _reading(5.2, Quality.GOOD)
    k._tick()                                               # sensor back → permit back
    assert k.outputs.permit is True
    assert k.get_status()["field_io"]["blind_required"] == []


def test_required_fault_and_stale_also_blind(tmp_path):
    k = _armed_kernel()
    stub = StubFieldIO(tmp_path)
    stub.store.upsert(id="pressure", source="modbus:1.2.3.4", address="0", kind="AI",
                      required=True, binds_to="pressure_ok")
    k.attach_field_io(stub)
    for q in (Quality.FAULT, Quality.STALE):
        stub.readings["pressure"] = _reading(None if q == Quality.FAULT else 4.0, q)
        k._tick()
        assert k.outputs.permit is False, q
    stub.readings["pressure"] = _reading(4.0, Quality.GOOD)
    k._tick()
    assert k.outputs.permit is True


def test_sensor_fault_logged_once_not_at_50hz(tmp_path):
    k = _armed_kernel()
    stub = StubFieldIO(tmp_path)
    stub.store.upsert(id="pressure", source="modbus:1.2.3.4", address="0", kind="AI",
                      required=True, binds_to="pressure_ok")
    k.attach_field_io(stub)
    for _ in range(50):
        k._tick()
    sensor_faults = [f for f in k.fault_log if f.code == FaultCode.SENSOR_FAULT]
    assert len(sensor_faults) == 1                          # edge, not level


# ── value plumbing ──────────────────────────────────────────────────────────────
def test_good_di_reading_drives_real_interlock(tmp_path):
    k = _armed_kernel()
    stub = StubFieldIO(tmp_path)
    stub.store.upsert(id="estop", source="modbus:1.2.3.4", address="0", kind="DI",
                      raw_type="bool", binds_to="estop_chain_closed")
    k.attach_field_io(stub)
    stub.readings["estop"] = _reading(True, Quality.GOOD)
    k._tick()
    assert k.state == SafetyState.ARMED                     # chain closed → fine
    stub.readings["estop"] = _reading(False, Quality.GOOD)  # contact OPENS
    k._tick()
    assert k.state == SafetyState.EMERGENCY_STOP            # the REAL interlock fired
    assert k.outputs.permit is False


# ── heartbeat liveness ──────────────────────────────────────────────────────────
def test_frozen_heartbeat_faults_and_required_heartbeat_blinds(tmp_path):
    k = _armed_kernel()
    stub = StubFieldIO(tmp_path)
    stub.store.upsert(id="plc_hb", source="modbus:1.2.3.4", address="0", kind="AI",
                      required=True, binds_to="heartbeat")
    k.attach_field_io(stub)

    stub.hb = True
    k._tick()
    assert k.outputs.permit is True
    assert k.inputs.plc_heartbeat_ok is True

    stub.hb = False                                         # counter froze
    k._tick()
    assert k.inputs.plc_heartbeat_ok is False
    assert k.outputs.permit is False                        # required heartbeat dead
    assert any(f.code == FaultCode.PLC_COMM_LOSS for f in k.fault_log)
    assert "plc_hb(HEARTBEAT_DEAD)" in k.get_status()["field_io"]["blind_required"]

    stub.hb = True                                          # CPU back
    k._tick()
    assert k.outputs.permit is True


# ── visibility ──────────────────────────────────────────────────────────────────
def test_safety_bypass_visible_in_status():
    k = SafetyKernel()
    assert k.get_status()["safety_bypass"] is False
    k.set_safety_bypass(True)
    assert k.get_status()["safety_bypass"] is True


# ── end to end: real manager, real (scripted) device, real aging ───────────────
def test_device_death_withdraws_permit_end_to_end(tmp_path):
    async def run():
        server = ScriptedModbusServer()
        await server.start()
        store = FieldPointStore(tmp_path / "fp.json")
        store.upsert(id="pressure", source=f"modbus:127.0.0.1:{server.port}",
                     address="%MW1", kind="AI", scale=0.1,
                     required=True, binds_to="pressure_ok")
        mgr = FieldIOManager(store, scan_rate_s=0.05)
        k = _armed_kernel()
        k.attach_field_io(mgr)
        await mgr.start()

        # Live rack: reading GOOD → permit holds.
        deadline = asyncio.get_event_loop().time() + 3.0
        while (mgr.get("pressure").quality != Quality.GOOD
               and asyncio.get_event_loop().time() < deadline):
            await asyncio.sleep(0.02)
        k._tick()
        permit_live = k.outputs.permit

        # Rack goes dark. Nothing notices explicitly — aging does the work.
        await mgr.stop()
        await server.stop()
        await asyncio.sleep(mgr.max_age_s + 0.1)
        k._tick()
        permit_dark = k.outputs.permit
        blind = k.get_status()["field_io"]["blind_required"]
        return permit_live, permit_dark, blind

    permit_live, permit_dark, blind = asyncio.run(run())
    assert permit_live is True
    assert permit_dark is False
    assert blind == ["pressure(STALE)"]
