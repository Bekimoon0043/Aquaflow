import { describe, expect, it } from 'vitest';
import { compileStudio, envelopeValue, inventory, orderMembers, readStudio } from './showModel';
import {
  applyMatchingLights, applyPattern, ensureGroup, mirrorHalves, patternEnvelope, quickGroups, raiseJetsPatch,
  recipeLevelRange, showVisibility, snapCycles, visibilityCheck,
} from './patternPresets';

// Eight perimeter jets on a circle plus four lights.
const ring = (prefix, n, radius, extra) => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}-${i + 1}`, label: `${prefix} ${i + 1}`,
  x: 10 + radius * Math.cos((2 * Math.PI * i) / n), y: 10 + radius * Math.sin((2 * Math.PI * i) / n), ...extra,
}));
const jets = ring('jet', 8, 4, { type: 'nozzle_foam_dn40', engineering: { siteFunction: 'foam', jetHeightM: 2.5 } });
const lamps = ring('lamp', 4, 3, { type: 'light_par', engineering: {} });
const items = inventory([...jets, ...lamps], []);
const studio = readStudio({});
const water = quickGroups(items)[0];

describe('pattern presets → recipes', () => {
  it('quick group "All water jets" holds every jet ordered clockwise', () => {
    expect(water.name).toBe('All water jets');
    expect(water.memberFixtureIds).toHaveLength(8);
    expect(water.memberFixtureIds).toEqual(orderMembers(jets.map(j => j.id), items, 'clockwise').map(i => i.id));
  });

  it('snaps speed to whole laps so the loop is seamless', () => {
    expect(snapCycles(30, 10)).toMatchObject({ cycles: 3, lapSeconds: 10, snapped: false });
    expect(snapCycles(30, 7)).toMatchObject({ cycles: 4, lapSeconds: 7.5, snapped: true });
    expect(snapCycles(30, 200).cycles).toBe(1);
    expect(snapCycles(600, .5).cycles).toBe(32);
  });

  it('builds dense raised-cosine envelopes (≥33 points, floor, crest at the middle)', () => {
    const env = patternEnvelope({ floor: .35 });
    expect(env.length).toBeGreaterThanOrEqual(33);
    expect(env[0]).toEqual({ time: 0, value: .35 });
    expect(env.at(-1)).toEqual({ time: 1, value: .35 });
    expect(envelopeValue(env, .5)).toBeCloseTo(1, 3);
    expect(envelopeValue(env, .25)).toBeCloseTo(.35 + .65 * .5, 2);
    const two = patternEnvelope({ crests: 2, floor: 0 });
    expect(envelopeValue(two, .25)).toBeCloseTo(1, 2);
    expect(envelopeValue(two, .75)).toBeCloseTo(1, 2);
    expect(envelopeValue(two, .5)).toBeCloseTo(0, 2);
    const sharp = patternEnvelope({ smoothness: 'sharp' });
    expect(envelopeValue(sharp, .3)).toBeLessThan(envelopeValue(env, .3));
  });

  it('Smooth wave → one curve recipe with seamless integer cycles, matching the hand-made recipe', () => {
    const result = applyPattern(studio, { preset: 'wave', group: water, items,
      options: { start: 0, duration: 30, lapSeconds: 10, minLevel: 35, maxLevel: 100, order: 'clockwise', crests: 1, smoothness: 'smooth' } });
    expect(result.recipes).toHaveLength(1);
    const r = result.recipes[0];
    expect(r).toMatchObject({ effect: 'curve', cycles: 3, spread: 1, intensity: 100, order: 'clockwise', start: 0, duration: 30, attribute: 'level' });
    expect(Number.isInteger(r.cycles)).toBe(true);
    expect(r.envelope.length).toBeGreaterThanOrEqual(33);
    expect(r.envelope[0].value).toBeCloseTo(.35, 3);
    // A new group was created for the quick group, and the recipe points at it.
    const group = result.studio.groups.find(g => g.id === r.groupId);
    expect(group.name).toBe('All water jets');
    expect(result.studio.recipes).toHaveLength(1);
    // Compiles cleanly and the start/end of every jet's level matches (seamless loop).
    const compiled = compileStudio(result.studio, items);
    expect(compiled.issues).toEqual([]);
    expect(new Set(compiled.clips.map(c => c.fixtureId)).size).toBe(8);
    // Whole laps: each jet's first sample equals what it would be one clip-length later.
    const jet3 = compiled.clips.filter(c => c.fixtureId === 'jet-3').sort((x, y) => x.startTime - y.startTime);
    const lap = r.duration / r.cycles, phase = orderMembers(group.memberFixtureIds, items, r.order).findIndex(m => m.id === 'jet-3') / 8;
    const level = t => envelopeValue(r.envelope, ((t / lap - phase) % 1 + 1) % 1) * r.intensity;
    expect(jet3[0].value).toBeCloseTo(level(0), 2);
    expect(level(r.duration)).toBeCloseTo(level(0), 6);
  });

  it('reuses an identical quick group instead of creating duplicates', () => {
    const once = ensureGroup(studio, water);
    const twice = ensureGroup(once.studio, water);
    expect(twice.groupId).toBe(once.groupId);
    expect(twice.studio.groups).toHaveLength(1);
  });

  it('Breathing has no travel (spread 0); Ripple runs centre-out; Sparkle uses the sparkle effect', () => {
    const breathe = applyPattern(studio, { preset: 'breathing', group: water, items, options: { duration: 24, lapSeconds: 8 } }).recipes[0];
    expect(breathe).toMatchObject({ effect: 'curve', spread: 0, cycles: 3 });
    const ripple = applyPattern(studio, { preset: 'ripple', group: water, items, options: { duration: 24 } }).recipes[0];
    expect(ripple.order).toBe('center-out');
    const sparkle = applyPattern(studio, { preset: 'sparkle', group: water, items, options: { duration: 20, lapSeconds: 2 } }).recipes[0];
    expect(sparkle).toMatchObject({ effect: 'sparkle', cycles: 10 });
    expect(sparkle.envelope).toBeUndefined();
  });

  it('Chase uses a narrow crest; two crests repeat the envelope twice', () => {
    const chase = applyPattern(studio, { preset: 'chase', group: water, items, options: { duration: 24, lapSeconds: 6, minLevel: 0, crests: 2 } }).recipes[0];
    expect(chase.cycles).toBe(4);
    const peaks = chase.envelope.filter((p, i, l) => i > 0 && i < l.length - 1 && p.value >= l[i - 1].value && p.value > l[i + 1].value);
    expect(peaks).toHaveLength(2);
    expect(envelopeValue(chase.envelope, .5)).toBeLessThan(.05);
  });

  it('Mirror splits the group into two halves that travel towards the middle', () => {
    const line = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, x: i, y: 0 }));
    const halves = mirrorHalves(line.map(n => n.id), line, { axis: 'sides', direction: 'inward' });
    expect(halves.map(h => h.side)).toEqual(['left', 'right']);
    expect(halves[0].ids).toEqual(['n0', 'n1', 'n2']); // outside → middle
    expect(halves[1].ids).toEqual(['n5', 'n4', 'n3']);
    const outward = mirrorHalves(line.map(n => n.id), line, { direction: 'outward' });
    expect(outward[0].ids).toEqual(['n2', 'n1', 'n0']);

    const result = applyPattern(studio, { preset: 'mirror', group: water, items, options: { duration: 16, lapSeconds: 8 } });
    expect(result.recipes).toHaveLength(2);
    const [a, b] = result.recipes;
    expect(a).toMatchObject({ order: 'engineering', cycles: 2, spread: 1 });
    expect(b).toMatchObject({ order: 'engineering', cycles: a.cycles, spread: a.spread });
    expect(a.envelope).toEqual(b.envelope);
    const groups = result.groupIds.map(id => result.studio.groups.find(g => g.id === id));
    expect(groups.map(g => g.memberFixtureIds.length).reduce((x, y) => x + y)).toBe(8);
    expect(compileStudio(result.studio, items).issues).toEqual([]);
  });

  it('Lights match the water: same order, cycles and spread, softer level, own colour', () => {
    const wave = applyPattern(studio, { preset: 'wave', group: water, items,
      options: { duration: 30, lapSeconds: 10, minLevel: 35, maxLevel: 100, order: 'clockwise' } });
    const lights = quickGroups(items)[1];
    expect(lights.memberFixtureIds).toHaveLength(4);
    const lit = applyMatchingLights(wave.studio, wave.recipes, { group: lights, items, color: '#3366ff', level: 30, floor: .2 });
    expect(lit.recipes).toHaveLength(1);
    const [w] = wave.recipes, [l] = lit.recipes;
    expect(l).toMatchObject({ effect: 'curve', order: w.order, cycles: w.cycles, spread: w.spread, intensity: 30, color: '#3366ff', start: w.start, duration: w.duration });
    expect(l.envelope[0].value).toBeCloseTo(.2, 3);
    expect(l.groupId).not.toBe(w.groupId);
    expect(lit.studio.recipes).toHaveLength(2);
    expect(compileStudio(lit.studio, items).issues).toEqual([]);
  });
});

describe('visibility warnings', () => {
  const jet = (h, n = 4) => Array.from({ length: n }, (_, i) => ({ id: `j${i}`, type: 'nozzle_foam_dn40', engineering: { jetHeightM: h } }));

  it('0.58 m jets, 1.2 m pump head, 23–52 % → "hard to see" and "subtle"', () => {
    const check = visibilityCheck({ members: jet(.58), params: { design_head_m: 1.2 }, minLevel: 23, maxLevel: 52 });
    expect(check.maxHeightM).toBeLessThan(.6);
    expect(check.maxHeightM).toBeCloseTo(.58 * .52, 2);
    expect(check.warnings.map(w => w.code)).toEqual(['low', 'subtle']);
    expect(check.warnings[0].text).toMatch(/^Jets will be about 0\.3 m tall — hard to see$/);
  });

  it('2.5 m jets, 4 m head, 100 % → no warning', () => {
    const check = visibilityCheck({ members: jet(2.5), params: { design_head_m: 4 }, minLevel: 35, maxLevel: 100 });
    expect(check.maxHeightM).toBeCloseTo(2.5, 3);
    expect(check.warnings).toEqual([]);
  });

  it('a low pump head caps tall jets', () => {
    const check = visibilityCheck({ members: jet(3), params: { design_head_m: 1 }, minLevel: 0, maxLevel: 100 });
    expect(check.maxHeightM).toBeCloseTo(.5, 3);
    expect(check.limitedBy).toBe('pump head');
  });

  it('a narrow level range on good jets only warns "subtle"', () => {
    const check = visibilityCheck({ members: jet(2.5), params: {}, minLevel: 90, maxLevel: 100 });
    expect(check.warnings.map(w => w.code)).toEqual(['subtle']);
  });

  it('unknown jet heights or lights give no verdict', () => {
    expect(visibilityCheck({ members: [{ id: 'x', type: 'nozzle_foam_dn40', engineering: {} }], params: {} })).toBeNull();
    expect(visibilityCheck({ members: lamps, params: {} })).toBeNull();
  });

  it('timeline badge data lists low patterns from the envelope level range', () => {
    const lowJets = ring('low', 4, 3, { type: 'nozzle_foam_dn40', engineering: { siteFunction: 'foam', jetHeightM: .58 } });
    const lowItems = inventory(lowJets, []);
    const wave = applyPattern(studio, { preset: 'wave', group: quickGroups(lowItems)[0], items: lowItems, options: { minLevel: 23, maxLevel: 52 } });
    expect(recipeLevelRange(wave.recipes[0]).max).toBeCloseTo(52, 1);
    const list = showVisibility(wave.studio, lowItems, { design_head_m: 1.2 });
    expect(list).toHaveLength(1);
    expect(list[0].warnings[0].code).toBe('low');
    expect(showVisibility(wave.studio, lowItems.map(i => ({ ...i, engineering: { ...i.engineering, jetHeightM: 2.5 } })), { design_head_m: 4 })).toEqual([]);
  });

  it('raise fix only patches the chosen jets and lifts the pump head when needed', () => {
    const fixtures = [{ id: 'a', engineering: { jetHeightM: .58 } }, { id: 'b', engineering: { jetHeightM: .58 } }];
    const patch = raiseJetsPatch(fixtures, ['a'], { design_head_m: 1.2 }, 2);
    expect(patch.fixtures[0].engineering.jetHeightM).toBe(2);
    expect(patch.fixtures[1]).toBe(fixtures[1]);
    expect(patch.params.design_head_m).toBe(3);
    expect(raiseJetsPatch(fixtures, ['a'], { design_head_m: 10 }, 2).params.design_head_m).toBe(10);
  });
});
