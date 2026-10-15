// Pattern builder presets — pure functions that turn a preset + a few designer-facing
// options into ordinary Show Studio recipes (and, for Mirror, two half-groups).
// Nothing here touches fixture data; the output is committed through the normal
// studio change → compile → 3D preview path, so it is editable and undoable like any
// hand-made pattern.
import { getFixtureInfo } from '../../../utils/fixtureTypeResolver';
import { autoGroups, newRecipe, orderMembers, primaryTrack, resolveMembers, uid } from './showModel';

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const r3 = value => Math.round(value * 1000) / 1000;

export const MAX_CYCLES = 32;
export const MIN_VISIBLE_HEIGHT_M = 0.6;
export const MIN_VISIBLE_MOTION_M = 0.3;
export const HEAD_LOSSES_M = 0.5;
/** Valve policy for generated patterns: no sub-second flicker (minimum on / off time). */
export const MIN_ON_S = 1;
export const MIN_OFF_S = 1;

export const PATTERN_PRESETS = [
  { id: 'wave', label: 'Smooth wave', hint: 'A soft crest travels along the group',
    defaults: { lapSeconds: 10, minLevel: 35, maxLevel: 100, order: 'clockwise', crests: 1, smoothness: 'smooth' } },
  { id: 'chase', label: 'Chase', hint: 'One jet at a time runs along the group',
    defaults: { lapSeconds: 6, minLevel: 15, maxLevel: 100, order: 'clockwise', crests: 1, smoothness: 'sharp' } },
  { id: 'ripple', label: 'Ripple', hint: 'Rings spread out from the centre',
    defaults: { lapSeconds: 6, minLevel: 30, maxLevel: 100, order: 'center-out', crests: 1, smoothness: 'smooth' } },
  { id: 'breathing', label: 'Breathing', hint: 'All jets rise and fall together',
    defaults: { lapSeconds: 8, minLevel: 30, maxLevel: 100, order: 'engineering', crests: 1, smoothness: 'smooth' } },
  { id: 'mirror', label: 'Mirror', hint: 'Two halves meet in the middle',
    defaults: { lapSeconds: 8, minLevel: 35, maxLevel: 100, order: 'inward', crests: 1, smoothness: 'smooth', axis: 'sides' } },
  { id: 'sparkle', label: 'Sparkle', hint: 'Random jets flicker up',
    defaults: { lapSeconds: 2, minLevel: 0, maxLevel: 100, order: 'engineering', crests: 1, smoothness: 'sharp' } },
  { id: 'pulse', label: 'Pulse', hint: 'All jets hit together',
    defaults: { lapSeconds: 2, minLevel: 20, maxLevel: 100, order: 'engineering', crests: 1, smoothness: 'sharp' } },
];
export const presetById = id => PATTERN_PRESETS.find(p => p.id === id) || PATTERN_PRESETS[0];

/** Which options each preset uses — the UI hides the rest. */
export const PRESET_CONTROLS = {
  wave: { direction: true, crests: true, smoothness: true, minLevel: true },
  chase: { direction: true, crests: true, smoothness: false, minLevel: true },
  ripple: { direction: false, crests: true, smoothness: true, minLevel: true },
  breathing: { direction: false, crests: false, smoothness: true, minLevel: true },
  mirror: { direction: true, crests: true, smoothness: true, minLevel: true },
  sparkle: { direction: false, crests: false, smoothness: false, minLevel: false },
  pulse: { direction: false, crests: false, smoothness: false, minLevel: true },
};
/** Presets whose hits land on beats when synced to music. */
export const HIT_PRESETS = new Set(['chase', 'sparkle', 'pulse']);

export const DIRECTIONS = [
  ['clockwise', 'Clockwise'], ['counter-clockwise', 'Counter-clockwise'], ['left-to-right', 'Left → right'],
  ['right-to-left', 'Right → left'], ['front-to-back', 'Front → back'], ['center-out', 'Centre → out'], ['engineering', 'Engineering order'],
];
export const MIRROR_DIRECTIONS = [['inward', 'Meet in the middle'], ['outward', 'Split from the middle']];
export const SMOOTHNESS = [['smooth', 'Smooth'], ['medium', 'Medium'], ['sharp', 'Sharp']];
const SHARPNESS = { smooth: 1, medium: 2.5, sharp: 6 };

