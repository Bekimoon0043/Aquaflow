// Water follows its stem — every linked group plays its own part of the music, all together, all
// song long: phrase by phrase on the song's arc each group gets the next wave of its part's
// family (repeats of a section echo it), and that part's envelope shapes the wave moment by
// moment (field.music → musicGain). One light group changes colour with the plan and its
// brightness follows its part. Pure (no React); PatternBuilder calls it, the tests call it.

import { applyMeter } from './musicMeter';
import { songAnalysis } from './deepMerge';
import { buildSiteModel } from './siteCapability';
import { planShow } from './arcPlanner';
import { canPerform, sectionPhrases } from './phraseSearch';
import { renderPlan } from './planRender';
import { LOOKS, lookById } from './lookLibrary';
import { partFamily } from './famousPatterns';
import { readFountainDesign } from './fountainDesign';
import { songStem, sourceById, sourceValues } from './stemProgram';
import { ensureGroup, isLightItem, isWaterItem } from './patternPresets';
import { newRecipe, resolveMembers } from './showModel';
import { visibleLead, windSafeScale } from '../../preview/waterPhysics';

const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const STEM_ENVELOPE_RATE = 10;

/**
 * Each part's family of looks (in turn order), the share of the wave left when the part is
 * silent (`floor`) and the closing look of the climax (`finale`). The first look the group's
 * hardware can perform is used when a look does not fit.
 */
export const STEM_LOOK_FAMILIES = {
  bass: { label: 'bass', looks: ['ocean-sets', 'tidal-bore', 'rolling-sea', 'lake-aurora', 'standing-wave'], floor: 0.08 },
  melody: { label: 'melody', looks: ['swaying-arcs', 'moving-spot', 'pond-interference', 'willow-burst'], floor: 0 },
  song: { label: 'song', looks: ['radial-ripple', 'stadium-wave', 'spiral-arms', 'crossing-waves', 'surf-break'], finale: 'grand-finale', floor: 0.12 },
  hits: { label: 'hits', looks: ['heartbeat', 'firework-burst', 'wall-pulse', 'running-gap', 'bounce'], floor: 0 },
  hats: { label: 'hats', looks: ['stadium-wave', 'rain', 'waterfall-steps', 'running-gap', 'sparkle'], floor: 0 },
  follow: { label: 'follow', looks: ['lake-aurora', 'crossing-waves', 'sawtooth-run', 'rolling-sea', 'pond-interference'], floor: 0.1 },
};

/** The family a music part plays: the song, bass, a melody, kicks / snares, hats, or a loudness. */
export function stemFamily(source) {
  if (!source) return 'follow';
  if (source.id === 'mix') return 'song';
  if (source.stem === 'bass') return 'bass';
  const fam = partFamily(source);
  return fam === 'follow' ? 'follow' : fam;
}

/** Group name → part, for suggesting links ("Group 1 · Bass", "Vocals", "Song", "Drums"). */
export const NAME_PARTS = [
  [/bass/i, 'bass'], [/vocal|voice|sing/i, 'vocals:melody'], [/song|mix|music/i, 'mix'], [/drum|kick|beat|perc/i, 'drums:kicks'],
];

/**
 * Links from the groups' names: each water group named after a part follows it (one group per
 * part, the first by name). [] when no name fits.
 */
export function nameRows(sources, waterGroups) {
  const has = new Set(sources.map((s) => s.id));
  const rows = [];
  for (const [re, part] of NAME_PARTS) {
    const id = has.has(part) ? part : part === 'vocals:melody' && has.has('vocals') ? 'vocals' : null;
    const g = id && waterGroups.find((x) => re.test(x.name || '') && !rows.some((r) => r.groupId === x.id));
    if (g) rows.push({ sourceId: id, groupId: g.id, min: Math.round(100 * STEM_LOOK_FAMILIES[stemFamily(sourceById(id))].floor), max: 100, kind: 'water' });
  }
  return rows;
}

