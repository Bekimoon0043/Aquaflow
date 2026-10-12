import asyncio
import io
import json
from pathlib import Path
import struct
import zipfile

import pytest

from engine.fake_s7_server import FakeS7Server
from engine.runtime_authority import RuntimeAuthority
from engine.s7_client import S7Client
from engine.siemens_contract import (COMMAND_SIZE, CONTRACT_VERSION, DB_SIZE, HEADER_SIZE,
                                     LIGHT_CAPACITY, MAGIC, PROGRAM_VERSION, PUMP_CAPACITY,
                                     VALVE_CAPACITY, parse_header, validate_header)
from engine.siemens_site import (SiteStore, create_site, create_tia_plcsim_test,
                                 create_tia_plcsim_large_io_test, validate_site, signature,
                                 compile_show, frame_at, frame_from_values, bench_clips)
from engine.siemens_runtime import SiemensRuntime
from services.siemens_tia_package import build_tia_package
from services.siemens_openness import (SiemensEngineeringService, OpennessBridge, OpennessError,
                                       supported_s7_1200_identifier)


def saved(tmp_path):
    store = SiteStore(tmp_path / "sites.json")
    site = store.save(create_site())
    return store, site


def test_verify_exposes_transport_error_when_s7_bridge_has_no_plcsim_cpu(tmp_path):
    class RefusedClient:
        last_error = "connection closed by peer"

        async def connect(self):
            return False

        async def close(self):
            pass

    async def scenario():
        store, site = saved(tmp_path)
        site["mode"] = "physical"
        site["plc"]["ip"] = "192.0.2.10"
        site = store.save(site, site["revision"])
        runtime = SiemensRuntime(store, client_factory=lambda *_args, **_kwargs: RefusedClient())
        with pytest.raises(ValueError, match="validated S7 connection: connection closed by peer"):
            await runtime.verify(site["id"])

    asyncio.run(scenario())


def test_ready_tia_plcsim_site_is_mapped_compiled_and_simulation_only():
    site = create_tia_plcsim_test()
    pump = next(channel for channel in site["channels"] if channel["kind"] == "pump")
    valves = [channel for channel in site["channels"] if channel["kind"] == "valve"]
    assert site["mode"] == "simulated" and site["plc"]["ip"] == ""
    assert site["tia"]["version"] == 17 and site["plc"]["db"] == 100
    assert (pump["output"], pump["enable_output"], pump["max_percent"]) == ("%QW64", "%Q0.0", 30)
    assert [valve["output"] for valve in valves] == ["%Q0.1", "%Q0.2"]
    assert all(valve["pump_id"] == pump["id"] for valve in valves)
    assert site["show"]["duration"] == 20 and len(site["show"]["clips"]) == 3


def test_large_1215c_plcsim_site_uses_integrated_io_and_exports_lab_guide():
    site = create_tia_plcsim_large_io_test()
    pumps = [channel for channel in site["channels"] if channel["kind"] == "pump"]
    valves = [channel for channel in site["channels"] if channel["kind"] == "valve"]
    lights = [channel for channel in site["channels"] if channel["kind"] == "light"]
    assert site["mode"] == "simulated" and site["plc"]["db"] == 100
    assert site["plc"]["expected_order_number"] == ""
    assert site["inputs"] == {
        "estop_ok": "%I0.0", "level_ok": "%I0.1", "thermal_ok": "%I0.2",
        "drive_ok": "%I0.3", "pressure_ok": "%I0.4",
    }
    assert [(pump["output"], pump["enable_output"]) for pump in pumps] == [
        ("%QW64", "%Q0.0"), ("%QW66", "%Q0.1")]
    assert [valve["output"] for valve in valves] == [
        "%Q0.2", "%Q0.3", "%Q0.4", "%Q0.5", "%Q0.6", "%Q0.7", "%Q1.0", "%Q1.1"]
    assert [light["output"] for light in lights] == ["%QB100", "%QB103", "%QB106", "%QB109"]
    assert all(channel["commissioned"] for channel in site["channels"])
    assert all("PLCSIM-only" in channel["observation"] for channel in site["channels"])
    assert site["show"]["duration"] == 60 and len(site["show"]["clips"]) == 42
    with zipfile.ZipFile(io.BytesIO(build_tia_package(site))) as archive:
        names = set(archive.namelist())
        guide = archive.read("CPU-1215C-LARGE-IO-PLCSIM-GUIDE.txt").decode()
        call = archive.read("cyclic-call.txt").decode()
        profile = json.loads(archive.read("lab-profile.json"))
    assert {"CPU-1215C-LARGE-IO-PLCSIM-GUIDE.txt", "lab-profile.json"} <= names
    assert "%I0.0 = TRUE" in guide and "%QW66: Pump 2 speed" in guide
    assert "EstopOK := %I0.0" in call and "PressureOK := %I0.4" in call
    assert profile["id"] == "s7-1215c-integrated-large-io-v1"


