const EPSILON = 1e-8;
const AXES = Object.freeze({ x: 0, y: 1, z: 2 });

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const vector = (v, fallback = [0, 0, 0]) => Array.isArray(v) && v.length >= 3
  ? [finite(v[0]), finite(v[1]), finite(v[2])] : [...fallback];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (v) => Math.hypot(...v);
const unit = (v, fallback) => {
  const a = vector(v, fallback);
  const l = length(a);
  return l > EPSILON ? scale(a, 1 / l) : [...fallback];
};

function motionOptions(options) {
  const gravity = Math.abs(finite(options.gravityMs2, 9.81));
  return {
    acceleration: vector(options.acceleration, [0, -gravity, 0]),
    maxTimeS: Math.max(0, finite(options.maxTimeS, 10)),
    minTimeS: Math.max(0, finite(options.minTimeS, 1e-7)),
    epsilon: Math.max(EPSILON, finite(options.epsilon, 1e-6)),
  };
}

/** Position and velocity after constant acceleration. */
export function advanceBallistic(position, velocity, timeS, options = {}) {
  const p = vector(position), v = vector(velocity);
  const t = Math.max(0, finite(timeS));
  const a = motionOptions(options).acceleration;
  return {
    position: add(add(p, scale(v, t)), scale(a, 0.5 * t * t)),
    velocity: add(v, scale(a, t)),
  };
}

/** Sorted roots of p + v*t + a*t²/2 = target. */
function axisRoots(p, v, a, target, motion) {
  const A = 0.5 * a, B = v, C = p - target;
  let roots;
  if (Math.abs(A) < EPSILON) {
    roots = Math.abs(B) < EPSILON ? [] : [-C / B];
  } else {
    const discriminant = B * B - 4 * A * C;
    if (discriminant < -EPSILON) return [];
    const root = Math.sqrt(Math.max(0, discriminant));
    roots = [(-B - root) / (2 * A), (-B + root) / (2 * A)];
  }
  return roots.filter((t) => Number.isFinite(t) && t >= motion.minTimeS && t <= motion.maxTimeS + motion.epsilon)
    .sort((aRoot, bRoot) => aRoot - bRoot);
}

function boundsOf(collider) {
  return {
    min: collider?.min || collider?.bounds?.min || null,
    max: collider?.max || collider?.bounds?.max || null,
  };
}

function insideBounds(position, collider, epsilon) {
  const { min, max } = boundsOf(collider);
  for (let axis = 0; axis < 3; axis++) {
    if (Array.isArray(min) && Number.isFinite(Number(min[axis])) && position[axis] < Number(min[axis]) - epsilon) return false;
    if (Array.isArray(max) && Number.isFinite(Number(max[axis])) && position[axis] > Number(max[axis]) + epsilon) return false;
  }
  if (collider) {
    if (position[0] < finite(collider.minX, -Infinity) - epsilon || position[0] > finite(collider.maxX, Infinity) + epsilon) return false;
    if (position[2] < finite(collider.minZ, -Infinity) - epsilon || position[2] > finite(collider.maxZ, Infinity) + epsilon) return false;
  }
  return true;
}

function event(type, impact, strength, speedMs) {
  return {
    type,
    position: [...impact.position],
    normal: [...impact.normal],
    strength: clamp(strength),
    speedMs,
  };
}

