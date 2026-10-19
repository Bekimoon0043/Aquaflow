/**
 * openvdb.js — native OpenVDB (.vdb) writer: sparse float / vec3s grids on the standard
 * 5-4-3 tree, file format 224 (OpenVDB 6 → 12), no native library needed.
 *
 * Layout written (all little-endian):
 *   header   int64 magic 0x56444220 · uint32 format 224 · uint32 lib major/minor ·
 *            uint8 hasGridOffsets=1 · 36-char UUID · file MetaMap (empty) · int32 gridCount
 *   per grid name/type/instance-parent strings · int64 gridPos/blockPos/endPos ·
 *            uint32 compression · grid MetaMap · Transform ("AffineMap", 16 doubles) ·
 *            topology (int32 bufferCount, root → internal5 → internal4 → leaf masks) ·
 *            buffers (per leaf: value mask + compressed values)
 *
 * Compression is COMPRESS_ACTIVE_MASK — OpenVDB's own default for fog volumes: only
 * active values are stored, inactive ones read back as the background (0).
 */

const MAGIC_LO = 0x56444220;
const FILE_VERSION = 224;
const LIB_MAJOR = 10, LIB_MINOR = 0;
const COMPRESS_ACTIVE_MASK = 0x2;
const NO_MASK_OR_INACTIVE_VALS = 0;

const LEAF_LOG2 = 3, INT1_LOG2 = 4, INT2_LOG2 = 5;
const LEAF_SIZE = 1 << (3 * LEAF_LOG2);          // 512
const INT1_SIZE = 1 << (3 * INT1_LOG2);          // 4096
const INT2_SIZE = 1 << (3 * INT2_LOG2);          // 32768
const INT1_SPAN = 1 << (LEAF_LOG2 + INT1_LOG2);  // 128 voxels
const INT2_SPAN = 1 << (LEAF_LOG2 + INT1_LOG2 + INT2_LOG2); // 4096 voxels

const TYPES = {
  float: { tree: "Tree_float_5_4_3", comps: 1 },
  vec3s: { tree: "Tree_vec3s_5_4_3", comps: 3 },
};

/**
 * A sparse grid accumulated voxel by voxel. `add` sums into a voxel (splatting),
 * `set` overwrites; both make the voxel active.
 */
export function createGrid(name, { type = "float", gridClass = "fog volume", metadata = {} } = {}) {
  const spec = TYPES[type];
  if (!spec) throw new Error(`Unsupported OpenVDB value type: ${type}`);
  // Leaves keyed by a packed number (leaf coords within ±2^16 leaves = ±524 288 voxels).
  const leaves = new Map();
  const keyOf = (i, j, k) => (((i >> 3) + 65536) * 131072 + ((j >> 3) + 65536)) * 131072 + ((k >> 3) + 65536);
  let lastKey = NaN, lastLeaf = null;
  const leafAt = (i, j, k) => {
    const key = keyOf(i, j, k);
    if (key === lastKey) return lastLeaf;
    let leaf = leaves.get(key);
    if (!leaf) {
      if (Math.abs(i) >= 524288 || Math.abs(j) >= 524288 || Math.abs(k) >= 524288) {
        throw new Error("Voxel index out of range — use a larger voxel size.");
      }
      leaf = { origin: [i & ~7, j & ~7, k & ~7], values: new Float32Array(LEAF_SIZE * spec.comps), active: new Uint8Array(LEAF_SIZE) };
      leaves.set(key, leaf);
    }
    lastKey = key; lastLeaf = leaf;
    return leaf;
  };
  const offset = (i, j, k) => ((i & 7) << 6) | ((j & 7) << 3) | (k & 7);
  return {
    name, type, gridClass, metadata, leaves,
    add(i, j, k, v) {
      const leaf = leafAt(i, j, k), n = offset(i, j, k);
      if (spec.comps === 1) leaf.values[n] += v;
      else { leaf.values[n * 3] += v[0]; leaf.values[n * 3 + 1] += v[1]; leaf.values[n * 3 + 2] += v[2]; }
      leaf.active[n] = 1;
    },
    set(i, j, k, v) {
      const leaf = leafAt(i, j, k), n = offset(i, j, k);
      if (spec.comps === 1) leaf.values[n] = v;
      else { leaf.values[n * 3] = v[0]; leaf.values[n * 3 + 1] = v[1]; leaf.values[n * 3 + 2] = v[2]; }
      leaf.active[n] = 1;
    },
    get(i, j, k) {
      const leaf = leaves.get(keyOf(i, j, k));
      if (!leaf) return spec.comps === 1 ? 0 : [0, 0, 0];
      const n = offset(i, j, k);
      return spec.comps === 1 ? leaf.values[n] : Array.from(leaf.values.subarray(n * 3, n * 3 + 3));
    },
    /** Apply fn(value) → value to every active scalar voxel (e.g. clamp after splatting). */
    map(fn) {
      if (spec.comps !== 1) throw new Error("map() is for scalar grids");
      for (const leaf of leaves.values()) {
        for (let n = 0; n < LEAF_SIZE; n++) if (leaf.active[n]) leaf.values[n] = fn(leaf.values[n]);
      }
    },
    get activeVoxelCount() {
      let c = 0;
      for (const leaf of leaves.values()) for (let n = 0; n < LEAF_SIZE; n++) c += leaf.active[n];
      return c;
    },
  };
}

