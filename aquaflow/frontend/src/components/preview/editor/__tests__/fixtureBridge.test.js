import { describe, it, expect, beforeEach } from "vitest";
import { SceneGraph, NODE_TYPES, __resetIds } from "../sceneGraph";
import {
  graphToNozzles, graphToLights, importDesign, exportDesign,
  FIXTURE_PALETTE, paletteSpec,
} from "../fixtureBridge";

beforeEach(() => __resetIds());

describe("graphToNozzles", () => {
  it("exports world position, so a grouped nozzle renders where it actually is", () => {
    const g = new SceneGraph();
    const ring = g.add({ type: NODE_TYPES.GROUP, position: { x: 5, y: 0, z: 0 } });
    g.add({
      type: NODE_TYPES.NOZZLE, parentId: ring.id,
      position: { x: 2, y: 0, z: 0 }, props: { nozzleType: "geyser" },
    });
    const out = graphToNozzles(g);
    expect(out).toHaveLength(1);
    expect(out[0].x).toBeCloseTo(7, 10);
    expect(out[0].type).toBe("geyser");
  });

  it("follows a rotated parent group", () => {
    const g = new SceneGraph();
    const ring = g.add({ type: NODE_TYPES.GROUP, rotation: { y: 90 } });
    g.add({ type: NODE_TYPES.NOZZLE, parentId: ring.id, position: { x: 2 } });
    const out = graphToNozzles(g);
    expect(out[0].x).toBeCloseTo(0, 8);
    expect(out[0].z).toBeCloseTo(-2, 8);
  });

  it("carries tilt from the node's X and Z rotation", () => {
    const g = new SceneGraph();
    g.add({ type: NODE_TYPES.NOZZLE, rotation: { x: 12, z: -7 } });
    const out = graphToNozzles(g);
    expect(out[0].tiltX).toBe(12);
    expect(out[0].tiltZ).toBe(-7);
  });

  it("omits hidden nozzles so the tree's eye icon actually affects the render", () => {
    const g = new SceneGraph();
    const n = g.add({ type: NODE_TYPES.NOZZLE });
    expect(graphToNozzles(g)).toHaveLength(1);
    g.setVisible(n.id, false);
    expect(graphToNozzles(g)).toHaveLength(0);
  });

  it("omits nozzles on a hidden layer", () => {
    const g = new SceneGraph();
    const layer = g.addLayer("Jets");
    g.add({ type: NODE_TYPES.NOZZLE, layerId: layer.id });
    g.setLayerVisible(layer.id, false);
    expect(graphToNozzles(g)).toHaveLength(0);
  });

  it("defaults a typeless node rather than emitting undefined", () => {
    const g = new SceneGraph();
    g.add({ type: NODE_TYPES.NOZZLE });
    expect(graphToNozzles(g)[0].type).toBe("jet_1d");
  });

  it("returns nothing for a missing graph", () => {
    expect(graphToNozzles(null)).toEqual([]);
  });
});

describe("graphToLights", () => {
  it("exports position and fixture properties", () => {
    const g = new SceneGraph();
    g.add({
      type: NODE_TYPES.LIGHT, position: { x: 1, z: 2 },
      props: { color: "#ff0000", intensity: 0.5, radius: 9 },
    });
    const [l] = graphToLights(g);
    expect(l).toMatchObject({ x: 1, z: 2, color: "#ff0000", intensity: 0.5, radius: 9 });
  });

  it("supplies defaults when properties are absent", () => {
    const g = new SceneGraph();
    g.add({ type: NODE_TYPES.LIGHT });
    const [l] = graphToLights(g);
    expect(l.intensity).toBe(0.8);
    expect(l.radius).toBe(6);
  });
});

