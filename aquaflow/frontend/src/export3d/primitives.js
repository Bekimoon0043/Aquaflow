/**
 * primitives.js — AQ-X-016 AquaFlow 3D Export Bridge
 *
 * Dependency-free triangle-mesh generators. Each returns a plain mesh:
 *   { positions:number[], normals:number[], indices:number[] }
 * where positions/normals are flat XYZ triples and indices are triangle
 * vertex indices (0-based). No three.js — these run headlessly in Node and
 * in the browser, so the serializers below can be unit-tested without a DOM.
 *
 * Axis convention matches the app's 3D/world space (see fixtureTypeMap.js):
 *   +Y is up, the XZ plane is the ground/pool plane.
 */

// ── mesh helpers ─────────────────────────────────────────────────────────────

/** An empty mesh accumulator. */
function emptyMesh() {
  return { positions: [], normals: [], indices: [] };
}

/** Append a triangle from three {x,y,z}-ish arrays, computing a flat normal. */
function pushTriangle(mesh, a, b, c) {
  const base = mesh.positions.length / 3;
  // Flat face normal via the cross product of two edges.
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  for (const p of [a, b, c]) {
    mesh.positions.push(p[0], p[1], p[2]);
    mesh.normals.push(nx, ny, nz);
  }
  mesh.indices.push(base, base + 1, base + 2);
}

/** Append a quad (a→b→c→d, CCW) as two triangles. */
function pushQuad(mesh, a, b, c, d) {
  pushTriangle(mesh, a, b, c);
  pushTriangle(mesh, a, c, d);
}

// ── primitive builders ───────────────────────────────────────────────────────

/**
 * Axis-aligned box centred on the origin (before translation).
 * @param {number} w width (x), @param {number} h height (y), @param {number} d depth (z)
 */
export function box(w = 1, h = 1, d = 1) {
  const mesh = emptyMesh();
  const x = w / 2, y = h / 2, z = d / 2;
  const p = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], // back  (z-)
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],      // front (z+)
  ];
  pushQuad(mesh, p[4], p[5], p[6], p[7]); // front
  pushQuad(mesh, p[1], p[0], p[3], p[2]); // back
  pushQuad(mesh, p[0], p[4], p[7], p[3]); // left
  pushQuad(mesh, p[5], p[1], p[2], p[6]); // right
  pushQuad(mesh, p[3], p[7], p[6], p[2]); // top
  pushQuad(mesh, p[0], p[1], p[5], p[4]); // bottom
  return mesh;
}

/**
 * Vertical cylinder along +Y, base at y=0, capped both ends.
 * @param {number} rBottom bottom radius, @param {number} rTop top radius,
 * @param {number} height, @param {number} segments radial segments.
 */
export function cylinder(rBottom = 0.5, rTop = 0.5, height = 1, segments = 16) {
  const mesh = emptyMesh();
  const seg = Math.max(3, Math.floor(segments));
  const bottomC = [0, 0, 0];
  const topC = [0, height, 0];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const b0 = [c0 * rBottom, 0, s0 * rBottom];
    const b1 = [c1 * rBottom, 0, s1 * rBottom];
    const t0 = [c0 * rTop, height, s0 * rTop];
    const t1 = [c1 * rTop, height, s1 * rTop];
    // Side (wound so the outward normal faces away from the axis).
    pushQuad(mesh, b0, b1, t1, t0);
    // Caps.
    pushTriangle(mesh, bottomC, b1, b0); // bottom faces down
    pushTriangle(mesh, topC, t0, t1);    // top faces up
  }
  return mesh;
}

/** Cone along +Y, base radius r at y=0, apex at y=height. */
export function cone(r = 0.5, height = 1, segments = 16) {
  return cylinder(r, 0.0001, height, segments);
}

/**
 * Flat horizontal disc on the XZ plane at y=0 (top face up).
 * Used for circular pool water surfaces.
 */
export function disc(radius = 1, segments = 48) {
  const mesh = emptyMesh();
  const seg = Math.max(3, Math.floor(segments));
  const c = [0, 0, 0];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = [Math.cos(a0) * radius, 0, Math.sin(a0) * radius];
    const p1 = [Math.cos(a1) * radius, 0, Math.sin(a1) * radius];
    pushTriangle(mesh, c, p0, p1); // wound so the normal points +Y
  }
  return mesh;
}

/**
 * Flat horizontal rectangle on the XZ plane at y=0 (top face up), centred.
 * Used for rectangular pool water surfaces.
 */
export function plane(w = 1, d = 1) {
  const mesh = emptyMesh();
  const x = w / 2, z = d / 2;
  pushQuad(mesh, [-x, 0, -z], [-x, 0, z], [x, 0, z], [x, 0, -z]);
  return mesh;
}

/**
 * Polygon prism: an arbitrary XZ footprint (array of {x,y} plan points, where
 * plan-y maps to world-z) extruded from y=0 up to `height`, with a top cap.
 * Used for freeform / L-shape / lake pool basins.
 */
export function prism(footprint, height = 0.4) {
  const mesh = emptyMesh();
  const pts = (footprint || []).map((p) => [Number(p.x) || 0, Number(p.y ?? p.z) || 0]);
  if (pts.length < 3) return mesh;
  // Top cap via a simple fan (footprints here are convex-ish plan outlines).
  const topY = height;
  for (let i = 1; i < pts.length - 1; i++) {
    pushTriangle(mesh,
      [pts[0][0], topY, pts[0][1]],
      [pts[i][0], topY, pts[i][1]],
      [pts[i + 1][0], topY, pts[i + 1][1]]);
  }
  // Side walls.
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    pushQuad(mesh,
      [a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], topY, b[1]], [a[0], topY, a[1]]);
  }
  return mesh;
}

