// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { useICANPreviewStore } from '../../../store/icanPreviewStore';
import { liveAssetFiles } from '../../../utils/assetManifest';
import PreviewShowTimeline from './PreviewShowTimeline';
import { LIBRARY_KEY, exportLibrary, presetFromBuilder } from './patternLibrary';
import { analyzeSamples, clickTrack } from './musicAnalysis';
import { hashFile } from './musicSync';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

const ring = (prefix, n, radius, extra) => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}-${i + 1}`, label: `${prefix} ${i + 1}`, z: 0,
  x: 10 + radius * Math.cos((2 * Math.PI * i) / n), y: 10 + radius * Math.sin((2 * Math.PI * i) / n), ...extra,
}));
const fixtures = [
  ...ring('jet', 8, 4, { type: 'nozzle_foam_dn40', engineering: { siteFunction: 'foam', jetHeightM: 2.5 } }),
  ...ring('lamp', 4, 3, { type: 'light_par', engineering: {} }),
];

class FakeAudio {
  constructor(src) { this.src = src; this.paused = true; this.currentTime = 0; this.duration = 64; this.playbackRate = 1; FakeAudio.all.push(this); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}
FakeAudio.all = [];

let replace;
function setup(programmer = null) {
  useEngineeringStore.setState({ fixtures, siteModels: [], params: { ...useEngineeringStore.getState().params, design_head_m: 4 } });
  useProjectStore.setState({ programmer });
  replace = vi.fn();
  useICANPreviewStore.setState({ replace, playback: 'stopped', position: 0, audioFile: null });
  return render(<PreviewShowTimeline height={320} />);
}
const studio = () => useProjectStore.getState().programmer?.studio || { recipes: [], markers: [], presets: [] };
const openBuilder = () => {
  fireEvent.click(screen.getAllByRole('button', { name: /Pattern builder/ })[0]);
  return screen.getByRole('dialog', { name: 'Pattern builder' });
};

beforeEach(() => {
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  try { localStorage.clear(); } catch { /* ignore */ }
  liveAssetFiles.delete('audio:programmer');
  FakeAudio.all = [];
  vi.stubGlobal('Audio', FakeAudio);
  URL.createObjectURL = vi.fn(() => 'blob:song');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('reopen a builder pattern', () => {
  it('double-click opens Mirror + lights pre-filled; Update replaces it in place; one Undo restores it', () => {
    setup();
    let dialog = openBuilder();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Mirror/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Lights match the water/ }));
    fireEvent.change(within(dialog).getByLabelText('Brightness'), { target: { value: '40' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    const before = studio().recipes;
    expect(before).toHaveLength(4);
    expect(new Set(before.map(r => r.pattern.id)).size).toBe(1);
    const ids = before.map(r => r.id);

    // Double-click the right half's clip on the timeline.
    fireEvent.doubleClick(screen.getByRole('button', { name: /Mirror · right/ }));
    dialog = screen.getByRole('dialog', { name: 'Pattern builder' });
    expect(within(dialog).getByText('editing')).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: /Mirror/ }).getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getByLabelText('Pattern group').value).toBe('quick:water');
    expect(within(dialog).getByRole('checkbox', { name: /Lights match the water/ }).checked).toBe(true);
    expect(within(dialog).getByLabelText('Brightness').value).toBe('40');

    fireEvent.change(within(dialog).getByLabelText('Speed'), { target: { value: '15' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
    const after = studio().recipes;
    expect(after.map(r => r.id)).toEqual(ids);                 // same recipes, edited in place
    expect(after[0].cycles).toBe(2);
    expect(after.filter(r => r.pattern.role === 'lights').every(r => r.intensity === 40)).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    // One step back in the timeline restores the previous version exactly.
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    expect(studio().recipes).toEqual(before);
  });

  it('right-click → Edit in builder, and the transport button for a selected pattern', () => {
    setup();
    const dialog = openBuilder();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Chase/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    const clip = screen.getByRole('button', { name: /^Chase$/ });
    fireEvent.contextMenu(clip);
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit in builder/ }));
    let reopened = screen.getByRole('dialog', { name: 'Pattern builder' });
    expect(within(reopened).getByRole('radio', { name: /Chase/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(reopened).getByRole('button', { name: 'Done' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Chase$/ }), { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: /Edit in builder/ }));
    reopened = screen.getByRole('dialog', { name: 'Pattern builder' });
    expect(within(reopened).getByRole('button', { name: 'Update' })).toBeTruthy();
  });
});

describe('saved presets in the builder', () => {
  it('Lebu wave card fills the form; Save as preset stores options in the project and the library; Import adds cards', async () => {
    setup();
    const dialog = openBuilder();
    fireEvent.click(within(dialog).getByRole('button', { name: /Lebu wave/ }));
    expect(within(dialog).getByLabelText('Length').value).toBe('30');
    expect(within(dialog).getByText(/3 laps · seamless loop/)).toBeTruthy();
    expect(within(dialog).getByLabelText('Low').value).toBe('35');
    expect(within(dialog).getByRole('checkbox', { name: /Lights match the water/ }).checked).toBe(true);
    expect(within(dialog).getByLabelText('Brightness').value).toBe('30');

    fireEvent.change(within(dialog).getByLabelText('Speed'), { target: { value: '6' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save as preset/ }));
    fireEvent.change(within(dialog).getByLabelText('Preset name'), { target: { value: 'Fast lebu' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    const saved = studio().presets.find(p => p.name === 'Fast lebu');
    expect(saved).toMatchObject({ kind: 'pattern', preset: 'wave', options: { lapSeconds: 6, duration: 30 }, lights: { enabled: true, level: 30 } });
    expect(JSON.stringify(saved)).not.toMatch(/jet-|lamp-|quick:/);
    expect(JSON.parse(localStorage.getItem(LIBRARY_KEY)).map(p => p.name)).toEqual(['Fast lebu']);
    expect(within(dialog).getByRole('button', { name: 'Fast lebu' })).toBeTruthy();

    const file = new File([exportLibrary([presetFromBuilder('Imported chase', { preset: 'chase', options: { lapSeconds: 4 }, lights: {} })])], 'presets.json', { type: 'application/json' });
    fireEvent.change(within(dialog).getByLabelText('Import presets file'), { target: { files: [file] } });
    await within(dialog).findByRole('button', { name: 'Imported chase' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Imported chase' }));
    expect(within(dialog).getByRole('radio', { name: /Chase/ }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('music sync in the builder', () => {
  const LEVELS = [...Array(4).fill(.2), ...Array(8).fill(.5), ...Array(8).fill(1), ...Array(8).fill(.5), ...Array(4).fill(.2)];
  const analysis = analyzeSamples(clickTrack({ bpm: 120, bars: 32, rate: 11025, level: b => LEVELS[b] ?? .2 }), 11025).analysis;

  async function withSong() {
    const song = new File([new Uint8Array([1, 2, 3, 4])], 'lebu.mp3', { type: 'audio/mpeg' });
    const hash = await hashFile(song);
    liveAssetFiles.set('audio:programmer', song);
    setup({ musicCache: { [hash]: { ...analysis, hash, cachedAt: 1 } } });
    const dialog = openBuilder();
    await within(dialog).findByText(/120 BPM/);
    return { song, dialog };
  }

  it('Sync to music snaps to bars, shows the tempo, and lands chase hits on beats', async () => {
    const { dialog } = await withSong();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Chase/ }));
    fireEvent.change(within(dialog).getByLabelText('Start'), { target: { value: '1' } });
    fireEvent.change(within(dialog).getByLabelText('Length'), { target: { value: '17' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Sync to music' }));
    await within(dialog).findByText(/♩ 120 BPM · .*step 2 beats/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    const [r] = studio().recipes;
    const bar = 2, origin = analysis.downbeats[0] % bar;
    expect(Math.abs((r.start - origin) / bar - Math.round((r.start - origin) / bar))).toBeLessThan(1e-3);
    expect(r.pattern.options.sync).toMatchObject({ bpm: 120, stepBeats: 2 });
    expect(studio().tempo).toEqual([{ time: expect.any(Number), bpm: 120 }]);
  });

  it('Fill the song: section markers + editable patterns in one undo step; preview plays the song', async () => {
    const { song } = await withSong();
    const dialog = screen.getByRole('dialog', { name: 'Pattern builder' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Lights match the water/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Fill the song/ }));
    await waitFor(() => expect(studio().markers.length).toBe(5));
    expect(studio().markers.map(m => m.name)).toEqual(['Intro', 'Verse', 'Chorus', 'Verse', 'Outro']);
    const filled = studio().recipes;
    expect(filled.length).toBeGreaterThan(8);
    expect(filled.every(r => r.pattern?.fill)).toBe(true);
    expect(filled.some(r => r.pattern.role === 'lights')).toBe(true);
    expect(within(dialog).getByText(/Song filled · 5 sections/)).toBeTruthy();
    // The 3D preview was rebuilt with the song attached.
    expect(replace).toHaveBeenCalled();
    expect(replace.mock.calls.at(-1)[2]).toBe(song);

    // Any filled pattern reopens in the builder.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    fireEvent.doubleClick(screen.getAllByRole('button', { name: /^Smooth wave$/ })[0]);
    expect(within(screen.getByRole('dialog', { name: 'Pattern builder' })).getByText('editing')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Pattern builder' })).getByRole('button', { name: 'Done' }));

    // One Undo removes the whole fill.
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    expect(studio().recipes).toEqual([]);
    expect(studio().markers).toEqual([]);
  });

  it('the preview timeline plays the song in sync: start, seek and pause follow the 3D preview', async () => {
    await withSong();
    const audio = FakeAudio.all.at(-1);
    expect(audio).toBeTruthy();
    act(() => { useICANPreviewStore.setState({ playback: 'playing', position: 3 }); });
    expect(audio.paused).toBe(false);                        // starts with the preview…
    expect(audio.currentTime).toBe(3);                       // …at the playhead
    act(() => { useICANPreviewStore.setState({ position: 40 }); });
    expect(audio.currentTime).toBe(40);                      // seek follows
    act(() => { useICANPreviewStore.setState({ playback: 'paused', position: 41 }); });
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(41);
    // While the preview sidebar's own player has the same song, this one stays quiet.
    const song = liveAssetFiles.get('audio:programmer');
    useProjectStore.setState(s => ({ render: { ...s.render, sidebarOpen: true } }));
    act(() => { useICANPreviewStore.setState({ playback: 'playing', position: 42, audioFile: song }); });
    expect(audio.paused).toBe(true);
  });
});
