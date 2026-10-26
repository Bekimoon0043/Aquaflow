/**
 * elevatedNozzles.js — elevated, aimed nozzles and steel frames (front-facing sculptures).
 *
 * A fountain is not always a field of upright jets in a basin floor: a sculpture can
 * carry nozzles on a steel frame metres above the water, pointing in any direction —
 * fans aimed inward round a ring to draw a sun, crystal-ball (dandelion) heads in a
 * canopy, fans aimed straight down for a trunk. This module holds the pure geometry for
 * that; nozzleEmitters.js applies it to the emitter descriptors, FountainScene draws it.
 *
 * FIELDS (all optional; a fixture without any of them renders exactly as before).
 * Read from fixture.engineering.* first, then the top-level fixture / config:
 *
 *   mountHeightM     m above the water surface where the nozzle sits. Every emitter starts
 *                    there; design heights / reaches are measured from it.
 *   aimDeg           aim from vertical, degrees: 0 up, 90 horizontal, 180 straight down
 *                    (any real value; e.g. -45 leans to the opposite side of the azimuth).
 *   aimAzimuthDeg    plan direction of the vertical plane the aim lies in, degrees,
 *                    measured from plan +x toward plan +y (the same convention as a fan's
 *                    `rotation`). 0 = toward +x, 90 = toward +y, 180 = toward -x.
 *                    Defaults to the fixture's `rotation`, else 0.
 *   reachM           straight-line reach along the aim, m (see solveReachSpeed). Falls back
 *                    to the design jet height (jetHeightM).
 *   fanAngleDeg      full opening angle of a fan, degrees (falls back to sprayAngleDeg).
 *   fanPlane         'aim' (default): the fan opens in the vertical plane containing the
 *                    aim; 'cross': it opens across the aim (horizontally for a level aim).
 *   catchAtM         m above the water: a catch tray collects this nozzle's water at that
 *                    height (must be below the mount). Water stops there; nothing lands in
 *                    the basin.
 *   sphereRadiusM    crystal-ball radius, m (else sphereDiameterM / 2, else jetHeightM / 2).
 *   sphereCoverageDeg  solid opening of the ball around its axis, degrees (default 300:
 *                    the 60° cone round the stem below is open).
 *   support          'none' suppresses the automatic stainless support pipe drawn from the
 *                    water to an elevated nozzle's mount.
 *
 * World axes (as everywhere in the preview): x = plan x, y = height, z = plan y.
 * Pure: no three.js, no WebGL.
 */

import { RENDER_PHYSICS, SOLVER_DT } from "./designTrajectory";

const DEG = Math.PI / 180;

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** A field from engineering.* first, then the fixture/config itself. */
export function fieldOf(cfg, key) {
  return num(cfg?.engineering?.[key]) ?? num(cfg?.[key]);
}
function strField(cfg, key) {
  const v = cfg?.engineering?.[key] ?? cfg?.[key];
  return typeof v === "string" ? v.trim().toLowerCase() : null;
}

/** Highest mount the preview accepts (a typo of 6300 must not launch water into orbit). */
export const MAX_MOUNT_M = 200;

/** m above the water, 0 when absent / not positive. */
export function mountHeightOf(cfg) {
  const m = fieldOf(cfg, "mountHeightM");
  return m != null && m > 0 ? Math.min(MAX_MOUNT_M, m) : 0;
}

/** Catch-tray height (m above the water), or null. Only meaningful below the mount. */
export function catchHeightOf(cfg) {
  const c = fieldOf(cfg, "catchAtM");
  if (c == null || !(c > 0)) return null;
  return c < mountHeightOf(cfg) ? c : null;
}

/** Unit direction for an aim (degrees from vertical) in the plane at an azimuth (plan degrees). */
export function aimDirection(aimDeg, azimuthDeg = 0) {
  const a = (Number(aimDeg) || 0) * DEG, p = (Number(azimuthDeg) || 0) * DEG;
  return [Math.sin(a) * Math.cos(p), Math.cos(a), Math.sin(a) * Math.sin(p)];
}

