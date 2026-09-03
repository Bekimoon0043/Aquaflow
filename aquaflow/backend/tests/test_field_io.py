"""
AF-IO-003 — tests for engine/field_io.py (FieldIOManager, the reader loop).

What must hold:
  * declared points get polled and land as GOOD quality-tagged readings (FC03
    holding, FC04 input-register notation, FC02 discrete inputs);
  * when the device dies, readings age into STALE by themselves — no code has to
    notice the failure;
  * a source with no available transport (s7: before AF-IO-005) reads UNKNOWN,
    never crashes, never silently skips;
  * a device answering "illegal address" is a config problem → UNKNOWN;
  * heartbeat liveness is judged on the counter CHANGING — a frozen value from a
    live socket (halted CPU) goes dead;
  * bound_snapshot reports the WORST reading per safety input;
  * consumers pull via sync, await-free accessors.

Reuses the fault-injecting ScriptedModbusServer from test_modbus_client.
"""
import asyncio
import time

from engine.field_io import FieldIOManager
from engine.field_points import FieldPointStore, Quality
from tests.test_modbus_client import ScriptedModbusServer


def _store(tmp_path, server_port, extra=()):
    store = FieldPointStore(tmp_path / "fp.json")
    src = f"modbus:127.0.0.1:{server_port}"
    store.upsert(id="level", source=src, address="%MW0", kind="AI",
                 scale=0.01, unit="m", binds_to="water_level_ok")     # FC03 raw 1234
    store.upsert(id="flow", source=src, address="30004", kind="AI",
                 scale=1.0, unit="L/min", binds_to="pump_flow_ok")    # FC04 raw 777
    store.upsert(id="estop", source=src, address="0", kind="DI",
                 raw_type="bool", binds_to="estop_chain_closed")      # FC02 bit 0 = True
    for kwargs in extra:
        store.upsert(**kwargs)
    return store


async def _spin(mgr, cycles=3):
    """Wait until the manager has completed at least `cycles` more poll cycles."""
    target = mgr._cycles + cycles
    deadline = time.monotonic() + 5.0
    while mgr._cycles < target and time.monotonic() < deadline:
        await asyncio.sleep(0.02)


def test_polls_all_three_function_codes(tmp_path):
    async def run():
        server = ScriptedModbusServer()
        await server.start()
        mgr = FieldIOManager(_store(tmp_path, server.port), scan_rate_s=0.05)
        await mgr.start()
        await _spin(mgr)
        snap = mgr.snapshot()
        await mgr.stop()
        await server.stop()
        return snap

    snap = asyncio.run(run())
    assert snap["level"].quality == Quality.GOOD
    assert abs(snap["level"].value - 12.34) < 1e-9        # 1234 * 0.01
    assert snap["flow"].quality == Quality.GOOD
    assert snap["flow"].value == 777                       # input regs, 30004 → offset 3
    assert snap["estop"].quality == Quality.GOOD
    assert snap["estop"].value is True


def test_dead_device_ages_readings_into_stale(tmp_path):
    async def run():
        server = ScriptedModbusServer()
        await server.start()
        mgr = FieldIOManager(_store(tmp_path, server.port), scan_rate_s=0.05)
        await mgr.start()
        await _spin(mgr)
        good = mgr.get("level")
        # Device dies: drop connections AND stop the listener.
        await mgr.stop()          # stop polling before killing the server (no races)
        await server.stop()
        # Time passes beyond 3× scan: the same stored reading now reports STALE.
        later = good.ts + mgr.max_age_s + 1.0
        stale = mgr.get("level", now=later)
        return good, stale

    good, stale = asyncio.run(run())
    assert good.quality == Quality.GOOD
    assert stale.quality == Quality.STALE
    assert stale.value == good.value       # the operator still sees what it WAS


def test_unavailable_transport_reads_unknown(tmp_path):
    async def run():
        store = FieldPointStore(tmp_path / "fp.json")
        store.upsert(id="s7_pressure", source="s7:192.168.5.10", address="DB1.DBW4",
                     kind="AI", required=True)
        mgr = FieldIOManager(store, scan_rate_s=0.05)
        await mgr.start()
        await asyncio.sleep(0.1)
        snap = mgr.snapshot()
        status = mgr.get_status()
        await mgr.stop()
        return snap, status

    snap, status = asyncio.run(run())
    assert snap["s7_pressure"].quality == Quality.UNKNOWN
    assert status["by_quality"].get("UNKNOWN") == 1


