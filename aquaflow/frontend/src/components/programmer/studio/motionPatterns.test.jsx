// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import PreviewShowTimeline from './PreviewShowTimeline';
import { cleanMotion, compileMotionRecipe, motionAxesOf, motionPatternRecipes, motionPoint, motionSpeedReport } from './motionPatterns';
import { compileStudio, inventory, readStudio } from './showModel';
import { evaluateShowFrameAt } from '../../../show/evaluateShowFrame';
import { createShowHistory } from '../../preview/studio/showHistory';
import { exportPatterns, importPatterns, showBlocks } from './showBlocks';
import { shapeValue } from './wavePatterns';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { useICANPreviewStore } from '../../../store/icanPreviewStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

const movingFixtures = () => [
  ...Array.from({ length: 4 }, (_, i) => ({ id: `one-${i}`, label: `1D ${i}`, type: 'motion_nozzle_1d_tilt_motor', x: i * 2, y: 0, engineering: { jetHeightM: 5, angleRangeDeg: 120, speedDegSec: 90 } })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `two-${i}`, label: `2D ${i}`, type: 'motion_nozzle_2d_mdd_l_oase', x: i * 2, y: 3, engineering: { jetHeightM: 8, panRangeDeg: 200, tiltRangeDeg: 140, speedDegSec: 120 } })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `three-${i}`, label: `3D ${i}`, type: 'motion_nozzle_3d_robotic_module', x: i * 2, y: 6, engineering: { jetHeightM: 10, panRangeDeg: 360, tiltRangeDeg: 135, speedDegSec: 90, outletCount: 3 } })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `lamp-${i}`, label: `Lamp ${i}`, type: 'light_uw_rgb_18w', x: i * 2, y: 0, engineering: {} })),
];
const groups = [
  { id: 'one', name: '1D movers', memberFixtureIds: Array.from({ length: 4 }, (_, i) => `one-${i}`), orderMode: 'left-to-right' },
  { id: 'two', name: '2D movers', memberFixtureIds: Array.from({ length: 4 }, (_, i) => `two-${i}`), orderMode: 'left-to-right' },
  { id: 'three', name: '3D movers', memberFixtureIds: Array.from({ length: 4 }, (_, i) => `three-${i}`), orderMode: 'left-to-right' },
  { id: 'lights', name: 'Lights', memberFixtureIds: Array.from({ length: 4 }, (_, i) => `lamp-${i}`), orderMode: 'left-to-right' },
];
const field = { kind: 'custom', shape: 'sine', path: 'around', period: 4, crests: 1, direction: 1, group: 1, opposite: false, low: 30, high: 90, ease: 0 };
const make = (axes, extra = {}) => motionPatternRecipes({ start: 0, duration: 10, name: `${axes}D test`, groupId: axes === 1 ? 'one' : axes === 2 ? 'two' : 'three',
  lightGroupId: 'lights', field, motion: cleanMotion({ axes, limitSpeed: false, ...extra }, axes) });

