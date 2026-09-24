"""
1.2.5 — the three PLC libraries are bundled and their drivers are exercised
against INDEPENDENT implementations, never against our own code:

  * SiemensS7Driver  → python-snap7 (pure Python client) talking to FakeS7Server
                        (our S7comm test double: independent of snap7's framing);
  * OPCUADriver      → asyncua Client talking to an asyncua Server;
  * AllenBradleyDriver → pycomm3 LogixDriver talking to the cpppo EtherNet/IP
                        Logix simulator (`python -m cpppo.server.enip`): connect,
                        identity, typed reads with declared tag types. Writes are
                        unit-tested with a stub (cpppo does not accept pycomm3's
                        connected Write Tag), and are marked as such.

Nothing here claims a physical PLC was driven.
"""
import asyncio
import socket
import subprocess
import sys
import time
from types import SimpleNamespace

import pytest

from engine.fake_s7_server import FakeS7Server
from plc.plc_engine import (
    AllenBradleyDriver,
    OPCUADriver,
    PLCConnection,
    PLCTag,
    PLCType,
    SiemensS7Driver,
    TagType,
)


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _cfg(plc_type, port, slot=1):
    return PLCConnection(id=f"lib-{plc_type}", name="lib", plc_type=PLCType(plc_type),
                         ip="127.0.0.1", port=port, rack=0, slot=slot)


def _tag(address, ttype, scale=1.0, offset=0.0):
    return PLCTag(id=address, name=address, address=address, tag_type=ttype,
                  scale_factor=scale, offset=offset)


# ── Siemens: snap7 transport against the S7comm test double ─────────────────────
def test_siemens_driver_uses_snap7_and_round_trips_typed_db_values():
    async def run():
        server = FakeS7Server()
        await server.start()
        server.dbs[1] = bytearray(64)
        drv = SiemensS7Driver(_cfg("siemens_s7", server.port))
        assert drv._has_snap7, "python-snap7 must be importable in this build"
        try:
            assert await drv.connect() is True
            assert drv._snap7 is not None and drv._raw_client is None   # snap7 path chosen
            w_int = _tag("DB1.DBW0", TagType.INT)
            w_real = _tag("DB1.DBD4", TagType.REAL)
            w_bit = _tag("DB1.DBX8.3", TagType.BOOL)
            assert await drv.write_tag(w_int, 1234)
            assert await drv.write_tag(w_real, 27.5)
            assert await drv.write_tag(w_bit, True)
            out = await drv.read_all_tags([w_int, w_real, w_bit])
            return out, bytes(server.dbs[1][:10]), server.writes, server.reads
        finally:
            await drv.disconnect()
            await server.stop()
    out, raw, writes, reads = asyncio.run(run())
    assert out["DB1.DBW0"] == 1234
    assert abs(out["DB1.DBD4"] - 27.5) < 1e-6
    assert out["DB1.DBX8.3"] is True
    assert raw[0:2] == (1234).to_bytes(2, "big")                 # big-endian INT on the wire
    assert raw[8] & 0x08                                          # bit 3 of byte 8 set
    assert writes >= 3 and reads >= 3


def test_siemens_driver_honours_the_configured_port():
    """PLCSIM via NetToPLCsim / a fake on another port: snap7 must connect to
    config.port, not always 102 (the old code ignored the field)."""
    async def run():
        server = FakeS7Server()
        await server.start()
        drv = SiemensS7Driver(_cfg("siemens_s7", server.port))
        try:
            return await drv.connect()
        finally:
            await drv.disconnect()
            await server.stop()
    assert asyncio.run(run()) is True


# ── OPC UA: asyncua client against an asyncua server ────────────────────────────
def test_opcua_driver_reads_and_writes_typed_nodes():
    async def run():
        from asyncua import Server, ua
        port = _free_port()
        srv = Server()
        await srv.init()
        srv.set_endpoint(f"opc.tcp://127.0.0.1:{port}/aquaflow/")
        srv.set_security_policy([ua.SecurityPolicyType.NoSecurity])
        idx = await srv.register_namespace("urn:aquaflow:test")
        obj = await srv.nodes.objects.add_object(idx, "Fountain")
        speed = await obj.add_variable(idx, "Pump1_Speed", 12.5)                # Double
        await speed.set_writable()
        valve = await obj.add_variable(idx, "Valve1", False)                    # Boolean
        await valve.set_writable()
        count = await obj.add_variable(idx, "Counter", ua.Variant(3, ua.VariantType.Int32))
        await count.set_writable()
        level = await obj.add_variable(idx, "Level", ua.Variant(1.5, ua.VariantType.Float))
        await level.set_writable()
        async with srv:
            cfg = _cfg("opc_ua", port)
            # the endpoint carries a path — the operator pastes the full URL into the IP field
            cfg.ip = f"opc.tcp://127.0.0.1:{port}/aquaflow/"
            drv = OPCUADriver(cfg)
            assert drv.url == cfg.ip
            assert OPCUADriver(_cfg("opc_ua", 4840)).url == "opc.tcp://127.0.0.1:4840"
            try:
                assert await drv.connect() is True, cfg.last_error
                t_speed = _tag(speed.nodeid.to_string(), TagType.REAL, scale=2.0, offset=1.0)
                t_valve = _tag(valve.nodeid.to_string(), TagType.BOOL)
                t_count = _tag(count.nodeid.to_string(), TagType.DINT)
                t_level = _tag(level.nodeid.to_string(), TagType.REAL)
                first = await drv.read_all_tags([t_speed, t_valve, t_count, t_level])
                # writes are typed from the node's own DataType, and un-scaled
                assert await drv.write_tag(t_speed, 41.0)      # (41-1)/2 = 20.0 Double
                assert await drv.write_tag(t_valve, True)
                assert await drv.write_tag(t_count, 9)         # Int32, not Double
                assert await drv.write_tag(t_level, 2.25)      # Float, not Double
                second = await drv.read_all_tags([t_speed, t_valve, t_count, t_level])
                raw_count = await count.read_value()
                raw_speed = await speed.read_value()
                return first, second, raw_count, raw_speed
            finally:
                await drv.disconnect()
    first, second, raw_count, raw_speed = asyncio.run(run())
    assert first[[k for k in first if k.endswith("i=2")][0]] == 12.5 * 2.0 + 1.0   # scaled read
    assert first[[k for k in first if k.endswith("i=3")][0]] is False               # bool stays bool
    assert first[[k for k in first if k.endswith("i=4")][0]] == 3.0
    assert second[[k for k in second if k.endswith("i=3")][0]] is True
    assert raw_count == 9 and isinstance(raw_count, int)
    assert raw_speed == 20.0
    assert abs(second[[k for k in second if k.endswith("i=5")][0]] - 2.25) < 1e-6