export function defaultOptions(presetId, { start = 0, duration = 30, color = '#65d9d0' } = {}) {
  const s = clamp(num(start), 0, 599);
  return { start: s, duration: r3(clamp(num(duration, 30), 1, 600 - s)), color, axis: 'sides', seed: 1, ...presetById(presetId).defaults };
}

/**
 * Turn "seconds per lap" into a whole number of laps over the clip, so the pattern
 * ends exactly where it started (seamless loop). Returns the snapped lap time.
 */
export function snapCycles(duration, lapSeconds) {
  const d = Math.max(.1, num(duration, 30)), wanted = Math.max(.1, num(lapSeconds, 10));
  const cycles = clamp(Math.round(d / wanted), 1, MAX_CYCLES);
  const actual = r3(d / cycles);
  return { cycles, lapSeconds: actual, requested: wanted, snapped: Math.abs(actual - wanted) > .05 };
}

/**
 * Dense raised-cosine envelope (0..1 time → 0..1 level) with `crests` humps.
 * floor = lowest level as a fraction of the top; smoothness sharpens the peak;
 * width (0..1 of one hump) narrows it further for chases. ≥33 points per hump.
 */
export function patternEnvelope({ crests = 1, floor = 0, smoothness = 'smooth', width = null, peakAtStart = false } = {}) {
  const n = clamp(Math.round(num(crests, 1)), 1, 8);
  const f = clamp(num(floor), 0, 1);
  let power = SHARPNESS[smoothness] || 1;
  if (width) { // half-maximum width as a fraction of one hump → cosine power
    const w = clamp(width, .02, .5);
    power = Math.max(power, Math.log(.5) / (2 * Math.log(Math.cos(Math.PI * w / 2))));
  }
  const perHump = width ? clamp(Math.ceil(10 / clamp(width, .02, .5)), 32, 256) : power > 2 ? 48 : 32;
  const count = Math.min(1024, perHump * n) + 1;
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    // peakAtStart: crest on the first instant of each hump (lands hits on the beat).
    const shape = Math.pow(Math.sin(Math.PI * t * n + (peakAtStart ? Math.PI / 2 : 0)) ** 2, power);
    return { time: r3(t), value: r3(clamp(f + (1 - f) * shape, 0, 1)) };
  }).filter((p, i, list) => i === 0 || p.time > list[i - 1].time);
}

/**
 * One-cycle envelope with `laps` breaths that fades in or out (used for intros/outros:
 * a fade cannot repeat per cycle, so the laps are drawn into a single long cycle).
 */
export function fadeEnvelope({ laps = 1, floor = 0, smoothness = 'smooth', fade = 'out' } = {}) {
  const n = clamp(Math.round(num(laps, 1)), 1, MAX_CYCLES);
  const f = clamp(num(floor), 0, 1), power = SHARPNESS[smoothness] || 1;
  const count = Math.min(1024, 32 * n) + 1;
  const gain = t => fade === 'in' ? Math.min(1, t / .6) : fade === 'out' ? (t < .4 ? 1 : Math.max(0, 1 - (t - .4) / .6)) : 1;
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const shape = Math.pow(Math.sin(Math.PI * t * n) ** 2, power);
    return { time: r3(t), value: r3(clamp((f + (1 - f) * shape) * gain(t), 0, 1)) };
  }).filter((p, i, list) => i === 0 || p.time > list[i - 1].time);
}

