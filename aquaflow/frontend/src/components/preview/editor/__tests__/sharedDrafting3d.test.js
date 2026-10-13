/**
 * AF-CAD-031/032 in the 3D editor: the shared history adapter coalesces a gesture's
 * publishes into one transaction, and ground-plane drags use the unified object snap
 * (SHIFT still = grid, ALT still suspends snapping).
 */
import { describe, it, expect } from "vitest";
import { SharedSceneHistory } from "../sharedSceneHistory";
import { DraftingHistory } from "../../../../engineering/drafting/commands";
import { resolveDrag, snapTranslation } from "../editorSnapping";
import { buildSnapScene } from "../../../../engineering/drafting/snap";

const fx = (id, x) => ({ id, uuid: `00000000-0000-4000-8000-0000000000${id}0`, type: "nozzle_geyser", x, y: 0 });

describe("SharedSceneHistory", () => {
  it("one gizmo drag = one shared transaction; undo/redo patch the store", () => {
    const history = new DraftingHistory();
    let store = { fixtures: [fx(1, 0)], siteModels: [] };
    const adapter = new SharedSceneHistory({ history, getPresent: () => store, applyPatch: (p) => { store = { ...store, ...p }; } });
    adapter.checkpoint("Transform objects");
    for (const x of [0.5, 1, 1.5, 2]) {
      const before = store;
      store = { ...store, fixtures: [{ ...store.fixtures[0], x }] };
      adapter.recordPublish(before, store);
    }
    expect(history.undoStack).toHaveLength(1);
    expect(adapter.state().undoLabel).toBe("Transform objects");
    adapter.undo();
    expect(store.fixtures[0].x).toBe(0);
    adapter.redo();
    expect(store.fixtures[0].x).toBe(2);
    adapter.clear(); // never wipes the shared history
    expect(history.canUndo()).toBe(true);
  });
});

describe("3D ground-plane drag uses the unified snap engine", () => {
  const scene = buildSnapScene({ fixtures: [fx(1, 5)] });
  const osnap = { scene, worldPerPx: 0.02, toPlan: (p) => ({ x: p.x, y: p.z }), toWorld: (p) => ({ x: p.x, z: p.y }) };

  it("acquires a nozzle port within the aperture on a free/plane drag", () => {
    expect(resolveDrag({ x: 0, y: 0, z: 0 }, { x: 5.1, y: 0, z: 0.05 }, { osnap })).toEqual({ x: 5, y: 0, z: 0 });
  });

  it("ALT suspends object snap; SHIFT keeps the 10 cm grid", () => {
    expect(resolveDrag({ x: 0, y: 0, z: 0 }, { x: 5.1, y: 0, z: 0.05 }, { osnap, mods: { freeform: true } })).toEqual({ x: 5.1, y: 0, z: 0.05 });
    expect(snapTranslation({ x: 0.34, y: 0, z: 0.26 }, { snap: true })).toEqual({ x: 0.3, y: 0, z: 0.3 });
  });
});
