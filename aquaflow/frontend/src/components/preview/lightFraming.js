/**
 * lightFraming.js — framing blades (beam cut-offs) on any light.
 *
 * A framing projector (e.g. a Martin Exterior Projection Pro Compact class fixture with its
 * 4-blade framing module) can cut its beam with blades along planes. In AquaFlow a light
 * declares its blades in its engineering data, in FIXTURE PLAN coordinates (metres):
 *
 *   engineering.framing = {
 *     blades: [{ point: [x, y, z], normal: [nx, ny, nz] }, …],   // x east, y plan y, z height
 *     softnessM: 0.05,                                           // optional, soft edge width
 *   }
 *
 * A point P is lit only if (P − point)·n̂ ≥ 0 for EVERY blade (the normal points to the
 * kept side). The edge is softened over `softnessM` on the kept side:
 *   factor = Π smoothstep(0, softnessM, (P − point)·n̂)      (softnessM = 0 → hard step)
 * so a point on the excluded side is always dark.
 *
 * Renderer light configs carry the blades RELATIVE to the light's own plan position (so the
 * scene's pool-centre shift moves the blades with the light), in world axes
 * (x, height, plan y):  framing = { blades: [{ d:[dx, h, dz], n:[nx, nh, nz] }], softnessM }.
 * World point of a blade = (light.x + dx, h, light.z + dz).
 *
 * Pure: no three.js.
 */

export const MAX_BLADES = 4;
export const DEFAULT_BLADE_SOFTNESS_M = 0.05;
export const MAX_BLADE_SOFTNESS_M = 2;

const finite3 = (v) => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((c) => c !== null && c !== "" && Number.isFinite(Number(c)));

/**
 * Validate engineering.framing (plan coordinates).
 * @returns {{blades: Array<{point:number[], normal:number[]}>, softnessM:number,
 *            invalid: Array<{index:number, reason:string}>}|null}  null when absent
 */
export function parseFraming(raw) {
  if (raw == null) return null;
  const invalid = [];
  if (typeof raw !== "object" || !Array.isArray(raw.blades)) {
    return { blades: [], softnessM: DEFAULT_BLADE_SOFTNESS_M, invalid: [{ index: -1, reason: "framing.blades must be an array" }] };
  }
  const blades = [];
  raw.blades.forEach((b, index) => {
    if (!b || typeof b !== "object") { invalid.push({ index, reason: "blade is not an object" }); return; }
    if (!finite3(b.point)) { invalid.push({ index, reason: "point must be [x, y, z] numbers (m)" }); return; }
    if (!finite3(b.normal)) { invalid.push({ index, reason: "normal must be [nx, ny, nz] numbers" }); return; }
    const n = b.normal.slice(0, 3).map(Number);
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > 1e-6)) { invalid.push({ index, reason: "normal has zero length" }); return; }
    if (blades.length >= MAX_BLADES) { invalid.push({ index, reason: `more than ${MAX_BLADES} blades (ignored)` }); return; }
    blades.push({ point: b.point.slice(0, 3).map(Number), normal: [n[0] / len, n[1] / len, n[2] / len] });
  });
  const s = Number(raw.softnessM);
  const softnessM = raw.softnessM != null && Number.isFinite(s) && s >= 0 ? Math.min(MAX_BLADE_SOFTNESS_M, s) : DEFAULT_BLADE_SOFTNESS_M;
  if (raw.softnessM != null && !(Number.isFinite(s) && s >= 0)) invalid.push({ index: -1, reason: "softnessM must be ≥ 0 (default 0.05 m used)" });
  return { blades, softnessM, invalid };
}

/**
 * Renderer form: blades relative to the light's plan position (planX, planY), world axes.
 * @returns {{blades: Array<{d:number[], n:number[]}>, softnessM:number}|null}  null when no valid blade
 */
export function framingForRenderer(raw, planX = 0, planY = 0) {
  const f = parseFraming(raw);
  if (!f || !f.blades.length) return null;
  return {
    softnessM: f.softnessM,
    blades: f.blades.map(({ point: p, normal: n }) => ({
      d: [p[0] - (Number(planX) || 0), p[2], p[1] - (Number(planY) || 0)],
      n: [n[0], n[2], n[1]],
    })),
  };
}

/**
 * World planes of a renderer light's blades: [{ n:[x,y,z] unit, w }] with signed distance
 * s(P) = n·P + w (≥ 0 kept).
 */
export function bladePlanesOf(light) {
  const f = light?.framing;
  if (!f || !Array.isArray(f.blades) || !f.blades.length) return [];
  const lx = Number(light.x) || 0, lz = Number(light.z) || 0;
  const out = [];
  for (const b of f.blades) {
    if (!finite3(b?.d) || !finite3(b?.n)) continue;
    const len = Math.hypot(b.n[0], b.n[1], b.n[2]);
    if (!(len > 1e-6)) continue;
    const n = [b.n[0] / len, b.n[1] / len, b.n[2] / len];
    const p = [lx + Number(b.d[0]), Number(b.d[1]), lz + Number(b.d[2])];
    out.push({ n, w: -(n[0] * p[0] + n[1] * p[1] + n[2] * p[2]) });
    if (out.length >= MAX_BLADES) break;
  }
  return out;
}

export function bladeSoftnessOf(light) {
  const s = Number(light?.framing?.softnessM);
  return Number.isFinite(s) && s >= 0 ? Math.min(MAX_BLADE_SOFTNESS_M, s) : DEFAULT_BLADE_SOFTNESS_M;
}

/** Soft half-space factor of one signed distance s (smoothstep 0 → soft). */
export function bladeEdge(s, soft) {
  if (!(soft > 0)) return s >= 0 ? 1 : 0;
  const t = Math.min(1, Math.max(0, s / soft));
  return t * t * (3 - 2 * t);
}

/** 0..1: how much of the light passes the blades at world point (px, py, pz). 1 = no blades. */
export function bladeFactor(light, px, py, pz, planes = bladePlanesOf(light), soft = bladeSoftnessOf(light)) {
  let f = 1;
  for (const p of planes) {
    f *= bladeEdge(p.n[0] * px + p.n[1] * py + p.n[2] * pz + p.w, soft);
    if (f <= 0) return 0;
  }
  return f;
}

/** Does a light carry any valid blade? */
export function hasFraming(light) {
  return bladePlanesOf(light).length > 0;
}
