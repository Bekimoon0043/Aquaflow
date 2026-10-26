import { describe, expect, it } from "vitest";
import { clockOf, isVfdPump, jetFlowLpm, jetHeadM, pumpCapLpm, pumpLoads, pumpRatedLpm } from "../pumpFlow";
import { pumpFlowDiagnostics } from "../pumpFlowCheck";
import { pumpFlowBudget } from "../aiDesignReview";
import { inventory } from "../../components/programmer/studio/showModel";
import { readFountainDesign } from "../../components/programmer/studio/fountainDesign";
import { followHardware } from "../../components/programmer/studio/hardwareFollow";
import { flowBudget, levelGrids, pumpPeaks } from "../../components/programmer/studio/showMetrics";
import { loadPumpFlowDiagnostics } from "../../preflight/preflight";

// Two pumps rated 450 L/min, eight 100 L/min jets each (800 L/min with every jet open):
// pump F runs at fixed speed, pump V on a VFD.
const jets = (pump, row) => Array.from({ length: 8 }, (_, i) => ({ id: `${pump}j${i}`, type: "nozzle_straight_dn25", label: `${pump} jet ${i}`, x: i, y: row,
  engineering: { jetHeightM: 3, flowLpm: 100, solenoidValveId: `${pump}v${i}`, pumpId: pump } }));
const valves = (pump, row) => Array.from({ length: 8 }, (_, i) => ({ id: `${pump}v${i}`, type: "valve_solenoid_dn25_24v", label: `${pump} valve ${i}`, x: i, y: row,
  engineering: { controlledFixtureId: `${pump}j${i}`, pumpId: pump } }));
const fixtures = [
  ...jets("F", 0), ...valves("F", 0), ...jets("V", 4), ...valves("V", 4),
  { id: "F", type: "pump_dry_centrifugal_7_5kw", label: "Pump F", x: -4, y: 0, engineering: { flowM3Hr: 27, headM: 20, servesValveIds: Array.from({ length: 8 }, (_, i) => `Fv${i}`) } },
  { id: "V", type: "pump_inline_vfd_pump_18_5kw", label: "Pump V", x: -4, y: 4, engineering: { flowLpm: 450, headM: 3, controlType: "VFD", servesValveIds: Array.from({ length: 8 }, (_, i) => `Vv${i}`) } },
];
const items = inventory(fixtures);
const design = readFountainDesign(items);
// Every jet asks for water 2–22 s.
const clips = fixtures.filter((f) => f.id.includes("j")).map((f) => ({ id: `r1:${f.id}:0`, studioRecipeId: "r1", fixtureId: f.id, type: "pump_speed", trackId: `${f.id}-t`,
  startTime: 2, duration: 20, value: 90 }));

describe("pump flow — data", () => {
  it("reads rated flow, jet flow (orifice law fallback), head and VFD", () => {
    expect(pumpRatedLpm(fixtures.find((f) => f.id === "F"))).toBe(450);       // 27 m³/h
    expect(jetFlowLpm({ engineering: { kFactor: 77.782, pressureBar: 0.246 } })).toBeCloseTo(38.58, 1);
    expect(jetHeadM({ engineering: { pressureBar: 1 } })).toBeCloseTo(10.2, 1);
    expect(isVfdPump(fixtures.find((f) => f.id === "V"))).toBe(true);
    expect(isVfdPump(fixtures.find((f) => f.id === "F"))).toBe(false);
    expect(pumpCapLpm(fixtures.find((f) => f.id === "F"), 90)).toBeCloseTo(405);
    expect(clockOf(157)).toBe("2:37");
  });

  it("per-pump load: all open vs rating, head check, show peak", () => {
    const loads = pumpLoads(design, { peaks: new Map([["F", { lpm: 420, t: 157 }]]) });
    const f = loads.find((l) => l.id === "F"), v = loads.find((l) => l.id === "V");
    expect(f).toMatchObject({ ratedLpm: 450, allOpenLpm: 800, allOpenPct: 178, allOpenOver: true, vfd: false, peakPct: 93, over: false, headOk: true });
    expect(v.headOk).toBe(false);                     // 3 m head < a 3 m jet + losses
    expect(pumpFlowBudget(design).find((p) => p.id === "F").over).toBe(178);
  });
});

