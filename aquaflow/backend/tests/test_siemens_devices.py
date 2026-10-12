"""Device model: design → devices → hardware addresses → TIA tags → show → PLCSIM-style acceptance."""
import asyncio
import io
import struct
import zipfile

import pytest

from engine import siemens_devices as dev
from engine.fake_s7_server import FakeS7Server
from engine.s7_client import S7Client
from engine.siemens_contract import (CONTRACT_VERSION, DB_SIZE, HEADER_SIZE, LIGHT_CAPACITY, MAGIC,
                                     PROGRAM_VERSION, PUMP_CAPACITY, VALVE_CAPACITY)
from engine.siemens_runtime import SiemensRuntime
from engine.siemens_site import SiteStore, compile_show, create_tia_plcsim_test, signature
from services.siemens_acceptance import AcceptanceRunner, AcceptanceStore
from services.siemens_tia_package import build_tia_package

DESIGN = [
    {"id": "pump-a", "type": "pump_submersible_3kw", "category": "Pumps", "label": "Main pump", "x": 0, "y": 0},
    {"id": "pump-b", "type": "pump_submersible_1_5kw", "category": "Pumps", "label": "Ring pump", "x": 10, "y": 0},
    {"id": "valve-1", "type": "valve_solenoid_dn25_24v", "category": "Valves", "label": "Centre valve",
     "x": 1, "y": 1, "supplyingPumpId": "pump-a"},
    {"id": "noz-1", "type": "nozzle_geyser", "category": "Nozzles", "label": "Geyser", "x": 1, "y": 2,
     "linkedValveId": "valve-1"},
    {"id": "noz-2", "type": "nozzle_jet", "category": "Nozzles", "label": "Ring jet 1", "x": 9, "y": 1},
    {"id": "light-1", "type": "light_rgb", "category": "Lights", "label": "Pool light", "x": 2, "y": 2},
    {"id": "estop", "type": "safety_emergency_stop", "category": "Safety", "label": "Emergency Stop Button"},
    {"id": "level", "type": "sensor_water_level", "category": "Sensors", "label": "Water Level Sensor"},
    {"id": "fog-1", "type": "fog_machine", "category": "Fog", "label": "Fogger"},
]
HARDWARE = {"cpu": "cpu_1215c_dcdcdc", "firmware": "V4.4", "signal_board": "",
            "modules": [{"catalog": "sm_1222_dq16", "slot": 2}]}


def designed_site():
    site, report = dev.site_from_design("Lobby fountain", DESIGN, hardware=HARDWARE)
    site, assignment = dev.assign_addresses(site, HARDWARE)
    assert assignment["complete"], assignment
    return site, report


def test_design_becomes_devices_without_replacing_the_layout():
    report = dev.design_devices(DESIGN)
    channels = {c["id"]: c for c in report["channels"]}
    # Real design ids are kept, so the Show Programmer clips land on the same devices.
    assert channels["pump-a"]["kind"] == "pump" and channels["pump-a"]["tag"] == "P01"
    # A nozzle near a placed valve shares it (the design placed valves).
    assert "noz-2" in channels["valve-1"]["nozzle_ids"]
    assert channels["valve-1"]["pump_id"] == "pump-a"
    # Ring pump feeds nothing → reported, not silently controlled.
    assert "pump-b" not in channels
    assert any("Ring pump" in note for note in report["notes"])
    assert report["safety_devices"] == {"estop_ok": "estop", "level_ok": "level"}
    assert [u["id"] for u in report["unsupported"]] == ["fog-1"]


def test_nozzles_without_valves_get_their_own_valve_and_nearest_pump():
    design = [{"id": "p", "category": "Pumps", "x": 0, "y": 0}, {"id": "p2", "category": "Pumps", "x": 20, "y": 0},
              {"id": "n1", "category": "Nozzles", "x": 1, "y": 0}, {"id": "n2", "category": "Nozzles", "x": 19, "y": 0}]
    channels = {c["id"]: c for c in dev.design_devices(design)["channels"]}
    assert channels["n1-valve"]["nozzle_ids"] == ["n1"] and channels["n1-valve"]["pump_id"] == "p"
    assert channels["n2-valve"]["pump_id"] == "p2"
    assert channels["n1-valve"]["fixture_id"] == ""


