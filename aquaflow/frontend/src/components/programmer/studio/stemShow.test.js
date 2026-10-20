import { describe, it, expect } from 'vitest';
import { makeSong, SONGS, SITES } from './evalCorpus';
import { siteContext } from './showGenerators';
import { readStudio, compileStudio } from './showModel';
import { availableSources, songStem } from './stemProgram';
import { lookById } from './lookLibrary';
import { canPerform } from './phraseSearch';
import { musicGain } from './wavePatterns';
import { measureShow } from './showMetrics';
import { STEM_LOOK_FAMILIES, nameRows, stemShow } from './stemShow';

const song = makeSong(SONGS.pop);
const fixtures = SITES.ring().fixtures;
const jets = (pick) => fixtures.filter((f) => /^j\d+$/.test(f.id) && pick(Number(f.id.slice(1)))).map((f) => f.id);
const studio0 = { ...readStudio({}), groups: [
  { id: 'g-bass', name: 'Group 1 · Bass', memberFixtureIds: jets((i) => i % 2 === 0), orderMode: 'engineering', color: '#2f6bff' },
  { id: 'g-drums', name: 'Group 2 · Drums', memberFixtureIds: jets((i) => i % 4 === 1), orderMode: 'engineering', color: '#35d0c0' },
  { id: 'g-song', name: 'Group 3 · Song', memberFixtureIds: jets((i) => i % 4 === 3), orderMode: 'engineering', color: '#ffb347' },
  { id: 'g-front-lights', name: 'Front lights', memberFixtureIds: ['l0', 'l1', 'l2', 'l3'], orderMode: 'clockwise', color: '#f5c86b' },
] };
const site = siteContext(fixtures, studio0);
const water = site.groups.filter((g) => ['g-bass', 'g-drums', 'g-song'].includes(g.id));
const sources = availableSources([...song.stems, songStem(song.analysis)]);
const links = nameRows(sources, water);
const run = (studio = site.studio, extra = {}) => stemShow(studio, { analysis: song.analysis, stems: song.stems, links, items: site.items, groups: site.groups, design: site.design, ...extra });
const fields = (out, groupId) => out.studio.recipes.filter((r) => r.pattern?.group === groupId && r.effect === 'field' && r.pattern?.role !== 'lights');
const noIds = (recipes) => JSON.stringify(recipes).replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|-\d{10,}-[a-z0-9]+/g, '');