// ── plan polygons (absolute plan coordinates: plan x → world x, plan y → world z) ──

/** Plan points as [x, z] pairs, without a repeated closing point. */
function planPoints(footprint) {
  const pts = (footprint || []).map((p) => [Number(p.x) || 0, Number(p.y ?? p.z) || 0]);
  if (pts.length > 2) {
    const [a, b] = [pts[0], pts.at(-1)];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) pts.pop();
  }
  return pts;
}

/** Signed area in the XZ plan (positive = counter-clockwise seen from +Y). */
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/**
 * Ear-clipping triangulation of a simple plan polygon (convex or concave).
 * Returns index triples into `pts`, wound so a face built from them points +Y.
 */
export function triangulatePlan(footprint) {
  const pts = Array.isArray(footprint?.[0]) ? footprint : planPoints(footprint);
  const n = pts.length;
  if (n < 3) return [];
  // +Y normal for (a,b,c) with plan (x,z) needs clockwise order when seen from +Y.
  const order = [...Array(n).keys()];
  if (signedArea(pts) > 0) order.reverse();
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p, a, b, c) => {
    const d1 = cross(p, a, b), d2 = cross(p, b, c), d3 = cross(p, c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const tris = [];
  const v = order.slice();
  let guard = 0;
  while (v.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < v.length; i++) {
      const ia = v[(i + v.length - 1) % v.length], ib = v[i], ic = v[(i + 1) % v.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross(a, b, c) >= 0) continue; // reflex or flat in this (clockwise) order
      let ear = true;
      for (const j of v) if (j !== ia && j !== ib && j !== ic && inside(pts[j], a, b, c)) { ear = false; break; }
      if (!ear) continue;
      tris.push([ia, ib, ic]);
      v.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate outline: fall back to a fan for the rest
  }
  if (v.length === 3) tris.push([v[0], v[1], v[2]]);
  else for (let i = 1; i < v.length - 1; i++) tris.push([v[0], v[i], v[i + 1]]);
  return tris;
}

/** Flat horizontal surface over a plan outline at height y, facing up. */
export function planCap(footprint, y = 0) {
  const mesh = emptyMesh();
  const pts = planPoints(footprint);
  for (const [a, b, c] of triangulatePlan(pts)) {
    pushTriangle(mesh, [pts[a][0], y, pts[a][1]], [pts[b][0], y, pts[b][1]], [pts[c][0], y, pts[c][1]]);
  }
  return mesh;
}

/** A thin slab over a plan outline, from y0 up to y1 (top cap + side walls). */
export function planSlab(footprint, y0 = 0, y1 = 0.05) {
  const mesh = planCap(footprint, y1);
  const pts = planPoints(footprint);
  const ccw = signedArea(pts) > 0;
  for (let i = 0; i < pts.length; i++) {
    let a = pts[i], b = pts[(i + 1) % pts.length];
    if (!ccw) [a, b] = [b, a];
    // Outward-facing wall for a counter-clockwise (seen from +Y) outline.
    pushQuad(mesh, [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], [b[0], y0, b[1]]);
  }
  return mesh;
}

/**
 * An open pool shell: floor at -depth, walls up to the rim (y = 0), with faces on both
 * sides of the walls so the inside of the pool renders in every viewer.
 */
export function poolShell(footprint, depth = 0.8) {
  const mesh = emptyMesh();
  const pts = planPoints(footprint);
  for (const [a, b, c] of triangulatePlan(pts)) {
    pushTriangle(mesh, [pts[a][0], -depth, pts[a][1]], [pts[b][0], -depth, pts[b][1]], [pts[c][0], -depth, pts[c][1]]);
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const lo = (p) => [p[0], -depth, p[1]], hi = (p) => [p[0], 0, p[1]];
    pushQuad(mesh, lo(a), hi(a), hi(b), lo(b));
    pushQuad(mesh, lo(b), hi(b), hi(a), lo(a));
  }
  return mesh;
}

/** Plan outline of a circle / rectangle centred on (cx, cz), as {x, y} plan points. */
export function circleOutline(cx, cz, radius, segments = 48) {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return { x: cx + Math.cos(a) * radius, y: cz + Math.sin(a) * radius };
  });
}
export function rectOutline(cx, cz, w, l) {
  return [{ x: cx - w / 2, y: cz - l / 2 }, { x: cx + w / 2, y: cz - l / 2 }, { x: cx + w / 2, y: cz + l / 2 }, { x: cx - w / 2, y: cz + l / 2 }];
}

/**
 * UV sphere centred on the origin. Used as a light/marker glyph.
 */
export function sphere(radius = 0.5, segments = 12, rings = 8) {
  const mesh = emptyMesh();
  const seg = Math.max(3, Math.floor(segments));
  const rng = Math.max(2, Math.floor(rings));
  const vert = (ring, s) => {
    const phi = (ring / rng) * Math.PI;        // 0..π  (top → bottom)
    const theta = (s / seg) * Math.PI * 2;      // 0..2π
    const y = Math.cos(phi) * radius;
    const rr = Math.sin(phi) * radius;
    return [Math.cos(theta) * rr, y, Math.sin(theta) * rr];
  };
  for (let ring = 0; ring < rng; ring++) {
    for (let s = 0; s < seg; s++) {
      const a = vert(ring, s);
      const b = vert(ring + 1, s);
      const c = vert(ring + 1, s + 1);
      const d = vert(ring, s + 1);
      pushQuad(mesh, a, b, c, d);
    }
  }
  return mesh;
}

/** Total triangle count across a list of meshes. */
export function triangleCount(mesh) {
  return mesh ? mesh.indices.length / 3 : 0;
}
