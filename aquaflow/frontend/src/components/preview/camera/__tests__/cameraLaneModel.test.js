import { describe, expect, it } from "vitest";
import { addKeys, createTrackHistory, designBounds, keyFromView, planToWorld, railKeys, resamplePath, saveViewSlot, viewInSlot } from "../cameraLaneModel";
import { buildCameraMove, normalizeCameraTrack, sampleCameraTrack } from "../cameraTrack";

const view = (x) => ({ position: { x, y: 5, z: 10 }, target: { x: 0, y: 1, z: 0 }, fov: 40 });

describe("keyFromView", () => {
  it("adds a key at the time with the view", () => {
    const t = keyFromView(null, view(1), 2);
    expect(t.keys).toHaveLength(1);
    expect(t.keys[0]).toMatchObject({ t: 2, fov: 40, ease: "smooth" });
    expect(t.keys[0].position.x).toBe(1);
  });
  it("recording over an existing key replaces it and keeps its id and ease", () => {
    let t = keyFromView(null, view(1), 2);
    t = { ...t, keys: [{ ...t.keys[0], ease: "hold" }] };
    const id = t.keys[0].id;
    const next = keyFromView(t, view(9), 2.01);
    expect(next.keys).toHaveLength(1);
    expect(next.keys[0]).toMatchObject({ id, ease: "hold" });
    expect(next.keys[0].position.x).toBe(9);
  });
  it("ignores a missing view", () => expect(keyFromView(null, null, 1).keys).toHaveLength(0));
});

describe("rail along a guide line", () => {
  it("spaces points evenly along an open path", () => {
    const pts = resamplePath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 6);
    expect(pts.map((p) => p.x)).toEqual([0, 2, 4, 6, 8, 10]);
  });
  it("a closed path ends where it started", () => {
    const pts = resamplePath([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], 8, true);
    expect(pts).toHaveLength(9);
    expect(pts[0]).toEqual(pts[8]);
    expect(pts[1]).toEqual({ x: 2, y: 0 });
  });
  it("makes keys in world coordinates at eye height, spanning the duration, looking at the target", () => {
    const keys = railKeys({ points: [{ x: 6, y: 4 }, { x: 16, y: 4 }] }, { start: 5, duration: 10, center: { cx: 6, cy: 4 }, target: { x: 5, y: 2, z: 0 }, samples: 5 });
    expect(keys).toHaveLength(5);
    expect(keys[0]).toMatchObject({ t: 5, position: { x: 0, y: 1.6, z: 0 }, target: { x: 5, y: 2, z: 0 } });
    expect(keys.at(-1)).toMatchObject({ t: 15, position: { x: 10, y: 1.6, z: 0 } });
    const mid = sampleCameraTrack(normalizeCameraTrack({ keys }), 10);
    expect(mid.position.x).toBeCloseTo(5, 3);
  });
  it("needs two points", () => expect(railKeys({ points: [{ x: 0, y: 0 }] })).toEqual([]));
  it("plan to world subtracts the pool centre", () => expect(planToWorld({ x: 3, y: 9 }, { cx: 1, cy: 4 }, 2)).toEqual({ x: 2, y: 2, z: 5 }));
});

describe("saved view slots", () => {
  it("stores and replaces a slot", () => {
    let views = saveViewSlot([], 3, view(1));
    views = saveViewSlot(views, 3, view(2));
    expect(views).toHaveLength(1);
    expect(viewInSlot(views, 3)).toMatchObject({ id: "slot-3", name: "View 3" });
    expect(viewInSlot(views, 3).position.x).toBe(2);
    expect(viewInSlot(views, 4)).toBeNull();
  });
});

describe("track history and moves", () => {
  it("undo and redo walk whole tracks", () => {
    const h = createTrackHistory();
    const a = keyFromView(null, view(1), 1), b = keyFromView(a, view(2), 2);
    h.push(a);
    expect(h.undo(b).keys).toHaveLength(1);
    expect(h.canRedo).toBe(true);
    expect(h.redo(a).keys).toHaveLength(2);
    expect(createTrackHistory().undo(a)).toBeNull();
  });
  it("preset moves work with bounds taken straight from the design", () => {
    const bounds = designBounds({ poolType: "rectangular", params: { width: 12, length: 8 }, fixtures: [{ x: 6, y: 4, engineering: { jetHeightM: 6 } }], center: { cx: 6, cy: 4 } });
    expect(bounds.max.y).toBe(6);
    const track = addKeys(null, buildCameraMove("dollyIn", { bounds, start: 2, duration: 5 }));
    expect(track.keys.map((k) => k.t)).toEqual([2, 7]);
  });
});
