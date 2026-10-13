// AquaFlow Studio — project files, autosave snapshots and crash detection (AF-NEXT-006).
//
// Everything that touches the user's project on disk lives here so it can be unit-tested
// with node --test (desktop/tests/project-files.test.cjs) without starting Electron:
//
//  * atomicWriteFile — write <file>.tmp, fsync, keep <file>.bak of the previous version,
//    rename over <file>. A failure at any step leaves the original byte-for-byte intact.
//  * snapshot store  — rolling N timestamped autosave snapshots per project in the user
//    data dir. Snapshots never touch the original project file.
//  * session lock    — a lock file written at startup and removed on clean quit. Finding it
//    at the next startup means the previous session ended uncleanly (crash / kill).
//  * clean-save log  — per project key, when the user last saved cleanly. The renderer
//    offers recovery only when a snapshot is newer than that.
//  * recent files, asset hashing/resolution for the asset manifest.
//
// registerProjectIpc() exposes these to the renderer (preload.js → window.aquaflow.project).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SNAPSHOT_LIMIT = 10;          // per project
const SNAPSHOT_GLOBAL_LIMIT = 50;   // across all projects
const MAX_PROJECT_BYTES = 512 * 1024 * 1024;
const MAX_ASSET_READ_BYTES = 512 * 1024 * 1024;
const PROJECT_EXTENSIONS = [".aqua", ".aquapkg", ".aquashow", ".json"];
const ASSET_EXTENSIONS = new Set([
  ".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus", ".webm",
  ".glb", ".gltf", ".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx2", ".hdr", ".exr",
  ".dxf", ".dwg", ".pdf", ".svg",
]);

// ── Atomic write ────────────────────────────────────────────────────────────────────

const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);

function renameWithRetry(fsx, from, to, tries = 5) {
  for (let attempt = 1; ; attempt++) {
    try { fsx.renameSync(from, to); return; }
    catch (e) {
      // Windows: antivirus / indexers briefly hold handles on freshly written files.
      if (attempt >= tries || !RETRYABLE.has(e && e.code)) throw e;
      const until = Date.now() + 25 * attempt;
      while (Date.now() < until) { /* short spin; this is a rare path */ }
    }
  }
}

/**
 * Write `data` to `target` atomically. Sequence:
 *   1. write <target>.tmp and fsync it (bytes are durable before anything else changes)
 *   2. copy the current <target> to <target>.bak (the previous good version)
 *   3. rename <target>.tmp over <target> (atomic on the same volume)
 * If any step throws, <target> is untouched and the temp file is removed.
 * `options.fs` lets tests inject a failing filesystem.
 */
function atomicWriteFile(target, data, options = {}) {
  const fsx = options.fs || fs;
  const keepBackup = options.keepBackup !== false;
  const bytes = Buffer.isBuffer(data) ? data
    : data instanceof Uint8Array ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
      : Buffer.from(String(data), "utf8");
  const tmp = `${target}.tmp`;
  const bak = `${target}.bak`;
  fsx.mkdirSync(path.dirname(target), { recursive: true });
  let fd = null;
  try {
    fd = fsx.openSync(tmp, "w");
    let offset = 0;
    while (offset < bytes.length) offset += fsx.writeSync(fd, bytes, offset, bytes.length - offset);
    fsx.fsyncSync(fd);
    fsx.closeSync(fd);
    fd = null;
    if (keepBackup && fsx.existsSync(target)) fsx.copyFileSync(target, bak);
    renameWithRetry(fsx, tmp, target);
  } catch (e) {
    if (fd !== null) { try { fsx.closeSync(fd); } catch { /* ignore */ } }
    try { fsx.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw e;
  }
  // Best effort: persist the directory entry (not supported for directories on Windows).
  try { const dfd = fsx.openSync(path.dirname(target), "r"); try { fsx.fsyncSync(dfd); } finally { fsx.closeSync(dfd); } }
  catch { /* ignore */ }
  return { path: target, size: bytes.length, backup: keepBackup && fsx.existsSync(bak) ? bak : null };
}

// ── Snapshots ───────────────────────────────────────────────────────────────────────

function safeKey(key) {
  return String(key || "untitled").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80) || "untitled";
}

const SNAP_RE = /^snap-(\d{13})-(\d{3})-([a-zA-Z0-9_-]+)\.json$/;

