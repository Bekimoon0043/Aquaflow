// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PreviewShowTimeline from './PreviewShowTimeline';
import { PATTERN_ASSETS, PATTERN_ASSET_DRAG_MIME, patternAssetFile } from './patternAssets';
import { compileStudio, inventory, readStudio } from './showModel';
import { importPatterns, showBlocks, updateRecipeBlock } from './showBlocks';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { useICANPreviewStore } from '../../../store/icanPreviewStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

const siteFixtures = () => [
  ...Array.from({ length: 8 }, (_, i) => ({ id: `jet-${i}`, label: `Jet ${i}`, type: 'nozzle_straight_dn25', x: i * 2, y: 0, engineering: { jetHeightM: 4 } })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `lamp-${i}`, label: `Lamp ${i}`, type: 'light_uw_rgb_18w', x: i * 2, y: 0, engineering: {} })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `mover-${i}`, label: `Mover ${i}`, type: 'motion_nozzle_1d_tilt_motor', x: i * 2, y: 3, engineering: { jetHeightM: 6, angleRangeDeg: 120 } })),
];
const siteGroups = [
  { id: 'site-water', name: 'Site water', memberFixtureIds: Array.from({ length: 8 }, (_, i) => `jet-${i}`), orderMode: 'left-to-right' },
  { id: 'site-lights', name: 'Site lights', memberFixtureIds: Array.from({ length: 4 }, (_, i) => `lamp-${i}`), orderMode: 'left-to-right' },
  { id: 'site-motion', name: 'Site movers', memberFixtureIds: Array.from({ length: 4 }, (_, i) => `mover-${i}`), orderMode: 'left-to-right' },
];
const targetStudio = () => readStudio({ studio: { groups: siteGroups, recipes: [] } });

describe('Bellagio pattern asset pack', () => {
  it('contains every source recipe exactly once with portable asset metadata', () => {
    expect(PATTERN_ASSETS).toHaveLength(160);
    expect(new Set(PATTERN_ASSETS.map(a => a.id)).size).toBe(160);
    expect(PATTERN_ASSETS.every(a => a.name && a.duration > 0 && a.category && a.recipes.length)).toBe(true);
    expect(PATTERN_ASSETS.reduce((n, a) => n + a.recipes.length, 0)).toBe(160);
    expect(PATTERN_ASSETS.map(a => a.recipes[0].effect).reduce((counts, effect) => ({ ...counts, [effect]: (counts[effect] || 0) + 1 }), {}))
      .toEqual({ field: 100, static: 19, curve: 41 });
  });

  it('imports and compiles all 160 patterns on another site with water, lights and moving nozzles', () => {
    const items = inventory(siteFixtures());
    const result = importPatterns(targetStudio(), { format: 'aquaflow-show-patterns', version: 1, patterns: PATTERN_ASSETS }, items);
    expect(result.added).toBe(160);
    expect(result.skipped).toBe(0);
    expect(result.studio.recipes).toHaveLength(160);
    expect(new Set(result.studio.recipes.map(r => r.groupId))).toEqual(new Set(['site-water', 'site-lights', 'site-motion']));
    expect(compileStudio(result.studio, items).issues).toEqual([]);
  });

  it('places a single independent copy at the requested time and refuses motion without a compatible group', () => {
    const items = inventory(siteFixtures());
    const asset = PATTERN_ASSETS.find(a => a.targets.includes('motion'));
    const original = JSON.stringify(asset);
    const result = importPatterns(targetStudio(), patternAssetFile(asset), items, { at: 42 });
    expect(result.added).toBe(1);
    expect(result.studio.recipes[0]).toMatchObject({ groupId: 'site-motion', start: 42, attribute: 'motion_angle' });
    expect(JSON.stringify(asset)).toBe(original);
    const noMotion = targetStudio();
    noMotion.groups = noMotion.groups.filter(g => g.id !== 'site-motion');
    const rejected = importPatterns(noMotion, patternAssetFile(asset), items.filter(i => !i.id.startsWith('mover-')));
    expect(rejected.added).toBe(0);
    expect(rejected.notes[0]).toMatch(/moving-nozzle/);
  });

  it('edits static levels, target groups and every curve key', () => {
    const curve = PATTERN_ASSETS.find(a => a.recipes[0].effect === 'curve');
    const imported = importPatterns(targetStudio(), patternAssetFile(curve), inventory(siteFixtures()));
    const block = showBlocks(imported.studio)[0];
    const envelope = block.water.envelope.map((p, i) => ({ ...p, value: i % 2 ? 0.8 : 0.2 }));
    const edited = updateRecipeBlock(imported.studio, block, { name: 'My dance', groupId: 'site-water', intensity: 73, cycles: 4, spread: 0.25, envelope });
    expect(edited.recipes[0]).toMatchObject({ name: 'My dance', groupId: 'site-water', intensity: 73, cycles: 4, spread: 0.25 });
    expect(edited.recipes[0].envelope).toEqual(envelope);
  });
});

