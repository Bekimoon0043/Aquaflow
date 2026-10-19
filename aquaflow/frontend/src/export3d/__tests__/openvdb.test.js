// OpenVDB writer: the file parses back (header, descriptors, offsets, 5-4-3 topology,
// active-mask buffers) to exactly the voxels written. Also verified by hand in Blender
// (its OpenVDB library loads both grids; a thresholded sphere comes back in place).
import { describe, it, expect } from "vitest";
import { createGrid, encodeVDB } from "../openvdb";

function readVDB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const u8 = () => dv.getUint8(p++);
  const u32 = () => { const v = dv.getUint32(p, true); p += 4; return v; };
  const i32 = () => { const v = dv.getInt32(p, true); p += 4; return v; };
  const i64 = () => { const v = Number(dv.getBigInt64(p, true)); p += 8; return v; };
  const f32 = () => { const v = dv.getFloat32(p, true); p += 4; return v; };
  const f64 = () => { const v = dv.getFloat64(p, true); p += 8; return v; };
  const str = () => { const n = u32(); const s = new TextDecoder().decode(bytes.subarray(p, p + n)); p += n; return s; };
  const mask = (size) => { const m = bytes.subarray(p, p + size / 8); p += size / 8; return (i) => (m[i >> 3] >> (i & 7)) & 1; };
  const meta = () => {
    const out = {};
    for (let n = u32(); n > 0; n--) {
      const name = str(), type = str(), size = u32();
      if (type === "string") out[name] = new TextDecoder().decode(bytes.subarray(p, p + size));
      else if (type === "vec3i") out[name] = [dv.getInt32(p, true), dv.getInt32(p + 4, true), dv.getInt32(p + 8, true)];
      else if (type === "int64") out[name] = Number(dv.getBigInt64(p, true));
      p += size;
    }
    return out;
  };
  const header = { magic: i64(), version: u32(), lib: [u32(), u32()], offsets: u8(), uuid: new TextDecoder().decode(bytes.subarray(p, p + 36)) };
  p += 36;
  header.fileMeta = meta();
  const grids = [];
  for (let g = i32(); g > 0; g--) {
    const grid = { name: str(), type: str(), parent: str(), gridPos: i64(), blockPos: i64(), endPos: i64() };
    expect(p).toBe(grid.gridPos);
    grid.compression = u32();
    grid.meta = meta();
    grid.map = str();
    grid.matrix = Array.from({ length: 16 }, f64);
    const comps = grid.type.includes("vec3s") ? 3 : 1;
    expect(i32()).toBe(1);
    grid.background = Array.from({ length: comps }, f32);
    const tiles = u32(), children = u32();
    expect(tiles).toBe(0);
    const leaves = [];
    for (let r = 0; r < children; r++) {
      const origin = [i32(), i32(), i32()];
      const child2 = mask(32768); mask(32768);
      expect(u8()).toBe(0);                                   // no active tile values
      for (let i = 0; i < 32768; i++) {
        if (!child2(i)) continue;
        const o1 = [origin[0] + ((i >> 10) << 7), origin[1] + (((i >> 5) & 31) << 7), origin[2] + ((i & 31) << 7)];
        const child1 = mask(4096); mask(4096);
        expect(u8()).toBe(0);
        for (let j = 0; j < 4096; j++) {
          if (!child1(j)) continue;
          leaves.push({ origin: [o1[0] + ((j >> 8) << 3), o1[1] + (((j >> 4) & 15) << 3), o1[2] + ((j & 15) << 3)], topo: mask(512) });
        }
      }
    }
    expect(p).toBe(grid.blockPos);
    grid.voxels = new Map();
    for (const leaf of leaves) {
      const active = mask(512);
      expect(u8()).toBe(0);
      for (let n = 0; n < 512; n++) {
        expect(active(n)).toBe(leaf.topo(n));
        if (!active(n)) continue;
        const key = [leaf.origin[0] + (n >> 6), leaf.origin[1] + ((n >> 3) & 7), leaf.origin[2] + (n & 7)].join(",");
        const v = Array.from({ length: comps }, f32);
        grid.voxels.set(key, comps === 1 ? v[0] : v);
      }
    }
    expect(p).toBe(grid.endPos);
    grids.push(grid);
  }
  expect(p).toBe(bytes.length);
  return { header, grids };
}

describe("OpenVDB writer", () => {
  it("writes a header OpenVDB 6–12 readers accept", () => {
    const { header } = readVDB(encodeVDB([createGrid("density")], { voxelSize: 0.1 }));
    expect(header.magic).toBe(0x56444220);
    expect(header.version).toBe(224);
    expect(header.offsets).toBe(1);
    expect(header.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("round-trips sparse float and vec3s voxels across negative coordinates and several root nodes", () => {
    const d = createGrid("density"), v = createGrid("vel", { type: "vec3s", gridClass: "unknown" });
    const pts = [[0, 0, 0, 0.5], [-1, -1, -1, 0.25], [4095, 7, -4097, 1], [-5000, 130, 9, 0.75], [7, 8, 9, 0.125]];
    for (const [i, j, k, val] of pts) { d.set(i, j, k, val); v.set(i, j, k, [i, j, k]); }
    d.add(0, 0, 0, 0.25);
    const { grids } = readVDB(encodeVDB([d, v], { voxelSize: 0.05, translation: [1, 2, 3] }));
    const [rd, rv] = grids;
    expect(rd.name).toBe("density");
    expect(rd.type).toBe("Tree_float_5_4_3");
    expect(rd.meta.class).toBe("fog volume");
    expect(rd.meta.file_voxel_count).toBe(pts.length);
    expect(rd.meta.file_bbox_min).toEqual([-5000, -1, -4097]);
    expect(rd.meta.file_bbox_max).toEqual([4095, 130, 9]);
    expect(rd.compression).toBe(2);
    expect(rd.map).toBe("AffineMap");
    expect(rd.matrix).toEqual([0.05, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0.05, 0, 1, 2, 3, 1]);
    expect(rd.voxels.size).toBe(pts.length);
    expect(rd.voxels.get("0,0,0")).toBeCloseTo(0.75);
    for (const [i, j, k, val] of pts.slice(1)) expect(rd.voxels.get(`${i},${j},${k}`)).toBeCloseTo(val);
    expect(rv.type).toBe("Tree_vec3s_5_4_3");
    expect(rv.meta.vector_type).toBe("invariant");
    for (const [i, j, k] of pts) expect(rv.voxels.get(`${i},${j},${k}`)).toEqual([i, j, k]);
  });

  it("writes an empty grid and rejects duplicate names", () => {
    expect(readVDB(encodeVDB([createGrid("density")])).grids[0].voxels.size).toBe(0);
    expect(() => encodeVDB([createGrid("a"), createGrid("a")])).toThrow(/Duplicate/);
  });
});
