/**
 * AF-CAD-030..034 drafting-kernel unit tests: identity, command deltas + shared history,
 * object snap (modes, priority, zoom-independent aperture), polar/dynamic input,
 * selection (window/crossing, similar, groups, shared fields).
 */
import { describe, it, expect } from "vitest";
import { ensureEntityIdentities, isEntityUuid, fixturePorts, createPipeEntity, connectPipeEnds } from "../entities";
import { DraftingHistory, diffDocuments, applyCommands, invertCommands } from "../commands";
import { buildSnapScene, findSnap, SNAP_GLYPHS, SNAP_PRIORITY, SnapIndex } from "../snap";
import { polarTrack, dynamicInputKey, emptyDynamicInput, resolveDynamicInput, parseCoordinateInput, angleOf } from "../dynamicInput";
import { boxSelect, selectSimilar, createGroup, ungroup, expandToGroups, sharedFieldValues, MIXED, applySharedField, clickSelection } from "../selection";
import { DraftingSession, resolveDraftPoint } from "../session";
import { buildFixtureArray } from "../arrays";

const nozzle = (id, x, y, extra = {}) => ({ id, uuid: `00000000-0000-4000-8000-00000000000${id}`, type: "nozzle_geyser", x, y, label: `N${id}`, ...extra });

describe("AF-CAD-030 entity identity", () => {
  it("adds uuid + owner lazily, preserving existing ids, and is referentially stable once migrated", () => {
    const legacy = [{ id: 1717000000000, type: "nozzle_geyser", x: 1, y: 1 }, { id: "cad-N01", type: "light_rgb", x: 2, y: 2 }];
    const migrated = ensureEntityIdentities(legacy, () => "basin:basin-1");
    expect(migrated.map((f) => f.id)).toEqual([1717000000000, "cad-N01"]);
    expect(migrated.every((f) => isEntityUuid(f.uuid) && f.owner === "basin:basin-1")).toBe(true);
    expect(ensureEntityIdentities(migrated)).toBe(migrated);
  });

  it("re-issues duplicated uuids so keys stay unique", () => {
    const dup = [nozzle(1, 0, 0, { owner: "model" }), { ...nozzle(1, 1, 1, { owner: "model" }), id: 2 }];
    const out = ensureEntityIdentities(dup);
    expect(new Set(out.map((f) => f.uuid)).size).toBe(2);
  });

  it("arrays create entities with unique uuid ids", () => {
    const made = buildFixtureArray({ geometry: { points: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }, { x: 0, y: 8 }], closed: true }, fixtureType: "nozzle_geyser", typeLabel: "Geyser", mode: "grid", rows: 2, cols: 3 });
    expect(made).toHaveLength(6);
    expect(new Set(made.map((f) => f.id)).size).toBe(6);
    expect(made.every((f) => f.id === f.uuid && f.owner === "model")).toBe(true);
  });
});