/** The renderer's area for a linked group: its nozzles, control, height cap in the basin and lead. */
function groupArea(group, waterIds, { design, scm, maxScale }) {
  const nozzles = waterIds.map((id) => design.nozzleById.get(id)).filter(Boolean);
  const count = (key) => {
    const n = {};
    for (const x of nozzles) n[x[key]] = (n[x[key]] || 0) + 1;
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const ids = nozzles.length ? nozzles.map((n) => n.id) : waterIds;
  const heightM = Math.max(0, ...nozzles.map((n) => n.heightM || 0));
  let heightScale = scm.heightScale ?? 1;
  if (scm.basin && heightScale > 0) {
    for (const n of nozzles) {
      const e = n.item.engineering || {};
      heightScale = Math.min(heightScale, windSafeScale({ x: Number(n.item.x) || 0, y: Number(n.item.y) || 0, heightM: n.heightM, sprayAngleDeg: e.sprayAngleDeg, nozzleDiaMm: e.nozzleDiaMm },
        scm.basin, { windMs: scm.windMs || 0, limit: scm.splashLimit ?? 0.05 }));
    }
  }
  const leads = (scm.outputs || []).filter((o) => ids.includes(o.id)).map((o) => o.latency?.leadS || 0);
  return { id: group.id, name: group.name, family: count('kind') || 'jet', control: count('control') || 'height', position: 'ring', layer: 'mid', size: ids.length, heightM,
    role: 'rhythm', hero: false, coupled: false, sources: [], lightIds: [], nozzleIds: ids, mirrorArea: null,
    heightScale: Math.round(heightScale * maxScale * 100) / 100, leadS: r3(leads.length ? Math.max(...leads) : visibleLead(heightM)) };
}

/** The looks of a family this area can perform; else any look for the part; else breathing. */
function familyLooks(family, part, area) {
  const own = family.looks.filter((id) => canPerform(lookById(id), area));
  if (own.length) return own;
  const fam = partFamily(sourceById(part));
  const any = LOOKS.filter((l) => !l.hero && l.parts.includes(fam) && canPerform(l, area)).map((l) => l.id);
  return any.length ? any.slice(0, 5) : ['breathing'];
}

/** A part's 0..1 envelope sampled from t0 for `dur` seconds at `rate`. */
function envelope(stem, source, t0, dur, { rate = STEM_ENVELOPE_RATE, beatSec }) {
  const times = Array.from({ length: Math.ceil(dur * rate) + 1 }, (_, k) => t0 + k / rate);
  if (!stem) return times.map(() => 1);
  const v = sourceValues(stem, source, times).map((x) => (x < 0 ? 0 : x));
  // Hits: one valve cannot follow every kick (1 s on / 1 s off), so the group follows the hit
  // strength held over one beat — a readable pulse on every strong beat, silence in breaks.
  if (source.behaviour === 'hits') {
    const hold = Math.max(1, Math.round(beatSec * rate));
    return v.map((_, k) => { let m = 0; for (let j = Math.max(0, k - hold); j <= k; j++) m = Math.max(m, v[j]); return Math.min(1, m * 1.2); });
  }
  // Loudness parts use their own range: normalised to the part's 95th percentile (the song is already 0..1).
  if (source.behaviour === 'follow' && source.id !== 'mix' && stem.p95) return v.map((x) => Math.min(1, x / stem.p95));
  return v;
}

/** 95th percentile of a stem's level over the song (normalises bass and loudness parts). */
function p95(level = []) {
  if (!level.length) return 1;
  const sorted = [...level].sort((a, b) => a - b);
  return sorted[Math.floor(0.95 * (sorted.length - 1))] || 1;
}

/**
 * @param {object} studio
 * @param {object} p { analysis, stems, links: [{ sourceId, groupId, kind, min, max }], items, groups, design?, basin?, seed?, meter?, site? }
 * @returns {{ studio, recipes, plan, fillId, counts, muted, skipped, summary }}
 */
export function stemShow(studio, { analysis, stems = [], links = [], items, groups, design = readFountainDesign(items), basin = null, seed = studio.plan?.seed ?? 0,
  meter = studio.meter, site = studio.site }) {
  if (!analysis?.bpm) throw new Error('Find the beats first');
  const a = applyMeter(songAnalysis(analysis), meter);
  const beatSec = 60 / a.bpm;
  const scm = buildSiteModel(items, { design, overrides: { ...(site || {}), ...(basin ? { basin } : {}) } });
  const song = stems.some((s) => s.role === 'mix') ? null : songStem(a);
  const byRole = new Map([...stems, ...(song ? [song] : [])].map((s) => [s.role, s.analysis]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const membersOf = (g) => resolveMembers(g, items).map((id) => itemById.get(id)).filter(Boolean);
  const skipped = [];

  // Voices: one per linked water group (the first link of a group wins).
  const voices = [];
  for (const row of links.filter((r) => (r.kind || 'water') === 'water')) {
    const source = sourceById(row.sourceId), group = groups.find((g) => g.id === row.groupId);
    if (!source || !group) { skipped.push(row.sourceId); continue; }
    if (voices.some((v) => v.group.id === group.id)) { skipped.push(`${source.label} → ${group.name} (already follows a part)`); continue; }
    const stem = byRole.get(source.stem);
    if (!stem) { skipped.push(`${source.label} (no stem)`); continue; }
    const water = membersOf(group).filter(isWaterItem);
    if (!water.length) { skipped.push(`${source.label} → ${group.name} (no water)`); continue; }
    const family = STEM_LOOK_FAMILIES[stemFamily(source)];
    const lo = Number.isFinite(Number(row.min)) ? clamp01(Number(row.min) / 100) : family.floor;
    const hi = Number.isFinite(Number(row.max)) ? clamp01(Number(row.max) / 100) : 1;
    const area = groupArea(group, water.map((m) => m.id), { design, scm, maxScale: Math.max(0.05, hi) });
    const looks = familyLooks(family, source.id, area);
    const finale = family.finale && canPerform(lookById(family.finale), area) ? family.finale : null;
    voices.push({ source, group, area, family, looks, finale, floor: Math.min(lo, 0.9), stem: { ...stem, p95: source.behaviour === 'follow' ? p95(stem.level) : 1 } });
  }
  if (!voices.length) throw new Error('Link at least one part of the music to a water group');

  // Plan: the song's arc, then each group's look per phrase from its own family.
  const plan = planShow({ analysis: a, stems, scm, seed });
  const looksUsed = {};
  plan.sections.forEach((s, si) => {
    const phrases = sectionPhrases(s, plan.analysis.barSec);
    const echo = s.repeatOf ? plan.sections.findIndex((x) => x.id === s.repeatOf) : si;
    s.phrases = phrases.map((p, pi) => ({ ...p, voices: voices.map((v, gi) => {
      const turn = echo + pi + gi;
      const look = s.role === 'climax' && pi === phrases.length - 1 && v.finale ? v.finale : v.looks[turn % v.looks.length];
      looksUsed[look] = (looksUsed[look] || 0) + 1;
      return { areaId: v.group.id, part: v.source.id, look, locked: false };
    }) }));
  });
  const rendered = renderPlan(studio, plan, { analysis: a, items, groups, design, scm: { ...scm, areas: voices.map((v) => v.area) } });
  let next = rendered.studio;

  // Each wave follows its own part: the envelope from the moment its water is seen (start + lead).
  const byGroup = new Map(voices.map((v) => [v.group.id, v]));
  const shaped = new Map();
  const shape = (r) => {
    const v = r.pattern?.music === rendered.fillId && byGroup.get(r.pattern?.group);
    if (!v || r.effect !== 'field' || r.pattern?.role === 'lights') return r;
    const t0 = r.start + (Number(r.pattern?.leadS) || 0);
    shaped.set(v.group.id, (shaped.get(v.group.id) || 0) + 1);
    const values = envelope(v.stem, v.source, t0, r.duration, { beatSec }).map(r3);
    return { ...r, field: { ...r.field, music: { source: v.source.id, rate: STEM_ENVELOPE_RATE, floor: v.floor, values } } };
  };
  next = { ...next, recipes: next.recipes.map(shape) };
  const made = new Set(rendered.recipes.map((r) => r.id));
  const recipes = next.recipes.filter((r) => made.has(r.id));

  // Lights: the linked light group (else the largest one) changes colour every phrase — every
  // 4 bars in builds, highs and the climax — and its brightness follows its part (else the song).
  const lightRow = links.find((r) => r.kind === 'lights' && groups.some((g) => g.id === r.groupId) && sourceById(r.sourceId));
  const lightsOf = (g) => membersOf(g).filter(isLightItem);
  const onlyLights = groups.filter((g) => { const m = membersOf(g); return m.length && m.every(isLightItem); });
  const chosen = lightRow ? groups.find((g) => g.id === lightRow.groupId)
    : onlyLights.reduce((best, g) => (!best || lightsOf(g).length > lightsOf(best).length ? g : best), null);
  // Only the lights of a mixed group change colour (its pumps and valves stay with the water).
  const lamps = chosen ? lightsOf(chosen) : [];
  const lightGroup = !lamps.length ? null : lamps.length === membersOf(chosen).length ? chosen
    : { id: `${chosen.id}:lamps`, name: `${chosen.name} · lights`, memberFixtureIds: lamps.map((m) => m.id), orderMode: 'clockwise', color: chosen.color, quick: true };
  const lightRecipes = [];
  if (lightGroup) {
    const src = lightRow ? sourceById(lightRow.sourceId) : sourceById('mix');
    const stem = byRole.get(src.stem);
    const lo = lightRow ? clamp01((Number(lightRow.min) || 0) / 100) : 0.12;
    const hi = lightRow ? Math.max(lo, clamp01((Number(lightRow.max) || 100) / 100)) : 1;
    const ensured = ensureGroup(next, lightGroup);
    next = ensured.studio;
    const barSec = plan.analysis.barSec;
    const chunks = plan.sections.flatMap((s) => s.phrases.flatMap((p) => {
      const step = ['build', 'high', 'climax'].includes(s.role) ? 4 * barSec : p.end - p.start;
      const list = [];
      for (let t = p.start; t < p.end - 0.5; t += step) list.push({ s, start: t, end: Math.min(p.end, t + step) });
      if (list.length > 1 && list.at(-1).end - list.at(-1).start < 2) { list.at(-2).end = list.at(-1).end; list.pop(); }
      return list;
    }));
    const cycle = [plan.palette.base, plan.palette.second, plan.palette.accent];
    const level = stem ? { ...stem, p95: src.behaviour === 'follow' ? p95(stem.level) : 1 } : null;
    chunks.forEach(({ s, start, end }, ci) => {
      const color = s.role === 'climax' ? (ci % 2 ? '#ffffff' : plan.palette.accent) : ['build', 'high'].includes(s.role) ? cycle[ci % 3] : s.light?.hue || plan.palette.base;
      const n = Math.max(8, Math.round((end - start) * 4));
      const env = envelope(level, src, start, end - start, { rate: n / (end - start), beatSec });
      const points = Array.from({ length: n + 1 }, (_, k) => ({ time: r3(k / n), value: r3(lo + (hi - lo) * (env[k] ?? 0)) }));
      lightRecipes.push({ ...newRecipe(ensured.groupId, r3(start)), name: `Lights · ${s.role}`, effect: 'curve', duration: r3(end - start), cycles: 1, spread: 0,
        intensity: Math.round(100 * Math.min(1, s.light?.intensity ?? 0.8)), color, order: 'clockwise', envelope: points, sampleRate: 10,
        pattern: { music: rendered.fillId, plan: plan.id, section: s.role, part: src.id, role: 'lights', look: 'song-light', group: lightGroup.id } });
    });
    next = { ...next, recipes: [...next.recipes, ...lightRecipes] };
  }

  const stored = { ...plan, provenance: { planner: 'stems', plannerVersion: '1.0.0' } };
  next = { ...next, plan: stored };
  const follows = voices.map((v) => ({ group: v.group.name, groupId: v.group.id, part: v.source.label, source: v.source.id, waves: shaped.get(v.group.id) || 0 }));
  const summary = { follows, waves: follows.reduce((n, f) => n + f.waves, 0), lights: lightRecipes.length, lightGroup: lightGroup?.name || null, looks: looksUsed,
    text: `Water follows its stem · ${follows.map((f) => `${f.waves} wave${f.waves === 1 ? '' : 's'} follow ${f.part} (${f.group})`).join(' · ')}`
      + (lightRecipes.length ? ` · ${lightRecipes.length} light phrases` : '') };
  return { studio: next, recipes: [...recipes, ...lightRecipes], plan: stored, fillId: rendered.fillId, counts: rendered.counts, muted: rendered.muted, skipped, summary, scm };
}
