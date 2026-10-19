import { describe, it, expect } from 'vitest';
import { analyzeSamples, clickTrack } from './musicAnalysis';
import { analyzeStem, drumTrack, toneTrack } from './stemAnalysis';
import { compileStudio, inventory, readStudio } from './showModel';
import { builderGroups } from './patternPresets';
import { designGroups, nozzleKind, readFountainDesign } from './fountainDesign';
import { followHardware, pumpCurve, valveSpans } from './hardwareFollow';
import { FAMOUS_PATTERNS, famousFor } from './famousPatterns';
import { designRows, fitToControl, patternsFromMusic } from './musicPatterns';
import { sourceById } from './stemProgram';
import { checkPlcLimits, clipsForPlc, nozzleLinks } from './plcLimits';

// A ring of 16 straight jets, each with its own solenoid and light; pump A feeds jets 0–7,
// pump B jets 8–15 and two rotating baskets in the middle that have no valves.
const ring = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * 2 * Math.PI;
  return { i, x: Math.round(8 * Math.cos(a) * 1000) / 1000, y: Math.round(5 * Math.sin(a) * 1000) / 1000, pump: i < 8 ? 'pumpA' : 'pumpB' };
});
const fixtures = [
  ...ring.map(j => ({ id: `jet${j.i}`, type: 'nozzle_straight_dn25', label: `Perimeter Jet ${j.i}`, x: j.x, y: j.y, zone: 'perimeter',
    engineering: { jetHeightM: 4, solenoidValveId: `valve${j.i}`, pumpId: j.pump } })),
  ...ring.map(j => ({ id: `valve${j.i}`, type: 'valve_solenoid_dn25_24v', label: `Valve ${j.i}`, x: j.x, y: j.y, zone: 'perimeter',
    engineering: { controlledFixtureId: `jet${j.i}`, pumpId: j.pump } })),
  ...ring.map(j => ({ id: `light${j.i}`, type: 'light_uw_rgb_18w', label: `Light ${j.i}`, x: j.x, y: j.y, engineering: { pairedNozzleId: `jet${j.i}` } })),
  ...[-0.6, 0.6].map((x, k) => ({ id: `basket${k}`, type: 'rotating_jet', label: `Center Rotating Basket ${k}`, x, y: 0, zone: 'centre',
    engineering: { jetHeightM: 8, nozzleStyle: 'Rotating Basket', pumpId: 'pumpB' } })),
  { id: 'pumpA', type: 'pump_inline_vfd_pump_18_5kw', label: 'Pump A - 18.5 kW', x: -12, y: 0, engineering: { powerKw: 18.5, servesValveIds: ring.slice(0, 8).map(j => `valve${j.i}`) } },
  { id: 'pumpB', type: 'pump_inline_vfd_pump_18_5kw', label: 'Pump B - 18.5 kW', x: 12, y: 0, engineering: { powerKw: 18.5, servesValveIds: ring.slice(8).map(j => `valve${j.i}`) } },
];
const items = inventory(fixtures);
const design = readFountainDesign(items);

const bpm = 120, seconds = 64, rate = 22050;
const song = analyzeSamples(clickTrack({ bpm, bars: 32, rate: 11025, level: bar => (bar >= 16 ? 1 : 0.35) }), 11025).analysis;
const kicks = Array.from({ length: seconds * 2 }, (_, i) => i * 0.5);
const stems = [
  { role: 'drums', analysis: analyzeStem(drumTrack({ seconds, rate, kicks, hats: kicks.map(k => k + 0.25) }), rate, 'drums') },
  { role: 'vocals', analysis: analyzeStem(toneTrack({ seconds, rate, on: t => t < 30 || t > 34 }), rate, 'vocals') },
];

