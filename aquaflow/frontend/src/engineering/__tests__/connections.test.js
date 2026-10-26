import { describe, expect, it } from "vitest";
import {
  applyLinks, autoPairLights, autoPumps, autoValves, connectionProblems, connectToPump, connectValve, defaultSolenoidType,
  disconnectValve, pairLights, problemGroups, readConnections, setNozzleValve, setValveNozzle,
} from "../connections";
import { inventory } from "../../components/programmer/studio/showModel";
import { readFountainDesign } from "../../components/programmer/studio/fountainDesign";
import { groupConflicts } from "../../components/programmer/studio/groupAdvisor";

// Six jets in a row, valves 0–3 (valve 3 not linked yet), two pumps, three lights.
const jets = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `jet${i}`, type: "nozzle_straight_dn25", label: `Jet ${i}`, x: i * 2, y: 0, zone: i < 3 ? "left" : "right",
  engineering: { jetHeightM: 3, flowLpm: 100, connectionSize: "DN25", ...(i < 3 ? { solenoidValveId: `valve${i}`, pumpId: "pumpA" } : {}) } }));
const valves = [0, 1, 2, 3].map((i) => ({ id: `valve${i}`, type: "valve_solenoid_dn25_24v", label: `Valve ${i}`, x: i * 2, y: 0.1,
  engineering: i < 3 ? { controlledFixtureId: `jet${i}`, pumpId: "pumpA" } : {} }));
const pumps = [
  { id: "pumpA", type: "pump_inline_vfd_pump_18_5kw", label: "Pump A", x: -5, y: 5, engineering: { flowLpm: 250, headM: 20, controlType: "VFD", servesValveIds: ["valve0", "valve1", "valve2"] } },
  { id: "pumpB", type: "pump_dry_centrifugal_7_5kw", label: "Pump B", x: 15, y: 5, engineering: { flowLpm: 400, headM: 20, servesValveIds: [] } },
];
const lights = [0, 1, 2].map((i) => ({ id: `light${i}`, type: "light_uw_rgb_18w", label: `Light ${i}`, x: i * 2 + 0.2, y: 0,
  engineering: i === 0 ? { pairedNozzleId: "jet0" } : {} }));
const base = [...jets, ...valves, ...pumps, ...lights];
const read = (fixtures) => readFountainDesign(inventory(fixtures));
const byId = (fixtures, id) => fixtures.find((f) => f.id === id);

describe("connections — link editing round trip", () => {
  it("connects nozzles to a pump on both sides and readFountainDesign reads it back", () => {
    const next = connectToPump(base, ["jet3", "jet4"], "pumpB");
    const d = read(next);
    expect(d.nozzleById.get("jet3").pumpId).toBe("pumpB");
    expect(d.nozzleById.get("jet4").pumpId).toBe("pumpB");
    expect(d.pumps.get("pumpB").nozzleIds).toEqual(["jet3", "jet4"]);
    expect(byId(next, "jet3").engineering.pumpId).toBe("pumpB");
    // Untouched fixtures keep their identity (one small history delta).
    expect(byId(next, "jet0")).toBe(byId(base, "jet0"));
    expect(byId(next, "valve0")).toBe(byId(base, "valve0"));
  });

  it("moves a valved jet to another pump: nozzle, valve and both pump lists change together", () => {
    const next = connectToPump(base, ["valve2"], "pumpB");
    expect(byId(next, "jet2").engineering.pumpId).toBe("pumpB");
    expect(byId(next, "valve2").engineering.pumpId).toBe("pumpB");
    expect(byId(next, "pumpA").engineering.servesValveIds).toEqual(["valve0", "valve1"]);
    expect(byId(next, "pumpB").engineering.servesValveIds).toEqual(["valve2"]);
    const d = read(next);
    expect(d.nozzleById.get("jet2").pumpId).toBe("pumpB");
    expect(connectionProblems(next).filter((p) => p.code === "pump-conflict")).toEqual([]);
  });

  it("disconnects from a pump (and the pump list drops the valve)", () => {
    const next = connectToPump(base, ["jet1"], null);
    expect(read(next).nozzleById.get("jet1").pumpId).toBe(null);
    expect(byId(next, "pumpA").engineering.servesValveIds).toEqual(["valve0", "valve2"]);
    expect(byId(next, "valve1").engineering.pumpId).toBeUndefined();
  });

  it("links a valve to a nozzle: the jet inherits the valve's pump, controlledFixtureId follows", () => {
    // valve0 (on pump A) now feeds jet3 only; jet0 loses its valve but keeps its pump.
    const next = setValveNozzle(base, "valve0", "jet3");
    const d = read(next);
    expect(d.nozzleById.get("jet3").valveId).toBe("valve0");
    expect(d.nozzleById.get("jet3").pumpId).toBe("pumpA");
    expect(d.nozzleById.get("jet0").valveId).toBe(null);
    expect(d.nozzleById.get("jet0").pumpId).toBe("pumpA");
    expect(byId(next, "valve0").engineering.controlledFixtureId).toBe("jet3");
    expect(byId(next, "jet0").engineering.solenoidValveId).toBeUndefined();
  });

  it("unlinks a valve so the old controlledFixtureId can no longer claim the jet", () => {
    const next = disconnectValve(base, ["jet1"]);
    const d = read(next);
    expect(d.nozzleById.get("jet1").valveId).toBe(null);
    expect(byId(next, "valve1").engineering.controlledFixtureId).toBeUndefined();
    expect(d.nozzleById.get("jet1").pumpId).toBe("pumpA");
  });

  it("links nozzles to a valve and pairs lights", () => {
    let next = connectValve(base, "valve3", ["jet3"]);
    next = connectToPump(next, ["jet3"], "pumpB");
    next = pairLights(next, ["light1", "light2"], "jet3");
    const d = read(next);
    expect(d.nozzleById.get("jet3")).toMatchObject({ valveId: "valve3", pumpId: "pumpB" });
    expect(byId(next, "pumpB").engineering.servesValveIds).toEqual(["valve3"]);
    expect(d.lights.find((l) => l.id === "light2").nozzleId).toBe("jet3");
    // Unpairing falls back to the nearest nozzle (as before).
    const un = pairLights(next, ["light2"], null);
    expect(byId(un, "light2").engineering.pairedNozzleId).toBeUndefined();
    expect(read(un).lights.find((l) => l.id === "light2").nozzleId).toBe("jet2");
  });

  it("keeps legacy alias fields in step instead of leaving stale links", () => {
    const legacy = base.map((f) => (f.id === "jet1" ? { ...f, supplyingPumpId: "pumpA", linkedValveId: "valve1" } : f));
    const next = applyLinks(legacy, { nozzles: { jet1: { pumpId: "pumpB", valveId: null } } });
    const j = byId(next, "jet1");
    expect(j.supplyingPumpId).toBe("pumpB");
    expect(j.linkedValveId).toBeUndefined();
    expect(read(next).nozzleById.get("jet1")).toMatchObject({ pumpId: "pumpB", valveId: null });
  });

  it("the group check reads the same links", () => {
    const next = connectToPump(base, ["jet3", "jet4", "jet5"], "pumpB");
    const d = read(next);
    expect(() => groupConflicts({ groups: [], membersOf: () => [], design: d, recipes: [], focus: [] })).not.toThrow();
    expect(d.pumps.get("pumpB").nozzleIds).toHaveLength(3);
  });
});