/** Pure rotation plan: returns the entries to delete so each key keeps `limit` newest. */
function planSnapshotRotation(entries, limit = SNAPSHOT_LIMIT, globalLimit = SNAPSHOT_GLOBAL_LIMIT) {
  const sorted = [...entries].sort((a, b) => b.time - a.time || b.seq - a.seq);
  const perKey = new Map();
  const keep = [], drop = [];
  for (const entry of sorted) {
    const n = (perKey.get(entry.key) || 0) + 1;
    perKey.set(entry.key, n);
    if (n > limit || keep.length >= globalLimit) drop.push(entry); else keep.push(entry);
  }
  return { keep, drop };
}

function createSnapshotStore({ dir, limit = SNAPSHOT_LIMIT, globalLimit = SNAPSHOT_GLOBAL_LIMIT, fs: fsx = fs, now = () => Date.now() }) {
  let seq = 0;
  const list = () => {
    let names = [];
    try { names = fsx.readdirSync(dir); } catch { return []; }
    return names.map((name) => {
      const m = SNAP_RE.exec(name);
      return m ? { name, file: path.join(dir, name), time: Number(m[1]), seq: Number(m[2]), key: m[3] } : null;
    }).filter(Boolean).sort((a, b) => b.time - a.time || b.seq - a.seq);
  };
  const readMeta = (entry) => {
    try {
      const doc = JSON.parse(fsx.readFileSync(entry.file, "utf8"));
      return { id: entry.name, key: entry.key, savedAt: new Date(entry.time).toISOString(), time: entry.time, ...(doc.meta || {}) };
    } catch {
      return { id: entry.name, key: entry.key, savedAt: new Date(entry.time).toISOString(), time: entry.time, corrupt: true };
    }
  };
  return {
    dir,
    write(projectKey, project, meta = {}) {
      const key = safeKey(projectKey);
      const time = now();
      seq = (seq + 1) % 1000;
      const name = `snap-${String(time).padStart(13, "0")}-${String(seq).padStart(3, "0")}-${key}.json`;
      const doc = { aquaflowSnapshot: 1, meta: { ...meta, projectKey: String(projectKey || "untitled"), savedAt: new Date(time).toISOString() }, project };
      atomicWriteFile(path.join(dir, name), JSON.stringify(doc), { fs: fsx, keepBackup: false });
      const { drop } = planSnapshotRotation(list(), limit, globalLimit);
      for (const entry of drop) { try { fsx.rmSync(entry.file, { force: true }); } catch { /* next write retries */ } }
      return { id: name, key, savedAt: doc.meta.savedAt };
    },
    list(projectKey) {
      const key = projectKey == null ? null : safeKey(projectKey);
      return list().filter((e) => key === null || e.key === key).map(readMeta);
    },
    read(id) {
      if (!SNAP_RE.test(String(id))) throw new Error("Unknown snapshot.");
      const doc = JSON.parse(fsx.readFileSync(path.join(dir, id), "utf8"));
      return doc;
    },
    discard(id) {
      if (id == null) { for (const e of list()) fsx.rmSync(e.file, { force: true }); return true; }
      if (!SNAP_RE.test(String(id))) throw new Error("Unknown snapshot.");
      fsx.rmSync(path.join(dir, id), { force: true });
      return true;
    },
  };
}

// ── Session lock (unclean-exit detection) ─────────────────────────────────────────────

/**
 * Acquire the session lock. If a lock from a previous session is still present, that
 * session never reached a clean quit → `uncleanExit: true`. The new lock is then written.
 */
function acquireSessionLock(dir, { fs: fsx = fs, pid = process.pid, now = () => Date.now() } = {}) {
  const file = path.join(dir, "session.lock");
  let previous = null;
  try { previous = JSON.parse(fsx.readFileSync(file, "utf8")); }
  catch (e) { if (e && e.code !== "ENOENT") previous = { unreadable: true }; }
  const lock = { pid, startedAt: new Date(now()).toISOString() };
  atomicWriteFile(file, JSON.stringify(lock), { fs: fsx, keepBackup: false });
  return { file, uncleanExit: previous !== null, previous, lock };
}

function releaseSessionLock(dir, { fs: fsx = fs } = {}) {
  try { fsx.rmSync(path.join(dir, "session.lock"), { force: true }); return true; }
  catch { return false; }
}

