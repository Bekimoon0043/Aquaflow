// waterPhysics.js — AquaFlow Stage 3, Priority 4 (AQ-S3-004)
//
// Deterministic water-jet particle physics for the photorealistic renderer.
// A fountain droplet is a projectile: it leaves the nozzle with some velocity and
// follows parabolic motion under gravity (with optional linear air drag). These
// pure functions are the single source of truth for the jet trajectories the
// FountainScene renders, and they are unit-tested independently of Three.js.

export const GRAVITY = 9.81; // m/s^2

/** Launch speed (m/s) needed for a vertical jet to reach a given apex height. */
export function jetLaunchSpeed(heightM, g = GRAVITY) {
  return Math.sqrt(2 * g * Math.max(0, heightM));
}

/** Apex height (m) reached by a jet launched straight up at `speed`. */
export function apexHeight(speed, g = GRAVITY) {
  return (speed * speed) / (2 * g);
}

/** Time (s) for a vertical droplet to rise and fall back to its launch height. */
export function timeOfFlight(vy, g = GRAVITY) {
  return (2 * Math.max(0, vy)) / g;
}

/** Split a launch speed into a velocity vector given tilt from vertical (deg). */
export function launchVelocity(speed, tiltXDeg = 0, tiltZDeg = 0) {
  const rx = (tiltXDeg * Math.PI) / 180;
  const rz = (tiltZDeg * Math.PI) / 180;
  // Vertical component reduced by tilt; horizontal spread from the two tilts.
  const vy = speed * Math.cos(rx) * Math.cos(rz);
  const vx = speed * Math.sin(rx);
  const vz = speed * Math.sin(rz);
  return { vx, vy, vz };
}

/**
 * Position of a droplet at time t under gravity, with optional linear drag `k`
 * (per second). With drag=0 this is exact projectile motion:
 *   y = y0 + vy*t - 0.5*g*t^2
 */
export function dropletPosition({ x0 = 0, y0 = 0, z0 = 0, vx = 0, vy = 0, vz = 0,
                                  t = 0, g = GRAVITY, drag = 0 } = {}) {
  if (drag > 0) {
    // Integrated linear-drag solution: v(t)=v0*e^{-kt}; position from integrating.
    const e = Math.exp(-drag * t);
    const gx = 0, gz = 0, gy = -g;
    const px = x0 + (vx / drag) * (1 - e) + (gx / drag) * (t - (1 - e) / drag);
    const py = y0 + (vy / drag) * (1 - e) + (gy / drag) * (t - (1 - e) / drag);
    const pz = z0 + (vz / drag) * (1 - e) + (gz / drag) * (t - (1 - e) / drag);
    return { x: px, y: py, z: pz };
  }
  return {
    x: x0 + vx * t,
    y: y0 + vy * t - 0.5 * g * t * t,
    z: z0 + vz * t,
  };
}

/**
 * Sample a jet's trajectory as an array of {t,x,y,z} points from launch until it
 * returns to (or falls below) the launch height. Deterministic.
 */
export function simulateJet({ origin = { x: 0, y: 0, z: 0 }, speed = 0,
                              tiltXDeg = 0, tiltZDeg = 0, g = GRAVITY,
                              steps = 24, drag = 0 } = {}) {
  const { vx, vy, vz } = launchVelocity(speed, tiltXDeg, tiltZDeg);
  const flight = timeOfFlight(vy, g) || 0;
  const pts = [];
  const n = Math.max(1, steps);
  for (let i = 0; i <= n; i++) {
    const t = (flight * i) / n;
    const p = dropletPosition({ x0: origin.x, y0: origin.y, z0: origin.z,
                                vx, vy, vz, t, g, drag });
    pts.push({ t, ...p });
  }
  return pts;
}
