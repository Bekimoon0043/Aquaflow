// AF-NEXT-007 / AF-NEXT-008 — shared Diagnostic shape, hydraulic timeline sampling and the
// splash envelope (L-shaped basin with wind).
import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_KEYS, getHydraulicDiagnostics, getSplashDiagnostics, toDiagnostic,
} from "../showDiagnostics.js";
import {
  activeHydraulicDiagnostics, buildShowTimelinePayload, locateSample, sampleHydraulicTimeline,
} from "../showHydraulicsClient.js";
import {
  ADVISORY_LABEL, computeSplashEnvelope, createWaterTest, jetLanding, normalizeWind, projectBasins, testLanding,
} from "../splashEnvelope.js";

const L_BASIN = { id: "b1", outer: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }], holes: [] };
const jet = (id, x, y, h) => ({ id, type: "nozzle_straight_dn25", x, y, engineering: { jetHeightM: h, flowLpm: 82, pressureBar: 1.2 } });
const project = { fixtures: [jet("A", 8, 2, 8), jet("B", 2, 5, 1)], basins: [L_BASIN] };
const show = { clips: [
  { id: "clipA", fixtureId: "A", type: "device_intensity", startTime: 0, duration: 2, value: 100 },
  { id: "clipB", fixtureId: "B", type: "device_intensity", startTime: 0, duration: 2, value: 100 },
] };
const WIND_NORTHWARD_PLAN = { x: 0, y: 3 };   // blows toward +y (into the L's notch for jet A)

function expectShape(d) {
  expect(Object.keys(d).sort()).toEqual([...DIAGNOSTIC_KEYS].sort());
  expect(["error", "warning", "info"]).toContain(d.severity);
  expect(["hydraulics", "splash"]).toContain(d.source);
  expect(d.timeMs === null || typeof d.timeMs === "number").toBe(true);
  if (d.fix) {
    expect(["open_clip", "open_engineering_item", "open_panel"]).toContain(d.fix.kind);
    expect(typeof d.fix.target).toBe("string");
  }
}

const fakeTimeline = (diagnostics = [], nozzles = {}) => ({
  contract: "aquaflow-show-hydraulics", version: "1.0.0", durationMs: 2000, timesMs: [0, 1000, 2000],
  nozzles, pumps: {}, nominal: {}, solves: [], diagnostics, converged: true,
});

describe("shared Diagnostic shape", () => {
  it("hydraulic diagnostics are exactly the shared shape (extra backend keys dropped)", async () => {
    const backend = [
      { code: "PUMP_OVERLOAD", severity: "error", timeMs: 1200, endMs: 4000, fixtureId: "P1", clipId: "c1",
        engineeringItemId: "P1", message: "Pump P1 overloaded", fix: { kind: "open_engineering_item", target: "P1" }, source: "hydraulics" },
      { code: "PUMP_CURVE_ASSUMED", severity: "info", timeMs: null, fixtureId: "P1", clipId: null,
        engineeringItemId: "P1", message: "curve assumed", fix: null, source: "hydraulics" },
    ];
    let posted;
    const diags = await getHydraulicDiagnostics(project, show, { post: (path, body) => { posted = { path, body }; return fakeTimeline(backend); } });
    expect(posted.path).toBe("/hydraulics/show-timeline");
    expect(posted.body.project.fixtures).toHaveLength(2);
    expect(diags).toHaveLength(2);
    diags.forEach(expectShape);
    expect(diags[0]).toEqual({ code: "PUMP_OVERLOAD", severity: "error", timeMs: 1200, fixtureId: "P1", clipId: "c1",
      engineeringItemId: "P1", message: "Pump P1 overloaded", fix: { kind: "open_engineering_item", target: "P1" }, source: "hydraulics" });
  });

  it("an unreachable backend becomes one labelled warning, never an exception", async () => {
    const diags = await getHydraulicDiagnostics({ fixtures: [jet("Z", 0, 0, 2)] }, show, { post: () => Promise.reject(new Error("offline")) });
    expect(diags).toHaveLength(1);
    expectShape(diags[0]);
    expect(diags[0].code).toBe("HYDRAULICS_UNAVAILABLE");
  });

  it("toDiagnostic normalises bad fields", () => {
    const d = toDiagnostic({ code: "X", severity: "fatal", timeMs: "nope", fix: { kind: "explode", target: 1 } }, "splash");
    expectShape(d);
    expect(d).toMatchObject({ severity: "warning", timeMs: null, fix: null, fixtureId: null });
  });
});

describe("hydraulic timeline sampling", () => {
  const tl = fakeTimeline([{ code: "VALVE_CLOSED_UPSTREAM", severity: "warning", timeMs: 1000, endMs: 2000, fixtureId: "A" }], {
    A: { heightM: [0, 4, 8], demandHeightM: [8, 8, 8], exitVelocityMs: [0, 9, 12], flowLpm: [0, 60, 80], state: [1, 1, 3] },
  });
  it("interpolates within one state and steps across a state change", () => {
    expect(locateSample(tl.timesMs, 500)).toEqual({ i: 0, j: 1, w: 0.5 });
    expect(sampleHydraulicTimeline(tl, 500).A.heightM).toBeCloseTo(2);
    const s = sampleHydraulicTimeline(tl, 1500).A;
    expect(s.heightM).toBe(4);                      // state 1 → 3 between samples: hold the earlier
    expect(sampleHydraulicTimeline(tl, 2000).A.removed).toBe(true);
    expect(s.renderSpeedMs).toBeCloseTo(Math.sqrt(2 * 9.81 * 4));
  });
  it("lists the diagnostics active at the playhead", () => {
    expect(activeHydraulicDiagnostics(tl, 1500).map(d => d.code)).toEqual(["VALVE_CLOSED_UPSTREAM"]);
    expect(activeHydraulicDiagnostics(tl, 500)).toEqual([]);
  });
  it("sends only the hydraulic inputs (revision stable across unrelated edits)", () => {
    const p = buildShowTimelinePayload({ ...project, geometry: { type: "x" } }, { ...show, duration: 2 }, { rate_hz: 5 });
    expect(Object.keys(p.project)).toEqual(["fixtures", "params"]);
    expect(p.show.duration).toBe(2);
    expect(p.options.rate_hz).toBe(5);
  });
});

