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
import { compileStudio } from './showModel';
import { measureShow } from './showMetrics';
import { fitWeights, preferenceScore } from './preferences';
import { applyDirection } from './directorPlan';

/**
 * @param {object} studio
 * @param {object} p { analysis, stems, items, groups, design?, seed?, variant?, locks?, meter?, site?, weights? }
 * @returns {{ studio, plan, recipes, counts, muted, scm }}
 */
export function createShow(studio, { analysis, stems = [], items, groups, design = readFountainDesign(items), seed = studio.plan?.seed ?? 0,
  variant = 0, locks = studio.plan?.locks || {}, meter = studio.meter, site = studio.site, weights, direction = studio.plan?.direction || null }) {
  if (!analysis?.bpm) throw new Error('Find the beats first');
  const a = applyMeter(songAnalysis(analysis), meter);
  const scm = buildSiteModel(items, { design, overrides: site || {} });
  // An AI director's section plan (optional) refines the rule plan before the search.
  const arc = direction ? applyDirection(planShow({ analysis: a, stems, scm, seed }), direction, scm) : planShow({ analysis: a, stems, scm, seed });
  const plan = searchPhrases(arc, { analysis: a, stems, scm, variant, locks, weights, lookBias: studio.preferences?.lookBias || {} });
  const out = renderPlan(studio, plan, { analysis: a, items, groups, design, scm });
  const stored = { ...plan, locks, ...(direction ? { direction } : {}) };
  return { ...out, studio: { ...out.studio, plan: stored }, plan: stored, scm };
}

/**
 * Make `n` shows (seeds × variants), compile and measure each, and keep the best: every hard
 * gate passed first, then the highest score with the user's learned weights.
 * @returns {{ best, ranked: [{ seed, variant, score, pass, metrics }] }}
 */
export function bestOf(studio, ctx, { n = 4, from = (studio.plan?.seed ?? 0) + 1 } = {}) {
  const learned = fitWeights(studio.preferences).weights;
  const tries = Array.from({ length: n }, (_, k) => ({ seed: from + Math.floor(k / 2), variant: k % 2 }));
  const ranked = tries.map(({ seed, variant }) => {
    const out = createShow(studio, { ...ctx, seed, variant });
    const { clips } = compileStudio(out.studio, ctx.items);
    const m = measureShow({ clips, items: ctx.items, analysis: ctx.analysis, studio: out.studio, design: ctx.design, basin: ctx.site?.basin || studio.site?.basin, windMs: (ctx.site || studio.site)?.windMs || 0 });
    return { seed, variant, out, pass: m.pass, metrics: m.metrics, score: preferenceScore(m.metrics, learned) };
  }).sort((a, b) => (b.pass - a.pass) || b.score - a.score);
  return { best: ranked[0].out, ranked: ranked.map(({ out, ...r }) => r) };
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
