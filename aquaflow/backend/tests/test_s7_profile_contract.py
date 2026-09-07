"""
AF-DISC — the versioned AquaFlow S7-1215C profile agrees with the published
contract (docs/S7_DB_CONTRACT.md), is never assigned silently, and the read-only
verification classifies each failure separately and demands a MOVING heartbeat.
"""
import asyncio
import re
from pathlib import Path

import pytest
from fastapi import HTTPException

from engine.fake_s7_server import FakeS7Server
from engine.plc_verify import (
    ACCESS_DENIED, HEARTBEAT_STATIC, MALFORMED, MISSING_DB, NO_POINTS, OPTIMIZED_OR_SHORT_DB,
    TIMEOUT, UNREACHABLE, VERIFIED, WRONG_RACK_SLOT, verify_modbus_points, verify_s7_profile,
)
from plc.plc_engine import DEFAULT_TAGS, PLCType
from plc.s7_profiles import AQUAFLOW_S7_1215C_V1, get_profile, profile_tags, read_fields
from tests.test_modbus_client import ScriptedModbusServer

CONTRACT = Path(__file__).resolve().parents[2] / "docs" / "S7_DB_CONTRACT.md"


def _contract_rows() -> dict:
    """{address: name} from the DB1 table in the contract, plus the CMD_FLAGS bit."""
    text = CONTRACT.read_text(encoding="utf-8")
    rows = {}
    for m in re.finditer(r"^\|\s*`(DB[WX]\d+(?:\.\d)?)`\s*\|\s*([A-Z_]+)\s*\|", text, re.M):
        rows["DB1." + m.group(1)] = m.group(2)
    return rows


def test_profile_matches_the_published_contract():
    rows = _contract_rows()
    assert rows, "contract table not found — docs/S7_DB_CONTRACT.md moved?"
    prof = AQUAFLOW_S7_1215C_V1
    by_addr = {f["address"]: f for f in prof["fields"]}
    expected = {
        "DB1.DBW0": "HEARTBEAT", "DB1.DBX2.0": "ESTOP_OK", "DB1.DBX2.1": "VFD_OK",
        "DB1.DBX2.2": "THERMAL_OK", "DB1.DBX2.3": "LEVEL_FLOAT_OK", "DB1.DBW4": "LEVEL_RAW",
        "DB1.DBW6": "PRESSURE_RAW", "DB1.DBW8": "FLOW_RAW", "DB1.DBW10": "VFD_SPEED_FB",
        "DB1.DBW12": "CMD_PUMP_SPEED",
    }
    for addr, name in expected.items():
        assert rows[addr] == name, f"contract changed at {addr}"
        assert by_addr[addr]["name"] == name, f"profile disagrees at {addr}"
    assert rows["DB1.DBW14"] == "CMD_FLAGS" and by_addr["DB1.DBX14.0"]["name"] == "CMD_ENABLE"
    assert by_addr["DB1.DBW0"]["direction"] == "read" and by_addr["DB1.DBW0"]["role"] == "heartbeat"
    assert by_addr["DB1.DBW12"]["direction"] == "write" and by_addr["DB1.DBX14.0"]["direction"] == "write"
    assert prof["version"] == "1.0" and prof["contract"].endswith("S7_DB_CONTRACT.md")
    assert {f["address"] for f in read_fields(prof)} == set(expected) - {"DB1.DBW12"}


def test_old_conflicting_siemens_defaults_are_gone():
    assert DEFAULT_TAGS[PLCType.SIEMENS_S7] == []
    tags = profile_tags(get_profile("aquaflow-s7-1215c-v1"))
    by_addr = {t["address"]: t for t in tags}
    assert by_addr["DB1.DBW0"]["name"] == "HEARTBEAT" and by_addr["DB1.DBW0"]["access"] == "read"
    assert by_addr["DB1.DBX2.0"]["name"] == "ESTOP_OK"
    assert by_addr["DB1.DBW12"]["access"] == "write"


