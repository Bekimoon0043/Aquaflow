// Show blocks: what the 3D preview timeline shows — one block per pattern as it plays.
//   field     a wave-field unit (water recipe + optional lights recipe), fully editable
//   builder   a Pattern builder unit (edit in the builder)
//   recipe    a hand-made Show Programming recipe
//   recorded  imported/recorded clips grouped by patternBlockId (move or delete only)
import { newRecipe, uid } from './showModel';
import { defaultField, fieldKind } from './wavePatterns';
import { builderGroups, isLightItem, isWaterItem } from './patternPresets';

const r3 = v => Math.round(v * 1000) / 1000;
const MAX_END = 600;

const recordedKey = clip => clip.patternBlockId || clip.pattern || null;

/** Every block in the show, sorted by start, with lanes so overlapping blocks stack. */
export function showBlocks(studio, definitions = []) {
  const names = new Map((definitions || []).map(d => [d.id, d.name]));
  const blocks = [];
  const units = new Map();
  for (const recipe of studio.recipes) {
    const unitId = recipe.pattern?.id || (recipe.effect === 'field' ? recipe.id : null);
    const key = unitId ? `unit:${unitId}` : `recipe:${recipe.id}`;
    if (!units.has(key)) units.set(key, { key, recipes: [] });
    units.get(key).recipes.push(recipe);
  }
  for (const { key, recipes } of units.values()) {
    const water = recipes.find(r => !['lights', 'accent'].includes(r.pattern?.role)) || recipes[0];
    const lights = recipes.find(r => r.pattern?.role === 'lights' && r !== water) || null;
    const start = Math.min(...recipes.map(r => r.start)), end = Math.max(...recipes.map(r => r.start + r.duration));
    const type = water.effect === 'field' ? 'field' : water.pattern ? 'builder' : 'recipe';
    // A mirror unit is two half-recipes: show it as one pattern.
    const name = recipes.filter(r => !['lights', 'accent'].includes(r.pattern?.role)).length > 1 ? water.name.replace(/ · (left|right|front|back)$/, '') : water.name;
    blocks.push({ id: key, type, name, start, duration: r3(end - start),
      color: (lights || water).color || '#65d9d0', muted: recipes.every(r => r.muted),
      kindLabel: type === 'field' ? fieldKind(water.field?.kind).label : type === 'builder' ? 'Pattern builder' : water.effect,
      recipeIds: recipes.map(r => r.id), legacyIds: [], water, lights, unitId: water.pattern?.id || null });
  }
  const recorded = new Map();
  for (const clip of studio.legacyClips) {
    const key = recordedKey(clip) || 'recorded:other';
    if (!recorded.has(key)) recorded.set(key, []);
    recorded.get(key).push(clip);
  }
  for (const [key, clips] of recorded) {
    const start = Math.min(...clips.map(c => c.startTime)), end = Math.max(...clips.map(c => c.startTime + c.duration));
    const coloured = clips.find(c => /^lighting_/.test(c.type) && c.color) || clips[0];
    blocks.push({ id: `recorded:${key}`, type: 'recorded', name: names.get(key) || clips[0].name || (key === 'recorded:other' ? 'Recorded cues' : key.replace(/[-_]+/g, ' ')),
      start, duration: r3(end - start), color: coloured?.color || '#8a94a6', kindLabel: `Recorded · ${clips.length} cues`,
      recipeIds: [], legacyIds: clips.map(c => c.id) });
  }
  blocks.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  // Recorded cues that run the whole show (pumps, ambient lights) are background, not patterns.
  const showEnd = Math.max(1, ...blocks.map(b => b.start + b.duration));
  for (const b of blocks) b.background = b.type === 'recorded' && b.start <= 0.01 && b.duration >= 0.9 * showEnd;
  // Lanes: greedy interval packing; whole-show background blocks go below the patterns.
  const laneEnds = [];
  for (const block of blocks.filter(b => !b.background)) {
    let lane = laneEnds.findIndex(end => end <= block.start + 1e-6);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = block.start + block.duration;
    block.lane = lane;
  }
  let lane = laneEnds.length;
  for (const block of blocks.filter(b => b.background)) block.lane = lane++;
  return blocks;
}

const ids = list => new Set(list);

/** Move a block so it starts at `start` (clamped to the show). */
export function moveBlock(studio, block, start) {
  const delta = r3(Math.max(0, Math.min(MAX_END - block.duration, start)) - block.start);
  if (!delta) return studio;
  const r = ids(block.recipeIds), l = ids(block.legacyIds);
  return { ...studio,
    recipes: studio.recipes.map(x => r.has(x.id) ? { ...x, start: r3(x.start + delta) } : x),
    legacyClips: studio.legacyClips.map(x => l.has(x.id) ? { ...x, startTime: r3(x.startTime + delta) } : x) };
}

/** Change a pattern's length (recipes only; recorded cues cannot be stretched). */
export function resizeBlock(studio, block, duration) {
  if (block.type === 'recorded') return studio;
  const d = r3(Math.max(1, Math.min(MAX_END - block.start, duration)));
  const r = ids(block.recipeIds);
  return { ...studio, recipes: studio.recipes.map(x => {
    if (!r.has(x.id)) return x;
    const next = { ...x, duration: d };
    if (x.pattern?.options) next.pattern = { ...x.pattern, options: { ...x.pattern.options, duration: d } };
    return next;
  }) };
}

