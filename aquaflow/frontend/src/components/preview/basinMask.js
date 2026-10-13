/**
 * basinMask.js — AF-3D-017 (CAD/design render plan, Phase 0, P0 bug)
 *
 * One definition of "is this point in the water?" shared by every consumer:
 * GPU particle collision (mask texture), the CPU impact test that feeds the splash
 * map's calibrated L/min figures, and the ripple heightfield.
 *
 * THE BUG IT FIXES
 * ----------------
 * Before this module, a freeform / L-shaped basin was reduced to its bounding
 * RECTANGLE for physics. Water landing in the notch of an L was counted as
 * "contained", splashed like water-into-water and rippled a surface that does not
 * exist — so the spill figure for exactly the non-rectangular sites (where spill
 * matters most) was optimistic.
 *
 * SHAPES
 * ------
 * The API takes an ARRAY of basins, each `{ outer: [[x,z], ...], holes: [[[x,z], ...], ...] }`,
 * so multi-basin designs (AF-CAD-013) can drop in later without another contract
 * change. Islands are holes. Containment is "inside some outer AND not inside any of
 * that basin's holes".
 *
 * Circular and rectangular pools are converted to polygons for the generic `basins`
 * view, but they keep ANALYTIC fast paths for `contains()` and on the GPU, so their
 * containment — and therefore the calibrated spill L/min — is bit-for-bit what it
 * was before this module existed.
 *
 * COORDINATES
 * -----------
 * World metres, x across and z along — the same frame `centeredPoolPoints()`
 * produces (plan y → world +z). `basinsFromEngineering()` centres raw engineering
 * points with centeredPoolPoints itself, so there is exactly one centring rule.
 */

import { centeredPoolPoints } from "./basinGeometry";

/** Accept [x,z] pairs or {x,y}/{x,z} objects; drop anything non-finite. */
function toPairs(points = []) {
  const out = [];
  for (const p of points || []) {
    let x, z;
    if (Array.isArray(p)) { x = Number(p[0]); z = Number(p[1]); }
    else if (p && typeof p === "object") { x = Number(p.x); z = Number(p.z ?? p.y); }
    if (Number.isFinite(x) && Number.isFinite(z)) out.push([x, z]);
  }
  return out;
}

/** Even-odd ray test against one ring of [x,z] pairs. */
export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[i][0], az = ring[i][1];
    const bx = ring[j][0], bz = ring[j][1];
    if (((az > z) !== (bz > z)) && (x < ((bx - ax) * (z - az)) / ((bz - az) || 1e-12) + ax)) {
      inside = !inside;
    }
  }
  return inside;
}

