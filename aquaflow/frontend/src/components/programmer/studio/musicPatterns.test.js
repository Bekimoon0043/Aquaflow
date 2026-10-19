import { describe, it, expect } from 'vitest';
import { analyzeSamples, clickTrack } from './musicAnalysis';
import { analyzeStem, drumTrack, toneTrack } from './stemAnalysis';
import { choosePattern, patternsFromMusic, phraseFeatures, waterLead } from './musicPatterns';
import { sourceById } from './stemProgram';
import { compileStudio, readStudio } from './showModel';
import { builderGroups } from './patternPresets';

const rate = 22050, bpm = 120, seconds = 64;
const song = analyzeSamples(clickTrack({ bpm, bars: 32, rate: 11025, level: bar => (bar >= 16 ? 1 : 0.35) }), 11025).analysis;
const kicks = Array.from({ length: seconds * 2 }, (_, i) => i * 0.5);
const stems = [
  { role: 'drums', analysis: analyzeStem(drumTrack({ seconds, rate, kicks, hats: kicks.map(k => k + 0.25) }), rate, 'drums') },
  { role: 'vocals', analysis: analyzeStem(toneTrack({ seconds, rate, on: t => t < 30 || t > 34 }), rate, 'vocals') },
];
const jet = (id, h, x) => ({ id, type: 'nozzle_foam_dn40', label: id, x, y: 0, z: 0, engineering: { jetHeightM: h } });
const fixtures = [...Array.from({ length: 6 }, (_, i) => jet(`ring${i}`, 1, i)), jet('tall1', 3, 10), jet('tall2', 3, 11)];
const items = fixtures.map(f => ({ ...f, tracks: [{ id: `${f.id}:lvl`, type: 'device_intensity' }] }));
const studio = { ...readStudio({}), groups: [
  { id: 'ring', name: 'Ring', memberFixtureIds: fixtures.slice(0, 6).map(f => f.id), orderMode: 'clockwise' },
  { id: 'tall', name: 'Tall', memberFixtureIds: ['tall1', 'tall2'] }] };

describe('patterns from the music', () => {
  it('fires early by the water rise time', () => {
    expect(waterLead(0)).toBeCloseTo(0.1);
    expect(waterLead(3)).toBeCloseTo(0.1 + 1.2 * Math.sqrt(6 / 9.81), 3);
    expect(waterLead(100)).toBe(3);
  });

  it('measures kicks per beat and singing share in a phrase', () => {
    const f = phraseFeatures(stems[0].analysis, sourceById('drums:kicks'), 4, 20, 0.5);
    expect(f.hitsPerBeat).toBeGreaterThan(0.7);
    const v = phraseFeatures(stems[1].analysis, sourceById('vocals:melody'), 30.2, 33.8, 0.5);
    expect(v.voiced).toBeLessThan(0.2);
  });

  it('picks beat patterns for kicks, rests a silent melody and rotates the family', () => {
    const kick = sourceById('drums:kicks'), mel = sourceById('vocals:melody');
    const ctx = { label: 'chorus', eRel: 0.9, beatSec: 0.5, barSec: 2, members: 6 };
    expect(choosePattern(kick, { hitsPerBeat: 1, energy: 0.8 }, { ...ctx, variant: 0 }).preset).toBe('pulse');
    expect(choosePattern(kick, { hitsPerBeat: 1, energy: 0.8 }, { ...ctx, variant: 1 }).preset).toBe('chase');
    expect(choosePattern(mel, { voiced: 0.1, pitchRange: 0.5 }, ctx)).toBeNull();
    expect(choosePattern(mel, { voiced: 0.9, pitchRange: 0.7 }, { ...ctx, label: 'verse' })).toMatchObject({ preset: 'wave', crests: 2 });
  });

  it('lays editable, compiling patterns over the song for each link, starting early', () => {
    const groups = builderGroups(studio, items);
    const rows = [{ sourceId: 'drums:kicks', groupId: 'ring', kind: 'water' }, { sourceId: 'vocals:melody', groupId: 'tall', kind: 'water' }];
    const out = patternsFromMusic(studio, { analysis: song, stems, rows, items, groups });
    const water = out.recipes.filter(r => r.pattern?.music && r.pattern.role !== 'lights');
    expect(water.length).toBeGreaterThan(4);
    expect(new Set(water.map(r => r.pattern.part))).toEqual(new Set(['drums:kicks', 'vocals:melody']));
    // Tall (3 m) melody patterns start about 0.9 s before their phrase.
    const lead = water.find(r => r.pattern.part === 'vocals:melody' && r.pattern.leadS > 0);
    expect(lead.pattern.leadS).toBeCloseTo(waterLead(3), 2);
    const { issues, clips } = compileStudio(out.studio, items);
    expect(issues).toEqual([]);
    expect(clips.length).toBeGreaterThan(0);
    // Running again replaces the earlier music patterns.
    const again = patternsFromMusic(out.studio, { analysis: song, stems, rows, items, groups });
    expect(again.studio.recipes.filter(r => r.pattern?.music).every(r => r.pattern.music === again.fillId)).toBe(true);
  });
});
