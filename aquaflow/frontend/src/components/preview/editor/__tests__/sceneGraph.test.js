import { describe, it, expect, beforeEach } from "vitest";
import {
  SceneGraph, NODE_TYPES, compose, multiply, identity,
  translationOf, transformPoint, invertAffine, __resetIds,
} from "../sceneGraph";

beforeEach(() => __resetIds());

describe("matrix algebra", () => {
  it("composes translation", () => {
    const m = compose({ position: { x: 1, y: 2, z: 3 } });
    expect(translationOf(m)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("composes a 90 degree Y rotation correctly", () => {
    const m = compose({ rotation: { y: 90 } });
    const p = transformPoint(m, { x: 1, y: 0, z: 0 });
    // +X rotated 90 deg about +Y lands on -Z in a right-handed system.
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.z).toBeCloseTo(-1, 10);
  });

  it("applies scale", () => {
    const p = transformPoint(compose({ scale: 2 }), { x: 1, y: 2, z: 3 });
    expect(p).toEqual({ x: 2, y: 4, z: 6 });
  });

  it("multiplying by identity changes nothing", () => {
    const m = compose({ position: { x: 5 }, rotation: { y: 33 }, scale: 1.5 });
    const out = multiply(identity(), m);
    for (let i = 0; i < 16; i++) expect(out[i]).toBeCloseTo(m[i], 10);
  });

  it("inverts an affine transform back to identity", () => {
    const m = compose({ position: { x: 3, y: -2, z: 7 }, rotation: { x: 20, y: 45, z: -10 }, scale: 2 });
    const out = multiply(m, invertAffine(m));
    const I = identity();
    for (let i = 0; i < 16; i++) expect(out[i]).toBeCloseTo(I[i], 8);
  });

  it("returns identity rather than NaN for a degenerate matrix", () => {
    expect(invertAffine(compose({ scale: 0 }))).toEqual(identity());
  });
});

describe("hierarchy and inherited transforms", () => {
  it("gives a root node its local position as world position", () => {
    const g = new SceneGraph();
    const n = g.add({ type: NODE_TYPES.NOZZLE, position: { x: 2, z: 3 } });
    expect(g.worldPosition(n.id)).toEqual({ x: 2, y: 0, z: 3 });
  });

  it("inherits the parent's translation — the defining scene-graph property", () => {
    const g = new SceneGraph();
    const parent = g.add({ type: NODE_TYPES.GROUP, position: { x: 10, y: 0, z: 0 } });
    const child = g.add({ type: NODE_TYPES.NOZZLE, position: { x: 1, y: 0, z: 0 }, parentId: parent.id });
    expect(g.worldPosition(child.id)).toEqual({ x: 11, y: 0, z: 0 });
  });

  it("inherits the parent's rotation, so rotating a group swings its children", () => {
    const g = new SceneGraph();
    const ring = g.add({ type: NODE_TYPES.GROUP });
    const nozzle = g.add({ type: NODE_TYPES.NOZZLE, position: { x: 2, y: 0, z: 0 }, parentId: ring.id });
    g.setTransform(ring.id, { rotation: { y: 90 } });
    const p = g.worldPosition(nozzle.id);
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.z).toBeCloseTo(-2, 10);
  });

  it("inherits scale through several levels", () => {
    const g = new SceneGraph();
    const a = g.add({ type: NODE_TYPES.GROUP, scale: 2 });
    const b = g.add({ type: NODE_TYPES.GROUP, scale: 3, parentId: a.id });
    const c = g.add({ type: NODE_TYPES.NOZZLE, position: { x: 1 }, parentId: b.id });
    expect(g.worldPosition(c.id).x).toBeCloseTo(6, 10);
  });
});

describe("reparenting", () => {
  it("preserves world position so a fixture does not teleport when regrouped", () => {
    const g = new SceneGraph();
    const grp = g.add({ type: NODE_TYPES.GROUP, position: { x: 10, y: 0, z: 0 } });
    const n = g.add({ type: NODE_TYPES.NOZZLE, position: { x: 3, y: 0, z: 0 } });
    const before = g.worldPosition(n.id);

    g.reparent(n.id, grp.id);
    const after = g.worldPosition(n.id);

    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.z).toBeCloseTo(before.z, 10);
    expect(g.get(n.id).transform.position.x).toBeCloseTo(-7, 10);  // re-expressed locally
  });

  it("refuses to create a cycle", () => {
    const g = new SceneGraph();
    const a = g.add({ type: NODE_TYPES.GROUP });
    const b = g.add({ type: NODE_TYPES.GROUP, parentId: a.id });
    expect(g.reparent(a.id, b.id)).toBe(false);
    expect(g.wouldCycle(a.id, b.id)).toBe(true);
  });

  it("refuses an unknown parent", () => {
    const g = new SceneGraph();
    const a = g.add({ type: NODE_TYPES.NOZZLE });
    expect(g.reparent(a.id, "nope")).toBe(false);
  });
});

