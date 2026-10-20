// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { useICANPreviewStore } from '../../../store/icanPreviewStore';
import PreviewShowTimeline from './PreviewShowTimeline';
import { analyzeStem, drumTrack, toneTrack } from './stemAnalysis';
import { withStems } from './stemSync';
import { liveAssetFiles } from '../../../utils/assetManifest';
import { analyzeSamples, clickTrack } from './musicAnalysis';
import { hashFile } from './musicSync';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

const jets = Array.from({ length: 8 }, (_, i) => ({ id: `jet-${i + 1}`, label: `Jet ${i + 1}`, type: 'nozzle_foam_dn40',
  x: 10 + i, y: 10, z: 0, engineering: { siteFunction: 'foam', jetHeightM: 2.5 } }));
const stems = [
  { id: 's1', role: 'drums', name: 'Drums.wav', analysis: analyzeStem(drumTrack({ seconds: 10, kicks: [1, 2, 3, 4], hats: [1.5, 2.5] }), 11025, 'drums') },
  { id: 's2', role: 'vocals', name: 'Vocals.wav', analysis: analyzeStem(toneTrack({ seconds: 10 }), 11025, 'vocals') },
];

beforeEach(() => { globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; liveAssetFiles.delete('audio:programmer'); });
afterEach(() => { cleanup(); liveAssetFiles.delete('audio:programmer'); vi.unstubAllGlobals(); });

describe('Stems in the pattern builder', () => {
  it('lists the loaded stems, links them to groups and programs the show; Undo removes it', () => {
    useEngineeringStore.setState({ fixtures: jets, siteModels: [], params: { ...useEngineeringStore.getState().params, design_head_m: 4 } });
    useProjectStore.setState({ programmer: withStems(null, stems) });
    useICANPreviewStore.setState({ replace: vi.fn(), playback: 'stopped', position: 0 });
    render(<PreviewShowTimeline height={320} />);
    fireEvent.click(screen.getByRole('button', { name: /Pattern builder/ }));
    const dialog = screen.getByRole('dialog', { name: 'Pattern builder' });
    const box = within(dialog).getByLabelText('Stems');
    expect(within(box).getByText('Drums.wav')).toBeTruthy();
    expect(within(box).getByText('Vocals.wav')).toBeTruthy();
    const parts = within(box).getAllByLabelText('Music part');
    expect(parts.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(within(box).getByRole('button', { name: /Follow exactly/ }));
    const studio = useProjectStore.getState().programmer.studio;
    const stemRecipes = studio.recipes.filter(r => r.stems);
    expect(stemRecipes.length).toBeGreaterThan(0);
    expect(stemRecipes.every(r => r.effect === 'curve' && r.sampleRate === 20)).toBe(true);
    expect(useProjectStore.getState().programmer.timelineClips.some(c => Array.isArray(c.keys))).toBe(true);
    expect(within(dialog).getAllByRole('status').some(s => /Programmed from stems/.test(s.textContent))).toBe(true);
    expect(within(box).getByRole('button', { name: /Create patterns from the music/ })).toBeTruthy();
    // The stems themselves stay in the project.
    expect(useProjectStore.getState().programmer.stems.items).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: /Undo/ }));
    expect((useProjectStore.getState().programmer.studio.recipes || []).filter(r => r.stems)).toHaveLength(0);
  });
});

describe('Water follows its stem', () => {
  const many = Array.from({ length: 16 }, (_, i) => ({ id: `jet-${i + 1}`, label: `Jet ${i + 1}`, type: 'nozzle_foam_dn40',
    x: 10 + 4 * Math.cos(i / 8 * Math.PI), y: 10 + 4 * Math.sin(i / 8 * Math.PI), z: 0, engineering: { siteFunction: 'foam', jetHeightM: 2.5 } }));
  const groups = [
    { id: 'g-drums', name: 'Group 1 · Drums', memberFixtureIds: many.slice(0, 8).map(j => j.id), orderMode: 'engineering', color: '#35d0c0' },
    { id: 'g-vocals', name: 'Group 2 · Vocals', memberFixtureIds: many.slice(8).map(j => j.id), orderMode: 'engineering', color: '#ff4fa3' },
  ];
  const analysis = analyzeSamples(clickTrack({ bpm: 120, bars: 16, rate: 11025, level: b => (b < 4 ? .3 : b < 12 ? 1 : .4) }), 11025).analysis;

  it('the tick box switches the music button to stem following, links groups by name and one Undo removes it', async () => {
    vi.stubGlobal('Audio', class { constructor() { this.paused = true; this.currentTime = 0; this.duration = 32; } play() { return Promise.resolve(); } pause() {} });
    URL.createObjectURL = vi.fn(() => 'blob:song');
    URL.revokeObjectURL = vi.fn();
    const song = new File([new Uint8Array([5, 6, 7])], 'lebu.mp3', { type: 'audio/mpeg' });
    const hash = await hashFile(song);
    liveAssetFiles.set('audio:programmer', song);
    useEngineeringStore.setState({ fixtures: many, siteModels: [], params: { ...useEngineeringStore.getState().params, design_head_m: 4 } });
    useProjectStore.setState({ programmer: { ...withStems(null, stems), studio: { groups }, musicCache: { [hash]: { ...analysis, hash, cachedAt: 1 } } } });
    useICANPreviewStore.setState({ replace: vi.fn(), playback: 'stopped', position: 0 });
    render(<PreviewShowTimeline height={320} />);
    fireEvent.click(screen.getByRole('button', { name: /Pattern builder/ }));
    const dialog = screen.getByRole('dialog', { name: 'Pattern builder' });
    await within(dialog).findByText(/120 BPM/);
    const box = within(dialog).getByLabelText('Stems');
    // The whole song is a part too.
    expect(within(box).getAllByRole('option', { name: 'Song' }).length).toBeGreaterThan(0);
    const tick = within(box).getByRole('checkbox', { name: 'Water follows its stem' });
    expect(tick.checked).toBe(false);
    fireEvent.click(tick);
    expect(useProjectStore.getState().programmer.studio.site.followStems).toBe(true);
    expect(within(box).getByRole('checkbox', { name: 'Water follows its stem' }).checked).toBe(true);
    const details = box.querySelector('details.pb-advanced');
    if (details) expect(details.open).toBe(true);
    // Links from the group names: drums → Group 1, the vocal melody → Group 2.
    const links = within(box).getAllByLabelText('Music part').map((el, i) => `${el.value}→${within(box).getAllByLabelText('Drives group')[i].value}`);
    expect(links).toEqual(['vocals:melody→water|g-vocals', 'drums:kicks→water|g-drums']);
    fireEvent.click(within(box).getByRole('button', { name: /Create patterns from the music/ }));
    await waitFor(() => expect(within(dialog).getAllByRole('status').some(s => /Water follows its stem · \d+ waves? follow/.test(s.textContent))).toBe(true));
    const made = useProjectStore.getState().programmer.studio.recipes.filter(r => r.pattern?.music);
    expect(made.some(r => r.field?.music?.source === 'drums:kicks')).toBe(true);
    expect(made.some(r => r.field?.music?.source === 'vocals:melody')).toBe(true);
    expect(useProjectStore.getState().programmer.studio.plan.provenance.planner).toBe('stems');
    fireEvent.click(within(dialog).getByRole('button', { name: /Undo/ }));
    expect((useProjectStore.getState().programmer.studio.recipes || []).filter(r => r.pattern?.music)).toHaveLength(0);
  });
});