describe("connections — auto-connect", () => {
  it("one valve per nozzle: links a free valve at the same spot, creates library solenoids for the rest", () => {
    const res = autoValves(base);
    expect(res.linked).toEqual(["valve3"]);
    expect(res.created).toHaveLength(2);
    const d = read(res.fixtures);
    expect(d.nozzles.every((n) => n.valveId)).toBe(true);
    const made = byId(res.fixtures, res.created[0]);
    expect(made.type).toBe(defaultSolenoidType(base, byId(base, "jet4")));
    expect(made.type).toMatch(/^valve_solenoid_dn25/);
    expect(made.engineering.controlledFixtureId).toBe("jet4");
    expect(made.uuid).toBeTruthy();
    expect(res.lines.length).toBe(3);
  });

  it("nearest pump and by zone / group fill jets without a pump", () => {
    const nearest = autoPumps(base, { mode: "nearest" });
    expect(read(nearest.fixtures).nozzles.filter((n) => !n.pumpId)).toEqual([]);
    expect(read(nearest.fixtures).nozzleById.get("jet5").pumpId).toBe("pumpB");
    const byGroup = autoPumps(base, { mode: "group" });
    const d = read(byGroup.fixtures);
    // zone "right" has no pump yet → the pump with most spare rated flow (B: 400 free vs A: 250 − 300).
    expect(["jet3", "jet4", "jet5"].map((id) => d.nozzleById.get(id).pumpId)).toEqual(["pumpB", "pumpB", "pumpB"]);
    expect(byGroup.lines).toEqual(["right (3 jets) → Pump B"]);
  });

  it("pairs unpaired lights to the nearest nozzle", () => {
    const res = autoPairLights(base);
    expect(res.lines).toHaveLength(2);
    expect(byId(res.fixtures, "light1").engineering.pairedNozzleId).toBe("jet1");
    expect(byId(res.fixtures, "light0")).toBe(byId(base, "light0"));
  });
});

describe("connections — problems", () => {
  it("finds unconnected and contradictory links, each with a one-click fix", () => {
    const broken = base.map((f) => {
      if (f.id === "jet0") return { ...f, engineering: { ...f.engineering, pumpId: "pumpB" } };      // valve on A, jet says B
      if (f.id === "valve2") return { ...f, engineering: { ...f.engineering, controlledFixtureId: "jet1" } }; // claims jet1
      return f;
    });
    const problems = connectionProblems(broken);
    const codes = new Set(problems.map((p) => p.code));
    for (const c of ["nozzle-orphan", "pump-conflict", "valve-mismatch", "valve-no-nozzle", "light-unpaired"]) expect(codes.has(c)).toBe(true);
    // Fix the conflict: one click, then no pump conflict remains for jet0.
    const conflict = problems.find((p) => p.code === "pump-conflict" && p.ids[0] === "jet0");
    const fixed = conflict.fix.apply(broken);
    expect(connectionProblems(fixed).some((p) => p.code === "pump-conflict" && p.ids[0] === "jet0")).toBe(false);
    expect(byId(fixed, "pumpB").engineering.servesValveIds).toContain("valve0");
    // Fix all orphans: every jet gets a pump.
    const orphans = problemGroups(problems).find((g) => g.code === "nozzle-orphan");
    const all = orphans.fixAll(broken);
    expect(read(all).nozzles.filter((n) => !n.pumpId && !n.valveId)).toEqual([]);
    // Pick fix for an empty pump.
    expect(connectionProblems(base).find((p) => p.code === "pump-no-outlets").fix.pick).toBe("pumpB");
  });

  it("a fully connected design has no errors or warnings", () => {
    let next = autoValves(base).fixtures;
    next = autoPumps(next, { mode: "group" }).fixtures;
    next = autoPairLights(next).fixtures;
    const left = connectionProblems(next).filter((p) => p.severity !== "info");
    expect(left).toEqual([]);
    expect(setNozzleValve(next, "jet0", read(next).nozzleById.get("jet0").valveId)).toBe(next); // no-op keeps the array
    expect(readConnections(next).connected).toBe(true);
  });
});
