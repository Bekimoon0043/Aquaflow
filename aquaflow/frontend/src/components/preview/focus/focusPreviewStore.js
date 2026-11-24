// State of the floating Pattern Preview window (formerly "Focus Preview").
// UI state only: the window rect/mode/auto-open preference live in localStorage,
// never in the project file.
import { create } from 'zustand';
import { clampRect, nudgeRect } from './windowGeometry';
import { subjectSignature } from './patternPreview';

export { clampRect } from './windowGeometry';

export const RECT_KEY = 'aquaflow.focus.rect';
export const UI_KEY = 'aquaflow.patternPreview.ui';
export const PREVIEW_SHORTCUT = 'Alt+P';

const readJson = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };

function readUi() {
  const ui = readJson(UI_KEY) || {};
  return {
    autoOpen: ui.autoOpen !== false,
    mode: ui.mode === 'maximized' || ui.mode === 'minimized' ? ui.mode : 'normal',
    restoreMode: ui.restoreMode === 'maximized' ? 'maximized' : 'normal',
  };
}

const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

export const useFocusPreviewStore = create((set, get) => {
  const persistUi = () => { const { autoOpen, mode, restoreMode } = get(); writeJson(UI_KEY, { autoOpen, mode, restoreMode }); };
  const setMode = (mode, restoreMode = get().restoreMode) => { set({ mode, restoreMode }); persistUi(); };
  // The window opens by itself only while auto-open is on and the user has not closed it this session.
  const mayReveal = () => get().autoOpen && !get().dismissed;
  return {
    // What to show
    selectionIds: [],
    source: 'other', // 'studio' when Show Studio drives the selection
    pattern: null, // { id, kind, name, owner, memberIds, clips, origin, duration }
    patternRevision: 0, // bumps on every edit of the same pattern (keeps the camera and loop position)
    draftStudio: null,
    draftClips: null,
    error: '',
    // Window state
    open: false,
    pinned: false, // stays open when the selection is cleared
    manual: false, // opened explicitly (toolbar / shortcut): an empty selection does not hide it
    dismissed: false, // closed by the user this session: auto-open is suppressed until reopened
    suspended: false, // Show Studio is not the active workspace
    rect: clampRect(readJson(RECT_KEY)),
    ...readUi(),

    select(ids, { source = 'other' } = {}) {
      const next = [...new Set(ids || [])];
      if (sameIds(next, get().selectionIds) && source === get().source) return;
      const s = get();
      const keep = s.open && (s.pinned || s.manual || !!s.pattern || !!s.draftClips);
      set({ selectionIds: next, source, open: next.length > 0 ? s.open || mayReveal() : keep || s.pinned });
    },
    /** Show a pattern. `reveal` (a new selection or a newly added pattern) opens the window; edits never do. */
    showPattern(pattern, { reveal = false } = {}) {
      const s = get();
      const same = s.pattern?.id === pattern?.id;
      if (same && subjectSignature(s.pattern) === subjectSignature(pattern) && !reveal) return;
      set({ pattern, patternRevision: s.patternRevision + 1, open: s.open || (reveal && mayReveal()) });
    },
    clearPattern() { if (get().pattern) set({ pattern: null, patternRevision: get().patternRevision + 1 }); },
    publish({ selectionIds, draftStudio = null, draftClips = null, error = '' }) {
      const s = get();
      set({ selectionIds: [...new Set(selectionIds || s.selectionIds)], draftStudio, draftClips, error, open: s.open || mayReveal() });
    },
    clearDraft() { set({ draftStudio: null, draftClips: null, error: '' }); },
    setStudioActive(active) { if (get().suspended === !active) return; set({ suspended: !active }); },

    // Window manager actions
    setRect(rect, { persist = true } = {}) { const next = clampRect(rect); set({ rect: next }); if (persist) writeJson(RECT_KEY, next); },
    openWindow() { set({ open: true, manual: true, dismissed: false }); if (get().mode === 'minimized') setMode(get().restoreMode); },
    close() { set({ open: false, manual: false, dismissed: true }); },
    toggleOpen() { const s = get(); if (s.open && s.mode !== 'minimized') s.close(); else s.openWindow(); },
    toggleMinimize() { const { mode, restoreMode } = get(); if (mode === 'minimized') setMode(restoreMode); else setMode('minimized', mode); },
    toggleMaximize() { const { mode } = get(); setMode(mode === 'maximized' ? 'normal' : 'maximized', 'normal'); },
    /** Restore to the floating rect (used when a maximized window is dragged by its title bar). */
    restore(rect) { if (rect) get().setRect(rect); setMode('normal', 'normal'); },
    nudge(key, resize = false) { const next = nudgeRect(get().rect, key, { resize }); if (next) get().setRect(next); return !!next; },
    setAutoOpen(autoOpen) { set({ autoOpen: !!autoOpen }); persistUi(); },
    togglePin() { set({ pinned: !get().pinned }); },
    // Compatibility with the old Focus Preview API.
    toggleCollapse() { get().toggleMinimize(); },
  };
});

/** Whether the window is mounted: open, and not hidden because Show Studio (its owner) is in the background. */
export const previewVisible = (s) => s.open && !(s.suspended && s.source === 'studio' && !s.pinned);
