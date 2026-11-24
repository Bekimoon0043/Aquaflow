import { describe, it, expect, beforeEach } from 'vitest';
import { resizeRect, snapRect, maximizedRect, minimizedRect, displayRect, restoreUnderPointer, nudgeRect, MIN_WIDTH, MIN_HEIGHT, TITLE_HEIGHT } from './windowGeometry';
import { patternSubject, patternRecipes, loopTime } from './patternPreview';
import { localizeClips } from './draftPreview';
import { newRecipe, readStudio, inventory } from '../../programmer/studio/showModel';
import { useFocusPreviewStore, previewVisible, UI_KEY, RECT_KEY } from './focusPreviewStore';

// Node has no localStorage: a minimal in-memory one (the store itself tolerates its absence).
if (typeof globalThis.localStorage === 'undefined') {
  const data = new Map();
  globalThis.localStorage = { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), clear: () => data.clear() };
}
const reset = () => useFocusPreviewStore.setState({ open: false, pinned: false, manual: false, dismissed: false, suspended: false, autoOpen: true, mode: 'normal', restoreMode: 'normal', pattern: null, draftClips: null, selectionIds: [], source: 'other' });
const subject = (id = 'r1', extra = {}) => ({ id, kind: 'recipe', name: 'Front swell', owner: 'Front jets', memberIds: ['a', 'b'], clips: [{ fixtureId: 'a', startTime: 2, duration: 4 }], origin: 2, duration: 4, ...extra });
const state = () => useFocusPreviewStore.getState();

describe('pattern preview window geometry', () => {
  it('resizes from west/north edges keeping the opposite edge fixed, never below the minimum', () => {
    const r = { x: 100, y: 100, width: 400, height: 300 };
    expect(resizeRect(r, 'w', 50, 0)).toEqual({ x: 150, y: 100, width: 350, height: 300 });
    expect(resizeRect(r, 'n', 0, -20)).toEqual({ x: 100, y: 80, width: 400, height: 320 });
    expect(resizeRect(r, 'se', 1000, 1000)).toEqual({ x: 100, y: 100, width: 1400, height: 1300 });
    const tiny = resizeRect(r, 'nw', 1000, 1000);
    expect(tiny.width).toBe(MIN_WIDTH); expect(tiny.height).toBe(MIN_HEIGHT);
    expect(tiny.x + tiny.width).toBe(500); expect(tiny.y + tiny.height).toBe(400);
  });
  it('snaps to the viewport edges on release and stays inside the viewport', () => {
    const s = snapRect({ x: 1000 - 8 - 300 - 10, y: 80, width: 300, height: 200 }, 1000, 700);
    expect(s.x + s.width).toBe(992); expect(s.y).toBe(70);
    expect(snapRect({ x: 400, y: 300, width: 300, height: 200 }, 1000, 700)).toMatchObject({ x: 400, y: 300 });
  });
  it('maximizes into the Show Programming area, minimizes to a title-bar chip, restores under the pointer', () => {
    expect(maximizedRect({ x: 0, y: 48, width: 1000, height: 600 }, 1000, 700)).toEqual({ x: 4, y: 52, width: 992, height: 592 });
    expect(maximizedRect(null, 1000, 700).width).toBeGreaterThan(900);
    const chip = minimizedRect({ x: 500, y: 300, width: 400, height: 300 }, 1000, 700);
    expect(chip.height).toBe(TITLE_HEIGHT); expect(chip.width).toBeLessThanOrEqual(260);
    const rect = { x: 300, y: 200, width: 360, height: 240 };
    expect(displayRect({ mode: 'normal', rect }, null, 1000, 700)).toEqual(rect);
    expect(displayRect({ mode: 'maximized', rect }, { x: 0, y: 48, width: 1000, height: 600 }, 1000, 700).width).toBe(992);
    expect(displayRect({ mode: 'minimized', rect }, null, 1000, 700).height).toBe(TITLE_HEIGHT);
    const restored = restoreUnderPointer(rect, { x: 0, y: 0, width: 1000, height: 600 }, 500, 10);
    expect(restored.x).toBe(500 - 180); expect(restored.width).toBe(360);
  });
  it('keyboard alternative to dragging: arrows move, Shift+arrows resize', () => {
    const r = { x: 100, y: 100, width: 300, height: 200 };
    expect(nudgeRect(r, 'ArrowRight')).toMatchObject({ x: 116, width: 300 });
    expect(nudgeRect(r, 'ArrowDown', { resize: true })).toMatchObject({ y: 100, height: 216 });
    expect(nudgeRect(r, 'a')).toBe(null);
  });
});