def test_never_polled_point_is_unknown_not_missing(tmp_path):
    mgr = FieldIOManager(FieldPointStore(tmp_path / "fp.json"))
    assert mgr.get("no_such_point").quality == Quality.UNKNOWN
    assert mgr.get("no_such_point").value is None


def test_illegal_address_reads_unknown(tmp_path):
    async def run():
        server = ScriptedModbusServer("exception")
        await server.start()
        mgr = FieldIOManager(_store(tmp_path, server.port), scan_rate_s=0.05)
        await mgr.start()
        await _spin(mgr)
        snap = mgr.snapshot()
        await mgr.stop()
        await server.stop()
        return snap

    snap = asyncio.run(run())
    assert snap["level"].quality == Quality.UNKNOWN
    assert snap["level"].value is None


def test_heartbeat_judged_on_change_not_on_read_success(tmp_path):
    async def run():
        server = ScriptedModbusServer()
        server.holding[20] = 1000
        await server.start()
        store = _store(tmp_path, server.port, extra=[
            dict(id="plc_hb", source=f"modbus:127.0.0.1:{server.port}",
                 address="%MW20", kind="AI", binds_to="heartbeat"),
        ])
        mgr = FieldIOManager(store, scan_rate_s=0.05)
        await mgr.start()

        # Counter advancing: bump the register every scan for a while.
        for i in range(4):
            server.holding[20] += 1
            await _spin(mgr, 1)
        alive_while_counting = mgr.heartbeat_alive()

        # CPU halts: the register FREEZES but reads keep succeeding.
        await _spin(mgr, int(mgr.HEARTBEAT_FACTOR) + 3)
        alive_when_frozen = mgr.heartbeat_alive()

        still_good_read = mgr.get("plc_hb").quality
        await mgr.stop()
        await server.stop()
        return alive_while_counting, alive_when_frozen, still_good_read

    counting, frozen, read_quality = asyncio.run(run())
    assert counting is True
    assert frozen is False                 # a static DB read is not liveness
    assert read_quality == Quality.GOOD    # ...even though every read succeeded


def test_heartbeat_none_when_not_declared(tmp_path):
    mgr = FieldIOManager(FieldPointStore(tmp_path / "fp.json"))
    assert mgr.heartbeat_alive() is None   # nothing claims liveness that isn't measured


def test_bound_snapshot_reports_worst_reading(tmp_path):
    async def run():
        server = ScriptedModbusServer()
        await server.start()
        src = f"modbus:127.0.0.1:{server.port}"
        store = _store(tmp_path, server.port, extra=[
            # A second pressure sensor on the SAME safety input, wired 4-20 mA with a
            # broken loop (raw 0 with raw_min 5530 ≈ 0 mA → FAULT).
            dict(id="pressure_b", source=src, address="%MW9", kind="AI",
                 signal="4-20mA", raw_min=5530, raw_max=27648,
                 binds_to="pressure_ok"),
            dict(id="pressure_a", source=src, address="%MW1", kind="AI",
                 binds_to="pressure_ok"),
        ])
        server.holding[9] = 0              # dead loop for pressure_b
        mgr = FieldIOManager(store, scan_rate_s=0.05)
        await mgr.start()
        await _spin(mgr)
        bound = mgr.bound_snapshot()
        await mgr.stop()
        await server.stop()
        return bound

    bound = asyncio.run(run())
    assert bound["water_level_ok"].quality == Quality.GOOD
    # Two sensors, one healthy and one FAULT: the FAULT one speaks for the pair.
    assert bound["pressure_ok"].quality == Quality.FAULT
    # The heartbeat binding is excluded (judged by heartbeat_alive, not by value).
    assert "heartbeat" not in bound


def test_status_shape(tmp_path):
    async def run():
        server = ScriptedModbusServer()
        await server.start()
        mgr = FieldIOManager(_store(tmp_path, server.port), scan_rate_s=0.05)
        await mgr.start()
        await _spin(mgr)
        status = mgr.get_status()
        await mgr.stop()
        await server.stop()
        return status

    status = asyncio.run(run())
    assert status["running"] is True
    assert status["points"] == 3
    assert status["by_quality"].get("GOOD") == 3
    assert status["cycles"] >= 3
