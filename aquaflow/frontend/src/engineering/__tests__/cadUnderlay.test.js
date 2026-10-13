import { describe, it, expect } from "vitest";
import {
  aciToHex, createCadUnderlay, normalizeCadUnderlay, buildUnderlayIndex, drawCadUnderlay,
  setUnderlayLayerVisible, underlayBatches, CAD_UNDERLAY_FORMAT,
} from "../cadUnderlay";
import { createCadUnderlay3D } from "../../components/preview/cadUnderlay3D";
import { engineeringToWorld } from "../geometryContract";

const response = () => ({
  version: 1, filename: "site.dxf",
  units: { insunits: 6, name: "m", to_m: 1, unitless: false, suggested: null },
  layers: [
    { name: "POOL", color: 5, entity_count: 1, off: false, frozen: false },
    { name: "A-SITE", color: 8, entity_count: 2, off: false, frozen: false },
    { name: "HIDDEN", color: 1, entity_count: 1, off: true, frozen: false },
  ],
  entities: [
    { handle: "2F1", layer: "POOL", kind: "polyline", points: [[0, 0], [10, 0], [10, 8], [0, 8]], closed: true, z: 0, color: 256 },
    { handle: "2F2", layer: "A-SITE", kind: "circle", center: [20, 5], radius: 2, z: 0, color: 3 },
    { handle: "2F3", layer: "A-SITE", kind: "text", position: [1, 9], text: "NORTH TERRACE", height: 0.5, rotation_deg: 0 },
    { handle: "2F4", layer: "LAND", kind: "hatch", pattern: "GRASS", loops: [[[30, 0], [40, 0], [40, 10]]], color: 3 },
    { handle: "2F5", layer: "HIDDEN", kind: "point", position: [5, 5], z: 0 },
  ],
});

function mockCtx() {
  const calls = { stroke: 0, moveTo: 0, lineTo: 0, fillText: 0 };
  const ctx = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, setLineDash() {}, translate() {}, rotate() {},
    moveTo() { calls.moveTo++; }, lineTo() { calls.lineTo++; }, stroke() { calls.stroke++; }, fillText() { calls.fillText++; },
  };
  return { ctx, calls };
}