describe("AF-CAD-031 command deltas and shared history", () => {
  it("diffs entity collections into insert/patch/delete commands that round-trip through JSON", () => {
    const before = { fixtures: [nozzle(1, 0, 0), nozzle(2, 1, 1)], projectName: "A" };
    const after = { fixtures: [{ ...nozzle(1, 0, 0), x: 5 }, nozzle(3, 2, 2)], projectName: "B" };
    const cmds = JSON.parse(JSON.stringify(diffDocuments(before, after)));
    expect(cmds.map((c) => c.op).sort()).toEqual(["delete", "insert", "patch", "set"]);
    const patch = cmds.find((c) => c.op === "patch");
    expect(patch.set).toEqual({ x: 5 });             // only the changed field — not a snapshot
    expect(applyCommands(before, cmds).doc).toEqual(after);
    expect(applyCommands(after, invertCommands(cmds).reverse()).doc).toEqual(before);
  });

  it("keeps order changes and unkeyed collections reversible", () => {
    const a = { fixtures: [nozzle(1, 0, 0), nozzle(2, 0, 0), nozzle(3, 0, 0)], measurements: [{ x1: 0 }] };
    const b = { fixtures: [nozzle(3, 0, 0), nozzle(1, 0, 0), nozzle(2, 0, 0)], measurements: [{ x1: 0 }, { x1: 2 }] };
    const cmds = diffDocuments(a, b);
    expect(applyCommands(a, cmds).doc).toEqual(b);
    expect(applyCommands(b, invertCommands(cmds).reverse()).doc).toEqual(a);
  });

  it("one gesture = one transaction: coalesced records collapse to the gesture's net delta", () => {
    const h = new DraftingHistory({ limit: 5 });
    const s0 = { fixtures: [nozzle(1, 0, 0), nozzle(2, 5, 0)] };
    const s1 = { fixtures: [{ ...nozzle(1, 0, 0), x: 1 }, { ...nozzle(2, 5, 0), x: 6 }] };
    const s2 = { fixtures: [{ ...nozzle(1, 0, 0), x: 2 }, { ...nozzle(2, 5, 0), x: 7 }] };
    h.record({ source: "3d", before: s0, after: s1, coalesceKey: "g1" });
    h.record({ source: "3d", before: s1, after: s2, coalesceKey: "g1" });
    expect(h.undoStack).toHaveLength(1);
    expect(h.undoStack[0].label).toBe("Move 2 fixtures");
    const undone = h.undo(s2);
    expect(undone.doc).toEqual(s0);
    expect(h.redo(undone.doc).doc).toEqual(s2);
  });

  it("caps depth and serialises to JSON", () => {
    const h = new DraftingHistory({ limit: 3 });
    let doc = { fixtures: [] };
    for (let i = 1; i <= 5; i += 1) {
      const next = { fixtures: [...doc.fixtures, nozzle(i, i, 0)] };
      h.record({ before: doc, after: next });
      doc = next;
    }
    expect(h.undoStack).toHaveLength(3);
    const restored = DraftingHistory.fromJSON(JSON.parse(JSON.stringify(h.toJSON())));
    expect(restored.undo(doc).doc.fixtures).toHaveLength(4);
  });
});

