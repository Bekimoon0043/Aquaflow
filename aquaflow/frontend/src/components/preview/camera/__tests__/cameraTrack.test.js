import { describe, expect, it } from "vitest";
import {
  CAMERA_MOVES, addCameraKey, buildCameraMove, cameraKeyAt, cameraPathPolyline, moveCameraKey, normalizeCameraTrack,
  removeCameraKey, sampleCameraTrack, siteBounds, updateCameraKey,
} from "../cameraTrack";

const v = (x, y, z) => ({ x, y, z });
const k = (id, t, pos, ease = "smooth", extra = {}) => ({ id, t, position: pos, target: v(0, 2, 0), fov: 50, ease, ...extra });
const close = (a, b, d = 6) => { expect(a.x).toBeCloseTo(b.x, d); expect(a.y).toBeCloseTo(b.y, d); expect(a.z).toBeCloseTo(b.z, d); };
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const track = { enabled: true, keys: [
  k("a", 0, v(10, 3, 0)), k("b", 2, v(0, 4, 10)), k("c", 5, v(-10, 6, 0), "linear"), k("d", 6, v(0, 3, -12), "easeOut"), k("e", 9, v(8, 2, -4)),
] };

describe("normalize", () => {
  it("is safe on junk and sorts / defaults / dedupes", () => {
    expect(normalizeCameraTrack(null)).toEqual({ enabled: false, keys: [] });
    const n = normalizeCameraTrack({ keys: [k("x", 3, v(1, 1, 1)), null, { t: "bad" }, { id: "x", t: 1, position: v(0, 0, 0), target: v(0, 0, 0) }, k("y", 3, v(2, 2, 2))] });
    expect(n.keys.map((q) => q.t)).toEqual([1, 3]);
    expect(n.keys[1].position).toEqual(v(2, 2, 2));
    expect(new Set(n.keys.map((q) => q.id)).size).toBe(2);
    expect(n.keys[0]).toMatchObject({ fov: 50, roll: 0, ease: "smooth" });
    expect(n.enabled).toBe(true);
  });
  it("edits keys", () => {
    let t = addCameraKey({ keys: [] }, k("a", 1, v(0, 1, 5)));
    t = addCameraKey(t, k("b", 1.0005, v(0, 9, 5)));
    expect(t.keys).toHaveLength(1);
    expect(t.keys[0].position.y).toBe(9);
    t = addCameraKey(t, k("c", 4, v(3, 1, 5)));
    t = updateCameraKey(t, "c", { fov: 30 });
    expect(t.keys[1].fov).toBe(30);
    t = moveCameraKey(t, "c", 0.5);
    expect(t.keys.map((q) => q.id)).toEqual(["c", "b"]);
    expect(cameraKeyAt(t, 0.52)?.id).toBe("c");
    expect(cameraKeyAt(t, 2)).toBeNull();
    expect(removeCameraKey(t, "c").keys.map((q) => q.id)).toEqual(["b"]);
  });
});