// ── Small JSON state files (clean saves, recent files) ───────────────────────────────

function readJson(file, fallback, fsx = fs) {
  try { return JSON.parse(fsx.readFileSync(file, "utf8")); } catch { return fallback; }
}

function recordCleanSave(dir, projectKey, info = {}, { fs: fsx = fs, now = () => Date.now() } = {}) {
  const file = path.join(dir, "clean-saves.json");
  const all = readJson(file, {}, fsx);
  all[String(projectKey || "untitled")] = { ...info, savedAt: new Date(now()).toISOString() };
  atomicWriteFile(file, JSON.stringify(all, null, 2), { fs: fsx, keepBackup: false });
  return all;
}

function addRecentFile(dir, entry, { fs: fsx = fs, limit = 10, now = () => Date.now() } = {}) {
  const file = path.join(dir, "recent-files.json");
  const list = readJson(file, [], fsx);
  const norm = (p) => path.resolve(String(p)).toLowerCase();
  const next = [{ ...entry, openedAt: new Date(now()).toISOString() },
    ...(Array.isArray(list) ? list : []).filter((r) => r && r.path && norm(r.path) !== norm(entry.path))].slice(0, limit);
  atomicWriteFile(file, JSON.stringify(next, null, 2), { fs: fsx, keepBackup: false });
  return next;
}

function listRecentFiles(dir, { fs: fsx = fs } = {}) {
  const list = readJson(path.join(dir, "recent-files.json"), [], fsx);
  return (Array.isArray(list) ? list : []).map((r) => ({ ...r, exists: !!r.path && fsx.existsSync(r.path) }));
}

// ── Assets ──────────────────────────────────────────────────────────────────────────

function sha256File(file, fsx = fs) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fsx.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function describeAsset(file, fsx = fs) {
  const st = fsx.statSync(file);
  if (!st.isFile()) throw new Error("Not a file");
  return { path: file, size: st.size, sha256: await sha256File(file, fsx), modifiedAt: st.mtime.toISOString() };
}

/**
 * Find an asset on this PC. Order: relativePath against the project folder → recorded
 * absolute path → the same file name alongside the project (project dir, its assets/,
 * audio/, models/, textures/ sub-folders, and any extra search dirs).
 */
function resolveAssetPath(ref, { projectDir = null, searchDirs = [], fs: fsx = fs } = {}) {
  const tried = [];
  const exists = (p) => { tried.push(p); try { return fsx.statSync(p).isFile(); } catch { return false; } };
  if (ref.relativePath && projectDir) {
    const p = path.resolve(projectDir, ref.relativePath);
    if (exists(p)) return { found: true, path: p, via: "relative", tried };
  }
  if (ref.path && path.isAbsolute(ref.path) && exists(ref.path)) return { found: true, path: ref.path, via: "absolute", tried };
  const name = ref.name || (ref.path ? path.basename(String(ref.path).replace(/\\/g, "/")) : null);
  if (name) {
    const dirs = [];
    if (projectDir) for (const sub of ["", "assets", "audio", "media", "models", "textures"]) dirs.push(path.join(projectDir, sub));
    for (const d of searchDirs) if (d) dirs.push(d);
    for (const d of dirs) {
      const p = path.join(d, path.basename(name));
      if (exists(p)) return { found: true, path: p, via: "search", tried };
    }
  }
  return { found: false, path: null, via: null, tried };
}

function assertAssetPath(p) {
  if (typeof p !== "string" || !path.isAbsolute(p)) throw new Error("Asset paths must be absolute.");
  if (!ASSET_EXTENSIONS.has(path.extname(p).toLowerCase())) throw new Error(`Unsupported asset type: ${path.extname(p) || "(none)"}`);
}

function assertProjectPath(p) {
  if (typeof p !== "string" || !path.isAbsolute(p)) throw new Error("Project paths must be absolute.");
  if (!PROJECT_EXTENSIONS.includes(path.extname(p).toLowerCase())) throw new Error("Choose an .aqua, .aquapkg or .aquashow project file.");
}

// ── IPC ─────────────────────────────────────────────────────────────────────────────

