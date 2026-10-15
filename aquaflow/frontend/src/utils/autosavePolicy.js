/**
 * autosavePolicy.js — when may autosave write a snapshot? (AF-NEXT-006 hardening)
 *
 * Autosave used to serialise the whole project to JSON on every tick just to compare it with
 * the previous snapshot. The engineering payload carries a fresh `exported_at` stamp, so the
 * comparison never matched and a full snapshot was written every 30 s even with no edits —
 * on a 75 MB show that froze the renderer and filled the snapshot folder.
 *
 * Now:
 *  - a cheap change counter (createProjectChangeTracker) bumps only when a store slice that
 *    is saved into the project changes reference (zustand/immer give edited slices new
 *    references) or a store flips to dirty. No JSON is built to detect changes.
 *  - shouldWriteSnapshot() writes only when that counter moved since the last snapshot or
 *    clean save, and backs off for large projects (≥ LARGE_PROJECT_MIN_GAP_MS between writes).
 */

export const AUTOSAVE_TICK_MS = 30_000;
export const LARGE_PROJECT_BYTES = 15 * 1024 * 1024;
export const LARGE_PROJECT_MIN_GAP_MS = 3 * 60_000;
export const HUGE_PROJECT_BYTES = 60 * 1024 * 1024;
export const HUGE_PROJECT_MIN_GAP_MS = 5 * 60_000;

/**
 * State slices that end up in the saved project. Volatile runtime fields (playhead,
 * playback state, device health/last_seen, connection state, UI zoom, active panel) are
 * deliberately absent so they never trigger a snapshot.
 */
export const PROJECT_CONTENT_KEYS = Object.freeze({
  show: ["currentShow", "nodes", "connections", "timelineTracks", "audioData", "manualPatterns",
    "manualPatternMeta", "manualPriority", "manualPatternConfig", "generatedTracks"],
  engineering: ["projectName", "projectId", "poolType", "params", "geometry", "basins", "fixtures", "groups",
    "siteModels", "siteSurfaces", "cadUnderlay", "layers", "measurements", "depthZones", "hydraulicSummary",
    "solvedHydraulics", "bomItems", "manualPipes", "pipes"],
  project: ["metadata", "render", "programmer", "integrations"],
});

const DIRTY_FLAG = { show: "isDirty", engineering: null, project: "dirty" };

/** Pure: did this store update touch project content? */
export function isContentChange(kind, state, prev) {
  if (!state || !prev) return false;
  const flag = DIRTY_FLAG[kind];
  if (flag && state[flag] && !prev[flag]) return true;
  return (PROJECT_CONTENT_KEYS[kind] || []).some((key) => state[key] !== prev[key]);
}

/**
 * Subscribe to the project stores ({ show, engineering, project } zustand stores) and count
 * content changes. `onChange` is called after each counted change (used for the debounce).
 */
export function createProjectChangeTracker(stores, onChange = null) {
  let revision = 0;
  const unsubs = Object.entries(stores).filter(([, store]) => store?.subscribe).map(([kind, store]) =>
    store.subscribe((state, prev) => {
      if (!isContentChange(kind, state, prev)) return;
      revision += 1;
      onChange?.(revision);
    }));
  return {
    revision: () => revision,
    dispose: () => unsubs.forEach((u) => u()),
  };
}

/** Minimum time between two snapshots for a project whose last snapshot was `bytes` long. */
export function minSnapshotGapMs(bytes) {
  const n = Number(bytes) || 0;
  if (n >= HUGE_PROJECT_BYTES) return HUGE_PROJECT_MIN_GAP_MS;
  if (n >= LARGE_PROJECT_BYTES) return LARGE_PROJECT_MIN_GAP_MS;
  return 0;
}

/**
 * Pure decision. No write when nothing changed since the last snapshot / clean save; for
 * large projects, no write until the back-off gap since the previous snapshot has elapsed
 * (the next interval tick retries, so the edit is not lost).
 */
export function shouldWriteSnapshot({ revision, savedRevision, lastBytes = 0, lastWriteAt = 0, now = Date.now() }) {
  if (revision === savedRevision) return false;
  const gap = minSnapshotGapMs(lastBytes);
  return !(gap && lastWriteAt && now - lastWriteAt < gap);
}
