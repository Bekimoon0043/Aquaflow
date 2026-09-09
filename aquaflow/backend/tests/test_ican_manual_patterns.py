"""Manual I-CAN pattern persistence, timing, gating, and site layout."""
from __future__ import annotations

import asyncio

import pytest

from engine.ican_manual_patterns import (
    CAPTURED_GROUP17_SUPPORT,
    ICANManualPatternRunner,
    MANUAL_RUN_CONFIRMATION,
    ManualPatternError,
    ManualPatternStore,
    SITE_FOUNTAIN_LAYOUT,
    normalize_pattern,
)


class FakeConnection:
    def __init__(self, *, connected=True, armed=True):
        self.connected = connected
        self.armed = armed
        self.sent = []
        self.blackouts = 0

    def status(self):
        return {
            "state": "connected" if self.connected else "disconnected",
            "output_enabled": self.armed,
        }

    async def send_output(self, group, channels, **kwargs):
        self.sent.append((group, tuple(channels), kwargs))
        return self.connected and self.armed

    async def blackout(self):
        self.blackouts += 1
        return True


def pattern(*steps, name="Operator Wave"):
    return {"name": name, "steps": list(steps)}


def step(duration_ms=100, **groups):
    return {"duration_ms": duration_ms, "groups": groups}


def test_site_layout_records_operator_facts_and_keeps_capture_mapping_provisional():
    summary = SITE_FOUNTAIN_LAYOUT["physical_summary"]
    assert summary == {
        "front_outputs": 9,
        "front_pumps": 1,
        "rear_high_sides": 2,
        "rear_pumps": 1,
        "middle_nozzles": 64,
        "middle_pumps": 4,
        "total_pumps": 6,
    }
    assert SITE_FOUNTAIN_LAYOUT["mapping_status"] == "provisional"
    presets = {item["id"]: item for item in SITE_FOUNTAIN_LAYOUT["presets"]}
    assert presets["proven-opening"]["confidence"] == "hardware-proven"
    assert presets["proven-opening"]["addresses"][-1] == {
        "group": 17, "channels": list(CAPTURED_GROUP17_SUPPORT)}
    assert presets["captured-support"]["confidence"] == "capture-derived"
    assert presets["middle-a"]["addresses"] == [
        {"group": 1, "channels": list(range(9, 25))}]
    assert presets["middle-d"]["addresses"] == [
        {"group": 9, "channels": list(range(25, 41))}]
    assert any("pump addresses" in item for item in SITE_FOUNTAIN_LAYOUT["unresolved"])


def test_pattern_normalization_makes_sorted_absolute_states_and_duration():
    result = normalize_pattern(pattern(
        step(250, **{"9": [40, 9, 9], "1": []}),
        step(500, **{"9": [10], "1": [13]}),
    ))
    assert result["duration_ms"] == 750
    assert result["steps"][0] == {
        "duration_ms": 250,
        "groups": {"1": [], "2": [], "9": [9, 40], "17": [], "25": []},
    }


@pytest.mark.parametrize("bad,message", [
    ({"name": "", "steps": [{}]}, "name"),
    ({"name": "x", "steps": []}, "1 to 500"),
    (pattern(step(99, **{"1": []})), "100..60000"),
    (pattern(step(100, **{"1": [41]})), "1..40"),
    (pattern(step(100, **{"3": [1]})), "captured site groups"),
    (pattern(step(100, **{"17": [9]})), "group 17 is locked"),
    (pattern(step(100, **{"2": [1]})), "commissioning-locked"),
    (pattern(step(100, **{"25": [33]})), "commissioning-locked"),
])
def test_pattern_validation_rejects_unsafe_or_ambiguous_input(bad, message):
    with pytest.raises(ManualPatternError, match=message):
        normalize_pattern(bad)


def test_pattern_store_round_trip_update_and_delete(tmp_path):
    store = ManualPatternStore(tmp_path / "patterns.json")
    saved = store.save(pattern(step(**{"1": [9]})))
    assert saved["id"] and store.list()[0]["name"] == "Operator Wave"
    updated = store.save({**saved, "name": "Updated"})
    assert updated["created_at"] == saved["created_at"]
    assert [item["name"] for item in store.list()] == ["Updated"]
    assert store.delete(saved["id"]) is True
    assert store.delete(saved["id"]) is False
    assert store.list() == []


