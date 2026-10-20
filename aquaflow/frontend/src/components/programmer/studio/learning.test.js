import { describe, it, expect } from 'vitest';
import { emptyPreferences, fitWeights, nudgeLook, preferenceScore, recordChoice, METRIC_KEYS } from './preferences';
import { SCORE_WEIGHTS } from './showMetrics';
import { makeSong, SONGS, SITES } from './evalCorpus';
import { siteContext } from './showGenerators';
import { bestOf, createShow } from './autoShow';
import { buildSiteModel } from './siteCapability';
import { planShow } from './arcPlanner';
import { searchPhrases } from './phraseSearch';
import { applyDirection, describeForDirector, requestDirection } from './directorPlan';

const ring = siteContext(SITES.ring().fixtures);
const pop = makeSong(SONGS.pop);
const base = Object.fromEntries(METRIC_KEYS.map((k) => [k, 0.5]));

describe('learning from the user', () => {
  it('learns which quality the user prefers from A/B choices', () => {
    let prefs = emptyPreferences();
    for (let i = 0; i < 12; i++) prefs = recordChoice(prefs, { ...base, diversity: 0.9, energyTracking: 0.4 }, [{ ...base, diversity: 0.3, energyTracking: 0.6 }]);
    const fit = fitWeights(prefs);
    expect(fit.n).toBe(12);
    expect(fit.weights.diversity).toBeGreaterThan(SCORE_WEIGHTS.diversity);
    expect(fit.accuracy).toBe(1);
    expect(Object.values(fit.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    expect(fitWeights(emptyPreferences()).weights).toEqual(SCORE_WEIGHTS);
    expect(preferenceScore({ ...base, diversity: 1 }, fit.weights)).toBeGreaterThan(preferenceScore({ ...base, diversity: 1 }));
  });

  it('locked looks gain favour, deleted ones lose it, within bounds', () => {
    let p = emptyPreferences();
    for (let i = 0; i < 10; i++) p = nudgeLook(p, 'stadium-wave', 'lock');
    p = nudgeLook(nudgeLook(p, 'rain', 'delete'), 'rain', 'delete');
    expect(p.lookBias['stadium-wave']).toBe(0.6);
    expect(p.lookBias.rain).toBe(-0.4);
    // The search follows the taste: a strongly disliked look disappears.
    const scm = buildSiteModel(ring.items, { design: ring.design });
    const plan = planShow({ analysis: pop.analysis, stems: pop.stems, scm });
    const looks = (bias) => searchPhrases(plan, { analysis: pop.analysis, stems: pop.stems, scm, lookBias: bias }).sections.flatMap((s) => s.phrases.flatMap((x) => x.voices.map((v) => v.look)));
    const usual = looks({});
    const top = Object.entries(usual.reduce((m, l) => ({ ...m, [l]: (m[l] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0][0];
    expect(looks({ [top]: -5 }).includes(top)).toBe(false);
  });

  it('best of N keeps a show that passes every gate and scores highest', () => {
    const ctx = { analysis: pop.analysis, stems: pop.stems, items: ring.items, groups: ring.groups, design: ring.design };
    const r = bestOf(ring.studio, ctx, { n: 3 });
    expect(r.ranked).toHaveLength(3);
    expect(r.ranked[0].pass).toBe(true);
    expect(r.ranked[0].score).toBeGreaterThanOrEqual(Math.max(...r.ranked.filter((x) => x.pass).map((x) => x.score)));
    expect(r.best.studio.plan.seed).toBe(r.ranked[0].seed);
  });
});

describe('AI director (optional)', () => {
  const scm = buildSiteModel(ring.items, { design: ring.design });
  const plan = planShow({ analysis: pop.analysis, stems: pop.stems, scm });
  const centre = scm.areas.find((a) => a.position === 'centre').id;
  const left = scm.areas.find((a) => a.position === 'left').id;

  it('describes the song and fountain as text with the real ids', async () => {
    const text = describeForDirector(plan, scm, pop.analysis);
    expect(text).toMatch(/SONG: /);
    for (const a of scm.areas) expect(text).toContain(a.id);
    expect(text).toContain('stadium-wave');
    let sent;
    await requestDirection(plan, scm, pop.analysis, { post: async (path, body) => { sent = [path, body]; return {}; } });
    expect(sent[0]).toBe('/director/plan');
    expect(sent[1].sections).toBe(plan.sections.length);
  });

  it('merges a direction: roles, areas, preferred looks, dips and colours; unknown ids are dropped', () => {
    const direction = { summary: 'test', palette: { base: '#111111', second: '#222222', accent: '#333333' }, model: 'claude-opus-5-5',
      sections: [{ index: 1, role: 'rest', areas: [left, 'design:ghost'], looks: ['pulse', 'nope'], hero: false, dipBefore: true, color: '#00ff88', why: 'breathe' }] };
    const p = applyDirection(plan, direction, scm);
    const s = p.sections[1];
    expect(s.role).toBe('rest');
    expect(s.active).toContain(left);
    expect(s.active).not.toContain('design:ghost');
    expect(s.prefer).toEqual(['pulse']);
    expect(s.contrastBefore).toMatchObject({ bars: 1 });
    expect(s.light.hue).toBe('#00ff88');
    expect(p.provenance.planner).toBe('llm');
    expect(p.palette.base).toBe('#111111');
    // The director's choice reaches the show; hard gates still apply in the compiler.
    const out = createShow(ring.studio, { analysis: pop.analysis, stems: pop.stems, items: ring.items, groups: ring.groups, design: ring.design, direction });
    expect(out.plan.provenance.planner).toBe('llm');
    expect(out.plan.sections[1].phrases.flatMap((x) => x.voices).filter((v) => v.areaId === left).some((v) => v.look === 'pulse')).toBe(true);
    expect(out.studio.plan.direction).toBe(direction);
    expect(centre).toBeTruthy();
  });
});