describe('water follows its stem', () => {
  it('offers the whole song as a part and links groups by their names', () => {
    expect(sources.some((s) => s.id === 'mix' && s.label === 'Song')).toBe(true);
    expect(availableSources(song.stems).some((s) => s.id === 'mix')).toBe(false);
    expect(links.map((r) => `${r.sourceId}→${r.groupId}`)).toEqual(['bass→g-bass', 'mix→g-song', 'drums:kicks→g-drums']);
    expect(links.find((r) => r.sourceId === 'mix').min).toBe(Math.round(100 * STEM_LOOK_FAMILIES.song.floor));
    for (const fam of Object.values(STEM_LOOK_FAMILIES)) for (const id of [...fam.looks, fam.finale].filter(Boolean)) expect(lookById(id), id).toBeTruthy();
  });

  it('every linked group plays its own family across the whole song, shaped by its own stem', () => {
    const t0 = Date.now();
    const out = run();
    expect(Date.now() - t0).toBeLessThan(2000);
    const end = song.analysis.duration;
    for (const { sourceId, groupId } of links) {
      const list = fields(out, groupId);
      expect(list.length, groupId).toBeGreaterThan(3);
      expect(Math.min(...list.map((r) => r.start))).toBeLessThan(0.1 * end);
      expect(Math.max(...list.map((r) => r.start + r.duration))).toBeGreaterThan(0.9 * end);
      for (const r of list) {
        expect(r.field.music.source).toBe(sourceId);
        expect(r.field.music.rate).toBe(10);
        expect(r.field.music.values.length).toBe(Math.ceil(r.duration * 10) + 1);
        expect(r.field.music.values.every((v) => v >= 0 && v <= 1)).toBe(true);
      }
    }
    // Looks come from each part's family and fit the group's hardware.
    const area = (id) => out.plan.sections[0].phrases[0].voices.find((v) => v.areaId === id);
    expect(STEM_LOOK_FAMILIES.bass.looks).toContain(area('g-bass').look);
    for (const s of out.plan.sections) for (const p of s.phrases) for (const v of p.voices) {
      const size = water.find((g) => g.id === v.areaId).memberFixtureIds.length;
      expect(canPerform(lookById(v.look), { control: 'switch', size }), v.look).toBe(true);
    }
    expect(out.summary.follows.map((f) => f.waves).every((n) => n > 3)).toBe(true);
    expect(out.summary.text).toMatch(/waves follow Bass/);
    // Kicks and bass envelopes differ: each wave follows its own part.
    const bass = fields(out, 'g-bass')[2].field.music.values, kick = fields(out, 'g-drums')[2].field.music.values;
    expect(bass.join()).not.toBe(kick.join());
    // It compiles to a show that passes the hard gates.
    const { clips, issues } = compileStudio(out.studio, site.items);
    expect(issues).toEqual([]);
    expect(measureShow({ clips, items: site.items, analysis: song.analysis, studio: out.studio, design: site.design }).pass).toBe(true);
  });

  it('a silent stem leaves its waves near the floor', () => {
    const stems = song.stems.map((s) => (s.role === 'bass' ? { ...s, analysis: { ...s.analysis, level: s.analysis.level.map(() => 0) } } : s));
    const out = run(site.studio, { stems });
    const list = fields(out, 'g-bass');
    expect(list.length).toBeGreaterThan(3);
    for (const r of list) {
      expect(Math.max(...r.field.music.values)).toBeLessThan(0.01);
      expect(musicGain(r.field.music, r.duration / 2)).toBeCloseTo(r.field.music.floor, 2);
    }
    expect(fields(out, 'g-drums').some((r) => Math.max(...r.field.music.values) > 0.5)).toBe(true);
  });

  it('is deterministic and re-running replaces the show (one Undo removes it)', () => {
    const a = run(), b = run();
    expect(noIds(a.studio.recipes)).toBe(noIds(b.studio.recipes));
    const again = run(a.studio);
    expect(again.studio.recipes.length).toBe(a.studio.recipes.length);
    expect(again.studio.recipes.some((r) => r.pattern?.music === a.fillId)).toBe(false);
    expect(again.studio.recipes.every((r) => r.pattern?.music === again.fillId)).toBe(true);
    expect(again.plan.provenance.planner).toBe('stems');
  });

  it('lights follow: the linked light group, else the largest one', () => {
    const light = (out) => out.studio.recipes.filter((r) => r.pattern?.role === 'lights');
    const auto = run();
    expect(light(auto).length).toBeGreaterThan(4);
    expect(new Set(light(auto).map((r) => r.pattern.group)).size).toBe(1);
    expect(light(auto)[0].pattern.group).not.toBe('g-front-lights');               // the largest: all 24 lights
    expect(light(auto).every((r) => r.effect === 'curve' && r.envelope.length >= 9)).toBe(true);
    const linked = run(site.studio, { links: [...links, { sourceId: 'drums:kicks', groupId: 'g-front-lights', kind: 'lights', min: 10, max: 90 }] });
    const list = light(linked);
    expect(list.every((r) => r.groupId === 'g-front-lights')).toBe(true);
    expect(list.every((r) => r.envelope.every((p) => p.value >= 0.1 - 1e-9 && p.value <= 0.9 + 1e-9))).toBe(true);
    expect(new Set(list.map((r) => r.color)).size).toBeGreaterThan(1);
  });

  it('needs a water link and the beats', () => {
    expect(() => run(site.studio, { links: [] })).toThrow(/Link at least one part/);
    expect(() => stemShow(site.studio, { analysis: {}, stems: [], links, items: site.items, groups: site.groups })).toThrow(/beats/);
  });
});
