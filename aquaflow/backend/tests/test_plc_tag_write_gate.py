"""
PLC tag model + write gate.

  * every tag of the aquaflow-s7-1215c-v1 profile builds a PLCTag (profile tags
    carry `access` / `profile_id` — PLCTag(**t) used to raise TypeError, so a
    confirmed S7 profile never produced values and writes 500'd);
  * the poll loop actually reads profile tags;
  * writes refuse read-only tags (400) and non-zero writes without the safety
    permit (403); writing 0 / False (stop) is never gated.
"""
import asyncio
import types

import pytest
from fastapi import HTTPException

import safety.safety_kernel as safety_kernel
from plc.plc_engine import (
    PLCConnection, PLCDriver, PLCManager, PLCTag, PLCType, PLCWriteRefused, TagType,
)
from plc.s7_profiles import get_profile, profile_tags


PROFILE_ID = "aquaflow-s7-1215c-v1"


class _FakeDriver(PLCDriver):
    def __init__(self, config):
        super().__init__(config)
        self._connected = True
        self.writes = []
        self.reads = []

    async def connect(self):
        return True

    async def disconnect(self):
        pass

    async def write_tag(self, tag, value):
        self.writes.append((tag.id, value))
        return True

    async def read_all_tags(self, tags):
        self.reads.append([t.id for t in tags])
        return {t.id: 1 for t in tags}


def _manager_with_profile():
    mgr = PLCManager()
    cfg = PLCConnection(id="s7", name="s7", plc_type=PLCType.SIEMENS_S7, ip="127.0.0.1",
                        tags=profile_tags(get_profile(PROFILE_ID)), scan_rate_ms=10)
    drv = _FakeDriver(cfg)
    mgr._connections[cfg.id] = cfg
    mgr._drivers[cfg.id] = drv
    return mgr, drv


def _set_kernel(monkeypatch, permit, pump_enable):
    stub = types.SimpleNamespace(
        get_status=lambda: {"permit": permit, "pump_enable": pump_enable})
    monkeypatch.setattr(safety_kernel, "get_safety_kernel", lambda: stub)


def _tag_ids(direction):
    return [f["id"] for f in get_profile(PROFILE_ID)["fields"] if f["direction"] == direction]


def test_every_profile_tag_builds_a_plctag():
    tags = profile_tags(get_profile(PROFILE_ID))
    assert tags
    for t in tags:
        obj = PLCTag(**t)
        assert obj.profile_id == PROFILE_ID
        assert obj.access == t["access"]
        assert TagType(obj.tag_type)
    assert PLCTag(**tags[0]).read_only == (tags[0]["access"] == "read")


def test_from_dict_ignores_unknown_keys():
    t = PLCTag.from_dict({"id": "x", "name": "x", "address": "%MW0",
                          "tag_type": "int", "ui_only": 1})
    assert t.access == "readwrite" and not t.read_only


def test_poll_loop_reads_profile_tags():
    mgr, drv = _manager_with_profile()
    mgr._running = True   # normally set by PLCManager.start()

    async def run():
        task = asyncio.create_task(mgr._poll_loop("s7"))
        await asyncio.sleep(0.05)
        mgr._running = False
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    asyncio.run(run())
    assert drv.reads, "poll loop never reached the driver (PLCTag build failed?)"
    assert mgr.get_tag_value("s7", "heartbeat") == 1


def test_read_only_tag_write_refused(monkeypatch):
    _set_kernel(monkeypatch, True, True)
    mgr, drv = _manager_with_profile()
    ro = _tag_ids("read")[0]
    with pytest.raises(PLCWriteRefused) as e:
        asyncio.run(mgr.write_tag("s7", ro, 0))
    assert e.value.status == 400 and "read-only" in e.value.reason
    assert drv.writes == []


@pytest.mark.parametrize("permit,pump", [(False, False), (False, True), (True, False)])
def test_nonzero_write_refused_without_permit(monkeypatch, permit, pump):
    _set_kernel(monkeypatch, permit, pump)
    mgr, drv = _manager_with_profile()
    wr = _tag_ids("write")[0]
    with pytest.raises(PLCWriteRefused) as e:
        asyncio.run(mgr.write_tag("s7", wr, 1))
    assert e.value.status == 403
    assert drv.writes == []


@pytest.mark.parametrize("value", [0, 0.0, False, "0"])
def test_zero_write_allowed_without_permit(monkeypatch, value):
    _set_kernel(monkeypatch, False, False)
    mgr, drv = _manager_with_profile()
    wr = _tag_ids("write")[0]
    assert asyncio.run(mgr.write_tag("s7", wr, value)) is True
    assert drv.writes == [(wr, value)]


def test_nonzero_write_allowed_with_permit(monkeypatch):
    _set_kernel(monkeypatch, True, True)
    mgr, drv = _manager_with_profile()
    wr = _tag_ids("write")[0]
    assert asyncio.run(mgr.write_tag("s7", wr, 5)) is True


def test_kernel_unreadable_fails_closed(monkeypatch):
    def boom():
        raise RuntimeError("x")
    monkeypatch.setattr(safety_kernel, "get_safety_kernel", boom)
    mgr, drv = _manager_with_profile()
    with pytest.raises(PLCWriteRefused) as e:
        asyncio.run(mgr.write_tag("s7", _tag_ids("write")[0], 1))
    assert e.value.status == 403


def test_route_maps_refusals_to_http(monkeypatch):
    import api.routes.plc as plc_routes
    mgr, drv = _manager_with_profile()
    monkeypatch.setattr(plc_routes, "plc_manager", mgr)
    req = plc_routes.TagWriteRequest

    _set_kernel(monkeypatch, True, True)
    with pytest.raises(HTTPException) as e:
        asyncio.run(plc_routes.write_tag("s7", _tag_ids("read")[0], req(value=1)))
    assert e.value.status_code == 400

    _set_kernel(monkeypatch, False, False)
    wr = _tag_ids("write")[0]
    with pytest.raises(HTTPException) as e:
        asyncio.run(plc_routes.write_tag("s7", wr, req(value=1)))
    assert e.value.status_code == 403 and "permit" in e.value.detail

    out = asyncio.run(plc_routes.write_tag("s7", wr, req(value=0)))
    assert out["success"] is True
