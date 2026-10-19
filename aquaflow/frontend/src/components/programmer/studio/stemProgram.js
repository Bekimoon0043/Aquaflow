// Program the show from stems: each part of the music (kick, hats, bass, vocal melody, …)
// drives its own fountain group as keyed level curves — one "curve" recipe per group and
// 16 s block, sampled 20× a second — so the water moves with that instrument only.
// Pure (no React); PatternBuilder calls it, the tests call it directly.

import { newRecipe, resolveMembers, uid } from './showModel';
import { ensureGroup, pruneBuilderGroups, isLightItem, isWaterItem } from './patternPresets';
import { STEM_RATE, STEM_ROLES } from './stemAnalysis';

export const STEM_BLOCK_S = 16;
export const STEM_SAMPLE_RATE = 20;

/** What a stem can drive. `field` picks the onset list for hits. */
export const STEM_SOURCES = [
  { id: 'drums:kicks', stem: 'drums', label: 'Drums — kick', behaviour: 'hits', field: 'kicks', decay: 0.35 },
  { id: 'drums:hats', stem: 'drums', label: 'Drums — snare & hats', behaviour: 'hits', field: 'hats', decay: 0.15 },
  { id: 'drums:hits', stem: 'drums', label: 'Drums — every hit', behaviour: 'hits', field: 'hits', decay: 0.25 },
  { id: 'bass', stem: 'bass', label: 'Bass', behaviour: 'follow' },
  { id: 'vocals:melody', stem: 'vocals', label: 'Vocals — melody', behaviour: 'melody' },
  { id: 'vocals', stem: 'vocals', label: 'Vocals — loudness', behaviour: 'follow' },
  { id: 'other', stem: 'other', label: 'Other', behaviour: 'follow' },
  { id: 'other:melody', stem: 'other', label: 'Other — melody', behaviour: 'melody' },
  { id: 'piano', stem: 'piano', label: 'Piano', behaviour: 'follow' },
  { id: 'piano:melody', stem: 'piano', label: 'Piano — melody', behaviour: 'melody' },
  { id: 'guitar', stem: 'guitar', label: 'Guitar', behaviour: 'follow' },
  { id: 'guitar:melody', stem: 'guitar', label: 'Guitar — melody', behaviour: 'melody' },
];
export const sourceById = (id) => STEM_SOURCES.find((s) => s.id === id);

