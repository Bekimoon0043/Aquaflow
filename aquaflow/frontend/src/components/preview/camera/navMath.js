/**
 * camera/navMath.js — pure camera-navigation math for the 3D preview and the scene editor:
 * multiplicative wheel zoom, frame-rate-independent damping, site-scaled distance limits
 * and "frame all". Plain {x,y,z} objects, no THREE.
 */

export const ZOOM_IN = 0.88;
export const ZOOM_OUT = 1 / ZOOM_IN;
export const MIN_DISTANCE_M = 0.5;
export const FOV_MIN = 15;
export const FOV_MAX = 90;

/**
 * Wheel delta in "notches" (one classic mouse click = ±1), whatever the device reports:
 * deltaMode 1 = lines, 2 = pages, 0 = pixels (mouse ≈ 100 px/notch, trackpads send many
 * small deltas, so they zoom smoothly by fractions of a notch).
 */
export function wheelNotches(deltaY, deltaMode = 0) {
  const d = Number(deltaY) || 0;
  const n = deltaMode === 1 ? d / 3 : deltaMode === 2 ? d * 3 : d / 100;
  return Math.max(-5, Math.min(5, n));
}

/** Distance multiplier for `notches` wheel steps (positive = away, like deltaY > 0). */
export const zoomStep = (notches) => Math.pow(ZOOM_OUT, Number(notches) || 0);

/** Distance limits for a site of radius `siteRadius` metres. */
export function distanceLimits(siteRadius) {
  const r = Math.max(1, Number(siteRadius) || 0);
  return { min: MIN_DISTANCE_M, max: Math.max(40, 6 * r) };
}

export const clampDistance = (d, { min = MIN_DISTANCE_M, max = 200 } = {}) => Math.max(min, Math.min(max, d));

/**
 * Exponential approach of `current` toward `target`; `rate` is how much of the remaining
 * gap closes per second (e^-rate·dt), so the motion is identical at 24, 60 or 144 fps.
 */
export function dampTo(current, target, rate, dt) {
  const k = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
  return current + (target - current) * k;
}

export const lerp3 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

/** `p` scaled by `s` about `pivot`: pivot + (p − pivot)·s. */
export const scaleAbout = (p, pivot, s) => ({
  x: pivot.x + (p.x - pivot.x) * s, y: pivot.y + (p.y - pivot.y) * s, z: pivot.z + (p.z - pivot.z) * s,
});

/**
 * Bounds of the site from its basin size and fixture positions.
 * @param {{poolType?:string, width?:number, length?:number, radius?:number, points?:{x,z}[], height?:number}} pool
 * @param {{x:number, z:number, h?:number}[]} fixtures
 */
export function siteBounds(pool = {}, fixtures = []) {
  let minX, maxX, minZ, maxZ;
  if (pool.poolType === "circular") {
    const r = Number(pool.radius) || 6;
    minX = minZ = -r; maxX = maxZ = r;
  } else {
    const w = (Number(pool.width) || 12) / 2, l = (Number(pool.length) || 8) / 2;
    minX = -w; maxX = w; minZ = -l; maxZ = l;
  }
  let maxY = Math.max(2, Number(pool.height) || 0);
  for (const p of [...(pool.points || []), ...fixtures]) {
    const x = Number(p?.x), z = Number(p?.z ?? p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    if (Number.isFinite(p?.h)) maxY = Math.max(maxY, p.h);
  }
  const center = { x: (minX + maxX) / 2, y: maxY / 3, z: (minZ + maxZ) / 2 };
  const radius = Math.hypot(maxX - minX, maxZ - minZ, maxY) / 2;
  return { min: { x: minX, y: 0, z: minZ }, max: { x: maxX, y: maxY, z: maxZ }, center, radius };
}

/**
 * Camera that fits `bounds` (from siteBounds) in view.
 * @param {number} fovDeg vertical field of view
 * @param {{x,y,z}} dir unit-ish direction from target to camera (defaults to a 3/4 view)
 * @returns {{position:{x,y,z}, target:{x,y,z}, distance:number}}
 */
export function frameBounds(bounds, fovDeg = 50, aspect = 16 / 9, dir = { x: 0.62, y: 0.45, z: 0.64 }) {
  const r = Math.max(0.5, bounds?.radius || 1);
  const vf = (Math.max(FOV_MIN, Math.min(FOV_MAX, fovDeg)) * Math.PI) / 180;
  const hf = 2 * Math.atan(Math.tan(vf / 2) * Math.max(0.1, aspect || 1));
  const half = Math.min(vf, hf) / 2;
  const distance = (r / Math.sin(half)) * 1.05;
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const target = { ...(bounds?.center || { x: 0, y: 0, z: 0 }) };
  return {
    target, distance,
    position: { x: target.x + (dir.x / len) * distance, y: target.y + (dir.y / len) * distance, z: target.z + (dir.z / len) * distance },
  };
}

/**
 * Ray (origin, unit dir) against the horizontal plane y = `planeY`; null when parallel or
 * behind the camera, or farther than `maxT`.
 */
export function rayPlaneY(origin, dir, planeY = 0, maxT = 1e4) {
  if (Math.abs(dir.y) < 1e-6) return null;
  const t = (planeY - origin.y) / dir.y;
  if (t <= 0 || t > maxT) return null;
  return { x: origin.x + dir.x * t, y: planeY, z: origin.z + dir.z * t };
}
