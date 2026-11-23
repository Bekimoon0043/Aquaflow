// Show blocks: what the 3D preview timeline shows — one block per pattern as it plays.
//   field     a wave-field unit (water recipe + optional lights recipe), fully editable
//   builder   a Pattern builder unit (edit in the builder)
//   motion    coordinated water + 1D/2D/3D motion + optional lights
//   recipe    a hand-made Show Programming recipe
//   recorded  imported/recorded clips grouped by patternBlockId (move or delete only)
import { newRecipe, uid } from './showModel';
import { defaultField, fieldKind } from './wavePatterns';
import { builderGroups, isLightItem, isWaterItem } from './patternPresets';
import { motionAxesOf } from './motionPatterns';

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
    const water = recipes.find(r => !['lights', 'accent', 'motion'].includes(r.pattern?.role)) || recipes[0];
    const lights = recipes.find(r => r.pattern?.role === 'lights' && r !== water) || null;
    const motion = recipes.find(r => r.effect === 'motion') || null;
    const start = Math.min(...recipes.map(r => r.start)), end = Math.max(...recipes.map(r => r.start + r.duration));
    const type = motion ? 'motion' : water.effect === 'field' ? 'field' : water.pattern ? 'builder' : 'recipe';
    // A mirror unit is two half-recipes: show it as one pattern.
    const name = recipes.filter(r => !['lights', 'accent', 'motion'].includes(r.pattern?.role)).length > 1 ? water.name.replace(/ · (left|right|front|back)$/, '') : water.name;
    blocks.push({ id: key, type, name, start, duration: r3(end - start),
      color: (lights || water).color || '#65d9d0', muted: recipes.every(r => r.muted),
      kindLabel: type === 'motion' ? `${motion.motion?.axes || 1}D motion` : type === 'field' ? fieldKind(water.field?.kind).label : type === 'builder' ? 'Pattern builder' : water.effect,
      recipeIds: recipes.map(r => r.id), legacyIds: [], water, lights, motion, unitId: water.pattern?.id || null });
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
    .sort((a, b) => (a.g.quick ? 2 : a.g.linkedQuery ? 1 : 0) - (b.g.quick ? 2 : b.g.linkedQuery ? 1 : 0) || b.members.length - a.members.length)[0]?.g || null;
  const jet = i => isWaterItem(i) && (i.tracks || []).some(t => t.type === 'device_intensity');
  const moving = i => isWaterItem(i) && motionAxesOf(i) > 0;
  return { water: pick(jet) || pick(isWaterItem), lights: pick(isLightItem), motion: pick(moving),
    motionByAxes: { 1: pick(i => motionAxesOf(i) >= 1), 2: pick(i => motionAxesOf(i) >= 2), 3: pick(i => motionAxesOf(i) >= 3) } };
}

/** Recipes for a new wave-field pattern (water + matching lights). */
export function fieldUnitRecipes({ kind, start, duration, name, waterGroupId, lightGroupId, field = {}, light = {}, order = 'clockwise', unitId = null }) {
  const unit = unitId || uid('pattern');
  const f = defaultField(kind, field);
  const base = groupId => ({ ...newRecipe(groupId, r3(start)), effect: 'field', duration: r3(duration), cycles: 1, spread: 1, intensity: 100, order });
  const recipes = [];
  if (waterGroupId) recipes.push({ ...base(waterGroupId), name: name || fieldKind(kind).label, color: light.color || '#65d9d0',
    attribute: 'level', field: f, pattern: { id: unit, role: 'water', kind: f.kind } });
  if (lightGroupId) recipes.push({ ...base(lightGroupId), name: `${name || fieldKind(kind).label} · lights`, color: light.color || '#4f8cff',
    attribute: 'level', field: { ...f, low: light.low ?? 6, high: light.high ?? 20, lowFar: light.low ?? 6, highFar: light.high ?? 20, stairs: 0,
      colorMode: light.colorMode || 'solid', rainbowPeriod: light.rainbowPeriod ?? 10, ...(light.colors ? { colors: light.colors } : {}) },
    pattern: { id: unit, role: 'lights', kind: f.kind } });
  return { recipes, unitId: unit };
}