def test_default_tia_addresses_for_cpu_board_and_modules():
    points = dev.hardware_points({"cpu": "cpu_1212c_dcdcdc", "signal_board": "sb_1232_aq1",
                                  "modules": [{"catalog": "sm_1222_dq16", "slot": 2},
                                              {"catalog": "sm_1232_aq4", "slot": 3}]})
    by_type = {}
    for point in points:
        by_type.setdefault(point["type"], []).append(point["address"])
    assert by_type["DI"][:8] == [f"%I0.{b}" for b in range(8)]
    assert by_type["DQ"][:6] == [f"%Q0.{b}" for b in range(6)]
    assert by_type["DQ"][6:8] == ["%Q8.0", "%Q8.1"] and by_type["DQ"][-1] == "%Q9.7"
    assert by_type["AQ"] == ["%QW80", "%QW112", "%QW114", "%QW116", "%QW118"]


def test_g2_firmware_and_too_many_modules_are_refused():
    with pytest.raises(ValueError, match="V4"):
        dev.validate_hardware({"cpu": "cpu_1215c_dcdcdc", "firmware": "V1.0"})
    with pytest.raises(ValueError, match="at most 2"):
        dev.validate_hardware({"cpu": "cpu_1212c_dcdcdc", "modules": [
            {"catalog": "sm_1222_dq8", "slot": 2}, {"catalog": "sm_1222_dq8", "slot": 3},
            {"catalog": "sm_1222_dq8", "slot": 4}]})


def test_auto_assignment_wires_every_device_and_safety_input():
    site, _ = designed_site()
    channels = {c["id"]: c for c in site["channels"]}
    assert site["inputs"] == {"estop_ok": "%I0.0", "level_ok": "%I0.1", "thermal_ok": "%I0.2",
                              "drive_ok": "%I0.3", "pressure_ok": "%I0.4"}
    assert channels["pump-a"]["enable_output"] == "%Q0.0" and channels["pump-a"]["output"] == "%QW64"
    assert channels["valve-1"]["output"] == "%Q0.1"
    assert channels["pump-a"]["feedback_input"] == "%I0.5" and channels["pump-a"]["fault_input"] == "%I0.6"
    assert channels["light-1"]["output"] == "%QB200"
    points = dev.io_points(site)
    valve = next(p for p in points if p["role"] == "valve_open")
    assert valve["plc_tag"] == "V01_Open" and valve["module"] == "CPU 1215C DC/DC/DC"
    assert valve["db_address"] == "DB100.DBX112.0"


def test_1212c_without_analog_output_says_what_to_buy():
    site, _ = dev.site_from_design("Small", DESIGN[:4], hardware={"cpu": "cpu_1212c_dcdcdc"})
    _, report = dev.assign_addresses(site, {"cpu": "cpu_1212c_dcdcdc"})
    assert not report["complete"] and report["missing"] == {"AQ": 1}
    assert report["suggestions"][0]["add"] == "sb_1232_aq1"
    assert report["suggestions"][0]["order_number"] == "6ES7 232-4HA30-0XB0"


def test_reassigning_with_the_same_hardware_keeps_the_plc_program():
    site, _ = designed_site()
    again, report = dev.assign_addresses(site, HARDWARE)
    assert report["complete"] and signature(again) == signature(site)
    synced, sync_report = dev.sync_from_design(site, DESIGN)
    assert not sync_report["program_changed"] and not sync_report["added"]
    bigger = DESIGN + [{"id": "noz-3", "category": "Nozzles", "x": 30, "y": 30}]
    synced, sync_report = dev.sync_from_design(site, bigger)
    assert sync_report["added"] == [] and "noz-3" in next(c for c in synced["channels"] if c["id"] == "valve-1")["nozzle_ids"]


