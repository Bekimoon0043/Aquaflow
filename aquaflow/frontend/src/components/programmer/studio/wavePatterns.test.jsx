// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { useICANPreviewStore } from '../../../store/icanPreviewStore';
import { evaluateShowFrameAt } from '../../../show/evaluateShowFrame';
import PreviewShowTimeline from './PreviewShowTimeline';
import { compileStudio, inventory, readStudio } from './showModel';
import { FIELD_KINDS, defaultField, fieldLevel, memberGeometry, sampleKeys } from './wavePatterns';
import { deleteBlock, duplicateBlock, fieldUnitRecipes, moveBlock, resizeBlock, showBlocks, updateFieldUnit } from './showBlocks';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

const N = 24;
const fixtures = () => [
  ...Array.from({ length: N }, (_, i) => ({ id: `jet-${i}`, label: `Jet ${i}`, type: 'nozzle_straight_dn25',
    x: 10 + 4 * Math.cos((2 * Math.PI * i) / N), y: 10 + 4 * Math.sin((2 * Math.PI * i) / N), z: 0,
    engineering: { jetHeightM: 2.5, solenoidValveId: `valve-${i}` } })),
  ...Array.from({ length: N }, (_, i) => ({ id: `lamp-${i}`, label: `Lamp ${i}`, type: 'light_uw_rgb_18w',
    x: 10 + 4 * Math.cos((2 * Math.PI * i) / N), y: 10 + 4 * Math.sin((2 * Math.PI * i) / N), z: 0 })),
  ...Array.from({ length: N }, (_, i) => ({ id: `valve-${i}`, label: `Valve ${i}`, type: 'valve_solenoid_dn25_24v', x: 0, y: 0, z: 0 })),
];
const groups = [
  { id: 'jets', name: 'Jets', memberFixtureIds: Array.from({ length: N }, (_, i) => `jet-${i}`), orderMode: 'clockwise', color: '#65d9d0' },
  { id: 'lamps', name: 'Lamps', memberFixtureIds: Array.from({ length: N }, (_, i) => `lamp-${i}`), orderMode: 'clockwise', color: '#f5c86b' },
];
const items = () => inventory(fixtures());
const studioWith = recipes => ({ ...readStudio({ studio: { groups, recipes } }) });
const unit = (kind, extra = {}) => fieldUnitRecipes({ kind, start: 2, duration: 12, waterGroupId: 'jets', lightGroupId: 'lamps', ...extra });

describe('wave-field engine', () => {
  it('every kind stays inside its height range and actually moves', () => {
    const geo = memberGeometry(items().filter(i => i.id.startsWith('jet-')), { origin: 'tip' });
    for (const kind of FIELD_KINDS) {
      const f = defaultField(kind.id);
      const lows = [f.low, f.lowFar ?? f.low], highs = [f.high, f.highFar ?? f.high];
      let lo = 100, hi = 0;
      for (let t = 1.1; t < 11; t += 0.37) for (const g of geo) { const v = fieldLevel(f, g, t, 12); lo = Math.min(lo, v); hi = Math.max(hi, v); }
      expect(lo, kind.id).toBeGreaterThanOrEqual(Math.min(...lows) - 1e-6);
      expect(hi, kind.id).toBeLessThanOrEqual(Math.max(...highs) + 1e-6);
      expect(hi - lo, kind.id).toBeGreaterThan(15);
    }
  });

  it('neighbours differ (a wave, not a block) and the edges ease to the middle', () => {
    const geo = memberGeometry(items().filter(i => i.id.startsWith('jet-')));
    const f = defaultField('travelling');
    const at = t => geo.map(g => fieldLevel(f, g, t, 12));
    const mid = t => at(t).map((v, i) => Math.abs(v - at(t + 0.25)[i]));
    expect(Math.max(...mid(5))).toBeGreaterThan(1);
    expect(new Set(at(5).map(v => Math.round(v))).size).toBeGreaterThan(3);
    expect(Math.max(...at(0)) - Math.min(...at(0))).toBeLessThan(0.01); // soft start: everything at the middle level
  });

  it('rolling measures distance from the tip along both sides, with stairs', () => {
    const geo = memberGeometry(items().filter(i => i.id.startsWith('jet-')), { origin: 'right' });
    const tip = geo.find(g => g.s === 0);
    expect(tip).toBeTruthy();
    expect(Math.max(...geo.map(g => g.s))).toBeCloseTo(1, 6);
    const f = { ...defaultField('rolling'), ease: 0 };
    const far = geo.reduce((a, b) => (b.s > a.s ? b : a));
    const top = g => Math.max(...Array.from({ length: 60 }, (_, k) => fieldLevel(f, g, k * 0.11, 12)));
    expect(top(far)).toBeGreaterThan(top(tip) + 20); // back row climbs higher than the front
  });

  it('keys reproduce the curve within tolerance', () => {
    const fn = t => 50 + 30 * Math.sin(t);
    const keys = sampleKeys(fn, 10, 0.1, 0.4);
    expect(keys.length / 2).toBeLessThan(101);
    for (let t = 0.05; t < 10; t += 0.3) {
      let i = 0; while (keys[2 * (i + 1)] < t) i++;
      const [t0, v0, t1, v1] = keys.slice(2 * i, 2 * i + 4);
      expect(Math.abs(v0 + (v1 - v0) * (t - t0) / (t1 - t0) - fn(t))).toBeLessThan(0.9);
    }
  });
});

