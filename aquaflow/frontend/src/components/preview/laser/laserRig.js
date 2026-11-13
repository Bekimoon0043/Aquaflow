// Laser projectors: channel levels → beam geometry, and the audience-scanning safety rule.
// Pure (no THREE, no React). World frame: x/z on the ground, y up, metres.
//
// Channels (0..1 levels from the canonical show frame, record.channels):
//   laser_intensity  output level
//   lighting_red / lighting_green / lighting_blue   colour (else the clip colour, else the fixture colour)
//   laser_pattern    0 beam · .125 graphics · .25 fan · .375 firefly · .5 cone/tunnel · .625 liquid sky
//                    · .75 sheet · .875 searchlight · 1 scan  (the original five keep their levels)
//   laser_pan        aim around the vertical, 0.5 = the fixture's facing
//   laser_tilt       aim from vertical, 0.5 = straight up, 0/1 = ±tilt half-range
//   laser_size       fan width / cone angle, 2..90°
//   laser_speed      scan / rotation speed, 0..2 Hz
//
// Safety (IEC 60825 / FDA show-laser variance practice): a beam may not enter audience space
// below `minBeamHeightM` (default 3 m above the audience plane). Inside an audience zone the
// beam is raised just enough to clear that height across the whole zone; a projector standing in
// an audience zone below that height is blanked. With no audience zones drawn, everything
// outside the basin outline counts as audience space.

export const LASER_TYPES = Object.freeze(["laser_intensity", "laser_pattern", "laser_pan", "laser_tilt", "laser_size", "laser_speed"]);
// Pattern → channel level. With no pattern clip a projector shows its own kind (engineering.laserKind).
const PATTERN_LEVELS = Object.freeze({ beam: 0, graphics: 0.125, fan: 0.25, firefly: 0.375, cone: 0.5, liquidsky: 0.625, sheet: 0.75, searchlight: 0.875, scan: 1 });
export const LASER_PATTERNS = Object.freeze(Object.keys(PATTERN_LEVELS));
export const KIND_PATTERN = Object.freeze({ beam: "beam", graphics: "graphics", mapping: "graphics", fan: "fan", liquidsky: "liquidsky", sky: "searchlight", firefly: "firefly", movinghead: "beam" });
export const DEFAULT_MIN_BEAM_HEIGHT_M = 3;
export const DEFAULT_RANGE_M = 80;
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export const isLaserFixture = (type) => {
  const k = String(type || "").toLowerCase();
  return k === "laser" || k.startsWith("laser_");
};

/** Channel level (0..1) → laser pattern name (nearest level). */
export function patternOf(level) {
  const v = clamp(num(level, 0), 0, 1);
  let best = "beam";
  for (const [name, at] of Object.entries(PATTERN_LEVELS)) if (Math.abs(at - v) < Math.abs(PATTERN_LEVELS[best] - v)) best = name;
  return best;
}
/** Pattern name → the level that selects it (for writing clips). */
export const patternLevel = (name) => PATTERN_LEVELS[name] ?? 0;

/** ± aim limits of a projector (degrees): half its pan/tilt range, at most 180/90. */
export function laserLimits(fixture) {
  const e = fixture?.engineering || {};
  return { pan: Math.min(180, num(e.panRangeDeg, 180) / 2), tilt: Math.min(90, num(e.tiltRangeDeg, 180) / 2) };
}

