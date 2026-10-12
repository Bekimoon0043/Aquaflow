import { generateAutoTracks } from '../../../runtime/autoTrackGenerator';
import { createSiteWaterTrack } from '../../../utils/siteShowCompiler';
import { getFixtureInfo } from '../../../utils/fixtureTypeResolver';

export const EFFECTS = ['wave', 'chase', 'ripple', 'pulse', 'static', 'staircase', 'sparkle', 'color', 'curve'];
export const ORDERS = ['engineering', 'left-to-right', 'right-to-left', 'front-to-back', 'clockwise', 'counter-clockwise', 'center-out'];
export const uid = (prefix = 'show') => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const num = (x, fallback = 0) => Number.isFinite(Number(x)) ? Number(x) : fallback;
const round = n => Math.round(n * 1000) / 1000;
const title = text => String(text || 'Ungrouped').replaceAll('_', ' ');

export function inventory(fixtures, models = [], center = { cx: 0, cy: 0 }) {
  const { tracks } = generateAutoTracks({ fixtures });
  const byFixture = new Map();
  for (const track of tracks) {
    if (!byFixture.has(track.fixtureId)) byFixture.set(track.fixtureId, []);
    byFixture.get(track.fixtureId).push(track);
  }
  return [...fixtures.map(f => {
    const info = getFixtureInfo(f.type);
    const water = createSiteWaterTrack(f);
    const available = water ? [water] : byFixture.get(f.id) || [];
    const unknown = !info || info.deviceType === 'unknown';
    const readOnly = unknown || info.category === 'sensor' || info.runtimeType === 'sensor';
    return { ...f, label: f.label || f.name || f.type, tracks: readOnly ? [] : available,
      status: unknown ? 'Needs mapping' : readOnly ? 'Read only' : available.length ? 'Programmable' : 'Read only',
      category: info?.category || 'unknown' };
  }), ...models.map(m => ({ ...m, id: `scenery:${m.id}`, label: m.name || m.label || 'Site model',
    x: (m.transform?.position?.x ?? m.position?.x ?? m.position?.[0] ?? m.x ?? 0) + center.cx,
    y: (m.transform?.position?.z ?? m.position?.z ?? m.position?.[2] ?? m.y ?? 0) + center.cy,
    type: 'scenery', category: 'scenery', status: 'Scenery', tracks: [] }))];
}

export function autoGroups(items, dimension = 'groupId') {
  const groups = new Map();
  for (const item of items) {
    const key = dimension === 'system' ? (item.supplyingPumpId || item.engineering?.manifoldId || item.siemensSiteId || 'Unassigned system')
      : item[dimension] || (dimension === 'groupId' ? 'Ungrouped' : 'Unassigned');
    const id = `auto:${dimension}:${key}`;
    if (!groups.has(id)) groups.set(id, { id, name: title(key), linkedQuery: { field: dimension, value: key }, memberFixtureIds: [], orderMode: 'engineering', color: '#65d9d0' });
    groups.get(id).memberFixtureIds.push(item.id);
  }
  return [...groups.values()];
}

export function resolveMembers(group, items) {
  if (!group) return [];
  if (group.linkedQuery) {
    const { field, value } = group.linkedQuery;
    if (field === 'all') return items.map(i => i.id);
    return autoGroups(items, field).find(g => g.linkedQuery.value === value)?.memberFixtureIds || [];
  }
  return group.memberFixtureIds || [];
}

export function orderMembers(ids, items, order = 'engineering') {
  const map = new Map(items.map(i => [i.id, i]));
  const members = [...new Set(ids)].map(id => map.get(id)).filter(Boolean);
  if (order === 'engineering') return members;
  const cx = members.reduce((s, f) => s + num(f.x), 0) / (members.length || 1);
  const cy = members.reduce((s, f) => s + num(f.y), 0) / (members.length || 1);
  const value = f => order === 'left-to-right' ? num(f.x) : order === 'right-to-left' ? -num(f.x)
    : order === 'front-to-back' ? num(f.y) : order === 'center-out' ? Math.hypot(num(f.x) - cx, num(f.y) - cy)
      : Math.atan2(num(f.y) - cy, num(f.x) - cx) * (order === 'counter-clockwise' ? -1 : 1);
  return members.sort((a, b) => value(a) - value(b) || String(a.id).localeCompare(String(b.id)));
}