describe("grouping", () => {
  it("places the group at the centroid so it rotates about its own centre", () => {
    const g = new SceneGraph();
    const a = g.add({ type: NODE_TYPES.NOZZLE, position: { x: -2, z: 0 } });
    const b = g.add({ type: NODE_TYPES.NOZZLE, position: { x: 2, z: 0 } });
    const grp = g.group([a.id, b.id], "Ring");
    expect(grp.transform.position.x).toBeCloseTo(0, 10);
    expect(g.get(a.id).parentId).toBe(grp.id);
    expect(g.get(b.id).parentId).toBe(grp.id);
  });

  it("keeps children in place through group then ungroup", () => {
    const g = new SceneGraph();
    const a = g.add({ type: NODE_TYPES.NOZZLE, position: { x: -2, z: 1 } });
    const b = g.add({ type: NODE_TYPES.NOZZLE, position: { x: 2, z: -1 } });
    const before = [g.worldPosition(a.id), g.worldPosition(b.id)];

    const grp = g.group([a.id, b.id]);
    g.ungroup(grp.id);

    const after = [g.worldPosition(a.id), g.worldPosition(b.id)];
    for (let i = 0; i < 2; i++) {
      expect(after[i].x).toBeCloseTo(before[i].x, 8);
      expect(after[i].z).toBeCloseTo(before[i].z, 8);
    }
    expect(g.get(grp.id)).toBeNull();
  });

  it("returns null when grouping nothing", () => {
    expect(new SceneGraph().group([])).toBeNull();
  });
});

describe("removal", () => {
  it("removes the whole subtree", () => {
    const g = new SceneGraph();
    const p = g.add({ type: NODE_TYPES.GROUP });
    g.add({ type: NODE_TYPES.NOZZLE, parentId: p.id });
    g.add({ type: NODE_TYPES.NOZZLE, parentId: p.id });
    expect(g.count()).toBe(3);
    g.remove(p.id);
    expect(g.count()).toBe(0);
  });

  it("drops removed nodes from the selection", () => {
    const g = new SceneGraph();
    const n = g.add({ type: NODE_TYPES.NOZZLE });
    g.select([n.id]);
    g.remove(n.id);
    expect(g.selected()).toEqual([]);
  });
});

describe("visibility and locking", () => {
  it("hides children when the parent is hidden", () => {
    const g = new SceneGraph();
    const p = g.add({ type: NODE_TYPES.GROUP });
    const c = g.add({ type: NODE_TYPES.NOZZLE, parentId: p.id });
    expect(g.isVisible(c.id)).toBe(true);
    g.setVisible(p.id, false);
    expect(g.isVisible(c.id)).toBe(false);
  });

  it("hides everything on a hidden layer", () => {
    const g = new SceneGraph();
    const layer = g.addLayer("Lights");
    const n = g.add({ type: NODE_TYPES.LIGHT, layerId: layer.id });
    g.setLayerVisible(layer.id, false);
    expect(g.isVisible(n.id)).toBe(false);
  });

  it("refuses to transform a locked node", () => {
    const g = new SceneGraph();
    const n = g.add({ type: NODE_TYPES.NOZZLE, locked: true });
    expect(g.setTransform(n.id, { position: { x: 5 } })).toBe(false);
    expect(g.worldPosition(n.id).x).toBe(0);
  });

  it("treats a child of a locked parent as locked", () => {
    const g = new SceneGraph();
    const p = g.add({ type: NODE_TYPES.GROUP, locked: true });
    const c = g.add({ type: NODE_TYPES.NOZZLE, parentId: p.id });
    expect(g.isLocked(c.id)).toBe(true);
  });
});