def test_tia_tag_table_round_trips_through_recognition():
    site, _ = designed_site()
    data = dev.tia_tag_table_xlsx(site)
    tags = dev.read_tag_table(data, "tags.xlsx")
    names = {t["name"]: t for t in tags}
    assert names["P01_Speed"]["address"] == "%QW64" and names["SAFE_EStopOK"]["address"] == "%I0.0"
    assert names["L01_Red"]["address"] == "%QB200" and names["L01_Blue"]["address"] == "%QB202"
    result = dev.suggest_mapping(site, tags)
    assert result["summary"]["recognised"] == len(tags) == result["summary"]["auto_accepted"]
    # Wipe the addresses, then rebuild them only from the recognised tag table.
    blank = {**site, "inputs": {}, "channels": [{**c, "output": "", "enable_output": "", "feedback_input": "",
                                                  "fault_input": ""} for c in site["channels"]]}
    rebuilt, applied = dev.apply_mapping(blank, [s for s in result["suggestions"] if s["accepted"]])
    assert signature(rebuilt) == signature(site)


def test_foreign_tag_names_are_recognised_with_reasons():
    tags = [{"name": "Pump1_SpeedRef", "address": "%QW64", "data_type": "Int", "comment": ""},
            {"name": "Pump1_Start", "address": "%Q0.0", "data_type": "Bool", "comment": ""},
            {"name": "VFD1_Trip", "address": "%I1.0", "data_type": "Bool", "comment": ""},
            {"name": "EmergencyStop", "address": "%I0.0", "data_type": "Bool", "comment": "E-stop chain"},
            {"name": "Y3", "address": "%Q0.3", "data_type": "Bool", "comment": "Solenoid valve nozzle 3"},
            {"name": "LevelTransmitter", "address": "%IW64", "data_type": "Int", "comment": "water level"},
            {"name": "Spare_1", "address": "%Q1.7", "data_type": "Bool", "comment": ""}]
    got = {t["name"]: dev.recognize_tag(t) for t in tags}
    assert got["Pump1_SpeedRef"]["role"] == "pump_speed" and got["Pump1_SpeedRef"]["number"] == 1
    assert got["Pump1_Start"]["role"] == "pump_run"
    assert got["VFD1_Trip"]["role"] == "pump_fault"
    assert got["EmergencyStop"]["safety"] == "estop_ok"
    assert got["Y3"]["role"] == "valve_open" and got["Y3"]["number"] == 3
    assert got["LevelTransmitter"]["role"] == "" and "Analog" in got["LevelTransmitter"]["reason"]
    assert got["Spare_1"]["role"] == "" and got["Spare_1"]["reason"]


def test_show_on_nozzles_becomes_valve_and_pump_commands():
    site, _ = designed_site()
    clips = [
        {"fixtureId": "noz-1", "type": "pump_speed", "startTime": 0, "duration": 4, "value": 80, "fadeIn": 1},
        {"fixtureId": "noz-2", "type": "device_intensity", "startTime": 4.2, "duration": .2, "value": 50},
        {"fixtureId": "noz-1", "type": "pump_speed", "startTime": 10, "duration": 2, "value": 0},
        {"fixtureId": "light-1", "type": "lighting_red", "startTime": 0, "duration": 5, "value": 100},
        {"fixtureId": "fog-1", "type": "fog_density", "startTime": 0, "duration": 5, "value": 100},
    ]
    out, report = dev.translate_show(site, clips)
    valve = [c for c in out if c["fixtureId"] == "valve-1"]
    # 0-4 s and 4.2-4.7 s (stretched to the 500 ms minimum) merge: the gap is below the minimum off time.
    assert valve == [{"fixtureId": "valve-1", "type": "solenoid_open", "startTime": 0, "duration": 4.7,
                      "value": 100, "fadeIn": 0, "fadeOut": 0}]
    pump = [c for c in out if c["fixtureId"] == "pump-a"]
    assert pump[0]["value"] == 30 and pump[0]["duration"] == 4.7
    assert report["stretched"] == 1 and report["merged"] == 1 and report["ignored_devices"] == ["fog-1"]
    show = compile_show(site, out)
    assert show["duration"] == 5


