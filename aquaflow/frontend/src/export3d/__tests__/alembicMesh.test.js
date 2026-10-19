// Alembic water mesh: surface-nets surface is closed and faces outward; the .abc container
// parses back to the frames, faces and time sampling written (also verified by importing
// into Blender's Alembic reader: no errors, one animated mesh, Cd colours).
import { describe, it, expect } from "vitest";
import { createGrid } from "../openvdb";
import { meshFromDensity } from "../surfaceNets";
import { createAlembicMeshWriter, serializeMeta } from "../alembic";

function sphereGrid(r = 10, c = [3, -4, 5]) {
  const g = createGrid("density");
  for (let i = -r - 2; i <= r + 2; i++) for (let j = -r - 2; j <= r + 2; j++) for (let k = -r - 2; k <= r + 2; k++) {
    const d = Math.hypot(i, j, k);
    if (d < r + 2) g.set(i + c[0], j + c[1], k + c[2], Math.max(0, Math.min(1, (r - d) / 2 + 0.5)));
  }
  return g;
}

describe("surface nets", () => {
  const vs = 0.05;
  const m = meshFromDensity(sphereGrid(), { iso: 0.5, voxelSize: vs });
  it("is a closed surface (every edge shared by exactly two triangles)", () => {
    const edges = new Map();
    for (let t = 0; t < m.indices.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = m.indices[t + e], b = m.indices[t + (e + 1) % 3];
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        edges.set(k, (edges.get(k) || 0) + 1);
      }
      expect(new Set([m.indices[t], m.indices[t + 1], m.indices[t + 2]]).size).toBe(3);
    }
    for (const n of edges.values()) expect(n).toBe(2);
  });
  it("winds counter-clockwise outward (positive volume ≈ the sphere's)", () => {
    let vol = 0;
    const P = (i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [P(m.indices[t]), P(m.indices[t + 1]), P(m.indices[t + 2])];
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    const expected = 4 / 3 * Math.PI * (10 * vs) ** 3;
    expect(vol).toBeGreaterThan(expected * 0.85);
    expect(vol).toBeLessThan(expected * 1.15);
  });
});

function readOgawa(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u64 = (o) => dv.getBigUint64(o, true);
  const node = (ref) => {
    if (ref & 0x8000000000000000n) {
      const at = Number(ref & 0x7fffffffffffffffn);
      if (!at) return { data: new Uint8Array(0) };
      const n = Number(u64(at));
      return { data: bytes.subarray(at + 8, at + 8 + n) };
    }
    const at = Number(ref);
    if (!at) return { children: [] };
    const n = Number(u64(at));
    return { children: Array.from({ length: n }, (_, i) => node(u64(at + 8 + i * 8))) };
  };
  return { magic: new TextDecoder().decode(bytes.subarray(0, 5)), frozen: bytes[5], version: [bytes[6], bytes[7]], root: node(u64(8)) };
}

describe("Alembic writer", () => {
  it("writes an Ogawa archive with the reference layout", async () => {
    const chunks = [];
    const patches = [];
    const sink = { async append(b) { chunks.push(b.slice()); }, async patch(at, b) { patches.push([at, b.slice()]); } };
    const w = await createAlembicMeshWriter(sink, { fps: 24, startTime: 1 / 24, color: true });
    const quad = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]), indices: new Int32Array([0, 1, 2]), colors: new Float32Array(9).fill(0.5) };
    await w.addFrame(quad);
    await w.addFrame({ ...quad, positions: new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0]) });
    await w.addFrame({ positions: new Float32Array(0), indices: new Int32Array(0) });
    await w.finish();
    const all = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    for (const [at, b] of patches) all.set(b, at);
    const f = readOgawa(all);
    expect(f.magic).toBe("Ogawa");
    expect(f.frozen).toBe(0xff);
    expect(f.version).toEqual([0, 1]);
    const root = f.root.children;
    expect(root).toHaveLength(6);
    expect(new DataView(root[0].data.buffer, root[0].data.byteOffset).getInt32(0, true)).toBe(0);
    expect(new TextDecoder().decode(root[3].data)).toMatch(/_ai_Application=AquaFlow Studio/);
    // Time sampling 1: 3 samples at 1/24 s from 1/24 s.
    const ts = new DataView(root[4].data.buffer, root[4].data.byteOffset, root[4].data.byteLength);
    expect(ts.getUint32(24, true)).toBe(3);
    expect(ts.getFloat64(28, true)).toBeCloseTo(1 / 24, 12);
    // top → Xform → mesh → .geom → P has 3 samples × (data, dims).
    const top = root[2].children;
    const xform = top[1].children;
    const mesh = xform[1].children;
    const geom = mesh[0].children[0].children;
    const P = geom[0].children;
    expect(P).toHaveLength(6);
    expect(P[2].data.length).toBe(16 + 36);
    expect(new DataView(P[2].data.buffer, P[2].data.byteOffset + 16).getFloat32(12, true)).toBe(2);
    expect(P[4].data.length).toBe(16);                      // the empty last frame
    // Faces were reversed to Alembic's clockwise winding.
    const faces = geom[2].children[0].data;
    expect(Array.from(new Int32Array(faces.slice(16).buffer))).toEqual([0, 2, 1]);
    expect(serializeMeta({ b: "2", a: "1" })).toBe("a=1;b=2");
  });
});
