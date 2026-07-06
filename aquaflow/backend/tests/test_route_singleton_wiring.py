"""
AF-HUB-006 — Route / singleton wiring repair.

Several routes reached for singletons that either did not exist or resolved to a
*second* instance the runtime never used, all swallowed by bare excepts so they failed
silently:

  * pattern_routes imported engine.show_engine.get_show_engine (never defined) →
    recorded clips never reached the live show engine,
  * pattern_routes / phase6 pushed to a second get_protocol_bus() instance instead of
    the shared app_state.protocol_bus,
  * phase6 did `from app_state import app_state` (no such object).

These tests prove every runtime route now operates on the ONE shared singleton.
"""
import asyncio
import pathlib

import pytest

import app_state
from api.routes import pattern_routes, phase6_routes
from api.routes.pattern_routes import (
    set_dmx_map, import_timeline_clips,
    DmxMapPayload, DmxEntry, TimelineClipsPayload, TimelineClipTrack, TimelineKeyframe,
)


@pytest.fixture(autouse=True)
def _isolate_route_data_files(tmp_path, monkeypatch):
    """Redirect the routes' JSON persistence to a temp dir so tests never dirty the
    real backend/data/*.json files."""
    monkeypatch.setattr(pattern_routes, "DMX_FILE", str(tmp_path / "dmx_map.json"))
    monkeypatch.setattr(pattern_routes, "CLIPS_FILE", str(tmp_path / "timeline_clips.json"))


def test_timeline_clips_inject_into_shared_show_engine():
    """A recorded clip posted to the route must land in app_state.show_engine's timeline."""
    engine = app_state.show_engine
    engine.load_show({"currentShow": {"id": "wire", "name": "Wire"}, "fixtures": []})
    before = len(engine.timeline_tracks)

    payload = TimelineClipsPayload(
        name="Wiring Clip",
        clips=[TimelineClipTrack(
            fixtureId="jet-1", fixtureName="Jet 1", type="pump",
            keyframes=[TimelineKeyframe(time=0.0, value=0.8)], duration=2.0,
        )],
    )
    asyncio.run(import_timeline_clips(payload))

    assert len(engine.timeline_tracks) == before + 1, "clip did not reach the shared show engine"
    assert any(t.get("deviceId") == "jet-1" for t in engine.timeline_tracks)


def test_dmx_map_push_reaches_shared_protocol_bus():
    """Setting the DMX map must update the shared app_state.protocol_bus, not a second one."""
    payload = DmxMapPayload(map=[DmxEntry(fixtureId="L1", universe=1, channel=1)])
    asyncio.run(set_dmx_map(payload))

    pushed = app_state.protocol_bus.get_dmx_map()
    assert any(str(e.get("fixtureId")) == "L1" for e in pushed), \
        "DMX map did not reach the shared protocol bus"


def test_phase6_artnet_status_talks_to_shared_bus():
    """The status route must return a real payload, not an import 'error'."""
    result = asyncio.run(phase6_routes.artnet_status())
    assert "error" not in result, f"artnet_status still failing to wire: {result}"
    assert "running" in result


def test_phase6_blackout_uses_shared_bus():
    result = asyncio.run(phase6_routes.artnet_blackout())
    assert result == {"ok": True}


def _route_code(*names) -> str:
    """Concatenated *executable* source of the route modules — comment lines stripped
    so the orphan-wiring check inspects real imports/calls, not explanatory comments."""
    root = pathlib.Path(pattern_routes.__file__).parent
    lines = []
    for name in names:
        for ln in (root / name).read_text(encoding="utf-8").splitlines():
            if ln.lstrip().startswith("#"):
                continue
            lines.append(ln)
    return "\n".join(lines)


@pytest.mark.parametrize("orphan", [
    "get_show_engine",          # never existed on engine.show_engine
    "from app_state import app_state",  # no such object
    "get_protocol_bus",         # second, unused ProtocolBus instance
    "from backend.main import", # wrong module path for the WS manager
])
def test_routes_no_longer_reference_orphan_singletons(orphan):
    assert orphan not in _route_code("pattern_routes.py", "phase6_routes.py"), \
        f"route still references orphan wiring: {orphan!r}"
