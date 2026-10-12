import { describe, expect, it } from "vitest";
import { siemensEngineeringLayout, programmerSiemensClips, siemensEasyWorkflowState, siemensPackageName } from "./siemensSite";
import { generateAutoTracks } from "../runtime/autoTrackGenerator";

const site = { id: "siemens-test", name: "Bench", channels: [
  { id: "p1", kind: "pump", name: "Pump 1" },
  { id: "v1", kind: "valve", name: "Valve 1", pump_id: "p1" },
  { id: "l1", kind: "light", name: "Light 1" },
] };

describe("Siemens engineering/show integration", () => {
  it("gives the layout stable mapped IDs and links the nozzle to its outlet", () => {
    const layout = siemensEngineeringLayout(site);
    expect(layout.id).toBe(site.id);
    expect(layout.fixtures.find(f => f.type === "nozzle_geyser").linkedValveId).toBe("v1");
    expect(layout.fixtures.some(f => f.id === "p1")).toBe(true);
  });
  it("example clips land on the actual auto-generated pump and valve tracks", () => {
    const layout = siemensEngineeringLayout(site);
    const { tracks } = generateAutoTracks({ fixtures: layout.fixtures });
    const clips = programmerSiemensClips([
      { fixtureId: "p1", type: "pump_speed", startTime: 0, duration: 60, value: 30 },
      { fixtureId: "v1", type: "solenoid_open", startTime: 0, duration: 60, value: 100 },
      { fixtureId: "l1", type: "lighting_red", startTime: 0, duration: 60, value: 100 },
    ]);
    for (const clip of clips) {
      expect(tracks.some(t => t.id === clip.trackId && t.type === clip.type)).toBe(true);
      expect(clip.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it("keeps edited engineering positions when reopening the site", () => {
    const engineering = siemensEngineeringLayout(site);
    engineering.fixtures[0].x = 7;
    expect(siemensEngineeringLayout({ ...site, engineering }).fixtures[0].x).toBe(7);
  });
  it("names the portable TIA package and reports each easy-workflow gate honestly", () => {
    const mapped = {
      ...site,
      mode: "physical",
      tia: { version: 17 },
      plc: { ip: "192.168.0.200", port: 102, db: 100 },
      inputs: { estop_ok: "%I0.0", level_ok: "%I0.1", thermal_ok: "%I0.2", drive_ok: "%I0.3", pressure_ok: "%I0.4" },
      channels: [
        { ...site.channels[0], output: "%QW64", enable_output: "%Q0.0" },
        { ...site.channels[1], output: "%Q0.1" },
        { ...site.channels[2], output: "%QB100" },
      ],
      show: { duration: 12, clips: [{ fixtureId: "v1" }] },
    };
    expect(siemensPackageName({ ...mapped, name: "Main Plaza / Test" }))
      .toBe("AquaFlow-Main-Plaza-Test-TIA-V17-Commissioning.zip");
    expect(siemensEasyWorkflowState(mapped, false)).toEqual({
      patternReady: true, outputsMapped: true, safetyMapped: true, saved: true, connectionReady: true,
    });
    expect(siemensEasyWorkflowState({ ...mapped, mode: "plcsim" }, false).connectionReady).toBe(true);
    expect(siemensEasyWorkflowState({ ...mapped, show: null }, true)).toMatchObject({
      patternReady: false, saved: false,
    });
  });
});