describe("pump flow — the compiled show never asks a pump for more than its rating", () => {
  const out = followHardware(clips, items, new Map([["r1", "open"]]), design);
  const T = 30;

  it("caps every pump and reports what it changed", () => {
    const peaks = pumpPeaks(out.clips, design, { T });
    for (const id of ["F", "V"]) {
      expect(peaks.get(id).lpm).toBeLessThanOrEqual(450 * 1.02);
      expect(peaks.get(id).overS).toBe(0);
    }
    const f = out.flowCap.pumps.find((p) => p.id === "F"), v = out.flowCap.pumps.find((p) => p.id === "V");
    expect(out.flowCap.changed).toBe(true);
    expect(f).toMatchObject({ capLpm: 450, beforeLpm: 800, vfd: false });
    expect(f.skipped).toBeGreaterThan(0);
    expect(f.afterLpm).toBeLessThanOrEqual(450);
    expect(v.slowedS).toBeGreaterThan(0);             // the VFD pump slows a little …
    expect(v.afterLpm).toBeLessThanOrEqual(455);
    expect(out.flowCap.text.join(" ")).toMatch(/Pump F: asked up to 800 L\/min of 450/);
    // … and keeps more jets open than the fixed-speed pump.
    const openAt = (pump, t) => out.clips.filter((c) => c.type === "solenoid_open" && c.fixtureId.startsWith(`${pump}v`) && c.startTime <= t && c.startTime + c.duration > t).length;
    expect(openAt("V", 10)).toBeGreaterThan(openAt("F", 10));
    expect(openAt("F", 10)).toBeLessThanOrEqual(4);
  });

  it("a margin below 100 % lowers the cap", () => {
    const tight = followHardware(clips, items, new Map([["r1", "open"]]), design, { marginPct: 70 });
    const peaks = pumpPeaks(tight.clips, design, { T, marginPct: 70 });
    expect(peaks.get("F").lpm).toBeLessThanOrEqual(315 * 1.02);
    expect(tight.flowCap.pumps.find((p) => p.id === "F").capLpm).toBe(315);
  });

  it("the show gate fails the uncapped show and passes the capped one", () => {
    const ids = new Set(design.nozzles.map((n) => n.id));
    expect(flowBudget(levelGrids(clips, ids, T), design, { clips, T }).map((v) => v.id).sort()).toEqual(["F", "V"]);
    expect(flowBudget(levelGrids(out.clips, ids, T), design, { clips: out.clips, T })).toEqual([]);
  });
});

describe("pump flow — preflight", () => {
  it("flags a show that asks a pump for too much, with a fix that opens the pump", async () => {
    const diags = pumpFlowDiagnostics({ fixtures, clips });
    const over = diags.filter((d) => d.code === "pump-flow-over");
    expect(over.map((d) => d.engineeringItemId).sort()).toEqual(["F", "V"]);
    expect(over[0]).toMatchObject({ severity: "error", fix: { kind: "open_engineering_item" } });
    expect(over.find((d) => d.fixtureId === "F").message).toMatch(/Pump F is asked for 800 L\/min at 0:02 — 178 % of its rated 450 L\/min/);
    expect(diags.some((d) => d.code === "pump-flow-design" && d.severity === "info")).toBe(true);
    expect(diags.some((d) => d.code === "pump-head-low" && d.fixtureId === "V")).toBe(true);
    // The capped show passes.
    const capped = followHardware(clips, items, new Map([["r1", "open"]]), design).clips;
    expect(pumpFlowDiagnostics({ fixtures, clips: capped }).filter((d) => d.code === "pump-flow-over")).toEqual([]);
    // Through the preflight module (normalized Diagnostic shape).
    const merged = await loadPumpFlowDiagnostics({ fixtures, clips });
    expect(merged.find((d) => d.code === "pump-flow-over")).toMatchObject({ source: "pump-flow", fix: { kind: "open_engineering_item", target: expect.any(String) } });
  });
});
