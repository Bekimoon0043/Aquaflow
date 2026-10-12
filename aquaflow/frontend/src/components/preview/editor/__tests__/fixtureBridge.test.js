import { describe, it, expect, beforeEach } from "vitest";
import { SceneGraph, NODE_TYPES, __resetIds } from "../sceneGraph";
import {
  graphToNozzles, graphToLights, importDesign, exportDesign,
  importEngineeringFixtures, importSiteModels, graphToEngineeringFixtures, graphToSiteModels,
  reconcileEngineeringGraph,
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

  it("carries full XYZ rotation to the rendered fixture", () => {
    const g = new SceneGraph();
    g.add({ type: NODE_TYPES.NOZZLE, rotation: { x: 12, y: 38, z: -7 } });
    const out = graphToNozzles(g);
    expect(out[0].tiltX).toBeCloseTo(12, 8);
    expect(out[0].rotationY).toBeCloseTo(38, 8);
    expect(out[0].tiltZ).toBeCloseTo(-7, 8);
  });

  it("inherits rotation from a parent fountain group", () => {
    const g = new SceneGraph();
    const group = g.add({ type: NODE_TYPES.GROUP, rotation: { y: 45 } });
    g.add({ type: NODE_TYPES.NOZZLE, parentId: group.id, rotation: { x: 10 } });
    const [out] = graphToNozzles(g);
    expect(out.tiltX).toBeCloseTo(10, 8);
    expect(out.rotationY).toBeCloseTo(45, 8);
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

describe("engineering round trip", () => {
  it("maps plan Y to world Z and preserves hydraulic metadata after a 3D move", () => {
    const fixture = {
      id: "outlet-1", type: "nozzle_geyser", label: "Geyser 1",
      x: 2, y: -3, rotation: 15, zone: "center",
      engineering: { flowLpm: 82, pressureBar: 2.6 },
    };
    const graph = new SceneGraph();
    importEngineeringFixtures(graph, [fixture]);
    expect(graph.worldPosition("outlet-1")).toEqual({ x: 2, y: 0, z: -3 });

    graph.setTransform("outlet-1", {
      position: { x: 7, y: 0.25, z: 4 }, rotation: { x: 0, y: 48, z: 0 },
    });
    const [saved] = graphToEngineeringFixtures(graph, [fixture]);
    expect(saved).toMatchObject({
      id: "outlet-1", type: "nozzle_geyser", x: 7, y: 4, z: 0.25,
      zone: "center", engineering: { flowLpm: 82, pressureBar: 2.6 },
    });
    expect(saved.rotation).toBeCloseTo(48, 8);
  });

  it("round-trips through a non-origin pool center without accumulating an offset", () => {
    const fixture = { id: "centered", type: "nozzle_geyser", x: 6, y: 4, z: 0.1 };
    const center = { cx: 6, cy: 4 };
    const graph = new SceneGraph();
    importEngineeringFixtures(graph, [fixture], { center });
    expect(graph.worldPosition("centered")).toEqual({ x: 0, y: 0.1, z: 0 });

    graph.setTransform("centered", { position: { x: 2, y: 0.4, z: -1 } });
    const [saved] = graphToEngineeringFixtures(graph, [fixture], { center });
    expect(saved).toMatchObject({ x: 8, y: 3, z: 0.4 });
  });

  it("keeps persisted fixture group IDs stable across import and export", () => {
    const graph = new SceneGraph();
    importEngineeringFixtures(graph, [
      { id: "a", type: "nozzle_geyser", x: 0, y: 0, groupId: "center-ring" },
      { id: "b", type: "nozzle_geyser", x: 1, y: 0, groupId: "center-ring" },
    ]);
    expect(graph.get("center-ring")?.type).toBe(NODE_TYPES.GROUP);
    expect(graph.get("a").parentId).toBe("center-ring");
    expect(graphToEngineeringFixtures(graph).map(item => item.groupId))
      .toEqual(["center-ring", "center-ring"]);
  });

  it("imports lights and plant equipment as selectable graph nodes", () => {
    const graph = new SceneGraph();
    importEngineeringFixtures(graph, [
      { id: "light", type: "light_uw_rgb_18w", x: 1, y: 2 },
      { id: "pump", type: "pump", x: 3, y: 4 },
      { id: "valve", type: "valve", x: 5, y: 6 },
    ]);
    expect(graph.get("light").type).toBe(NODE_TYPES.LIGHT);
    expect(graph.get("pump").type).toBe(NODE_TYPES.PUMP);
    expect(graph.get("valve").type).toBe(NODE_TYPES.VALVE);
  });

  it("serializes editable venue models into the project", () => {
    const graph = new SceneGraph();
    graph.add({
      id: "person-1", type: NODE_TYPES.MODEL, name: "Standing person",
      position: { x: 4, z: 8 }, props: { assetId: "venue:person-standing-1" },
    });
    expect(graphToSiteModels(graph)).toEqual([expect.objectContaining({
      id: "person-1", name: "Standing person",
      props: { assetId: "venue:person-standing-1" },
    })]);
  });

  it("preserves venue model hierarchy, visibility and lock state", () => {
    const graph = new SceneGraph();
    importSiteModels(graph, [{
      id: "tree-1", name: "Tree", parentId: "landscape",
      transform: { position: { x: 4, y: 0, z: 8 }, rotation: { y: 30 }, scale: 1.2 },
      visible: false, locked: true, props: { assetId: "venue:tree-1" },
    }]);
    expect(graph.get("tree-1").parentId).toBe("landscape");
    expect(graphToSiteModels(graph)[0]).toMatchObject({
      parentId: "landscape", visible: false, locked: true,
    });
  });

  it("returns detached project records rather than aliases into the live model graph", () => {
    const graph = new SceneGraph();
    importSiteModels(graph, [{
      id: "building", locked: true,
      transform: { position: { x: 2, y: 0, z: 3 }, rotation: { y: 10 }, scale: 1 },
      props: { assetId: "venue:building" },
    }]);
    const [saved] = graphToSiteModels(graph);
    graph.get("building").transform.position.x = 99;
    graph.get("building").props.assetId = "changed";
    expect(saved.transform.position.x).toBe(2);
    expect(saved.props.assetId).toBe("venue:building");
  });

  it("reconciles external Engineering changes once and retains surviving selection", () => {
    const graph = new SceneGraph();
    importEngineeringFixtures(graph, [
      { id: "keep", type: "nozzle_geyser", x: 6, y: 4 },
      { id: "remove", type: "nozzle_geyser", x: 7, y: 4 },
    ], { center: { cx: 6, cy: 4 } });
    importSiteModels(graph, [{ id: "old-model", props: { assetId: "venue:old" } }]);
    graph.select(["keep"]);
    const seen = [];
    graph.subscribe(reason => seen.push(reason));

    const stats = reconcileEngineeringGraph(graph, {
      fixtures: [{ id: "keep", type: "nozzle_geyser", x: 8, y: 3 }],
      siteModels: [{ id: "new-model", locked: true, props: { assetId: "venue:new" } }],
      center: { cx: 6, cy: 4 },
    });

    expect(stats).toEqual({ fixtures: 1, models: 1 });
    expect(graph.get("remove")).toBeNull();
    expect(graph.get("old-model")).toBeNull();
    expect(graph.worldPosition("keep")).toEqual({ x: 2, y: 0, z: -1 });
    expect(graph.selected()).toEqual(["keep"]);
    expect(seen).toEqual(["external-sync"]);
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