describe("importDesign", () => {
  it("imports a flat nozzle list", () => {
    const g = new SceneGraph();
    const stats = importDesign(g, {
      nozzles: [
        { id: "a", x: 1, z: 2, type: "geyser" },
        { id: "b", x: -1, z: 0, type: "mist" },
      ],
    });
    expect(stats.nozzles).toBe(2);
    expect(g.byType(NODE_TYPES.NOZZLE)).toHaveLength(2);
    expect(g.get("a").props.nozzleType).toBe("geyser");
  });

  it("accepts the legacy 2D form where y means the ground axis", () => {
    const g = new SceneGraph();
    importDesign(g, { nozzles: [{ id: "a", x: 1, y: 4 }] });
    expect(g.worldPosition("a")).toEqual({ x: 1, y: 0, z: 4 });
  });

  it("turns groupId into a real parent group", () => {
    const g = new SceneGraph();
    const stats = importDesign(g, {
      nozzles: [
        { id: "a", x: -2, z: 0, groupId: "ring" },
        { id: "b", x: 2, z: 0, groupId: "ring" },
        { id: "c", x: 0, z: 9 },
      ],
    });
    expect(stats.groups).toBe(1);
    expect(g.get("a").parentId).toBe(g.get("b").parentId);
    expect(g.get("c").parentId).toBeNull();
  });

  it("centres an imported group on its children without moving them", () => {
    const g = new SceneGraph();
    importDesign(g, {
      nozzles: [
        { id: "a", x: -2, z: 0, groupId: "ring" },
        { id: "b", x: 4, z: 0, groupId: "ring" },
      ],
    });
    const grp = g.get(g.get("a").parentId);
    expect(grp.transform.position.x).toBeCloseTo(1, 8);
    // Children must not have shifted.
    expect(g.worldPosition("a").x).toBeCloseTo(-2, 8);
    expect(g.worldPosition("b").x).toBeCloseTo(4, 8);
  });

  it("imports lights alongside nozzles", () => {
    const g = new SceneGraph();
    const stats = importDesign(g, {
      nozzles: [{ id: "a", x: 0, z: 0 }],
      lights: [{ id: "L1", x: 1, z: 1, color: "#00ff00" }],
    });
    expect(stats.lights).toBe(1);
    expect(g.get("L1").props.color).toBe("#00ff00");
  });

  it("handles empty and missing input", () => {
    const g = new SceneGraph();
    expect(importDesign(g, null)).toEqual({ nozzles: 0, lights: 0, groups: 0 });
    expect(importDesign(g, {})).toEqual({ nozzles: 0, lights: 0, groups: 0 });
    expect(g.count()).toBe(0);
  });
});

describe("round trip", () => {
  it("survives import then export with positions intact", () => {
    const design = {
      nozzles: [
        { id: "a", x: 1.5, z: -2.5, type: "jet_2d", tiltX: 10, tiltZ: 0 },
        { id: "b", x: -3, z: 4, type: "laminar", tiltX: 0, tiltZ: 5 },
      ],
      lights: [{ id: "L", x: 0, z: 0, color: "#123456", intensity: 0.4, radius: 3 }],
    };
    const g = new SceneGraph();
    importDesign(g, design);
    const out = exportDesign(g);

    expect(out.nozzles).toHaveLength(2);
    const a = out.nozzles.find(n => n.id === "a");
    expect(a.x).toBeCloseTo(1.5, 8);
    expect(a.z).toBeCloseTo(-2.5, 8);
    expect(a.type).toBe("jet_2d");
    expect(a.tiltX).toBe(10);
    expect(out.lights[0].color).toBe("#123456");
  });

  it("keeps positions when a group is rotated after import", () => {
    const g = new SceneGraph();
    importDesign(g, { nozzles: [{ id: "a", x: 2, z: 0, groupId: "r" }, { id: "b", x: -2, z: 0, groupId: "r" }] });
    const grp = g.get("a").parentId;
    g.setTransform(grp, { rotation: { y: 180 } });
    const out = graphToNozzles(g);
    const a = out.find(n => n.id === "a");
    // Rotating the ring 180 deg about its centre swaps the two nozzles' positions.
    expect(a.x).toBeCloseTo(-2, 8);
  });
});

describe("fixture palette", () => {
  it("offers nozzle, light and hydraulic fixture types", () => {
    const types = new Set(FIXTURE_PALETTE.map(f => f.type));
    expect(types.has(NODE_TYPES.NOZZLE)).toBe(true);
    expect(types.has(NODE_TYPES.LIGHT)).toBe(true);
    expect(types.has(NODE_TYPES.PUMP)).toBe(true);
    expect(types.has(NODE_TYPES.VALVE)).toBe(true);
  });

  it("has a unique key and a label for every entry", () => {
    const keys = FIXTURE_PALETTE.map(f => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of FIXTURE_PALETTE) expect(f.label).toBeTruthy();
  });

  it("builds a drop-ready spec from a key", () => {
    const spec = paletteSpec("geyser", 2);
    expect(spec.type).toBe(NODE_TYPES.NOZZLE);
    expect(spec.props.nozzleType).toBe("geyser");
    expect(spec.name).toContain("2");
  });

  it("returns null for an unknown key rather than a broken spec", () => {
    expect(paletteSpec("nonexistent")).toBeNull();
  });

  it("copies props so two drops cannot share one object", () => {
    const a = paletteSpec("light");
    const b = paletteSpec("light");
    a.props.intensity = 0.1;
    expect(b.props.intensity).toBe(0.85);
  });
});