/**
 * The fixture's aim, or null when it has no aimDeg (then tiltX/tiltZ rule as before).
 * @returns {{aimDeg:number, azimuthDeg:number, dir:number[]}|null}
 */
export function aimOf(cfg) {
  const aimDeg = fieldOf(cfg, "aimDeg");
  if (aimDeg == null) return null;
  const azimuthDeg = fieldOf(cfg, "aimAzimuthDeg") ?? num(cfg?.rotation) ?? 0;
  return { aimDeg, azimuthDeg, dir: aimDirection(aimDeg, azimuthDeg) };
}

/**
 * Second axis of a fan's sweep (unit, perpendicular to the aim). A fan sweeps
 * cos θ · aim + sin θ · u for θ in [-half, +half].
 *   'aim'   u lies in the aim's vertical plane: the aim turned 90° further over
 *           (a fan aimed 180° opens a downward triangle in that plane)
 *   'cross' u is horizontal, across the aim's plane
 */
export function fanAxis(aimDeg, azimuthDeg = 0, plane = "aim") {
  const p = (Number(azimuthDeg) || 0) * DEG;
  if (plane === "cross") return [-Math.sin(p), 0, Math.cos(p)];
  return aimDirection((Number(aimDeg) || 0) + 90, azimuthDeg);
}

/** 'aim' | 'cross' */
export function fanPlaneOf(cfg) {
  return strField(cfg, "fanPlane") === "cross" ? "cross" : "aim";
}

/** Full fan opening, degrees, or null (fanAngleDeg, else sprayAngleDeg). */
export function fanAngleOf(cfg) {
  const f = fieldOf(cfg, "fanAngleDeg");
  if (f != null && f > 0) return Math.min(178, f);
  const s = fieldOf(cfg, "sprayAngleDeg");
  return s != null && s > 0 ? Math.min(178, s) : null;
}

/** Straight-line reach along the aim (m): reachM, else the design jet height, else null. */
export function reachOf(cfg) {
  const r = fieldOf(cfg, "reachM");
  if (r != null && r > 0) return r;
  const h = num(cfg?.designHeightM) ?? fieldOf(cfg, "jetHeightM");
  return h != null && h > 0 ? h : null;
}

/** The new preview type for crystal-ball / dandelion / water-sphere nozzles. */
export const SPHERE_TYPE = "sphere";

/** Does this fixture use any of the elevated / aimed features? */
export function hasSpatialFeatures(cfg) {
  return mountHeightOf(cfg) > 0 || aimOf(cfg) != null || catchHeightOf(cfg) != null
    || cfg?.type === SPHERE_TYPE;
}

// ─── Reach along an aim ─────────────────────────────────────────────────────
//
// DEFINITION. A jet / fan sheet aimed at `aim` with reach R is drawn so that it travels
// R metres along its aim line, under the renderer's gravity and drag, while staying
// within SAG_FRACTION · R of that line (the sheet still reads as pointing where it is
// aimed). The launch speed is the smallest speed that does both:
//   aim 0°   (up)          → the drawn apex is R (identical to the design-height rule)
//   aim 90°  (horizontal)  → it has dropped ≤ 20 % of R when it is R out
//   aim 180° (down)        → gravity helps; the floor speed MIN_REACH_FRACTION · √(2gR)
//                            keeps the sheet coherent
// Fan sheets break up at the reach (their particles end there and a droplet layer
// carries on to the water / tray); jets fly their full ballistic course.

/** Allowed sideways sag at the reach, as a fraction of the reach. */
export const SAG_FRACTION = 0.2;
/** Floor launch speed, as a fraction of the drag-free vertical speed √(2gR). */
export const MIN_REACH_FRACTION = 0.5;
const REACH_MAX_T = 30;

const reachCache = new Map();

/**
 * Fly a launch at speed v along `aimRad` (from vertical) until the stream has travelled
 * `R` along the aim, or can no longer get there.
 * @returns {{reached:boolean, t:number, sag:number}}
 */
