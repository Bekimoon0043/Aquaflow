"""
AF-HUB-005 — Backend fixture-aware sync pipeline.

Proves the end-to-end contract that AF-HUB-004 wired on the frontend: the designed
master fixtures + control groups carried in a sync_show payload are ingested by the
backend, normalized to one shape, turned into a hardware address registry, and gate
playback on address conflicts.

  frontend master fixtures ──sync_show──► load_show ──► build_registry_from_fixtures
                                              │                     │
                                       normalized groups     device addresses + conflicts
"""
import asyncio

from engine.show_engine import ShowEngine, PlaybackState


def _light(fid, gid="rgb_lights", universe=None, channel=None):
    fx = {"id": fid, "type": "rgb_light", "label": fid, "groupId": gid, "zone": "main"}
    if universe is not None:
        fx["universe"] = universe
    if channel is not None:
        fx["channel"] = channel
    return fx


def _pump(fid, gid="center_jets"):
    return {"id": fid, "type": "center_jets", "label": fid, "groupId": gid, "zone": "main"}


# ── Group normalization contract ────────────────────────────────────────────────

def test_load_show_normalizes_string_id_groups_to_objects():
    """AF-HUB-004 frontend sends groups as bare id strings (projectGroups)."""
    eng = ShowEngine()
    fixtures = [_light("L1"), _light("L2"), _pump("P1")]
    eng.load_show({"fixtures": fixtures, "groups": ["rgb_lights", "center_jets"]})

    assert all(isinstance(g, dict) for g in eng.groups)
    by_id = {g["id"]: g for g in eng.groups}
    assert set(by_id) == {"rgb_lights", "center_jets"}
    assert sorted(by_id["rgb_lights"]["memberIds"]) == ["L1", "L2"]
    assert by_id["center_jets"]["memberIds"] == ["P1"]
    assert by_id["rgb_lights"]["type"] == "rgb_light"
    # the snapshot exposes the identical object shape
    assert eng.get_snapshot()["groups"] == eng.groups


def test_load_show_keeps_object_groups_and_backfills_members():
    """A saved show sends full objects; missing members are back-filled."""
    eng = ShowEngine()
    fixtures = [_light("L1", gid="g"), _light("L2", gid="g")]
    eng.load_show({"fixtures": fixtures, "groups": [{"id": "g", "label": "Lights"}]})

    g = eng.groups[0]
    assert g["label"] == "Lights"
    assert sorted(g["memberIds"]) == ["L1", "L2"]


def test_load_show_derives_groups_when_absent():
    eng = ShowEngine()
    eng.load_show({"fixtures": [_pump("P1", gid="jets")]})
    assert eng.groups and eng.groups[0]["id"] == "jets"
    assert eng.groups[0]["memberIds"] == ["P1"]


def test_load_show_stores_fixtures_and_reports_count():
    eng = ShowEngine()
    eng.load_show({"fixtures": [_light("L1"), _pump("P1")], "groups": []})
    assert len(eng.fixtures) == 2
    assert eng.get_state()["fixture_count"] == 2


# ── Full sync-pipeline wiring (apply_show_payload) ──────────────────────────────

def test_apply_show_payload_builds_registry_and_blocks_on_conflict():
    """A designed show with a duplicate DMX address must build a registry, surface
    the conflict, and refuse to start playback."""
    from app_state import apply_show_payload, show_engine

    payload = {
        "currentShow": {"id": "s1", "name": "Sync Test", "duration": 10},
        "fixtures": [
            _light("L1", universe=1, channel=1),
            _light("L2", universe=1, channel=1),  # duplicate address → conflict
            _pump("P1"),
        ],
        "groups": ["rgb_lights", "center_jets"],
    }
    apply_show_payload(payload)

    # fixtures reached the engine and groups were normalized to objects
    assert len(show_engine.fixtures) == 3
    assert show_engine.get_state()["fixture_count"] == 3
    assert all(isinstance(g, dict) for g in show_engine.groups)

    # a hardware address registry was built from the fixtures
    summary = show_engine.device_registry_summary
    assert "error" not in summary
    assert summary.get("device_count", 0) >= 3

    # the duplicate DMX address surfaces as a hardware conflict …
    conflicts = show_engine.get_hardware_conflicts()
    assert conflicts, "duplicate DMX address was not flagged"

    # … and playback is refused (safety contract)
    started = asyncio.run(show_engine.play())
    assert started is False
    assert show_engine.show_state.state != PlaybackState.PLAYING
    assert "conflict" in show_engine.last_error.lower()


def test_apply_show_payload_clean_show_is_playable():
    """A conflict-free designed show routes cleanly and starts."""
    from app_state import apply_show_payload, show_engine

    payload = {
        "currentShow": {"id": "s2", "name": "Clean", "duration": 5},
        "fixtures": [_light("L1"), _pump("P1")],
        "groups": ["rgb_lights", "center_jets"],
    }
    apply_show_payload(payload)
    assert show_engine.get_hardware_conflicts() == []

    async def run():
        started = await show_engine.play()
        assert started is True
        await show_engine.stop_playback()

    asyncio.run(run())
    assert show_engine.show_state.state == PlaybackState.STOPPED