def test_tia_package_and_old_sites_are_unchanged():
    old = create_tia_plcsim_test()
    before = signature(old)
    assert dev.io_points(old)[0]["plc_tag"] == "P01_Speed"
    with zipfile.ZipFile(io.BytesIO(build_tia_package(old))) as archive:
        assert "AquaFlowSiteIO.db" in archive.namelist()
    assert signature(old) == before


# ── PLCSIM-style acceptance against a fake PLC that runs the generated FB's logic ──

class SiteFB:
    """Python twin of AquaFlowSiteControl (100 ms cyclic): handshake, Ready/Running, watchdog, feedback."""

    def __init__(self, server, db=100):
        self.server, self.db = server, db
        self.last, self.missed, self.ready, self.running = 0, 10, False, False
        self.local = True

    def cycle(self):
        s, db = self.server, self.db
        s.tick_heartbeat(db, 16)
        s.set_word(db, 20, 0x3F if self.local else 0)
        seq, flags = s.get_word(db, 26), s.get_word(db, 28)
        if seq != self.last and not flags & 0x8000:
            self.last, self.missed = seq, 0
            if not flags & 1:
                self.running, self.ready = False, self.local
            else:
                self.running = self.ready and self.local
                s.set_word(db, 30, 0 if self.running else 2)
        elif self.missed < 300:
            self.missed += 1
        if not self.local or self.missed >= 10:
            self.running = self.ready = False
        fault = 1 if not self.local else 2 if self.missed >= 10 else 0
        s.set_word(db, 22, fault)
        status = (self.running and 1) | (self.ready and 2) | (self.missed < 10 and 4) | (fault and 0x10)
        s.set_word(db, 6, int(status))
        struct.pack_into(">I", s.dbs[db], 44, self.missed * 100)
        bank = s.dbs[db]
        if self.running:
            bank[272:304] = bank[64:96]
            bank[304] = sum(1 << i for i in range(16) if struct.unpack_from(">H", bank, 64 + 2 * i)[0])
            bank[308:372] = bank[112:176]
            bank[372:468] = bank[176:272]
        else:
            bank[272:472] = bytes(200)
        s.set_word(db, 24, self.last)
        s.set_word(db, 32, self.last)


def test_plcsim_acceptance_proves_devices_watchdog_and_stop(tmp_path):
    async def scenario():
        site, _ = designed_site()
        site.update(mode="plcsim")
        site["plc"]["ip"] = "192.0.2.10"
        store = SiteStore(tmp_path / "sites.json")
        site = store.save(site)
        server = FakeS7Server()
        server.dbs[100] = bytearray(DB_SIZE)
        struct.pack_into(">HHHHII", server.dbs[100], 0, MAGIC, CONTRACT_VERSION, HEADER_SIZE, 0,
                         signature(site), PROGRAM_VERSION)
        struct.pack_into(">HH", server.dbs[100], 34, 100, PUMP_CAPACITY)
        struct.pack_into(">HH", server.dbs[100], 38, VALVE_CAPACITY, LIGHT_CAPACITY)
        await server.start()
        fb = SiteFB(server)

        async def plc():
            while True:
                fb.cycle()
                await asyncio.sleep(.1)
        cycle = asyncio.create_task(plc())
        runtime = SiemensRuntime(store, permit=lambda: True,
                                 client_factory=lambda host, **kw: S7Client("127.0.0.1", port=server.port, timeout=.3))
        runner = AcceptanceRunner(runtime, store, AcceptanceStore(tmp_path / "acceptance.json"))
        try:
            with pytest.raises(ValueError, match="Confirm"):
                runner.start(site["id"])
            runner.start(site["id"], seconds=1, flow_path_confirmed=True)
            await runner.jobs[site["id"]]["task"]
            record = runner.progress(site["id"])["record"]
            assert [s["name"] for s in record["steps"]] == [
                "Verify PLC program and connection", "Valve: Centre valve", "Light: Pool light",
                "Communication-loss watchdog", "Everything OFF at the end"]
            assert record["passed"]
            assert "plc_applied" in record["steps"][1]["data"]["source"]
            assert server.dbs[100][64:272] == bytes(208)
            assert runner.records.all(site["id"])[-1]["mode"] == "plcsim"
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()

    asyncio.run(scenario())


