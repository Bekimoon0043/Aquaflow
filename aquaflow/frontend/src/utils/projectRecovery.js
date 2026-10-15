/**
 * projectRecovery.js — AF-NEXT-006 autosave snapshots and crash-recovery detection.
 *
 * Two interchangeable snapshot backends with one interface:
 *   desktop  → window.aquaflow.project (snapshots in <userData>/project-recovery/snapshots,
 *              session lock + clean-save log in the main process)
 *   browser  → IndexedDB "aquaflow-autosave-v1" + a localStorage session lock
 *
 *   backend.write(projectKey, project, meta) → { id, savedAt }   (project: object or its JSON string)
 *   backend.list(projectKey|null)            → [{ id, projectKey, name, savedAt, time, originalPath }]
 *   backend.read(id)                          → { meta, project }
 *   backend.discard(id|null)
 *   backend.recoveryInfo()                    → { uncleanExit, cleanSaves, snapshots }
 *   backend.markClean(projectKey, info)
 *
 * Snapshots never write to the user's project file. Errors are thrown to the caller (the
 * autosave hook surfaces them); nothing here swallows a failed write.
 */

export const SNAPSHOT_LIMIT = 3;                              // per project
export const SNAPSHOT_GLOBAL_LIMIT = 50;                     // across all projects
export const SNAPSHOT_MAX_TOTAL_BYTES = 300 * 1024 * 1024;   // across all projects

export const desktopProjectBridge = () =>
  (typeof window !== "undefined" && window.aquaflow?.project) ? window.aquaflow.project : null;

/**
 * Pure: which snapshots to delete so each project keeps `limit` newest, at most
 * `globalLimit` overall and at most `maxTotalBytes` in total (entry.size), oldest first.
 * The newest snapshot of every project is always kept — it is the one crash recovery offers.
 */
export function planSnapshotRotation(entries, limit = SNAPSHOT_LIMIT, globalLimit = SNAPSHOT_GLOBAL_LIMIT, maxTotalBytes = Infinity) {
  const sorted = [...entries].sort((a, b) => b.time - a.time || String(b.id).localeCompare(String(a.id)));
  const keyOf = (e) => e.projectKey ?? e.key;
  const newest = new Set();
  const perKey = new Map();
  let count = 0, bytes = 0;
  for (const entry of sorted) {
    if (perKey.has(keyOf(entry))) continue;
    perKey.set(keyOf(entry), 1);
    newest.add(entry);
    count += 1; bytes += Number(entry.size) || 0;
  }
  const keep = [], drop = [];
  let overBudget = false;
  for (const entry of sorted) {
    if (newest.has(entry)) { keep.push(entry); continue; }
    const n = perKey.get(keyOf(entry)) + 1;
    perKey.set(keyOf(entry), n);
    const size = Number(entry.size) || 0;
    if (!overBudget && bytes + size > maxTotalBytes) overBudget = true;
    if (n > limit || count >= globalLimit || overBudget) { drop.push(entry); continue; }
    keep.push(entry); count += 1; bytes += size;
  }
  return { keep, drop };
}

/**
 * Pure: should the app offer crash recovery? Only after an unclean exit, and only for a
 * snapshot newer than that project's last clean save. Returns the newest such snapshot.
 */
export function findRecoveryCandidate({ uncleanExit, snapshots = [], cleanSaves = {} }) {
  if (!uncleanExit) return null;
  const newest = [...snapshots].filter((s) => !s.corrupt).sort((a, b) => timeOf(b) - timeOf(a));
  for (const snap of newest) {
    const key = snap.projectKey || snap.key;
    const clean = Date.parse(cleanSaves?.[key]?.savedAt || "") || 0;
    if (timeOf(snap) > clean) return { snapshot: snap, lastCleanSaveAt: clean ? new Date(clean).toISOString() : null };
  }
  return null;
}
const timeOf = (s) => Number(s.time) || Date.parse(s.savedAt || "") || 0;

// ── Browser session lock (localStorage) ─────────────────────────────────────────────

const LOCK_KEY = "aquaflow_session_lock";
const CLEAN_KEY = "aquaflow_clean_saves";

export function acquireBrowserSessionLock(storage = globalThis.localStorage, now = () => Date.now()) {
  let previous = null;
  try { previous = JSON.parse(storage.getItem(LOCK_KEY) || "null"); } catch { previous = { unreadable: true }; }
  try { storage.setItem(LOCK_KEY, JSON.stringify({ startedAt: new Date(now()).toISOString() })); } catch { /* storage unavailable */ }
  return { uncleanExit: previous !== null, previous };
}

export function releaseBrowserSessionLock(storage = globalThis.localStorage) {
  try { storage.removeItem(LOCK_KEY); } catch { /* ignore */ }
}

function readCleanSaves(storage) {
  try { return JSON.parse(storage.getItem(CLEAN_KEY) || "{}") || {}; } catch { return {}; }
}

// ── Generic key/value snapshot backend (IndexedDB in the browser, Map in tests) ──────