describe('field recipes compile to one keyed clip per fixture', () => {
  it('water, opened valves and coloured lights; the show frame follows the curve', () => {
    const { recipes } = unit('travelling', { light: { color: '#ff3300' } });
    const { clips, issues } = compileStudio(studioWith(recipes), items());
    expect(issues).toEqual([]);
    const water = clips.filter(c => c.fixtureId.startsWith('jet-')), valves = clips.filter(c => c.type === 'solenoid_open');
    const lamps = clips.filter(c => c.type === 'lighting_master');
    expect(water).toHaveLength(N); expect(valves).toHaveLength(N); expect(lamps).toHaveLength(N);
    expect(water.every(c => Array.isArray(c.keys) && c.startTime === 2 && c.duration === 12)).toBe(true);
    const frame = evaluateShowFrameAt({ clips, fixtures: items() }, 7);
    const levels = water.map(c => frame.fixtures[c.fixtureId].level);
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.3);
    expect(frame.fixtures['lamp-0'].color.hex).toBe('#ff3300');
    expect(frame.fixtures['valve-3'].level).toBe(1);
  });

  it('rainbow lights add moving red/green/blue curves', () => {
    const { recipes } = unit('finale', { light: { colorMode: 'rainbow' } });
    const { clips } = compileStudio(studioWith(recipes), items());
    expect(clips.filter(c => c.type === 'lighting_red')).toHaveLength(N);
    const a = evaluateShowFrameAt({ clips, fixtures: items() }, 4).fixtures['lamp-0'].color.hex;
    const b = evaluateShowFrameAt({ clips, fixtures: items() }, 7).fixtures['lamp-0'].color.hex;
    expect(a).not.toBe(b);
  });
});

