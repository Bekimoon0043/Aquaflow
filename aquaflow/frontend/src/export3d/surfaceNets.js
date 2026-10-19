/**
 * surfaceNets.js — iso-surface of a sparse density grid (openvdb.js createGrid) as a closed
 * triangle mesh (naive surface nets): one vertex per cell the surface crosses, placed at the
 * mean of its edge crossings; two triangles per voxel edge the surface cuts. Triangles wind
 * counter-clockwise seen from outside (low density).
 */

const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
// 17 bits per axis (±65 536 voxels) keeps the packed key below 2^53, so it stays exact.
const OFF = 1 << 16;
const cellKey = (i, j, k) => ((i + OFF) * 131072 + (j + OFF)) * 131072 + (k + OFF);

/**
 * @param {object} grid     scalar grid with get(i,j,k) and leaves
 * @param {object} options  { iso, voxelSize, colorGrid?: vec3 grid sampled at vertices }
 * @returns {{ positions: Float32Array, indices: Int32Array, colors: Float32Array|null }}
 */
export function meshFromDensity(grid, { iso = 0.2, voxelSize = 0.05, colorGrid = null } = {}) {
  // Cells (min corner) that can contain the surface: any cell touching an active voxel.
  const cells = new Map();
  for (const leaf of grid.leaves.values()) {
    const [ox, oy, oz] = leaf.origin;
    for (let n = 0; n < 512; n++) {
      if (!leaf.active[n]) continue;
      const x = ox + (n >> 6), y = oy + ((n >> 3) & 7), z = oz + (n & 7);
      for (let c = 0; c < 8; c++) {
        const i = x - (c & 1), j = y - ((c >> 1) & 1), k = z - (c >> 2);
        const kk = cellKey(i, j, k);
        if (!cells.has(kk)) cells.set(kk, [i, j, k]);
      }
    }
  }
  const vertexOf = new Map();
  const pos = [], col = [];
  const vals = new Float64Array(8);
  for (const [kk, [i, j, k]] of cells) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const [a, b, d] = CORNERS[c];
      vals[c] = grid.get(i + a, j + b, k + d);
      if (vals[c] > iso) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [e0, e1] of EDGES) {
      const in0 = (mask >> e0) & 1, in1 = (mask >> e1) & 1;
      if (in0 === in1) continue;
      const t = (iso - vals[e0]) / (vals[e1] - vals[e0]);
      const p0 = CORNERS[e0], p1 = CORNERS[e1];
      sx += p0[0] + t * (p1[0] - p0[0]); sy += p0[1] + t * (p1[1] - p0[1]); sz += p0[2] + t * (p1[2] - p0[2]);
      n++;
    }
    const vx = i + sx / n, vy = j + sy / n, vz = k + sz / n;
    vertexOf.set(kk, pos.length / 3);
    pos.push(vx * voxelSize, vy * voxelSize, vz * voxelSize);
    if (colorGrid) {
      const c = colorGrid.get(Math.round(vx), Math.round(vy), Math.round(vz));
      col.push(c[0], c[1], c[2]);
    }
  }
  // Faces: for each grid edge from voxel (x,y,z) along an axis that crosses the iso level,
  // join the four cells around it.
  const idx = [];
  const around = [
    // axis x: cells share the edge (x..x+1, y, z) → cells (x, y-1..y, z-1..z)
    [[0, 0, 0], [0, -1, 0], [0, -1, -1], [0, 0, -1]],
    // axis y
    [[0, 0, 0], [0, 0, -1], [-1, 0, -1], [-1, 0, 0]],
    // axis z
    [[0, 0, 0], [-1, 0, 0], [-1, -1, 0], [0, -1, 0]],
  ];
  const step = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const [, [i, j, k]] of cells) {
    const v0 = grid.get(i, j, k) > iso;
    for (let ax = 0; ax < 3; ax++) {
      const [dx, dy, dz] = step[ax];
      const v1 = grid.get(i + dx, j + dy, k + dz) > iso;
      if (v0 === v1) continue;
      const q = [];
      for (const [a, b, c] of around[ax]) {
        const vi = vertexOf.get(cellKey(i + a, j + b, k + c));
        if (vi === undefined) break;
        q.push(vi);
      }
      if (q.length !== 4) continue;
      // Orientation: normals point from inside (dense) to outside.
      if (v0) { idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); }
      else { idx.push(q[0], q[2], q[1], q[0], q[3], q[2]); }
    }
  }
  return {
    positions: new Float32Array(pos),
    indices: new Int32Array(idx),
    colors: colorGrid ? new Float32Array(col) : null,
  };
}