describe('1D/2D/3D motion pattern engine', () => {
  it('creates coordinated water, motion and light layers and compiles real 1D channels', () => {
    const items = inventory(movingFixtures());
    expect(items.filter(i => i.id.startsWith('one')).every(i => motionAxesOf(i) === 1)).toBe(true);
    const made = make(1, { amplitudeDeg: 50 });
    const studio = readStudio({ studio: { groups, recipes: made.recipes } });
    const block = showBlocks(studio)[0];
    expect(block).toMatchObject({ type: 'motion', name: '1D test' });
    expect(made.recipes.map(r => r.pattern.role)).toEqual(['motion-water', 'motion', 'lights']);
    const compiled = compileStudio(studio, items);
    expect(compiled.issues).toEqual([]);
    expect(compiled.clips.filter(c => c.type === 'motion_angle')).toHaveLength(4);
    expect(compiled.clips.filter(c => c.type === 'motion_intensity')).toHaveLength(4);
    expect(compiled.clips.filter(c => c.type === 'lighting_master')).toHaveLength(4);
    const frame = evaluateShowFrameAt({ fixtures: items, clips: compiled.clips }, 1);
    expect(frame.fixtures['one-0'].motion.pan).toBeGreaterThan(0);
  });

  it('compiles 2D spatial paths with exact degree mappings and clamps to fixture ranges', () => {
    const items = inventory(movingFixtures()), members = items.filter(i => i.id.startsWith('two'));
    const recipe = make(2, { path: 'figure8', panAmplitudeDeg: 100, tiltAmplitudeDeg: 70, centreTiltDeg: 0 }).recipes.find(r => r.effect === 'motion');
    const made = compileMotionRecipe(recipe, members);
    expect(made.issues).toEqual([]);
    expect(made.clips.filter(c => c.type === 'motion_pan')).toHaveLength(4);
    expect(made.clips.filter(c => c.type === 'motion_tilt')).toHaveLength(4);
    const frame = evaluateShowFrameAt({ fixtures: items, clips: made.clips }, 1);
    expect(Math.abs(frame.fixtures['two-0'].motion.pan)).toBeLessThanOrEqual(90);
    expect(Math.abs(frame.fixtures['two-0'].motion.tilt)).toBeLessThanOrEqual(70);
    expect(made.clips[0].motionScale).not.toBe(0.9);
  });

  it('keeps 3D head roll continuous in the frame and Studio history', () => {
    const items = inventory(movingFixtures());
    expect(items.filter(i => i.id.startsWith('three')).every(i => motionAxesOf(i) === 3)).toBe(true);
    const studio = readStudio({ studio: { groups, recipes: make(3, { path: 'circle', rollMode: 'spin', rollRpm: 60 }).recipes } });
    const compiled = compileStudio(studio, items);
    expect(compiled.issues).toEqual([]);
    expect(compiled.clips.filter(c => c.type === 'motion_roll')).toHaveLength(4);
    const frame = evaluateShowFrameAt({ fixtures: items, clips: compiled.clips }, 5);
    expect(frame.fixtures['three-0'].motion.roll).toBeCloseTo(1800, 1);
    const history = createShowHistory({ fixtures: items, clips: compiled.clips });
    expect(Math.abs(history.roll('three-0', 2.5) - 900)).toBeLessThan(0.2);
  });

  it('slows a whole group coherently to the rated drive speed', () => {
    const members = inventory(movingFixtures()).filter(i => i.id.startsWith('one')).map(i => ({ ...i, engineering: { ...i.engineering, speedDegSec: 45 } }));
    const report = motionSpeedReport(cleanMotion({ axes: 1, amplitudeDeg: 90, limitSpeed: true }), { ...field, period: 1 }, members);
    expect(report.limited).toBe(true);
    expect(report.limitedPeak).toBeCloseTo(45, 1);
    expect(report.scale).toBeLessThan(0.5);
  });

  it('exports and retargets every layer together on another compatible site', () => {
    const items = inventory(movingFixtures()), source = readStudio({ studio: { groups, recipes: make(3).recipes } });
    const file = exportPatterns(source, showBlocks(source));
    const renamed = readStudio({ studio: { groups: groups.map(g => ({ ...g, id: `new-${g.id}`, name: `New ${g.name}` })), recipes: [] } });
    const result = importPatterns(renamed, file, items, { at: 20 });
    expect(result.added).toBe(1);
    expect(result.studio.recipes).toHaveLength(3);
    expect(result.studio.recipes.filter(r => r.pattern.role !== 'lights').every(r => r.groupId === 'new-three')).toBe(true);
    expect(result.studio.recipes.find(r => r.pattern.role === 'lights').groupId).toBe('new-lights');
    expect(result.studio.recipes.every(r => r.start === 20)).toBe(true);
  });

  it('supports linear, smooth, ease-in, ease-out and hold drawn segments', () => {
    const points = [{ time: 0, value: 0 }, { time: 1, value: 1, ease: 'in' }];
    expect(shapeValue({ shape: 'drawn', points }, 0.5)).toBe(0.25);
    points[1].ease = 'out'; expect(shapeValue({ shape: 'drawn', points }, 0.5)).toBe(0.75);
    points[1].ease = 'smooth'; expect(shapeValue({ shape: 'drawn', points }, 0.5)).toBe(0.5);
    points[1].ease = 'hold'; expect(shapeValue({ shape: 'drawn', points }, 0.5)).toBe(0);
    expect(motionPoint(cleanMotion({ axes: 1 }), { ...field, shape: 'drawn', points }, { i: 0, n: 1, p: 0, s: 0 }, 2)).toBeTruthy();
  });
});

describe('motion pattern creator workflow', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
    localStorage.clear();
    useEngineeringStore.setState({ fixtures: movingFixtures(), siteModels: [] });
    useProjectStore.setState({ programmer: { studio: { groups, recipes: [] } } });
    useICANPreviewStore.setState({ replace: vi.fn(), playback: 'stopped', position: 0 });
  });
  afterEach(() => cleanup());
  const studio = () => useProjectStore.getState().programmer.studio;

  it('creates, edits and compiles a 3D pattern from the guided window', async () => {
    render(<PreviewShowTimeline height={320} />);
    fireEvent.click(screen.getByRole('button', { name: '✎ Create pattern' }));
    const dialog = screen.getByRole('dialog', { name: 'Pattern creator' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /3D Head/ }));
    fireEvent.change(within(dialog).getByLabelText('Pattern name'), { target: { value: 'Spiral helix' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Figure 8/ }));
    fireEvent.change(within(dialog).getByLabelText('Head speed value'), { target: { value: '36' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Add to timeline' }));
    expect(studio().recipes.map(r => r.pattern.role)).toEqual(['motion-water', 'motion', 'lights']);
    expect(studio().recipes.find(r => r.effect === 'motion').motion).toMatchObject({ axes: 3, path: 'figure8', rollRpm: 36 });
    expect(compileStudio(readStudio(useProjectStore.getState().programmer), inventory(movingFixtures())).issues).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Edit 3D pattern/ }));
    const reopened = screen.getByRole('dialog', { name: 'Pattern creator' });
    fireEvent.change(within(reopened).getByLabelText('Tilt amplitude value'), { target: { value: '25' } });
    fireEvent.click(within(reopened).getByRole('button', { name: 'Update pattern' }));
    expect(studio().recipes.find(r => r.effect === 'motion').motion.tiltAmplitudeDeg).toBe(25);
  });

  it('customizes a Bellagio motion asset as an independent 1D pattern', () => {
    render(<PreviewShowTimeline height={320} />);
    fireEvent.click(screen.getByRole('button', { name: '▦ Pattern assets (160)' }));
    fireEvent.change(screen.getByLabelText('Search pattern assets'), { target: { value: 'Ring oarsmen cross (X)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Customize Ring oarsmen cross (X)' }));
    const dialog = screen.getByRole('dialog', { name: 'Pattern creator' });
    expect(within(dialog).getByRole('radio', { name: /1D Swing/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Add to timeline' }));
    expect(studio().recipes.some(r => r.effect === 'motion' && r.motion.axes === 1)).toBe(true);
  });
});
