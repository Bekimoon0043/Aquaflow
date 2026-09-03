"""
AF-IO-005 — tests for engine/s7_client.py against the AF-IO-008 fake PLC.

The heart of it: the 3-byte S7 item address is in BITS (byte_offset*8 + bit). The
old raw driver encoded (offset>>5, (offset&0x1f)<<3), which coincides with the
truth ONLY at offset 0 — so reading at non-zero offsets, both word and bit, is the
regression suite. Plus: typed reads/writes (WORD/INT/DWORD/DINT/REAL/BIT), address
parsing that refuses instead of guessing, item errors vs frame errors, and the
driver + FieldIOManager integrations.
"""
import asyncio
import struct

import pytest

from engine.fake_s7_server import FakeS7Server
from engine.s7_client import (
    S7Client,
    S7FrameError,
    S7ItemError,
    parse_s7_address,
)


async def _client(server, **kw) -> S7Client:
    c = S7Client("127.0.0.1", server.port, **kw)
    assert await c.connect()
    return c


# ── address parsing ─────────────────────────────────────────────────────────────
def test_parse_s7_address():
    assert parse_s7_address("DB1.DBW4") == (1, "W", 4, None)
    assert parse_s7_address("db1.dbw4") == (1, "W", 4, None)
    assert parse_s7_address("DB2.DBX2.7") == (2, "X", 2, 7)
    assert parse_s7_address("DB1.DBB3") == (1, "B", 3, None)
    assert parse_s7_address("DB10.DBD8") == (10, "D", 8, None)


def test_parse_s7_address_refuses_malformed():
    for bad in ("", "DB1", "DB1.DBW", "DB1.DBX2", "DB1.DBW4.1", "MW100",
                "DB1.DBX2.8", "40001"):
        with pytest.raises(ValueError):
            parse_s7_address(bad)


# ── the bit-addressing regression ───────────────────────────────────────────────
def test_reads_correct_at_nonzero_offsets():
    async def run():
        server = FakeS7Server()
        await server.start()
        server.set_word(1, 0, 1111)
        server.set_word(1, 4, 2222)
        server.set_word(1, 34, 3333)     # offset 34: old encoding read offset 1·32+16
        c = await _client(server)
        vals = (await c.read_word(1, 0), await c.read_word(1, 4),
                await c.read_word(1, 34))
        await c.close()
        await server.stop()
        return vals

    assert asyncio.run(run()) == (1111, 2222, 3333)


def test_bit_read_and_write():
    async def run():
        server = FakeS7Server()
        await server.start()
        server.set_bit(1, 2, 0, True)              # DB1.DBX2.0
        c = await _client(server)
        estop = await c.read_bit(1, 2, 0)
        other = await c.read_bit(1, 2, 1)
        assert await c.write_bit(1, 2, 1, True)    # write DB1.DBX2.1
        after = await c.read_bit(1, 2, 1)
        await c.close()
        await server.stop()
        return estop, other, after

    estop, other, after = asyncio.run(run())
    assert estop is True and other is False and after is True


# ── typed round trips ───────────────────────────────────────────────────────────
def test_typed_reads_and_writes():
    async def run():
        server = FakeS7Server()
        await server.start()
        server.dbs[1] = bytearray(64)
        struct.pack_into(">h", server.dbs[1], 10, -123)      # INT at DBW10
        struct.pack_into(">i", server.dbs[1], 12, -70000)    # DINT at DBD12
        struct.pack_into(">f", server.dbs[1], 16, 3.25)      # REAL at DBD16
        c = await _client(server)
        results = (
            await c.read_int(1, 10),
            await c.read_dint(1, 12),
            await c.read_real(1, 16),
        )
        assert await c.write_word(1, 20, 4242)
        assert await c.write_real(1, 24, -1.5)
        after = (await c.read_word(1, 20), await c.read_real(1, 24))
        await c.close()
        await server.stop()
        return results, after

    (i16, i32, f32), (w, r) = asyncio.run(run())
    assert i16 == -123 and i32 == -70000 and f32 == pytest.approx(3.25)
    assert w == 4242 and r == pytest.approx(-1.5)


def test_read_address_dialect():
    async def run():
        server = FakeS7Server()
        await server.start()
        server.set_word(1, 4, 27648)
        server.set_bit(1, 2, 0, True)
        struct.pack_into(">f", server.dbs[1], 16, 9.5)
        c = await _client(server)
        vals = (
            await c.read_address("DB1.DBW4"),
            await c.read_address("DB1.DBX2.0"),
            await c.read_address("DB1.DBD16", raw_type="real"),
        )
        await c.close()
        await server.stop()
        return vals

    w, x, r = asyncio.run(run())
    assert w == 27648 and x == 1 and r == pytest.approx(9.5)


