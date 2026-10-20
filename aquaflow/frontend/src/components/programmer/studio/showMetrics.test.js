import { describe, it, expect } from 'vitest';
import { inventory } from './showModel';
import { readFountainDesign } from './fountainDesign';
import { measureShow, showGates } from './showMetrics';
import { makeSong, SONGS, SITES } from './evalCorpus';
import { runCase, siteContext } from './showGenerators';

const fixtures = SITES.line().fixtures;
const items = inventory(fixtures);
const design = readFountainDesign(items);
const song = makeSong(SONGS.ballad);
const track = (id) => items.find((i) => i.id === id).tracks[0];

/** Every jet at one constant level, or following the song's loudness bar by bar. */
function show(levelAt) {
  const T = song.analysis.duration, clips = [];
  for (const n of design.nozzles) {
    const keys = [];
    for (let t = 0; t <= T; t += 1) keys.push(t, Math.round(levelAt(t)));
    clips.push({ id: `c:${n.id}`, fixtureId: n.id, trackId: track(n.id).id, type: track(n.id).type, startTime: 0, duration: T, value: 100, keys });
  }
  return clips;
}
const loudness = (t) => { const e = song.analysis.energy; return e.values[Math.min(e.values.length - 1, Math.floor(t * e.rate))]; };

describe('show metrics', () => {
  it('fails a show that breaks valve dwell times and light overlaps', () => {
    const clips = [
      { fixtureId: 'v1', type: 'solenoid_open', startTime: 0, duration: 0.4, value: 100 },
      { fixtureId: 'v1', type: 'solenoid_open', startTime: 0.7, duration: 2, value: 100 },
      { fixtureId: 'l1', type: 'lighting_master', startTime: 0, duration: 3, value: 50 },
      { fixtureId: 'l1', type: 'lighting_master', startTime: 2, duration: 3, value: 50 },
    ];
    const g = showGates(clips, design);
    expect(g.pass).toBe(false);
    expect(g.counts).toMatchObject({ 'valve-min-on': 1, 'valve-min-off': 1, 'light-overlap': 1 });
  });

  it('rewards water that follows the music over flat water', () => {
    const follow = measureShow({ clips: show((t) => 20 + 80 * loudness(t)), items, analysis: song.analysis, design });
    const flat = measureShow({ clips: show(() => 60), items, analysis: song.analysis, design });
    expect(follow.pass).toBe(true);
    expect(follow.metrics.energyTracking).toBeGreaterThan(0.6);
    expect(flat.metrics.energyTracking).toBeLessThan(0.2);
    expect(follow.metrics.arcFidelity).toBeGreaterThan(flat.metrics.arcFidelity);
    expect(follow.score).toBeGreaterThan(flat.score);
  });

  it('scores the generator on a corpus case deterministically', () => {
    const site = siteContext(SITES.ring().fixtures);
    const a = runCase('rules-1.2.52', site, song), b = runCase('rules-1.2.52', site, song);
    expect(a.pass).toBe(true);
    expect(a.score).toBe(b.score);
    expect(a.score).toBeGreaterThan(50);
    expect(Object.keys(a.metrics)).toHaveLength(8);
  });
});