/**
 * Edit a wave-field unit. patch: { name, groupId, kind, field: {...}, light: { color, low, high, colorMode } }.
 * Changing the kind resets the kind-specific settings to that kind's defaults (heights kept).
 */
export function updateFieldUnit(studio, block, patch) {
  const r = ids(block.recipeIds);
  return { ...studio, recipes: studio.recipes.filter(x => !(r.has(x.id) && x.pattern?.role === 'lights' && patch.lightGroupId === null)).map(x => {
    if (!r.has(x.id)) return x;
    // Accent lights (a steady colour on another light group) follow the pattern's light colour.
    if (x.pattern?.role === 'accent') return patch.light?.color ? { ...x, color: patch.light.color } : x;
    const lights = x.pattern?.role === 'lights';
    if (lights && patch.lightGroupId) x = { ...x, groupId: patch.lightGroupId };
    if (patch.groupId && !lights) x = { ...x, groupId: patch.groupId };
    if (x.effect !== 'field') return x;
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
      if (L.colors) field = { ...field, colors: L.colors };
      if (L.color) color = L.color;
    }
    if (!lights && patch.light?.color) color = patch.light.color;
    const name = patch.name !== undefined ? (lights ? `${patch.name} · lights` : patch.name) : x.name;
    return { ...x, name, color, field, pattern: { ...x.pattern, kind: field.kind } };
  }) };
}

/** Edit a static or keyed-curve pattern, including its destination group and envelope. */
export function updateRecipeBlock(studio, block, patch) {
  const selected = ids(block.recipeIds);
  return { ...studio, recipes: studio.recipes.map(recipe => {
    if (!selected.has(recipe.id)) return recipe;
    const next = { ...recipe };
    for (const key of ['name', 'groupId', 'color', 'order']) if (patch[key] !== undefined) next[key] = patch[key];
    for (const key of ['intensity', 'cycles', 'spread']) if (Number.isFinite(patch[key])) next[key] = patch[key];
    if (Array.isArray(patch.envelope)) next.envelope = patch.envelope.map(p => ({ time: Number(p.time), value: Number(p.value) }));
    return next;
  }) };
}

/** Edit the coordinated water, motion and light layers of a moving-nozzle block. */
export function updateMotionUnit(studio, block, patch) {
  const selected = ids(block.recipeIds);
  return { ...studio, recipes: studio.recipes.filter(recipe => !(selected.has(recipe.id) && recipe.pattern?.role === 'lights' && patch.lightGroupId === null)).map(recipe => {
    if (!selected.has(recipe.id)) return recipe;
    const role = recipe.pattern?.role;
    if (role === 'lights') {
      let field = { ...recipe.field };
      let color = recipe.color;
      if (patch.field) field = { ...field, ...patch.field };
      if (patch.light) {
        const light = patch.light;
        if (light.low !== undefined) field = { ...field, low: light.low, lowFar: light.low };
        if (light.high !== undefined) field = { ...field, high: light.high, highFar: light.high };
        for (const key of ['colorMode', 'colors', 'rainbowPeriod']) if (light[key] !== undefined) field[key] = light[key];
        if (light.color) color = light.color;
      }
      return { ...recipe, name: patch.name !== undefined ? `${patch.name} · lights` : recipe.name,
        groupId: patch.lightGroupId || recipe.groupId, color, field };
    }
    const next = { ...recipe, name: patch.name ?? recipe.name, groupId: patch.groupId || recipe.groupId,
      color: patch.light?.color || recipe.color, order: patch.order || recipe.order };
    if (recipe.effect === 'motion' && patch.motion) next.motion = patch.motion;
    if (role === 'motion-water' && patch.field) next.field = patch.field;
    return next;
  }) };
}

// ── Pattern files: export blocks to JSON and import them into any show ──────────
export const PATTERN_FILE_FORMAT = 'aquaflow-show-patterns';

const strip = ({ id, studioRecipeId, ...rest }) => rest;