export function flyAlongAim(v, aimRad, R, phys = RENDER_PHYSICS.water, dt = SOLVER_DT) {
  const sa = Math.sin(aimRad), ca = Math.cos(aimRad);
  const sh = Math.abs(sa);           // horizontal component magnitude (plane coordinates)
  const g = phys.gravity, k = phys.drag;
  let s = 0, y = 0, u = v * sh, w = v * ca, t = 0;
  for (let i = 0; t < REACH_MAX_T; i++) {
    const sp = Math.sqrt(u * u + w * w);
    u += (-u * k * sp) * dt;
    w += (-g - w * k * sp) * dt;
    const ns = s + u * dt, ny = y + w * dt;
    t += dt;
    const proj = ns * sh + ny * ca;
    if (proj >= R) {
      // Interpolate the crossing within the step.
      const p0 = s * sh + y * ca;
      const f = proj > p0 ? (R - p0) / (proj - p0) : 1;
      const xs = s + (ns - s) * f, xy = y + (ny - y) * f;
      return { reached: true, t: t - dt + dt * f, sag: Math.abs(xs * ca - xy * sh) };
    }
    // Moving away from the reach along the aim and decelerating: it never gets there.
    if (u * sh + w * ca <= 0 && ca >= 0) return { reached: false, t, sag: Infinity };
    s = ns; y = ny;
  }
  return { reached: false, t, sag: Infinity };
}

/**
 * Launch speed (m/s) whose drawn stream reaches `R` along an aim of `aimDeg` from
 * vertical (see DEFINITION above). Memoised.
 */
export function solveReachSpeed(R, aimDeg, phys = RENDER_PHYSICS.water) {
  if (!(R > 0)) return 0;
  // Only the angle from vertical matters (0..180).
  let a = Math.abs(Number(aimDeg) || 0) % 360;
  if (a > 180) a = 360 - a;
  const key = `${R.toFixed(4)}|${a.toFixed(3)}|${phys.gravity}/${phys.drag}`;
  const hit = reachCache.get(key);
  if (hit !== undefined) return hit;
  const aimRad = a * DEG;
  const ok = (v) => {
    const r = flyAlongAim(v, aimRad, R, phys);
    return r.reached && r.sag <= SAG_FRACTION * R;
  };
  const floor = MIN_REACH_FRACTION * Math.sqrt(2 * phys.gravity * R);
  let v;
  if (ok(floor)) v = floor;
  else {
    let lo = floor, hi = Math.max(floor * 2, Math.sqrt(2 * phys.gravity * R) * 1.2);
    for (let i = 0; i < 20 && !ok(hi); i++) { lo = hi; hi *= 1.6; }
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) hi = mid; else lo = mid;
      if (hi - lo < 1e-4 * hi) break;
    }
    v = hi;
  }
  if (reachCache.size > 20000) reachCache.clear();
  reachCache.set(key, v);
  return v;
}

/** Time (s) for a launch of speed v along aimDeg to travel R along the aim (null if never). */
export function reachTime(v, aimDeg, R, phys = RENDER_PHYSICS.water) {
  const key = `T|${Number(v).toFixed(4)}|${(Number(aimDeg) || 0).toFixed(3)}|${Number(R).toFixed(4)}|${phys.gravity}/${phys.drag}`;
  const hit = reachCache.get(key);
  if (hit !== undefined) return hit;
  const r = flyAlongAim(v, (Number(aimDeg) || 0) * DEG, R, phys);
  const t = r.reached ? r.t : null;
  if (reachCache.size > 20000) reachCache.clear();
  reachCache.set(key, t);
  return t;
}

/** Angle from vertical (degrees, 0..180) of a direction vector (array or x, y, z). */
export function aimDegOfVector(d, y, z) {
  const x = Array.isArray(d) ? d[0] : d, yy = Array.isArray(d) ? d[1] : y, zz = Array.isArray(d) ? d[2] : z;
  const n = Math.hypot(x, yy, zz) || 1;
  return Math.acos(Math.max(-1, Math.min(1, yy / n))) / DEG;
}

// ─── Crystal ball / dandelion ───────────────────────────────────────────────

/** Default opening of a crystal ball: 300° of streams, the stem's 60° cone left open. */
export const DEFAULT_SPHERE_COVERAGE_DEG = 300;

