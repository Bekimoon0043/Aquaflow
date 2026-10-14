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
 *
 * THE DESIGN HEIGHT IS WHAT 100 % LOOKS LIKE. A nozzle whose fixture states a design jet
 * height (engineering.jetHeightM → config.designHeightM) is drawn at exactly that apex at
 * full demand: launch speed sqrt(2 g H). The solve still caps it from above (a design the
 * hydraulics cannot deliver is drawn at what they deliver), but a pump with head to spare
 * no longer throws a 0.58 m bubbler several metres into the air, and without a solve the
 * design height replaces the per-type estimate.
 */

/** Design heights outside this range are treated as data errors and clamped. */
export const DESIGN_HEIGHT_RANGE_M = Object.freeze({ min: 0.03, max: 120 });

/** Launch speed whose ballistic apex is the design height, or null when none is given. */
export function designLaunchSpeed(heightM, gravity = 9.81) {
  const h = Number(heightM);
  if (!(Number.isFinite(h) && h > 0)) return null;
  const clamped = Math.min(DESIGN_HEIGHT_RANGE_M.max, Math.max(DESIGN_HEIGHT_RANGE_M.min, h));
  return Math.sqrt(2 * gravity * clamped);
}

/**
 * Accept a solver record only if it carries a usable exit velocity — or, in the
 * AF-NEXT-007 engineering preview, an engineering cap (`engineeringCapMs`, the launch
 * speed whose apex is the height the time-dependent hydraulics deliver at the playhead).
 */
export function normalizePhysics(rec) {
  const v = Number(rec?.exitVelocityMs);
  if (Number.isFinite(v) && v > 0) return rec;
  return rec && rec.engineeringCapMs != null && Number.isFinite(Number(rec.engineeringCapMs)) ? rec : null;
}

/** Engineering-preview gate: 0 removes the jet (closed valve, stopped pump, filling pipe). */
export function engineeringGate(physics) {
  const g = Number(physics?.engineeringGate);
  return Number.isFinite(g) ? Math.max(0, Math.min(1, g)) : 1;
}

/**
 * Launch speed for one nozzle this frame.
 *
 * @param {object|null} physics  solved record { exitVelocityMs, jetHeightM }
 * @param {number} demand        runtime intensity (show × heightScale); 1.0 = design max
 * @param {number} fallbackSpeed legacy per-type estimate, used when unsolved
 * @param {object} [sink]        collects over-demand reports, keyed by nozzle id
 * @param {string|object} [nozzle] nozzle id for the report, or the nozzle config
 *                                 ({ id, designHeightM }) — the design height then sets
 *                                 the full-demand apex (see above)
 */
export function launchSpeed(physics, demand, fallbackSpeed, sink, nozzle) {
  const cfg = nozzle && typeof nozzle === "object" ? nozzle : null;
  const id = cfg ? cfg.id : nozzle;
  const vDesign = cfg ? designLaunchSpeed(cfg.designHeightM) : null;
  const d = Math.max(0, Number(demand) || 0);
  const p = normalizePhysics(physics);
  // Unsolved → the design height if stated, else the legacy per-type estimate, unchanged.
  if (!p) return vDesign != null ? vDesign * Math.sqrt(Math.min(d, 1.0)) : fallbackSpeed;

  // AF-NEXT-007 engineering preview: the delivered hydraulics cap the launch speed.
  const cap = p.engineeringCapMs != null ? Math.max(0, Number(p.engineeringCapMs)) : Infinity;
  const vSolved = Number(p.exitVelocityMs);
  if (!(Number.isFinite(vSolved) && vSolved > 0)) {
    return Math.min(vDesign != null ? vDesign * Math.sqrt(Math.min(d, 1.0)) : fallbackSpeed, cap);
  }
  // Physics is the ceiling; the design height is what full demand looks like beneath it.
  const v0 = vDesign != null ? Math.min(vSolved, vDesign) : vSolved;

  if (d > 1.0 && sink) {
    const key = id || "?";
    const prev = sink[key];
    // Keep the WORST offence seen, not merely the most recent one.
    if (!prev || d > prev.demand) {
      const solvedH = Number(p.jetHeightM) || 0;
      sink[key] = { demand: d, jetHeightM: vDesign != null && v0 < vSolved ? jetHeightFor(v0) : solvedH };
    }
  }

  return Math.min(cap, v0 * Math.sqrt(Math.min(d, 1.0)));
}

/** Ideal free-jet height for a launch speed (v²/2g). */
export function jetHeightFor(v, gravity = 9.81) {
  const s = Number(v) || 0;
  return (s * s) / (2 * gravity);
}
