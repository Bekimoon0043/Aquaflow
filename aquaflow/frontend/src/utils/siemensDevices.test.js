import { describe, expect, it } from "vitest";
import {
  GLOSSARY, WIZARD_STEPS, designSummary, engineeringDevices, groupPoints, livePointValue, missingRequired,
  wiringSheetHtml, wizardProgress,
} from "./siemensDevices";
import { compileMessage } from "../components/programmer/SiemensShowControls";
import { pointsForFixture } from "../components/panels/siemens/SiemensFixtureLink";
import { hardwareCapacity } from "../components/panels/siemens/SiemensHardwarePicker";
import { targetOptions } from "../components/panels/siemens/SiemensTagImport";

const POINTS = [
  { device_id: "p1", kind: "pump", device_name: "Main pump", tag: "P01", role: "pump_speed", label: "Speed", required: true, address: "%QW64", plc_tag: "P01_Speed", module: "CPU 1215C DC/DC/DC", module_channel: 0, direction: "output", nozzle_ids: [], pump_id: "", fixture_id: "p1" },
  { device_id: "p1", kind: "pump", device_name: "Main pump", tag: "P01", role: "pump_fault", label: "Fault", required: false, address: "", plc_tag: "P01_Fault", direction: "input", nozzle_ids: [], pump_id: "", fixture_id: "p1" },
  { device_id: "v1", kind: "valve", device_name: "Valve <1>", tag: "V01", role: "valve_open", label: "Open", required: true, address: "", plc_tag: "V01_Open", direction: "output", nozzle_ids: ["n1", "n2"], pump_id: "p1", fixture_id: "" },
  { device_id: "safety:estop_ok", kind: "safety", device_name: "Emergency stop", tag: "SAFE", role: "estop_ok", label: "E-stop", required: true, address: "%I0.0", plc_tag: "SAFE_EStopOK", direction: "input", nozzle_ids: [], pump_id: "", fixture_id: "" },
];

describe("Siemens device model helpers", () => {
  it("sends design items with their library category and never guesses unknown types", () => {
    const devices = engineeringDevices([
      { id: "a", type: "pump_submersible_3kw", x: 1, y: 2 },
      { id: "b", type: "nozzle_straight_dn15", linkedValveId: "v" },
      { id: "c", type: "something_custom" },
      { id: "", type: "pump_submersible_3kw" },
    ]);
    expect(devices.map(d => [d.id, d.category])).toEqual([["a", "Pumps"], ["b", "Nozzles"], ["c", ""]]);
    expect(devices[1].linkedValveId).toBe("v");
    expect(designSummary([{ id: "a", type: "pump_submersible_3kw" }, { id: "b", type: "light_rgb_x" }, { id: "c", type: "fog_x" }]))
      .toMatchObject({ pumps: 1, lights: 1, other: 1 });
  });

  it("explains every Siemens term used in the wizard", () => {
    for (const key of ["putget", "rackslot", "db", "nonoptimized", "watchdog", "heartbeat", "s71200", "analog"]) {
      expect(GLOSSARY[key][1].length).toBeGreaterThan(40);
    }
    expect(WIZARD_STEPS.map(s => s.key)).toEqual(["design", "hardware", "wiring", "export", "connect", "test", "run"]);
  });

  it("tracks wizard progress from the saved site", () => {
    const site = { channels: [{ kind: "pump", output: "%QW64", enable_output: "%Q0.0" }, { kind: "valve", output: "%Q0.1" }],
      inputs: { estop_ok: "%I0.0", level_ok: "%I0.1", thermal_ok: "%I0.2", drive_ok: "%I0.3", pressure_ok: "%I0.4" }, hardware: {} };
    expect(wizardProgress(site)).toMatchObject({ design: true, hardware: true, wiring: true, connect: false, test: false });
    expect(wizardProgress({ ...site, inputs: {} }).wiring).toBe(false);
    expect(wizardProgress(site, { status: { verified: true, hardware_verified: true }, acceptance: { passed: true } })).toMatchObject({ connect: true, test: true });
  });

  it("shows live values only from real data", () => {
    expect(livePointValue(POINTS[0], null)).toBeNull();
    expect(livePointValue(POINTS[0], { values: { p1: 30 } })).toEqual({ on: true, text: "30%" });
    expect(livePointValue(POINTS[1], { feedback_valid: false, feedback: { p1: { fault: true } } })).toBeNull();
    expect(livePointValue(POINTS[1], { feedback_valid: true, feedback: { p1: { fault: true } } })).toMatchObject({ alarm: true, text: "FAULT" });
    expect(livePointValue(POINTS[3], { hardware_verified: true, permit_bits: 0b11 })).toEqual({ on: true, text: "OK" });
    expect(livePointValue(POINTS[3], { hardware_verified: true, permit_bits: 0b01 })).toEqual({ on: false, text: "NOT OK" });
    expect(livePointValue(POINTS[3], { hardware_verified: false, permit_bits: 0b11 })).toBeNull();
  });

  it("groups points by device and finds unwired required signals", () => {
    const groups = groupPoints(POINTS);
    expect(groups.pump[0].points).toHaveLength(2);
    expect(groups.valve[0].nozzleIds).toEqual(["n1", "n2"]);
    expect(missingRequired(POINTS).map(p => p.plc_tag)).toEqual(["V01_Open"]);
  });

  it("prints a wiring sheet grouped by module, with text escaped", () => {
    const html = wiringSheetHtml({ name: "Lobby", revision: 3, plc: { db: 100 } }, POINTS, [{ position: "slot 1", item: "CPU 1215C", order_number: "6ES7 215-1AG40-0XB0" }]);
    expect(html).toContain("<h2>CPU 1215C DC/DC/DC</h2>");
    expect(html).toContain("<h2>NOT WIRED</h2>");
    expect(html).toContain("Valve &lt;1&gt;");
    expect(html).toContain("6ES7 215-1AG40-0XB0");
  });

  it("links an Engineering item to its tags, directly or through its valve", () => {
    expect(pointsForFixture(POINTS, "p1").direct).toHaveLength(2);
    expect(pointsForFixture(POINTS, "n2").viaValve.map(p => p.plc_tag)).toEqual(["V01_Open"]);
    expect(pointsForFixture(POINTS, "nobody")).toEqual({ direct: [], viaValve: [] });
  });

  it("explains a translated compile in plain words", () => {
    const text = compileMessage({ clips: [1, 2, 3], duration: 12, translation: { nozzle_clips: 4, auto_pumps: [{ pump: "Main pump", percent: 30 }], stretched: 1, merged: 0, capped: 0, ignored: 2 } });
    expect(text).toContain("Compiled 3 PLC commands (12.0 s)");
    expect(text).toContain("4 nozzle clip(s) became valve open/close commands");
    expect(text).toContain("Main pump runs at 30% while its nozzles play");
    expect(text).toContain("2 clip(s) on devices the PLC does not drive were skipped");
    expect(compileMessage({ clips: [1], duration: 1 })).toBe("Compiled 1 PLC commands (1.0 s).");
  });

  it("sums hardware capacity and offers only matching devices for imported tags", () => {
    const catalog = [{ id: "cpu", di: 14, dq: 10, ai: 2, aq: 2 }, { id: "sb", aq: 1 }, { id: "sm", dq: 16 }];
    expect(hardwareCapacity({ cpu: "cpu", signal_board: "sb", modules: [{ catalog: "sm" }, { catalog: "sm" }] }, catalog))
      .toEqual({ di: 14, dq: 42, ai: 2, aq: 3 });
    const site = { channels: [{ id: "p", kind: "pump", name: "Pump", tag: "P01" }, { id: "v", kind: "valve", name: "Valve", tag: "V01" }] };
    expect(targetOptions(site, { role: "pump_run" })).toEqual([["p", "P01 Pump"]]);
    expect(targetOptions(site, { role: "safety" })[0]).toEqual(["safety:estop_ok", "Emergency stop OK"]);
  });
});