// ── byte writer ───────────────────────────────────────────────────────────────

class Bytes {
  constructor(size = 1 << 16) { this.buf = new Uint8Array(size); this.view = new DataView(this.buf.buffer); this.pos = 0; }
  ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next; this.view = new DataView(next.buffer);
  }
  u8(v) { this.ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  u32(v) { this.ensure(4); this.view.setUint32(this.pos, v, true); this.pos += 4; }
  i32(v) { this.ensure(4); this.view.setInt32(this.pos, v, true); this.pos += 4; }
  i64(v) { this.ensure(8); this.view.setBigInt64(this.pos, BigInt(v), true); this.pos += 8; }
  f32(v) { this.ensure(4); this.view.setFloat32(this.pos, v, true); this.pos += 4; }
  f64(v) { this.ensure(8); this.view.setFloat64(this.pos, v, true); this.pos += 8; }
  raw(bytes) { this.ensure(bytes.length); this.buf.set(bytes, this.pos); this.pos += bytes.length; }
  ascii(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0x7f; this.raw(b); }
  str(s) { const b = new TextEncoder().encode(String(s)); this.u32(b.length); this.raw(b); }
  patchI64(at, v) { this.view.setBigInt64(at, BigInt(v), true); }
  result() { return this.buf.slice(0, this.pos); }
}

/** NodeMask::save — bit i lives in byte i>>3 (uint64 words, little-endian). */
function maskBytes(size, isOn) {
  const out = new Uint8Array(size >> 3);
  for (let i = 0; i < size; i++) if (isOn(i)) out[i >> 3] |= 1 << (i & 7);
  return out;
}

function uuid(rand = Math.random) {
  const h = () => Math.floor(rand() * 16).toString(16);
  const part = (n) => Array.from({ length: n }, h).join("");
  return `${part(8)}-${part(4)}-4${part(3)}-${"89ab"[Math.floor(rand() * 4)]}${part(3)}-${part(12)}`;
}

function writeMeta(w, entries) {
  w.u32(entries.length);
  for (const [name, typeName, value] of entries) {
    w.str(name); w.str(typeName);
    switch (typeName) {
      case "string": { const b = new TextEncoder().encode(String(value)); w.u32(b.length); w.raw(b); break; }
      case "bool": w.u32(1); w.u8(value ? 1 : 0); break;
      case "float": w.u32(4); w.f32(value); break;
      case "int64": w.u32(8); w.i64(value); break;
      case "vec3i": w.u32(12); value.forEach((v) => w.i32(v)); break;
      case "vec3s": w.u32(12); value.forEach((v) => w.f32(v)); break;
      default: throw new Error(`metadata type ${typeName}`);
    }
  }
}

/** Group the grid's leaves into root children (internal-5) → internal-4 → leaves, in file order. */
function buildTree(grid) {
  const roots = new Map();
  for (const leaf of grid.leaves.values()) {
    if (!leaf.active.some(Boolean)) continue;
    const [x, y, z] = leaf.origin;
    const r = [x & ~(INT2_SPAN - 1), y & ~(INT2_SPAN - 1), z & ~(INT2_SPAN - 1)];
    const rk = r.join(",");
    let root = roots.get(rk);
    if (!root) { root = { origin: r, children: new Map() }; roots.set(rk, root); }
    const n2 = (((x & (INT2_SPAN - 1)) >> 7) << 10) | (((y & (INT2_SPAN - 1)) >> 7) << 5) | ((z & (INT2_SPAN - 1)) >> 7);
    let mid = root.children.get(n2);
    if (!mid) { mid = { children: new Map() }; root.children.set(n2, mid); }
    const n1 = (((x & (INT1_SPAN - 1)) >> 3) << 8) | (((y & (INT1_SPAN - 1)) >> 3) << 4) | ((z & (INT1_SPAN - 1)) >> 3);
    mid.children.set(n1, leaf);
  }
  const byCoord = (a, b) => a.origin[0] - b.origin[0] || a.origin[1] - b.origin[1] || a.origin[2] - b.origin[2];
  return [...roots.values()].sort(byCoord).map((root) => ({
    origin: root.origin,
    children: [...root.children.entries()].sort((a, b) => a[0] - b[0]).map(([n2, mid]) => ({
      n2, children: [...mid.children.entries()].sort((a, b) => a[0] - b[0]),
    })),
  }));
}