export const newRecipe = (groupId, start = 0) => ({ id: uid('recipe'), version: 1, groupId,
  name: 'Traveling wave', effect: 'wave', start, duration: 8, cycles: 2, spread: 1, intensity: 80,
  color: '#65d9d0', attribute: 'level', order: 'left-to-right', seed: 1, muted: false, locked: false });

export function groupFlag(groups, groupId, flag) {
  const byId = new Map(groups.map(g => [g.id, g])), seen = new Set();
  let group = byId.get(groupId);
  while (group && !seen.has(group.id)) {
    if (group[flag]) return true;
    seen.add(group.id); group = byId.get(group.parentId);
  }
  return false;
}

export function editableClip(studio, clip) {
  return !clip.locked && !groupFlag(studio.groups, clip.groupId, 'locked');
}

// Batch edits preserve relative offsets and commit once, including mixed recipe/fixture selections.
export function moveStudioClips(studio, selectedIds, delta) {
  const ids = new Set(selectedIds);
  const selected = [...studio.recipes, ...studio.legacyClips].filter(c => ids.has(c.id) && editableClip(studio, c));
  if (!selected.length || !Number.isFinite(delta)) return studio;
  const minimum = Math.min(...selected.map(c => c.start ?? c.startTime));
  const maximum = Math.max(...selected.map(c => (c.start ?? c.startTime) + c.duration));
  const offset = Math.max(-minimum, Math.min(600 - maximum, delta));
  const move = (clip, key) => ids.has(clip.id) && editableClip(studio, clip) ? { ...clip, [key]: round(clip[key] + offset) } : clip;
  return { ...studio, recipes: studio.recipes.map(c => move(c, 'start')), legacyClips: studio.legacyClips.map(c => move(c, 'startTime')) };
}

export function copyStudioClips(studio, selectedIds) {
  const ids = new Set(selectedIds);
  return JSON.parse(JSON.stringify({ recipes: studio.recipes.filter(c => ids.has(c.id)), legacyClips: studio.legacyClips.filter(c => ids.has(c.id)) }));
}

export function pasteStudioClips(studio, clipboard, time) {
  const recipes = (clipboard?.recipes || []).filter(c => studio.groups.some(g => g.id === c.groupId) && !groupFlag(studio.groups, c.groupId, 'locked'));
  const legacy = clipboard?.legacyClips || [];
  const all = [...recipes, ...legacy];
  if (!all.length) return { studio, selectedIds: [] };
  const first = Math.min(...all.map(c => c.start ?? c.startTime));
  const span = Math.max(...all.map(c => (c.start ?? c.startTime) + c.duration)) - first;
  const offset = Math.max(0, Math.min(600 - span, time)) - first;
  const clone = (clip, key) => ({ ...clip, id: uid(key === 'start' ? 'recipe' : 'clip'), [key]: round(clip[key] + offset), locked: false });
  const addedRecipes = recipes.map(c => clone(c, 'start')), addedLegacy = legacy.map(c => clone(c, 'startTime'));
  return { studio: { ...studio, recipes: [...studio.recipes, ...addedRecipes], legacyClips: [...studio.legacyClips, ...addedLegacy] }, selectedIds: [...addedRecipes, ...addedLegacy].map(c => c.id) };
}

export function readStudio(draft) {
  const studio = draft?.studio || {};
  return { version: 1, groups: studio.groups || [], recipes: studio.recipes || [], presets: studio.presets || [], tempo: studio.tempo || [{ time: 0, bpm: 120 }],
    legacyClips: studio.legacyClips || (draft?.timelineClips || []).filter(c => !c.studioRecipeId),
    markers: studio.markers || (draft?.cues || []).map(c => ({ ...c, time: c.time ?? c.startTime ?? 0 })),
    layout: { preset: 'Compose', left: 250, right: 292, timeline: 310, view: 'plan', ...(studio.layout || {}) } };
}

export function primaryTrack(item, attribute = 'level') {
  const tracks = item.tracks || [];
  if (attribute !== 'level') return tracks.find(t => t.type === attribute);
  return tracks.find(t => /^(device_intensity|lighting_master|motion_intensity|pump_speed|solenoid_open|fog_density|fire_intensity|laser_intensity)$/.test(t.type)) || null;
}

