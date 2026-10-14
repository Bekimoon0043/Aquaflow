import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileStudio, inventory, readStudio } from './showModel';
import { builderGroups, builderStateFromUnit, buildPatternUnit, patternUnit, quickGroups } from './patternPresets';
import {
  BUILTIN_PRESETS, LIBRARY_KEY, builderValuesFromPreset, exportLibrary, importLibrary, loadUserLibrary, presetCards,
  presetFromBuilder, sanitizePreset, saveUserLibrary, upsertPreset,
} from './patternLibrary';

const ring = (prefix, n, radius, extra) => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}-${i + 1}`, label: `${prefix} ${i + 1}`,
  x: 10 + radius * Math.cos((2 * Math.PI * i) / n), y: 10 + radius * Math.sin((2 * Math.PI * i) / n), ...extra,
}));
const items = inventory([
  ...ring('jet', 8, 4, { type: 'nozzle_foam_dn40', engineering: { siteFunction: 'foam', jetHeightM: 2.5 } }),
  ...ring('lamp', 4, 3, { type: 'light_par', engineering: {} }),
], []);
const [water, lights] = quickGroups(items);
const mirrorOptions = { start: 2, duration: 24, lapSeconds: 8, minLevel: 35, maxLevel: 90, order: 'inward', crests: 1, smoothness: 'smooth', axis: 'sides', color: '#65d9d0' };

describe('reopen / update a builder pattern', () => {
  it('Mirror + matching lights (four recipes) form one unit that reopens with the same settings', () => {
    const hand = { id: 'hand', groupId: 'g', name: 'Hand made', effect: 'wave', start: 0, duration: 5, cycles: 1, spread: 1, intensity: 50 };
    const studio = { ...readStudio({}), recipes: [hand] };
    const made = buildPatternUnit(studio, { preset: 'mirror', options: mirrorOptions, group: water, items, lights: { group: lights, level: 30, color: '#4f8cff' } });
    expect(made.recipes).toHaveLength(4); // two water halves + two light halves
    const ids = new Set(made.recipes.map(r => r.pattern.id));
    expect(ids.size).toBe(1);
    expect(made.recipes.map(r => r.pattern.role)).toEqual(['water', 'water', 'lights', 'lights']);

    // Any of them reopens the whole unit.
    for (const r of made.recipes) expect(patternUnit(made.studio, r.id).recipeIds).toEqual(made.recipeIds);
    expect(patternUnit(made.studio, 'hand')).toBeNull();
    const state = builderStateFromUnit(patternUnit(made.studio, made.recipes[2].id), builderGroups(made.studio, items));
    expect(state).toMatchObject({ preset: 'mirror', groupId: water.id, sync: false,
      options: { lapSeconds: 8, minLevel: 35, maxLevel: 90, order: 'inward', axis: 'sides', start: 2, duration: 24 },
      lights: { enabled: true, level: 30, color: '#4f8cff' } });
    expect(state.lights.groupId).toBe(lights.id); // the whole light group, not one mirror half
  });

  it('Update replaces the unit in place: same ids and position, unused groups tidied', () => {
    const hand = { id: 'hand', groupId: 'g', name: 'Hand made', effect: 'wave', start: 0, duration: 5, cycles: 1, spread: 1, intensity: 50 };
    const tail = { ...hand, id: 'tail' };
    const first = buildPatternUnit({ ...readStudio({}), recipes: [hand, tail] }, { preset: 'mirror', options: mirrorOptions, group: water, items });
    // Move the hand-made recipe after the unit so we can check the unit keeps its place.
    const studio = first.studio;
    expect(studio.recipes.map(r => r.id)).toEqual(['hand', 'tail', ...first.recipeIds]);
    const halves = studio.groups.filter(g => /half/.test(g.name)).map(g => g.id);
    expect(halves).toHaveLength(2);

    const again = buildPatternUnit(studio, { preset: 'mirror', options: { ...mirrorOptions, lapSeconds: 12 }, group: water, items,
      unitId: first.unitId, replaceIds: first.recipeIds });
    expect(again.studio.recipes.map(r => r.id)).toEqual(studio.recipes.map(r => r.id));
    expect(again.recipes[0].cycles).toBe(2);
    expect(again.studio.groups.filter(g => /half/.test(g.name)).map(g => g.id)).toEqual(halves);

    // Switching the unit to a wave drops the two half-groups it no longer needs.
    const wave = buildPatternUnit(again.studio, { preset: 'wave', options: { ...mirrorOptions, order: 'clockwise' }, group: water, items,
      unitId: first.unitId, replaceIds: again.recipeIds });
    expect(wave.recipes).toHaveLength(1);
    expect(wave.recipes[0].id).toBe(first.recipeIds[0]);
    expect(wave.studio.groups.some(g => /half/.test(g.name))).toBe(false);
    expect(wave.studio.recipes.map(r => r.id)).toEqual(['hand', 'tail', first.recipeIds[0]]);
    expect(compileStudio(wave.studio, items).issues.filter(i => !/group is missing/.test(i))).toEqual([]);
  });

  it('recipes made before units existed still reopen (mirror halves found by their pattern)', () => {
    const made = buildPatternUnit(readStudio({}), { preset: 'mirror', options: mirrorOptions, group: water, items });
    const legacy = { ...made.studio, recipes: made.studio.recipes.map(r => ({ ...r, pattern: { preset: r.pattern.preset, options: r.pattern.options } })) };
    expect(patternUnit(legacy, legacy.recipes[1].id).recipeIds).toHaveLength(2);
  });
});

describe('saved presets', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const memory = () => {
    const data = new Map();
    return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), data };
  };

  it('stores builder options only — never fixtures, groups or start time', () => {
    const p = presetFromBuilder('  Night wave ', { preset: 'wave', options: { ...mirrorOptions, order: 'clockwise', start: 44, seed: 3, frozenIds: ['jet-1'], groupId: 'x', sync: { bpm: 120 } },
      lights: { enabled: true, level: 25, color: '#112233', groupId: 'quick:lights' } });
    expect(p).toMatchObject({ name: 'Night wave', kind: 'pattern', preset: 'wave', lights: { enabled: true, level: 25, color: '#112233' } });
    expect(p.options).toEqual({ lapSeconds: 8, minLevel: 35, maxLevel: 90, order: 'clockwise', crests: 1, smoothness: 'smooth', duration: 24, color: '#65d9d0', axis: 'sides' });
    expect(JSON.stringify(p)).not.toMatch(/jet-1|quick:|groupId|start|sync/);
    expect(sanitizePreset({ name: 'x', preset: 'nope' })).toBeNull();
    expect(sanitizePreset({ name: '', preset: 'wave' })).toBeNull();
    expect(sanitizePreset({ name: 'Wild', preset: 'chase', options: { maxLevel: 400, minLevel: -5, crests: 99 } }).options).toMatchObject({ maxLevel: 100, minLevel: 0, crests: 8 });
  });

  it('saves to and loads from the user library; survives broken storage', () => {
    const store = memory();
    vi.stubGlobal('localStorage', store);
    const a = presetFromBuilder('A', { preset: 'ripple', options: {}, lights: {} });
    const list = upsertPreset(upsertPreset([], a), { ...a, name: 'a', options: { lapSeconds: 3 } }); // same name → replaced
    expect(list).toHaveLength(1);
    expect(saveUserLibrary(list)).toBe(true);
    expect(JSON.parse(store.data.get(LIBRARY_KEY))[0].options.lapSeconds).toBe(3);
    expect(loadUserLibrary().map(p => p.name)).toEqual(['a']);

    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } });
    expect(loadUserLibrary()).toEqual([]);
    expect(saveUserLibrary(list)).toBe(false);
    store.data.set(LIBRARY_KEY, '{not json');
    vi.stubGlobal('localStorage', store);
    expect(loadUserLibrary()).toEqual([]);
  });

  it('exports and imports JSON (bad entries skipped, bad files rejected)', () => {
    const list = [presetFromBuilder('One', { preset: 'wave', options: {}, lights: {} }), presetFromBuilder('Two', { preset: 'pulse', options: {}, lights: {} })];
    const text = exportLibrary(list);
    expect(JSON.parse(text)).toMatchObject({ format: 'aquaflow-pattern-presets', version: 1 });
    const back = importLibrary(text);
    expect(back.map(p => [p.name, p.preset])).toEqual([['One', 'wave'], ['Two', 'pulse']]);
    expect(back[0].id).not.toBe(list[0].id);
    expect(importLibrary(JSON.stringify([{ name: 'Ok', preset: 'chase' }, { name: 'Bad', preset: 'laser' }])).map(p => p.name)).toEqual(['Ok']);
    expect(() => importLibrary('nope')).toThrow(/preset file/);
    expect(() => importLibrary('{"format":"other"}')).toThrow(/preset file/);
  });

  it('cards: built-in Lebu wave first, then project and library (deduplicated)', () => {
    const project = [{ id: 'old', name: 'Old recipe preset', effect: 'wave' }, { ...presetFromBuilder('Mine', { preset: 'wave', options: {}, lights: {} }) }];
    const cards = presetCards(project, [presetFromBuilder('mine', { preset: 'chase', options: {}, lights: {} }), presetFromBuilder('Lib', { preset: 'chase', options: {}, lights: {} })]);
    expect(cards.map(c => [c.name, c.source])).toEqual([['Lebu wave', 'built-in'], ['Mine', 'project'], ['Lib', 'library']]);
  });

  it('Lebu wave: smooth wave, clockwise, 3 laps in 30 s, 35–100 %, lights at 30 %', () => {
    const values = builderValuesFromPreset(BUILTIN_PRESETS[0], { start: 6 });
    expect(values.options).toMatchObject({ start: 6, duration: 30, lapSeconds: 10, minLevel: 35, maxLevel: 100, order: 'clockwise', smoothness: 'smooth' });
    expect(values.lights).toMatchObject({ enabled: true, level: 30 });
    const made = buildPatternUnit(readStudio({}), { preset: values.preset, options: values.options, group: water, items,
      lights: { group: lights, level: values.lights.level, color: values.lights.color } });
    const [w, l] = made.recipes;
    expect(w).toMatchObject({ effect: 'curve', cycles: 3, duration: 30, start: 6, intensity: 100, order: 'clockwise' });
    expect(w.envelope[0].value).toBeCloseTo(.35, 3);
    expect(l).toMatchObject({ cycles: 3, intensity: 30 });
  });
});
