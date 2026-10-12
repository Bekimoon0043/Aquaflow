/** Pure, read-only evaluation of a Site I-CAN pattern against engineering fixtures. */
import { evaluateFullShowPreview } from "./fullShowPreview";
export function createICANPreviewPlan(pattern, repeat = 1) {
  const steps = (pattern?.steps || []).map(step => {
    const duration = Number(step.duration_ms);
    if (!Number.isFinite(duration) || duration < 100 || duration > 60000) {
      throw new Error("Each preview step must last between 100 and 60000 ms.");
    }
    return { duration, groups: JSON.parse(JSON.stringify(step.groups || {})) };
  });
  if (!steps.length || steps.length > 500) throw new Error("Choose a pattern with 1–500 steps.");
  const passes = Number(repeat);
  if (!Number.isInteger(passes) || passes < 1 || passes > 20) throw new Error("Repeat must be 1–20.");
  const passMs = steps.reduce((sum, step) => sum + step.duration, 0);
  if (passMs * passes > 600000) throw new Error("Total preview duration must not exceed 10 minutes.");
  return { name: pattern.name || "Site pattern", patternId: pattern.id || "", steps, repeat: passes,
    passMs, duration: passMs * passes / 1000,
    ...(pattern.designClips ? { designClips: structuredClone(pattern.designClips) } : {}),
    ...(pattern.visualClips ? { visualClips: structuredClone(pattern.visualClips) } : {}) };
}

export function evaluateICANPreview(plan, position, fixtures = [], stopped = false) {
  if (plan.visualClips) return evaluateFullShowPreview(plan, position, fixtures, stopped);
  const timeMs = Math.max(0, Number(position) || 0) * 1000;
  const ended = timeMs >= plan.duration * 1000;
  const passIndex = Math.min(plan.repeat, Math.floor(timeMs / plan.passMs) + 1);
  let withinPass = timeMs % plan.passMs;
  let stepIndex = 0;
  while (stepIndex < plan.steps.length - 1 && withinPass >= plan.steps[stepIndex].duration) {
    withinPass -= plan.steps[stepIndex++].duration;
  }
  const groups = stopped || ended ? {} : plan.steps[stepIndex].groups;
  const selected = (group, channel) => (groups[String(group)] || []).includes(channel);
  const fixtureIntensities = {};
  let mapped = 0, unmapped = 0, active = 0;
  for (const fixture of fixtures) {
    const eng = fixture.engineering || {};
    // Only explicit capture-derived valve addresses drive water in this preview.
    // Pump separation, foam addresses, and frequency-to-height calibration are unresolved.
    const hasAddress = eng.siteFunction === "running-fountain"
      && [1, 9].includes(eng.icanGroup) && Number.isInteger(eng.icanChannel)
      && eng.icanChannel >= 9 && eng.icanChannel <= 40;
    let value = hasAddress && selected(eng.icanGroup, eng.icanChannel) ? 1 : 0;
    if (plan.designClips) {
      const t = (timeMs % plan.passMs) / 1000;
      value = stopped || ended ? 0 : Math.max(0, ...plan.designClips.filter(c => c.fixtureId === fixture.id && c.start <= t && t < c.end)
        .map(c => c.value / 100 * Math.min(1, c.fadeIn ? (t - c.start) / c.fadeIn : 1, c.fadeOut ? (c.end - t) / c.fadeOut : 1)));
    }
    fixtureIntensities[fixture.id] = value;
    if (hasAddress) mapped++;
    else if (String(fixture.type || "").startsWith("nozzle_")) unmapped++;
    if (value > 0) active++;
  }
  return { source: "ican-simulation", pump: 0, valve: 0, lighting: 0, flame: 0, fog: 0, laser: 0,
    groups: {}, fixtureIntensities, stepIndex, passIndex, ended, mapped, unmapped, active,
    supportSelected: selected(17, 29),
    protectedSelected: [2, 25].some(group => (groups[String(group)] || []).length > 0)
      || (groups["17"] || []).some(channel => channel !== 29),
  };
}