/** Deterministic splash/ripple/runoff recommendations; no particles are allocated. */
export function recommendSecondaryEvents(impact, options = {}) {
  if (!impact) return [];
  const velocity = vector(impact.velocity);
  const normal = unit(impact.normal, [0, 1, 0]);
  const speed = Number.isFinite(impact.incomingSpeedMs) ? impact.incomingSpeedMs : length(velocity);
  const normalSpeed = Math.max(0, -dot(velocity, normal));
  const tangentSpeed = Math.sqrt(Math.max(0, speed * speed - normalSpeed * normalSpeed));
  const normalized = { ...impact, normal, velocity };
  const events = [];
  const water = impact.type === "water" || impact.surface === "water";
  if (water) {
    const rippleThreshold = Math.max(0, finite(options.rippleSpeedMs, 0.05));
    const splashThreshold = Math.max(rippleThreshold, finite(options.splashSpeedMs, 0.75));
    const foamThreshold = Math.max(splashThreshold, finite(options.foamSpeedMs, 2));
    const mistThreshold = Math.max(foamThreshold, finite(options.mistSpeedMs, 5));
    if (normalSpeed >= rippleThreshold) {
      events.push(event("ripple", normalized, 0.15 + 0.65 * clamp(normalSpeed / 6), normalSpeed));
    }
    if (normalSpeed >= splashThreshold) {
      events.push(event("splash", normalized, clamp((normalSpeed - splashThreshold) / 5 + 0.2), normalSpeed));
    }
    if (normalSpeed >= foamThreshold) {
      events.push(event("foam", normalized, clamp((normalSpeed - foamThreshold) / 5 + 0.25), normalSpeed));
    }
    if (normalSpeed >= mistThreshold) {
      events.push(event("mist", normalized, clamp((normalSpeed - mistThreshold) / 7 + 0.15), normalSpeed));
    }
    return events;
  }

  const verticalSurface = Math.abs(normal[1]) < 0.8;
  if (verticalSurface) {
    events.push(event("surface-film", normalized,
      clamp(finite(impact.adhesionStrength, 0.75) * (0.35 + tangentSpeed / 4)), tangentSpeed));
  }
  if (tangentSpeed >= Math.max(0, finite(options.runoffSpeedMs, 0.3))) {
    events.push(event("runoff", normalized, clamp(tangentSpeed / 5 + 0.15), tangentSpeed));
  }
  if (normalSpeed >= Math.max(0, finite(options.splashSpeedMs, 0.9))) {
    events.push(event("splash", normalized, clamp(normalSpeed / 6), normalSpeed));
  }
  if (normalSpeed >= Math.max(0, finite(options.dropletSpeedMs, 2.5))) {
    events.push(event("droplets", normalized, clamp((normalSpeed - 2.5) / 5 + 0.25), normalSpeed));
  }
  if (normalSpeed >= Math.max(0, finite(options.mistSpeedMs, 6))) {
    events.push(event("mist", normalized, clamp((normalSpeed - 6) / 7 + 0.15), normalSpeed));
  }
  return events;
}

function impactRecord(type, collider, timeS, position, velocity, normal) {
  const impact = {
    type,
    surface: collider?.surface || type,
    collider: collider || null,
    timeS,
    position,
    normal: unit(normal, [0, 1, 0]),
    velocity,
    incomingSpeedMs: length(velocity),
  };
  impact.normalSpeedMs = Math.max(0, -dot(velocity, impact.normal));
  impact.tangentSpeedMs = Math.sqrt(Math.max(0, impact.incomingSpeedMs ** 2 - impact.normalSpeedMs ** 2));
  impact.secondaryEvents = recommendSecondaryEvents(impact, collider?.eventOptions);
  return impact;
}

/**
 * Intersect a constant-acceleration trajectory with a horizontal water plane.
 * The plane accepts y (or level), optional min/max or minX/maxX/minZ/maxZ bounds.
 */
export function collideWaterPlane(position, velocity, water = {}, options = {}) {
  const p = vector(position), v = vector(velocity);
  const motion = motionOptions(options);
  const level = finite(water?.y ?? water?.level ?? water?.height ?? options.waterY, 0);
  if (p[1] < level - motion.epsilon) return null;
  const roots = axisRoots(p[1], v[1], motion.acceleration[1], level, motion);
  for (const timeS of roots) {
    const state = advanceBallistic(p, v, timeS, options);
    state.position[1] = level;
    if (state.velocity[1] >= -motion.epsilon || !insideBounds(state.position, water, motion.epsilon)) continue;
    return impactRecord("water", water, timeS, state.position, state.velocity, [0, 1, 0]);
  }
  return null;
}

/**
 * Intersect an axis-aligned architectural plane. Plane fields: axis, offset,
 * normal, doubleSided (default true), and optional world min/max bounds.
 */