export function createKvSnapshotBackend(kv, { limit = SNAPSHOT_LIMIT, globalLimit = SNAPSHOT_GLOBAL_LIMIT, maxTotalBytes = SNAPSHOT_MAX_TOTAL_BYTES, now = () => Date.now(), storage = globalThis.localStorage, session = null } = {}) {
  let seq = 0;
  // `project` may be the object or (from autosave) its JSON string, stored as-is.
  const metaOf = ({ project, projectJson, ...meta }) => meta;
  return {
    kind: "browser",
    async write(projectKey, project, meta = {}) {
      const time = now();
      seq = (seq + 1) % 1000;
      const id = `snap-${String(time).padStart(13, "0")}-${String(seq).padStart(3, "0")}`;
      const isJson = typeof project === "string";
      const record = {
        ...meta, id, projectKey: String(projectKey || "untitled"), time, savedAt: new Date(time).toISOString(),
        size: isJson ? project.length : Number(meta.bytes) || 0,
        ...(isJson ? { projectJson: project } : { project }),
      };
      await kv.put(record);
      const all = (await kv.getAll()).map(metaOf);
      const { drop } = planSnapshotRotation(all, limit, globalLimit, maxTotalBytes);
      for (const entry of drop) await kv.delete(entry.id);
      return { id, savedAt: record.savedAt };
    },
    async list(projectKey = null) {
      const all = (await kv.getAll()).map(metaOf);
      return all.filter((s) => projectKey == null || s.projectKey === String(projectKey)).sort((a, b) => b.time - a.time);
    },
    async read(id) {
      const rec = await kv.get(id);
      if (!rec) throw new Error("Snapshot not found.");
      return { meta: metaOf(rec), project: typeof rec.projectJson === "string" ? JSON.parse(rec.projectJson) : rec.project };
    },
    async discard(id = null) {
      if (id == null) { for (const s of await kv.getAll()) await kv.delete(s.id); return true; }
      await kv.delete(id); return true;
    },
    async markClean(projectKey, info = {}) {
      const all = readCleanSaves(storage);
      all[String(projectKey || "untitled")] = { ...info, savedAt: new Date(now()).toISOString() };
      try { storage.setItem(CLEAN_KEY, JSON.stringify(all)); } catch (e) { throw new Error(`Could not record the clean save: ${e.message}`); }
    },
    async recoveryInfo() {
      return { uncleanExit: !!session?.uncleanExit, cleanSaves: readCleanSaves(storage), snapshots: await this.list(null) };
    },
  };
}

export function createMemoryKv() {
  const map = new Map();
  return {
    map,
    async put(rec) { map.set(rec.id, JSON.parse(JSON.stringify(rec))); },
    async get(id) { return map.get(id) || null; },
    async getAll() { return [...map.values()]; },
    async delete(id) { map.delete(id); },
  };
}

export function createIndexedDbKv(dbName = "aquaflow-autosave-v1", storeName = "snapshots") {
  const open = () => new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("IndexedDB is unavailable; autosave snapshots cannot be stored in this browser."));
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(storeName, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (mode, op) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const req = op(tx.objectStore(storeName));
        let result;
        req.onsuccess = () => { result = req.result; };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Autosave transaction aborted (storage full?)."));
      });
    } finally { db.close(); }
  };
  return {
    put: (rec) => run("readwrite", (s) => s.put(rec)),
    get: (id) => run("readonly", (s) => s.get(id)).then((r) => r || null),
    getAll: () => run("readonly", (s) => s.getAll()),
    delete: (id) => run("readwrite", (s) => s.delete(id)),
  };
}

// ── Desktop backend ─────────────────────────────────────────────────────────────────

const unwrap = (res, what) => {
  if (!res || res.ok === false) throw new Error(res?.error || `${what} failed`);
  return res;
};

export function createDesktopSnapshotBackend(bridge) {
  const norm = (s) => ({ ...s, projectKey: s.projectKey || s.key });
  return {
    kind: "desktop",
    async write(projectKey, project, meta = {}) { return unwrap(await bridge.writeSnapshot(projectKey, project, meta), "Autosave snapshot"); },
    async list(projectKey = null) { return (unwrap(await bridge.listSnapshots(projectKey), "Listing snapshots").snapshots || []).map(norm); },
    async read(id) { const s = unwrap(await bridge.readSnapshot(id), "Reading snapshot").snapshot; return { meta: s.meta, project: s.project }; },
    async discard(id = null) { return unwrap(await bridge.discardSnapshot(id), "Discarding snapshot"); },
    async markClean(projectKey, info = {}) { return unwrap(await bridge.markClean(projectKey, info), "Recording clean save"); },
    async recoveryInfo() {
      const r = unwrap(await bridge.recoveryInfo(), "Recovery check");
      return { uncleanExit: r.uncleanExit, cleanSaves: r.cleanSaves || {}, snapshots: (r.snapshots || []).map(norm), snapshotDir: r.snapshotDir };
    },
  };
}

// ── Singleton for the app ───────────────────────────────────────────────────────────

let backend = null;
let browserSession = null;

/** The app's snapshot backend. The first call in a browser session acquires the session lock. */
export function getSnapshotBackend() {
  if (backend) return backend;
  const bridge = desktopProjectBridge();
  if (bridge) {
    backend = createDesktopSnapshotBackend(bridge);
  } else {
    browserSession = acquireBrowserSessionLock();
    if (typeof window !== "undefined") {
      // pagehide fires for both close and reload; only a clean unload removes the lock.
      window.addEventListener("pagehide", () => releaseBrowserSessionLock());
    }
    backend = createKvSnapshotBackend(createIndexedDbKv(), { session: browserSession });
  }
  return backend;
}

export function __resetSnapshotBackendForTests(next = null) { backend = next; browserSession = null; }
