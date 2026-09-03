"""
AF-IO-008 — the bench harness itself, proven.

Two halves:

1. Cross-validation: engine/modbus_client.py against pymodbus's OWN server (an
   implementation that is not ours). Our scripted server and our client could share
   a misreading of the spec; pymodbus cannot. This is what caught the pymodbus 3.13
   deprecated-context hr/ir swap during development.

2. The fake S7 PLC (engine/fake_s7_server.py) that AF-IO-005's fixed driver will
   test against: COTP + setup handshake, Read/Write Var with BIT addressing
   (byte_offset*8 — the encoding the current raw driver gets wrong), the
   halted-CPU heartbeat (reads keep succeeding, the counter stops moving), and the
   injectable faults (error item, short frame, dropped connection).

The S7 requests here are built by a small test-side reference encoder with the
CORRECT bit addressing. AF-IO-005's driver must produce byte-identical requests.
"""
import asyncio
import struct

import pytest

from engine.fake_s7_server import FakeS7Server, RET_OK, RET_ADDR_OUT_OF_RANGE
from engine.modbus_client import ModbusTCPClient


# ═════════════════════════ 1. pymodbus cross-validation ═════════════════════════

def test_client_against_pymodbus_all_function_codes():
    pytest.importorskip("pymodbus", reason="pymodbus is the test-only bench dep")
    from tests.bench_harness import PymodbusBenchServer

    async def run():
        server = PymodbusBenchServer(
            di=[True, False, True, False, False, False, False, False],
            hr=[100 + i for i in range(20)],
            ir=[500 + i for i in range(20)],
        )
        await server.start()
        c = ModbusTCPClient("127.0.0.1", server.port, timeout=2.0)
        try:
            assert await c.connect()
            results = {
                "hr": await c.read_holding_registers(0, 3),
                "ir": await c.read_input_registers(0, 3),
                "di": await c.read_discrete_inputs(0, 3),
                "w6": await c.write_register(5, 4242),
                "rb": await c.read_holding_registers(5, 1),
                "w5": await c.write_coil(2, True),
            }
        finally:
            await c.close()
            await server.stop()
        return results

    r = asyncio.run(run())
    # FC03 must hit the HOLDING store and FC04 the INPUT store — the exact mapping
    # pymodbus 3.13's deprecated context gets backwards.
    assert r["hr"] == [100, 101, 102]
    assert r["ir"] == [500, 501, 502]
    assert r["di"] == [True, False, True]
    assert r["w6"] is True and r["rb"] == [4242]
    assert r["w5"] is True


# ═════════════════════════ 2. the fake S7 PLC ═══════════════════════════════════
#
# Test-side reference encoder: the byte-exact requests a CORRECT S7 client sends.
# AF-IO-005's driver is held to this encoding.

COTP_CR = bytes([
    0x03, 0x00, 0x00, 0x16,
    0x11, 0xE0, 0x00, 0x00, 0x00, 0x01, 0x00,
    0xC0, 0x01, 0x0A, 0xC1, 0x02, 0x01, 0x00, 0xC2, 0x02, 0x01, 0x02,
])
S7_SETUP = bytes([
    0x03, 0x00, 0x00, 0x19,
    0x02, 0xF0, 0x80,
    0x32, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00,
    0xF0, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0xF0,
])


def _tpkt(payload: bytes) -> bytes:
    return struct.pack(">BBH", 0x03, 0x00, len(payload) + 4) + payload


def _item(db: int, byte_offset: int, count: int, *, bit: int = 0,
          transport: int = 0x02) -> bytes:
    # THE point: the 3-byte address field is in BITS — byte_offset*8 + bit.
    addr = (byte_offset << 3) | bit
    return (bytes([0x12, 0x0A, 0x10, transport]) + struct.pack(">H", count) +
            struct.pack(">H", db) + bytes([0x84]) +
            bytes([(addr >> 16) & 0xFF, (addr >> 8) & 0xFF, addr & 0xFF]))


def _read_req(db: int, byte_offset: int, count: int, **kw) -> bytes:
    item = _item(db, byte_offset, count, **kw)
    param = bytes([0x04, 0x01]) + item
    header = (bytes([0x32, 0x01, 0x00, 0x00, 0x00, 0x01]) +
              struct.pack(">HH", len(param), 0))
    return _tpkt(bytes([0x02, 0xF0, 0x80]) + header + param)


def _write_req(db: int, byte_offset: int, payload: bytes) -> bytes:
    item = _item(db, byte_offset, len(payload))
    param = bytes([0x05, 0x01]) + item
    data = bytes([0x00, 0x04]) + struct.pack(">H", len(payload) * 8) + payload
    header = (bytes([0x32, 0x01, 0x00, 0x00, 0x00, 0x01]) +
              struct.pack(">HH", len(param), len(data)))
    return _tpkt(bytes([0x02, 0xF0, 0x80]) + header + param + data)


