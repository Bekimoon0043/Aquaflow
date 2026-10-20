import { describe, it, expect } from 'vitest';
import { mergeDeep, requestDeepAnalysis, songAnalysis, toPcm16Base64 } from './deepAnalysis';
import { makeSong, SONGS, SITES } from './evalCorpus';
import { siteContext } from './showGenerators';
import { buildSiteModel } from './siteCapability';
import { planShow } from './arcPlanner';
import { songPalette } from './lightScript';

const pop = makeSong(SONGS.pop);
const bar = 2;   // 120 BPM, 4/4
const deep = {
  version: 1,
  sections: [{ start: 0, end: 16, group: 'A', bars: 8 }, { start: 16, end: 48, group: 'B', bars: 16 }, { start: 48, end: 80, group: 'C', bars: 16 },
    { start: 80, end: 112, group: 'B', bars: 16 }, { start: 112, end: 160, group: 'C', bars: 24 }, { start: 160, end: pop.analysis.duration, group: 'A', bars: 8 }],
  energy: pop.analysis.energy, drops: [{ time: 48, strength: 1.5 }], builds: [{ start: 40, end: 48, bars: 4 }],
  mood: { arousal: 0.8, valence: 0.2, key: 'A minor', keyStrength: 0.7 }, vocalPhrases: [{ start: 20, end: 30 }], loudness: { integratedDb: -14 },
};

describe('deep analysis', () => {
  it('sends int16 PCM and polls the engine job', async () => {
    const b64 = toPcm16Base64(new Float32Array([0, 0.5, -1, 1]));
    const back = new Int16Array(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
    expect(Array.from(back)).toEqual([0, 16384, -32767, 32767]);
    const calls = [];
    const result = await requestDeepAnalysis({ name: 'x.mp3' }, pop.analysis, {
      decode: async () => ({ samples: new Float32Array(11025), rate: 11025 }),
      post: async (path, body) => { calls.push([path, body.rate, body.bpm, body.beats.length]); return { job_id: 'j1', status: 'queued' }; },
      get: async () => ({ job_id: 'j1', status: 'done', result: deep }),
      pollMs: 1,
    });
    expect(result).toBe(deep);
    expect(calls[0]).toEqual(['/music/deep', 11025, pop.analysis.bpm, pop.analysis.beats.length]);
  });

  it('merges sections with repeat groups, drops and mood, keeping the browser grid', () => {
    const m = mergeDeep(pop.analysis, deep);
    expect(m.sections.map((s) => s.label)).toEqual(['A', 'B', 'C', 'B', 'C', 'A']);
    expect(m.beats).toBe(pop.analysis.beats);
    expect(m.drops).toHaveLength(1);
    expect(songAnalysis({ ...pop.analysis, deep }).mood.key).toBe('A minor');
    expect(songAnalysis(pop.analysis)).toBe(pop.analysis);
  });

  it('lands drops, builds up to them, links repeats and colours from the mood', () => {
    const ring = siteContext(SITES.ring().fixtures);
    const scm = buildSiteModel(ring.items, { design: ring.design });
    const plan = planShow({ analysis: mergeDeep(pop.analysis, deep), stems: pop.stems, scm });
    const atDrop = plan.sections.find((s) => Math.abs(s.start - 48) <= bar);
    expect(atDrop.drop).toBe(true);
    expect(['high', 'climax']).toContain(atDrop.role);
    expect(atDrop.hero.budget).toBeGreaterThan(0);
    const before = plan.sections[plan.sections.indexOf(atDrop) - 1];
    expect(['build', 'verse', 'intro', 'rest', 'high']).toContain(before.role);
    expect(plan.sections.some((s) => s.repeatOf)).toBe(true);
    expect(songPalette({ ...pop.analysis, mood: deep.mood }).family).toBe('warm');
    expect(songPalette({ ...pop.analysis, mood: { arousal: 0.2, valence: 0.5 } }).family).toBe('calm');
  });
});