describe('reading the fountain design', () => {
  it('knows nozzles, solenoids, pumps and lights and how they connect', () => {
    expect(design.nozzles).toHaveLength(18);
    expect(design.valves.size).toBe(16);
    expect(design.pumps.size).toBe(2);
    expect(design.lights).toHaveLength(16);
    const jet = design.nozzleById.get('jet3');
    expect(jet).toMatchObject({ kind: 'jet', valveId: 'valve3', pumpId: 'pumpA', control: 'switch' });
    expect(jet.lightIds).toEqual(['light3']);
    // Baskets: no valve, on a pump shared with 8 jets → they only move with that pump.
    expect(design.nozzleById.get('basket0')).toMatchObject({ kind: 'basket', pumpId: 'pumpB', control: 'pump', valveId: null });
    expect(design.pumps.get('pumpB').nozzleIds).toHaveLength(10);
  });

  it('names nozzle kinds from type, name and style', () => {
    expect(nozzleKind({ type: 'rotating_jet', label: 'x', engineering: { nozzleStyle: 'Rotating Basket' } }).id).toBe('basket');
    expect(nozzleKind({ type: 'nozzle_foam_dn40', label: 'Foam geyser' }).id).toBe('geyser');
    expect(nozzleKind({ type: 'nozzle_x', label: 'Super shooter 1' }).id).toBe('shooter');
    expect(nozzleKind({ type: 'nozzle_x', label: 'Ring of fountains', tracks: [{ type: 'motion_pan' }] }).id).toBe('swing');
    expect(nozzleKind({ type: 'nozzle_straight_dn25', label: 'Perimeter Straight Jet' }).id).toBe('jet');
  });

  it('splits the fountain into areas by where the jets stand, keeping a centre piece whole', () => {
    const byPos = Object.fromEntries(design.areas.map(a => [a.position, a]));
    expect(Object.keys(byPos).sort()).toEqual(['back', 'centre', 'front', 'left', 'right']);
    expect(byPos.centre).toMatchObject({ kind: 'basket', size: 2, control: 'pump', name: 'Centre · rotating baskets' });
    expect(byPos.left.control).toBe('switch');
    expect(design.areas.reduce((s, a) => s + a.size, 0)).toBe(18);
    // Every light belongs to its jet's area.
    expect(design.areas.reduce((s, a) => s + a.lightIds.length, 0)).toBe(16);
    expect(byPos.centre.summary).toMatch(/rise and fall together with their pump · fed by Pump B/);
    expect(design.tips.join(' ')).toMatch(/share Pump B with 8 other jets/);
    const groups = designGroups(design);
    expect(groups.filter(g => g.id.endsWith(':lights'))).toHaveLength(4);
  });
});

describe('following the real valves and pumps', () => {
  it('keeps valve minimum on and off times', () => {
    const open = new Uint8Array(100);
    for (const i of [10, 11, 13, 14, 50, 51]) open[i] = 1;     // 0.2 s, a 0.1 s gap, then 0.2 s
    expect(valveSpans(open)).toEqual([[1, 2.3], [5, 6]]);     // 1 s minimum on; the 0.1 s gap stays open
  });

  it('ramps a pump early enough and slowly down, and stops it when nothing is open', () => {
    const target = new Float32Array(60), running = new Uint8Array(60);
    for (let i = 0; i < 40; i++) running[i] = 1;
    for (let i = 25; i < 35; i++) target[i] = 100;
    const x = pumpCurve(target, running);
    expect(x[25]).toBeCloseTo(100);            // already at speed when the jets need it
    expect(x[15]).toBeGreaterThan(0);          // ramping up before
    expect(x[36]).toBeGreaterThan(80);         // and down slowly
    expect(x[45]).toBe(0);                     // every outlet closed → stopped
    // It cannot ramp before an outlet opens: opened 1 s ahead, it is part-way up.
    const late = new Uint8Array(60);
    for (let i = 15; i < 40; i++) late[i] = 1;
    expect(pumpCurve(target, late)[25]).toBeLessThan(100);
  });

  it('turns jet patterns into valve and pump clips and shows the water as built', () => {
    const jets = ring.slice(0, 8).map(j => `jet${j.i}`);
    const clips = jets.map((id, k) => ({ id: `r1:${id}`, studioRecipeId: 'r1', fixtureId: id, type: 'pump_speed', trackId: `${id}-t`,
      startTime: 0, duration: 8, value: 90, keys: [0, 0, k * 0.5, 0, k * 0.5 + 0.5, 90, k * 0.5 + 2, 90, k * 0.5 + 2.5, 0, 8, 0] }));
    const out = followHardware(clips, items, new Map([['r1', 'hits']]), design);
    const valves = out.clips.filter(c => c.type === 'solenoid_open');
    expect(new Set(valves.map(c => c.fixtureId)).size).toBe(8);
    expect(valves.every(c => c.duration >= 1)).toBe(true);
    const pump = out.clips.filter(c => c.fixtureId === 'pumpA');
    expect(pump.length).toBeGreaterThan(0);
    expect(Math.max(...pump.map(c => c.value))).toBeGreaterThan(80);
    expect(out.clips.filter(c => c.asBuilt)).toHaveLength(8);
  });
});