export function envelopeValue(points, time) {
  const keys = points || [{ time: 0, value: 0 }, { time: .5, value: 1 }, { time: 1, value: 0 }];
  if (time <= keys[0].time) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    if (time <= keys[i].time) {
      const left = keys[i - 1], right = keys[i];
      return left.value + (right.value - left.value) * (time - left.time) / (right.time - left.time);
    }
  }
  return keys.at(-1).value;
}

export function snapBeat(time, tempo = [{ time: 0, bpm: 120 }]) {
  const ordered = [...tempo].filter(t => Number.isFinite(t.time) && t.time >= 0 && t.bpm >= 20 && t.bpm <= 300).sort((a, b) => a.time - b.time);
  const section = ordered.filter(t => t.time <= time).at(-1) || { time: 0, bpm: 120 };
  const step = 60 / section.bpm / 4;
  return round(Math.max(0, section.time + Math.round((time - section.time) / step) * step));
}

export function compileStudio(studio, items) {
  const groups = new Map(studio.groups.map(g => [g.id, g]));
  const ids = new Set(items.map(i => i.id));
  const clips = [...studio.legacyClips];
  const issues = [];
  const hasSolo = studio.groups.some(g => g.solo);
  const inherited = (group, key, seen = new Set()) => {
    if (!group || seen.has(group.id)) return false;
    seen.add(group.id);
    return Boolean(group[key]) || inherited(groups.get(group.parentId), key, seen);
  };
  studio.legacyClips.forEach(c => {
    if (!ids.has(c.fixtureId)) issues.push(`Missing fixture for ${c.name || c.id}`);
    if (![c.startTime, c.duration, c.value].every(Number.isFinite) || c.startTime < 0 || c.duration <= 0 || c.startTime + c.duration > 600
      || (c.fadeIn || 0) < 0 || (c.fadeOut || 0) < 0 || (c.fadeIn || 0) + (c.fadeOut || 0) > c.duration)
      issues.push(`${c.name || c.id}: invalid clip timing or fades.`);
  });
  for (const recipe of studio.recipes) {
    const group = groups.get(recipe.groupId);
    if (!group) { issues.push(`${recipe.name}: group is missing.`); continue; }
    if (recipe.muted || inherited(group, 'muted') || (hasSolo && !inherited(group, 'solo'))) continue;
    if (!EFFECTS.includes(recipe.effect)) { issues.push(`${recipe.name}: unsupported effect.`); continue; }
    if (recipe.effect === 'curve' && recipe.envelope && (recipe.envelope.length < 2 || recipe.envelope.some((p, i, list) => !Number.isFinite(p.time) || !Number.isFinite(p.value) || p.time < 0 || p.time > 1 || p.value < 0 || p.value > 1 || (i > 0 && p.time <= list[i - 1].time)))) {
      issues.push(`${recipe.name}: curve points must have increasing times and levels between 0 and 100%.`); continue;
    }
    const { start, duration, cycles, intensity, spread } = recipe;
    if (![start, duration, cycles, intensity, spread].every(Number.isFinite) || start < 0 || duration < .1 || start + duration > 600
      || cycles < 1 || cycles > 32 || !Number.isInteger(cycles) || intensity < 0 || intensity > 100 || spread < 0 || spread > 1) {
      issues.push(`${recipe.name}: timing, cycles or level is outside the supported range.`); continue;
    }
    const memberIds = recipe.frozenIds || resolveMembers(group, items);
    const missing = memberIds.filter(id => !ids.has(id));
    if (missing.length) issues.push(`${recipe.name}: ${missing.length} fixture(s) removed from Engineering.`);
    const members = orderMembers(memberIds, items, recipe.effect === 'ripple' ? 'center-out' : recipe.order || group.orderMode);
    if (!members.length) issues.push(`${recipe.name}: group is empty.`);
    const cycle = duration / cycles;
    members.forEach((item, index) => {
      const track = primaryTrack(item, recipe.attribute);
      if (!track) { issues.push(`${recipe.name}: ${item.label} has no compatible ${recipe.attribute || 'level'} channel.`); return; }
      const phase = members.length > 1 ? index / members.length : 0;
      const emit = (offset, span, level, fade = false, n = 0) => {
        if (clips.length >= 50000) {
          if (!issues.includes('Show exceeds 50,000 resolved clips. Reduce cycles or split the show.')) issues.push('Show exceeds 50,000 resolved clips. Reduce cycles or split the show.');
          return;
        }
        const end = Math.min(duration, offset + span);
        if (end - offset < .001 || offset < 0 || offset >= duration) return;
        const length = round(end - offset);
        clips.push({ id: `${recipe.id}:${item.id}:${n}`, studioRecipeId: recipe.id, patternBlockId: recipe.id,
          fixtureId: item.id, trackId: track.id, type: track.type, name: recipe.name,
          startTime: round(start + offset), duration: length, value: /motion_(pan|tilt|angle)/.test(track.type) ? round(-45 + level * .9) : round(level), color: recipe.color,
          fadeIn: fade && !/solenoid|enable/.test(track.type) ? round(length * .45) : 0,
          fadeOut: fade && !/solenoid|enable/.test(track.type) ? round(length * .45) : 0,
          curveType: 'linear', effects: [], source: 'show-studio' });
      };
      if (recipe.effect === 'curve') {
        const samples = Math.min(400, Math.max(20, Math.ceil(duration * 10)));
        for (let n = 0; n < samples; n++) {
          const offset = n * duration / samples;
          const local = ((offset / cycle - phase * spread) % 1 + 1) % 1;
          emit(offset, duration / samples, envelopeValue(recipe.envelope, local) * intensity, false, n);
        }
      } else if (['static', 'color'].includes(recipe.effect)) emit(0, duration, intensity);
      else if (recipe.effect === 'staircase') emit(phase * duration * .8, duration, intensity);
      else for (let n = 0; n < cycles; n++) {
        const randomPhase = ((index * 1103515245 + num(recipe.seed, 1) * 12345 + n * 2654435761) >>> 0) / 4294967296;
        const shift = recipe.effect === 'pulse' ? 0 : recipe.effect === 'sparkle' ? randomPhase : phase;
        const offset = n * cycle + shift * Math.min(1, spread) * cycle * .7;
        const span = recipe.effect === 'chase' ? Math.max(.05, cycle / Math.max(1, members.length)) : cycle * .3;
        emit(offset, span, intensity, ['wave', 'ripple', 'pulse'].includes(recipe.effect), n);
      }
    });
    if (clips.length > 50000) { issues.push('Show exceeds 50,000 resolved clips. Reduce cycles or split the show.'); break; }
  }
  return { clips, issues: [...new Set(issues)] };
}