def test_site_mapping_survives_restart_and_edit_invalidates_show(tmp_path):
    store, site = saved(tmp_path)
    store.save_show(site["id"], bench_clips(site), 1)
    fresh = SiteStore(store.path)
    assert fresh.get(site["id"])["show"]["duration"] == 60
    site["channels"][1]["name"] = "Left jet"
    updated = fresh.save(site, 1)
    assert updated["revision"] == 2 and updated["show"] is None
    # The clips stay available for an explicit one-click recompile against revision 2.
    assert len(updated["previous_show_clips"]) == len(bench_clips(site))
    assert fresh.save_show(site["id"], updated["previous_show_clips"], 2)["revision"] == 2
    with pytest.raises(ValueError, match="reload"):
        fresh.save(site, 1)


@pytest.mark.parametrize("patch", [
    {"type": "pump_pressure"}, {"value": 90}, {"value": float("nan")},
    {"duration": -1}, {"effects": ["pulse"]}, {"fixtureId": "foreign-site"},
    {"curveType": "ease-in"}, {"fadeIn": 59, "fadeOut": 59},
])
def test_compiler_refuses_unsafe_or_unmapped_clips(patch):
    site = create_site()
    clips = bench_clips(site)
    clips[0].update(patch)
    with pytest.raises(ValueError):
        compile_show(site, clips)


def test_valves_require_binary_values_minimum_times_and_no_overlap():
    site = create_site()
    clip = bench_clips(site)[1]
    for patch in ({"value": 50}, {"duration": .1}, {"fadeIn": .1}):
        with pytest.raises(ValueError):
            compile_show(site, [{**clip, **patch}])
    with pytest.raises(ValueError, match="Overlapping"):
        compile_show(site, [clip, clip])
    with pytest.raises(ValueError, match="minimum off"):
        compile_show(site, [{**clip, "duration": 1}, {**clip, "startTime": 1.1, "duration": 1}])


def test_plain_manual_editor_clips_compile_and_muted_outputs_are_omitted():
    site = create_site()
    clips = bench_clips(site)
    clips[0]["effects"] = [{"type": "basic", "startTime": 0, "duration": 2, "params": {"value": 100}}]
    clips[1]["muted"] = True
    show = compile_show(site, clips)
    assert show["clips"][0]["value"] == 30
    payload, values = frame_at(site, show, 2)
    assert not any(payload)
    with pytest.raises(ValueError, match="no enabled"):
        compile_show(site, [{**clips[0], "muted": True}])


def test_output_mapping_rejects_overlapping_physical_addresses():
    site = create_site()
    site["channels"][0].update(output="%QW64", enable_output="%Q0.0")
    site["channels"][1]["output"] = "%Q64.3"
    with pytest.raises(ValueError, match="Overlapping"):
        validate_site(site)


def test_site_requires_real_observation_and_pump_dependency():
    site = create_site()
    site["channels"][0]["commissioned"] = True
    with pytest.raises(ValueError, match="observed"):
        validate_site(site)
    site["channels"][0]["commissioned"] = False
    site["channels"][1]["pump_id"] = "unknown"
    with pytest.raises(ValueError, match="supplying"):
        validate_site(site)


def test_tia_hardware_identifiers_are_explicit_and_part_of_program_signature():
    site = create_site()
    original = signature(site)
    site["tia"]["cpu_type_identifier"] = "OrderNumber:6ES7 215-1AG40-0XB0/V4.5"
    site["tia"]["modules"] = [{"name": "DI_Module", "type_identifier": "OrderNumber:6ES7 221-1BF32-0XB0/V2.0", "position": 2}]
    validated = validate_site(site)
    assert validated["tia"]["version"] == 20 and signature(validated) != original
    validated["tia"]["modules"].append({"name": "Duplicate", "type_identifier": "OrderNumber:6ES7 222-1BF32-0XB0/V2.0", "position": 2})
    with pytest.raises(ValueError, match="positions"):
        validate_site(validated)
    site["tia"]["cpu_type_identifier"] = "guessed cpu"
    with pytest.raises(ValueError, match="TypeIdentifier"):
        validate_site(site)


class FakeOpennessBridge:
    def __init__(self):
        self.requests = []

    def status(self):
        return {"available": True, "capabilities": {"project": True, "compile": True, "download": True, "diagnostics": True},
                "supported_tia_versions": [20], "public_apis": [{"version": "20"}],
                "openness_group_member": True, "requirements": []}

    def run(self, request, timeout=None):
        self.requests.append(request)
        operation = request["operation"]
        if operation == "generate":
            return {"ok": True, "bridge": "test", "project_path": str(Path(request["project_dir"]) / "AquaFlowSite.ap20"), "diagnostics": []}
        if operation == "compile":
            return {"ok": True, "bridge": "test", "state": "Success", "error_count": 0,
                    "warning_count": 0, "program_validation": {"cycle_us": 100000, "call_verified": True},
                    "diagnostics": []}
        if operation == "download":
            return {"ok": True, "bridge": "test", "pre_download_compile_state": "Success",
                    "pre_download_compile_errors": 0,
                    "diagnostics": [{"severity": "Success", "message": "left STOP"}]}
        return {"ok": True, "bridge": "test", "online_state": "Offline", "diagnostics": []}


