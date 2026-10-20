import { describe, it, expect } from 'vitest';
import { makeSong, SONGS, SITES } from './evalCorpus';
import { runCase, siteContext } from './showGenerators';
import { buildSiteModel, windScale, DEFAULT_WIND } from './siteCapability';
import { arcSections, planShow, climaxIndex } from './arcPlanner';
import { searchPhrases } from './phraseSearch';
import { applyMeter, tapTempo } from './musicMeter';
import { createShow, toggleLock } from './autoShow';
import { lookById } from './lookLibrary';
import { songPalette } from './lightScript';

const ring = siteContext(SITES.ring().fixtures);
const line = siteContext(SITES.line().fixtures);
const pop = makeSong(SONGS.pop);
const six = makeSong(SONGS.sixEight);

describe('site capability model', () => {
  it('knows sources, coupling, layers, mirror areas, limits and wind', () => {
    const scm = buildSiteModel(ring.items, { design: ring.design });
    expect(scm.sources).toHaveLength(2);
    expect(scm.sources.find((s) => s.id === 'pB').freeOutlets).toEqual(['b0', 'b1']);
    const basket = scm.outputs.find((o) => o.id === 'b0');
    expect(basket).toMatchObject({ family: 'basket', actuator: 'shared_pump', role: { default: 'melody' } });
    expect(basket.coupledWith).toEqual(['b1']);
    expect(scm.outputs.find((o) => o.id === 'j3').limits).toMatchObject({ minOnS: 1, minOffS: 1 });
    expect(scm.areas.find((a) => a.position === 'centre').coupled).toBe(true);
    const left = scm.areas.find((a) => a.position === 'left');
    expect(scm.areas.find((a) => a.id === left.mirrorArea)?.position).toBe('right');
    expect(scm.front.source).toBe('axis');                          // 16 × 10 m layout → audience on the long side
    expect(buildSiteModel(ring.items, { design: ring.design, overrides: { front: { vector: [1, 0] } } }).front.source).toBe('user');
    expect(windScale(DEFAULT_WIND, 0)).toBe(1);
    expect(windScale(DEFAULT_WIND, 9)).toBe(0.4);
    expect(buildSiteModel(ring.items, { design: ring.design, overrides: { windMs: 11 } }).heightScale).toBe(0);
  });

  it('casts a lake front: swing nozzles sing, shooters are heroes, mist is ambient', () => {
    const scm = buildSiteModel(line.items, { design: line.design });
    const role = (fam) => scm.areas.find((a) => a.family === fam)?.role;
    expect(role('swing')).toBe('melody');
    expect(role('shooter')).toBe('accent');
    expect(role('mist')).toBe('ambient');
    expect(scm.areas.find((a) => a.family === 'shooter').hero).toBe(true);
  });
});

describe('meter', () => {
  it('feels 6/8 in dotted quarters and lets the user nudge, shift and tap', () => {
    const a = applyMeter(six.analysis, { beatsPerBar: 6, pulse: 'dotted' });
    expect(a.beatsPerBar).toBe(2);
    expect(a.bpm).toBeCloseTo(six.analysis.bpm / 3, 1);
    expect(a.beats.length).toBeLessThan(six.analysis.beats.length / 2.5);
    const n = applyMeter(pop.analysis, { nudgeS: 0.04 });
    expect(n.beats[1] - pop.analysis.beats[1]).toBeCloseTo(0.04, 3);
    const shifted = applyMeter(pop.analysis, { downbeat: 1 });
    expect(shifted.downbeats[0]).not.toBe(pop.analysis.downbeats[0]);
    expect(tapTempo([0, 0.5, 1, 1.5, 2])).toBe(120);
    expect(tapTempo([0, 0.5])).toBeNull();
  });
});