describe("selection", () => {
  it("replaces by default and adds when additive", () => {
    const g = new SceneGraph();
    const a = g.add({ type: NODE_TYPES.NOZZLE });
    const b = g.add({ type: NODE_TYPES.NOZZLE });
    g.select([a.id]);
    expect(g.selected()).toEqual([a.id]);
    g.select([b.id]);
    expect(g.selected()).toEqual([b.id]);
    g.select([a.id], { additive: true });
    expect(g.selected().sort()).toEqual([a.id, b.id].sort());
  });

  it("toggles off on an additive click of an already-selected node", () => {
    const g = new SceneGraph();
    const a = g.add({ type: NODE_TYPES.NOZZLE });
    g.select([a.id]);
    g.select([a.id], { additive: true });
    expect(g.selected()).toEqual([]);
  });

  it("ignores unknown ids", () => {
    const g = new SceneGraph();
    g.select(["ghost"]);
    expect(g.selected()).toEqual([]);
  });

  it("reports the centroid, which is where the gizmo is drawn", () => {
    const g = new SceneGraph();
    const a = g.add({ type: NODE_TYPES.NOZZLE, position: { x: -1, z: 0 } });
    const b = g.add({ type: NODE_TYPES.NOZZLE, position: { x: 3, z: 4 } });
    g.select([a.id, b.id]);
    expect(g.selectionCenter()).toEqual({ x: 1, y: 0, z: 2 });
  });

  it("has no centre when nothing is selected", () => {
    expect(new SceneGraph().selectionCenter()).toBeNull();
  });
});

describe("duplication", () => {
  it("copies a node with an offset and keeps its properties", () => {
    const g = new SceneGraph();
    const n = g.add({ type: NODE_TYPES.NOZZLE, position: { x: 1 }, props: { flowLpm: 40 } });
    const copy = g.duplicate(n.id, { x: 0.5 });
    expect(copy.id).not.toBe(n.id);
    expect(copy.transform.position.x).toBeCloseTo(1.5, 10);
    expect(copy.props.flowLpm).toBe(40);
  });

  it("copies the whole subtree", () => {
    const g = new SceneGraph();
    const p = g.add({ type: NODE_TYPES.GROUP });
    g.add({ type: NODE_TYPES.NOZZLE, parentId: p.id });
    g.add({ type: NODE_TYPES.NOZZLE, parentId: p.id });
    const copy = g.duplicate(p.id);
    expect(copy.childIds).toHaveLength(2);
    expect(g.count()).toBe(6);
  });
});

describe("flatten and filters", () => {
  it("returns tree order with depth for the hierarchy panel", () => {
    const g = new SceneGraph();
    const p = g.add({ type: NODE_TYPES.GROUP, name: "Ring" });
    g.add({ type: NODE_TYPES.NOZZLE, name: "Jet 1", parentId: p.id });
    const flat = g.flatten();
    expect(flat[0].depth).toBe(0);
    expect(flat[1].depth).toBe(1);
    expect(flat[1].node.name).toBe("Jet 1");
  });

  it("filters by name text and by type", () => {
    const g = new SceneGraph();
    g.add({ type: NODE_TYPES.NOZZLE, name: "Jet 1" });
    g.add({ type: NODE_TYPES.LIGHT, name: "Wash 1" });
    expect(g.flatten({ text: "jet" })).toHaveLength(1);
    expect(g.flatten({ types: [NODE_TYPES.LIGHT] })).toHaveLength(1);
  });

  it("collects nodes by type from anywhere in the tree", () => {
    const g = new SceneGraph();
    const p = g.add({ type: NODE_TYPES.GROUP });
    g.add({ type: NODE_TYPES.NOZZLE, parentId: p.id });
    g.add({ type: NODE_TYPES.NOZZLE });
    expect(g.byType(NODE_TYPES.NOZZLE)).toHaveLength(2);
  });
});

