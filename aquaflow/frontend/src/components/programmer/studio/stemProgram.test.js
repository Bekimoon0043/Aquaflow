import { describe, it, expect } from 'vitest';
import { analyzeStem, drumTrack, toneTrack } from './stemAnalysis';
import { availableSources, sourceValues, sourceById, suggestRows, programFromStems, STEM_BLOCK_S } from './stemProgram';
import { compileStudio, readStudio } from './showModel';

const jet = (id, h, x, extra = {}) => ({ id, type: 'jet_1d', label: id, x, y: 0, engineering: { jetHeightM: h }, tracks: [{ id: `${id}:lvl`, type: 'device_intensity' }], ...extra });
const items = [
  ...Array.from({ length: 6 }, (_, i) => jet(`ring${i}`, 2, i)),
  jet('tall1', 8, 10), jet('tall2', 8, 11),
  jet('basket1', 3, 20, { type: 'rotating_jet', label: 'Rotating basket 1' }),
  { id: 'L1', type: 'light_rgb', label: 'L1', x: 0, y: 0, tracks: [{ id: 'L1:m', type: 'lighting_master' }] },
];
const groups = [
  { id: 'ring', name: 'Ring', memberFixtureIds: items.slice(0, 6).map(i => i.id), orderMode: 'clockwise' },
  { id: 'tall', name: 'Tall', memberFixtureIds: ['tall1', 'tall2'] },
  { id: 'basket', name: 'Baskets', memberFixtureIds: ['basket1'] },
  { id: 'lights', name: 'Lights', memberFixtureIds: ['L1'] },
];
const membersOf = g => g.memberFixtureIds.map(id => items.find(i => i.id === id));
const stems = [
  { role: 'drums', analysis: analyzeStem(drumTrack({ seconds: 20, kicks: [1, 2, 3, 17], hats: [1.5, 2.5] }), 11025, 'drums') },
  { role: 'vocals', analysis: analyzeStem(toneTrack({ seconds: 20, on: t => t < 8 || t > 12 }), 11025, 'vocals') },
];

describe('programming from stems', () => {
  it('offers only the parts of the loaded stems', () => {
    const ids = availableSources(stems).map(s => s.id);
    expect(ids).toEqual(expect.arrayContaining(['drums:kicks', 'drums:hats', 'vocals:melody', 'vocals']));
    expect(ids).not.toContain('bass');
  });

  it('a kick lifts the jets and they fall away; the melody rests in silence', () => {
    const kick = sourceValues(stems[0].analysis, sourceById('drums:kicks'), [0.9, 1.02, 1.3, 1.9]);
    expect(kick[0]).toBeLessThan(0.1);
    expect(kick[1]).toBeGreaterThan(0.6);
    expect(kick[2]).toBeLessThan(kick[1]);
    const mel = sourceValues(stems[1].analysis, sourceById('vocals:melody'), [2, 10, 18]);
    expect(mel[1]).toBe(-1);
    expect(mel[2]).toBeGreaterThan(mel[0]);
  });

  it('suggests the melody for rotating jets, the kick for the big group, lights on the drums', () => {
    const rows = suggestRows(stems, groups.slice(0, 3), [groups[3]], membersOf);
    expect(rows.find(r => r.sourceId === 'vocals:melody').groupId).toBe('basket');
    expect(rows.find(r => r.sourceId === 'drums:kicks').groupId).toBe('ring');
    expect(rows.find(r => r.kind === 'lights')).toMatchObject({ sourceId: 'drums:kicks', groupId: 'lights' });
  });

  it('writes 20 Hz keyed curves per group and block that compile into clips', () => {
    const studio = readStudio({});
    const rows = [{ sourceId: 'drums:kicks', groupId: 'ring', min: 10, max: 100, kind: 'water' },
      { sourceId: 'vocals:melody', groupId: 'basket', min: 20, max: 100, kind: 'water' },
      { sourceId: 'drums:kicks', groupId: 'lights', min: 15, max: 100, kind: 'lights' }];
    const out = programFromStems(studio, { stems, rows, items, groups });
    expect(out.skipped).toEqual([]);
    // 20 s → two 16 s blocks per row.
    expect(out.recipes).toHaveLength(6);
    expect(out.recipes[0]).toMatchObject({ effect: 'curve', cycles: 1, spread: 0, sampleRate: 20, duration: STEM_BLOCK_S });
    const { clips, issues } = compileStudio(out.studio, items);
    expect(issues).toEqual([]);
    const ring0 = clips.filter(c => c.fixtureId === 'ring0');
    expect(ring0).toHaveLength(2);
    expect(ring0[0].keys.length / 2).toBeGreaterThanOrEqual(STEM_BLOCK_S * 20);
    // The kick at 1 s shows in ring0's keys: high just after, low just before.
    const k = ring0[0].keys;
    const value = t => { let best = 0; for (let i = 0; i < k.length; i += 2) if (k[i] <= t) best = k[i + 1]; return best; };
    expect(value(1.05)).toBeGreaterThan(70);
    expect(value(0.9)).toBeLessThan(20);
    expect(clips.some(c => c.fixtureId === 'L1' && c.type === 'lighting_master')).toBe(true);
  });

  it('replaces the previous stem programming and refuses a light row on water', () => {
    const studio = readStudio({});
    const first = programFromStems(studio, { stems, rows: [{ sourceId: 'drums:kicks', groupId: 'ring', min: 0, max: 100 }], items, groups });
    const again = programFromStems(first.studio, { stems, rows: [{ sourceId: 'drums:kicks', groupId: 'ring', min: 0, max: 100 },
      { sourceId: 'drums:kicks', groupId: 'ring', min: 0, max: 100, kind: 'lights' }], items, groups });
    expect(again.studio.recipes.filter(r => r.stems)).toHaveLength(2);
    expect(again.studio.recipes.every(r => r.stems.fill === again.fillId)).toBe(true);
    expect(again.skipped).toEqual(['Drums — kick']);
  });
});

describe('suggestions', () => {
  it('never links two parts to groups that share their jets', () => {
    const overlapping = [...groups.slice(0, 3), { id: 'ring2', name: 'Ring again', memberFixtureIds: groups[0].memberFixtureIds }];
    const rows = suggestRows(stems, overlapping, [], membersOf);
    const used = rows.map(r => r.groupId);
    expect(used).not.toEqual(expect.arrayContaining(['ring', 'ring2']));
    expect(new Set(used).size).toBe(used.length);
  });
});