def test_profile_is_never_assigned_silently():
    from api.routes.plc import PLCConnectRequest, connect_plc, get_default_tags, plc_profiles

    async def run():
        defaults = await get_default_tags("siemens_s7")
        profiles = await plc_profiles()
        try:
            await connect_plc(PLCConnectRequest(id="p1", name="x", plc_type="siemens_s7",
                                                ip="127.0.0.1", profile_id="aquaflow-s7-1215c-v1"))
            unconfirmed = None
        except HTTPException as e:
            unconfirmed = e
        try:
            await connect_plc(PLCConnectRequest(id="p2", name="x", plc_type="modbus_tcp",
                                                ip="127.0.0.1", profile_id="aquaflow-s7-1215c-v1",
                                                confirm_profile=True))
            wrong_type = None
        except HTTPException as e:
            wrong_type = e
        return defaults, profiles, unconfirmed, wrong_type
    defaults, profiles, unconfirmed, wrong_type = asyncio.run(run())
    assert defaults["tags"] == [] and defaults["profiles"][0]["id"] == "aquaflow-s7-1215c-v1"
    assert profiles["profiles"][0]["requires_confirmation"] is True
    assert unconfirmed is not None and unconfirmed.status_code == 400
    assert "confirm" in unconfirmed.detail
    assert wrong_type is not None and wrong_type.status_code == 400


def test_confirmed_profile_loads_its_tags_and_reports_unverified():
    from api.routes.plc import PLCConnectRequest, connect_plc, disconnect_plc
    from plc import plc_engine

    async def run():
        server = FakeS7Server()
        await server.start()
        plc_engine.SiemensS7Driver.S7COMM_PORT = server.port
        try:
            res = await connect_plc(PLCConnectRequest(
                id="p-prof", name="rack", plc_type="siemens_s7", ip="127.0.0.1",
                profile_id="aquaflow-s7-1215c-v1", confirm_profile=True))
            cfg = plc_engine.plc_manager._connections.get("p-prof")
            tags = list(cfg.tags) if cfg else []
            await disconnect_plc("p-prof")
            return res, tags, server.writes
        finally:
            plc_engine.SiemensS7Driver.S7COMM_PORT = 102
            await server.stop()
    res, tags, writes = asyncio.run(run())
    assert res["profile_id"] == "aquaflow-s7-1215c-v1" and res["tag_count"] == 11
    assert res["verified"] is False                      # connecting never verifies
    assert {t["address"] for t in tags} == {f["address"] for f in AQUAFLOW_S7_1215C_V1["fields"]}
    assert writes == 0


# ── read-only verification ────────────────────────────────────────────────────
PROF = AQUAFLOW_S7_1215C_V1


def _verify(server_kw=None, *, before=None, samples=3, interval=0.03, port=None):
    async def run():
        server = FakeS7Server(**(server_kw or {}))
        await server.start()
        try:
            task = asyncio.create_task(before(server)) if before else None
            r = await verify_s7_profile("127.0.0.1", port or server.port, 0, 1, PROF,
                                        samples=samples, interval_s=interval,
                                        connect_timeout=0.5, timeout=0.5)
            if task:
                await task
            return r, server
        finally:
            await server.stop()
    return asyncio.run(run())


def test_static_heartbeat_is_not_verified():
    r, server = _verify()
    assert r.outcome == HEARTBEAT_STATIC and r.ok is False
    assert r.heartbeat["changed"] is False and len(r.heartbeat["samples"]) == 3
    assert all(f["status"] == "ok" for f in r.fields)   # readable, but not RUNNING
    assert server.writes == 0


