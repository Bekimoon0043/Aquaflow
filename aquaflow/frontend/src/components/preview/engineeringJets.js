/**
 * engineeringJets.js — AF-NEXT-007 engineering preview wiring for FountainScene_v6.
 *
 * Kept out of FountainScene_v6.js (line-count guard). In "engineering" mode every nozzle
 * that the hydraulic timeline covers gets a physics record whose launch speed is capped
 * at the speed whose apex is the DELIVERED height at the playhead (overloaded pump,
 * closed valve, ramp, pipe fill), and a gate that removes the jet entirely when no water
 * reaches it. "creative" mode restores the design-time solve (instant response).
 */

export const PREVIEW_MODES = Object.freeze({ CREATIVE: "creative", ENGINEERING: "engineering" });

/**
 * Physics record for one nozzle in engineering mode, or null to leave it on its
 * design-time record (no hydraulic data / not connected).
 * @param {object|null} base   the design-time record ({exitVelocityMs, jetHeightM}) if any
 * @param {object} sample      sampleHydraulicTimeline(...)[id]
 */
export function engineeringPhysicsRecord(base, sample) {
  if (!sample || sample.passthrough) return null;
  const nominal = Number(sample.nominalRenderSpeedMs);
  const cap = sample.removed ? 0 : Math.max(0, Number(sample.renderSpeedMs) || 0);
  return {
    ...(base || {}),
    // Full-demand launch speed = the design jet height's ballistic speed, so the creative
    // level → height mapping is the same as the timeline's demanded height.
    exitVelocityMs: Number.isFinite(nominal) && nominal > 0 ? nominal : base?.exitVelocityMs,
    engineeringCapMs: cap,
    engineeringGate: sample.removed || !(cap > 0) ? 0 : 1,
    engineeringState: sample.stateName,
    basis: "ENGINEERING_TIMELINE",
  };
}

/**
 * Apply (or clear, with samples = null) the engineering records on the scene's nozzles.
 * Returns the number of nozzles driven by the timeline.
 */
export function applyEngineeringJets(scene, samples) {
  if (!scene) return 0;
  const design = scene._nozzlePhysics || null;
  let driven = 0;
  for (const nz of scene.nozzles || []) {
    const id = nz?.config?.id;
    const base = design ? design[id] || null : null;
    const rec = samples ? engineeringPhysicsRecord(base, samples[id]) : null;
    if (rec) driven++;
    nz.setPhysics?.(rec || base, scene._overDemand);
  }
  return driven;
}