describe("splash envelope — L-shaped basin with wind", () => {
  const water = createWaterTest(projectBasins(project));

  it("uses the true L outline, not its bounding rectangle", () => {
    expect(water.contains(8, 2)).toBe(true);
    expect(water.contains(8, 8)).toBe(false);       // the notch is dry ground
    expect(water.contains(2, 8)).toBe(true);
  });

  it("wind pushes jet A into the notch; the spill is attributed to A and its clip", () => {
    const env = computeSplashEnvelope(project, show, { wind: WIND_NORTHWARD_PLAN, sampleStepMs: 500 });
    expect(env.advisory).toBe(ADVISORY_LABEL);
    expect(env.offendingNozzles).toEqual(["A"]);
    const r = env.report[0];
    expect(r).toMatchObject({ timeMs: 0, nozzleId: "A", clipId: "clipA", heightBasis: "nominal" });
    expect(r.endMs).toBe(2000);
    expect(r.landingPoint.y).toBeGreaterThan(4);    // landed in the notch (y > 4, x > 4)
    expect(r.landingPoint.x).toBeGreaterThan(4);
    expect(r.distanceOutsideM).toBeGreaterThan(0);
    expect(r.recommendedHeightM).toBeLessThan(8);
    expect(r.recommendedSpeedPct).toBeLessThan(100);
    expect(r.recommendation).toMatch(/Reduce jet height to/);
    // the recommended correction actually keeps the water in the basin
    const fixed = jetLanding({ x: 8, y: 2, heightM: r.recommendedHeightM }, WIND_NORTHWARD_PLAN);
    expect(testLanding(fixed, water).outside).toBe(false);
    // gust factor and nozzle uncertainty are visible assumptions
    const keys = env.assumptions.map(a => a.key);
    expect(keys).toEqual(expect.arrayContaining(["gustFactor", "nozzleUncertainty", "wind", "calibration"]));
    expect(env.assumptions.find(a => a.key === "gustFactor").value).toBe(1.4);
  });

  it("calm air keeps the vertical jets in the water; more gust spills further", () => {
    expect(computeSplashEnvelope(project, show, { wind: { x: 0, y: 0 } }).report).toEqual([]);
    const a = computeSplashEnvelope(project, show, { wind: WIND_NORTHWARD_PLAN, gustFactor: 1.0 }).report[0];
    const b = computeSplashEnvelope(project, show, { wind: WIND_NORTHWARD_PLAN, gustFactor: 2.0 }).report[0];
    expect(b.distanceOutsideM).toBeGreaterThan(a?.distanceOutsideM ?? 0);
  });

  it("an island (hole) is not water", () => {
    const withIsland = { ...project, basins: [{ ...L_BASIN, holes: [[{ x: 1, y: 6 }, { x: 3, y: 6 }, { x: 3, y: 8 }, { x: 1, y: 8 }]] }] };
    const env = computeSplashEnvelope(withIsland, show, { wind: { x: 0, y: 2 }, sampleStepMs: 1000 });
    expect(env.offendingNozzles).toContain("B");     // B's drift now lands on the island
  });

  it("engineering timeline heights replace nominal ones (a starved jet does not spill)", async () => {
    const tl = fakeTimeline([], {
      A: { heightM: [0.4, 0.4, 0.4], demandHeightM: [8, 8, 8], exitVelocityMs: [2, 2, 2], flowLpm: [10, 10, 10], state: [2, 2, 2] },
      B: { heightM: [1, 1, 1], demandHeightM: [1, 1, 1], exitVelocityMs: [4, 4, 4], flowLpm: [9, 9, 9], state: [1, 1, 1] },
    });
    const engineering = await getSplashDiagnostics(project, show, { wind: WIND_NORTHWARD_PLAN, timeline: tl });
    expect(engineering).toEqual([]);
    const nominal = await getSplashDiagnostics(project, show, { wind: WIND_NORTHWARD_PLAN, useHydraulics: false });
    expect(nominal.map(d => d.code)).toEqual(["SPLASH_NOMINAL_HEIGHTS", "SPLASH_OUTSIDE_BASIN"]);
    nominal.forEach(expectShape);
    const spill = nominal[1];
    expect(spill).toMatchObject({ source: "splash", fixtureId: "A", clipId: "clipA", timeMs: 0,
      fix: { kind: "open_clip", target: "clipA" } });
    expect(spill.message).toContain(ADVISORY_LABEL);
  });

  it("meteorological wind directions map onto the plan (north = −y)", () => {
    const w = normalizeWind({ speedMs: 4, fromDeg: 0 });  // from the north → blows toward +y
    expect(w.y).toBeCloseTo(4);
    expect(w.x).toBeCloseTo(0);
  });
});
