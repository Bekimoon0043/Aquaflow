/**
 * AF-CAD-001 — one CAD WCS → plan → three.js transform chain.
 *
 * (1) cadToPlan / planToCad are exact inverses for any user frame (origin, rotation, flip).
 * (2) export → re-import of an asymmetric freeform design returns identical points (≤1 mm).
 * (3) An imported off-centre nozzle lands INSIDE the imported basin in the 3D frame (raycast
 *     against the same mesh construction the scene uses), and its mirror image does not.
 */
import { describe, it, expect } from "vitest";
import * as T from "three";
import {
  CAD_FRAME_DEFAULTS, cadFrame, cadToPlan, planToCad, cadRotationToPlan, cadToWorld,
  edgeAlignRotation, engineeringToWorld, poolCenter,
} from "../geometryContract.js";
import { parseCadDxf, previewCadImport, applyCadImport, exportCadDxf } from "../cadExchange";
import { centeredPoolPoints, poolShapeGeometry } from "../../components/preview/basinGeometry";

const dxf = (entities, units = 6) => `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${units}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
const lw = (layer, pts) => `0\nLWPOLYLINE\n8\n${layer}\n90\n${pts.length}\n70\n1\n${pts.map(([x, y]) => `10\n${x}\n20\n${y}\n`).join("")}`;
const circle = (layer, x, y, r, handle) => `0\nCIRCLE\n5\n${handle}\n8\n${layer}\n10\n${x}\n20\n${y}\n30\n0\n40\n${r}\n`;

describe("CAD frame chain", () => {
  it("default frame is CAD +Y up → plan +y down (designer canvas), origin 0, no rotation", () => {
    expect(cadFrame()).toEqual({ origin: { x: 0, y: 0 }, rotationDeg: 0, flipY: true });
    expect(cadToPlan({ x: 3, y: 5 })).toEqual({ x: 3, y: -5 });
    expect(cadToPlan([3, 5], { flipY: false })).toEqual({ x: 3, y: 5 });
    expect(CAD_FRAME_DEFAULTS.flipY).toBe(true);
  });

  it("origin + rotation + flip round-trips exactly", () => {
    const frame = { origin: { x: 512345.25, y: 4100012.5 }, rotationDeg: 33.7, flipY: true };
    for (const p of [{ x: 512350, y: 4100020 }, { x: 512300.123, y: 4099999.987 }]) {
      const back = planToCad(cadToPlan(p, frame), frame);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });

  it("edge-align makes the chosen CAD edge run along +X in the plan", () => {
    const a = { x: 10, y: 10 }, b = { x: 13, y: 14 };
    const frame = { origin: a, rotationDeg: edgeAlignRotation(a, b) };
    const q = cadToPlan(b, frame);
    expect(q.x).toBeCloseTo(5, 9);
    expect(q.y).toBeCloseTo(0, 9);
    expect(cadToPlan(a, frame)).toEqual({ x: 0, y: 0 });
  });

  it("symbol rotation follows the frame (CCW in CAD → mirrored sign in the y-down plan)", () => {
    expect(cadRotationToPlan(90)).toBe(-90);
    expect(cadRotationToPlan(90, { rotationDeg: 10, flipY: false })).toBe(100);
  });

  it("net CAD → world map is a proper rotation: CAD north (+Y) is world −Z", () => {
    const center = { cx: 0, cy: 0 };
    expect(cadToWorld({ x: 0, y: 1 }, undefined, center)).toEqual({ x: 0, z: -1 });
    expect(cadToWorld({ x: 1, y: 0 }, undefined, center)).toEqual({ x: 1, z: 0 });
  });
});

describe("export → re-import of an asymmetric freeform design", () => {
  const outline = [
    { x: 0.0004, y: 0.25 }, { x: 11.317, y: -0.6 }, { x: 18.92, y: 2.004 }, { x: 21.5, y: 7.75 },
    { x: 14.2, y: 9.333 }, { x: 13.1, y: 5.05 }, { x: 6.666, y: 6.9 }, { x: 1.25, y: 11.875 },
  ];
  const project = () => ({
    name: "Kidney", id: "p-1", pool_type: "freeform", params: { width: 21.5, length: 12.475, depth: 0.9 },
    geometry: { type: "freeform", closed: true, points: outline.map(p => ({ ...p })) },
    fixtures: [
      { id: "n-a", type: "nozzle_geyser", label: "A", x: 17.123, y: 4.987, rotation: 12.5, engineering: { icanChannel: 4 } },
      { id: "n-b", type: "nozzle_geyser", label: "B", x: 3.001, y: 8.4, rotation: 0, engineering: { icanChannel: 5 } },
    ],
    manualPipes: [], depth_zones: [], measurements: [],
  });

  it("returns identical outline and fixture points (≤ 1 mm)", () => {
    const original = project();
    const imported = applyCadImport(original, previewCadImport(parseCadDxf(exportCadDxf(original))), { mode: "update" });
    expect(imported.geometry.points).toHaveLength(outline.length);
    imported.geometry.points.forEach((p, i) => {
      expect(Math.abs(p.x - outline[i].x)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(p.y - outline[i].y)).toBeLessThanOrEqual(0.001);
    });
    for (const f of original.fixtures) {
      const back = imported.fixtures.find(n => n.id === f.id);
      expect(Math.hypot(back.x - f.x, back.y - f.y)).toBeLessThanOrEqual(0.001);
      expect(back.rotation).toBeCloseTo(f.rotation, 6);
      expect(back.engineering).toEqual(f.engineering);
    }
  });

  it("is not mirrored: the exported CAD drawing has plan +y as CAD −Y", () => {
    const text = exportCadDxf(project());
    expect(text).toContain("10\n17.123\n20\n-4.987");
  });
});

describe("imported off-centre nozzle lands inside the imported basin in 3D", () => {
  // L-shaped basin in CAD (+Y up): notch is the upper-right quadrant (x>4, y>4).
  const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 8], [0, 8]];
  const drawing = dxf(lw("POOL_OUTLINE", L) + circle("NOZZLES", 8, 1, 0.1, "B1"));

  const raycastHit = (mesh, x, z) => {
    const ray = new T.Raycaster(new T.Vector3(x, 5, z), new T.Vector3(0, -1, 0));
    return ray.intersectObject(mesh).length > 0;
  };

  it("world position from engineeringToWorld hits the basin mesh; the z-mirror lands in the notch", () => {
    const imported = applyCadImport({ fixtures: [] }, previewCadImport(parseCadDxf(drawing)), { mode: "new" });
    const nozzle = imported.fixtures[0];
    const center = poolCenter(imported.geometry, imported.params, imported.pool_type);
    const world = engineeringToWorld(nozzle, center);
    // CAD (8,1) is south-east of the bbox centre (5,4) → world +x, +z (south = +Z).
    expect(world.x).toBeCloseTo(3, 9);
    expect(world.z).toBeCloseTo(3, 9);
    expect(cadToWorld({ x: 8, y: 1 }, imported.cad_frame || undefined, center)).toEqual(world);

    // Same mesh construction FountainScene uses for a freeform basin.
    const geo = poolShapeGeometry(T, centeredPoolPoints(imported.geometry.points));
    const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ side: T.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.updateMatrixWorld();
    expect(raycastHit(mesh, world.x, world.z)).toBe(true);
    expect(raycastHit(mesh, world.x, -world.z)).toBe(false); // CAD (8,7) is in the notch
    geo.dispose(); mesh.material.dispose();
  });
});
