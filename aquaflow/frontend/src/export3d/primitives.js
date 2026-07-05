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
