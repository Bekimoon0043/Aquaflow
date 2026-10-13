"""AF-NEXT-009 - preflight compiler gate.

Every test is pure or uses simulated/capturing drivers. Nothing connects to hardware.
"""
import asyncio
import json

import pytest

from engine.siemens_site import SiteStore, bench_clips, compile_show, create_site
from engine.siemens_runtime import SiemensRuntime
from services.preflight import (PREVIEW_ONLY_LABEL, PreflightError, assert_preflight_ok,
                                engine_project, ican_pattern_project, run_preflight, siemens_target)

SHAPE = {"code", "severity", "timeMs", "fixtureId", "clipId", "engineeringItemId", "message", "fix", "source"}


def clip(cid, fid, kind, start, duration, value=100, **extra):
    return {"id": cid, "fixtureId": fid, "type": kind, "startTime": start, "duration": duration,
            "value": value, **extra}


def codes(result, severity=None):
    return [i["code"] for i in result["issues"] if severity is None or i["severity"] == severity]


def issue(result, code):
    return next(i for i in result["issues"] if i["code"] == code)


# A small pump -> valve -> nozzle design (links as written by CAD import / Siemens layout).
FIXTURES = [
    {"id": "P1", "type": "pump_submersible_1_5kw", "label": "Pump 1"},
    {"id": "V1", "type": "valve_solenoid_dn25_24v", "label": "Valve 1", "supplyingPumpId": "P1"},
    {"id": "V2", "type": "valve_solenoid_dn25_24v", "label": "Valve 2", "engineering": {"pumpId": "P1"}},
    {"id": "N1", "type": "nozzle_geyser", "label": "Nozzle 1", "linkedValveId": "V1"},
]


def test_every_issue_has_the_shared_diagnostic_shape_and_preview_is_labelled():
    result = run_preflight({"fixtures": FIXTURES, "clips": [clip("c1", "ghost", "device_intensity", 0, 2)]})
    assert result["issues"] and all(set(i) == SHAPE for i in result["issues"])
    assert result["hardware"] is False and result["label"] == PREVIEW_ONLY_LABEL
    assert "preview-only" in codes(result, "info")
    # Preview never refuses: a missing link is a warning there, an error for hardware.
    assert issue(result, "missing-fixture")["severity"] == "warning"
    hard = run_preflight({"fixtures": FIXTURES, "clips": [clip("c1", "ghost", "device_intensity", 0, 2)]}, {"kind": "dmx"})
    miss = issue(hard, "missing-fixture")
    assert miss["severity"] == "error" and miss["clipId"] == "c1" and miss["fix"] == {"kind": "open_clip", "target": "c1"}
    assert hard["ok"] is False and hard["summary"]["errors"] >= 1


def test_unmapped_fixture_for_a_hardware_target_opens_the_engineering_item():
    result = run_preflight({"fixtures": FIXTURES, "clips": [clip("c1", "P1", "pump_speed", 0, 5), clip("c2", "V1", "solenoid_open", 0, 5)]},
                           {"kind": "runtime", "mapped": ["P1"]})
    unmapped = issue(result, "unmapped-fixture")
    assert unmapped["fixtureId"] == "V1" and unmapped["fix"] == {"kind": "open_engineering_item", "target": "V1"}