describe('pattern asset browser', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
    useEngineeringStore.setState({ fixtures: siteFixtures(), siteModels: [] });
    useProjectStore.setState({ programmer: { studio: targetStudio() } });
    useICANPreviewStore.setState({ replace: vi.fn(), playback: 'stopped', position: 0 });
  });
  afterEach(() => cleanup());
  const currentStudio = () => useProjectStore.getState().programmer.studio;

  it('searches, double-clicks an asset at the playhead, and edits the copy', async () => {
    render(<PreviewShowTimeline height={320} />);
    fireEvent.click(screen.getByRole('button', { name: '▦ Pattern assets (160)' }));
    fireEvent.change(screen.getByLabelText('Search pattern assets'), { target: { value: 'Ring draws clockwise' } });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Pattern asset Ring draws clockwise' }));
    expect(currentStudio().recipes).toHaveLength(1);
    expect(currentStudio().recipes[0]).toMatchObject({ name: 'Ring draws clockwise', groupId: 'site-water', start: 0 });
    expect(screen.getByText(/edit the copy in the inspector/)).toBeTruthy();
    expect(await screen.findByLabelText('Target group')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Edit in pattern creator/ })).toBeTruthy();
  });

  it('edits a dropped motion curve directly in the inspector', async () => {
    render(<PreviewShowTimeline height={320} />);
    fireEvent.click(screen.getByRole('button', { name: '▦ Pattern assets (160)' }));
    fireEvent.change(screen.getByLabelText('Search pattern assets'), { target: { value: 'Ring oarsmen cross (X)' } });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Pattern asset Ring oarsmen cross (X)' }));
    const key = await screen.findByLabelText('Key 2 level');
    fireEvent.change(key, { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Cycles value'), { target: { value: '4' } });
    expect(currentStudio().recipes[0].envelope[1].value).toBe(0.9);
    expect(currentStudio().recipes[0].cycles).toBe(4);
    expect(currentStudio().recipes[0].groupId).toBe('site-motion');
  });

  it('drags an asset onto a timeline position', () => {
    const { container } = render(<PreviewShowTimeline height={320} />);
    fireEvent.click(screen.getByRole('button', { name: '▦ Pattern assets (160)' }));
    fireEvent.change(screen.getByLabelText('Search pattern assets'), { target: { value: 'Inner ring low' } });
    const data = {};
    const dataTransfer = { types: [PATTERN_ASSET_DRAG_MIME], effectAllowed: '', dropEffect: '', setData: (key, value) => { data[key] = value; }, getData: key => data[key] || '' };
    fireEvent.dragStart(screen.getByRole('button', { name: 'Pattern asset Inner ring low' }), { dataTransfer });
    fireEvent.drop(container.querySelector('.seq-scroll'), { dataTransfer, clientX: 112 });
    expect(currentStudio().recipes).toHaveLength(1);
    expect(currentStudio().recipes[0].name).toBe('Inner ring low');
    expect(currentStudio().recipes[0].start).toBeGreaterThan(0);
  });
});