/** Sources whose stem has been loaded (and, for drums parts, analysed with that part). */
export function availableSources(stems = []) {
  const roles = new Map(stems.map((s) => [s.role, s.analysis]));
  return STEM_SOURCES.filter((src) => {
    const a = roles.get(src.stem);
    if (!a) return false;
    if (src.behaviour === 'hits') return Array.isArray(a[src.field]);
    if (src.behaviour === 'melody') return Array.isArray(a.pitch);
    return Array.isArray(a.level);
  });
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const at = (curve, t) => {
  if (!curve?.length) return 0;
  const x = t * STEM_RATE;
  const i = Math.floor(x);
  if (i < 0) return curve[0];
  if (i >= curve.length - 1) return curve[curve.length - 1];
  const a = curve[i], b = curve[i + 1];
  return a + (b - a) * (x - i);
};

/**
 * The 0..1 value a source asks for at each of `times` (seconds). Melody returns −1 where
 * nothing is sung (the group rests).
 */
export function sourceValues(analysis, source, times) {
  if (source.behaviour === 'hits') {
    const hits = analysis[source.field] || [];
    const out = new Array(times.length).fill(0);
    let k = 0;
    const active = [];
    times.forEach((t, i) => {
      while (k < hits.length && hits[k].t <= t + 1e-6) active.push(hits[k++]);
      let v = 0;
      for (let j = active.length - 1; j >= 0; j--) {
        const age = t - active[j].t;
        if (age > source.decay * 5) { active.splice(0, j + 1); break; }
        v = Math.max(v, active[j].s * Math.exp(-age / source.decay));
      }
      out[i] = clamp01(v);
    });
    return out;
  }
  if (source.behaviour === 'melody') {
    return times.map((t) => {
      const i = Math.round(t * STEM_RATE);
      const p = analysis.pitch?.[Math.min(analysis.pitch.length - 1, Math.max(0, i))];
      return p == null || p < 0 ? -1 : clamp01(0.25 + 0.75 * p);
    });
  }
  return times.map((t) => clamp01(at(analysis.level, t)));
}

/**
 * Suggested source → group rows: kick on the biggest water group, bass on the tallest jets,
 * the vocal melody on moving / rotating jets, hats and the rest on what is left; lights
 * follow the drums when there is a light group.
 */
export function suggestRows(stems, waterGroups, lightGroups, membersOf) {
  const sources = availableSources(stems);
  const has = (id) => sources.some((s) => s.id === id);
  // Groups that are mostly nozzles: pumps and valves should not flick with every hi-hat.
  const isNozzle = (m) => /nozzle|jet|geyser|rotat|basket|pirouette|motion|swing|fountain/i.test(`${m.type} ${m.label || ''}`)
    && !/pump|valve|solenoid_valve/i.test(String(m.type));
  const info = waterGroups.map((g) => {
    const members = membersOf(g);
    const nozzles = members.filter(isNozzle);
    const height = Math.max(0, ...nozzles.map((m) => Number(m.engineering?.jetHeightM) || 0));
    const moving = nozzles.some((m) => /motion|rotat|basket|pirouette|swing/i.test(`${m.type} ${m.label || ''}`));
    return { g, ids: new Set(members.map((m) => m.id)), size: nozzles.length, share: members.length ? nozzles.length / members.length : 0, height, moving };
  }).filter((x) => x.size > 0 && x.share >= 0.6 && !x.g.quick);
  const pool = [...(info.length ? info : waterGroups.map((g) => ({ g, ids: new Set(membersOf(g).map((m) => m.id)), size: membersOf(g).length, height: 0, moving: false })))];
  // Two parts must not drive the same jets: a taken group removes every group that shares
  // half its jets with it (the last group left is still offered).
  const take = (pick) => {
    if (!pool.length) return null;
    const best = pool.reduce((a, b) => (pick(b) > pick(a) ? b : a));
    const overlaps = (x) => { let n = 0; for (const id of x.ids) if (best.ids.has(id)) n++; return n >= 0.5 * Math.min(x.ids.size, best.ids.size); };
    for (let i = pool.length - 1; i >= 0; i--) if (pool[i] === best || overlaps(pool[i])) pool.splice(i, 1);
    return best.g.id;
  };
  const rows = [];
  const add = (sourceId, groupId, min, max) => { if (groupId && has(sourceId)) rows.push({ sourceId, groupId, min, max, kind: 'water' }); };
  if (has('vocals:melody')) add('vocals:melody', take((x) => (x.moving ? 1000 : 0) + x.height), 20, 100);
  if (has('bass')) add('bass', take((x) => x.height * 10 - x.size * 0.01), 25, 95);
  if (has('drums:kicks')) add('drums:kicks', take((x) => x.size), 10, 100);
  if (has('drums:hats')) add('drums:hats', take((x) => -x.height), 0, 70);
  for (const id of ['other', 'piano', 'guitar']) if (has(id)) add(id, take((x) => x.size), 15, 75);
  const light = lightGroups.find((g) => membersOf(g).length);
  const lightSource = ['drums:kicks', 'bass', 'vocals', 'other'].find(has);
  if (light && lightSource) rows.push({ sourceId: lightSource, groupId: light.id, min: 15, max: 100, kind: 'lights' });
  return rows;
}

/**
 * Replace any earlier stem programming with curves for `rows`.
 * @param {object} studio
 * @param {object} p { stems: [{role, analysis}], rows: [{sourceId, groupId, min, max, kind}], items, groups,
 *                     start?, end? }
 * @returns {{ studio, recipes, fillId, skipped: string[] }}
 */
export function programFromStems(studio, { stems, rows, items, groups, start = 0, end = null }) {
  const byRole = new Map(stems.map((s) => [s.role, s.analysis]));
  const duration = Math.min(600, end ?? Math.max(...stems.map((s) => s.analysis?.duration || 0)));
  if (!(duration > start)) throw new Error('Load the stems first.');
  const previous = studio.recipes.filter((r) => r.stems);
  let next = pruneBuilderGroups({ ...studio, recipes: studio.recipes.filter((r) => !r.stems) }, previous.map((r) => r.groupId));
  const fillId = uid('stems');
  const recipes = [];
  const skipped = [];
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const row of rows) {
    const source = sourceById(row.sourceId);
    const analysis = source && byRole.get(source.stem);
    const group = groups.find((g) => g.id === row.groupId);
    if (!source || !analysis || !group) { skipped.push(row.sourceId); continue; }
    const members = resolveMembers(group, items).map((id) => itemById.get(id)).filter(Boolean);
    const fits = row.kind === 'lights' ? members.some(isLightItem) : members.some(isWaterItem);
    if (!fits) { skipped.push(source.label); continue; }
    const ensured = ensureGroup(next, group);
    next = ensured.studio;
    const lo = Math.max(0, Math.min(100, Number(row.min) || 0)) / 100;
    const hi = Math.max(lo, Math.min(100, Number(row.max) || 100) / 100);
    const color = STEM_ROLES[source.stem]?.color || '#65d9d0';
    for (let t0 = start; t0 < duration - 0.05; t0 += STEM_BLOCK_S) {
      const len = Math.round(Math.min(STEM_BLOCK_S, duration - t0) * 1000) / 1000;
      const n = Math.max(2, Math.round(len * STEM_SAMPLE_RATE));
      const times = Array.from({ length: n + 1 }, (_, k) => t0 + (k / n) * len);
      const values = sourceValues(analysis, source, times);
      if (values.every((v) => v <= 0)) continue;           // silent block: no clips
      const envelope = values.map((v, k) => ({ time: Math.round((k / n) * 1e5) / 1e5, value: Math.round((v < 0 ? 0 : lo + (hi - lo) * v) * 1e4) / 1e4 }));
      const recipe = {
        ...newRecipe(ensured.groupId, Math.round(t0 * 1000) / 1000),
        name: `♫ ${source.label}`, effect: 'curve', duration: len, cycles: 1, spread: 0, intensity: 100,
        color, order: group.orderMode || 'engineering', envelope, sampleRate: STEM_SAMPLE_RATE,
        stems: { fill: fillId, source: source.id, kind: row.kind || 'water' },
      };
      next = { ...next, recipes: [...next.recipes, recipe] };
      recipes.push(recipe);
    }
  }
  return { studio: next, recipes, fillId, skipped };
}
