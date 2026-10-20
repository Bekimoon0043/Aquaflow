// Automatic show — the whole pipeline in one call:
//   meter → Site Capability Model → show-arc plan → phrase search → render → (compile drives hardware)
// The plan is stored on the studio (studio.plan) so it can be shown, varied and locked.

import { applyMeter } from './musicMeter';
import { buildSiteModel } from './siteCapability';
import { planShow } from './arcPlanner';
import { searchPhrases } from './phraseSearch';
import { renderPlan } from './planRender';
import { readFountainDesign } from './fountainDesign';
import { songAnalysis } from './deepMerge';

/**
 * @param {object} studio
 * @param {object} p { analysis, stems, items, groups, design?, seed?, variant?, locks?, meter?, site?, weights? }
 * @returns {{ studio, plan, recipes, counts, muted, scm }}
 */
export function createShow(studio, { analysis, stems = [], items, groups, design = readFountainDesign(items), seed = studio.plan?.seed ?? 0,
  variant = 0, locks = studio.plan?.locks || {}, meter = studio.meter, site = studio.site, weights }) {
  if (!analysis?.bpm) throw new Error('Find the beats first');
  const a = applyMeter(songAnalysis(analysis), meter);
  const scm = buildSiteModel(items, { design, overrides: site || {} });
  const plan = searchPhrases(planShow({ analysis: a, stems, scm, seed }), { analysis: a, stems, scm, variant, locks, weights });
  const out = renderPlan(studio, plan, { analysis: a, items, groups, design, scm });
  const stored = { ...plan, locks };
  return { ...out, studio: { ...out.studio, plan: stored }, plan: stored, scm };
}

/** Lock or unlock one voice of one phrase at its current look. */
export function toggleLock(plan, sectionId, phraseIndex, areaId) {
  const key = `${sectionId}:${phraseIndex}:${areaId}`;
  const locks = { ...(plan.locks || {}) };
  if (locks[key]) delete locks[key];
  else {
    const look = plan.sections.find((s) => s.id === sectionId)?.phrases[phraseIndex]?.voices.find((v) => v.areaId === areaId)?.look;
    if (look) locks[key] = look;
  }
  return { ...plan, locks };
}