describe('show-arc plan', () => {
  it('peaks at the loudest section, dips before it and keeps quiet parts quiet', () => {
    const scm = buildSiteModel(ring.items, { design: ring.design });
    const plan = planShow({ analysis: pop.analysis, stems: pop.stems, scm });
    const roles = plan.sections.map((s) => s.role);
    const ci = roles.indexOf('climax');
    expect(ci).toBe(climaxIndex(arcSections(pop.analysis).map((s) => s.energy)));
    expect(plan.sections[ci].targets.coverage).toBe(1);
    // A dip before the climax unless the section before is already quiet (a bridge / rest).
    if (['rest', 'intro'].includes(roles[ci - 1])) expect(plan.sections[ci].contrastBefore).toBeNull();
    else expect(plan.sections[ci].contrastBefore).toMatchObject({ bars: 1 });
    const edm = planShow({ analysis: makeSong(SONGS.edm).analysis, scm });
    expect(edm.sections.some((x) => x.contrastBefore) || edm.sections.some((x, i) => x.role === 'climax' && ['rest', 'intro'].includes(edm.sections[i - 1]?.role))).toBe(true);
    expect(roles[0]).toBe('intro');
    const intro = plan.sections[0], climax = plan.sections[ci];
    expect(intro.active.length).toBeLessThan(climax.active.length);
    expect(climax.light.white).toBe(true);
    expect(plan.palette.base).toMatch(/^#/);
    expect(songPalette(pop.analysis, 1).base).not.toBe(songPalette(pop.analysis, 0).base);
  });

  it('chooses looks the areas can perform, keeps locks and gives other variants', () => {
    const scm = buildSiteModel(ring.items, { design: ring.design });
    const plan = planShow({ analysis: pop.analysis, stems: pop.stems, scm });
    const t0 = Date.now();
    const a = searchPhrases(plan, { analysis: pop.analysis, stems: pop.stems, scm });
    expect(Date.now() - t0).toBeLessThan(1000);
    const voices = a.sections.flatMap((s) => s.phrases.flatMap((p) => p.voices));
    const centre = scm.areas.find((x) => x.position === 'centre').id;
    expect(voices.filter((v) => v.areaId === centre).every((v) => ['breathing', 'grand-swell'].includes(v.look))).toBe(true);
    expect(voices.every((v) => lookById(v.look).controls.includes(scm.areas.find((x) => x.id === v.areaId).control))).toBe(true);
    const looks = new Set(voices.map((v) => v.look));
    expect(looks.size).toBeGreaterThanOrEqual(4);
    const b = searchPhrases(plan, { analysis: pop.analysis, stems: pop.stems, scm, variant: 1 });
    const sig = (p) => p.sections.flatMap((s) => s.phrases.flatMap((x) => x.voices.map((v) => v.look))).join();
    expect(sig(b)).not.toBe(sig(a));
    // Lock one voice to a different look: it is kept.
    const s = a.sections.find((x) => x.phrases.length && x.phrases[0].voices.some((v) => v.areaId !== centre));
    const v = s.phrases[0].voices.find((x) => x.areaId !== centre);
    const locks = { [`${s.id}:0:${v.areaId}`]: 'sparkle' };
    const c = searchPhrases(plan, { analysis: pop.analysis, stems: pop.stems, scm, locks });
    expect(c.sections.find((x) => x.id === s.id).phrases[0].voices.find((x) => x.areaId === v.areaId)).toMatchObject({ look: 'sparkle', locked: true });
  });
});

describe('automatic show', () => {
  it('beats the 1.2.52 rules on the ring site and passes every hard gate', () => {
    const plan = runCase('plan-v1', ring, pop), rules = runCase('rules-1.2.52', ring, pop);
    expect(plan.pass).toBe(true);
    expect(plan.issues).toEqual([]);
    expect(plan.score).toBeGreaterThan(rules.score);
    expect(plan.metrics.arcFidelity).toBeGreaterThan(0.8);
    expect(plan.detail.switchedActiveClimax).toBeGreaterThanOrEqual(0.6);
  });

  it('works without stems, in 6/8, and stores a plan that can be locked', () => {
    const out = createShow(ring.studio, { analysis: six.analysis, items: ring.items, groups: ring.groups, design: ring.design, meter: { beatsPerBar: 6, pulse: 'dotted' } });
    expect(out.recipes.length).toBeGreaterThan(5);
    expect(out.studio.plan.analysis.beatsPerBar).toBe(2);
    const s = out.plan.sections[0], v = s.phrases[0].voices[0];
    const locked = toggleLock(out.plan, s.id, 0, v.areaId);
    expect(locked.locks[`${s.id}:0:${v.areaId}`]).toBe(v.look);
    expect(toggleLock(locked, s.id, 0, v.areaId).locks).toEqual({});
    // Lights follow every area that has lights.
    expect(out.recipes.some((r) => r.pattern?.role === 'lights')).toBe(true);
  });
});
