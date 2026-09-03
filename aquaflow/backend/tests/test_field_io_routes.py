"""
AF-IO-007 — tests for the field-I/O telemetry surface: the points payload the
panel/websocket consume, the per-source last-raw-frame hex (the AF-ICAN-006
"readable at the cabinet" idiom), and the REST config routes with hot reload.
"""
import asyncio

import pytest
from fastapi import HTTPException

from engine.field_io import FieldIOManager
from engine.field_points import FieldPointStore
from tests.test_modbus_client import ScriptedModbusServer


def _mgr_with_live_point(tmp_path, server):
    store = FieldPointStore(tmp_path / "fp.json")
    store.upsert(id="level", source=f"modbus:127.0.0.1:{server.port}",
                 address="%MW0", kind="AI", scale=0.01, unit="m",
                 required=True, binds_to="water_level_ok", label="Basin level")
    return FieldIOManager(store, scan_rate_s=0.05)


def test_points_payload_and_frame_hex(tmp_path):
    async def run():
        server = ScriptedModbusServer()
        await server.start()
        mgr = _mgr_with_live_point(tmp_path, server)
        await mgr.start()
        target = mgr._cycles + 3
        while mgr._cycles < target:
            await asyncio.sleep(0.02)
        payload = mgr.points_payload()
        status = mgr.get_status()
        await mgr.stop()
        await server.stop()
        return payload, status

    payload, status = asyncio.run(run())
    (p,) = payload
    assert p["id"] == "level" and p["label"] == "Basin level"
    assert p["quality"] == "GOOD"
    assert p["value"] == pytest.approx(12.34)      # raw 1234 * 0.01
    assert p["raw"] == 1234
    assert p["required"] is True and p["binds_to"] == "water_level_ok"
    assert p["age_s"] is not None and p["age_s"] < 5

    (detail,) = status["sources_detail"].values()
    assert detail["connected"] is True
    # The last exchange is readable as hex — MBAP then PDU: the request tail is
    # unit 01 · FC 03 · addr 0000 · count 0001.
    assert len(detail["last_tx_hex"]) == 24
    assert detail["last_tx_hex"].endswith("010300000001")
    assert detail["last_rx_hex"] != ""


def test_routes_upsert_reload_and_delete(tmp_path, monkeypatch):
    from api.routes import field_io_routes

    async def run():
        mgr = FieldIOManager(FieldPointStore(tmp_path / "fp.json"), scan_rate_s=0.05)
        monkeypatch.setattr(field_io_routes, "_manager", lambda: mgr)

        body = field_io_routes.FieldPointUpsert(
            id="pressure", source="modbus:127.0.0.1:1502", address="30001",
            kind="AI", signal="4-20mA", raw_min=5530, raw_max=27648,
            required=True, binds_to="pressure_ok")
        created = await field_io_routes.upsert_field_point(body)
        assert created["ok"] is True

        # Persisted: a fresh store from the same path sees it.
        reloaded = FieldPointStore(tmp_path / "fp.json").load()
        assert reloaded.get("pressure").binds_to == "pressure_ok"

        listed = await field_io_routes.field_io_points()
        assert [p["id"] for p in listed["points"]] == ["pressure"]
        assert listed["points"][0]["quality"] == "UNKNOWN"   # never read → a datum

        # Malformed definitions are a 400 at the form, not a poll-time surprise.
        bad = field_io_routes.FieldPointUpsert(
            id="bad", source="modbus:1.2.3.4", address="0", signal="psychic")
        try:
            await field_io_routes.upsert_field_point(bad)
            raised = False
        except HTTPException as e:
            raised = e.status_code == 400

        removed = await field_io_routes.delete_field_point("pressure")
        assert removed["ok"] is True
        try:
            await field_io_routes.delete_field_point("pressure")
            missing_404 = False
        except HTTPException as e:
            missing_404 = e.status_code == 404
        await mgr.stop()
        return raised, missing_404

    raised, missing_404 = asyncio.run(run())
    assert raised is True
    assert missing_404 is True