def test_openness_engineering_has_signed_stages_and_strict_download_gate(tmp_path):
    store, site = saved(tmp_path)
    site["tia"]["cpu_type_identifier"] = "OrderNumber:6ES7 215-1AG40-0XB0/V4.5"
    site = store.save(site, 1)
    bridge = FakeOpennessBridge()
    service = SiemensEngineeringService(store, tmp_path, bridge=bridge)
    project = service.generate_project(site["id"], 2)
    assert project["stage"] == "project_generated"
    assert {p.name for p in (tmp_path / "siemens_engineering" / "sites" / site["id"] / "sources").iterdir()} >= {"AquaFlowSiteIO.db", "AquaFlowSiteControl.scl", "AquaFlowCycle.scl", "cyclic-ob-requirement.json", "site.json"}
    compiled = service.compile_project(site["id"], 2)
    assert compiled["stage"] == "compiled"
    with pytest.raises(OpennessError, match="physical"):
        service.download(site["id"], 2, f"DOWNLOAD {site['name']}", True, True)
    site["mode"], site["plc"]["ip"] = "physical", "192.168.10.10"
    site = store.save(site, 2)
    with pytest.raises(OpennessError, match="current compiled"):
        service.download(site["id"], 3, f"DOWNLOAD {site['name']}", True, True)
    service.generate_project(site["id"], 3); service.compile_project(site["id"], 3)
    with pytest.raises(OpennessError, match="Type exactly"):
        service.download(site["id"], 3, "DOWNLOAD wrong", True, True)
    with pytest.raises(OpennessError, match="CPU in STOP"):
        service.download(site["id"], 3, f"DOWNLOAD {site['name']}", False, True)
    with pytest.raises(OpennessError, match="order number"):
        service.download(site["id"], 3, f"DOWNLOAD {site['name']}", True, False)
    downloaded = service.download(site["id"], 3, f"DOWNLOAD {site['name']}", True, True, True, "temporary-secret")
    assert downloaded["stage"] == "downloaded" and downloaded["target"] == "192.168.10.10"
    assert bridge.requests[-1]["start_after_download"] is False
    assert bridge.requests[-1]["db_number"] == 100
    assert bridge.requests[-1]["cpu_type_identifier"] == site["tia"]["cpu_type_identifier"]


def test_openness_status_is_honest_when_siemens_is_absent(monkeypatch):
    monkeypatch.setattr(OpennessBridge, "installed_public_apis", staticmethod(lambda: []))
    monkeypatch.setattr(OpennessBridge, "user_in_group", staticmethod(lambda: False))
    bridge = OpennessBridge(executable="missing.exe")
    status = bridge.status()
    assert not status["available"] and not status["capabilities"]["download"]
    assert any("STEP 7" in item for item in status["requirements"])


def test_s7_1200_cpu_scope_and_tia_bridge_version_are_enforced(tmp_path):
    assert supported_s7_1200_identifier("OrderNumber:6ES7 215-1AG40-0XB0/V4.5")
    assert not supported_s7_1200_identifier("OrderNumber:6ES7 516-3AN02-0AB0/V3.1")
    store, site = saved(tmp_path)
    bridge = FakeOpennessBridge()
    service = SiemensEngineeringService(store, tmp_path, bridge=bridge)
    site["tia"]["cpu_type_identifier"] = "OrderNumber:6ES7 516-3AN02-0AB0/V3.1"
    site = store.save(site, 1)
    with pytest.raises(OpennessError, match="limited to standard S7-1200"):
        service.generate_project(site["id"], 2)
    site["tia"]["cpu_type_identifier"] = "OrderNumber:6ES7 215-1AG40-0XB0/V4.5"
    site = store.save(site, 2)
    bridge.status = lambda: {
        "available": True, "capabilities": {"project": True}, "supported_tia_versions": [19],
        "requirements": [],
    }
    with pytest.raises(OpennessError, match="does not match.*V19"):
        service.generate_project(site["id"], 3)


def test_compile_and_download_failures_never_advance_engineering_stage(tmp_path):
    store, site = saved(tmp_path)
    site["tia"]["cpu_type_identifier"] = "OrderNumber:6ES7 215-1AG40-0XB0/V4.5"
    site = store.save(site, 1)
    bridge = FakeOpennessBridge()
    service = SiemensEngineeringService(store, tmp_path, bridge=bridge)
    service.generate_project(site["id"], 2)
    original_run = bridge.run

    def failed_compile(request, timeout=None):
        if request["operation"] == "compile":
            return {"ok": True, "state": "Error", "error_count": 1, "diagnostics": []}
        return original_run(request, timeout)

    bridge.run = failed_compile
    with pytest.raises(OpennessError, match="1 error"):
        service.compile_project(site["id"], 2)
    assert service.status(site["id"])["engineering"]["stage"] == "project_generated"

    bridge.run = original_run
    service.compile_project(site["id"], 2)
    site["mode"], site["plc"]["ip"] = "physical", "192.168.10.10"
    site = store.save(site, 2)
    service.generate_project(site["id"], 3)
    service.compile_project(site["id"], 3)

    def failed_predownload_compile(request, timeout=None):
        if request["operation"] == "download":
            raise OpennessError("Siemens compilation failed before download")
        return original_run(request, timeout)

    bridge.run = failed_predownload_compile
    with pytest.raises(OpennessError, match="before download"):
        service.download(site["id"], 3, f"DOWNLOAD {site['name']}", True, True)
    assert service.status(site["id"])["engineering"]["stage"] == "compiled"