describe("serialisation", () => {
  it("round-trips structure and world transforms", () => {
    const g = new SceneGraph();
    const grp = g.add({ type: NODE_TYPES.GROUP, name: "Ring", position: { x: 5 }, rotation: { y: 30 } });
    const n = g.add({ type: NODE_TYPES.NOZZLE, name: "Jet", position: { x: 2 }, parentId: grp.id });
    const before = g.worldPosition(n.id);

    const restored = SceneGraph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    const after = restored.worldPosition(n.id);

    expect(restored.count()).toBe(2);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.z).toBeCloseTo(before.z, 10);
    expect(restored.get(n.id).parentId).toBe(grp.id);
  });

  it("rescues orphans from a malformed file instead of losing them", () => {
    const restored = SceneGraph.fromJSON({
      nodes: [{ id: "x", name: "Stray", type: "nozzle", parentId: "missing", transform: {} }],
      rootIds: [], layers: [],
    });
    expect(restored.count()).toBe(1);
    expect(restored.flatten()).toHaveLength(1);
  });

  it("produces an empty graph from nothing", () => {
    expect(SceneGraph.fromJSON(null).count()).toBe(0);
  });

  it("restores a saved graph in place and emits one coherent event", () => {
    const g = new SceneGraph();
    g.add({ id: "kept", type: NODE_TYPES.NOZZLE, position: { x: 2 } });
    g.select(["kept"]);
    const saved = g.toJSON();
    g.add({ id: "later", type: NODE_TYPES.LIGHT });
    const seen = [];
    g.subscribe(reason => seen.push(reason));

    const sameGraph = g.replaceFromJSON(saved, { selection: ["kept"], reason: "history" });
    expect(sameGraph).toBe(g);
    expect(g.get("later")).toBeNull();
    expect(g.worldPosition("kept").x).toBe(2);
    expect(g.selected()).toEqual(["kept"]);
    expect(seen).toEqual(["history"]);
  });
});

describe("editable metadata", () => {
  it("updates names, locks and properties through observable graph methods", () => {
    const g = new SceneGraph();
    g.add({ id: "n", type: NODE_TYPES.NOZZLE });
    const seen = [];
    g.subscribe(reason => seen.push(reason));
    g.setName("n", "Center Jet");
    g.setLocked("n", true);
    g.setProps("n", { nozzleType: "geyser" });
    expect(g.get("n")).toMatchObject({ name: "Center Jet", locked: true, props: { nozzleType: "geyser" } });
    expect(seen).toEqual(["rename", "lock", "props"]);
  });
});

describe("change notification", () => {
  it("notifies subscribers and can unsubscribe", () => {
    const g = new SceneGraph();
    const seen = [];
    const off = g.subscribe(reason => seen.push(reason));
    g.add({ type: NODE_TYPES.NOZZLE });
    expect(seen).toContain("add");
    off();
    g.add({ type: NODE_TYPES.NOZZLE });
    expect(seen.filter(r => r === "add")).toHaveLength(1);
  });

  it("survives a listener that throws", () => {
    const g = new SceneGraph();
    g.subscribe(() => { throw new Error("bad listener"); });
    expect(() => g.add({ type: NODE_TYPES.NOZZLE })).not.toThrow();
  });

  it("batches many mutations into one named notification", () => {
    const g = new SceneGraph();
    const seen = [];
    g.subscribe(reason => seen.push(reason));
    g.transaction(() => {
      const group = g.add({ type: NODE_TYPES.GROUP });
      g.add({ type: NODE_TYPES.NOZZLE, parentId: group.id });
      g.add({ type: NODE_TYPES.LIGHT });
    }, "external-sync");
    expect(g.count()).toBe(3);
    expect(seen).toEqual(["external-sync"]);
  });
});