export function deleteBlock(studio, block) {
  const r = ids(block.recipeIds), l = ids(block.legacyIds);
  return { ...studio, recipes: studio.recipes.filter(x => !r.has(x.id)), legacyClips: studio.legacyClips.filter(x => !l.has(x.id)) };
}

/** Copy a block to start right after itself (or at `start`). Returns { studio, blockId }. */
export function duplicateBlock(studio, block, start = block.start + block.duration) {
  const at = r3(Math.min(MAX_END - block.duration, start)), delta = at - block.start;
  const unit = uid('pattern');
  const recipes = studio.recipes.filter(x => block.recipeIds.includes(x.id)).map(x => ({ ...x, id: uid('recipe'), start: r3(x.start + delta), locked: false,
    ...(x.pattern ? { pattern: { ...x.pattern, id: unit, ...(x.pattern.options ? { options: { ...x.pattern.options, start: r3(x.start + delta) } } : {}) } } : {}) }));
  const key = `copy-${uid('rec')}`;
  const legacy = studio.legacyClips.filter(x => block.legacyIds.includes(x.id)).map(x => ({ ...x, id: uid('clip'), startTime: r3(x.startTime + delta), patternBlockId: key }));
  const blockId = recipes.length ? (recipes[0].pattern ? `unit:${unit}` : `recipe:${recipes[0].id}`) : `recorded:${key}`;
  return { studio: { ...studio, recipes: [...studio.recipes, ...recipes], legacyClips: [...studio.legacyClips, ...legacy] }, blockId };
}

/** Default show groups for new wave patterns: the largest all-jet and all-light groups. */
export function defaultFieldGroups(studio, items) {
  const byId = new Map(items.map(i => [i.id, i]));
  const groups = builderGroups(studio, items);
  const pick = test => groups
    .map(g => ({ g, members: (g.memberFixtureIds || []).map(id => byId.get(id)).filter(Boolean) }))
    .filter(({ members }) => members.length && members.every(test))
    .sort((a, b) => b.members.length - a.members.length || (a.g.quick ? 1 : 0) - (b.g.quick ? 1 : 0))[0]?.g || null;
  const jet = i => isWaterItem(i) && (i.tracks || []).some(t => t.type === 'device_intensity');
  return { water: pick(jet) || pick(isWaterItem), lights: pick(isLightItem) };
}

/** Recipes for a new wave-field pattern (water + matching lights). */
export function fieldUnitRecipes({ kind, start, duration, name, waterGroupId, lightGroupId, field = {}, light = {}, order = 'clockwise' }) {
  const unit = uid('pattern');
  const f = defaultField(kind, field);
  const base = groupId => ({ ...newRecipe(groupId, r3(start)), effect: 'field', duration: r3(duration), cycles: 1, spread: 1, intensity: 100, order });
  const recipes = [];
  if (waterGroupId) recipes.push({ ...base(waterGroupId), name: name || fieldKind(kind).label, color: light.color || '#65d9d0',
    attribute: 'level', field: f, pattern: { id: unit, role: 'water', kind: f.kind } });
  if (lightGroupId) recipes.push({ ...base(lightGroupId), name: `${name || fieldKind(kind).label} · lights`, color: light.color || '#4f8cff',
    attribute: 'level', field: { ...f, low: light.low ?? 6, high: light.high ?? 20, lowFar: light.low ?? 6, highFar: light.high ?? 20, stairs: 0,
      colorMode: light.colorMode || 'solid', rainbowPeriod: light.rainbowPeriod ?? 10 },
    pattern: { id: unit, role: 'lights', kind: f.kind } });
  return { recipes, unitId: unit };
}

/**
 * Edit a wave-field unit. patch: { name, kind, field: {...}, light: { color, low, high, colorMode } }.
 * Changing the kind resets the kind-specific settings to that kind's defaults (heights kept).
 */
export function updateFieldUnit(studio, block, patch) {
  const r = ids(block.recipeIds);
  return { ...studio, recipes: studio.recipes.map(x => {
    if (!r.has(x.id)) return x;
    // Accent lights (a steady colour on another light group) follow the pattern's light colour.
    if (x.pattern?.role === 'accent') return patch.light?.color ? { ...x, color: patch.light.color } : x;
    if (x.effect !== 'field') return x;
    const lights = x.pattern?.role === 'lights';
    let field = { ...x.field };
    if (patch.kind && patch.kind !== field.kind) {
      const keep = { low: field.low, high: field.high, lowFar: field.lowFar, highFar: field.highFar, stairs: field.stairs, ease: field.ease, colorMode: field.colorMode, rainbowPeriod: field.rainbowPeriod };
      field = { ...defaultField(patch.kind), ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined)) };
    }
    const shared = { ...(patch.field || {}) };
    if (lights) for (const k of ['low', 'high', 'lowFar', 'highFar', 'stairs']) delete shared[k];
    field = { ...field, ...shared };
    let color = x.color;
    if (lights && patch.light) {
      const L = patch.light;
      if (L.low !== undefined) field = { ...field, low: L.low, lowFar: L.low };
      if (L.high !== undefined) field = { ...field, high: L.high, highFar: L.high };
      if (L.colorMode) field = { ...field, colorMode: L.colorMode };
      if (L.color) color = L.color;
    }
    if (!lights && patch.light?.color) color = patch.light.color;
    const name = patch.name !== undefined ? (lights ? `${patch.name} · lights` : patch.name) : x.name;
    return { ...x, name, color, field, pattern: { ...x.pattern, kind: field.kind } };
  }) };
}