def test_watchdog_failure_is_reported_not_hidden(tmp_path):
    async def scenario():
        site, _ = designed_site()
        site.update(mode="plcsim")
        site["plc"]["ip"] = "192.0.2.10"
        store = SiteStore(tmp_path / "sites.json")
        site = store.save(site)
        server = FakeS7Server()
        server.dbs[100] = bytearray(DB_SIZE)
        struct.pack_into(">HHHHII", server.dbs[100], 0, MAGIC, CONTRACT_VERSION, HEADER_SIZE, 0,
                         signature(site), PROGRAM_VERSION)
        struct.pack_into(">HHHH", server.dbs[100], 34, 100, PUMP_CAPACITY, VALVE_CAPACITY, LIGHT_CAPACITY)
        await server.start()
        fb = SiteFB(server)
        fb_cycle = fb.cycle

        def broken_watchdog():
            fb_cycle()
            fb.missed = 0  # a PLC program whose watchdog never expires
            server.set_word(100, 22, 0)
            server.set_word(100, 6, server.get_word(100, 6) | 4)
        fb.cycle = broken_watchdog

        async def plc():
            while True:
                fb.cycle()
                await asyncio.sleep(.1)
        cycle = asyncio.create_task(plc())
        runtime = SiemensRuntime(store, permit=lambda: True,
                                 client_factory=lambda host, **kw: S7Client("127.0.0.1", port=server.port, timeout=.3))
        try:
            await runtime.verify(site["id"])
            result = await runtime.watchdog_probe(site["id"], True)
            assert result["tripped"] is False
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()

    asyncio.run(scenario())


def test_live_monitor_reads_the_plc_without_writing(tmp_path):
    async def scenario():
        site, _ = designed_site()
        site.update(mode="plcsim")
        site["plc"]["ip"] = "192.0.2.10"
        store = SiteStore(tmp_path / "sites.json")
        site = store.save(site)
        server = FakeS7Server()
        server.dbs[100] = bytearray(DB_SIZE)
        struct.pack_into(">HHHHII", server.dbs[100], 0, MAGIC, CONTRACT_VERSION, HEADER_SIZE, 0,
                         signature(site), PROGRAM_VERSION)
        struct.pack_into(">HHHH", server.dbs[100], 34, 100, PUMP_CAPACITY, VALVE_CAPACITY, LIGHT_CAPACITY)
        await server.start()
        fb = SiteFB(server)

        async def plc():
            while True:
                fb.cycle()
                await asyncio.sleep(.1)
        cycle = asyncio.create_task(plc())
        runtime = SiemensRuntime(store, permit=lambda: True,
                                 client_factory=lambda host, **kw: S7Client("127.0.0.1", port=server.port, timeout=.3))
        try:
            assert (await runtime.peek(site["id"]))["source"] == "not_connected"
            await runtime.verify(site["id"])
            writes = server.writes
            first = await runtime.peek(site["id"])
            await asyncio.sleep(.35)
            second = await runtime.peek(site["id"])
            assert first["source"] == "plc" and second["header"]["plc_heartbeat"] != first["header"]["plc_heartbeat"]
            assert set(second["feedback"]) == {c["id"] for c in site["channels"]}
            assert server.writes == writes  # monitoring never writes
            await runtime.test_device(site["id"], "valve-1", 1.5, True)
            await asyncio.sleep(.4)
            during = await runtime.peek(site["id"])
            assert during["source"] == "last_frame" and during["feedback"]["valve-1"]["open"]
            await runtime.tasks[site["id"]]
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()

    asyncio.run(scenario())