def test_opcua_driver_fails_closed_when_nothing_listens():
    async def run():
        drv = OPCUADriver(_cfg("opc_ua", _free_port()))
        ok = await drv.connect()
        return ok, drv.config.last_error
    ok, err = asyncio.run(run())
    assert ok is False and err


# ── Allen-Bradley: pycomm3 against the cpppo Logix simulator ─────────────────────
def _cpppo_available() -> bool:
    try:
        import cpppo  # noqa: F401
        return True
    except ImportError:
        return False


@pytest.mark.skipif(not _cpppo_available(), reason="cpppo simulator not installed (test-only dep)")
def test_allen_bradley_driver_connects_identifies_and_reads_declared_tags():
    port = _free_port()
    sim = subprocess.Popen(
        [sys.executable, "-m", "cpppo.server.enip", "-a", f"127.0.0.1:{port}",
         "Pump1_Speed=REAL", "Valve1=BOOL", "Counter=DINT", "Speeds=INT[8]"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.5).close()
                break
            except OSError:
                time.sleep(0.2)
        else:
            pytest.skip("cpppo simulator did not start")

        async def run():
            drv = AllenBradleyDriver(_cfg("allen_bradley", port, slot=0))
            assert drv._has_pycomm3
            try:
                ok = await drv.connect()
                assert ok is True, drv.config.last_error
                tags = [_tag("Pump1_Speed", TagType.REAL, scale=10.0, offset=5.0),
                        _tag("Valve1", TagType.BOOL), _tag("Counter", TagType.DINT),
                        _tag("Speeds[2]", TagType.INT)]
                vals = await drv.read_all_tags(tags)
                # a STRING with no controller tag list is refused, not guessed
                refused = await drv.read_tag(_tag("Name", TagType.STRING))
                return drv.identity, drv.tag_list_available, drv.path, vals, refused
            finally:
                await drv.disconnect()
        identity, tag_list, path, vals, refused = asyncio.run(run())
    finally:
        sim.kill()
        sim.communicate()
    assert path == f"127.0.0.1:{port}"                        # slot 0 → no /slot suffix
    assert identity["vendor"].startswith("Rockwell")
    assert "LOGIX" in identity["product_name"].upper()
    assert tag_list is False                                  # simulator serves no tag list
    assert vals == {"Pump1_Speed": 0.0 * 10.0 + 5.0, "Valve1": False, "Counter": 0.0, "Speeds[2]": 0.0}
    assert refused is None


def test_allen_bradley_write_is_typed_from_the_declared_tag():
    """Unit-level (stub pycomm3 driver): writes carry the controller type the
    operator declared, un-scaled — BOOL as bool, DINT/INT as int, REAL as float."""
    calls = []

    class StubPLC:
        tags = {}
        _tags = {}
        connected = True

        def write(self, req):
            calls.append(req)
            return SimpleNamespace(error=None)

        def read(self, name):
            return SimpleNamespace(value=7, error=None, type="DINT")

        def close(self):
            pass

    async def run():
        drv = AllenBradleyDriver(_cfg("allen_bradley", 44818, slot=0))
        drv._plc = StubPLC()
        drv._connected = True
        assert await drv.write_tag(_tag("Pump1_Speed", TagType.REAL, scale=2.0, offset=1.0), 41.0)
        assert await drv.write_tag(_tag("Counter", TagType.DINT), 12.6)
        assert await drv.write_tag(_tag("Valve1", TagType.BOOL), 1)
        assert await drv.write_tag(_tag("Speeds[3]", TagType.INT), 99)
        assert await drv.read_tag(_tag("Counter", TagType.DINT)) == 7.0
        return drv
    drv = asyncio.run(run())
    assert calls == [("Pump1_Speed", 20.0), ("Counter", 13), ("Valve1", True), ("Speeds[3]", 99)]
    assert isinstance(calls[0][1], float) and isinstance(calls[1][1], int) and calls[2][1] is True
    # declared definitions were injected with the right pycomm3 shape
    assert drv._plc._tags["Counter"]["data_type"] == "DINT"
    assert drv._plc._tags["Speeds"]["dim"] == 1 and drv._plc._tags["Speeds"]["dimensions"][0] >= 4


def test_allen_bradley_path_includes_slot_and_non_default_port():
    d = AllenBradleyDriver(_cfg("allen_bradley", 44818, slot=2))
    assert d.path == "127.0.0.1/2"
    d = AllenBradleyDriver(_cfg("allen_bradley", 44900, slot=0))
    assert d.path == "127.0.0.1:44900"
