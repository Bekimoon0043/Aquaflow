import { describe, expect, it } from "vitest";
import {
  geometryForPoolType,
  geometryMetrics,
  synchronizePoolGeometry,
  validateDepthZone,
} from "../poolGeometry.js";
import {
  createEngineeringHistory,
  commitEngineeringHistory,
  undoEngineeringHistory,
  redoEngineeringHistory,
} from "../engineeringHistory.js";
import { normalizeEngineeringProject, parseEngineeringProjectFile, selectEngineeringPipes } from "../engineeringProject.js";
import {
  BAR_TO_METRES_WATER,
  buildHydraulicPreviewPayload,
  engineeringFixtureToSolverNozzle,
  normalizeHydraulicResult,
} from "../hydraulicAdapter.js";

describe("pool geometry synchronization and metrics", () => {
  it("regenerates each built-in shape from the edited dimensions without moving its center", () => {
    const original = geometryForPoolType("rectangular", { width: 12, length: 8 });
    const ellipse = synchronizePoolGeometry({
      geometry: original,
      previousType: "rectangular",
      poolType: "elliptical",
      params: { width: 20, length: 10, depth: 1.2 },
    });
    expect(ellipse).toMatchObject({ type: "ellipse", center: { x: 6, y: 4 }, rx: 10, ry: 5 });
    expect(geometryMetrics(ellipse, { depth: 1.2 }).area).toBeCloseTo(Math.PI * 50, 6);
  });

  it("uses polygon area/perimeter for L-shapes instead of a bounding rectangle", () => {
    const lshape = geometryForPoolType("lshape", { width: 12, length: 8 });
    const metrics = geometryMetrics(lshape, { depth: 1 });
    expect(metrics.area).toBeCloseTo(72, 6);
    expect(metrics.perimeter).toBeCloseTo(40, 6);
    expect(metrics.capacityLitres).toBeCloseTo(72000, 3);
  });

  it("calculates zoned volume and rejects zones outside the pool", () => {
    const pool = geometryForPoolType("rectangular", { width: 10, length: 10 });
    const zone = { depth: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }, { x: 0, y: 10 }] };
    expect(validateDepthZone(zone.points, pool).valid).toBe(true);
    expect(geometryMetrics(pool, { depth: 1 }, [zone]).volume).toBeCloseTo(150, 6);
    expect(validateDepthZone([{ x: 1, y: 1 }, { x: 11, y: 1 }, { x: 1, y: 2 }], pool).valid).toBe(false);
    expect(validateDepthZone(
      [{ x: 4, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 6 }, { x: 4, y: 6 }],
      pool,
      [zone]
    ).errors).toContain("Depth zones cannot overlap.");
  });
});

describe("complete engineering history", () => {
  it("undoes and redoes geometry, fixtures, pipes, layers, and depth zones as one snapshot", () => {
    const initial = { geometry: { type: "rectangle" }, fixtures: [], manualPipes: [], layers: [], depthZones: [] };
    const changed = {
      geometry: { type: "circle" }, fixtures: [{ id: "n1" }], manualPipes: [{ id: "p1" }],
      layers: [{ key: "pool", visible: false }], depthZones: [{ zone: "deep", points: [{ x: 1, y: 1 }] }],
    };
    const committed = commitEngineeringHistory(createEngineeringHistory(initial), changed);
    const undone = undoEngineeringHistory(committed);
    expect(undone.present).toEqual(initial);
    expect(redoEngineeringHistory(undone).present).toEqual(changed);
  });
});

describe("pipe synchronization", () => {
  it("prefers non-empty manual pipes and falls back to persisted pipes", () => {
    expect(selectEngineeringPipes({ manualPipes: [{ id: "manual" }], pipes: [{ id: "legacy" }] })[0].id).toBe("manual");
    expect(selectEngineeringPipes({ manualPipes: [], pipes: [{ id: "legacy" }] })[0].id).toBe("legacy");
    expect(normalizeEngineeringProject({ manualPipes: [], pipes: [{ id: "legacy" }] }).manualPipes[0].id).toBe("legacy");
  });
});

describe("site surface persistence", () => {
  it("preserves land geometry from both serialized and live project keys", () => {
    const surface = { id:"grass-1", type:"grass", points:[{x:0,y:0},{x:2,y:0},{x:0,y:2}] };
    expect(normalizeEngineeringProject({ site_surfaces:[surface] }).site_surfaces).toEqual([surface]);
    expect(normalizeEngineeringProject({ siteSurfaces:[surface] }).site_surfaces).toEqual([surface]);
  });
});

describe("engineering project file import", () => {
  it("opens direct engineering exports and full AquaFlow show envelopes", () => {
    const project = { format:"AquaFlowPoolGeometry", name:"Plaza", pool_type:"freeform", fixtures:[{ id:"n1" }] };
    expect(parseEngineeringProjectFile(JSON.stringify(project))).toMatchObject({ name:"Plaza", pool_type:"freeform" });
    expect(parseEngineeringProjectFile(JSON.stringify({ aquaflow:"1.0", engineering:project }))).toMatchObject({ name:"Plaza", fixtures:[{ id:"n1" }] });
  });

  it("rejects malformed and unrelated JSON", () => {
    expect(() => parseEngineeringProjectFile("not json")).toThrow("not valid JSON");
    expect(() => parseEngineeringProjectFile(JSON.stringify({ hello:"world" }))).toThrow("not an AquaFlow engineering project");
  });
});

describe("frontend to hydraulic-solver translation", () => {
  it("converts L/min, bar, and millimetres to the backend contract", () => {
    const nozzle = engineeringFixtureToSolverNozzle({
      id: "n1", x: 3, y: 4,
      engineering: { flowLpm: 120, pressureBar: 2, nozzleDiaMm: 50 },
    });
    expect(nozzle.engineering.design_flow_lps).toBeCloseTo(2, 8);
    expect(nozzle.engineering.design_pressure_m).toBeCloseTo(2 * BAR_TO_METRES_WATER, 8);
    expect(nozzle.engineering.pipe_diameter_m).toBeCloseTo(0.05, 8);
  });

  it("filters non-hydraulic fixtures and normalizes solved results", () => {
    const payload = buildHydraulicPreviewPayload({
      fixtures: [
        { id: "n1", type: "nozzle_geyser", engineering: { flowLpm: 60, pressureBar: 1 } },
        { id: "l1", type: "light_rgb", engineering: { wattage: 20 } },
      ],
      volumeLitres: 50000,
    });
    expect(payload.nozzles).toHaveLength(1);
    const normalized = normalizeHydraulicResult({
      converged: true, method: "hazen-williams", total_design_flow_lpm: 60,
      turnover_time_hours: 13.8, nozzle_physics: { n1: { jetHeightM: 2 } }, validation: [],
    });
    expect(normalized).toMatchObject({ status: "solved", converged: true, totalDesignFlowLpm: 60 });
  });
});