describe('world-famous looks', () => {
  it('only offers looks an area can perform', () => {
    const centre = design.areas.find(a => a.position === 'centre'), left = design.areas.find(a => a.position === 'left');
    expect(famousFor(sourceById('vocals:melody'), centre).id).toBe('grand-swell');     // pump-only jets breathe together
    const kickLooks = new Set([0, 1, 2, 3, 4].map(turn => famousFor(sourceById('drums:kicks'), { ...left, size: 12 }, { turn, eRel: 0.9 })?.id));
    expect([...kickLooks].every(id => FAMOUS_PATTERNS.find(f => f.id === id).controls.includes('switch'))).toBe(true);
    expect(famousFor(sourceById('drums:hats'), { ...left, size: 12 }, { finale: true }).id).toBe('grand-finale');
    expect(FAMOUS_PATTERNS.length).toBeGreaterThanOrEqual(12);
  });

  it('keeps solenoid hits slow enough for the valves and pump-only jets together', () => {
    expect(fitToControl({ preset: 'pulse', lapSeconds: 0.5, minLevel: 5, maxLevel: 90 }, 'switch', { beatSec: 0.5, barSec: 2 }).lapSeconds).toBeGreaterThanOrEqual(2.2);
    expect(fitToControl({ preset: 'chase', lapSeconds: 2, minLevel: 0, maxLevel: 90 }, 'pump', { beatSec: 0.5, barSec: 2 })).toMatchObject({ preset: 'breathing', lapSeconds: 4 });
  });
});

describe('patterns from the music on the fountain design', () => {
  it('gives every area a part, its lights follow, left and right mirror', () => {
    const rows = designRows(design, stems);
    const water = rows.filter(r => r.kind === 'water');
    expect(water).toHaveLength(design.areas.length);
    const pos = id => design.areas.find(a => a.id === id).position;
    expect(water.find(r => pos(r.groupId) === 'centre').sourceId).toBe('vocals:melody');
    expect(water.find(r => pos(r.groupId) === 'left').sourceId).toBe(water.find(r => pos(r.groupId) === 'right').sourceId);
    expect(rows.filter(r => r.kind === 'lights').every(r => r.follows)).toBe(true);
  });

  it('drives every jet, valve, pump and light; the PLC gets the valves and pumps', () => {
    const base = readStudio({});
    const held = { ...base, groups: [{ id: 'valves', name: 'All valves', memberFixtureIds: ring.map(j => `valve${j.i}`) }],
      recipes: [{ id: 'hold', version: 1, groupId: 'valves', name: 'Valves open', effect: 'static', start: 0, duration: 60, cycles: 1, spread: 0, intensity: 100 }] };
    const groups = [...designGroups(design), ...builderGroups(held, items)];
    const out = patternsFromMusic(held, { analysis: song, stems, rows: designRows(design, stems), items, groups, design });
    expect(out.muted).toBe(1);                                         // "valves open all show" would fight the music
    expect(out.studio.recipes.find(r => r.id === 'hold').muted).toBe(true);
    expect(out.counts['Famous looks']).toBeGreaterThan(0);
    expect(out.recipes.some(r => r.hardware === 'hits')).toBe(true);
    const { clips, issues } = compileStudio(out.studio, items);
    expect(issues).toEqual([]);
    const driven = new Set(clips.map(c => c.fixtureId));
    expect(fixtures.every(f => driven.has(f.id))).toBe(true);
    // PLC: solenoid jets reach it through their valves only; valve-less baskets open their implied valves.
    const site = { channels: [
      ...ring.map(j => ({ id: `valve${j.i}`, kind: 'valve', name: `Valve ${j.i}`, min_on_ms: 1000, min_off_ms: 1000, nozzle_ids: [`jet${j.i}`], pump_id: j.pump })),
      ...[0, 1].map(k => ({ id: `basket${k}-valve`, kind: 'valve', name: `Basket ${k} valve`, min_on_ms: 1000, min_off_ms: 1000, nozzle_ids: [`basket${k}`], pump_id: 'pumpB' })),
      { id: 'pumpA', kind: 'pump', name: 'Pump A', max_percent: 100 }, { id: 'pumpB', kind: 'pump', name: 'Pump B', max_percent: 100 },
      ...ring.map(j => ({ id: `light${j.i}`, kind: 'light', name: `Light ${j.i}` })) ] };
    const plc = clipsForPlc(clips, site, nozzleLinks(items));
    expect(plc.some(c => /^jet/.test(c.fixtureId))).toBe(false);
    expect(plc.some(c => c.fixtureId === 'basket0-valve')).toBe(true);
    const check = checkPlcLimits(plc, site, nozzleLinks(items));
    expect(check.counts.error).toBe(0);
    expect(check.list.filter(x => /closed|minimum/.test(x.text))).toEqual([]);
  });
});