def test_openness_bridge_round_trips_cyclic_ob_and_recompiles_before_download():
    source = (Path(__file__).resolve().parents[2] / "tools" / "tia-openness-bridge" / "Program.cs").read_text()
    assert '{ "cyclic_ob_generation", true }' in source
    assert "generated.Export(" in source and "generated.Delete();" in source
    assert 'secondary.Value = "CyclicInterrupt"' in source
    assert "plc.BlockGroup.Blocks.Import(" in source
    assert 'GetAttribute("CyclicTime")' in source and "cyclicTime != 100000" in source
    assert 'GetAttribute("SecondaryType")' in source and 'cycle.Export(' in source
    download = source.split("private static Dictionary<string, object> DownloadProject()", 1)[1]
    download = download.split("private static Dictionary<string, object> Diagnostics()", 1)[0]
    assert download.index("VerifyProgram(plc)") < download.index(".Compile()") < download.index("provider.Download(")


def test_pump_frame_is_zero_without_outlet_and_encodes_exact_bank_locations():
    site = create_site()
    clips = bench_clips(site)
    show = compile_show(site, [clips[0]])
    payload, values = frame_at(site, show, 2)
    assert payload[:32] == bytes(32)
    assert values[site["channels"][0]["id"]] == 0
    show = compile_show(site, clips)
    payload, _ = frame_at(site, show, 16)
    assert struct.unpack_from(">H", payload, 0)[0] == round(.3 * 27648)
    assert payload[32] == 1  # pump mode AUTO
    assert payload[48] == 2  # valve index 1
    assert payload[112:] == bytes(96)  # RGB bank is dark unless lighting tracks are present.


def test_light_tracks_encode_rgb_with_master_and_tia_maps_three_output_bytes():
    site = create_site(lights=1)
    light = next(c for c in site["channels"] if c["kind"] == "light")
    light["output"] = "%QB100"
    clips = [
        {"fixtureId": light["id"], "type": "lighting_master", "startTime": 0, "duration": 2, "value": 50},
        {"fixtureId": light["id"], "type": "lighting_red", "startTime": 0, "duration": 2, "value": 100},
        {"fixtureId": light["id"], "type": "lighting_blue", "startTime": 0, "duration": 2, "value": 25},
    ]
    payload, values = frame_at(site, compile_show(site, clips), 1)
    assert payload[112:115] == bytes([128, 0, 32])
    assert values[light["id"]] == {"master": 50.0, "red": 128, "green": 0, "blue": 32}
    with zipfile.ZipFile(io.BytesIO(build_tia_package(site))) as archive:
        fb = archive.read("AquaFlowSiteControl.scl").decode()
    assert "%QB100" in fb and "%QB101" in fb and "%QB102" in fb


def test_contract_header_rejects_wrong_version_and_capacity():
    site = create_site()
    raw = struct.pack(">HHHHII14HI16s", MAGIC, CONTRACT_VERSION, HEADER_SIZE, 0,
                      signature(site), PROGRAM_VERSION, 1, 0, 1, 0, 0, 0, 0, 0, 0, 100,
                      PUMP_CAPACITY, VALVE_CAPACITY, LIGHT_CAPACITY, 0, 0, bytes(16))
    header = parse_header(raw)
    validate_header(header, signature(site))
    bad = bytearray(raw)
    struct.pack_into(">H", bad, 2, CONTRACT_VERSION + 1)
    with pytest.raises(ValueError, match="contract"):
        validate_header(parse_header(bytes(bad)), signature(site))


def test_manual_frame_rejects_fractional_valve_and_non_finite_values():
    site = create_site()
    pump = next(c for c in site["channels"] if c["kind"] == "pump")
    valve = next(c for c in site["channels"] if c["kind"] == "valve")
    with pytest.raises(ValueError, match="0 or 100"):
        frame_from_values(site, {valve["id"]: 50})
    with pytest.raises(ValueError, match="between"):
        frame_from_values(site, {valve["id"]: 100, pump["id"]: float("nan")})


