import { describe, expect, it } from 'vitest';
import { compileStudio, envelopeValue, inventory, readStudio, resolveMembers } from './showModel';
import { MIN_OFF_S, MIN_ON_S, buildPatternUnit, quickGroups, snapCycles } from './patternPresets';
import { fillSong, grid, nearestBar, snapRangeToBars, syncPatternOptions, wholeBeatLap } from './beatSync';
import { analyzeSamples, clickTrack } from './musicAnalysis';

const ring = (prefix, n, radius, extra) => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}-${i + 1}`, label: `${prefix} ${i + 1}`,
  x: 10 + radius * Math.cos((2 * Math.PI * i) / n), y: 10 + radius * Math.sin((2 * Math.PI * i) / n), ...extra,
}));
const jets = ring('jet', 8, 4, { type: 'nozzle_foam_dn40', engineering: { siteFunction: 'foam', jetHeightM: 2.5 } });
const lamps = ring('lamp', 4, 3, { type: 'light_par', engineering: {} });
const items = inventory([...jets, ...lamps], []);
const [water, lights] = quickGroups(items);

// 120 BPM, 4/4, first downbeat at 0.25 s → bars every 2 s from 0.25 s.
const analysis = { bpm: 120, beatsPerBar: 4, duration: 64, beats: [], downbeats: [.25, 2.25], sections: [], energy: { rate: 4, values: [] } };
const LEVELS = [...Array(4).fill(.2), ...Array(8).fill(.5), ...Array(8).fill(1), ...Array(8).fill(.5), ...Array(4).fill(.2)];
const song = analyzeSamples(clickTrack({ bpm: 120, bars: 32, rate: 11025, level: b => LEVELS[b] ?? .2 }), 11025).analysis;

/** Half-maximum width of an envelope hump as a fraction of one cycle. */
const halfWidth = (envelope, crests = 1) => {
  const n = 2000;
  const values = Array.from({ length: n }, (_, i) => envelopeValue(envelope, i / n));
  const lo = Math.min(...values), hi = Math.max(...values);
  return values.filter(v => v >= lo + (hi - lo) / 2).length / n / crests;
};

describe('beat-snap math', () => {
  it('snaps start and length to whole bars', () => {
    const g = grid(analysis);
    expect(g).toMatchObject({ beatSec: .5, barSec: 2, barOrigin: .25 });
    expect(nearestBar(0, g)).toBe(.25);
    expect(nearestBar(5.1, g)).toBe(4.25);
    expect(snapRangeToBars(5.1, 15.2, g)).toEqual({ start: 4.25, duration: 16, bars: 8 });
    expect(snapRangeToBars(3, .2, g)).toEqual({ start: 2.25, duration: 2, bars: 1 }); // never shorter than a bar
    expect(snapRangeToBars(595, 30, g).start + snapRangeToBars(595, 30, g).duration).toBeLessThanOrEqual(600);
    expect(grid({ bpm: 0 })).toBeNull();
  });

  it('chooses laps of whole beats (whole bars when possible) that tile the clip exactly', () => {
    const g = grid(analysis);
    expect(wholeBeatLap(16, 7, g)).toMatchObject({ lapBeats: 16, cycles: 2, lapSeconds: 8 });  // 4 whole bars
    expect(wholeBeatLap(16, 3.5, g)).toMatchObject({ lapBeats: 8, cycles: 4, lapSeconds: 4 });
    expect(wholeBeatLap(6, 1.2, g)).toMatchObject({ lapBeats: 4, cycles: 3 });                 // ≥ 2 s per lap
    for (const [d, lap] of [[30, 10], [17.5, 3], [64, 2.2], [10, 40]]) {
      const r = wholeBeatLap(d, lap, g);
      expect(Number.isInteger(r.lapBeats)).toBe(true);
      expect(r.cycles * r.lapBeats).toBe(r.totalBeats);                  // seamless: whole laps fill the clip
      expect(r.cycles).toBeLessThanOrEqual(32);
      expect(snapCycles(d, r.lapSeconds).cycles).toBe(r.cycles);        // the builder's own snap agrees
    }
  });

  it('Sync to music: wave on bars with a seamless whole-bar lap', () => {
    const { options, info } = syncPatternOptions('wave', { start: 1, duration: 29, lapSeconds: 7, minLevel: 35, maxLevel: 100 }, analysis, { members: 8 });
    expect(options.start).toBe(.25);
    expect(options.duration).toBe(30);
    expect(options.sync).toMatchObject({ bpm: 120, lapBeats: 12 });
    expect(info.label).toBe('lap 3 bars');
    expect(options.duration / options.lapSeconds).toBe(info.cycles);
  });

  it('Chase hits land on beats and each jet stays on ≥ 1 s', () => {
    const { options, info } = syncPatternOptions('chase', { start: 0, duration: 16, lapSeconds: 6, minLevel: 15, maxLevel: 100, crests: 1, order: 'clockwise' }, analysis, { members: 8 });
    expect(options.sync.stepBeats).toBe(2);                 // 1 beat (0.5 s) would flicker the valves
    expect(info.label).toBe('step 2 beats');
    const unit = buildPatternUnit(readStudio({}), { preset: 'chase', options, group: water, items });
    const recipe = unit.recipes[0];
    expect(halfWidth(recipe.envelope) * recipe.duration / recipe.cycles).toBeGreaterThanOrEqual(MIN_ON_S - .05);
    const { clips, issues } = compileStudio(unit.studio, items);
    expect(issues).toEqual([]);
    // Peak of every jet's first hit is on a beat.
    const order = [...new Set(clips.map(c => c.fixtureId))];
    for (const id of order) {
      const own = clips.filter(c => c.fixtureId === id && c.startTime < options.start + recipe.duration / recipe.cycles);
      const peak = own.reduce((a, b) => (b.value > a.value ? b : a));
      const t = peak.startTime - .25;
      expect(Math.abs(t / .5 - Math.round(t / .5)) * .5).toBeLessThanOrEqual(.11);
    }
  });

  it('Pulse hits every bar with on/off times ≥ 1 s; Sparkle hits on beats in a shuffled order', () => {
    const pulse = syncPatternOptions('pulse', { start: 0, duration: 20, lapSeconds: 1, minLevel: 20, maxLevel: 100 }, analysis, { members: 8 });
    expect(pulse.options.sync.hitBeats).toBe(4);
    const unit = buildPatternUnit(readStudio({}), { preset: 'pulse', options: pulse.options, group: water, items });
    const r = unit.recipes[0];
    const hit = r.duration / r.cycles / (pulse.options.crests || 1);
    const on = halfWidth(r.envelope, pulse.options.crests || 1) * r.duration / r.cycles;
    expect(on).toBeGreaterThanOrEqual(MIN_ON_S - .05);
    expect(hit - on).toBeGreaterThanOrEqual(MIN_OFF_S - .05);
    expect(r.spread).toBe(0);

    const sparkle = syncPatternOptions('sparkle', { start: 0, duration: 32, lapSeconds: 2, maxLevel: 100, minLevel: 0 }, analysis, { members: 8 });
    const s = buildPatternUnit(readStudio({}), { preset: 'sparkle', options: sparkle.options, group: water, items }).recipes[0];
    expect(s.effect).toBe('curve');
    expect([...s.frozenIds].sort()).toEqual(resolveMembers(water, items).sort());
    expect(s.frozenIds).not.toEqual(resolveMembers(water, items));
  });
});

describe('Fill the song', () => {
  const studio = readStudio({});
  const result = fillSong(studio, { analysis: song, items, waterGroup: water, lightGroup: lights });
  const next = result.studio;
  const byGroup = new Map(next.groups.map(g => [g.id, g]));

  it('lays a calm → wave → chase/mirror → wave → fade plan over the detected sections', () => {
    expect(result.markers.map(m => m.name)).toEqual(['Intro', 'Verse', 'Chorus', 'Verse', 'Outro']);
    expect(result.markers.every(m => m.kind === 'section')).toBe(true);
    const water = result.recipes.filter(r => r.pattern.role === 'water' && r.pattern.section !== 'accent');
    const bySection = section => [...new Set(water.filter(r => r.pattern.section === section).map(r => r.pattern.preset))];
    expect(bySection('intro')).toEqual(['breathing']);
    expect(bySection('verse')).toEqual(['wave']);
    expect(bySection('chorus').sort()).toEqual(['chase', 'mirror']);
    const outro = water.filter(r => r.pattern.section === 'outro');
    expect(outro.at(-1).pattern.options.fade).toBe('out');
    expect(outro.at(-1).envelope.at(-1).value).toBe(0);
    // Intensity follows the energy: chorus > verse > intro.
    const level = section => Math.max(...water.filter(r => r.pattern.section === section).map(r => r.intensity));
    expect(level('chorus')).toBeGreaterThan(level('verse'));
    expect(level('verse')).toBeGreaterThan(level('intro'));
    // Ripple accents on chorus downbeats, on their own lane.
    const accents = result.recipes.filter(r => r.pattern.section === 'accent');
    expect(accents.length).toBeGreaterThanOrEqual(1);
    for (const a of accents) {
      expect(a.pattern.preset).toBe('ripple');
      expect(Math.abs(((a.start - song.downbeats[0]) / 2) - Math.round((a.start - song.downbeats[0]) / 2))).toBeLessThan(.01);
      expect(byGroup.get(a.groupId).name).toMatch(/accents/);
    }
    expect(next.tempo).toEqual([{ time: expect.any(Number), bpm: 120 }]);
    expect(result.warning).toBeUndefined();
  });

  it('produces valid, editable recipes with no overlaps and no sub-second valve flicker', () => {
    const { issues, clips } = compileStudio(next, items);
    expect(issues).toEqual([]);
    expect(clips.length).toBeGreaterThan(0);
    for (const r of result.recipes) {
      expect(r.duration).toBeGreaterThanOrEqual(2);
      expect(r.duration / r.cycles).toBeGreaterThanOrEqual(MIN_ON_S + MIN_OFF_S - 1e-6);
      expect(Number.isInteger(r.cycles)).toBe(true);
      expect(r.pattern).toMatchObject({ id: expect.any(String), fill: result.fillId });
      expect(r.start + r.duration).toBeLessThanOrEqual(64.001);
    }
    // Per fixture, the base water / light patterns never overlap (accents have their own lane).
    const intervals = new Map();
    for (const r of result.recipes.filter(x => x.pattern.section !== 'accent')) {
      for (const id of resolveMembers(byGroup.get(r.groupId), items)) {
        const key = `${id}:${r.pattern.role}`;
        if (!intervals.has(key)) intervals.set(key, []);
        intervals.get(key).push([r.start, r.start + r.duration]);
      }
    }
    for (const list of intervals.values()) {
      list.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < list.length; i++) expect(list[i][0]).toBeGreaterThanOrEqual(list[i - 1][1] - 1e-3);
    }
    // The water covers the whole song without gaps.
    const jet = intervals.get('jet-1:water');
    expect(jet[0][0]).toBe(0);
    expect(jet.at(-1)[1]).toBeCloseTo(64, 2);
  });

  it('a second fill replaces the first (no duplicates, tidy groups)', () => {
    const again = fillSong(next, { analysis: song, items, waterGroup: water, lightGroup: null });
    expect(again.studio.recipes.filter(r => r.pattern?.fill === result.fillId)).toHaveLength(0);
    expect(again.studio.markers).toHaveLength(5);
    expect(again.studio.recipes.every(r => r.pattern.role === 'water')).toBe(true);
    expect(again.studio.groups.some(g => g.name === 'All lights')).toBe(false);
    expect(() => fillSong(studio, { analysis: { bpm: 0 }, items, waterGroup: water })).toThrow(/beats/);
  });
});