describe("AF-CAD-032 object snap", () => {
  const fixtures = [nozzle(1, 0, 0), nozzle(2, 10, 0)];
  const pipes = [createPipeEntity({ points: [{ x: 0, y: 5 }, { x: 10, y: 5 }] }), createPipeEntity({ points: [{ x: 5, y: 0 }, { x: 5, y: 10 }] })];
  const scene = buildSnapScene({ fixtures, pipes, geometry: { type: "circle", center: { x: 30, y: 30 }, radius: 4 } });

  it("finds every mode with a distinct glyph", () => {
    const at = (x, y, opts) => findSnap({ x, y }, scene, { worldPerPx: 0.05, ...opts });
    expect(at(10.2, 0.1).mode).toBe("port");
    expect(at(0.2, 5.1).mode).toBe("endpoint");
    expect(at(5.1, 5.1).mode).toBe("intersection");
    expect(at(30.1, 30.1).mode).toBe("center");
    expect(at(1.8, 5.3).mode).toBe("nearest");
    expect(at(1.8, 5.3, { from: { x: 1.9, y: 9 } }).mode).toBe("perpendicular");
    expect(findSnap({ x: 0.1, y: 0.1 }, scene, { worldPerPx: 0.05, modes: ["insertion"] }).mode).toBe("insertion");
    expect(at(50.2, 50.2, { grid: { enabled: true, step: 0.5 } })).toMatchObject({ mode: "grid", x: 50, y: 50 });
    const glyphs = Object.values(SNAP_GLYPHS).slice(0, 8).map((g) => g.glyph);
    expect(new Set(glyphs).size).toBe(8);
  });

  it("follows the priority Endpoint/Port > Intersection > Midpoint > Center > Perpendicular > Nearest > grid", () => {
    expect(SNAP_PRIORITY.endpoint).toBe(SNAP_PRIORITY.port);
    const order = ["port", "intersection", "midpoint", "center", "perpendicular", "nearest", "grid"].map((m) => SNAP_PRIORITY[m]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const s2 = buildSnapScene({ pipes: [createPipeEntity({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })] });
    // Alone in the aperture, the midpoint wins over nearest.
    expect(findSnap({ x: 0.52, y: 0.01 }, s2, { worldPerPx: 0.02, aperturePx: 10 }).mode).toBe("midpoint");
    // An endpoint 6 px away beats a midpoint 4 px away (priority before distance).
    expect(findSnap({ x: 0.3, y: 0 }, s2, { worldPerPx: 0.05, aperturePx: 10 })).toMatchObject({ mode: "endpoint", x: 0, y: 0 });
  });

  it("uses a screen-pixel aperture: the same 8 px offset snaps at every zoom", () => {
    for (const zoom of [10, 30, 140]) {
      const hit = findSnap({ x: 10 + 8 / zoom, y: 0 }, scene, { worldPerPx: 1 / zoom });
      expect(hit.mode).toBe("port");
      expect(findSnap({ x: 10 + 12 / zoom, y: 0 }, scene, { worldPerPx: 1 / zoom }).mode).not.toBe("port");
    }
  });

  it("indexes live entities spatially", () => {
    const idx = new SnapIndex(2);
    for (let i = 0; i < 1000; i += 1) idx.insert({ minX: i, maxX: i, minY: 0, maxY: 0, i });
    expect(idx.search({ minX: 10, maxX: 12, minY: -1, maxY: 1 }).map((it) => it.i).sort((a, b) => a - b)).toEqual([10, 11, 12]);
  });

  it("defines fixture ports: nozzle inlet under the outlet, pump suction/discharge rotated", () => {
    expect(fixturePorts(nozzle(1, 2, 3))).toMatchObject([{ key: "inlet", x: 2, y: 3, dn: 25 }]);
    const pump = fixturePorts({ id: "p", type: "pump", x: 0, y: 0, rotation: 90 });
    expect(pump.map((p) => p.key)).toEqual(["suction", "discharge"]);
    expect(pump[1].x).toBeCloseTo(0, 9);
    expect(pump[1].y).toBeCloseTo(0.3, 9);
    expect(fixturePorts({ type: "light_rgb", x: 0, y: 0 })).toEqual([]);
  });
});

describe("AF-CAD-033 polar tracking and dynamic input", () => {
  it("tracks 15° rays within the aperture and locks with Shift", () => {
    const t = polarTrack({ x: 0, y: 0 }, { x: 5, y: -1.3 }, { worldPerPx: 0.05 }); // ~14.6° up-screen → 15°
    expect(t.angleDeg).toBe(15);
    expect(polarTrack({ x: 0, y: 0 }, { x: 5, y: -0.9 }, { worldPerPx: 0.01 })).toBeNull(); // off any ray
    const locked = polarTrack({ x: 0, y: 0 }, { x: 5, y: -3 }, { lockedAngleDeg: 0 });
    expect(locked).toMatchObject({ x: 5, y: 0, angleDeg: 0, locked: true });
  });

  it("number → length, Tab → angle, @dx,dy relative, Enter commits, Esc cancels", () => {
    let s = emptyDynamicInput();
    for (const k of "12.5") s = dynamicInputKey(s, k).state;
    expect(dynamicInputKey(s, "Enter").action).toEqual({ type: "commit" });
    expect(resolveDynamicInput({ x: 1, y: 1 }, s, { cursorAngleDeg: 0 })).toEqual({ x: 13.5, y: 1 });
    s = dynamicInputKey(s, "Tab").state;
    for (const k of "90") s = dynamicInputKey(s, k).state;
    expect(resolveDynamicInput({ x: 0, y: 0 }, s)).toEqual({ x: 0, y: -12.5 });
    let r = emptyDynamicInput();
    for (const k of "@3,-4") r = dynamicInputKey(r, k).state;
    expect(resolveDynamicInput({ x: 1, y: 1 }, r)).toEqual({ x: 4, y: -3 });
    expect(parseCoordinateInput("7,8")).toEqual({ relative: false, x: 7, y: 8 });
    expect(dynamicInputKey(r, "Escape")).toMatchObject({ action: { type: "cancel" }, state: emptyDynamicInput() });
    expect(dynamicInputKey(emptyDynamicInput(), "Enter").action).toEqual({ type: "finish" });
    expect(angleOf({ x: 0, y: 0 }, { x: 0, y: -1 })).toBe(90);
  });

  it("resolveDraftPoint: object snap beats polar beats grid", () => {
    const design = { fixtures: [nozzle(1, 5, 0.05)] };
    const ctx = { design, from: { x: 0, y: 0 }, worldPerPx: 0.05, grid: { enabled: true, step: 0.5 } };
    expect(resolveDraftPoint({ x: 5.1, y: 0.1 }, ctx).snap.mode).toBe("port");
    const polar = resolveDraftPoint({ x: 3.3, y: 0.2 }, ctx);
    expect(polar.polar.angleDeg).toBe(0);
    expect(polar.point).toEqual({ x: 3.5, y: 0 }); // grid quantises the length along the ray
  });
});

describe("AF-CAD-034 selection, similar and groups", () => {
  const fx = [nozzle(1, 1, 1), nozzle(2, 4, 1), { ...nozzle(3, 9, 9), type: "light_rgb" }];
  const pipe = createPipeEntity({ points: [{ x: 0, y: 3 }, { x: 10, y: 3 }] });

  it("left→right window needs full containment, right→left crossing needs a touch", () => {
    const keys = (list) => list.map(String);
    expect(boxSelect([...fx, pipe], { x: 0, y: 0 }, { x: 5, y: 4 })).toEqual(keys([fx[0].uuid, fx[1].uuid]));
    expect(boxSelect([...fx, pipe], { x: 5, y: 4 }, { x: 0, y: 0 })).toEqual(keys([fx[0].uuid, fx[1].uuid, pipe.uuid]));
    expect(clickSelection(["a"], "b", { additive: true })).toEqual(["a", "b"]);
    expect(clickSelection(["a", "b"], "a", { additive: true })).toEqual(["b"]);
  });

  it("select-similar matches type, or CAD block when present", () => {
    expect(selectSimilar(fx, [fx[0].uuid])).toEqual([fx[0].uuid, fx[1].uuid]);
    const blocks = [{ ...fx[0], cadBlock: "JET_A" }, { ...fx[1], cadBlock: "JET_B" }, { ...fx[2], cadBlock: "JET_A" }];
    expect(selectSimilar(blocks, [blocks[0].uuid], { by: "block" })).toEqual([blocks[0].uuid, blocks[2].uuid]);
  });

  it("groups are ID lists: create, expand a click to the group, ungroup", () => {
    const { groups, group } = createGroup([], [fx[0].uuid, fx[1].uuid], "Front row");
    expect(JSON.parse(JSON.stringify(group))).toMatchObject({ name: "Front row", members: [fx[0].uuid, fx[1].uuid] });
    expect(expandToGroups(groups, [fx[1].uuid]).sort()).toEqual([fx[0].uuid, fx[1].uuid].sort());
    expect(ungroup(groups, [fx[0].uuid])).toEqual([]);
  });

  it("shared fields report MIXED and edit across the selection", () => {
    const shared = sharedFieldValues([{ zone: "deep", engineering: { flowLpm: 5 } }, { zone: "deep", engineering: { flowLpm: 9 } }], ["zone", "engineering.flowLpm"]);
    expect(shared.zone).toBe("deep");
    expect(shared["engineering.flowLpm"]).toBe(MIXED);
    const edited = applySharedField(fx, [fx[0].uuid, fx[2].uuid], "engineering.flowLpm", 40);
    expect(edited.map((f) => f.engineering?.flowLpm)).toEqual([40, undefined, 40]);
  });
});

describe("DraftingSession (shared by the 2D designer and the 3D editor)", () => {
  it("click, type 12.5, Enter, Enter → a 12.5 m pipe connected to both nozzle ports", () => {
    const design = { fixtures: [nozzle(1, 2, 2), nozzle(2, 14.5, 2)] };
    const made = [];
    const session = new DraftingSession({ getDesign: () => design, onCreate: (p) => made.push(p) });
    session.click({ x: 2.1, y: 2.05 }, { worldPerPx: 1 / 30 });
    session.pointer({ x: 8, y: 2.1 }, { worldPerPx: 1 / 30 });
    for (const k of "12.5") session.key(k);
    session.key("Enter");
    session.key("Enter");
    expect(made).toHaveLength(1);
    expect(made[0].points).toEqual([{ x: 2, y: 2 }, { x: 14.5, y: 2 }]);
    expect(made[0].connections.start).toMatchObject({ fixtureId: 1, port: "inlet" });
    expect(made[0].connections.end).toMatchObject({ fixtureId: 2, port: "inlet" });
    expect(connectPipeEnds(made[0].points, design.fixtures).end.fixtureId).toBe(2);
  });
});
