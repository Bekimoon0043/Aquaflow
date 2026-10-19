// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { useICANPreviewStore } from '../../../store/icanPreviewStore';
import PreviewShowTimeline from './PreviewShowTimeline';
import { analyzeStem, drumTrack, toneTrack } from './stemAnalysis';
import { withStems } from './stemSync';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

const jets = Array.from({ length: 8 }, (_, i) => ({ id: `jet-${i + 1}`, label: `Jet ${i + 1}`, type: 'nozzle_foam_dn40',
  x: 10 + i, y: 10, z: 0, engineering: { siteFunction: 'foam', jetHeightM: 2.5 } }));
const stems = [
  { id: 's1', role: 'drums', name: 'Drums.wav', analysis: analyzeStem(drumTrack({ seconds: 10, kicks: [1, 2, 3, 4], hats: [1.5, 2.5] }), 11025, 'drums') },
  { id: 's2', role: 'vocals', name: 'Vocals.wav', analysis: analyzeStem(toneTrack({ seconds: 10 }), 11025, 'vocals') },
];

beforeEach(() => { globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; });
afterEach(() => cleanup());

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
