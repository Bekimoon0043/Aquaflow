// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { SITES } from '../../programmer/studio/evalCorpus';
import { newRecipe, readStudio } from '../../programmer/studio/showModel';

// No WebGL in jsdom: a scene double that records what the window asked of it.
const scenes = [];
vi.mock('../FountainScene_v6', () => ({
  FountainScene: class {
    constructor() { this.calls = { frame: 0, isolate: [], signals: 0 }; this.renderVisible = true; scenes.push(this); }
    init() {} stopPattern() {} setReviewOverlays() {} resize() {} setCameraTime() {} dispose() { this.disposed = true; } snapView() {}
    setSignals() { this.calls.signals++; }
    setSelectionOutline() {}
    setIsolation(ids) { this.calls.isolate.push(ids); }
    frameFixtures() { this.calls.frame++; }
  },
}));
vi.mock('../../../hooks/useEngineeringSync', () => ({ useEngineeringSync: () => {} }));
vi.mock('../../../utils/apiClient', () => ({ apiPost: vi.fn(), apiGet: vi.fn(async () => ({})), apiUrl: (p) => `/api${p}` }));
vi.mock('../../programmer/studio/StudioPreview', () => ({ default: () => null }));

import { useFocusPreviewStore, previewVisible } from './focusPreviewStore';
import FocusPreview from './FocusPreview';
import ShowStudio from '../../programmer/studio/ShowStudio';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

function Workspace() {
  const visible = useFocusPreviewStore(previewVisible);
  return <><ShowStudio />{visible && <FocusPreview />}</>;
}

const jets = SITES.ring().fixtures.filter(f => f.type.startsWith('nozzle')).slice(0, 4).map(f => f.id);
const group = { id: 'g1', name: 'Front jets', memberFixtureIds: jets, orderMode: 'engineering' };
const recipe = { ...newRecipe('g1', 2), id: 'r1', name: 'Front swell' };
const store = () => useFocusPreviewStore.getState();
const dialog = () => screen.getByRole('dialog', { name: /^Pattern preview:/ });