const hex = (h) => (/^#[0-9a-f]{6}$/i.test(h || "") ? { r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 } : null);

/**
 * Laser state of one fixture from its evaluated show-frame record.
 * @returns {{ intensity, color:{r,g,b}, pattern, pan, tilt, size, speed }}  angles in degrees, speed in Hz
 */
export function laserState(record, fixture) {
  const ch = record?.channels || {};
  const lim = laserLimits(fixture);
  const rgb = ["lighting_red", "lighting_green", "lighting_blue"].some((k) => ch[k] !== undefined);
  const color = rgb ? { r: ch.lighting_red ?? 0, g: ch.lighting_green ?? 0, b: ch.lighting_blue ?? 0 }
    : record?.color?.srgb || hex(fixture?.color) || hex(fixture?.engineering?.defaultColor) || { r: 0.1, g: 1, b: 0.25 };
  return {
    intensity: clamp(num(ch.laser_intensity, 0), 0, 1),
    color: { r: color.r, g: color.g, b: color.b },
    pattern: ch.laser_pattern === undefined ? (KIND_PATTERN[fixture?.engineering?.laserKind] || "beam") : patternOf(ch.laser_pattern),
    pan: ch.laser_pan === undefined ? 0 : (ch.laser_pan - 0.5) * 2 * lim.pan,
    tilt: ch.laser_tilt === undefined ? 0 : (ch.laser_tilt - 0.5) * 2 * lim.tilt,
    size: ch.laser_size === undefined ? 30 : 2 + ch.laser_size * 88,
    speed: ch.laser_speed === undefined ? 0.25 : ch.laser_speed * 2,
  };
}

const hash01 = (i) => { let h = (i + 1) * 2654435761 >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
/** Rotate `v` by `angle` toward `u` (both unit, u ⟂ v). */
const toward = (v, u, angle) => ({ x: v.x * Math.cos(angle) + u.x * Math.sin(angle), y: v.y * Math.cos(angle) + u.y * Math.sin(angle), z: v.z * Math.cos(angle) + u.z * Math.sin(angle) });

/** Central aim direction: fixture facing (plan rotation, degrees) + pan, tilted `tilt` degrees from vertical. */
export function aimDirection(rotationDeg, pan, tilt) {
  const a = (num(rotationDeg, 0) + pan) * DEG, t = tilt * DEG;
  return norm({ x: Math.cos(a) * Math.sin(t), y: Math.cos(t), z: Math.sin(a) * Math.sin(t) });
}

/**
 * Beam directions of a projector at show time `time` (seconds).
 * @returns {{ dirs: {x,y,z}[], sheet: boolean, cone: boolean }}
 */
export function beamDirections(state, rotationDeg, time = 0) {
  const axis = aimDirection(rotationDeg, state.pan, state.tilt);
  const a = (num(rotationDeg, 0) + state.pan) * DEG;
  // Side vector: horizontal, across the facing; w completes the frame around the axis.
  const side = { x: -Math.sin(a), y: 0, z: Math.cos(a) };
  const w = norm(cross(side, axis));
  const half = (state.size / 2) * DEG;
  const phase = 2 * Math.PI * state.speed * time;
  const spread = (n) => Array.from({ length: n }, (_, i) => toward(axis, side, -half + (2 * half * i) / (n - 1)));
  switch (state.pattern) {
    case "fan": return { dirs: spread(9), sheet: false, cone: false };
    case "sheet": return { dirs: spread(25), sheet: true, cone: false };
    case "cone": return { dirs: Array.from({ length: 16 }, (_, i) => {
      const k = phase + (2 * Math.PI * i) / 16;
      const u = { x: side.x * Math.cos(k) + w.x * Math.sin(k), y: side.y * Math.cos(k) + w.y * Math.sin(k), z: side.z * Math.cos(k) + w.z * Math.sin(k) };
      return norm(toward(axis, u, half));
    }), sheet: false, cone: true };
    case "scan": return { dirs: [norm(toward(axis, side, half * Math.sin(phase)))], sheet: false, cone: false };
    case "searchlight": return { dirs: [norm(toward(axis, side, half * 0.5 * Math.sin(phase)))], sheet: false, cone: false, heavy: true };
    case "liquidsky": {
      // A near-horizontal sheet scanned across the space, rippled by the fog layer it rides on.
      const flat = Math.hypot(axis.x, axis.z) > 1e-6 ? norm({ x: axis.x, y: 0, z: axis.z }) : { x: Math.cos(a), y: 0, z: Math.sin(a) };
      return { dirs: Array.from({ length: 41 }, (_, i) => {
        const d = toward(flat, side, -half + (2 * half * i) / 40);
        return norm({ x: d.x, y: 0.035 * Math.sin(phase * 0.7 + i * 0.45), z: d.z });
      }), sheet: true, cone: false };
    }
    case "firefly": {
      // Many weak dots from a diffraction grating, each drifting and twinkling on its own.
      const dirs = [], glints = [];
      for (let i = 0; i < 64; i++) {
        const k = hash01(i), j = hash01(i + 101);
        const ang = 2 * Math.PI * k + 0.15 * Math.sin(phase * 0.6 + i), r = half * Math.sqrt(j);
        const u = { x: side.x * Math.cos(ang) + w.x * Math.sin(ang), y: side.y * Math.cos(ang) + w.y * Math.sin(ang), z: side.z * Math.cos(ang) + w.z * Math.sin(ang) };
        dirs.push(norm(toward(axis, u, r)));
        glints.push(0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * (3 + 5 * hash01(i + 7)) + 6.3 * k)));
      }
      return { dirs, sheet: false, cone: false, faint: true, glints };
    }
    default: return { dirs: [axis], sheet: false, cone: false };
  }
}

// ── safety ──────────────────────────────────────────────────────────────────