@pytest.mark.parametrize("fixtures, code", [
    ([{"id": "L1", "type": "light_rgb", "dmxUniverse": 1, "dmxAddress": 10},
      {"id": "L2", "type": "light_rgb", "dmxUniverse": 1, "dmxAddress": 12}], "dmx-conflict"),   # 4-channel footprint overlaps
    ([{"id": "L1", "type": "light_rgb", "dmxUniverse": 1, "dmxAddress": 511}], "dmx-overflow"),
    ([{"id": "P1", "type": "pump", "plcRegister": 4}, {"id": "P2", "type": "pump", "plcRegister": 4}], "plc-conflict"),
    ([{"id": "V1", "type": "valve", "engineering": {"output": "%Q0.1"}},
      {"id": "V2", "type": "valve", "output": "Q0.1"}], "valve-output-conflict"),
    ([{"id": "R1", "type": "relay", "ican_group": 9, "ican_channel": 3},
      {"id": "R2", "type": "relay", "icanGroup": 9, "icanChannel": 3}], "ican-conflict"),
    ([{"id": "R1", "type": "relay", "ican_group": 9, "ican_channel": 0}], "ican-conflict"),
])
def test_channel_and_address_conflicts_are_errors(fixtures, code):
    result = run_preflight({"fixtures": fixtures, "clips": []}, {"kind": "runtime"})
    found = issue(result, code)
    assert found["severity"] == "error" and found["fix"]["kind"] == "open_engineering_item"
    assert result["ok"] is False


def test_dependency_graph_missing_equipment_is_reported():
    fixtures = [{"id": "F1", "type": "flame_unit", "dependsOn": ["gas-train"]}]
    assert "dependency-missing-dependency" in codes(run_preflight({"fixtures": fixtures, "clips": []}), "error")


def test_valve_without_pump_and_nozzle_without_valve():
    fixtures = FIXTURES + [{"id": "V3", "type": "valve_solenoid"}, {"id": "N2", "type": "nozzle_jet"}]
    result = run_preflight({"fixtures": fixtures, "clips": [
        clip("c1", "V3", "solenoid_open", 0, 4), clip("c2", "N2", "device_intensity", 0, 4)]})
    assert issue(result, "valve-without-pump")["fixtureId"] == "V3"
    assert issue(result, "nozzle-without-valve")["severity"] == "warning"


def test_topology_groups_from_cad_link_valves_to_pumps():
    fixtures = [{"id": "P9", "type": "pump"}, {"id": "V9", "type": "valve"}]
    project = {"fixtures": fixtures, "clips": [clip("c1", "V9", "solenoid_open", 0, 4)],
               "hydraulic_network": {"groups": [{"pumpId": "P9", "valveIds": ["V9"], "nozzleIds": []}]}}
    result = run_preflight(project)
    assert "valve-without-pump" not in codes(result)
    assert issue(result, "valve-open-pump-off")["engineeringItemId"] == "P9"


def test_pump_off_while_downstream_valve_open_is_a_warning_with_time():
    result = run_preflight({"fixtures": FIXTURES, "clips": [
        clip("p", "P1", "pump_speed", 2, 8, 40), clip("v", "V1", "solenoid_open", 0, 10)]})
    found = issue(result, "valve-open-pump-off")
    assert found["severity"] == "warning" and found["timeMs"] == 0 and found["clipId"] == "v"


def test_valve_closing_against_a_running_pump_without_bypass_is_an_error():
    clips = [clip("p", "P1", "pump_speed", 0, 10, 40), clip("v1", "V1", "solenoid_open", 0, 6),
             clip("v2", "V2", "solenoid_open", 0, 4)]
    result = run_preflight({"fixtures": FIXTURES, "clips": clips}, {"kind": "runtime"})
    closing = issue(result, "valve-close-against-pump")
    assert closing["severity"] == "error" and closing["timeMs"] == 6000
    assert closing["fixtureId"] == "V1" and closing["clipId"] == "v1" and closing["engineeringItemId"] == "P1"
    # A bypass on the pump makes it a warning; nothing else changes.
    bypassed = [dict(f, bypass=True) if f["id"] == "P1" else f for f in FIXTURES]
    assert issue(run_preflight({"fixtures": bypassed, "clips": clips}), "valve-close-against-pump")["severity"] == "warning"


def test_pump_started_with_every_outlet_closed_is_a_deadhead():
    result = run_preflight({"fixtures": FIXTURES, "clips": [
        clip("p", "P1", "pump_speed", 0, 10, 40), clip("v1", "V1", "solenoid_open", 3, 7)]})
    dead = issue(result, "pump-deadhead")
    assert dead["severity"] == "error" and dead["timeMs"] == 0 and dead["clipId"] == "p"