beforeEach(() => {
  scenes.length = 0;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ width: 0 })), set: (t, k, v) => { t[k] = v; return true; } });
  HTMLCanvasElement.prototype.getContext = () => ctx;
  try { localStorage.clear(); } catch { /* no storage */ }
  useFocusPreviewStore.setState({ open: false, pinned: false, manual: false, dismissed: false, suspended: false, autoOpen: true, mode: 'normal', restoreMode: 'normal', pattern: null, draftClips: null, selectionIds: [], source: 'other' });
  useEngineeringStore.setState({ fixtures: SITES.ring().fixtures, siteModels: [] });
  useProjectStore.setState({ programmer: { studio: { ...readStudio({}), groups: [group], recipes: [recipe] } } });
  useProjectStore.setState((s) => ({ workspace: { ...s.workspace, activePanel: 'show_programmer' } }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('floating Pattern Preview window', () => {
  it('selecting a pattern opens the window and plays it alone; edits update it live without reframing', async () => {
    render(<Workspace />);
    expect(screen.queryByRole('dialog', { name: /^Pattern preview:/ })).toBeNull();
    act(() => { window.dispatchEvent(new CustomEvent('aquaflow:open-clip', { detail: { clipId: 'r1' } })); });
    await waitFor(() => expect(dialog().getAttribute('aria-label')).toBe('Pattern preview: Front swell'));
    expect(within(dialog()).getByText('Front jets · 4')).toBeTruthy();
    expect(store().pattern).toMatchObject({ id: 'r1', origin: 2, memberIds: jets });
    expect(scenes).toHaveLength(1);
    const scene = scenes[0], frames = scene.calls.frame;
    expect(scene.calls.isolate.at(-1)).toEqual(jets);

    // Edit the pattern in the inspector: the preview recompiles, the camera is not re-framed.
    const before = store().patternRevision;
    fireEvent.change(screen.getByLabelText('Duration (s)'), { target: { value: '5' } });
    await waitFor(() => expect(store().pattern.duration).toBeCloseTo(5));
    expect(store().patternRevision).toBeGreaterThan(before);
    expect(dialog().getAttribute('aria-label')).toBe('Pattern preview: Front swell');
    expect(scene.calls.frame).toBe(frames);
    expect(scenes).toHaveLength(1); // still one extra scene

    // Adding a new pattern plays the new one.
    fireEvent.click(screen.getByRole('button', { name: 'Pattern' }));
    await waitFor(() => expect(dialog().getAttribute('aria-label')).toBe('Pattern preview: Traveling wave'));
    expect(store().pattern.id).not.toBe('r1');
  });

  it('title bar has Minimize / Maximize / Close; double-click maximizes; Esc stays inside; toolbar + Alt+P reopen', async () => {
    render(<Workspace />);
    act(() => { window.dispatchEvent(new CustomEvent('aquaflow:open-clip', { detail: { clipId: 'r1' } })); });
    await waitFor(() => expect(dialog()).toBeTruthy());
    const win = dialog();

    fireEvent.click(within(win).getByRole('button', { name: 'Minimize pattern preview' }));
    expect(store().mode).toBe('minimized');
    expect(scenes[0].renderVisible).toBe(false); // rendering paused
    fireEvent.click(within(win).getByRole('button', { name: 'Expand pattern preview' }));
    expect(store().mode).toBe('normal');

    fireEvent.click(within(win).getByRole('button', { name: 'Maximize pattern preview' }));
    expect(store().mode).toBe('maximized');
    expect(win.className).toContain('fp-maximized');
    fireEvent.click(within(win).getByRole('button', { name: 'Restore pattern preview' }));
    expect(store().mode).toBe('normal');
    fireEvent.doubleClick(win.querySelector('.fp-titlebar'));
    expect(store().mode).toBe('maximized');
    fireEvent.keyDown(win.querySelector('.fp-titlebar'), { key: 'ArrowUp', altKey: true });
    expect(store().mode).toBe('normal');

    // Esc inside the window never reaches the app's own Escape handlers.
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    fireEvent.keyDown(win.querySelector('.fp-titlebar'), { key: 'Escape' });
    window.removeEventListener('keydown', outer);
    expect(outer).not.toHaveBeenCalled();
    expect(store().open).toBe(true);

    // Arrow keys on the focused title bar move the window (keyboard alternative to dragging).
    const x = store().rect.x;
    fireEvent.keyDown(win.querySelector('.fp-titlebar'), { key: 'ArrowLeft' });
    expect(store().rect.x).toBeLessThan(x);

    fireEvent.click(within(win).getByRole('button', { name: 'Close pattern preview' }));
    expect(screen.queryByRole('dialog', { name: /^Pattern preview:/ })).toBeNull();
    expect(scenes[0].disposed).toBe(true);
    const toggle = screen.getByRole('button', { name: 'Open pattern preview' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    // Closed by the user: selecting again does not reopen it this session…
    act(() => { window.dispatchEvent(new CustomEvent('aquaflow:open-clip', { detail: { clipId: 'r1' } })); });
    expect(screen.queryByRole('dialog', { name: /^Pattern preview:/ })).toBeNull();
    // …the toolbar toggle and Alt+P do.
    fireEvent.click(toggle);
    expect(dialog()).toBeTruthy();
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', altKey: true });
    expect(screen.queryByRole('dialog', { name: /^Pattern preview:/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', altKey: true });
    expect(dialog()).toBeTruthy();
  });

  it('a group with no pattern shows the fixtures isolated with an add-a-pattern hint', () => {
    act(() => { store().select(jets, { source: 'studio' }); });
    render(<FocusPreview />);
    expect(screen.getByText(/No pattern — add one/)).toBeTruthy();
    expect(scenes[0].calls.isolate.at(-1)).toEqual(jets);
  });

  it('a pattern applied from the Pattern builder becomes the previewed pattern', async () => {
    render(<Workspace />);
    fireEvent.click(screen.getAllByRole('button', { name: /Pattern builder/ })[0]);
    const builder = screen.getByRole('dialog', { name: 'Pattern builder' });
    fireEvent.click(within(builder).getByRole('radio', { name: /Chase/ }));
    fireEvent.click(within(builder).getByRole('button', { name: 'Apply' }));
    fireEvent.click(within(builder).getByRole('button', { name: 'Done' }));
    const added = useProjectStore.getState().programmer.studio.recipes.filter(r => r.id !== 'r1');
    expect(added.length).toBeGreaterThan(0);
    await waitFor(() => expect(added.map(r => r.id)).toContain(store().pattern?.id));
    expect(store().draftClips).toBe(null); // builder closed: its draft no longer overrides the pattern
    expect(dialog()).toBeTruthy();
  });
});