/** Deterministic shuffle (sparkle order). */
export function seededShuffle(list, seed = 1) {
  const out = [...list];
  let s = (Math.round(num(seed, 1)) * 2654435761) >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Lowest and highest output level (0–100) a recipe can reach. */
export function recipeLevelRange(recipe) {
  const top = clamp(num(recipe?.intensity, 0), 0, 100);
  if (recipe?.effect === 'curve' && Array.isArray(recipe.envelope) && recipe.envelope.length) {
    const values = recipe.envelope.map(p => num(p.value));
    return { min: top * Math.min(...values), max: top * Math.max(...values) };
  }
  if (['static', 'color', 'staircase'].includes(recipe?.effect)) return { min: top, max: top };
  if (recipe?.effect === 'field') {
    const f = recipe.field || {};
    const lows = [num(f.low, 20), num(f.lowFar, num(f.low, 20))], highs = [num(f.high, 80), num(f.highFar, num(f.high, 80))];
    return { min: Math.min(...lows), max: Math.max(...highs) };
  }
  return { min: 0, max: top };
}

// ── Fixture classification & quick groups ──────────────────────────────────────
const WATER_TRACKS = /^(pump_speed|solenoid_open|device_intensity)$/;
export function isLightItem(item) {
  const info = getFixtureInfo(item?.type);
  return info?.category === 'lighting' || (item?.tracks || []).some(t => t.type === 'lighting_master');
}
export function isWaterItem(item) {
  if (!item || item.category === 'scenery' || isLightItem(item)) return false;
  const info = getFixtureInfo(item.type);
  if (['pump', 'solenoid'].includes(info?.category)) return true;
  if (/^nozzle_|jet|pump|geyser|valve/i.test(String(item.type || ''))) return true;
  const track = primaryTrack(item, 'level');
  return !!track && WATER_TRACKS.test(track.type) && !['fire', 'fog', 'laser'].includes(info?.category);
}
const programmable = item => (item.tracks || []).length > 0;

export const QUICK_WATER = 'quick:water', QUICK_LIGHTS = 'quick:lights';
export function quickGroups(items) {
  const water = items.filter(i => isWaterItem(i) && programmable(i));
  const lights = items.filter(i => isLightItem(i) && programmable(i));
  return [
    { id: QUICK_WATER, name: 'All water jets', quick: true, memberFixtureIds: orderMembers(water.map(i => i.id), items, 'clockwise').map(i => i.id), orderMode: 'clockwise', color: '#65d9d0' },
    { id: QUICK_LIGHTS, name: 'All lights', quick: true, memberFixtureIds: orderMembers(lights.map(i => i.id), items, 'clockwise').map(i => i.id), orderMode: 'clockwise', color: '#f5c86b' },
  ];
}

/** Groups offered by the builder: show groups, Engineering groups, then the quick groups. */
export function builderGroups(studio, items) {
  const own = studio.groups.map(g => ({ ...g, source: 'Show groups' }));
  const known = new Set(own.map(g => g.id));
  const engineering = autoGroups(items.filter(i => i.category !== 'scenery')).filter(g => !known.has(g.id)).map(g => ({ ...g, source: 'Engineering groups' }));
  const quick = quickGroups(items).filter(g => g.memberFixtureIds.length).map(g => ({ ...g, source: 'Quick groups' }));
  return [...own, ...engineering, ...quick];
}

const sameMembers = (a = [], b = []) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Make sure `group` exists in the studio. Quick/engineering groups are copied in
 * (quick groups become a fixed member list); an identical existing group is reused.
 * Returns { studio, groupId }.
 */
export function ensureGroup(studio, group) {
  if (studio.groups.some(g => g.id === group.id)) return { studio, groupId: group.id };
  if (group.quick || !group.linkedQuery) {
    const match = studio.groups.find(g => g.name === group.name && !g.linkedQuery && sameMembers(g.memberFixtureIds, group.memberFixtureIds));
    if (match) return { studio, groupId: match.id };
    const created = { id: uid('group'), name: group.name, memberFixtureIds: [...(group.memberFixtureIds || [])], orderMode: group.orderMode || 'engineering', color: group.color || '#65d9d0', createdBy: 'pattern-builder' };
    return { studio: { ...studio, groups: [...studio.groups, created] }, groupId: created.id };
  }
  const { source, quick, ...plain } = group;
  return { studio: { ...studio, groups: [...studio.groups, plain] }, groupId: group.id };
}

/** Split members into two halves, each sorted outside → middle (inward) or middle → outside. */
export function mirrorHalves(memberIds, items, { axis = 'sides', direction = 'inward' } = {}) {
  const members = orderMembers(memberIds, items, 'engineering');
  const key = axis === 'front-back' ? 'y' : 'x';
  const centre = members.reduce((s, m) => s + num(m[key]), 0) / (members.length || 1);
  const sorted = [...members].sort((a, b) => num(a[key]) - num(b[key]) || String(a.id).localeCompare(String(b.id)));
  const half = Math.ceil(sorted.length / 2);
  const first = sorted.slice(0, half), second = sorted.slice(half);
  const byDistance = list => [...list].sort((a, b) => {
    const d = Math.abs(num(b[key]) - centre) - Math.abs(num(a[key]) - centre);
    return (direction === 'outward' ? -d : d) || String(a.id).localeCompare(String(b.id));
  }).map(m => m.id);
  const names = axis === 'front-back' ? ['front', 'back'] : ['left', 'right'];
  return [{ side: names[0], ids: byDistance(first) }, { side: names[1], ids: byDistance(second) }].filter(h => h.ids.length);
}

/**
 * Build recipes for one preset on one group.
 * @returns {{ studio, recipes, groupIds, timing }} — `studio` already contains any new groups
 *          and the recipes; `recipes`/`groupIds` list what was added.
 */
export function applyPattern(studio, { preset, options, group, items, name, attribute = 'level' }) {
  const p = presetById(preset);
  const o = { ...defaultOptions(p.id), ...options };
  const start = r3(clamp(num(o.start), 0, 599.9));
  const duration = r3(clamp(num(o.duration, 30), .1, 600 - start));
  const timing = snapCycles(duration, o.lapSeconds);
  const top = clamp(Math.round(num(o.maxLevel, 100)), 0, 100);
  const bottom = clamp(num(o.minLevel, 0), 0, top);
  const floor = top > 0 ? r3(bottom / top) : 0;
  const crests = PRESET_CONTROLS[p.id].crests ? clamp(Math.round(num(o.crests, 1)), 1, 8) : 1;
  let next = studio;
  const recipes = [], groupIds = [];
  const label = name || p.label;
  const base = (groupId, order, extra = {}) => ({
    ...newRecipe(groupId, start), name: label, effect: 'curve', duration, cycles: timing.cycles, spread: 1,
    intensity: top, color: o.color || '#65d9d0', attribute, order, seed: num(o.seed, 1),
    pattern: { preset: p.id, options: { ...o, start, duration } }, ...extra,
  });
  const sync = o.sync && Number(o.sync.bpm) > 0 ? o.sync : null;
  const smooth = patternEnvelope({ crests, floor, smoothness: o.smoothness });
  const ensured = () => { const r = ensureGroup(next, group); next = r.studio; groupIds.push(r.groupId); return r.groupId; };
  const hitCrests = clamp(Math.round(num(o.crests, 1)), 1, 8);
  // Half-maximum width of one hit (fraction of a hump), never shorter than MIN_ON_S.
  const hitWidth = (humpSeconds, wanted) => clamp(Math.max(wanted, MIN_ON_S / Math.max(.1, humpSeconds)), .04, .5);

  if (p.id === 'mirror') {
    const memberIds = resolveMembers(group, items);
    for (const half of mirrorHalves(memberIds, items, { axis: o.axis, direction: o.order === 'outward' ? 'outward' : 'inward' })) {
      const r = ensureGroup(next, { name: `${group.name} · ${half.side} half`, memberFixtureIds: half.ids, orderMode: 'engineering', color: group.color, quick: true });
      next = r.studio; groupIds.push(r.groupId);
      recipes.push(base(r.groupId, 'engineering', { name: `${label} · ${half.side}`, envelope: smooth }));
    }
  } else if (p.id === 'sparkle' && sync) {
    // Synced sparkle: jets in a fixed random order, `crests` of them hitting on each step.
    const ids = seededShuffle(resolveMembers(group, items), o.seed);
    const count = Math.max(1, ids.length);
    const width = hitWidth(timing.lapSeconds / hitCrests, 1.2 / (count / hitCrests));
    recipes.push(base(ensured(), 'engineering', { frozenIds: ids, envelope: patternEnvelope({ crests: hitCrests, floor, width, peakAtStart: true }) }));
  } else if (p.id === 'sparkle') {
    recipes.push(base(ensured(), 'engineering', { effect: 'sparkle', envelope: undefined, seed: Math.max(1, Math.round(num(o.seed, 1))) }));
  } else if (p.id === 'pulse') {
    const hump = timing.lapSeconds / hitCrests;
    recipes.push(base(ensured(), 'engineering', { spread: 0,
      envelope: patternEnvelope({ crests: hitCrests, floor, width: hitWidth(hump, .3), peakAtStart: !!sync }) }));
  } else if (p.id === 'breathing' && ['in', 'out'].includes(o.fade)) {
    recipes.push(base(ensured(), 'engineering', { spread: 0, cycles: 1,
      envelope: fadeEnvelope({ laps: timing.cycles, floor, smoothness: o.smoothness, fade: o.fade }) }));
  } else if (p.id === 'breathing') {
    recipes.push(base(ensured(), 'engineering', { spread: 0, envelope: smooth }));
  } else if (p.id === 'ripple') {
    recipes.push(base(ensured(), 'center-out', { envelope: smooth }));
  } else if (p.id === 'chase') {
    const count = Math.max(1, resolveMembers(group, items).length);
    const width = sync ? hitWidth(timing.lapSeconds / crests, clamp(1.4 / (count / crests), .04, .35)) : clamp(1.4 / (count / crests), .04, .35);
    recipes.push(base(ensured(), o.order || 'clockwise', { envelope: patternEnvelope({ crests, floor, width, peakAtStart: !!sync }) }));
  } else {
    recipes.push(base(ensured(), o.order || 'clockwise', { envelope: smooth }));
  }
  recipes.forEach(r => { if (r.envelope === undefined) delete r.envelope; });
  next = { ...next, recipes: [...next.recipes, ...recipes] };
  return { studio: next, recipes, groupIds: [...new Set(groupIds)], timing };
}

/**
 * "Lights match the water": the same preset, order, laps and spread on a light group,
 * at a softer level and its own colour.
 */
export function applyMatchingLights(studio, waterRecipes, { group, items, color = '#4f8cff', level = 30, floor = .2 }) {
  if (!waterRecipes?.length || !group) return { studio, recipes: [], groupIds: [] };
  const source = waterRecipes[0];
  const { preset, options } = source.pattern || { preset: 'wave', options: {} };
  const top = clamp(Math.round(num(level, 30)), 0, 100);
  const result = applyPattern(studio, {
    preset, group, items, name: `${presetById(preset).label} · lights`,
    options: { ...options, maxLevel: top, minLevel: top * clamp(num(floor, .2), 0, 1), color },
  });
  return result;
}

// ── Visibility ─────────────────────────────────────────────────────────────────
const designHead = params => {
  const v = num(params?.design_head_m ?? params?.designHeadM, NaN);
  return Number.isFinite(v) && v > 0 ? v : null;
};
const jetHeight = item => {
  const v = num(item?.engineering?.jetHeightM ?? item?.spec?.jet_height_m, NaN);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/**
 * Expected water height for the chosen jets:
 *   max height ≈ min(jet design height, pump head − losses) × top level
 * Warns when the tallest jet stays under ~0.6 m, or the rise between the low and
 * high level is under ~0.3 m. Returns null when no jet heights are known.
 */
export function visibilityCheck({ members = [], params = {}, minLevel = 0, maxLevel = 100 }) {
  const jets = members.filter(isWaterItem).map(m => ({ id: m.id, height: jetHeight(m) })).filter(j => j.height);
  if (!jets.length) return null;
  const head = designHead(params);
  const headCap = head == null ? Infinity : Math.max(0, head - HEAD_LOSSES_M);
  const reach = Math.max(...jets.map(j => Math.min(j.height, headCap)));
  const top = clamp(num(maxLevel), 0, 100) / 100, low = clamp(num(minLevel), 0, 100) / 100;
  const maxHeightM = r3(reach * top), motionM = r3(reach * Math.max(0, top - low));
  const limitedBy = head != null && headCap < Math.max(...jets.map(j => j.height)) ? 'pump head' : 'jet design height';
  const warnings = [];
  if (maxHeightM < MIN_VISIBLE_HEIGHT_M) warnings.push({ code: 'low', text: `Jets will be about ${maxHeightM.toFixed(1)} m tall — hard to see`,
    detail: `Limited by ${limitedBy}: ${reach.toFixed(2)} m at 100 % level${head != null ? ` (pump head ${head} m, ~${HEAD_LOSSES_M} m losses)` : ''}.` });
  if (motionM < MIN_VISIBLE_MOTION_M && maxHeightM > 0) warnings.push({ code: 'subtle', text: 'Movement will be subtle',
    detail: `Water rises and falls by only about ${motionM.toFixed(2)} m. Widen the height range.` });
  return { maxHeightM, motionM, reachM: r3(reach), head, limitedBy, jetIds: jets.map(j => j.id), warnings };
}

/** Visibility warnings for every level recipe in the show (used for the timeline badge). */
export function showVisibility(studio, items, params) {
  const groups = new Map(studio.groups.map(g => [g.id, g]));
  const byId = new Map(items.map(i => [i.id, i]));
  const out = [];
  for (const recipe of studio.recipes) {
    if (recipe.muted || (recipe.attribute && recipe.attribute !== 'level') || recipe.effect === 'color') continue;
    const group = groups.get(recipe.groupId);
    if (!group) continue;
    const members = resolveMembers(group, items).map(id => byId.get(id)).filter(Boolean);
    const range = recipeLevelRange(recipe);
    const check = visibilityCheck({ members, params, minLevel: range.min, maxLevel: range.max });
    if (check?.warnings.length) out.push({ recipeId: recipe.id, name: recipe.name, ...check });
  }
  return out;
}

/** Engineering values for the "Raise jet design height" fix (applied only after confirm). */
export function raiseJetsPatch(fixtures, jetIds, params, heightM = 2) {
  const ids = new Set(jetIds);
  const h = clamp(num(heightM, 2), .5, 30);
  const head = designHead(params);
  const neededHead = r3(h + HEAD_LOSSES_M + .5);
  return {
    fixtures: fixtures.map(f => ids.has(f.id) ? { ...f, engineering: { ...(f.engineering || {}), jetHeightM: h } } : f),
    params: head != null && head < neededHead ? { ...params, design_head_m: neededHead } : params,
    headChanged: head != null && head < neededHead, heightM: h, headM: head != null && head < neededHead ? neededHead : head,
  };
}

// ── Pattern units: everything one builder Apply made (reopen / update in place) ──
// Recipes made together share `pattern.id`: the water recipe(s) — two for Mirror —
// and the matching-lights recipe (`pattern.role: 'lights'`).

/** The unit a builder-made recipe belongs to, or null for hand-made recipes. */
export function patternUnit(studio, recipeId) {
  const recipe = studio.recipes.find(r => r.id === recipeId);
  if (!recipe?.pattern) return null;
  const id = recipe.pattern.id || null;
  let recipes;
  if (id) recipes = studio.recipes.filter(r => r.pattern?.id === id);
  else { // made before units existed: siblings with the identical pattern and timing
    const sig = JSON.stringify(recipe.pattern);
    recipes = studio.recipes.filter(r => r.pattern && !r.pattern.id && JSON.stringify(r.pattern) === sig && r.start === recipe.start && r.duration === recipe.duration);
  }
  return { id, recipes, recipeIds: recipes.map(r => r.id),
    water: recipes.filter(r => r.pattern.role !== 'lights'), lights: recipes.filter(r => r.pattern.role === 'lights') };
}

/** Builder form state that reproduces a unit (preset, options, group, lights, sync). */
export function builderStateFromUnit(unit, groups) {
  const source = unit.water[0] || unit.recipes[0];
  const { preset, options = {}, group } = source.pattern;
  const known = id => id && groups.some(g => g.id === id);
  const p = presetById(preset).id;
  const groupId = (p === 'mirror' ? [group, source.groupId] : [source.groupId, group]).find(known) || '';
  const lit = unit.lights[0];
  const saved = source.pattern.lights || null;
  return {
    preset: p, options: { ...defaultOptions(p), ...options }, groupId,
    lights: { enabled: !!lit, groupId: lit ? (p === 'mirror' ? [lit.pattern.group, lit.groupId] : [lit.groupId, lit.pattern.group]).find(known) || '' : '',
      color: lit?.color || saved?.color || '#4f8cff', level: lit ? lit.intensity : saved?.level ?? 30 },
    sync: !!options.sync,
  };
}

/**
 * Build (or rebuild) one unit. `replaceIds` are removed first and the new recipes take
 * their place and ids, so an Update is an in-place edit; builder-made groups left
 * unused are tidied away. Returns { studio, recipes, recipeIds, unitId, timing }.
 */
export function buildPatternUnit(studio, { preset, options, group, items, lights = null, unitId = null, replaceIds = [], tag = {} }) {
  const replace = new Set(replaceIds);
  const removed = studio.recipes.filter(r => replace.has(r.id));
  const firstIndex = studio.recipes.findIndex(r => replace.has(r.id));
  const kept = studio.recipes.filter(r => !replace.has(r.id));
  const index = firstIndex < 0 ? kept.length : studio.recipes.slice(0, firstIndex).filter(r => !replace.has(r.id)).length;
  const id = unitId || uid('pattern');
  const reuse = { water: removed.filter(r => r.pattern?.role !== 'lights').map(r => r.id), lights: removed.filter(r => r.pattern?.role === 'lights').map(r => r.id) };
  const water = applyPattern({ ...studio, recipes: kept }, { preset, options, group, items });
  let next = water.studio;
  const mark = (recipe, role, groupRef, k) => ({ ...recipe, id: reuse[role][k] || recipe.id,
    pattern: { ...recipe.pattern, id, role, group: groupRef,
      ...(role === 'water' && lights?.group ? { lights: { level: lights.level, color: lights.color } } : {}), ...tag } });
  const added = water.recipes.map((r, k) => mark(r, 'water', group.id, k));
  if (lights?.group) {
    const lit = applyMatchingLights(next, water.recipes, { group: lights.group, items, color: lights.color, level: lights.level, floor: .2 });
    next = lit.studio;
    added.push(...lit.recipes.map((r, k) => mark(r, 'lights', lights.group.id, k)));
  }
  const recipes = [...kept.slice(0, index), ...added, ...kept.slice(index)];
  next = pruneBuilderGroups({ ...next, recipes }, removed.map(r => r.groupId));
  return { studio: next, recipes: added, recipeIds: added.map(r => r.id), unitId: id, timing: water.timing };
}

/** Remove builder-made groups (from `candidates`) that no recipe uses any more. */
export function pruneBuilderGroups(studio, candidates = []) {
  const ids = new Set(candidates);
  const used = new Set(studio.recipes.map(r => r.groupId));
  const parents = new Set(studio.groups.map(g => g.parentId).filter(Boolean));
  const groups = studio.groups.filter(g => !(ids.has(g.id) && g.createdBy === 'pattern-builder' && !used.has(g.id) && !parents.has(g.id)));
  return groups.length === studio.groups.length ? studio : { ...studio, groups };
}