export function sampleClips(clips, time) {
  const levels = {};
  for (const c of clips) {
    const local = time - c.startTime;
    if (local < 0 || local >= c.duration) continue;
    const fade = Math.min(1, c.fadeIn ? local / c.fadeIn : 1, c.fadeOut ? (c.duration - local) / c.fadeOut : 1);
    const value = Math.max(0, Math.min(1, c.value / 100 * fade));
    if (!levels[c.fixtureId] || value >= levels[c.fixtureId].value) levels[c.fixtureId] = { value, color: c.color || '#65d9d0' };
  }
  return levels;
}

// Translate the existing AI engine's section proposal into editable group recipes.
export function aiRecipes(response, groupId, prompt, start, duration) {
  const sections = response?.analysis?.sections;
  if (!Array.isArray(sections) || !sections.length) throw new Error('The AI engine returned no sections.');
  const effect = /chase/i.test(prompt) ? 'chase' : /ripple|radial/i.test(prompt) ? 'ripple' : /pulse/i.test(prompt) ? 'pulse' : /sparkle|random/i.test(prompt) ? 'sparkle' : 'wave';
  const color = /blue/i.test(prompt) ? '#529bff' : /green/i.test(prompt) ? '#66ef89' : /red/i.test(prompt) ? '#fb7185' : '#65d9d0';
  return sections.filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && s.start < duration).map((s, index) => ({
    ...newRecipe(groupId, start + Math.max(0, s.start)), name: `${s.label || 'AI section'} · ${effect}`,
    effect, color, duration: round(Math.min(duration, s.end) - Math.max(0, s.start)),
    intensity: Math.round(Math.min(90, Math.max(20, num(s.energy, .65) * 100))),
    cycles: Math.max(1, Math.min(8, Math.round((s.end - s.start) / 4))), seed: index + 1,
    provenance: { prompt, engine: 'AquaFlow choreography engine', notes: response.show?.notes || '', generatedAt: new Date().toISOString() }
  }));
}