import { addressOnThisPc, explainS7Error } from "./siemensDevices";

describe("Siemens connection help", () => {
  const plcsim = { mode: "plcsim", plc: { ip: "192.168.43.41", port: 102, db: 100 } };
  it("explains the NetToPLCsim hang-up seen on this PC", () => {
    expect(explainS7Error("Cannot establish a validated S7 connection: transport error: IncompleteReadError('0 bytes read on a total of 4 expected bytes')", plcsim))
      .toMatch(/NetToPLCsim .*Stop Server and Start Server/);
  });
  it("explains wrong address, wrong program and stopped CPU", () => {
    expect(explainS7Error("[WinError 10061] connection refused", plcsim)).toMatch(/Nothing is listening at 192.168.43.41:102/);
    expect(explainS7Error("timed out", plcsim)).toMatch(/different Wi-Fi/);
    expect(explainS7Error("PLC program/DB does not match this site's exported TIA package", plcsim)).toMatch(/DB100/);
    expect(explainS7Error("PLC heartbeat is not moving; check the 100-ms cyclic block call", plcsim)).toMatch(/RUN/);
    expect(explainS7Error("something new", plcsim)).toBe("");
  });
  it("knows whether an address belongs to this PC", () => {
    expect(addressOnThisPc("192.168.43.41", [{ ip: "192.168.43.41" }])).toBe(true);
    expect(addressOnThisPc("192.168.0.144", [{ ip: "192.168.43.41" }])).toBe(false);
  });
});

import { commandText, feedbackText } from "../components/panels/siemens/SiemensPlcMonitor";

describe("PLC live monitor text", () => {
  it("shows commands and PLC feedback like a watch table", () => {
    expect(commandText({ kind: "valve" }, 100)).toBe("OPEN");
    expect(commandText({ kind: "pump" }, 30)).toBe("30%");
    expect(commandText({ kind: "light" }, { red: 255, green: 0, blue: 9 })).toBe("RGB 255/0/9");
    expect(commandText({ kind: "pump" }, undefined)).toBe("—");
    expect(feedbackText({}, { kind: "pump", running: true, applied_percent: 10, fault: false })).toBe("RUNNING 10%");
    expect(feedbackText({}, { kind: "valve", open: false })).toBe("CLOSED");
    expect(feedbackText({}, null)).toBe("—");
  });
});

import { firmwareFor, freeSlot } from "../components/panels/siemens/SiemensHardwarePicker";

describe("hardware picker families", () => {
  it("offers firmware and slots per CPU family", () => {
    expect(firmwareFor("s7-1200")).toContain("V4.4");
    expect(firmwareFor("s7-1500")).toContain("V3.1");
    expect(freeSlot({ family: "s7-1200" }, [2, 3, 4, 5, 6, 7, 8, 9].map(slot => ({ slot })))).toBeNull();
    expect(freeSlot({ family: "s7-1500", max_modules: 30 }, [2, 3, 4, 5, 6, 7, 8, 9].map(slot => ({ slot })))).toBe(10);
    expect(freeSlot({ family: "et200sp", max_modules: 64 }, [])).toBe(2);
  });
});