def test_a_valve_without_clips_follows_its_nozzles():
    result = run_preflight({"fixtures": FIXTURES, "clips": [
        clip("p", "P1", "pump_speed", 0, 10, 40), clip("n", "N1", "device_intensity", 0, 10)]})
    assert "pump-deadhead" not in codes(result) and "valve-close-against-pump" not in codes(result)


def test_nozzle_playing_while_its_programmed_valve_is_closed():
    result = run_preflight({"fixtures": FIXTURES, "clips": [
        clip("p", "P1", "pump_speed", 0, 10, 40), clip("v", "V1", "solenoid_open", 0, 10),
        clip("n", "N1", "device_intensity", 0, 4), clip("v-off", "V1", "solenoid_open", 0, 2)]})
    assert "nozzle-valve-closed" not in codes(result)
    result = run_preflight({"fixtures": FIXTURES, "clips": [
        clip("p", "P1", "pump_speed", 0, 10, 40), clip("v", "V1", "solenoid_open", 5, 5),
        clip("v2", "V2", "solenoid_open", 0, 10), clip("n", "N1", "device_intensity", 0, 8)]})
    assert issue(result, "nozzle-valve-closed")["timeMs"] == 0


def test_output_limits_and_min_on_off_times():
    fixtures = [{"id": "P1", "type": "pump", "engineering": {"maxPercent": 60}},
                {"id": "L1", "type": "light_rgb", "maxIntensity": 0.5},
                {"id": "V1", "type": "valve", "supplyingPumpId": "P1", "min_on_ms": 800, "min_off_ms": 600}]
    result = run_preflight({"fixtures": fixtures, "clips": [
        clip("p", "P1", "pump_speed", 0, 10, 80), clip("l", "L1", "lighting_master", 0, 2, 90),
        clip("v1", "V1", "solenoid_open", 0, .5), clip("v2", "V1", "solenoid_open", .7, 3)]})
    limits = [i for i in result["issues"] if i["code"] == "output-limit"]
    assert {i["fixtureId"] for i in limits} == {"P1", "L1"} and all(i["severity"] == "warning" for i in limits)
    assert issue(result, "min-on-time")["clipId"] == "v1"
    assert issue(result, "min-off-time")["timeMs"] == 500


def test_unsupported_channels_per_controller():
    fixtures = FIXTURES + [{"id": "L1", "type": "light_rgb"}]
    clips = [clip("n", "N1", "device_intensity", 0, 4, 40), clip("l", "L1", "lighting_red", 0, 4)]
    dmx = run_preflight({"fixtures": fixtures, "clips": clips}, {"kind": "dmx"})
    assert [i["fixtureId"] for i in dmx["issues"] if i["code"] == "unsupported-channel"] == ["N1"]
    ican = run_preflight({"fixtures": fixtures, "clips": clips}, {"kind": "ican"})
    assert {i["fixtureId"] for i in ican["issues"] if i["code"] == "unsupported-channel"} == {"N1", "L1"}


def test_flame_rules_follow_the_output_path_cutoff():
    fixtures = [{"id": "F1", "type": "flame_unit"}]
    # Two clips with a 0.3 s gap are one burst at the bus (gap reset is 0.5 s): 2 + 0.3 + 2 > 3 s.
    result = run_preflight({"fixtures": fixtures, "clips": [
        clip("f1", "F1", "device_intensity", 0, 2), clip("f2", "F1", "device_intensity", 2.3, 2),
        clip("f3", "F1", "device_intensity", 6, 1)]}, {"kind": "runtime"})
    flame = issue(result, "flame-duration")
    assert flame["severity"] == "error" and flame["clipId"] == "f1"
    assert issue(result, "flame-min-off")["severity"] == "warning"