export function collideArchitecturalPlane(position, velocity, plane, options = {}) {
  if (!plane || !(plane.axis in AXES)) throw new TypeError("Plane axis must be x, y or z");
  const axisName = plane.axis, axis = AXES[axisName];
  const p = vector(position), v = vector(velocity);
  const motion = motionOptions(options);
  const offset = finite(plane.offset ?? plane.value ?? plane[axisName]);
  const defaultNormal = [0, 0, 0];
  defaultNormal[axis] = 1;
  const normal = unit(plane.normal, defaultNormal);
  const doubleSided = plane.doubleSided !== false;
  if (!doubleSided && dot(p, normal) < offset * normal[axis] - motion.epsilon) return null;
  const roots = axisRoots(p[axis], v[axis], motion.acceleration[axis], offset, motion);
  for (const timeS of roots) {
    const state = advanceBallistic(p, v, timeS, options);
    state.position[axis] = offset;
    if (!insideBounds(state.position, plane, motion.epsilon)) continue;
    const approach = dot(state.velocity, normal);
    if (Math.abs(approach) <= motion.epsilon || (!doubleSided && approach >= 0)) continue;
    const facing = approach > 0 ? scale(normal, -1) : normal;
    return impactRecord("plane", plane, timeS, state.position, state.velocity, facing);
  }
  return null;
}

function boxBounds(box) {
  const bounds = boundsOf(box);
  if (Array.isArray(bounds.min) && Array.isArray(bounds.max)) {
    return {
      min: [0, 1, 2].map((axis) => Math.min(finite(bounds.min[axis]), finite(bounds.max[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(finite(bounds.min[axis]), finite(bounds.max[axis]))),
    };
  }
  if (Array.isArray(box?.center) && Array.isArray(box?.size)) {
    const center = vector(box.center), half = scale(vector(box.size), 0.5);
    return { min: add(center, scale(half, -1)), max: add(center, half) };
  }
  throw new TypeError("Box requires min/max or center/size arrays");
}

/** Intersect a trajectory with an axis-aligned box and return the entered face. */
export function collideAxisAlignedBox(position, velocity, box, options = {}) {
  const { min, max } = boxBounds(box);
  const p = vector(position), v = vector(velocity);
  const motion = motionOptions(options);
  const candidates = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const side of [0, 1]) {
      const target = side === 0 ? min[axis] : max[axis];
      for (const timeS of axisRoots(p[axis], v[axis], motion.acceleration[axis], target, motion)) {
        candidates.push({ timeS, axis, side });
      }
    }
  }
  candidates.sort((a, b) => a.timeS - b.timeS || a.axis - b.axis || a.side - b.side);
  let best = null;
  for (const candidate of candidates) {
    const state = advanceBallistic(p, v, candidate.timeS, options);
    state.position[candidate.axis] = candidate.side === 0 ? min[candidate.axis] : max[candidate.axis];
    if (!insideBounds(state.position, { min, max }, motion.epsilon)) continue;
    const normal = [0, 0, 0];
    normal[candidate.axis] = candidate.side === 0 ? -1 : 1;
    if (dot(state.velocity, normal) >= -motion.epsilon) continue;
    const hit = impactRecord("box", box, candidate.timeS, state.position, state.velocity, normal);
    if (!best || candidate.timeS < best.timeS - motion.epsilon
      || (Math.abs(candidate.timeS - best.timeS) <= motion.epsilon && hit.normalSpeedMs > best.normalSpeedMs)) {
      best = hit;
    }
  }
  return best;
}

function collisionFor(collider, p, v, options) {
  const kind = String(collider?.type || collider?.kind || "box").toLowerCase().replace(/[\s_]/g, "");
  if (kind === "water" || kind === "waterplane") return collideWaterPlane(p, v, collider, options);
  if (kind === "plane" || kind === "architecturalplane") return collideArchitecturalPlane(p, v, collider, options);
  if (kind === "box" || kind === "aabb" || kind === "architecturalbox") return collideAxisAlignedBox(p, v, collider, options);
  throw new RangeError(`Unknown collision surface: ${collider?.type || collider?.kind}`);
}

/** Return the earliest hit, retaining input order for deterministic ties. */
export function findFirstCollision(position, velocity, colliders = [], options = {}) {
  const list = Array.isArray(colliders) ? [...colliders] : [colliders];
  if (options.waterPlane) list.unshift(options.waterPlane);
  let earliest = null;
  for (const collider of list) {
    if (!collider || collider.enabled === false) continue;
    const hit = collisionFor(collider, position, velocity, options);
    if (hit && (!earliest || hit.timeS < earliest.timeS - EPSILON)) earliest = hit;
  }
  return earliest;
}

export const intersectWaterPlane = collideWaterPlane;
export const intersectArchitecturalPlane = collideArchitecturalPlane;
export const intersectAxisAlignedBox = collideAxisAlignedBox;
export const findEarliestCollision = findFirstCollision;
export const secondaryEventRecommendations = recommendSecondaryEvents;