describe('pattern preview store', () => {
  beforeEach(reset);
  it('a selected or added pattern opens the window; an edit updates it without reopening', () => {
    state().showPattern(subject(), { reveal: true });
    expect(state()).toMatchObject({ open: true, pattern: { name: 'Front swell' } });
    const rev = state().patternRevision;
    state().showPattern(subject('r1', { duration: 6 }));
    expect(state().pattern.duration).toBe(6);
    expect(state().patternRevision).toBe(rev + 1);
    state().showPattern(subject('r1', { duration: 6 })); // identical: no work
    expect(state().patternRevision).toBe(rev + 1);
  });
  it('closing is respected for the session until reopened; auto-open off never opens by itself', () => {
    state().showPattern(subject(), { reveal: true }); state().close();
    state().showPattern(subject('r2'), { reveal: true });
    expect(state().open).toBe(false);
    state().select(['x'], { source: 'studio' });
    expect(state().open).toBe(false);
    state().toggleOpen();
    expect(state()).toMatchObject({ open: true, dismissed: false });
    reset(); state().setAutoOpen(false);
    state().showPattern(subject('r3'), { reveal: true });
    expect(state().open).toBe(false);
    expect(JSON.parse(localStorage.getItem(UI_KEY)).autoOpen).toBe(false);
    state().setAutoOpen(true);
  });
  it('minimize / maximize / restore and persistence of the rect', () => {
    state().toggleMaximize(); expect(state().mode).toBe('maximized');
    state().toggleMinimize(); expect(state().mode).toBe('minimized');
    state().toggleMinimize(); expect(state().mode).toBe('maximized'); // un-minimize returns to maximized
    state().toggleMaximize(); expect(state().mode).toBe('normal');
    expect(JSON.parse(localStorage.getItem(UI_KEY)).mode).toBe('normal');
    state().setRect({ x: 200, y: 200, width: 400, height: 300 });
    expect(JSON.parse(localStorage.getItem(RECT_KEY))).toMatchObject({ x: 200, y: 200, width: 400, height: 300 });
    state().setRect({ x: 210, y: 200, width: 400, height: 300 }, { persist: false }); // mid-drag
    expect(JSON.parse(localStorage.getItem(RECT_KEY)).x).toBe(200);
  });
  it('hides while Show Studio is in the background unless pinned', () => {
    state().select(['a'], { source: 'studio' }); state().setStudioActive(false);
    expect(previewVisible(state())).toBe(false);
    state().togglePin(); expect(previewVisible(state())).toBe(true);
    state().setStudioActive(true);
  });
});

describe('what the preview plays', () => {
  const items = inventory([{ id: 'a', type: 'nozzle_foam_dn40', x: 0, y: 0 }, { id: 'b', type: 'nozzle_foam_dn40', x: 2, y: 0 }]);
  const group = { id: 'g1', name: 'Front jets', memberFixtureIds: ['a', 'b'], orderMode: 'engineering' };
  it('compiles only the selected pattern (its builder unit) and pins the loop to its own start/length', () => {
    const r1 = { ...newRecipe('g1', 10), id: 'r1', name: 'Swell', duration: 6 };
    const r2 = { ...newRecipe('g1', 30), id: 'r2', name: 'Other' };
    const studio = { ...readStudio({}), groups: [group], recipes: [r1, r2] };
    const s = patternSubject(studio, items, 'r1');
    expect(s).toMatchObject({ name: 'Swell', owner: 'Front jets', memberIds: ['a', 'b'], origin: 10 });
    expect(s.duration).toBeCloseTo(6);
    expect(s.clips.length).toBeGreaterThan(0);
    expect(s.clips.every(c => c.startTime >= 10 && c.startTime < 16)).toBe(true);
    const local = localizeClips(s.clips, { origin: s.origin, duration: s.duration });
    expect(Math.min(...local.clips.map(c => c.startTime))).toBeGreaterThanOrEqual(0);
    expect(local.duration).toBeCloseTo(6);
    const unit = { ...studio, recipes: [{ ...r1, pattern: { id: 'p1', role: 'water' } }, { ...r2, start: 12, pattern: { id: 'p1', role: 'lights' } }] };
    expect(patternRecipes(unit, 'r1').map(r => r.id)).toEqual(['r1', 'r2']);
    expect(patternSubject(unit, items, 'missing')).toBe(null);
  });
  it('loop time wraps into the (possibly edited) pattern length', () => {
    expect(loopTime(5, 4)).toBeCloseTo(1);
    expect(loopTime(3, 4)).toBe(3);
    expect(loopTime(3, 2)).toBeCloseTo(1);
    expect(loopTime(NaN, 4)).toBe(0);
    expect(loopTime(2, 0)).toBe(0);
  });
});