def test_pump_short_cycle_is_reported():
    fixtures = FIXTURES
    result = run_preflight({"fixtures": fixtures, "clips": [
        clip("p1", "P1", "pump_speed", 0, 4, 40), clip("p2", "P1", "pump_speed", 4.5, 4, 40),
        clip("v", "V1", "solenoid_open", 0, 9)]})
    assert issue(result, "pump-short-cycle")["clipId"] == "p2"


def test_studio_recipe_clips_fix_to_the_recipe_and_muted_groups_are_not_checked():
    fixtures = [{"id": "F1", "type": "flame_unit"}]
    resolved = [dict(clip("r1:F1:0", "F1", "device_intensity", 0, 5), studioRecipeId="r1")]
    result = run_preflight({"fixtures": fixtures, "clips": resolved,
                            "recipes": [{"id": "r1", "groupId": "g1"}], "groups": [{"id": "g1"}]})
    assert issue(result, "flame-duration")["fix"] == {"kind": "open_clip", "target": "r1"}
    muted = run_preflight({"fixtures": fixtures, "clips": resolved,
                           "recipes": [{"id": "r1", "groupId": "g1"}], "groups": [{"id": "g1", "muted": True}]})
    assert "flame-duration" not in codes(muted)


def test_resolved_revision_is_stable_and_follows_edits():
    project = {"fixtures": FIXTURES, "clips": [clip("v", "V1", "solenoid_open", 0, 4)]}
    first = run_preflight(project)["resolved_revision"]
    assert first == run_preflight(json.loads(json.dumps(project)))["resolved_revision"]
    project["clips"][0]["duration"] = 5
    assert run_preflight(project)["resolved_revision"] != first


# ─── Siemens: compile collects every issue with IDs ────────────────────

def test_siemens_compile_reports_every_error_with_clip_ids():
    site = create_site()
    clips = bench_clips(site)
    pump, valve = clips[0], clips[1]
    bad = [dict(pump, id="too-fast", value=90),
           dict(valve, id="half-open", value=50),
           clip("foreign", "not-on-site", "solenoid_open", 0, 2),
           dict(valve, id="dup", startTime=valve["startTime"] + 1)]
    with pytest.raises(PreflightError) as caught:
        compile_show(site, bad + clips[2:])
    err = caught.value
    assert isinstance(err, ValueError)
    by_code = {i["code"]: i for i in err.issues if i["severity"] == "error"}
    assert {"output-limit", "valve-not-binary", "unmapped-fixture"} <= set(by_code)
    assert by_code["output-limit"]["clipId"] == "too-fast" and by_code["output-limit"]["fixtureId"] == pump["fixtureId"]
    assert by_code["unmapped-fixture"]["fix"] == {"kind": "open_clip", "target": "foreign"}
    assert "preflight errors" in str(err) and "speed ceiling" in str(err)


def test_siemens_site_mapping_errors_point_to_the_plc_panel():
    site = create_site()
    site["channels"][1]["output"] = "%Q0.1"
    site["channels"][2]["output"] = "%Q0.1"
    result = run_preflight({"clips": bench_clips(site)}, siemens_target(site))
    found = issue(result, "site-invalid")
    assert found["fix"] == {"kind": "open_panel", "target": "plc"} and not result["ok"]


def test_siemens_interlock_turns_a_deadhead_into_a_warning():
    site = create_site()
    clips = bench_clips(site)
    clips[1]["muted"] = True                # pump runs with no outlet for the first segment
    result = run_preflight({"clips": clips}, siemens_target(site))
    assert result["ok"] and issue(result, "pump-deadhead")["severity"] == "warning"
    compile_show(site, clips)               # still compiles (API compatibility)


# ─── Gates (simulated drivers only) ───────────────────────────────────

class _CapturingArtNet:
    name = "artnet"
    is_connected = True

    def __init__(self):
        self.sent = []

    async def connect(self):
        return True

    async def disconnect(self):
        pass

    async def blackout(self):
        pass

    async def send(self, data):
        self.sent.append(data)
        return True