# ── errors: item vs frame ───────────────────────────────────────────────────────
def test_item_error_keeps_connection_up():
    async def run():
        server = FakeS7Server()
        await server.start()
        c = await _client(server)
        with pytest.raises(S7ItemError) as ei:
            await c.read_word(9, 0)                # DB9 doesn't exist
        up = c.is_connected
        still_works = await c.read_word(1, 0)      # same connection still fine
        await c.close()
        await server.stop()
        return ei.value, up, still_works

    err, up, still = asyncio.run(run())
    assert err.name == "ADDRESS_OUT_OF_RANGE"
    assert up is True and still == 0


def test_drop_and_short_are_frame_errors_marking_down():
    for mode in ("drop", "short"):
        async def run(mode=mode):
            server = FakeS7Server(mode)
            await server.start()
            c = await _client(server)              # handshake always succeeds
            with pytest.raises(S7FrameError):
                await c.read_word(1, 0)
            down = not c.is_connected
            await c.close()
            await server.stop()
            return down

        assert asyncio.run(run()) is True, mode


def test_ensure_connected_backoff():
    async def run():
        probe = await asyncio.start_server(lambda r, w: None, "127.0.0.1", 0)
        dead_port = probe.sockets[0].getsockname()[1]
        probe.close()
        await probe.wait_closed()
        c = S7Client("127.0.0.1", dead_port, connect_timeout=0.3)
        assert not await c.ensure_connected()
        import time
        t0 = time.monotonic()
        assert not await c.ensure_connected()      # inside backoff → instant refuse
        assert time.monotonic() - t0 < 0.2
        await c.close()
    asyncio.run(run())


# ── the production integrations ─────────────────────────────────────────────────
def test_plc_engine_raw_driver_reads_and_writes():
    from plc.plc_engine import SiemensS7Driver, PLCConnection, PLCTag, PLCType, TagType

    async def run():
        server = FakeS7Server()
        await server.start()
        server.set_word(1, 4, 20000)
        cfg = PLCConnection(id="s1", name="bench", plc_type=PLCType.SIEMENS_S7,
                            ip="127.0.0.1", port=102)
        driver = SiemensS7Driver(cfg)
        driver._has_snap7 = False                  # force the raw path
        driver.S7COMM_PORT = server.port
        assert await driver.connect()

        tag_w = PLCTag(id="lvl", name="Level", address="DB1.DBW4",
                       tag_type=TagType.INT, scale_factor=1.0)
        tag_b = PLCTag(id="run", name="Pump Run", address="DB1.DBX2.0",
                       tag_type=TagType.BOOL)
        read_w = await driver.read_tag(tag_w)
        # The old raw path could not write AT ALL without snap7; BOOL writes now work.
        wrote_b = await driver.write_tag(tag_b, True)
        read_b = await driver.read_tag(tag_b)
        wrote_w = await driver.write_tag(tag_w, 12345)
        await driver.disconnect()
        await server.stop()
        return read_w, wrote_b, read_b, wrote_w, server.get_word(1, 4)

    read_w, wrote_b, read_b, wrote_w, stored = asyncio.run(run())
    assert read_w == 20000
    assert wrote_b is True and read_b == 1
    assert wrote_w is True and stored == 12345


def test_field_io_manager_polls_s7_source(tmp_path):
    from engine.field_io import FieldIOManager
    from engine.field_points import FieldPointStore, Quality

    async def run():
        server = FakeS7Server()
        await server.start()
        server.set_word(1, 4, 13824)               # half of 27648
        server.set_bit(1, 2, 0, True)
        store = FieldPointStore(tmp_path / "fp.json")
        src = f"s7:127.0.0.1"
        store.upsert(id="level", source=src, address="DB1.DBW4", kind="AI",
                     scale=10.0 / 27648, unit="m")
        store.upsert(id="estop", source=src, address="DB1.DBX2.0", kind="DI",
                     raw_type="bool", binds_to="estop_chain_closed")
        store.upsert(id="plc_hb", source=src, address="DB1.DBW0", kind="AI",
                     binds_to="heartbeat")
        mgr = FieldIOManager(store, scan_rate_s=0.05)
        # The S7Client the manager builds targets port 102; point it at the fake.
        client = mgr._client_for(src)
        client.port = server.port

        await mgr.start()
        for _ in range(4):                          # heartbeat: alive while ticking
            server.tick_heartbeat()
            target = mgr._cycles + 1
            while mgr._cycles < target:
                await asyncio.sleep(0.02)
        snap = mgr.snapshot()
        hb_alive = mgr.heartbeat_alive()

        # CPU halts: reads keep succeeding, counter freezes → heartbeat dies.
        target = mgr._cycles + int(mgr.HEARTBEAT_FACTOR) + 3
        while mgr._cycles < target:
            await asyncio.sleep(0.02)
        hb_dead = mgr.heartbeat_alive()
        await mgr.stop()
        await server.stop()
        return snap, hb_alive, hb_dead

    snap, hb_alive, hb_dead = asyncio.run(run())
    assert snap["level"].quality == Quality.GOOD
    assert snap["level"].value == pytest.approx(5.0)
    assert snap["estop"].quality == Quality.GOOD
    assert snap["estop"].value is True
    assert hb_alive is True
    assert hb_dead is False