describe("AF-CAD-011 CAD underlay model", () => {
  it("keeps every entity, including unmapped layers, in the plan frame", () => {
    const u = createCadUnderlay(response());
    expect(u.format).toBe(CAD_UNDERLAY_FORMAT);
    expect(u.locked).toBe(true);
    expect(u.items).toHaveLength(5);
    expect(u.layers.map(l => l.name)).toEqual(["A-SITE", "HIDDEN", "LAND", "POOL"]);
    expect(u.layers.find(l => l.name === "HIDDEN").visible).toBe(false); // CAD layer off
    const pool = u.items.find(i => i.handle === "2F1");
    expect(pool.points).toEqual([0, 0, 10, 0, 10, -8, 0, -8]); // CAD +Y up → plan +y down
    expect(pool.color).toBe(aciToHex(5)); // BYLAYER
    const circle = u.items.find(i => i.handle === "2F2");
    expect(circle.center).toEqual([20, -5]);
    expect(circle.closed).toBe(true);
  });

  it("applies the user's origin/rotation frame", () => {
    const u = createCadUnderlay(response(), { frame: { origin: { x: 10, y: 0 }, rotationDeg: 90 } });
    const pool = u.items.find(i => i.handle === "2F1");
    // (10,8) → minus origin (0,8) → rotate +90° (-8,0) → flip (-8,0)
    expect(pool.points.slice(4, 6)).toEqual([-8, 0]);
    expect(u.frame).toEqual({ origin: { x: 10, y: 0 }, rotationDeg: 90, flipY: true });
  });

  it("survives JSON persistence and rejects junk", () => {
    const u = setUnderlayLayerVisible(createCadUnderlay(response()), "A-SITE", false);
    const back = normalizeCadUnderlay(JSON.parse(JSON.stringify(u)));
    expect(back.items).toHaveLength(5);
    expect(back.layers.find(l => l.name === "A-SITE").visible).toBe(false);
    expect(normalizeCadUnderlay({ format: "nope", items: [] })).toBeNull();
    expect(normalizeCadUnderlay(null)).toBeNull();
    const bad = normalizeCadUnderlay({ format: CAD_UNDERLAY_FORMAT, items: [{ kind: "line", points: [1, NaN, 2, 3] }, { kind: "point", x: 1, y: 2 }] });
    expect(bad.items).toHaveLength(1);
  });

  it("indexes for culling, snapping and picking", () => {
    const u = createCadUnderlay(response());
    const index = buildUnderlayIndex(u);
    expect(index.query(-1, -1, 1, 1).map(i => u.items[i].handle)).toContain("2F1");
    expect(index.query(100, 100, 200, 200)).toEqual([]);
    expect(index.nearestVertex({ x: 9.9, y: -7.95 }, 0.3)).toMatchObject({ x: 10, y: -8, kind: "endpoint" });
    expect(index.nearestVertex({ x: 20.1, y: -5.1 }, 0.3)).toMatchObject({ x: 20, y: -5, kind: "center" });
    expect(index.nearestVertex({ x: 50, y: 50 }, 0.3)).toBeNull();
    expect(u.items[index.pickItem({ x: 5, y: 0.05 }, 0.2)].handle).toBe("2F1");
    const hidden = new Map([["POOL", false]]);
    expect(index.pickItem({ x: 5, y: 0.05 }, 0.2, { visibleLayers: hidden })).toBe(-1);
  });

  it("draws one stroke per visible layer/colour batch and honours layer toggles", () => {
    const u = createCadUnderlay(response());
    const view = { zoom: 20, pan: { x: 0, y: 400 }, width: 1200, height: 800 };
    const { ctx, calls } = mockCtx();
    const stats = drawCadUnderlay(ctx, u, view);
    // POOL, A-SITE(green circle), LAND(hatch); HIDDEN layer is off.
    expect(stats.batches).toBe(3);
    expect(calls.stroke).toBe(3);
    expect(calls.fillText).toBe(1);
    const hiddenSite = setUnderlayLayerVisible(u, "A-SITE", false);
    const second = mockCtx();
    expect(drawCadUnderlay(second.ctx, hiddenSite, view).batches).toBe(2);
    expect(second.calls.fillText).toBe(0);
    expect(drawCadUnderlay(mockCtx().ctx, { ...u, visible: false }, view).batches).toBe(0);
  });

  it("stays batched and fast for a 50k-entity drawing", () => {
    const entities = [];
    for (let i = 0; i < 50000; i++) {
      const x = (i % 250) * 2, y = Math.floor(i / 250) * 2;
      entities.push({ handle: `H${i}`, layer: `L${i % 8}`, kind: "polyline", points: [[x, y], [x + 1, y + 1]], closed: false, color: 256 });
    }
    const t0 = performance.now();
    const u = createCadUnderlay({ entities, layers: [] });
    const { ctx, calls } = mockCtx();
    const stats = drawCadUnderlay(ctx, u, { zoom: 2, pan: { x: 0, y: 900 }, width: 1000, height: 900 });
    const zoomed = drawCadUnderlay(mockCtx().ctx, u, { zoom: 40, pan: { x: 0, y: 0 }, width: 800, height: 600 });
    const elapsed = performance.now() - t0;
    expect(calls.stroke).toBe(8); // one per layer/colour
    expect(stats.items).toBeGreaterThan(1000);
    expect(zoomed.items).toBeLessThan(stats.items); // viewport culling
    expect(elapsed).toBeLessThan(5000);
  });
});

describe("AF-CAD-011 underlay persistence in the engineering project / .aqua", () => {
  it("loadProject → getProjectPayload keeps the underlay and its layer toggles", async () => {
    const { default: useEngineeringStore } = await import("../../store/engineeringStore");
    const { normalizeEngineeringProject } = await import("../engineeringProject");
    const u = setUnderlayLayerVisible(createCadUnderlay(response()), "POOL", false);
    const saved = JSON.parse(JSON.stringify({ name: "Site", pool_type: "freeform", fixtures: [], cad_underlay: u }));
    useEngineeringStore.getState().loadProject(saved);
    const payload = JSON.parse(JSON.stringify(useEngineeringStore.getState().getProjectPayload()));
    expect(payload.cad_underlay.items).toHaveLength(5);
    expect(payload.cad_underlay.layers.find(l => l.name === "POOL").visible).toBe(false);
    expect(normalizeEngineeringProject({}).cad_underlay).toBeNull();
    expect(normalizeEngineeringProject({ cad_underlay: { junk: true } }).cad_underlay).toBeNull();
  });
});

describe("AF-CAD-011 createCadUnderlay3D", () => {
  it("builds one LineSegments per layer/colour on the ground plane with toggles and dispose", () => {
    const u = createCadUnderlay(response());
    const center = { cx: 5, cy: -4 };
    const group = createCadUnderlay3D(u, { toWorld: p => engineeringToWorld(p, center), elevation: 0.02 });
    expect(group.children).toHaveLength(underlayBatches(u).length);
    const pool = group.children.find(c => c.userData.layer === "POOL");
    const pos = pool.geometry.attributes.position.array;
    expect([pos[0], pos[1], pos[2]]).toEqual([-5, expect.closeTo(0.02, 6), 4]); // plan (0,0) - centre
    expect(group.children.find(c => c.userData.layer === "HIDDEN").visible).toBe(false);
    group.setLayerVisible("POOL", false);
    expect(pool.visible).toBe(false);
    group.applyVisibility(u);
    expect(pool.visible).toBe(true);
    group.dispose();
    expect(group.children).toHaveLength(0);
  });
});