function writeGrid(w, grid, transform) {
  const spec = TYPES[grid.type];
  const tree = buildTree(grid);

  w.str(grid.name);
  w.str(spec.tree);
  w.str("");                                   // instance parent
  const posAt = w.pos;
  w.i64(0); w.i64(0); w.i64(0);                // gridPos, blockPos, endPos (patched)
  const gridPos = w.pos;

  w.u32(COMPRESS_ACTIVE_MASK);

  // Grid metadata (incl. the file stats a reader may use before loading the tree).
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], count = 0;
  for (const leaf of grid.leaves.values()) {
    for (let n = 0; n < LEAF_SIZE; n++) {
      if (!leaf.active[n]) continue;
      const c = [leaf.origin[0] + (n >> 6), leaf.origin[1] + ((n >> 3) & 7), leaf.origin[2] + (n & 7)];
      for (let a = 0; a < 3; a++) { if (c[a] < min[a]) min[a] = c[a]; if (c[a] > max[a]) max[a] = c[a]; }
      count++;
    }
  }
  if (!count) { min = [0, 0, 0]; max = [0, 0, 0]; }
  const meta = [
    ["class", "string", grid.gridClass],
    ["file_bbox_max", "vec3i", max],
    ["file_bbox_min", "vec3i", min],
    ["file_voxel_count", "int64", count],
    ["name", "string", grid.name],
    ...(grid.type === "vec3s" ? [["vector_type", "string", "invariant"]] : []),
    ...Object.entries(grid.metadata || {}).map(([k, v]) => [k, typeof v === "number" ? "float" : "string", v]),
  ];
  writeMeta(w, meta);

  // Transform: index → world = index · voxelSize (+ translation), as an affine 4×4
  // (OpenVDB row-vector convention: translation in the last row).
  w.str("AffineMap");
  const s = transform.voxelSize, t = transform.translation || [0, 0, 0];
  [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, t[0], t[1], t[2], 1].forEach((v) => w.f64(v));

  // Topology.
  const zeroValues = () => { w.u8(NO_MASK_OR_INACTIVE_VALS); };     // all tiles inactive & 0
  w.i32(1);                                                       // buffer count
  for (let c = 0; c < spec.comps; c++) w.f32(0);                  // background
  w.u32(0);                                                       // tiles
  w.u32(tree.length);                                             // children
  for (const root of tree) {
    root.origin.forEach((v) => w.i32(v));
    const on2 = new Set(root.children.map((m) => m.n2));
    w.raw(maskBytes(INT2_SIZE, (i) => on2.has(i)));               // child mask
    w.raw(new Uint8Array(INT2_SIZE >> 3));                        // value mask (no active tiles)
    zeroValues();
    for (const mid of root.children) {
      const on1 = new Set(mid.children.map(([n1]) => n1));
      w.raw(maskBytes(INT1_SIZE, (i) => on1.has(i)));
      w.raw(new Uint8Array(INT1_SIZE >> 3));
      zeroValues();
      for (const [, leaf] of mid.children) w.raw(maskBytes(LEAF_SIZE, (i) => leaf.active[i]));
    }
  }

  // Buffers, in the same order.
  const blockPos = w.pos;
  for (const root of tree) {
    for (const mid of root.children) {
      for (const [, leaf] of mid.children) {
        w.raw(maskBytes(LEAF_SIZE, (i) => leaf.active[i]));
        w.u8(NO_MASK_OR_INACTIVE_VALS);
        for (let n = 0; n < LEAF_SIZE; n++) {
          if (!leaf.active[n]) continue;
          for (let c = 0; c < spec.comps; c++) w.f32(leaf.values[n * spec.comps + c]);
        }
      }
    }
  }
  const endPos = w.pos;
  w.patchI64(posAt, gridPos); w.patchI64(posAt + 8, blockPos); w.patchI64(posAt + 16, endPos);
}

/**
 * Encode grids as one .vdb file.
 * @param {Array} grids     from createGrid()
 * @param {object} options  { voxelSize (world units per voxel), translation?, rand? }
 * @returns {Uint8Array}
 */
export function encodeVDB(grids, { voxelSize = 0.05, translation = [0, 0, 0], rand = Math.random } = {}) {
  if (!(voxelSize > 0)) throw new Error("voxelSize must be > 0");
  const names = new Set();
  for (const g of grids) {
    if (names.has(g.name)) throw new Error(`Duplicate grid name: ${g.name}`);
    names.add(g.name);
  }
  const w = new Bytes();
  w.u32(MAGIC_LO); w.u32(0);                   // int64 magic
  w.u32(FILE_VERSION);
  w.u32(LIB_MAJOR); w.u32(LIB_MINOR);
  w.u8(1);                                     // has grid offsets
  w.ascii(uuid(rand));
  w.u32(0);                                    // file-level metadata: none
  w.i32(grids.length);
  for (const g of grids) writeGrid(w, g, { voxelSize, translation });
  return w.result();
}