def _engine_with_flame(seconds):
    from engine.protocol_bus import ProtocolBus
    from engine.show_engine import ShowEngine
    engine, bus = ShowEngine(), ProtocolBus()
    bus._drivers["artnet"] = _CapturingArtNet()
    bus._fixture_registers["F1"] = {"host": "10.0.0.5", "port": 502, "unit": 1, "register": 16}
    engine.load_show({"currentShow": {"id": "s", "name": "S", "duration": 10},
                      "fixtures": [{"id": "F1", "type": "flame_unit"}],
                      "timelineTracks": [{"id": "t1", "deviceId": "F1", "type": "flame",
                                          "clips": [{"id": "burn", "start": 0, "end": seconds, "intensity": 100}]}]})
    return engine, bus


def test_show_engine_refuses_real_hardware_playback_when_preflight_has_errors(monkeypatch):
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "1")

    async def run():
        engine, bus = _engine_with_flame(6)
        await engine.start(device_manager=None, protocol_bus=bus)
        assert await engine.play() is False
        assert "Preflight refused" in engine.last_error and "Flame" in engine.last_error
        assert engine.get_state()["preflight"]["ok"] is False
        assert engine.get_state()["preflight"]["issues"][0]["clipId"] == "burn"
        assert bus._drivers["artnet"].sent == []
        await engine.stop()
    asyncio.run(run())


def test_show_engine_allows_a_clean_real_show_and_any_simulated_show(monkeypatch):
    async def run(seconds):
        engine, bus = _engine_with_flame(seconds)
        await engine.start(device_manager=None, protocol_bus=bus)
        started = await engine.play()
        await engine.stop_playback()
        await engine.stop()
        return started
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "1")
    assert asyncio.run(run(2)) is True
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "0")   # simulation: preview path stays available
    assert asyncio.run(run(6)) is True


def test_show_engine_fails_closed_when_the_preflight_cannot_run(monkeypatch):
    monkeypatch.setenv("AQUAFLOW_HARDWARE_COMMISSIONED", "1")
    import services.preflight as preflight

    def broken(*_args, **_kwargs):
        raise RuntimeError("boom")
    monkeypatch.setattr(preflight, "run_preflight", broken)

    async def run():
        engine, bus = _engine_with_flame(1)
        await engine.start(device_manager=None, protocol_bus=bus)
        assert await engine.play() is False and "could not run" in engine.last_error
        await engine.stop()
    asyncio.run(run())


def test_siemens_start_refuses_a_saved_show_that_fails_preflight(tmp_path):
    store = SiteStore(tmp_path / "sites.json")
    site = create_site()
    site["mode"], site["plc"]["ip"] = "plcsim", "192.0.2.10"
    site = store.save(site)
    pump = next(c for c in site["channels"] if c["kind"] == "pump")
    sites = store.all()
    # A show saved by an older compiler (bypassing today's compile_show) for this revision.
    sites[0]["show"] = {"revision": site["revision"], "signature": 0, "duration": 10, "clips": [
        dict(fixtureId=pump["id"], type="pump_speed", startTime=0, duration=10, value=95, id="hot")]}
    store._write(sites)
    runtime = SiemensRuntime(store, permit=lambda: True)
    runtime.states[site["id"]] = {"armed": True}

    async def run():
        with pytest.raises(PreflightError, match="speed ceiling") as caught:
            await runtime.start(site["id"])
        assert caught.value.issues[0]["clipId"] == "hot"
        assert site["id"] not in runtime.tasks and site["id"] not in runtime.clients
    asyncio.run(run())


def test_simulated_siemens_status_is_labelled_preview_only(tmp_path):
    store = SiteStore(tmp_path / "sites.json")
    site = store.save(create_site())
    assert SiemensRuntime(store).status(site["id"])["output_label"] == PREVIEW_ONLY_LABEL