def test_runner_sends_each_step_as_absolute_group_state_and_blacks_out():
    async def run():
        conn = FakeConnection()
        runner = ICANManualPatternRunner(safety_permit=lambda: True)
        draft = pattern(
            step(**{"1": [9, 13], "9": []}),
            step(**{"1": [], "9": [10]}),
        )
        started = await runner.start(conn, draft)
        assert started["running"] is True
        await asyncio.wait_for(runner._task, timeout=1)
        return conn, runner.status()

    conn, status = asyncio.run(run())
    # Five initial group clears, then five absolute group states for each step.
    assert [(group, channels) for group, channels, _ in conn.sent] == [
        (1, ()), (2, ()), (9, ()), (17, ()), (25, ()),
        (1, (9, 13)), (2, ()), (9, ()), (17, ()), (25, ()),
        (1, ()), (2, ()), (9, (10,)), (17, ()), (25, ()),
    ]
    assert all(kwargs == {"confirmed": True, "user": "manual-pattern"}
               for _, _, kwargs in conn.sent)
    assert conn.blackouts == 2  # known-off before the pattern and final all-off
    assert status["outcome"] == "completed"
    assert status["frames_sent"] == 10


def test_runner_stop_and_safety_loss_both_end_in_blackout():
    async def stop_run():
        conn = FakeConnection()
        runner = ICANManualPatternRunner(safety_permit=lambda: True)
        await runner.start(conn, pattern(step(1000, **{"1": [9]})))
        await asyncio.sleep(0.02)
        return conn, await runner.stop()

    conn, status = asyncio.run(stop_run())
    assert status["outcome"] == "stopped" and conn.blackouts == 2

    async def safety_run():
        permit = {"ok": True}
        conn = FakeConnection()
        runner = ICANManualPatternRunner(safety_permit=lambda: permit["ok"])
        await runner.start(conn, pattern(step(1000, **{"1": [9]})))
        permit["ok"] = False
        await asyncio.wait_for(runner._task, timeout=1)
        return conn, runner.status()

    conn, status = asyncio.run(safety_run())
    assert status["outcome"] == "safety_stopped"
    assert "withdrawn" in status["error"] and conn.blackouts == 2


@pytest.mark.parametrize("connection,permit,message", [
    (FakeConnection(connected=False), True, "connect"),
    (FakeConnection(armed=False), True, "arm I-CAN"),
    (FakeConnection(), False, "safety"),
])
def test_runner_requires_connection_output_arm_and_safety(connection, permit, message):
    async def run():
        runner = ICANManualPatternRunner(safety_permit=lambda: permit)
        with pytest.raises(ManualPatternError, match=message):
            await runner.start(connection, pattern(step(**{"1": [9]})))

    asyncio.run(run())


def test_manual_pattern_routes_require_separate_phrase_and_control_runner(monkeypatch, tmp_path):
    from fastapi import HTTPException
    from api.routes import ican_routes

    async def run():
        conn = FakeConnection()
        runner = ICANManualPatternRunner(safety_permit=lambda: True)
        store = ManualPatternStore(tmp_path / "routes.json")
        monkeypatch.setattr(ican_routes, "_conn", conn)
        monkeypatch.setattr(ican_routes, "_manual_pattern_runner", runner)
        monkeypatch.setattr(ican_routes, "_manual_pattern_store", store)

        save_req = ican_routes.ManualPatternSaveRequest(
            name="Valve Test", steps=[step(1000, **{"1": [9]})])
        saved = await ican_routes.save_manual_pattern(save_req)
        assert (await ican_routes.list_manual_patterns())["patterns"][0]["id"] == saved["id"]

        bad = ican_routes.ManualPatternRunRequest(pattern=saved, confirm="")
        with pytest.raises(HTTPException) as exc:
            await ican_routes.run_manual_pattern(bad)
        assert exc.value.status_code == 400

        good = ican_routes.ManualPatternRunRequest(
            pattern=saved, confirm=MANUAL_RUN_CONFIRMATION)
        started = await ican_routes.run_manual_pattern(good)
        assert started["running"] is True
        with pytest.raises(HTTPException) as exc:
            await ican_routes.drive_channel(
                ican_routes.ChannelDrive(device_id="any-channel", on=True))
        assert exc.value.status_code == 409
        assert "manual pattern" in exc.value.detail
        stopped = await ican_routes.stop_manual_pattern()
        assert stopped["outcome"] == "stopped" and stopped["running"] is False
        assert await ican_routes.delete_manual_pattern(saved["id"]) == {
            "deleted": saved["id"]}

    asyncio.run(run())
