// navigation.js — AquaFlow Stage 3, Priority 6 (AQ-S3-006)
//
// Camera navigation maths for the VR walkthrough: first-person movement, bounds
// clamping, and waypoint-path interpolation for guided tours. Pure and
// framework-agnostic (no Three.js) so it is deterministic and unit-tested; the
// FountainScene / PreviewPanel drive the actual camera from these results.
//
// Convention: yaw is a Y-axis rotation in degrees. yaw=0 faces −Z ("into" the
// scene); +X is to the right. Positions are { x, y, z } in metres.

export const NAV_MODES = Object.freeze({
  WALK: "walk",     // first-person ground movement
  ORBIT: "orbit",   // orbit the fountain
  FLY: "fly",       // free flythrough
  TOUR: "tour",     // scripted waypoint tour
  TOP: "top",
  FRONT: "front",
});

const D2R = Math.PI / 180;

/** Unit forward/right vectors (in the XZ plane) for a given yaw (degrees). */
export function headingVectors(yawDeg = 0) {
  const y = yawDeg * D2R;
  return {
    forward: { x: Math.sin(y), z: -Math.cos(y) }, // yaw 0 → −Z
    right: { x: Math.cos(y), z: Math.sin(y) },     // yaw 0 → +X
  };
}

/** Clamp a position inside an axis-aligned bounds box (min/max per axis). */
export function clampToBounds(pos, bounds) {
  if (!bounds) return { ...pos };
  const c = (v, lo, hi) => (lo != null ? Math.max(lo, hi != null ? Math.min(hi, v) : v) : v);
  return {
    x: c(pos.x, bounds.minX, bounds.maxX),
    y: c(pos.y, bounds.minY, bounds.maxY),
    z: c(pos.z, bounds.minZ, bounds.maxZ),
  };
}

/**
 * Advance a first-person walker one step.
 * @param position   current {x,y,z}
 * @param yawDeg     heading
 * @param input      { forward, right, up } each -1..1
 * @param speed      m/s
 * @param dt         seconds
 * @param bounds     optional bounds box
 */
export function firstPersonStep({ position, yawDeg = 0, input = {}, speed = 3, dt = 1 / 60, bounds = null } = {}) {
  const { forward, right } = headingVectors(yawDeg);
  const f = input.forward || 0, r = input.right || 0, u = input.up || 0;
  const d = speed * dt;
  const next = {
    x: position.x + d * (f * forward.x + r * right.x),
    y: position.y + d * u,
    z: position.z + d * (f * forward.z + r * right.z),
  };
  return clampToBounds(next, bounds);
}

/** Total polyline length through a list of waypoints. */
export function pathLength(waypoints) {
  let len = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1], b = waypoints[i];
    len += Math.hypot(b.x - a.x, (b.y || 0) - (a.y || 0), b.z - a.z);
  }
  return len;
}

/**
 * Position along a waypoint polyline at parameter t ∈ [0,1] (piecewise linear by
 * segment). t=0 → first waypoint, t=1 → last.
 */
export function waypointPath(waypoints, t) {
  if (!waypoints || waypoints.length === 0) return { x: 0, y: 0, z: 0 };
  if (waypoints.length === 1) return { ...waypoints[0] };
  const clamped = Math.max(0, Math.min(1, t));
  const segs = waypoints.length - 1;
  const pos = clamped * segs;
  const i = Math.min(segs - 1, Math.floor(pos));
  const local = pos - i;
  const a = waypoints[i], b = waypoints[i + 1];
  return {
    x: a.x + (b.x - a.x) * local,
    y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * local,
    z: a.z + (b.z - a.z) * local,
  };
}

/** Yaw (degrees) needed to look from `from` toward `to` (XZ plane). */
export function lookAtYaw(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return (Math.atan2(dx, -dz) / D2R + 360) % 360;
}