describe("sampling", () => {
  it("returns null with no keys and clamps outside the range", () => {
    expect(sampleCameraTrack({ keys: [] }, 1)).toBeNull();
    close(sampleCameraTrack(track, -5).position, v(10, 3, 0));
    close(sampleCameraTrack(track, 99).position, v(8, 2, -4));
  });
  it("passes exactly through every key", () => {
    for (const key of track.keys) close(sampleCameraTrack(track, key.t).position, key.position);
  });
  it("is continuous at 60 fps (no jumps) for eased keys", () => {
    let prev = sampleCameraTrack(track, 0).position;
    for (let f = 1; f <= 9 * 60; f += 1) {
      const p = sampleCameraTrack(track, f / 60).position;
      expect(d3(p, prev)).toBeLessThan(0.6);
      prev = p;
    }
  });
  it("does not overshoot wildly with uneven key spacing (centripetal)", () => {
    const t2 = { keys: [k("a", 0, v(0, 2, 0)), k("b", 1, v(0.2, 2, 0)), k("c", 2, v(20, 2, 0)), k("d", 3, v(20.2, 2, 0))] };
    for (let f = 0; f <= 180; f += 1) {
      const p = sampleCameraTrack(t2, f / 60).position;
      expect(p.x).toBeGreaterThan(-1);
      expect(p.x).toBeLessThan(21.5);
    }
  });
  it("hold and cut stay on the key, then jump at the next key time", () => {
    for (const ease of ["hold", "cut"]) {
      const t = { keys: [k("a", 0, v(0, 2, 5), ease), k("b", 2, v(10, 2, 5))] };
      close(sampleCameraTrack(t, 1.99).position, v(0, 2, 5));
      close(sampleCameraTrack(t, 2).position, v(10, 2, 5));
    }
  });
  it("each ease moves monotonically along a straight segment", () => {
    for (const ease of ["smooth", "linear", "easeIn", "easeOut"]) {
      const t = { keys: [k("a", 0, v(0, 2, 0), ease), k("b", 4, v(8, 2, 0))] };
      let prev = -1;
      for (let f = 0; f <= 240; f += 1) {
        const x = sampleCameraTrack(t, f / 60).position.x;
        expect(x).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = x;
      }
    }
    const eIn = { keys: [k("a", 0, v(0, 2, 0), "easeIn"), k("b", 4, v(8, 2, 0))] };
    const eOut = { keys: [k("a", 0, v(0, 2, 0), "easeOut"), k("b", 4, v(8, 2, 0))] };
    expect(sampleCameraTrack(eIn, 1).position.x).toBeLessThan(2);
    expect(sampleCameraTrack(eOut, 1).position.x).toBeGreaterThan(2);
  });
  it("blends fov and roll", () => {
    const t = { keys: [k("a", 0, v(0, 2, 5), "linear", { fov: 60, roll: 0 }), k("b", 2, v(0, 2, 5), "linear", { fov: 20, roll: 10 })] };
    const s = sampleCameraTrack(t, 1);
    expect(s.fov).toBeCloseTo(40, 6);
    expect(s.roll).toBeCloseTo(5, 6);
    expect(s.keyIndex).toBe(0);
  });
  it("path polyline starts and ends on the keys", () => {
    const line = cameraPathPolyline(track, { samplesPerSegment: 10 });
    expect(line).toHaveLength(4 * 10 + 1);
    close(line[0], track.keys[0].position);
    close(line.at(-1), track.keys.at(-1).position);
  });
});

describe("preset moves", () => {
  const bounds = siteBounds([v(-6, 0, -4), v(6, 0, 4), v(0, 8, 0)]);
  it("site bounds", () => {
    expect(bounds.center).toEqual(v(0, 4, 0));
    expect(bounds.radius).toBeGreaterThan(7);
    expect(siteBounds([]).radius).toBe(2);
  });
  it("every move gives ≥2 keys from `start`, inside 4 radii", () => {
    for (const { key } of CAMERA_MOVES) {
      const keys = buildCameraMove(key, { bounds, start: 3, duration: 8 });
      expect(keys.length, key).toBeGreaterThanOrEqual(2);
      expect(keys[0].t, key).toBe(3);
      expect(keys.at(-1).t, key).toBeCloseTo(11, 6);
      for (const q of keys) expect(d3(q.position, bounds.center), key).toBeLessThanOrEqual(4 * bounds.radius);
      expect(normalizeCameraTrack({ keys }).keys).toHaveLength(keys.length);
    }
    expect(buildCameraMove("nope", { bounds })).toEqual([]);
  });
  it("dolly in ends closer, dolly out ends further", () => {
    const din = buildCameraMove("dollyIn", { bounds });
    const dout = buildCameraMove("dollyOut", { bounds });
    expect(d3(din.at(-1).position, bounds.center)).toBeLessThan(d3(din[0].position, bounds.center));
    expect(d3(dout.at(-1).position, bounds.center)).toBeGreaterThan(d3(dout[0].position, bounds.center));
  });
  it("lens zoom keeps the camera still and narrows the fov", () => {
    const z = buildCameraMove("lensZoom", { bounds });
    expect(z[0].position).toEqual(z.at(-1).position);
    expect(z.at(-1).fov).toBeLessThan(z[0].fov);
  });
  it("orbit goes all the way round at constant distance and starts from the current camera azimuth", () => {
    const from = { position: v(20, 5, 0), target: bounds.center, fov: 50 };
    const o = buildCameraMove("orbit", { bounds, from, duration: 16 });
    const r0 = Math.hypot(o[0].position.x, o[0].position.z);
    close(o[0].position, o.at(-1).position, 6);
    expect(o[0].position.x).toBeGreaterThan(0);
    expect(Math.abs(o[0].position.z)).toBeLessThan(1e-6);
    for (let f = 0; f <= 16 * 30; f += 1) {
      const p = sampleCameraTrack({ keys: o }, f / 30).position;
      expect(Math.hypot(p.x, p.z) / r0).toBeGreaterThan(0.97);
      expect(Math.hypot(p.x, p.z) / r0).toBeLessThan(1.03);
    }
  });
});