def test_tia_export_has_matching_identity_and_safe_unmapped_inputs():
    site = create_site()
    with zipfile.ZipFile(io.BytesIO(build_tia_package(site))) as archive:
        db = archive.read("AquaFlowSiteIO.db").decode()
        fb = archive.read("AquaFlowSiteControl.scl").decode()
        call = archive.read("cyclic-call.txt").decode()
        cycle_source = archive.read("AquaFlowCycle.scl").decode()
        cyclic = json.loads(archive.read("cyclic-ob-requirement.json"))
        manifest = json.loads(archive.read("runtime-contract.json"))
        package_manifest = json.loads(archive.read("package-manifest.json"))
        exported_show = json.loads(archive.read("AquaFlowShow.json"))
        connection = json.loads(archive.read("AquaFlowConnection.json"))
        quickstart = archive.read("TIA-V17-PLUS-QUICKSTART.txt").decode()
        same_pc = archive.read("SAME-PC-PLCSIM-GUIDE.txt").decode()
        simulator_call = archive.read("PLCSIM-ONLY-cyclic-call.txt").decode()
        assert f"DW#16#{signature(site):08X}" in db and f"DW#16#{signature(site):08X}" in fb
        assert "S7_Optimized_Access := 'FALSE'" in db
        assert call.count(":= FALSE") == 5
        assert "#MissedCycles >= 10" in fb and "#Ready := FALSE" in fb
        assert "#PumpAllowed := #Running AND" in fb
        assert "#PumpAllowed := #Running AND (FALSE) AND NOT (FALSE);" in fb
        assert "ContractVersion : UInt := 2" in db and "LightAppliedRGB" in db
        assert manifest["db_size"] == DB_SIZE and manifest["offsets"]["valve_command"] == 112
        assert package_manifest["tia_portal"]["minimum_version"] == 17
        assert package_manifest["import_order"] == [
            "AquaFlowSiteIO.db", "AquaFlowSiteControl.scl", "AquaFlowCycle.scl"]
        assert package_manifest["manual_v17_import_order"] == [
            "AquaFlowSiteIO.db", "AquaFlowSiteControl.scl"]
        assert package_manifest["manual_cyclic_ob"]["number"] == 200
        assert package_manifest["compiled_pattern"]["included"] is False
        assert exported_show["included"] is False and exported_show["show"] is None
        assert connection["db"] == site["plc"]["db"]
        assert connection["site_signature"] == manifest["site_signature"]
        assert "TIA PORTAL V17+" in quickstart and "AquaFlow schedules the pattern" in quickstart
        assert "Create OB200 AquaFlowCycle" in quickstart
        assert "PLCSIM-ONLY-cyclic-call.txt" in same_pc and simulator_call.count(":= TRUE") == 5
        assert "Never transfer" in same_pc
        assert archive.read("ShowTimeline.csv").decode().startswith("Order,Channel,Kind")
        assert cyclic == {
            "name": "AquaFlowCycle", "event": "CyclicInterrupt", "minimum_ob_number": 200,
            "cycle_us": 100000, "phase_us": 0, "language": "SCL",
            "required_instance_call": "AquaFlowSiteControlInstance", "automatic_generation": True,
            "generation_method": cyclic["generation_method"],
        }
        assert "version-native" in cyclic["generation_method"]
        assert "AquaFlowSiteControlInstance" in call and "EstopOK := FALSE" in call
        assert 'ORGANIZATION_BLOCK "AquaFlowCycle"' in cycle_source
        assert "AquaFlowSiteControlInstance" in cycle_source and "PressureOK := FALSE" in cycle_source
        # The FB evaluates healthy-high permits before adopting a command, resolves all valve
        # states before pump permission, and publishes acknowledgement only after outputs/status.
        assert fb.index("#LocalPermit :=") < fb.index("#Seq :=")
        assert fb.index("#Wanted :=") < fb.index("#PumpAllowed :=")
        assert fb.rindex("\"AquaFlowSiteIO\".AckSequence") > fb.rindex("\"AquaFlowSiteIO\".Status")
        assert json.loads(archive.read("site.json"))["id"] == site["id"]
    old_stamp = signature(site)
    site["channels"][0]["observation"] = "Pump seen on site"
    assert signature(site) == old_stamp
    site["channels"][0]["max_percent"] = 35
    assert signature(site) != old_stamp


def test_tia_export_carries_compiled_pattern_and_human_readable_timeline():
    site = create_site()
    site["show"] = compile_show(site, bench_clips(site))
    with zipfile.ZipFile(io.BytesIO(build_tia_package(site))) as archive:
        exported = json.loads(archive.read("AquaFlowShow.json"))
        package = json.loads(archive.read("package-manifest.json"))
        timeline = archive.read("ShowTimeline.csv").decode()
    assert exported["included"] is True
    assert exported["site_signature"] == f"0x{signature(site):08X}"
    assert exported["show"]["duration"] == 60
    assert package["compiled_pattern"] == {
        "included": True,
        "clip_count": len(site["show"]["clips"]),
        "duration_seconds": 60,
    }
    assert "Pump 1,pump" in timeline and "Valve 1,valve" in timeline


def test_tia_pump_interlock_uses_only_physically_mapped_valve_paths():
    site = create_site()
    site["channels"][1]["output"] = "%Q0.1"
    with zipfile.ZipFile(io.BytesIO(build_tia_package(site))) as archive:
        fb = archive.read("AquaFlowSiteControl.scl").decode()
    assert "#PumpAllowed := #Running AND (#ValveOpen[0]) AND NOT (FALSE);" in fb
    assert "#ValveOpen[1]" not in fb.split("#PumpAllowed :=", 1)[1].split("#PumpTarget :=", 1)[0]


def test_simulation_never_constructs_client_and_global_estop_stops_it(tmp_path):
    async def scenario():
        store, site = saved(tmp_path)
        store.save_show(site["id"], bench_clips(site), 1)
        def forbidden(*args, **kwargs):
            raise AssertionError("Simulation attempted network IO")
        runtime = SiemensRuntime(store, client_factory=forbidden)
        sid = site["id"]
        await runtime.verify(sid)
        assert runtime.status(sid)["hardware_verified"] is False
        await runtime.arm(sid)
        await runtime.start(sid)
        await asyncio.sleep(.15)
        assert any(runtime.status(sid)["values"].values())
        authority = RuntimeAuthority().register(siemens_sites=runtime)
        assert (await authority.emergency_stop())["results"]["siemens_sites"] == "ok"
        status = runtime.status(sid)
        assert not status["running"] and not status["armed"] and status["stop_confirmed"]
        assert all(value == 0 for value in status["values"].values())
        with pytest.raises(ValueError, match="arm"):
            await runtime.start(sid)
        await runtime.close()
    asyncio.run(scenario())


