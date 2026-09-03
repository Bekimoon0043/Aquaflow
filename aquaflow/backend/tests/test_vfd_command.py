"""
AF-IO-009 — tests for the safety-gated VFD write path.

The contract:
  * a speed command needs permit + pump_enable AT CALL TIME (no kernel, no permit,
    no pump_enable, no config → refused, and NOTHING reaches the wire);
  * a STOP is never gated — no permit, broken kernel, half a config: it still
    zeroes the speed and clears the enable bit;
  * fractions clamp to the point's raw span (contract: 0..27648);
  * both transports write correctly (S7 DB address, Modbus holding register);
  * everything is audited.
"""
import asyncio

import pytest

from engine.fake_s7_server import FakeS7Server
from engine.field_io import FieldIOManager
from engine.field_points import FieldPointStore
from engine.vfd_command import VFDCommander
from safety.safety_kernel import SafetyKernel, SafetyState
from tests.test_modbus_client import ScriptedModbusServer
from tests.test_safety_field_io import _armed_kernel


def _s7_setup(tmp_path, server):
    store = FieldPointStore(tmp_path / "fp.json")
    src = "s7:127.0.0.1"
    store.upsert(id="cmd_pump_speed", source=src, address="DB1.DBW12",
                 kind="AO", raw_min=0, raw_max=27648)
    store.upsert(id="cmd_enable", source=src, address="DB1.DBX14.0",
                 kind="DO", raw_type="bool")
    mgr = FieldIOManager(store, scan_rate_s=0.05)
    mgr._client_for(src).port = server.port      # aim the S7 client at the fake
    return mgr


def test_speed_refused_without_permit_and_nothing_hits_the_wire(tmp_path):
    async def run():
        server = FakeS7Server()
        await server.start()
        mgr = _s7_setup(tmp_path, server)
        kernel = SafetyKernel()                   # BOOT — no permit
        for _ in range(3):
            kernel._tick()
        cmd = VFDCommander(mgr, kernel)
        result = await cmd.set_speed(0.5)
        writes = server.writes
        await mgr.stop()
        await server.stop()
        return result, writes

    result, writes = asyncio.run(run())
    assert result["ok"] is False
    assert "permit" in result["refused"]
    assert writes == 0                            # nothing left the machine


def test_speed_refused_with_no_kernel_at_all(tmp_path):
    async def run():
        server = FakeS7Server()
        await server.start()
        mgr = _s7_setup(tmp_path, server)
        cmd = VFDCommander(mgr, None)
        result = await cmd.set_speed(0.5)
        await mgr.stop()
        await server.stop()
        return result

    result = asyncio.run(run())
    assert result["ok"] is False and "kernel" in result["refused"]


def test_permitted_speed_writes_scaled_raw_to_the_contract_address(tmp_path):
    async def run():
        server = FakeS7Server()
        await server.start()
        mgr = _s7_setup(tmp_path, server)
        cmd = VFDCommander(mgr, _armed_kernel())  # permit + pump_enable
        half = await cmd.set_speed(0.5)
        clamped = await cmd.set_speed(1.7)        # clamps to 1.0
        enab = await cmd.set_enabled(True)
        word = server.get_word(1, 12)
        bit = (server.dbs[1][14] >> 0) & 1
        await mgr.stop()
        await server.stop()
        return half, clamped, enab, word, bit

    half, clamped, enab, word, bit = asyncio.run(run())
    assert half["ok"] is True and half["raw"] == 13824      # round(0.5 * 27648)
    assert clamped["ok"] is True and clamped["raw"] == 27648
    assert word == 27648                                    # last write stands
    assert enab["ok"] is True and bit == 1


def test_stop_is_never_gated(tmp_path):
    async def run():
        server = FakeS7Server()
        await server.start()
        server.set_word(1, 12, 20000)             # VFD running fast
        server.set_bit(1, 14, 0, True)
        mgr = _s7_setup(tmp_path, server)
        kernel = SafetyKernel()                   # NO permit at all
        cmd = VFDCommander(mgr, kernel)
        result = await cmd.stop()
        word = server.get_word(1, 12)
        bit = (server.dbs[1][14] >> 0) & 1
        await mgr.stop()
        await server.stop()
        return result, word, bit

    result, word, bit = asyncio.run(run())
    assert result["ok"] is True
    assert result["speed_zeroed"] is True and word == 0
    assert result["disabled"] is True and bit == 0


def test_missing_config_refuses_speed_but_stop_still_succeeds(tmp_path):
    async def run():
        mgr = FieldIOManager(FieldPointStore(tmp_path / "fp.json"))
        cmd = VFDCommander(mgr, _armed_kernel())
        speed = await cmd.set_speed(0.5)
        stop = await cmd.stop()                   # nothing declared → nothing to do
        status = cmd.status()
        await mgr.stop()
        return speed, stop, status

    speed, stop, status = asyncio.run(run())
    assert speed["ok"] is False and "not declared" in speed["refused"]
    assert stop["ok"] is True
    assert stop["speed_zeroed"] is None and stop["disabled"] is None
    assert status["configured"] is False


def test_modbus_transport_variant(tmp_path):
    async def run():
        server = ScriptedModbusServer()
        await server.start()
        store = FieldPointStore(tmp_path / "fp.json")
        src = f"modbus:127.0.0.1:{server.port}"
        store.upsert(id="cmd_pump_speed", source=src, address="%MW12",
                     kind="AO", raw_min=0, raw_max=27648)
        store.upsert(id="cmd_enable", source=src, address="3",
                     kind="DO", raw_type="bool")
        mgr = FieldIOManager(store, scan_rate_s=0.05)
        cmd = VFDCommander(mgr, _armed_kernel())
        r = await cmd.set_speed(0.25)
        s = await cmd.stop()
        writes = list(server.writes)
        await mgr.stop()
        await server.stop()
        return r, s, writes

    r, s, writes = asyncio.run(run())
    assert r["ok"] is True and r["raw"] == 6912
    assert (0x06, 12, 6912) in writes             # FC06 to the speed register
    assert (0x06, 12, 0) in writes                # stop zeroed it
    assert (0x05, 3, 0x0000) in writes            # FC05 cleared the enable coil
    assert s["ok"] is True


def test_audit_records_refusals_and_commands(tmp_path):
    async def run():
        mgr = FieldIOManager(FieldPointStore(tmp_path / "fp.json"))
        cmd = VFDCommander(mgr, None)
        await cmd.set_speed(0.5)                  # refused: no kernel
        await cmd.stop()
        await mgr.stop()
        return cmd.audit(), cmd.status()

    audit, status = asyncio.run(run())
    assert [a["action"] for a in audit] == ["set_speed", "stop"]
    assert audit[0]["ok"] is False
    assert status["last_command"]["action"] == "stop"
    assert status["gate"] is not None             # says WHY commands would refuse
