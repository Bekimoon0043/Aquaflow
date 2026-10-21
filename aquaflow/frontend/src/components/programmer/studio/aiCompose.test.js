import { describe, it, expect, vi } from 'vitest';
import { makeSong, SONGS, SITES } from './evalCorpus';
import { siteContext } from './showGenerators';
import { compileStudio } from './showModel';
import { composeContext, composeProposal, describeForCompose, fitLook, requestCompose, setLevels, validatePlacements } from './aiCompose';

const site = siteContext(SITES.ring().fixtures);
const pop = makeSong(SONGS.pop);
const ctx = composeContext(site.studio, site.items, pop.analysis);
const ring = ctx.groups.find((g) => g.control === 'switch');
const centre = ctx.groups.find((g) => g.control !== 'switch');

describe('AI compose — description and request', () => {
  it('describes groups, song and looks as text and sends the ids', async () => {
    const text = describeForCompose(ctx, 'blue wave on the ring in the chorus', 12);
    expect(text).toContain(ring.id);
    expect(text).toContain('stadium-wave');
    expect(text).toContain("USER'S WORDS: blue wave on the ring in the chorus");
    expect(text).toMatch(/SECTIONS/);
    const post = vi.fn(async () => ({ placements: [] }));
    await requestCompose(ctx, 'words', 0, { post });
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/ai/compose');
    expect(body.groups).toEqual(ctx.groups.map((g) => g.id));
    expect(body.looks).toContain('wave');
    expect(body.duration).toBe(ctx.song.duration);
  });
});

describe('AI compose — validating the answer', () => {
  it('drops unknown ids, bad times and too-short placements; clamps levels; fixes colours', () => {
    const answer = { placements: [
      { groupId: ring.id, look: 'wave', start: 10, end: 30, color: '#1E4FD8', low: 20, high: 70, why: 'chorus' },
      { groupId: 'ghost', look: 'wave', start: 0, end: 10, color: '#000000', low: 0, high: 50 },
      { groupId: ring.id, look: 'nope', start: 0, end: 10, color: '#000000', low: 0, high: 50 },
      { groupId: ring.id, look: 'pulse', start: 'soon', end: 10 },
      { groupId: ring.id, look: 'pulse', start: 40, end: 40.5 },
      { groupId: ring.id, look: 'pulse', start: -5, end: 9999, color: 'white', low: 90, high: 300 },
    ] };
    const { placements, dropped } = validatePlacements(answer, ctx);
    expect(dropped).toBe(4);
    expect(placements).toHaveLength(2);
    expect(placements[0]).toMatchObject({ start: 0, end: ctx.song.duration, color: '#35d0c0', low: 90, high: 100 });
    expect(placements[1]).toMatchObject({ look: 'wave', color: '#1e4fd8', low: 20, high: 70, why: 'chorus' });
    expect(validatePlacements(null, ctx).placements).toEqual([]);
    expect(validatePlacements({ placements: 'lots' }, ctx).placements).toEqual([]);
  });

  it('swaps a look the hardware cannot perform', () => {
    const pump = { control: 'pump', size: 2 };
    expect(fitLook('stadium-wave', pump)).toMatch(/breathing|grand-swell/);
    expect(fitLook('wave', { control: 'switch', size: 12 })).toBe('wave');
    expect(fitLook('stadium-wave', { control: 'switch', size: 3 })).not.toBe('stadium-wave');
  });
});

describe('AI compose — placements become hardware-aware recipes', () => {
  it('renders each placement with the generator machinery, tagged and levelled', () => {
    const answer = { summary: 'Ring wave, then centre swell', placements: [
      { groupId: ring.id, look: 'swaying-arcs', start: 8, end: 24, color: '#1e4fd8', low: 10, high: 60, why: 'chorus' },
      { groupId: ring.id, look: 'pulse', start: 30, end: 40, color: '#ffffff', low: 0, high: 90, why: 'drop' },
      { groupId: centre.id, look: 'wave', start: 30, end: 46, color: '#ffb347', low: 30, high: 80, why: 'swell' },
    ] };
    const p = composeProposal(site.studio, answer, ctx, site.items);
    expect(p.items).toHaveLength(3);
    expect(p.summary).toBe('Ring wave, then centre swell');
    const all = new Set(p.recipes.map((r) => r.id));
    for (const it of p.items) for (const id of it.recipeIds) expect(all.has(id)).toBe(true);
    // Every recipe is a user pattern (not wiped by Regenerate) tagged with its reason.
    for (const r of p.recipes) { expect(r.pattern.music).toBeUndefined(); expect(r.pattern.ai).toBe('compose'); }
    const ringWater = p.recipes.filter((r) => p.items[0].recipeIds.includes(r.id) && r.pattern.role === 'water');
    expect(ringWater.length).toBeGreaterThan(0);
    expect(ringWater[0].field).toMatchObject({ low: 10, high: 60 });
    // Solenoid ring: the compiler drives the real valves (hardwareFollow).
    expect(ringWater.every((r) => r.hardware === 'hits' || r.hardware === 'open')).toBe(true);
    const lights = p.recipes.filter((r) => p.items[1].recipeIds.includes(r.id) && r.pattern.role === 'lights');
    expect(lights[0]?.color).toBe('#ffffff');
    // The centre baskets cannot do a solenoid wave: the look follows the hardware.
    const centreRecipe = p.recipes.find((r) => p.items[2].recipeIds.includes(r.id) && r.pattern.role === 'water');
    if (centre.control === 'pump') expect(centreRecipe.pattern.look).not.toBe('wave');
    // Applying the proposal compiles into real clips.
    const studio = { ...site.studio, groups: [...site.studio.groups, ...p.groups], recipes: p.recipes };
    const { clips } = compileStudio(studio, site.items);
    expect(clips.length).toBeGreaterThan(0);
  });

  it('sets levels on fields and curves, leaving lights alone', () => {
    const field = { effect: 'field', field: { low: 20, high: 80, lowFar: 20, highFar: 80 }, pattern: { role: 'water' } };
    expect(setLevels(field, { low: 5, high: 40 }).field).toMatchObject({ low: 5, high: 40, lowFar: 5, highFar: 40 });
    const curve = { effect: 'curve', intensity: 100, envelope: [{ time: 0, value: 0.25 }, { time: 0.5, value: 1 }], pattern: { role: 'water', options: { maxLevel: 100 } } };
    const c = setLevels(curve, { low: 30, high: 60 });
    expect(c.intensity).toBe(60);
    expect(c.envelope.map((p) => p.value)).toEqual([0.5, 1]);
    expect(c.pattern.options).toMatchObject({ maxLevel: 60, minLevel: 30 });
    const light = { effect: 'field', field: { low: 6, high: 20 }, pattern: { role: 'lights' } };
    expect(setLevels(light, { high: 90 })).toBe(light);
  });
});