describe('show blocks', () => {
  const base = () => {
    const one = unit('travelling'), two = unit('seesaw', { start: 14 });
    return { ...studioWith([...one.recipes, ...two.recipes]), legacyClips: [
      { id: 'p1', fixtureId: 'jet-0', type: 'device_intensity', startTime: 30, duration: 5, value: 50, patternBlockId: 'old' },
      { id: 'p2', fixtureId: 'jet-1', type: 'device_intensity', startTime: 31, duration: 5, value: 50, patternBlockId: 'old' },
      { id: 'bg', fixtureId: 'valve-0', type: 'solenoid_open', startTime: 0, duration: 40, value: 100, patternBlockId: 'supply' },
    ] };
  };
  it('one block per pattern unit, recorded blocks by patternBlockId, background below', () => {
    const blocks = showBlocks(base(), [{ id: 'old', name: 'Old pattern' }]);
    expect(blocks.map(b => [b.type, b.name])).toEqual([['recorded', 'supply'], ['field', 'Travelling wave'], ['field', 'See-saw'], ['recorded', 'Old pattern']]);
    expect(blocks.find(b => b.name === 'supply').background).toBe(true);
    expect(blocks.find(b => b.name === 'Old pattern').duration).toBe(6);
    expect(new Set(blocks.filter(b => !b.background).map(b => b.lane))).toEqual(new Set([0]));
  });
  it('move, resize, duplicate, edit and delete', () => {
    let s = base();
    const [, wave, , old] = showBlocks(s);
    s = moveBlock(s, wave, 40);
    expect(s.recipes.filter(r => r.pattern.id === wave.unitId).every(r => r.start === 40)).toBe(true);
    s = resizeBlock(s, showBlocks(s).find(b => b.id === wave.id), 20);
    expect(s.recipes.filter(r => r.pattern.id === wave.unitId).every(r => r.duration === 20)).toBe(true);
    s = moveBlock(s, old, 50);
    expect(s.legacyClips.find(c => c.id === 'p2').startTime).toBe(51);
    const dup = duplicateBlock(s, showBlocks(s).find(b => b.id === wave.id));
    expect(dup.studio.recipes).toHaveLength(s.recipes.length + 2);
    s = updateFieldUnit(s, showBlocks(s).find(b => b.id === wave.id), { kind: 'stadium', field: { period: 9 }, light: { color: '#00ff00', high: 33 }, name: 'Lap' });
    const water = s.recipes.find(r => r.pattern.id === wave.unitId && r.pattern.role === 'water');
    const lights = s.recipes.find(r => r.pattern.id === wave.unitId && r.pattern.role === 'lights');
    expect(water.field).toMatchObject({ kind: 'stadium', period: 9, low: 20, high: 75 });
    expect(lights).toMatchObject({ name: 'Lap · lights', color: '#00ff00' });
    expect(lights.field.high).toBe(33);
    s = deleteBlock(s, showBlocks(s).find(b => b.id === wave.id));
    expect(s.recipes.some(r => r.pattern.id === wave.unitId)).toBe(false);
  });
});

describe('3D show timeline (sequence view)', () => {
  let replace;
  beforeEach(() => {
    globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
    useEngineeringStore.setState({ fixtures: fixtures(), siteModels: [] });
    useProjectStore.setState({ programmer: { studio: { groups, recipes: [] } } });
    replace = vi.fn();
    useICANPreviewStore.setState({ replace, playback: 'stopped', position: 0 });
  });
  afterEach(() => cleanup());
  const studio = () => useProjectStore.getState().programmer.studio;

  it('adds a wave pattern, shows it as a block, edits it live in the inspector and undoes', () => {
    render(<PreviewShowTimeline height={320} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add pattern' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Travelling wave/ }));
    expect(studio().recipes).toHaveLength(2);
    expect(replace).toHaveBeenCalled();
    const block = screen.getByRole('button', { name: 'Travelling wave' });
    expect(block.getAttribute('aria-pressed')).toBe('true'); // selected → inspector open
    const inspector = screen.getByText('Movement').closest('aside');
    fireEvent.change(within(inspector).getAllByRole('spinbutton')[within(inspector).getAllByRole('spinbutton').length - 4], { target: { value: '6' } });
    fireEvent.change(within(inspector).getByRole('combobox', { name: /Pattern/ }), { target: { value: 'swell' } });
    expect(studio().recipes[0].field.kind).toBe('swell');
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    expect(studio().recipes[0].field.kind).toBe('travelling');
  });

  it('keeps the programming rows one click away', () => {
    render(<PreviewShowTimeline height={320} />);
    fireEvent.click(screen.getByRole('button', { name: 'Programming view' }));
    expect(screen.getByText('PROGRAMMING VIEW')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Show patterns/ }));
    expect(screen.getByRole('button', { name: '+ Add pattern' })).toBeTruthy();
  });
});
