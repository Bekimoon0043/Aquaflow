// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { useICANPreviewStore } from '../../../store/icanPreviewStore';
import PreviewShowTimeline from './PreviewShowTimeline';
import { compileStudio, inventory, readStudio } from './showModel';
import { defaultField, fieldLevel, memberGeometry } from './wavePatterns';
import { EXAMPLES, exportTypes, importTypes } from './customPatterns';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

const N = 30;
const ring = () => [
  ...Array.from({ length: N }, (_, i) => ({ id: `jet-${i}`, label: `Jet ${i}`, type: 'nozzle_straight_dn25',
    x: 10 + 4 * Math.cos((2 * Math.PI * i) / N), y: 10 + 4 * Math.sin((2 * Math.PI * i) / N), z: 0, engineering: { jetHeightM: 2.5 } })),
  ...Array.from({ length: N }, (_, i) => ({ id: `lamp-${i}`, label: `Lamp ${i}`, type: 'light_uw_rgb_18w',
    x: 10 + 4 * Math.cos((2 * Math.PI * i) / N), y: 10 + 4 * Math.sin((2 * Math.PI * i) / N), z: 0 })),
];
const groups = [
  { id: 'jets', name: 'Jets', memberFixtureIds: Array.from({ length: N }, (_, i) => `jet-${i}`), orderMode: 'clockwise', color: '#65d9d0' },
  { id: 'lamps', name: 'Lamps', memberFixtureIds: Array.from({ length: N }, (_, i) => `lamp-${i}`), orderMode: 'clockwise', color: '#f5c86b' },
];

describe('patterns built from basic pieces', () => {
  const geo = memberGeometry(ring().slice(0, N), { origin: 'tip' });
  const same = (builtin, example, shift = 0, tol = 0.01) => {
    const a = { ...defaultField(builtin), ease: 0 }, b = { ...EXAMPLES.find(x => x.name === example).field, ease: 0 };
    for (let t = 2; t < 14; t += 0.7) for (const g of geo) expect(Math.abs(fieldLevel(a, g, t, 15) - fieldLevel(b, g, t - shift, 15)), `${builtin} t=${t}`).toBeLessThan(tol);
  };
  it('the custom recipe of each Lebu pattern moves exactly like the ready-made one', () => {
    same('rolling', 'Rolling wave');
    same('travelling', 'Travelling wave');
    same('swell', 'Grand swell', 5 / 4); // the same breath, a quarter cycle later
    same('sweep', 'Converge & split');
    same('crossing', 'Crossing waves', 2.5); // 2 crests every 5 s = one lap in 10 s; starts half a cycle later
    same('finale', 'Rainbow finale');
  });
  it('see-saw and stadium recipes keep the same character (neighbours opposite / fast rise, slow fall)', () => {
    const s = { ...EXAMPLES.find(x => x.name === 'See-saw').field, ease: 0, drift: 0 };
    const lv = (i, t) => fieldLevel(s, geo[i], t, 15);
    expect(Math.sign(lv(0, 1) - lv(0, 0.8))).toBe(-Math.sign(lv(4, 1) - lv(4, 0.8))); // one block rises while the next falls
    const st = { ...EXAMPLES.find(x => x.name === 'Stadium wave').field, ease: 0 };
    const trace = Array.from({ length: 300 }, (_, k) => fieldLevel(st, geo[0], k * 0.025, 15));
    const peak = trace.indexOf(Math.max(...trace));
    const up = peak - trace.slice(0, peak).lastIndexOf(Math.min(...trace.slice(0, peak)));
    expect(up).toBeLessThan(0.3 * 300 * 0.025 / 0.025); // rises within ~30 % of a lap
  });
  it('pattern types round-trip through a file', () => {
    const text = exportTypes([EXAMPLES[0], { ...EXAMPLES[4], name: 'Mine' }]);
    const back = importTypes(text);
    expect(back.map(t => t.name)).toEqual(['Rolling wave', 'Mine']);
    expect(back[0].field).toMatchObject({ shape: 'sine', path: 'from-point', stairs: 6 });
    expect(() => importTypes('{}')).toThrow(/pattern-type file/);
  });
});

describe('pattern creator in the 3D show timeline', () => {
  let replace;
  beforeEach(() => {
    globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
    localStorage.clear();
    useEngineeringStore.setState({ fixtures: ring(), siteModels: [] });
    useProjectStore.setState({ programmer: { studio: { groups, recipes: [] } } });
    replace = vi.fn();
    useICANPreviewStore.setState({ replace, playback: 'stopped', position: 0 });
  });
  afterEach(() => cleanup());
  const studio = () => useProjectStore.getState().programmer.studio;

  it('creates a pattern from a shape and a path, adds it, saves it as my pattern and reuses it from + Add pattern', () => {
    render(<PreviewShowTimeline height={320} />);
    fireEvent.click(screen.getByRole('button', { name: '✎ Create pattern' }));
    const dialog = screen.getByRole('dialog', { name: 'Pattern creator' });
    fireEvent.change(within(dialog).getByLabelText('Pattern name'), { target: { value: 'Quick lap' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Quick rise, slow fall/ }));
    fireEvent.click(within(dialog).getByRole('radio', { name: /Around the basin/ }));
    fireEvent.change(within(dialog).getByLabelText('Seconds per cycle value'), { target: { value: '6' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Add to timeline' }));
    const water = studio().recipes.find(r => r.pattern?.role === 'water');
    expect(water).toMatchObject({ name: 'Quick lap', effect: 'field' });
    expect(water.field).toMatchObject({ kind: 'custom', shape: 'rise-fall', path: 'around', period: 6 });
    expect(compileStudio(readStudio(useProjectStore.getState().programmer), inventory(ring())).issues).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: /Save as my pattern/ }));
    expect(studio().presets.find(p => p.kind === 'field-type').name).toBe('Quick lap');
    expect(JSON.parse(localStorage.getItem('aquaflow.myPatternTypes.v1'))[0].name).toBe('Quick lap');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close pattern creator' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add pattern' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /★ Quick lap/ }));
    expect(studio().recipes.filter(r => r.pattern?.role === 'water')).toHaveLength(2);
  });

  it('draws a custom movement shape with the dots', () => {
    render(<PreviewShowTimeline height={320} />);
    fireEvent.click(screen.getByRole('button', { name: '✎ Create pattern' }));
    const dialog = screen.getByRole('dialog', { name: 'Pattern creator' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Draw your own/ }));
    expect(dialog.querySelectorAll('.pc-handle')).toHaveLength(9);
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Add to timeline' }));
    expect(studio().recipes[0].field.points).toHaveLength(9);
  });

  it('opens a ready-made pattern as its recipe and Update turns it into a custom pattern', () => {
    render(<PreviewShowTimeline height={320} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add pattern' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Converge & split/ }));
    fireEvent.click(screen.getByRole('button', { name: /See how it is made/ }));
    const dialog = screen.getByRole('dialog', { name: 'Pattern creator' });
    expect(within(dialog).getByRole('radio', { name: /Single crest/ }).getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getByRole('radio', { name: /From a point to both sides/ }).getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getByRole('radio', { name: /There and back/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update pattern' }));
    expect(studio().recipes.filter(r => r.effect === 'field').every(r => r.field.kind === 'custom')).toBe(true);
  });
});
