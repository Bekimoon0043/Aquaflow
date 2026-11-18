import { findFirstCollision } from "./collisionModels.js";
import { insidePool } from "../splashMap.js";

export const MAX_ARCHITECTURAL_COLLIDERS = 4;

export function basinRimCollision(previous, position, velocity, pool) {
  if (!pool || !Array.isArray(previous) || !Array.isArray(position) || !Array.isArray(velocity)) return null;
  const kerbY = Number.isFinite(Number(pool.kerbY)) ? Number(pool.kerbY) : 0.45;
  if (position[1] >= kerbY || position[1] < 0.05 || previous[1] < 0.05) return null;
  const wasInside = insidePool(previous[0], previous[2], pool);
  const isInside = insidePool(position[0], position[2], pool);
  if (wasInside === isInside) return null;
  return {
    type: "basin-rim",
    position: [...previous],
    velocity: [-velocity[0] * 0.15, Math.abs(velocity[1]) * 0.08, -velocity[2] * 0.15],
    insideBasin: wasInside,
    kerbY,
  };
}

function overlapsSweep(previous, position, collider, padding = 0.02) {
  const min = collider?.min, max = collider?.max;
  if (!Array.isArray(min) || !Array.isArray(max)) return false;
  for (let axis = 0; axis < 3; axis++) {
    const lo = Math.min(previous[axis], position[axis]) - padding;
    const hi = Math.max(previous[axis], position[axis]) + padding;
    if (hi < Number(min[axis]) || lo > Number(max[axis])) return false;
  }
  return true;
}

export function architecturalCollision(previous, position, velocity, colliders = [], deltaS = 1 / 60) {
  if (!Array.isArray(previous) || !Array.isArray(position) || !Array.isArray(velocity)) return null;
  const candidates = colliders.filter((collider) => collider?.enabled !== false && overlapsSweep(previous, position, collider));
  if (!candidates.length) return null;
  const hit = findFirstCollision(previous, velocity, candidates, { maxTimeS: Math.max(0, deltaS) });
  if (!hit || hit.timeS > deltaS) return null;
  const dot = hit.velocity.reduce((sum, value, axis) => sum + value * hit.normal[axis], 0);
  return {
    ...hit,
    position: hit.position.map((value, axis) => value + hit.normal[axis] * 0.008),
    velocity: hit.velocity.map((value, axis) => (value - 1.1 * dot * hit.normal[axis]) * 0.35),
    insideBasin: false,
  };
}

export function colliderFromBounds(id, min, max) {
  if (!Array.isArray(min) || !Array.isArray(max) || min.length < 3 || max.length < 3) return null;
  const lo = min.map(Number), hi = max.map(Number);
  if (![...lo, ...hi].every(Number.isFinite)) return null;
  if (hi.some((value, axis) => value <= lo[axis])) return null;
  return { id: String(id), type: "box", surface: "architecture", min: lo, max: hi, enabled: true };
}

export function nearestColliders(colliders = [], limit = MAX_ARCHITECTURAL_COLLIDERS) {
  return [...colliders]
    .filter(Boolean)
    .sort((a, b) => {
      const distance = (collider) => Math.hypot(...[0, 2].map((axis) => (collider.min[axis] + collider.max[axis]) / 2));
      return distance(a) - distance(b) || String(a.id).localeCompare(String(b.id));
    })
    .slice(0, Math.max(0, limit));
}