async def _s7_session(server):
    """Open a socket to the fake PLC and complete COTP + S7 setup."""
    reader, writer = await asyncio.open_connection("127.0.0.1", server.port)

    async def exchange(frame):
        writer.write(frame)
        await writer.drain()
        tpkt = await asyncio.wait_for(reader.readexactly(4), 2.0)
        total = struct.unpack(">H", tpkt[2:4])[0]
        return tpkt + await asyncio.wait_for(reader.readexactly(total - 4), 2.0)

    cc = await exchange(COTP_CR)
    assert cc[5] == 0xD0                       # COTP connection confirm
    ack = await exchange(S7_SETUP)
    assert ack[7] == 0x32                      # S7 ack
    return reader, writer, exchange


def test_fake_s7_read_word_at_nonzero_offset():
    # The regression the fake exists to catch: the OLD raw driver's encoding
    # (offset>>5, (offset&0x1f)<<3) only coincides with the correct offset*8 at
    # offset 0. Reading DB1.DBW4 proves the bit addressing end to end.
    async def run():
        server = FakeS7Server()
        await server.start()
        server.set_word(1, 0, 1111)
        server.set_word(1, 4, 2222)
        _, writer, exchange = await _s7_session(server)
        reply0 = await exchange(_read_req(1, 0, 2))
        reply4 = await exchange(_read_req(1, 4, 2))
        writer.close()
        await server.stop()
        return reply0, reply4

    reply0, reply4 = asyncio.run(run())
    # Data item (2-byte payload): retcode FF, transport 04, length_bits:2, payload:2
    assert reply0[-6] == RET_OK and struct.unpack(">H", reply0[-2:])[0] == 1111
    assert reply4[-6] == RET_OK and struct.unpack(">H", reply4[-2:])[0] == 2222


def test_fake_s7_write_then_read_and_bit_transport():
    async def run():
        server = FakeS7Server()
        await server.start()
        _, writer, exchange = await _s7_session(server)
        wr = await exchange(_write_req(1, 6, struct.pack(">H", 3333)))
        rd = await exchange(_read_req(1, 6, 2))
        server.set_bit(1, 2, 0, True)          # DB1.DBX2.0 = pump_run
        bit = await exchange(_read_req(1, 2, 1, transport=0x01))
        writer.close()
        await server.stop()
        return wr, rd, bit, server.get_word(1, 6)

    wr, rd, bit, stored = asyncio.run(run())
    assert wr[-1] == RET_OK
    assert stored == 3333
    assert struct.unpack(">H", rd[-2:])[0] == 3333
    assert bit[-1] == 1                        # the bit came back set


def test_fake_s7_halted_cpu_serves_reads_with_frozen_heartbeat():
    # The failure mode the DB contract's counter exists for: a halted CPU still
    # answers every read. Only the VALUE not moving reveals it.
    async def run():
        server = FakeS7Server()
        await server.start()
        _, writer, exchange = await _s7_session(server)

        server.tick_heartbeat()                # CPU alive: counter moves
        a = struct.unpack(">H", (await exchange(_read_req(1, 0, 2)))[-2:])[0]
        server.tick_heartbeat()
        b = struct.unpack(">H", (await exchange(_read_req(1, 0, 2)))[-2:])[0]

        # CPU halts: no more ticks. Reads keep SUCCEEDING.
        c = struct.unpack(">H", (await exchange(_read_req(1, 0, 2)))[-2:])[0]
        d = struct.unpack(">H", (await exchange(_read_req(1, 0, 2)))[-2:])[0]
        writer.close()
        await server.stop()
        return a, b, c, d

    a, b, c, d = asyncio.run(run())
    assert b == a + 1                          # alive: moving
    assert c == b and d == b                   # halted: frozen but answering


def test_fake_s7_fault_modes():
    async def run_error():
        server = FakeS7Server("error")
        await server.start()
        _, writer, exchange = await _s7_session(server)
        reply = await exchange(_read_req(1, 0, 2))
        writer.close()
        await server.stop()
        return reply

    reply = asyncio.run(run_error())
    assert reply[-4] == RET_ADDR_OUT_OF_RANGE  # item status, not data

    async def run_drop():
        server = FakeS7Server("drop")
        await server.start()
        reader, writer, exchange = await _s7_session(server)
        writer.write(_read_req(1, 0, 2))
        await writer.drain()
        try:
            await asyncio.wait_for(reader.readexactly(4), 2.0)
            dropped = False
        except (asyncio.IncompleteReadError, ConnectionError, TimeoutError):
            dropped = True
        writer.close()
        await server.stop()
        return dropped

    assert asyncio.run(run_drop()) is True

    async def run_short():
        server = FakeS7Server("short")
        await server.start()
        reader, writer, _ = await _s7_session_short(server)
        writer.write(_read_req(1, 0, 2))
        await writer.drain()
        data = await reader.read(64)           # whatever arrives before close
        writer.close()
        await server.stop()
        return data

    async def _s7_session_short(server):
        # Raw socket, no handshake needed — faults only trigger on Read/Write Var.
        reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
        return reader, writer, None

    data = asyncio.run(run_short())
    assert len(data) < 7                       # truncated, unparseable frame


def test_fake_s7_read_out_of_range_db():
    async def run():
        server = FakeS7Server()
        await server.start()
        _, writer, exchange = await _s7_session(server)
        reply = await exchange(_read_req(9, 0, 2))     # DB9 doesn't exist
        writer.close()
        await server.stop()
        return reply

    reply = asyncio.run(run())
    assert reply[-4] == RET_ADDR_OUT_OF_RANGE
