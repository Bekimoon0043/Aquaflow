/**
 * jetPhysics.js — AQ-S2-002 Phase 2.
 *
 * The rule that makes the preview engineering-true, kept as pure functions so it
 * is directly testable without a WebGL context and has exactly one definition.
 *
 * PHYSICS IS THE CEILING; THE SHOW SCALES BENEATH IT.
 *
 * The backend solver (services/hydraulic_solver.py) gives each nozzle a solved
 * exit velocity and the jet height it can reach. The show's runtime intensity —
 * which already carries the choreography's heightScale — is a DEMAND FRACTION of
 * that maximum, not an independent height.
 *
 * Because jet height goes as v²/2g, rendering a fraction f of the maximum height
 * requires sqrt(f) of the maximum velocity. So choreography still drives the jets
 * up and down continuously, while a demand above 1.0 is clamped to the physical
 * maximum and reported as over-demand rather than being silently drawn.
 */

/** Accept a solver record only if it carries a usable exit velocity. */
export function normalizePhysics(rec) {
  const v = Number(rec?.exitVelocityMs);
  return Number.isFinite(v) && v > 0 ? rec : null;
}

/**
 * Launch speed for one nozzle this frame.
 *
 * @param {object|null} physics  solved record { exitVelocityMs, jetHeightM }
 * @param {number} demand        runtime intensity (show × heightScale); 1.0 = design max
 * @param {number} fallbackSpeed legacy per-type estimate, used when unsolved
 * @param {object} [sink]        collects over-demand reports, keyed by nozzle id
 * @param {string} [id]          nozzle id for the report
 */
export function launchSpeed(physics, demand, fallbackSpeed, sink, id) {
  const p = normalizePhysics(physics);
  if (!p) return fallbackSpeed;               // unsolved → legacy estimate, unchanged

  const d = Math.max(0, Number(demand) || 0);

  if (d > 1.0 && sink) {
    const key = id || "?";
    const prev = sink[key];
    // Keep the WORST offence seen, not merely the most recent one.
    if (!prev || d > prev.demand) {
      sink[key] = { demand: d, jetHeightM: Number(p.jetHeightM) || 0 };
    }
  }

  return Number(p.exitVelocityMs) * Math.sqrt(Math.min(d, 1.0));
}

/** Ideal free-jet height for a launch speed (v²/2g). */
export function jetHeightFor(v, gravity = 9.81) {
  const s = Number(v) || 0;
  return (s * s) / (2 * gravity);
}