def test_compile_route_explains_a_timeline_from_another_design(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from fastapi import FastAPI
    import api.routes.siemens_sites as routes
    store = SiteStore(tmp_path / "sites.json")
    monkeypatch.setattr(routes, "store", store)
    monkeypatch.setattr(routes.siemens_runtime, "store", store)
    site, _ = designed_site()
    site = store.save(site)
    app = FastAPI(); app.include_router(routes.router, prefix="/api/siemens-sites")
    client = TestClient(app)
    foreign = [{"fixtureId": "other-design-jet", "type": "device_intensity", "startTime": 0, "duration": 2, "value": 50}]
    response = client.post(f"/api/siemens-sites/{site['id']}/compile", json={"revision": site["revision"], "clips": foreign, "translate": True})
    assert response.status_code == 400 and "None of the 1 timeline clips" in response.json()["detail"]
    ours = [{"fixtureId": "noz-1", "type": "device_intensity", "startTime": 0, "duration": 2, "value": 50}]
    response = client.post(f"/api/siemens-sites/{site['id']}/compile", json={"revision": site["revision"], "clips": ours, "translate": True})
    assert response.status_code == 200 and response.json()["translation"]["nozzle_clips"] == 1


def test_cpu_generations_are_told_apart_by_order_number():
    from engine.siemens_hardware import classify_s7_1200, supported_s7_1200_identifier
    assert classify_s7_1200("6ES7 214-1AG40-0XB0")["generation"] == "G1"  # 1214C uses -1AG40
    assert classify_s7_1200("6ES7 215-1AG40-0XB0")["supported"]
    g2 = classify_s7_1200("6ES7 212-1AG50-0XB0")
    assert g2["generation"] == "G2" and not g2["supported"] and "order number" in g2["message"]
    assert classify_s7_1200("6ES7 214-1AF40-0XB0")["generation"] == "F"
    assert classify_s7_1200("6ES7 511-1AK02-0AB0")["generation"] == "S7-1500"
    assert supported_s7_1200_identifier("OrderNumber:6ES7 214-1AG40-0XB0/V4.6")
    assert not supported_s7_1200_identifier("OrderNumber:6ES7 212-1AG50-0XB0/V4.1")
    with pytest.raises(ValueError, match="G2"):
        dev.validate_hardware({"cpu": "cpu_1215c_dcdcdc", "firmware": "V1.0"})


# ── S7-1500 / ET 200SP on the same S7comm contract ────────────────────────────

S1500 = {"cpu": "cpu_1511c_1pn", "firmware": "V3.1", "modules": [{"catalog": "s1500_dq16", "slot": 2}]}


def test_s7_1500_compact_and_et200sp_addresses_follow_tia_numbering():
    points = {p["address"]: p for p in dev.hardware_points(S1500)}
    assert points["%QW0"]["module"] == "CPU 1511C-1 PN (compact)" and "%QW2" in points
    assert points["%I10.0"]["type"] == "DI" and points["%Q4.0"]["type"] == "DQ"
    assert points["%Q6.0"]["module"].startswith("DQ 16x24VDC") and points["%Q7.7"]["channel"] == 15
    sp = dev.hardware_points({"cpu": "cpu_1510sp_1pn", "modules": [{"catalog": "sp_dq8", "slot": 2},
                                                                  {"catalog": "sp_aq2", "slot": 3}]})
    assert [p["address"] for p in sp if p["type"] == "AQ"] == ["%QW1", "%QW3"]


def test_s7_1500_family_rules():
    with pytest.raises(ValueError, match="does not fit"):
        dev.validate_hardware({"cpu": "cpu_1511_1pn", "modules": [{"catalog": "sm_1222_dq16", "slot": 2}]})
    with pytest.raises(ValueError, match="Signal boards exist only"):
        dev.validate_hardware({"cpu": "cpu_1511_1pn", "signal_board": "sb_1232_aq1"})
    assert dev.validate_hardware({"cpu": "cpu_1511_1pn"})["firmware"] == "V3.1"


def test_design_on_s7_1500_assigns_everything_and_suggests_its_own_modules():
    site, _ = dev.site_from_design("1500 lobby", DESIGN, hardware=S1500)
    site, report = dev.assign_addresses(site, S1500)
    assert report["complete"]
    channels = {c["id"]: c for c in site["channels"]}
    assert channels["pump-a"]["output"] == "%QW0" and channels["pump-a"]["enable_output"] == "%Q4.0"
    assert site["inputs"]["estop_ok"] == "%I10.0"
    bare = {"cpu": "cpu_1511_1pn"}
    site2, _ = dev.site_from_design("bare", DESIGN, hardware=bare)
    _, report2 = dev.assign_addresses(site2, bare)
    assert not report2["complete"]
    assert {s["add"] for s in report2["suggestions"]} == {"s1500_aq4", "s1500_dq16", "s1500_di16"}


def test_s7_1500_site_is_a_generator_target_and_exports_a_tia_package():
    from services.siemens_readiness import commissioning_readiness
    site, _ = dev.site_from_design("1500 lobby", DESIGN, hardware=S1500)
    site, _ = dev.assign_addresses(site, S1500)
    cpu_check = next(c for c in commissioning_readiness(site)["checks"] if c["code"] == "cpu")
    assert cpu_check["state"] == "review" and "S7-1500" in cpu_check["detail"]
    with zipfile.ZipFile(io.BytesIO(build_tia_package(site))) as archive:
        assert "PLC-Tags-for-TIA-import.xlsx" in archive.namelist()


def test_s7_1500_site_passes_the_acceptance_run(tmp_path):
    async def scenario():
        site, _ = dev.site_from_design("1500 lobby", DESIGN, hardware=S1500)
        site, _ = dev.assign_addresses(site, S1500)
        site.update(mode="plcsim")
        site["plc"]["ip"] = "192.0.2.10"
        store = SiteStore(tmp_path / "sites.json")
        site = store.save(site)
        server = FakeS7Server()
        server.dbs[100] = bytearray(DB_SIZE)
        struct.pack_into(">HHHHII", server.dbs[100], 0, MAGIC, CONTRACT_VERSION, HEADER_SIZE, 0,
                         signature(site), PROGRAM_VERSION)
        struct.pack_into(">HHHH", server.dbs[100], 34, 100, PUMP_CAPACITY, VALVE_CAPACITY, LIGHT_CAPACITY)
        await server.start()
        fb = SiteFB(server)

        async def plc():
            while True:
                fb.cycle()
                await asyncio.sleep(.1)
        cycle = asyncio.create_task(plc())
        runtime = SiemensRuntime(store, permit=lambda: True,
                                 client_factory=lambda host, **kw: S7Client("127.0.0.1", port=server.port, timeout=.3))
        runner = AcceptanceRunner(runtime, store, AcceptanceStore(tmp_path / "acceptance.json"))
        try:
            runner.start(site["id"], seconds=1, flow_path_confirmed=True)
            await runner.jobs[site["id"]]["task"]
            assert runner.progress(site["id"])["record"]["passed"]
        finally:
            await runtime.close(); cycle.cancel(); await server.stop()

    asyncio.run(scenario())


def test_s7_1500_cpu_recognition():
    from engine.siemens_hardware import classify_s7_1200, supported_s7_identifier
    assert classify_s7_1200("6ES7 511-1AL03-0AB0")["generation"] == "S7-1500"
    assert classify_s7_1200("6ES7 510-1DK03-0AB0")["generation"] == "ET 200SP CPU"
    assert classify_s7_1200("6ES7 513-1FM03-0AB0")["generation"] == "F"
    assert classify_s7_1200("6ES7 515-2RM00-0AB0")["generation"] == "R/H"
    assert supported_s7_identifier("OrderNumber:6ES7 512-1CM03-0AB0/V3.1")
    assert not supported_s7_identifier("OrderNumber:6ES7 513-1FM03-0AB0/V3.1")
