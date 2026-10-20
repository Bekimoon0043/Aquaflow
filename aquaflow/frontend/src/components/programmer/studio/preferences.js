// Learning from the user — Phase 5. Pure.
//
//   A/B choices  "I prefer this variant" over the others the user looked at → a
//                Bradley–Terry / logistic model over the show metrics learns which qualities
//                this user values; the learned weights rank new variants ("Best of N").
//   look bias    looks the user locks gain favour, looks the user deletes or replaces lose it;
//                the phrase search adds the bias to its cost (a small prior, never a rule).
//
// Preferences live on the studio (per project) and can be copied to the user's library.

import { SCORE_WEIGHTS } from './showMetrics';

export const PREF_VERSION = 1;
export const METRIC_KEYS = Object.keys(SCORE_WEIGHTS);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const emptyPreferences = () => ({ version: PREF_VERSION, comparisons: [], lookBias: {}, weights: null });

/** Record that `winner` (metrics) was preferred over each of `losers` (metrics). */
export function recordChoice(prefs, winner, losers) {
  const p = prefs?.version === PREF_VERSION ? prefs : emptyPreferences();
  const pick = (m) => Object.fromEntries(METRIC_KEYS.map((k) => [k, Number(m?.[k]) || 0]));
  const add = losers.filter(Boolean).map((l) => ({ w: pick(winner), l: pick(l), at: Date.now() }));
  return { ...p, comparisons: [...p.comparisons, ...add].slice(-500) };
}

/**
 * Fit metric weights from the comparisons: logistic regression on metric differences
 * (Bradley–Terry with a linear utility), L2-pulled towards the default weights so a few
 * choices nudge rather than overturn them. Weights stay ≥ 0 and sum to 1.
 */
export function fitWeights(prefs, { steps = 400, rate = 0.5, l2 = 0.5 } = {}) {
  const data = prefs?.comparisons || [];
  const prior = METRIC_KEYS.map((k) => SCORE_WEIGHTS[k]);
  if (data.length < 3) return { weights: { ...SCORE_WEIGHTS }, n: data.length, accuracy: null };
  let w = prior.map((v) => v * 8);
  const X = data.map((c) => METRIC_KEYS.map((k) => c.w[k] - c.l[k]));
  for (let s = 0; s < steps; s++) {
    const grad = w.map(() => 0);
    for (const x of X) {
      const z = x.reduce((a, v, i) => a + v * w[i], 0);
      const p = 1 / (1 + Math.exp(-z));
      x.forEach((v, i) => { grad[i] += (1 - p) * v; });
    }
    w = w.map((v, i) => Math.max(0, v + rate * (grad[i] / X.length - l2 * (v - prior[i] * 8) / X.length)));
  }
  const sum = w.reduce((a, v) => a + v, 0) || 1;
  const weights = Object.fromEntries(METRIC_KEYS.map((k, i) => [k, Math.round((w[i] / sum) * 1000) / 1000]));
  const accuracy = X.filter((x) => x.reduce((a, v, i) => a + v * w[i], 0) > 0).length / X.length;
  return { weights, n: data.length, accuracy: Math.round(accuracy * 100) / 100 };
}

/** Score metrics with the learned (or default) weights, 0..100. */
export function preferenceScore(metrics, weights = SCORE_WEIGHTS) {
  return Math.round(1000 * METRIC_KEYS.reduce((s, k) => s + (weights[k] || 0) * (Number(metrics?.[k]) || 0), 0)) / 10;
}

/** Locking a look: +0.15 favour (max +0.6). Deleting / replacing one: −0.2 (min −0.8). */
export function nudgeLook(prefs, lookId, kind) {
  const p = prefs?.version === PREF_VERSION ? prefs : emptyPreferences();
  const d = kind === 'lock' ? 0.15 : kind === 'delete' ? -0.2 : 0;
  const v = clamp((p.lookBias[lookId] || 0) + d, -0.8, 0.6);
  return { ...p, lookBias: { ...p.lookBias, [lookId]: Math.round(v * 100) / 100 } };
}

/** Learn from an edit of the studio: plan looks whose recipes the user deleted lose favour. */
export function learnFromEdit(prefs, before, after) {
  if (!before?.recipes || !after?.recipes) return prefs;
  const left = new Set(after.recipes.map((r) => r.id));
  const gone = before.recipes.filter((r) => r.pattern?.plan && r.pattern?.role !== 'lights' && !left.has(r.id));
  const looks = [...new Set(gone.map((r) => r.pattern.look).filter(Boolean))];
  return looks.reduce((p, look) => nudgeLook(p, look, 'delete'), prefs || emptyPreferences());
}