/** Point-in-polygon on the ground plane; poly = [[x, z], ...]. */
export function insidePoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Horizontal distances (sorted) where a ground ray from (x,z) along unit (hx,hz) crosses polygon edges. */
function crossings(x, z, hx, hz, poly) {
  const out = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const ex = bx - ax, ez = bz - az;
    const den = hx * ez - hz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const s = ((ax - x) * ez - (az - z) * ex) / den;   // along the ray
    const u = ((ax - x) * hz - (az - z) * hx) / den;   // along the edge
    if (s > 1e-9 && u >= 0 && u <= 1) out.push(s);
  }
  return out.sort((p, q) => p - q);
}

/**
 * Horizontal distance intervals [s0, s1] (≤ range) where the ray is over audience space.
 * zones: audience polygons; with none, audience = outside `basin` (when given).
 */
export function audienceIntervals(origin, hx, hz, { zones = [], basin = null, range = DEFAULT_RANGE_M } = {}) {
  const out = [];
  const spans = (poly, wantInside) => {
    const cuts = crossings(origin.x, origin.z, hx, hz, poly).filter((s) => s < range);
    let inside = insidePoly(origin.x, origin.z, poly), prev = 0;
    for (const s of [...cuts, range]) {
      if (inside === wantInside) out.push([prev, s]);
      inside = !inside; prev = s;
    }
  };
  if (zones.length) zones.forEach((poly) => poly?.length >= 3 && spans(poly, true));
  else if (basin?.length >= 3) spans(basin, false);
  return out;
}

/**
 * Apply the safety rule to one beam. Returns { dir, blanked, clamped }.
 * The beam is a straight line, so over an interval its lowest point is at an end: the slope
 * dy/dh must be ≥ (ymin − oy)/s at every interval end s.
 */
export function safeBeam(origin, dir, opts = {}) {
  const ymin = num(opts.audiencePlaneY, 0) + num(opts.minBeamHeightM, DEFAULT_MIN_BEAM_HEIGHT_M);
  const dh = Math.hypot(dir.x, dir.z);
  if (dh < 1e-6) {
    const inAudience = audienceIntervals(origin, 1, 0, { ...opts, range: 1e-3 }).some(([s0]) => s0 === 0);
    if (inAudience && (dir.y <= 0 || origin.y < ymin)) return { dir, blanked: true, clamped: false };
    return { dir, blanked: false, clamped: false };
  }
  const hx = dir.x / dh, hz = dir.z / dh;
  const intervals = audienceIntervals(origin, hx, hz, opts);
  if (!intervals.length) return { dir, blanked: false, clamped: false };
  if (intervals[0][0] <= 1e-9 && origin.y < ymin) return { dir, blanked: true, clamped: false };
  let need = -Infinity;
  for (const [s0, s1] of intervals) for (const s of [s0, s1]) if (s > 1e-9) need = Math.max(need, (ymin - origin.y) / s);
  const slope = dir.y / dh;
  if (slope >= need) return { dir, blanked: false, clamped: false };
  return { dir: norm({ x: hx, y: need, z: hz }), blanked: false, clamped: true };
}

/** End of a beam: where it meets the ground/water plane (y = 0), or its range. */
export function beamEnd(origin, dir, range = DEFAULT_RANGE_M) {
  let s = range;
  let hit = false;
  if (dir.y < -1e-6) { const t = -origin.y / dir.y; if (t < range) { s = t; hit = true; } }
  return { point: { x: origin.x + dir.x * s, y: origin.y + dir.y * s, z: origin.z + dir.z * s }, length: s, hit };
}

/**
 * Everything the renderer needs for one projector this frame.
 * fixture: { id, x, z, y (mount height), rotation, engineering }
 * @returns {{ id, origin, color, intensity, sheet, cone, beams: [{ dir, end, length, hit, clamped }], blanked: number, clamped: number }}
 */
export function laserFrame(fixture, state, time, safety = {}) {
  const origin = { x: num(fixture.x, 0), y: num(fixture.y, num(fixture.engineering?.mountHeightM, 0.5)), z: num(fixture.z, 0) };
  const range = num(fixture.engineering?.rangeM, DEFAULT_RANGE_M);
  const opts = { ...safety, minBeamHeightM: num(fixture.engineering?.minBeamHeightM, safety.minBeamHeightM ?? DEFAULT_MIN_BEAM_HEIGHT_M), range };
  if (state.pattern === "graphics") return graphicsFrame(fixture, state, time, origin, opts);
  const { dirs, sheet, cone, faint = false, heavy = false, glints = null } = beamDirections(state, fixture.rotation, time);
  let blanked = 0, clamped = 0;
  const beams = [];
  dirs.forEach((d, i) => {
    const safe = safeBeam(origin, d, opts);
    if (safe.blanked) { blanked++; return; }
    if (safe.clamped) clamped++;
    const end = beamEnd(origin, safe.dir, range);
    beams.push({ dir: safe.dir, end: end.point, length: end.length, hit: end.hit, clamped: safe.clamped, ...(glints ? { glint: glints[i] } : {}) });
  });
  return { id: fixture.id, origin, color: state.color, intensity: state.intensity, sheet, cone, faint, heavy, beams, blanked, clamped, outline: [] };
}