/** Portable file for the given blocks (times kept as in the show). */
export function exportPatterns(studio, blocks) {
  const groupsById = new Map(studio.groups.map(g => [g.id, g]));
  const role = r => r.pattern?.role || 'water';
  const patterns = blocks.filter(b => !b.background).map(b => {
    const recipes = studio.recipes.filter(r => b.recipeIds.includes(r.id)).map(r => ({
      ...strip(r), role: role(r), groupName: groupsById.get(r.groupId)?.name || r.groupId,
    }));
    const clips = studio.legacyClips.filter(c => b.legacyIds.includes(c.id)).map(c => ({ ...strip(c), startTime: c.startTime }));
    return { name: b.name, type: b.type, start: b.start, duration: b.duration, color: b.color, recipes, clips };
  });
  return { format: PATTERN_FILE_FORMAT, version: 1, exportedAt: new Date().toISOString(), patterns };
}

/**
 * Add patterns from a pattern file. Recipe groups are matched by id, then by name, then
 * to this show's compatible water / light / moving-nozzle group (unsupported roles are skipped).
 * Recorded cues are kept only for fixtures that exist here. `at` moves the earliest
 * pattern to that time (null = original times). Also returns the newly added recipe / clip ids.
 */
export function importPatterns(studio, file, items, { at = null } = {}) {
  const data = typeof file === 'string' ? JSON.parse(file) : file;
  if (data?.format !== PATTERN_FILE_FORMAT || !Array.isArray(data.patterns)) throw new Error('This is not an AquaFlow show-pattern file.');
  const known = new Set(items.map(i => i.id));
  const groups = defaultFieldGroups(studio, items);
  const newGroups = [];
  const groupFor = (r) => {
    if (studio.groups.some(g => g.id === r.groupId)) return r.groupId;
    const byName = studio.groups.find(g => g.name === r.groupName);
    if (byName) return byName.id;
    const role = ['motion', 'motion-water'].includes(r.role) || r.attribute === 'motion_angle' ? 'motion' : r.role;
    const axes = Math.max(1, Math.min(3, Number(r.motion?.axes || r.pattern?.axes) || 1));
    const fallback = role === 'lights' ? groups.lights : role === 'accent' ? null : role === 'motion' ? groups.motionByAxes[axes] : groups.water;
    if (!fallback) return null;
    if (!studio.groups.some(g => g.id === fallback.id) && !newGroups.some(g => g.id === fallback.id)) {
      const { source, quick, ...plain } = fallback; newGroups.push(plain);
    }
    return fallback.id;
  };
  const first = Math.min(...data.patterns.map(p => Number(p.start) || 0));
  const shift = at === null || !Number.isFinite(Number(at)) ? 0 : Number(at) - first;
  const recipes = [], clips = [], notes = [];
  let added = 0, skipped = 0;
  for (const p of data.patterns) {
    const unit = uid('pattern');
    let used = 0;
    for (const r of p.recipes || []) {
      const groupId = groupFor(r);
      if (!groupId) {
        const target = r.role === 'motion' || r.attribute === 'motion_angle' ? 'moving-nozzle' : r.role === 'accent' ? 'accent-light' : r.role || 'water';
        notes.push(`${r.name}: no matching ${target} group, left out.`); continue;
      }
      const { role, groupName, ...rest } = r;
      const start = r3(Math.max(0, Math.min(MAX_END - rest.duration, rest.start + shift)));
      recipes.push({ ...rest, id: uid('recipe'), groupId, start, locked: false,
        ...(rest.pattern ? { pattern: { ...rest.pattern, id: unit, ...(rest.pattern.options ? { options: { ...rest.pattern.options, start } } : {}) } } : {}) });
      used++;
    }
    const key = `import-${uid('rec')}`;
    for (const c of p.clips || []) {
      if (!known.has(c.fixtureId)) continue;
      clips.push({ ...c, id: uid('clip'), name: p.name, patternBlockId: key, startTime: r3(Math.max(0, c.startTime + shift)) });
      used++;
    }
    if (used) added++; else { skipped++; notes.push(`${p.name}: its fixtures are not in this design.`); }
  }
  const next = { ...studio, groups: [...studio.groups, ...newGroups], recipes: [...studio.recipes, ...recipes], legacyClips: [...studio.legacyClips, ...clips] };
  return { studio: next, added, skipped, notes, addedRecipeIds: recipes.map(r => r.id), addedLegacyIds: clips.map(c => c.id) };
}