def test_simulated_commissioning_only_activates_one_outlet_and_related_pump(tmp_path):
    async def scenario():
        store, site = saved(tmp_path)
        runtime = SiemensRuntime(store)
        sid = site["id"]
        await runtime.verify(sid)
        chosen = site["channels"][2]
        await runtime.test_outlet(sid, chosen["id"], .5)
        await asyncio.sleep(.2)
        values = runtime.status(sid)["values"]
        assert values[chosen["id"]] == 100 and sum(v == 100 for v in values.values()) == 1
        await runtime.tasks[sid]
        assert runtime.status(sid)["stop_confirmed"] and not runtime.status(sid)["armed"]
        await runtime.close()
    asyncio.run(scenario())


async def physical_bench(tmp_path, *, tick=True, mode="physical"):
    store, site = saved(tmp_path)
    site["mode"] = mode
    site["plc"]["ip"] = "192.0.2.10"  # Factory below redirects only this test to loopback.
    site["channels"][0].update(output="%QW64", enable_output="%Q0.0")
    for index, channel in enumerate(site["channels"]):
        if channel["kind"] == "valve":
            channel["output"] = f"%Q0.{index}"
        channel.update(commissioned=True, observation="BENCH fixture, not a real commissioning record")
    site = store.save(site, 1)
    # Target/mapping changes now invalidate previous commissioning approval.
    for channel in site["channels"]:
        channel.update(commissioned=True, observation="BENCH fixture, not a real commissioning record")
    site = store.save(site, site["revision"])
    store.save_show(site["id"], bench_clips(site), site["revision"])
    server = FakeS7Server()
    server.dbs[100] = bytearray(DB_SIZE)
    struct.pack_into(">HHHHII", server.dbs[100], 0, MAGIC, CONTRACT_VERSION, HEADER_SIZE, 0,
                     signature(site), PROGRAM_VERSION)
    struct.pack_into(">HHHHHHHHHHHHHH", server.dbs[100], 16,
                     1, 0, 1, 0, 0, 0, 0, 0, 0, 100,
                     PUMP_CAPACITY, VALVE_CAPACITY, LIGHT_CAPACITY, 0)
    await server.start()
    controls = {"tick": tick, "permit": True, "ack": True, "local": True,
                "keep_running_after_off": False, "fresh_off_required": False,
                "reject_run": False, "ready": False}
    def factory(host, **kwargs):
        return S7Client("127.0.0.1", port=server.port, timeout=.2)
    runtime = SiemensRuntime(store, permit=lambda: controls["permit"], client_factory=factory)
    async def plc_cycle():
        last = 0
        missed = 0
        while True:
            if controls["tick"]:
                server.tick_heartbeat(100, 16)
            if controls["fresh_off_required"]:
                missed += 1
                if missed >= 10:
                    controls["ready"] = False
            server.set_word(100, 20, int(controls["local"]))
            seq, flags = server.get_word(100, 26), server.get_word(100, 28)
            if controls["ack"] and seq != last and not flags & 0x8000:
                missed = 0
                if not flags & 1:
                    controls["ready"] = True
                server.set_word(100, 24, seq)
                server.set_word(100, 32, seq)
                server.set_word(100, 6, int(controls["keep_running_after_off"] or
                                            (bool(flags & 1) and controls["local"] and
                                             not controls["reject_run"] and
                                             (not controls["fresh_off_required"] or controls["ready"]))))
                server.set_word(100, 30, 2 if (flags & 1) and not server.get_word(100, 6) else 0)
                server.dbs[100][272:304] = server.dbs[100][64:96]
                server.dbs[100][304] = int(server.get_word(100, 64) > 0)
                server.dbs[100][308:372] = server.dbs[100][112:176]
                server.dbs[100][372:468] = server.dbs[100][176:272]
                last = seq
            await asyncio.sleep(.025)
    cycle = asyncio.create_task(plc_cycle())
    return store, site, server, runtime, controls, cycle


def test_plcsim_network_mode_writes_db_without_physical_commissioning_claim(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path, mode="plcsim")
        try:
            for channel in site["channels"]:
                channel.update(commissioned=False, observation="PLCSIM-only bench verification")
            site = store.save(site, site["revision"])
            store.save_show(site["id"], bench_clips(site), site["revision"])
            await runtime.verify(site["id"])
            armed = await runtime.arm(site["id"], True)
            assert armed["armed"] and armed["quality"] == "PLCSIM_S7COMM_VERIFIED"
            started = await runtime.start(site["id"])
            assert started["running"]
            await asyncio.sleep(.15)
            assert server.writes > 0
            await runtime.stop(site["id"])
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()

    asyncio.run(scenario())