// ── graphics projection ─────────────────────────────────────────────────────

const polygon = (n, r = 1) => Array.from({ length: n + 1 }, (_, i) => [r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI)]);
/** Vector artwork in unit coordinates (−1..1), as polylines. */
export const GRAPHICS = Object.freeze({
  star: [Array.from({ length: 11 }, (_, i) => { const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.42 : 1; return [r * Math.cos(a), r * Math.sin(a)]; })],
  ring: [polygon(32)],
  wave: [Array.from({ length: 25 }, (_, i) => [-1 + i / 12, 0.45 * Math.sin((i / 24) * 4 * Math.PI)])],
  logo: [polygon(32), [[-0.5, -0.45], [0, 0.6], [0.5, -0.45], [-0.5, -0.45]]],
});

/**
 * Where a graphics laser draws: the water screen it is linked to (fixture.screen, from laserSite),
 * else a vertical plane `projection.distanceM` along its facing, widthM × heightM, centred
 * centerHeightM above the ground.
 */
export function projectionPlane(fixture) {
  if (fixture?.screen) return fixture.screen;
  const p = fixture?.engineering?.projection || {};
  const a = num(fixture?.rotation, 0) * DEG, d = num(p.distanceM, 15);
  const fx = Math.cos(a), fz = Math.sin(a);
  return { center: { x: num(fixture?.x, 0) + fx * d, y: num(p.centerHeightM, 6), z: num(fixture?.z, 0) + fz * d },
    right: { x: -fz, y: 0, z: fx }, width: num(p.widthM, 14), height: num(p.heightM, 8) };
}

/** Outline segments [{a, b}] of the artwork on the plane; size 0..1 scales it, spin turns it (rad). */
export function graphicsOutline(fixture, { size = 0.6, spin = 0 } = {}) {
  const plane = projectionPlane(fixture);
  const art = GRAPHICS[fixture?.engineering?.graphic] || GRAPHICS.star;
  const k = 0.25 + 0.75 * clamp(size, 0, 1), sx = (plane.width / 2) * k, sy = (plane.height / 2) * k;
  const c = Math.cos(spin), s = Math.sin(spin);
  const at = ([u, v]) => { const ru = u * c - v * s, rv = u * s + v * c;
    return { x: plane.center.x + plane.right.x * ru * sx, y: plane.center.y + rv * sy, z: plane.center.z + plane.right.z * ru * sx }; };
  const segs = [];
  for (const line of art) for (let i = 1; i < line.length; i++) segs.push({ a: at(line[i - 1]), b: at(line[i]) });
  return segs;
}

/**
 * A graphics/mapping laser draws its artwork on the projection plane; the scanned beam shows only
 * as a faint pyramid from the head to the artwork. The artwork is never moved, but a beam that
 * would cross audience space too low is counted (clamped) so preflight tells the programmer.
 */
function graphicsFrame(fixture, state, time, origin, opts) {
  // A projector standing in audience space below the minimum beam height is blanked, as for beams.
  const here = safeBeam(origin, { x: 0, y: 1, z: 0 }, { ...opts, range: 1e-3 });
  if (here.blanked) return { id: fixture.id, origin, color: state.color, intensity: state.intensity, sheet: false, cone: false, faint: true, heavy: false, beams: [], blanked: 1, clamped: 0, outline: [] };
  const outline = graphicsOutline(fixture, { size: (state.size - 2) / 88, spin: 0.5 * Math.PI * state.speed * time });
  let clamped = 0;
  const beams = outline.filter((_, i) => i % 3 === 0).map(({ a }) => {
    const v = { x: a.x - origin.x, y: a.y - origin.y, z: a.z - origin.z }, length = Math.hypot(v.x, v.y, v.z) || 1;
    const dir = { x: v.x / length, y: v.y / length, z: v.z / length };
    const safe = safeBeam(origin, dir, { ...opts, range: Math.hypot(v.x, v.z) || 1e-3 });
    if (safe.clamped || safe.blanked) clamped++;
    return { dir, end: a, length, hit: false, clamped: safe.clamped || safe.blanked };
  });
  return { id: fixture.id, origin, color: state.color, intensity: state.intensity, sheet: false, cone: false, faint: true, heavy: false, beams, blanked: 0, clamped, outline };
}

/** Beam visibility from haze (0..1): beams are only seen where light scatters. */
export const hazeVisibility = (haze, realWorld = true) => (realWorld ? 0.08 + 0.92 * clamp(num(haze, 0), 0, 1) : Math.max(0.6, clamp(num(haze, 0), 0, 1)));
