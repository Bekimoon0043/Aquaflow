"""
AF-IO-001 — tests for engine/modbus_client.py, the ONE validated Modbus TCP client.

Covers exactly the defects the unification removed:
  * replies parsed at a fixed offset with no validation (short frame, exception
    response, txid mismatch, byte-count lie were all parsed as data),
  * FC02/FC04/FC05 not existing at all,
  * `startswith("4")` address parsing turning "45" into register -39956,
  * a dropped connection staying down forever (no backoff reconnect).

Follows the repo convention: sync test functions drive async code via asyncio.run().
The scripted server here is deliberately minimal and per-test; the pymodbus-backed
cross-validation harness is AF-IO-008's job.
"""
import asyncio
import struct

import pytest

from engine.modbus_client import (
    ModbusTCPClient,
    ModbusException,
    ModbusFrameError,
    parse_register_address,
)


class ScriptedModbusServer:
    """Minimal Modbus TCP responder with injectable fault modes.

    mode=None       — answer correctly from the internal stores
    mode="exception"— answer every request with exception ILLEGAL_DATA_ADDRESS (0x02)
    mode="short"    — send a truncated frame then close
    mode="bad_txid" — answer correctly but with transaction id + 1
    mode="bad_proto"— answer correctly but with MBAP protocol id 7
    mode="lie_bytecount" — declare the wrong byte count in a read reply
    mode="silent"   — never answer (client should time out)
    """

    def __init__(self, mode=None):
        self.mode = mode
        self.holding = {0: 1234, 1: 42, 7: 65535}
        self.input_regs = {0: 555, 3: 777}
        self.discrete = {0: True, 2: True, 9: True}
        self.writes = []          # (fc, address, value) records
        self._server = None
        self._conns = []          # live handler writers, so stop() can't deadlock
        self.port = None

    async def start(self):
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]

    async def drop_connections(self):
        """Kill live connections (simulates the device dying mid-session)."""
        for w in self._conns:
            try:
                w.close()
            except Exception:
                pass
        self._conns = []
        await asyncio.sleep(0)

    async def stop(self):
        if self._server:
            self._server.close()
            # Python 3.12+ wait_closed() also waits for handler tasks — drop any
            # connection a test left open or this would deadlock.
            await self.drop_connections()
            await self._server.wait_closed()

    async def _handle(self, reader, writer):
        self._conns.append(writer)
        try:
            while True:
                header = await reader.readexactly(7)
                txid, proto, length, unit = struct.unpack(">HHHB", header)
                pdu = await reader.readexactly(length - 1)
                reply = self._reply(txid, unit, pdu)
                if reply is None:
                    continue  # silent mode — keep the connection open, say nothing
                writer.write(reply)
                await writer.drain()
                if self.mode == "short":
                    writer.close()
                    return
        except (asyncio.IncompleteReadError, ConnectionError, OSError):
            pass

    def _reply(self, txid, unit, pdu):
        fc = pdu[0]
        if self.mode == "silent":
            return None
        if self.mode == "exception":
            body = bytes([fc | 0x80, 0x02])
            return struct.pack(">HHHB", txid, 0, len(body) + 1, unit) + body
        if self.mode == "short":
            return b"\x00\x01\x00"  # 3 bytes — not even a full MBAP header

        body = self._good_body(fc, pdu)
        if self.mode == "lie_bytecount" and fc in (0x02, 0x03, 0x04):
            body = bytes([body[0], body[1] + 1]) + body[2:]
        r_txid = (txid + 1) & 0xFFFF if self.mode == "bad_txid" else txid
        r_proto = 7 if self.mode == "bad_proto" else 0
        return struct.pack(">HHHB", r_txid, r_proto, len(body) + 1, unit) + body

    def _good_body(self, fc, pdu):
        if fc in (0x03, 0x04):
            addr, count = struct.unpack(">HH", pdu[1:5])
            store = self.holding if fc == 0x03 else self.input_regs
            data = b"".join(
                struct.pack(">H", store.get(addr + i, 0)) for i in range(count))
            return bytes([fc, 2 * count]) + data
        if fc == 0x02:
            addr, count = struct.unpack(">HH", pdu[1:5])
            nbytes = (count + 7) // 8
            buf = bytearray(nbytes)
            for i in range(count):
                if self.discrete.get(addr + i, False):
                    buf[i // 8] |= 1 << (i % 8)
            return bytes([fc, nbytes]) + bytes(buf)
        if fc in (0x05, 0x06):
            addr, value = struct.unpack(">HH", pdu[1:5])
            self.writes.append((fc, addr, value))
            if fc == 0x06:
                self.holding[addr] = value
            return pdu  # echo
        return bytes([fc | 0x80, 0x01])  # ILLEGAL_FUNCTION


async def _with_server(mode, fn):
    """Start a scripted server, connect a client, run fn(client, server), tear down."""
    server = ScriptedModbusServer(mode)
    await server.start()
    client = ModbusTCPClient("127.0.0.1", server.port, unit_id=1, timeout=0.5)
    try:
        assert await client.connect()
        return await fn(client, server)
    finally:
        await client.close()
        await server.stop()


# ── address parsing (the "45" bug) ───────────────────────────────────────────────
def test_parse_register_address_table():
    assert parse_register_address("%MW100") == 100
    assert parse_register_address("HR100") == 100
    assert parse_register_address("40001") == 0
    assert parse_register_address("40011") == 10
    assert parse_register_address("400001") == 0
    assert parse_register_address("30001") == 0
    assert parse_register_address("30011") == 10
    assert parse_register_address(123) == 123
    assert parse_register_address("0") == 0


def test_parse_register_address_short_numbers_are_plain_offsets():
    # The old code did `startswith("4") → int(addr) - 40001`, so "45" became -39956.
    assert parse_register_address("4") == 4
    assert parse_register_address("45") == 45
    assert parse_register_address("400") == 400
    assert parse_register_address("4000") == 4000
    assert parse_register_address("3") == 3


def test_parse_register_address_malformed_raises():
    # Fail-closed: garbage must refuse, never silently become register 0.
    for bad in ("", "pump_speed", "DB1.DBW0", -1, 70000, "N7:0"):
        with pytest.raises(ValueError):
            parse_register_address(bad)


# ── happy paths per function code ────────────────────────────────────────────────
def test_fc03_read_holding_registers():
    async def run(client, server):
        return await client.read_holding_registers(0, 2)
    assert asyncio.run(_with_server(None, run)) == [1234, 42]


def test_fc04_read_input_registers():
    async def run(client, server):
        return await client.read_input_registers(0, 4)
    assert asyncio.run(_with_server(None, run)) == [555, 0, 0, 777]


def test_fc02_read_discrete_inputs():
    async def run(client, server):
        return await client.read_discrete_inputs(0, 10)
    bits = asyncio.run(_with_server(None, run))
    assert bits == [True, False, True, False, False, False, False, False, False, True]


def test_fc05_write_coil_and_fc06_write_register():
    async def run(client, server):
        assert await client.write_coil(4, True)
        assert await client.write_register(9, 4242)
        # And read the written register back through the same connection.
        assert await client.read_holding_registers(9, 1) == [4242]
        return server.writes
    writes = asyncio.run(_with_server(None, run))
    assert (0x05, 4, 0xFF00) in writes
    assert (0x06, 9, 4242) in writes


# ── the validation paths the old code lacked ─────────────────────────────────────
def test_exception_response_is_decoded_not_parsed_as_data():
    async def run(client, server):
        with pytest.raises(ModbusException) as ei:
            await client.read_holding_registers(0, 1)
        # An exception reply is a healthy conversation — connection must stay UP.
        assert client.is_connected
        return ei.value
    exc = asyncio.run(_with_server("exception", run))
    assert exc.name == "ILLEGAL_DATA_ADDRESS"
    assert exc.function == 0x03


def test_short_frame_is_a_frame_error_and_marks_down():
    async def run(client, server):
        with pytest.raises(ModbusFrameError):
            await client.read_holding_registers(0, 1)
        assert not client.is_connected
    asyncio.run(_with_server("short", run))


def test_txid_mismatch_is_rejected():
    async def run(client, server):
        with pytest.raises(ModbusFrameError) as ei:
            await client.read_holding_registers(0, 1)
        assert "transaction id" in str(ei.value)
        assert not client.is_connected
    asyncio.run(_with_server("bad_txid", run))


def test_bad_protocol_id_is_rejected():
    async def run(client, server):
        with pytest.raises(ModbusFrameError) as ei:
            await client.read_holding_registers(0, 1)
        assert "protocol id" in str(ei.value)
        assert not client.is_connected
    asyncio.run(_with_server("bad_proto", run))


def test_byte_count_lie_is_rejected():
    async def run(client, server):
        with pytest.raises(ModbusFrameError) as ei:
            await client.read_holding_registers(0, 2)
        assert "byte count" in str(ei.value)
    asyncio.run(_with_server("lie_bytecount", run))


def test_silent_server_times_out_and_marks_down():
    async def run(client, server):
        with pytest.raises(ModbusFrameError):
            await client.read_holding_registers(0, 1)
        assert not client.is_connected
    asyncio.run(_with_server("silent", run))


# ── reconnect backoff ────────────────────────────────────────────────────────────
def test_ensure_connected_backs_off_on_dead_target():
    async def run():
        # A port nothing listens on: grab an ephemeral port and close it.
        probe = await asyncio.start_server(lambda r, w: None, "127.0.0.1", 0)
        dead_port = probe.sockets[0].getsockname()[1]
        probe.close()
        await probe.wait_closed()

        client = ModbusTCPClient("127.0.0.1", dead_port, connect_timeout=0.3)
        assert not await client.ensure_connected()
        # Inside the backoff window the second call must refuse immediately
        # (no second connect attempt burned).
        import time
        t0 = time.monotonic()
        assert not await client.ensure_connected()
        assert time.monotonic() - t0 < 0.2
        assert client._next_retry > time.monotonic()
        await client.close()
    asyncio.run(run())


def test_ensure_connected_recovers_when_server_returns():
    async def run():
        server = ScriptedModbusServer()
        await server.start()
        client = ModbusTCPClient("127.0.0.1", server.port, timeout=0.5)
        assert await client.connect()
        # The device dies mid-session; the next transaction fails and marks down.
        await server.drop_connections()
        with pytest.raises(ModbusFrameError):
            await client.read_holding_registers(0, 1)
        assert not client.is_connected
        # The device comes back (listener never went away). Step past the backoff
        # window and ensure_connected() must transparently reconnect.
        client._next_retry = 0.0
        assert await client.ensure_connected()
        assert await client.read_holding_registers(0, 1) == [1234]
        await client.close()
        await server.stop()
    asyncio.run(run())


# ── the two production drivers delegate correctly ───────────────────────────────
def test_protocol_bus_driver_delegates():
    from engine.protocol_bus import ModbusTCPDriver

    async def run():
        server = ScriptedModbusServer()
        await server.start()
        driver = ModbusTCPDriver("127.0.0.1", server.port)
        assert await driver.connect()
        assert driver.is_connected
        assert await driver.send({"register": 1, "value": 7700})
        assert await driver.read_register(1, 1) == [7700]
        await driver.disconnect()
        assert not driver.is_connected
        await server.stop()
        return server.writes
    writes = asyncio.run(run())
    assert (0x06, 1, 7700) in writes


def test_protocol_bus_driver_returns_none_on_exception_reply():
    # Regression: the old read parsed an exception response as register data.
    from engine.protocol_bus import ModbusTCPDriver

    async def run():
        server = ScriptedModbusServer("exception")
        await server.start()
        driver = ModbusTCPDriver("127.0.0.1", server.port)
        assert await driver.connect()
        result = await driver.read_register(0, 1)
        await driver.disconnect()
        await server.stop()
        return result
    assert asyncio.run(run()) is None


def test_plc_driver_reads_and_scales_tag():
    from plc.plc_engine import ModbusTCPPLCDriver, PLCConnection, PLCTag, PLCType, TagType

    async def run():
        server = ScriptedModbusServer()
        await server.start()
        cfg = PLCConnection(id="t1", name="bench", plc_type=PLCType.MODBUS_TCP,
                            ip="127.0.0.1", port=server.port)
        driver = ModbusTCPPLCDriver(cfg)
        assert await driver.connect()
        tag = PLCTag(id="spd", name="Pump Speed", address="%MW1",
                     tag_type=TagType.INT, scale_factor=0.1)
        value = await driver.read_tag(tag)          # raw 42 * 0.1
        ok = await driver.write_tag(tag, 55.0)      # 55.0 / 0.1 = 550
        bad_tag = PLCTag(id="bad", name="Bad", address="DB1.DBW0",
                         tag_type=TagType.INT)
        bad = await driver.read_tag(bad_tag)        # malformed address → refuse
        await driver.disconnect()
        await server.stop()
        return value, ok, bad, server.writes

    value, ok, bad, writes = asyncio.run(run())
    assert value == pytest.approx(4.2)
    assert ok is True
    assert (0x06, 1, 550) in writes
    assert bad is None