/** Full (100 %) ball radius, m. */
export function sphereRadiusOf(cfg) {
  const r = fieldOf(cfg, "sphereRadiusM");
  if (r != null && r > 0) return r;
  const d = fieldOf(cfg, "sphereDiameterM");
  if (d != null && d > 0) return d / 2;
  const h = num(cfg?.designHeightM) ?? fieldOf(cfg, "jetHeightM");
  return h != null && h > 0 ? h / 2 : 0.5;
}

/** cos of the ball's half-opening around its axis (300° → cos 150°). */
export function sphereCoverageCos(cfg) {
  const c = fieldOf(cfg, "sphereCoverageDeg");
  const deg = c != null && c > 0 ? Math.min(360, c) : DEFAULT_SPHERE_COVERAGE_DEG;
  return Math.cos((deg / 2) * DEG);
}

/** Stream speed for a ball of radius R: fast enough that gravity sags a level stream
 *  by under 10 % of R before it reaches the rim (glassy, straight streams). */
export function sphereStreamSpeed(R, phys = RENDER_PHYSICS.water) {
  return R > 0 ? Math.sqrt(5 * phys.gravity * R) : 0;
}

/**
 * A direction in a ball of streams: uniform over the cap of half-angle acos(coverageCos)
 * around `axis`. u1, u2 in [0,1). Pure — the CPU twin of the shader's SPHERE spawn.
 */
export function sphereDirection(u1, u2, coverageCos, axis = [0, 1, 0], out = [0, 0, 0]) {
  const ct = 1 - u1 * (1 - coverageCos);
  const st = Math.sqrt(Math.max(0, 1 - ct * ct));
  const ph = u2 * 2 * Math.PI;
  const nx = axis[0], ny = axis[1], nz = axis[2];
  // b1 = normalize(cross(h, n)), b2 = cross(n, b1) — inline, no allocation (per particle).
  const hx = Math.abs(ny) < 0.999 ? 0 : 1, hy = Math.abs(ny) < 0.999 ? 1 : 0;
  let x = hy * nz, y = -hx * nz, z = hx * ny - hy * nx;
  const l = Math.hypot(x, y, z) || 1;
  x /= l; y /= l; z /= l;
  const bx = ny * z - nz * y, by = nz * x - nx * z, bz = nx * y - ny * x;
  const cx = Math.cos(ph) * st, cz = Math.sin(ph) * st;
  out[0] = nx * ct + x * cx + bx * cz;
  out[1] = ny * ct + y * cx + by * cz;
  out[2] = nz * ct + z * cx + bz * cz;
  return out;
}

/** Two unit vectors completing an orthonormal basis with unit `n`. Same as the shader. */
export function basisAround(n) {
  const h = Math.abs(n[1]) < 0.999 ? [0, 1, 0] : [1, 0, 0];
  // b1 = normalize(cross(h, n)), b2 = cross(n, b1)
  let x = h[1] * n[2] - h[2] * n[1], y = h[2] * n[0] - h[0] * n[2], z = h[0] * n[1] - h[1] * n[0];
  const l = Math.hypot(x, y, z) || 1;
  x /= l; y /= l; z /= l;
  const b2 = [n[1] * z - n[2] * y, n[2] * x - n[0] * z, n[0] * y - n[1] * x];
  return [[x, y, z], b2];
}

// ─── Steel frames ───────────────────────────────────────────────────────────

/** Fixture types drawn as steel frames: scenery, never programmable outputs. */
export function isSteelFrameType(type) {
  const k = String(type || "").trim().toLowerCase();
  return k === "steel_frame" || k.startsWith("steel_frame_") || k === "frame_steel" || k === "sculpture_frame";
}

export const DEFAULT_TUBE_DIAMETER_MM = 60;
export const SUPPORT_PIPE_DIAMETER_MM = 48;
const MAX_TUBE_POINTS = 2000;