function ringBounds(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** Normalise a basin list: valid outers (>= 3 points), valid holes, cached bounds. */
export function normalizeBasins(basins = []) {
  const list = Array.isArray(basins) ? basins : [basins];
  const out = [];
  for (const b of list) {
    const outer = toPairs(b?.outer);
    if (outer.length < 3) continue;
    const holes = (Array.isArray(b?.holes) ? b.holes : [])
      .map(toPairs).filter(h => h.length >= 3);
    out.push({ outer, holes, bounds: ringBounds(outer) });
  }
  return out;
}

/** Circle → polygon, for the generic basin view (containment stays analytic). */
export function circleToPolygon(radius, segments = 64) {
  const r = Math.max(0, Number(radius) || 0);
  const out = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** Centred rectangle → polygon. */
export function rectToPolygon(width, length) {
  const hw = (Number(width) || 0) / 2, hl = (Number(length) || 0) / 2;
  return [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]];
}

/**
 * Centre raw engineering basins with the SAME rule as centeredPoolPoints(): the
 * first basin's outer bounding-box centre is the world origin, and every other ring
 * (holes, further basins) shifts by the identical offset.
 *
 * @param {Array} rawBasins [{ outer:[{x,y}|[x,y]...], holes:[...] }]
 */
export function basinsFromEngineering(rawBasins = []) {
  const list = (Array.isArray(rawBasins) ? rawBasins : [rawBasins]).filter(Boolean);
  if (!list.length) return [];
  const firstRaw = toPairs(list[0].outer);
  const centred = centeredPoolPoints(firstRaw.map(([x, y]) => ({ x, y })));
  if (centred.length < 3) return [];
  const dx = firstRaw[0][0] - centred[0].x;
  const dz = firstRaw[0][1] - centred[0].y;
  const shift = ring => toPairs(ring).map(([x, z]) => [x - dx, z - dz]);
  return list.map(b => ({
    outer: shift(b.outer),
    holes: (b.holes || []).map(shift),
  }));
}

/**
 * Basins for the scene's current pool state.
 * @param {object} pool { poolType|type, radius, width, length, points:[{x,y}] (already centred) }
 */
export function basinsFromPool(pool = {}) {
  const type = pool.poolType || pool.type || "circular";
  if (type === "circular") return [{ outer: circleToPolygon(pool.radius || 6), holes: [] }];
  if ((type === "freeform" || type === "polygon") && (pool.points || []).length >= 3) {
    return [{ outer: toPairs(pool.points), holes: pool.holes || [] }];
  }
  return [{ outer: rectToPolygon(pool.width || 12, pool.length || 8), holes: [] }];
}

/**
 * Build the mask.
 *
 * @param {Array}  basins    [{outer, holes}] in world metres (already centred)
 * @param {object} opts
 * @param {number} opts.resolution  texels along the longer side of the bounds
 * @param {object} opts.analytic    optional exact shape for the fast paths:
 *                                   { type:"circular", radius } | { type:"rect", width, length }
 */
export function createBasinMask(basins, { resolution = 256, analytic = null } = {}) {
  const list = normalizeBasins(basins);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of list) {
    minX = Math.min(minX, b.bounds.minX); maxX = Math.max(maxX, b.bounds.maxX);
    minZ = Math.min(minZ, b.bounds.minZ); maxZ = Math.max(maxZ, b.bounds.maxZ);
  }
  const empty = !list.length;
  if (empty) { minX = maxX = minZ = maxZ = 0; }

  let kind = "polygon";
  let radius = 0, halfW = 0, halfL = 0;
  if (analytic?.type === "circular") {
    kind = "circular"; radius = Math.max(0, Number(analytic.radius) || 0);
  } else if (analytic?.type === "rect") {
    kind = "rect";
    halfW = (Number(analytic.width) || 0) / 2;
    halfL = (Number(analytic.length) || 0) / 2;
  }

  /** Exact containment. Hot path for the CPU impact test — no allocation. */
  const containsPolygon = (x, z) => {
    for (let i = 0; i < list.length; i++) {
      const b = list[i], bb = b.bounds;
      if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) continue;
      if (!pointInRing(x, z, b.outer)) continue;
      let inHole = false;
      for (let h = 0; h < b.holes.length; h++) {
        if (pointInRing(x, z, b.holes[h])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
    return false;
  };
  // Fast paths are written exactly as splashMap.insidePool always wrote them, so a
  // circular or rectangular pool's containment cannot drift by a rounding error.
  const contains = kind === "circular" ? (x, z) => x * x + z * z <= radius * radius
    : kind === "rect" ? (x, z) => Math.abs(x) <= halfW && Math.abs(z) <= halfL
    : containsPolygon;

  // Rasterise over the union bounds plus one texel of margin, so the edge texels
  // sample cleanly with nearest filtering.
  const spanX = Math.max(1e-6, maxX - minX), spanZ = Math.max(1e-6, maxZ - minZ);
  const longest = Math.max(spanX, spanZ);
  const res = Math.max(8, Math.floor(resolution));
  const cell = longest / (res - 2);
  const width = Math.max(4, Math.ceil(spanX / cell) + 2);
  const height = Math.max(4, Math.ceil(spanZ / cell) + 2);
  const originX = minX - cell, originZ = minZ - cell;
  const data = new Uint8Array(width * height * 4);
  let insideTexels = 0;
  if (!empty) {
    for (let j = 0; j < height; j++) {
      const z = originZ + (j + 0.5) * cell;
      for (let i = 0; i < width; i++) {
        const x = originX + (i + 0.5) * cell;
        const v = contains(x, z) ? 255 : 0;
        const o = (j * width + i) * 4;
        data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
        if (v) insideTexels++;
      }
    }
  }

  const sizeX = width * cell, sizeZ = height * cell;
  return {
    kind,
    basins: list,
    empty,
    bounds: { minX, maxX, minZ, maxZ, width: maxX - minX, length: maxZ - minZ },
    width, height, cell, data, insideTexels,
    /** origin + inverse size, the layout the GPU shader expects in one vec4 */
    gpuBounds: [originX, originZ, 1 / sizeX, 1 / sizeZ],
    origin: [originX, originZ],
    contains,
    containsExact: kind === "polygon" ? containsPolygon : contains,
    /** Nearest-texel raster lookup — the value the GPU sees. */
    sample(x, z) {
      const i = Math.floor((x - originX) / cell), j = Math.floor((z - originZ) / cell);
      if (i < 0 || j < 0 || i >= width || j >= height) return 0;
      return data[(j * width + i) * 4] / 255;
    },
    /** Lazily build (and cache) the three.js DataTexture. */
    texture(T) {
      if (this._tex) return this._tex;
      const tx = new T.DataTexture(data, width, height, T.RGBAFormat);
      tx.minFilter = tx.magFilter = T.NearestFilter;
      tx.wrapS = tx.wrapT = T.ClampToEdgeWrapping;
      tx.generateMipmaps = false;
      if (T.NoColorSpace) tx.colorSpace = T.NoColorSpace;
      tx.needsUpdate = true;
      this._tex = tx;
      return tx;
    },
    dispose() { this._tex?.dispose?.(); this._tex = null; },
  };
}

/**
 * Convenience: the mask for the scene's current pool fields.
 * @param {object} pool { type:"circular"|"rect"|"freeform", radius, width, length, points, holes }
 */
export function basinMaskForPool(pool = {}, opts = {}) {
  const type = pool.poolType || pool.type || "circular";
  const polygonal = (type === "freeform" || type === "polygon") && (pool.points || []).length >= 3;
  const analytic = type === "circular" ? { type: "circular", radius: pool.radius || 6 }
    : polygonal ? null
    : { type: "rect", width: pool.width || 12, length: pool.length || 8 };
  return createBasinMask(basinsFromPool(pool), { ...opts, analytic });
}

/**
 * Drop triangles of a flat basin mesh (built in the rotated shape plane, local
 * y = -world z) whose centroid falls outside the mask — used to cut islands out of
 * the tessellated water surface. Returns the same geometry, re-indexed.
 */
export function clipGeometryToMask(geometry, mask) {
  if (!geometry?.index || !mask || mask.kind !== "polygon" || !mask.basins.some(b => b.holes.length)) return geometry;
  const pos = geometry.attributes.position;
  const idx = geometry.index.array;
  const kept = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const z = -(pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    if (mask.contains(x, z)) kept.push(a, b, c);
  }
  geometry.setIndex(kept);
  return geometry;
}