function registerProjectIpc({ ipcMain, dialog, getMainWindow, userDataDir, sessionInfo = null, fs: fsx = fs }) {
  const stateDir = path.join(userDataDir, "project-recovery");
  const snapshots = createSnapshotStore({ dir: path.join(stateDir, "snapshots"), fs: fsx });
  const senderAllowed = (event) => {
    const win = getMainWindow();
    return !!win && event.sender === win.webContents && (!event.senderFrame || event.senderFrame === event.sender.mainFrame);
  };
  const guarded = (fn) => async (event, ...args) => {
    if (!senderAllowed(event)) return { ok: false, error: "Untrusted project request." };
    try { return await fn(...args); }
    catch (e) { return { ok: false, error: String(e && e.message ? e.message : e), code: e && e.code }; }
  };
  const handle = (name, fn) => ipcMain.handle(name, guarded(fn));
  const filters = [
    { name: "AquaFlow Project", extensions: ["aqua"] },
    { name: "AquaFlow Package", extensions: ["aquapkg"] },
    { name: "AquaFlow Show", extensions: ["aquashow", "json"] },
    { name: "All Files", extensions: ["*"] },
  ];

  handle("project:save", async (request = {}) => {
    const kind = request.kind === "package" ? "aquapkg" : "aqua";
    let target = request.path || null;
    if (!target || request.saveAs) {
      const base = String(request.suggestedName || "AquaFlow-Show").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100) || "AquaFlow-Show";
      const res = await dialog.showSaveDialog(getMainWindow(), {
        title: kind === "aquapkg" ? "Package AquaFlow Project" : "Save AquaFlow Project",
        defaultPath: request.path && kind === "aqua" ? request.path : `${base}.${kind}`,
        filters: [filters[kind === "aquapkg" ? 1 : 0]],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      target = res.filePath.toLowerCase().endsWith(`.${kind}`) ? res.filePath : `${res.filePath}.${kind}`;
    }
    assertProjectPath(target);
    if ((path.extname(target).toLowerCase() === ".aquapkg") !== (kind === "aquapkg")) {
      throw new Error(kind === "aquapkg" ? "Packages must be saved as .aquapkg." : "Use Save As to write a plain project; an .aquapkg is only written by Package Project.");
    }
    const data = request.bytes instanceof Uint8Array ? request.bytes : String(request.content ?? "");
    const size = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
    if (size > MAX_PROJECT_BYTES) throw new Error("Project is larger than 512 MB.");
    const result = atomicWriteFile(target, data, { fs: fsx });
    if (kind === "aqua" && request.projectKey) recordCleanSave(stateDir, request.projectKey, { path: target }, { fs: fsx });
    addRecentFile(stateDir, { path: target, name: request.name || path.basename(target) }, { fs: fsx });
    return { ok: true, ...result };
  });

  // Save As: choose the target first so the renderer can record asset paths relative to it.
  handle("project:save-dialog", async (request = {}) => {
    const kind = request.kind === "package" ? "aquapkg" : "aqua";
    const base = String(request.suggestedName || "AquaFlow-Show").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100) || "AquaFlow-Show";
    const res = await dialog.showSaveDialog(getMainWindow(), {
      title: kind === "aquapkg" ? "Package AquaFlow Project" : "Save AquaFlow Project As",
      defaultPath: request.defaultPath && typeof request.defaultPath === "string" ? request.defaultPath : `${base}.${kind}`,
      filters: [filters[kind === "aquapkg" ? 1 : 0]],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const target = res.filePath.toLowerCase().endsWith(`.${kind}`) ? res.filePath : `${res.filePath}.${kind}`;
    assertProjectPath(target);
    return { ok: true, path: target };
  });

  handle("project:open-dialog", async () => {
    const res = await dialog.showOpenDialog(getMainWindow(), { title: "Open AquaFlow Project", filters, properties: ["openFile"] });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    return { ok: true, path: res.filePaths[0] };
  });

  handle("project:read", async (filePath) => {
    assertProjectPath(filePath);
    const st = fsx.statSync(filePath);
    if (st.size > MAX_PROJECT_BYTES) throw new Error("Project is larger than 512 MB.");
    const bytes = fsx.readFileSync(filePath);
    addRecentFile(stateDir, { path: filePath, name: path.basename(filePath) }, { fs: fsx });
    const isPackage = path.extname(filePath).toLowerCase() === ".aquapkg";
    return { ok: true, path: filePath, kind: isPackage ? "package" : "project", ...(isPackage ? { bytes: new Uint8Array(bytes) } : { content: bytes.toString("utf8") }) };
  });

  handle("project:recent", async () => ({ ok: true, files: listRecentFiles(stateDir, { fs: fsx }) }));
  handle("project:mark-clean", async (projectKey, info) => { recordCleanSave(stateDir, projectKey, info || {}, { fs: fsx }); return { ok: true }; });

  handle("snapshot:write", async (projectKey, project, meta) => ({ ok: true, ...snapshots.write(projectKey, project, meta) }));
  handle("snapshot:list", async (projectKey) => ({ ok: true, snapshots: snapshots.list(projectKey) }));
  handle("snapshot:read", async (id) => ({ ok: true, snapshot: snapshots.read(id) }));
  handle("snapshot:discard", async (id) => ({ ok: snapshots.discard(id) }));

  handle("session:recovery-info", async () => ({
    ok: true,
    uncleanExit: !!(sessionInfo && sessionInfo.uncleanExit),
    previousSession: sessionInfo ? sessionInfo.previous : null,
    cleanSaves: readJson(path.join(stateDir, "clean-saves.json"), {}, fsx),
    snapshots: snapshots.list(null),
    snapshotDir: snapshots.dir,
  }));

  handle("asset:describe", async (refs = [], projectPath = null) => {
    const projectDir = projectPath ? path.dirname(projectPath) : null;
    const out = [];
    for (const ref of Array.isArray(refs) ? refs.slice(0, 500) : []) {
      try {
        const where = ref.path && path.isAbsolute(ref.path) ? { found: fsx.existsSync(ref.path), path: ref.path, via: "absolute" }
          : resolveAssetPath(ref, { projectDir, fs: fsx });
        if (!where.found) { out.push({ id: ref.id, found: false }); continue; }
        assertAssetPath(where.path);
        const d = await describeAsset(where.path, fsx);
        out.push({ id: ref.id, found: true, via: where.via, ...d, relativePath: projectDir ? path.relative(projectDir, d.path).replace(/\\/g, "/") : null });
      } catch (e) { out.push({ id: ref.id, found: false, error: e.message }); }
    }
    return { ok: true, assets: out };
  });

  handle("asset:resolve", async (refs = [], projectPath = null) => {
    const projectDir = projectPath ? path.dirname(projectPath) : null;
    const out = [];
    for (const ref of Array.isArray(refs) ? refs.slice(0, 500) : []) {
      const where = resolveAssetPath(ref, { projectDir, fs: fsx });
      if (!where.found) { out.push({ id: ref.id, found: false, tried: where.tried }); continue; }
      try { assertAssetPath(where.path); out.push({ id: ref.id, found: true, via: where.via, ...(await describeAsset(where.path, fsx)) }); }
      catch (e) { out.push({ id: ref.id, found: false, error: e.message, tried: where.tried }); }
    }
    return { ok: true, assets: out };
  });

  handle("asset:pick", async (options = {}) => {
    const exts = Array.isArray(options.extensions) && options.extensions.length ? options.extensions.map((e) => String(e).replace(/^\./, "")) : ["*"];
    const res = await dialog.showOpenDialog(getMainWindow(), {
      title: options.title || "Locate missing asset", properties: ["openFile"],
      filters: [{ name: options.label || "Asset", extensions: exts }, { name: "All Files", extensions: ["*"] }],
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    assertAssetPath(res.filePaths[0]);
    return { ok: true, ...(await describeAsset(res.filePaths[0], fsx)) };
  });

  handle("asset:read", async (filePath) => {
    assertAssetPath(filePath);
    const st = fsx.statSync(filePath);
    if (st.size > MAX_ASSET_READ_BYTES) throw new Error("Asset is larger than 512 MB.");
    return { ok: true, path: filePath, bytes: new Uint8Array(fsx.readFileSync(filePath)) };
  });

  return { snapshots, stateDir };
}

module.exports = {
  SNAPSHOT_LIMIT, ASSET_EXTENSIONS,
  atomicWriteFile, createSnapshotStore, planSnapshotRotation,
  acquireSessionLock, releaseSessionLock, recordCleanSave, addRecentFile, listRecentFiles,
  sha256File, describeAsset, resolveAssetPath, registerProjectIpc,
};