def test_ican_pattern_gate_blocks_a_long_flame_relay():
    pattern = {"steps": [{"duration_ms": 4000, "groups": {"9": [3]}}, {"duration_ms": 500, "groups": {}}]}
    devices = [{"device_id": "flame-left", "device_type": "flame", "ican_group": 9, "ican_channel": 3}]
    with pytest.raises(PreflightError, match="Flame"):
        assert_preflight_ok(ican_pattern_project(pattern, devices), {"kind": "ican"})
    assert run_preflight(ican_pattern_project(pattern, []), {"kind": "ican"})["ok"] is True


def test_engine_project_maps_tracks_to_resolved_clips():
    from engine.show_engine import ShowEngine
    engine = ShowEngine()
    engine.load_show({"fixtures": [{"id": "P1", "type": "pump"}],
                      "timelineTracks": [{"id": "t", "deviceId": "P1", "type": "pump",
                                          "clips": [{"id": "a", "start": 1, "end": 3, "intensity": 50}]},
                                         {"id": "loose", "type": "lighting", "clips": [{"id": "b", "start": 0, "end": 1}]}]})
    project = engine_project(engine)
    assert project["clips"] == [{"id": "a", "fixtureId": "P1", "type": "pump_speed", "startTime": 1.0, "duration": 2.0,
                                 "value": 50.0, "fadeIn": 0, "fadeOut": 0, "curveType": None, "muted": False,
                                 "disabled": None}]


# ─── API ───────────────────────────────────────────────────────────────

def test_preflight_endpoint_returns_the_full_issue_list(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routes import preflight_routes, siemens_sites

    store = SiteStore(tmp_path / "sites.json")
    site = store.save(create_site())
    monkeypatch.setattr(siemens_sites, "store", store)
    app = FastAPI()
    app.include_router(preflight_routes.router, prefix="/api/preflight")
    client = TestClient(app)
    preview = client.post("/api/preflight", json={"project": {"fixtures": FIXTURES, "clips": [
        clip("p", "P1", "pump_speed", 0, 10, 40), clip("v1", "V1", "solenoid_open", 3, 7)]}}).json()
    assert preview["ok"] is False and preview["label"] == PREVIEW_ONLY_LABEL
    assert set(preview) >= {"ok", "issues", "summary", "resolved_revision"}
    clips = bench_clips(site)
    clips[0]["value"] = 90
    siemens = client.post("/api/preflight", json={"project": {"clips": clips},
                                                   "target": {"kind": "siemens", "site_id": site["id"]}}).json()
    assert siemens["ok"] is False and siemens["hardware"] is True
    assert any(i["code"] == "output-limit" for i in siemens["issues"])
    missing = client.post("/api/preflight", json={"target": {"kind": "siemens"}})
    assert missing.status_code == 400


def test_siemens_compile_route_returns_structured_issues(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routes import siemens_sites

    store = SiteStore(tmp_path / "sites.json")
    site = store.save(create_site())
    monkeypatch.setattr(siemens_sites, "store", store)
    monkeypatch.setattr(siemens_sites.siemens_runtime, "store", store)
    app = FastAPI()
    app.include_router(siemens_sites.router, prefix="/api/siemens-sites")
    client = TestClient(app)
    clips = bench_clips(site)
    clips[0]["value"] = 90
    clips[1]["value"] = 50
    response = client.post(f"/api/siemens-sites/{site['id']}/compile", json={"revision": site["revision"], "clips": clips})
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "2 preflight errors" in detail["message"]
    assert {i["code"] for i in detail["issues"] if i["severity"] == "error"} == {"output-limit", "valve-not-binary"}
    ok = client.post(f"/api/siemens-sites/{site['id']}/compile",
                     json={"revision": site["revision"], "clips": bench_clips(site)}).json()
    assert ok["preflight"]["ok"] is True and ok["clips"]