def test_moving_heartbeat_verifies_and_reads_only_declared_inputs():
    async def tick(server):
        for _ in range(8):
            await asyncio.sleep(0.02)
            server.tick_heartbeat()
    r, server = _verify(before=tick)
    assert r.outcome == VERIFIED and r.ok is True and r.heartbeat["changed"] is True
    assert {f["address"] for f in r.fields} == {f["address"] for f in read_fields(PROF)}
    assert "DB1.DBW12" not in {f["address"] for f in r.fields}
    assert r.identity["order_number"].startswith("6ES7 215")
    assert r.writes_performed == 0 and server.writes == 0
    assert r.verified_at > 0


def test_failures_are_classified_separately():
    r, _ = _verify({"mode": "error"})
    assert r.outcome == OPTIMIZED_OR_SHORT_DB
    assert all(f["status"] == OPTIMIZED_OR_SHORT_DB for f in r.fields)
    r, _ = _verify({"expected_slot": 2, "handshake_mode": "refuse_dr"})
    assert r.outcome == WRONG_RACK_SLOT
    r, _ = _verify({"expected_slot": 2})
    assert r.outcome == WRONG_RACK_SLOT
    r, _ = _verify({"handshake_mode": "setup_truncated"})
    assert r.outcome == MALFORMED
    r, _ = _verify({"mode": "short"})
    assert r.outcome == MALFORMED
    r, _ = _verify(port=1)
    assert r.outcome == UNREACHABLE


def test_access_denied_and_missing_db_are_distinct(monkeypatch):
    from engine import fake_s7_server as fs
    for code, outcome in ((0x03, ACCESS_DENIED), (0x0A, MISSING_DB)):
        monkeypatch.setattr(fs, "RET_ADDR_OUT_OF_RANGE", code)
        r, _ = _verify({"mode": "error"})
        assert r.outcome == outcome, (hex(code), r.outcome)


def test_verification_timeout_is_reported():
    class Hang(FakeS7Server):
        def _read_var(self, pdu_ref, s7):
            self._close_after_reply = False
            return None                                  # drop → transport error
    async def run():
        s = Hang()
        await s.start()
        try:
            return await verify_s7_profile("127.0.0.1", s.port, 0, 1, PROF, samples=2,
                                           interval_s=0.02, connect_timeout=0.5, timeout=0.3)
        finally:
            await s.stop()
    r = asyncio.run(run())
    assert r.outcome in (TIMEOUT, MALFORMED) and r.ok is False


def test_verify_route_exists_and_is_read_only():
    from api.routes.plc import S7VerifyRequest, verify_s7

    async def run():
        server = FakeS7Server()
        await server.start()
        try:
            out = await verify_s7(S7VerifyRequest(ip="127.0.0.1", port=server.port, samples=2,
                                                  interval_s=0.05))
            return out, server.writes
        finally:
            await server.stop()
    out, writes = asyncio.run(run())
    assert out["outcome"] == HEARTBEAT_STATIC and out["writes_performed"] == 0 and writes == 0


# ── Modbus: operator-selected points only ─────────────────────────────────────
def test_modbus_verification_reads_only_selected_points():
    async def run():
        s = ScriptedModbusServer()
        await s.start()
        try:
            none = await verify_modbus_points("127.0.0.1", s.port, 1, [])
            ok = await verify_modbus_points("127.0.0.1", s.port, 1, [
                {"id": "level", "address": "30001", "kind": "input_register"},
                {"id": "flow", "address": "30004", "kind": "input_register"},
                {"id": "float", "address": 2, "kind": "discrete_input"},
            ])
            bad = await verify_modbus_points("127.0.0.1", s.port, 1, [
                {"id": "x", "address": "not-an-address"}])
            return none, ok, bad, list(s.writes)
        finally:
            await s.stop()
    none, ok, bad, writes = asyncio.run(run())
    assert none.outcome == NO_POINTS and none.fields == []
    assert ok.outcome == VERIFIED and [f["value"] for f in ok.fields] == [555, 777, True]
    assert ok.stage == "data_access_verified"
    assert bad.outcome == NO_POINTS and bad.warnings
    assert writes == []