def test_real_s7_wire_verification_has_zero_writes_and_permit_loss_stops(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid)
            assert server.writes == 0
            await runtime.arm(sid, True)
            assert server.dbs[100][64:272] == bytes(COMMAND_SIZE)
            await runtime.start(sid)
            await asyncio.sleep(.25)
            assert server.get_word(100, 64) > 0 and server.dbs[100][112] == 1
            controls["permit"] = False
            await runtime.tasks[sid]
            status = runtime.status(sid)
            assert "permit withdrawn" in status["error"]
            assert not status["armed"] and status["stop_confirmed"]
            assert server.dbs[100][64:272] == bytes(COMMAND_SIZE)
        finally:
            await runtime.close(); cycle.cancel()
            await server.stop()
    asyncio.run(scenario())


def test_delayed_operator_start_refreshes_off_handshake_before_run(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        controls["fresh_off_required"] = True
        try:
            sid = site["id"]
            await runtime.verify(sid)
            await runtime.arm(sid, True)
            await asyncio.sleep(1.2)  # Longer than Ready and AquaFlow's one-second heartbeat window.
            assert not controls["ready"]
            started = await runtime.start(sid)
            assert started["plc_running"] is True
            assert started["feedback_valid"] is True
            assert started["running"] is True
            await asyncio.sleep(.2)
            assert runtime.status(sid)["error"] is None, runtime.status(sid)
            await runtime.stop(sid)
            assert runtime.status(sid)["stop_confirmed"] is True, runtime.status(sid)
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_rejected_first_run_is_reported_by_start_and_zeroed(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid)
            await runtime.arm(sid, True)
            controls["reject_run"] = True
            with pytest.raises(ValueError, match="refused RUN"):
                await runtime.start(sid)
            status = runtime.status(sid)
            assert status["running"] is False
            assert status["armed"] is False
            assert status["stop_confirmed"] is True
            assert server.dbs[100][64:272] == bytes(COMMAND_SIZE)
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_stop_reconnects_after_s7_stream_is_lost_and_confirms_off(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid)
            await runtime.arm(sid, True)
            await runtime.start(sid)
            runtime.clients[sid]._mark_down("interrupted reply")
            stopped = await runtime.stop(sid)
            assert stopped["stop_confirmed"] is True, stopped
            assert stopped["plc_running"] is False
            assert stopped["connection_state"] == "stopped_reverify_required"
            assert stopped["verified"] is False
            assert server.dbs[100][64:272] == bytes(COMMAND_SIZE)
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_stopped_heartbeat_is_rejected_without_writes(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path, tick=False)
        try:
            with pytest.raises(ValueError, match="heartbeat"):
                await runtime.verify(site["id"])
            assert server.writes == 0
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_plc_stopping_after_verify_blocks_arm_without_writes(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid)
            controls["tick"] = False
            await asyncio.sleep(.05)
            with pytest.raises(ValueError, match="heartbeat is not moving"):
                await runtime.arm(sid, True)
            assert server.writes == 0
            assert not runtime.status(sid)["armed"]
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_another_controller_running_after_verify_blocks_arm_without_writes(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid)
            server.set_word(100, 6, 1)
            with pytest.raises(ValueError, match="already reports RUN"):
                await runtime.arm(sid, True)
            assert server.writes == 0
            assert not runtime.status(sid)["armed"]
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_missing_ack_does_not_claim_stopped(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid); await runtime.arm(sid, True); await runtime.start(sid)
            await asyncio.sleep(.2)
            controls["ack"] = False
            await runtime.stop(sid)
            assert runtime.status(sid)["stop_confirmed"] is False
            assert "unconfirmed" in runtime.status(sid)["error"]
            assert not runtime.status(sid)["armed"]
            assert runtime.status(sid)["feedback_valid"] is False
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_acknowledged_off_with_plc_still_running_is_unconfirmed(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid)
            await runtime.arm(sid, True)
            await runtime.start(sid)
            await asyncio.sleep(.2)
            controls["keep_running_after_off"] = True
            stopped = await runtime.stop(sid)
            assert stopped["stop_confirmed"] is False
            assert stopped["connection_state"] == "stop_unconfirmed"
            assert stopped["verified"] is False
            assert stopped["feedback_valid"] is False
            assert stopped["requires_rearm"] is True
            assert "still reports RUN" in stopped["error"]
            assert not stopped["armed"]
        finally:
            controls["keep_running_after_off"] = False
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_heartbeat_loss_during_playback_disarms_even_when_reads_and_acks_work(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid); await runtime.arm(sid, True); await runtime.start(sid)
            await asyncio.sleep(.15)
            controls["tick"] = False
            await runtime.tasks[sid]
            status = runtime.status(sid)
            assert "heartbeat stopped" in status["error"]
            assert not status["armed"] and not status["verified"]
            assert status["stop_confirmed"] and server.dbs[100][64:272] == bytes(COMMAND_SIZE)
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_wrong_program_signature_rejected_readonly(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        try:
            struct.pack_into(">I", server.dbs[100], 8, 0)
            with pytest.raises(ValueError, match="does not match"):
                await runtime.verify(site["id"])
            assert server.writes == 0
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_physical_arm_requires_permits_observations_and_local_permission(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid)
            with pytest.raises(ValueError, match="flow path"):
                await runtime.arm(sid, False)
            controls["permit"] = False
            with pytest.raises(ValueError, match="safety permits"):
                await runtime.arm(sid, True)
            controls["permit"] = True
            controls["local"] = False
            await asyncio.sleep(.05)
            with pytest.raises(ValueError, match="local safety"):
                await runtime.arm(sid, True)
            assert server.writes == 0
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_physical_arm_waits_for_safety_permit_tick(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid)
            controls["permit"] = False
            async def publish_permit():
                await asyncio.sleep(.05)
                controls["permit"] = True
            publish = asyncio.create_task(publish_permit())
            armed = await runtime.arm(sid, True)
            await publish
            assert armed["armed"] is True
            assert armed["stop_confirmed"] is True
            await runtime.stop(sid)
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_manual_command_round_trip_returns_plc_feedback_and_stop(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        try:
            sid = site["id"]
            pump = next(c for c in site["channels"] if c["kind"] == "pump")
            valve = next(c for c in site["channels"] if c["kind"] == "valve")
            await runtime.verify(sid)
            await runtime.arm(sid, True)
            await runtime.start_manual(sid, {pump["id"]: 20, valve["id"]: 100})
            await asyncio.sleep(.2)
            status = runtime.status(sid)
            assert status["runtime_mode"] == "manual"
            assert status["feedback"][pump["id"]]["running"] is True
            assert status["feedback"][valve["id"]]["open"] is True
            stopped = await runtime.stop(sid)
            assert stopped["stop_confirmed"] and not stopped["armed"]
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_reconnect_reverifies_but_never_resumes_or_rearms(tmp_path):
    async def scenario():
        store, site, server, runtime, controls, cycle = await physical_bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid); await runtime.arm(sid, True); await runtime.start(sid)
            controls["tick"] = False
            await runtime.tasks[sid]
            controls["tick"] = True
            status = await runtime.reconnect(sid)
            assert status["verified"] and not status["armed"] and not status["running"]
            assert status["requires_rearm"] is True
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()
    asyncio.run(scenario())


def test_api_create_edit_export_and_compile_use_persisted_mapping(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routes import siemens_sites
    store = SiteStore(tmp_path / "api-sites.json")
    class FakeEngineering:
        def status(self, sid=None):
            return {"available": True, "site_id": sid}
        def generate_project(self, sid, revision):
            return {"site_id": sid, "source_revision": revision, "stage": "project_generated"}
        def compile_project(self, sid, revision):
            return {"site_id": sid, "source_revision": revision, "stage": "compiled"}
        def diagnostics(self, sid, revision):
            return {"site_id": sid, "online_state": "Offline"}
        def download(self, sid, revision, confirmation, cpu_stop_acknowledged, target_hardware_confirmed, memory_reinitialization_confirmed, password):
            return {"site_id": sid, "stage": "downloaded"}
    monkeypatch.setattr(siemens_sites, "store", store)
    monkeypatch.setattr(siemens_sites, "siemens_runtime", SiemensRuntime(store))
    monkeypatch.setattr(siemens_sites, "engineering", FakeEngineering())
    app = FastAPI()
    app.include_router(siemens_sites.router, prefix="/api/siemens-sites")
    with TestClient(app) as client:
        quick = client.post("/api/siemens-sites/quick-test", json={"tia_version": 17})
        assert quick.status_code == 200
        assert quick.json()["show"]["duration"] == 20
        assert quick.json()["mode"] == "simulated"
        response = client.post("/api/siemens-sites", json={"name": "New bench"})
        assert response.status_code == 200
        site = response.json()
        sid = site["id"]
        assert client.get("/api/siemens-sites/engineering/status").json()["available"] is True
        assert client.get(f"/api/siemens-sites/{sid}/engineering/status").json()["site_id"] == sid
        assert client.post(f"/api/siemens-sites/{sid}/engineering/generate", json={"revision": 1}).json()["stage"] == "project_generated"
        assert client.post(f"/api/siemens-sites/{sid}/engineering/compile", json={"revision": 1}).json()["stage"] == "compiled"
        assert client.post(f"/api/siemens-sites/{sid}/engineering/diagnostics", json={"revision": 1}).json()["online_state"] == "Offline"
        assert {item["name"] for item in client.get("/api/siemens-sites").json()["sites"]} >= {
            "TIA V17 PLCSIM Test - 20s", "New bench"}
        package = client.get(f"/api/siemens-sites/{sid}/tia-package")
        assert package.status_code == 200 and package.content.startswith(b"PK")
        clips = client.get(f"/api/siemens-sites/{sid}/example").json()["clips"]
        assert client.post(f"/api/siemens-sites/{sid}/compile", json={"revision": 1, "clips": clips}).status_code == 200
        site["channels"][1]["name"] = "Front left"
        update = client.put(f"/api/siemens-sites/{sid}", json=site)
        assert update.status_code == 200 and update.json()["revision"] == 2
        assert update.json()["show"] is None
        assert client.post(f"/api/siemens-sites/{sid}/compile", json={"revision": 1, "clips": clips}).status_code == 400
        assert client.post(f"/api/siemens-sites/{sid}/start").status_code == 400
        assert client.post(f"/api/siemens-sites/{sid}/verify").json()["quality"] == "SIMULATED_NOT_HARDWARE"