/**
 * Validate and normalise a steel frame's tubes.
 * Input: fixture.engineering.tubes (or fixture.tubes) = [{ points: [[x, y, z], …],
 * diameterMm?, closed? }] — x, y in PLAN metres (y = plan depth), z = height above the
 * water, metres. `relative: true` on the fixture (or engineering) offsets points by the
 * fixture's own plan x/y.
 * @returns {{tubes: Array<{points:number[][], diameterMm:number, closed:boolean}>, errors: string[]}}
 *          points in PLAN coordinates [x, y, height]
 */
export function parseFrameTubes(fixture) {
  const errors = [];
  const raw = fixture?.engineering?.tubes ?? fixture?.tubes;
  if (raw == null) return { tubes: [], errors };
  if (!Array.isArray(raw)) return { tubes: [], errors: ["tubes must be an array"] };
  const rel = !!(fixture?.engineering?.relative ?? fixture?.relative);
  const ox = rel ? (num(fixture?.x) ?? 0) : 0, oy = rel ? (num(fixture?.y) ?? 0) : 0;
  const tubes = [];
  raw.forEach((t, i) => {
    const pts = Array.isArray(t) ? t : t?.points;
    if (!Array.isArray(pts)) { errors.push(`tube ${i}: points missing`); return; }
    const clean = [];
    pts.slice(0, MAX_TUBE_POINTS).forEach((p, j) => {
      const a = Array.isArray(p) ? p : [p?.x, p?.y, p?.z];
      const x = num(a[0]), y = num(a[1]), z = num(a[2]) ?? 0;
      if (x == null || y == null) { errors.push(`tube ${i} point ${j}: not a number`); return; }
      clean.push([x + ox, y + oy, z]);
    });
    if (clean.length < 2) { errors.push(`tube ${i}: needs at least two points`); return; }
    const d = num(t?.diameterMm);
    tubes.push({
      points: clean,
      diameterMm: d != null && d > 0 ? Math.min(2000, d) : DEFAULT_TUBE_DIAMETER_MM,
      closed: !!t?.closed && clean.length > 2,
    });
  });
  return { tubes, errors };
}

/**
 * Straight segments of a tube set, for instanced cylinders.
 * @param tubes  parseFrameTubes().tubes (PLAN coordinates)
 * @returns Array<{a:[x,h,z], b:[x,h,z], radius:number}> in WORLD coordinates
 *          (x, height, z = plan y), radius in metres. Zero-length segments are dropped.
 */
export function tubeSegments(tubes, center = null) {
  const cx = center?.cx ?? 0, cy = center?.cy ?? 0;
  const out = [];
  for (const t of tubes || []) {
    const r = (t.diameterMm || DEFAULT_TUBE_DIAMETER_MM) / 2000;
    const pts = t.points;
    const n = t.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const a = [p[0] - cx, p[2], p[1] - cy], b = [q[0] - cx, q[2], q[1] - cy];
      if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < 1e-4) continue;
      out.push({ a, b, radius: r });
    }
  }
  return out;
}

/**
 * Automatic support pipes: an elevated nozzle that no frame carries gets a thin vertical
 * stainless pipe from the water to its mount, unless engineering.support === 'none'.
 * A nozzle counts as carried when a frame segment passes within `carryM` of its mount.
 * @param nozzles  scene nozzle configs (world x, z; engineering.mountHeightM)
 * @param frameSegs tubeSegments() output (world)
 * @returns Array<{a, b, radius}> world segments
 */
export function autoSupportSegments(nozzles, frameSegs = [], carryM = 0.35) {
  const out = [];
  for (const n of nozzles || []) {
    const m = mountHeightOf(n);
    if (!(m > 0)) continue;
    if (strField(n, "support") === "none") continue;
    const p = [Number(n.x) || 0, m, Number(n.z) || 0];
    if (frameSegs.some((s) => pointSegmentDistance(p, s.a, s.b) <= carryM + s.radius)) continue;
    out.push({ a: [p[0], 0, p[2]], b: [p[0], Math.max(0, m - 0.06), p[2]], radius: SUPPORT_PIPE_DIAMETER_MM / 2000 });
  }
  return out;
}

export function pointSegmentDistance(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const L = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = L > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L)) : 0;
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}
