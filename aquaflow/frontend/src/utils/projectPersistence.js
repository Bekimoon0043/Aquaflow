/**
 * projectPersistence.js — AF-NEXT-006 Save / Save As / Open / Package / Restore.
 *
 * Desktop (window.aquaflow.project present): atomic save to a real path through the main
 * process (temp + fsync + .bak + rename), Save overwrites the current path, Save As asks.
 * Browser / dev: Save falls back to the existing Blob download of the .aqua file.
 *
 * Every save embeds an asset manifest (utils/assetManifest.js). Every open of a file with a
 * manifest verifies the assets on this PC and publishes a report on the
 * "aquaflow:asset-report" window event BEFORE the user can start playback (the report
 * dialog is modal). Legacy .aqua files without a manifest load exactly as before.
 *
 * Status/toast messages go out on "aquaflow:project-status" ({ level, text }).
 */
import { useShowStore } from "../store/showStore";
import useEngineeringStore from "../store/engineeringStore";
import useProjectStore from "../store/projectStore";
import { serializeShow, deserializeShow, saveToRecent } from "./showFile";
import {
  buildAssetManifest, verifyAssetManifest, hasManifest, sha256Hex, liveAssetFiles,
  packagedMemberName, describeAssetReport,
} from "./assetManifest";
import { createZip, readZip, zipText } from "./zipStore";
import { desktopProjectBridge, getSnapshotBackend } from "./projectRecovery";

// ── File session state (which file is open; not project data) ──────────────────────
let fileState = { path: null, kind: null, name: null, savedAt: null };
const listeners = new Set();
export const getFileState = () => fileState;
export function subscribeFileState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setFileState(patch) { fileState = { ...fileState, ...patch }; listeners.forEach((fn) => fn(fileState)); }

const emit = (name, detail) => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
};
export const notify = (text, level = "info") => emit("aquaflow:project-status", { text, level, at: Date.now() });
const log = (level, msg) => { try { useShowStore.getState().addServerLog?.({ level, msg }); } catch { /* ignore */ } };

const unwrap = (res, what) => {
  if (res?.canceled) return null;
  if (!res || res.ok === false) throw new Error(res?.error || `${what} failed`);
  return res;
};

export const getProjectKey = () => useProjectStore.getState().metadata?.id || "untitled";

/** The complete .aqua object for the current workspace (no manifest yet). */
export function captureProjectData() {
  const state = useShowStore.getState();
  const project = useProjectStore.getState();
  return serializeShow(state, useEngineeringStore.getState().getProjectPayload(), project.getProjectDocument(state.currentShow?.name));
}

// ── Pending asset attachments (audio Files handed to the Show Programmer) ───────────
const pendingAttachments = new Map();
export function takePendingAsset(id) { const f = pendingAttachments.get(id) || null; pendingAttachments.delete(id); return f; }
function attachAsset(id, file) {
  pendingAttachments.set(id, file);
  liveAssetFiles.set(id, file);
  emit("aquaflow:asset-attached", { id, file });
}
function makeFile(bytes, name, type, path) {
  const file = new File([bytes], name || "asset", { type: type || "" });
  if (path) Object.defineProperty(file, "aquaflowPath", { value: path });
  return file;
}

async function readLibraryModel(ref) {
  const { getImportedModelRecord } = await import("../components/preview/modelLibrary.js");
  const rec = await getImportedModelRecord(ref.locator?.assetId);
  return rec?.blob ? new Uint8Array(await rec.blob.arrayBuffer()) : null;
}

async function manifestFor(data, projectPath) {
  const bridge = desktopProjectBridge();
  return buildAssetManifest(data, {
    projectPath,
    describe: bridge ? async (refs) => unwrap(await bridge.describeAssets(refs, projectPath), "Hashing assets")?.assets || [] : null,
    readLibrary: (ref) => readLibraryModel(ref).catch(() => null),
  });
}

function markSavedEverywhere(name) {
  useShowStore.getState().markClean?.();
  useProjectStore.getState().markSaved?.(name);
}

const safeName = (name) => String(name || "show").replace(/\s+/g, "_").replace(/[<>:"/\\|?*]/g, "_");

function downloadBytes(bytes, filename, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Save ────────────────────────────────────────────────────────────────────────────

/** Save (overwrite current path) or Save As (choose a path). Returns { ok, path?, manifest } | null when cancelled. */
export async function saveProject({ saveAs = false } = {}) {
  const bridge = desktopProjectBridge();
  const data = captureProjectData();
  const name = data.show?.name || "Untitled Show";
  const projectKey = getProjectKey();
  try {
    if (!bridge) {
      // Browser / dev fallback: the original Blob download, now carrying the manifest.
      data.assetManifest = await manifestFor(data, null);
      downloadBytes(JSON.stringify(data, null, 2), `${safeName(name)}.aqua`, "application/json");
      await getSnapshotBackend().markClean(projectKey, { name }).catch(() => {});
      markSavedEverywhere(name);
      saveToRecent({ name, savedAt: data.savedAt });
      setFileState({ path: null, kind: "aqua", name, savedAt: data.savedAt });
      emit("aquaflow:project-baseline", {});
      notify(`Downloaded ${safeName(name)}.aqua`, "info");
      return { ok: true, path: null, manifest: data.assetManifest };
    }
    let target = fileState.kind === "aqua" ? fileState.path : null;
    if (saveAs || !target) {
      const chosen = unwrap(await bridge.saveDialog({ suggestedName: safeName(name), kind: "aqua", defaultPath: fileState.path && fileState.kind === "aqua" ? fileState.path : undefined }), "Save As");
      if (!chosen) return null;
      target = chosen.path;
    }
    data.assetManifest = await manifestFor(data, target);
    const res = unwrap(await bridge.save({ path: target, kind: "aqua", content: JSON.stringify(data, null, 2), projectKey, name }), "Save");
    markSavedEverywhere(name);
    setFileState({ path: res.path, kind: "aqua", name, savedAt: data.savedAt });
    emit("aquaflow:project-baseline", {});
    const unresolved = data.assetManifest.assets.filter((a) => a.source !== "embedded" && !a.sha256);
    log("info", `Project saved atomically: ${res.path}${res.backup ? ` (previous kept as ${res.backup})` : ""}`);
    notify(unresolved.length
      ? `Saved ${res.path}. ${unresolved.length} asset(s) could not be hashed — see the asset report on open.`
      : `Saved ${res.path}`, unresolved.length ? "warn" : "info");
    return { ok: true, path: res.path, manifest: data.assetManifest };
  } catch (e) {
    log("error", `Save failed: ${e.message}`);
    notify(`Save failed — the previous file is unchanged. ${e.message}`, "error");
    throw e;
  }
}

/** Embed every resolvable asset with the manifest into a .aquapkg (ZIP). */
export async function packageProject() {
  const bridge = desktopProjectBridge();
  const data = captureProjectData();
  const name = data.show?.name || "Untitled Show";
  try {
    let target = null;
    if (bridge) {
      const chosen = unwrap(await bridge.saveDialog({ suggestedName: safeName(name), kind: "package" }), "Package");
      if (!chosen) return null;
      target = chosen.path;
    }
    const manifest = await manifestFor(data, target);
    const members = [];
    for (const asset of manifest.assets) {
      let bytes = null;
      if (asset.source === "library") bytes = await readLibraryModel(asset).catch(() => null);
      else if (asset.source === "file") {
        if (bridge && asset.path && asset.sha256) bytes = unwrap(await bridge.readAsset(asset.path), "Reading asset")?.bytes || null;
        else if (liveAssetFiles.get(asset.id)) bytes = new Uint8Array(await liveAssetFiles.get(asset.id).arrayBuffer());
      }
      if (!bytes) continue;
      bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (asset.sha256 && (await sha256Hex(bytes)) !== asset.sha256) throw new Error(`${asset.name} changed while packaging; try again.`);
      asset.packaged = packagedMemberName(asset);
      members.push({ name: asset.packaged, data: bytes });
    }
    data.assetManifest = manifest;
    const missing = manifest.assets.filter((a) => a.source !== "embedded" && !a.packaged);
    const zip = createZip([
      { name: "project.aqua", data: JSON.stringify(data, null, 2) },
      { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
      ...members,
    ]);
    if (bridge) {
      const res = unwrap(await bridge.save({ path: target, kind: "package", bytes: zip, name }), "Package");
      log("info", `Project packaged: ${res.path} (${members.length} asset(s) embedded)`);
      notify(`Packaged ${members.length} asset(s) into ${res.path}${missing.length ? ` — ${missing.length} could not be embedded` : ""}`, missing.length ? "warn" : "info");
    } else {
      downloadBytes(zip, `${safeName(name)}.aquapkg`, "application/zip");
      notify(`Downloaded ${safeName(name)}.aquapkg (${members.length} asset(s) embedded${missing.length ? `, ${missing.length} not available in the browser` : ""})`, missing.length ? "warn" : "info");
    }
    return { ok: true, path: target, manifest, embedded: members.length, missing };
  } catch (e) {
    log("error", `Package failed: ${e.message}`);
    notify(`Package failed: ${e.message}`, "error");
    throw e;
  }
}

// ── Open ────────────────────────────────────────────────────────────────────────────

/** Parse .aquapkg bytes → { data, files } with the embedded project. */
export function parsePackage(bytes) {
  const files = readZip(bytes);
  const projectBytes = files.get("project.aqua");
  if (!projectBytes) throw new Error("This .aquapkg has no project.aqua.");
  return { data: JSON.parse(zipText(projectBytes)), files };
}

/**
 * Resolver used by verifyAssetManifest: packaged bytes → this PC's disk (desktop) → model
 * library. Returns bytes where available so verified assets can be attached immediately.
 */
export function createAssetResolver({ projectPath = null, packageFiles = null, bridge = desktopProjectBridge(), readLibrary = readLibraryModel, restoreModel = null } = {}) {
  return async (asset) => {
    if (packageFiles && asset.packaged && packageFiles.has(asset.packaged)) {
      const bytes = packageFiles.get(asset.packaged);
      const sha256 = await sha256Hex(bytes);
      if (asset.source === "library" && restoreModel) {
        const existing = await readLibrary(asset).catch(() => null);
        if (!existing) await restoreModel({ id: asset.locator.assetId, name: asset.name, bytes });
      }
      return { found: true, via: "package", size: bytes.length, sha256, bytes };
    }
    if (asset.source === "library") {
      const bytes = await readLibrary(asset).catch(() => null);
      return bytes ? { found: true, via: "library", size: bytes.length, sha256: await sha256Hex(bytes) } : { found: false };
    }
    if (asset.source === "file" && bridge) {
      const res = await bridge.resolveAssets([{ id: asset.id, path: asset.path, relativePath: asset.relativePath, name: asset.name }], projectPath);
      const hit = res?.assets?.[0];
      return hit?.found ? { found: true, via: hit.via, path: hit.path, size: hit.size, sha256: hit.sha256 } : { found: false, error: res?.error || null };
    }
    return { found: false };
  };
}

function applyProjectState(data) {
  const state = deserializeShow(data);
  useShowStore.getState().loadShow(state);
  useEngineeringStore.getState().loadProject(state.engineeringProject);
  useProjectStore.getState().loadProjectDocument(state.projectDocument, state.currentShow?.name);
  return state;
}

async function attachVerifiedAudio(report, { packageFiles, bridge }) {
  for (const item of report.items) {
    if (item.role !== "audio" || item.id !== "audio:programmer" || !["ok", "unverified"].includes(item.status)) continue;
    let bytes = null;
    if (packageFiles && item.packaged && packageFiles.has(item.packaged)) bytes = packageFiles.get(item.packaged);
    else if (bridge && item.resolvedPath) bytes = (await bridge.readAsset(item.resolvedPath))?.bytes || null;
    if (bytes) attachAsset(item.id, makeFile(bytes, item.name, item.type, item.resolvedPath || null));
  }
}

/**
 * Load parsed project data into the workspace. With a manifest, assets are verified first
 * and the report is published before this resolves. Returns { state, report|null }.
 */
export async function loadProjectData(data, { path = null, kind = "aqua", packageFiles = null, source = "file" } = {}) {
  if (!data?.aquaflow) throw new Error("Not a valid .aqua file");
  const bridge = desktopProjectBridge();
  let report = null;
  if (hasManifest(data)) {
    const { restoreImportedModel } = await import("../components/preview/modelLibrary.js").catch(() => ({}));
    report = await verifyAssetManifest(data, {
      resolve: createAssetResolver({ projectPath: path, packageFiles, bridge, restoreModel: restoreImportedModel }),
    });
  }
  const state = applyProjectState(data);
  setFileState({ path, kind, name: data.show?.name || null, savedAt: data.savedAt || null });
  if (source !== "snapshot") {
    // What was just opened equals the file on disk: that is this project's clean point.
    emit("aquaflow:project-baseline", {});
    await getSnapshotBackend().markClean(getProjectKey(), { path }).catch(() => {});
  }
  saveToRecent({ name: data.show?.name, savedAt: data.savedAt });
  if (report) {
    describeAssetReport(report).forEach((line) => log(report.needsAttention ? "warn" : "info", `Asset ${line}`));
    emit("aquaflow:asset-report", { report, projectPath: path, kind, source });
    await attachVerifiedAudio(report, { packageFiles, bridge }).catch((e) => notify(`Audio could not be attached: ${e.message}`, "warn"));
  }
  log("info", `Opened ${path || data.show?.name || "project"}${report ? ` — ${report.ok.length}/${report.total} assets verified` : " (legacy file, no asset manifest)"}`);
  return { state, report };
}

export async function openProjectBytes({ bytes = null, text = null, path = null, name = "" }) {
  const isPackage = /\.aquapkg$/i.test(path || name) || (bytes && bytes[0] === 0x50 && bytes[1] === 0x4b);
  if (isPackage) {
    const { data, files } = parsePackage(bytes);
    return loadProjectData(data, { path, kind: "package", packageFiles: files });
  }
  const raw = text ?? new TextDecoder().decode(bytes);
  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new Error(`Invalid .aqua file: ${e.message}`); }
  return loadProjectData(data, { path, kind: "aqua" });
}

/** Desktop: open by absolute path (File > Open, double-click, recent files). */
export async function openProjectPath(path) {
  const bridge = desktopProjectBridge();
  if (!bridge) throw new Error("Opening by path needs the AquaFlow desktop app.");
  try {
    const res = unwrap(await bridge.read(path), "Open");
    return await openProjectBytes(res.kind === "package" ? { bytes: res.bytes, path: res.path } : { text: res.content, path: res.path });
  } catch (e) {
    notify(`Open failed: ${e.message}`, "error");
    throw e;
  }
}

/** Desktop: show the Open dialog. Returns null when cancelled. */
export async function openProjectDialog() {
  const bridge = desktopProjectBridge();
  if (!bridge) return null;
  const chosen = unwrap(await bridge.openDialog(), "Open");
  return chosen ? openProjectPath(chosen.path) : null;
}

/** Browser or drag-and-drop: open a File object (.aqua / .json / .aquapkg). */
export async function openProjectFile(file) {
  if (!/\.(aqua|json|aquapkg|aquashow)$/i.test(file?.name || "")) throw new Error("Please select a .aqua or .aquapkg file");
  let path = null;
  try { path = globalThis.window?.aquaflow?.getPathForFile?.(file) || null; } catch { path = null; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return openProjectBytes({ bytes, path, name: file.name });
}

/** Restore an autosave snapshot. The original file is untouched; Save writes back to it. */
export async function restoreSnapshot(id) {
  const snap = await getSnapshotBackend().read(id);
  const original = snap.meta?.originalPath || null;
  // An original .aquapkg is never overwritten with plain JSON: Save then asks for a new .aqua path.
  const kind = original ? (/\.aquapkg$/i.test(original) ? "package" : "aqua") : null;
  const result = await loadProjectData(snap.project, { path: original, kind, source: "snapshot" });
  // The restored state is newer than the file on disk: keep it dirty until the user saves.
  useShowStore.setState?.({ isDirty: true });
  useProjectStore.setState?.({ dirty: true });
  log("info", `Restored autosave snapshot ${snap.meta?.savedAt || id}${original ? ` (original ${original} untouched)` : ""}`);
  notify(`Restored autosave from ${new Date(snap.meta?.savedAt || Date.now()).toLocaleString()}. Save to keep it.`, "info");
  return result;
}

/** Relink one asset from the report. Desktop: OS picker; browser: <input type=file>. */
export async function relinkAsset(item, { pickBrowserFile = null } = {}) {
  const bridge = desktopProjectBridge();
  const ext = item.role === "site_model" ? ["glb"] : item.role === "audio" ? ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"] : ["png", "jpg", "jpeg", "webp", "ktx2", "hdr", "exr"];
  let bytes, path = null, sha256;
  if (bridge) {
    const picked = unwrap(await bridge.pickAsset({ title: `Locate ${item.name}`, label: item.role, extensions: ext }), "Relink");
    if (!picked) return null;
    path = picked.path; sha256 = picked.sha256;
    bytes = unwrap(await bridge.readAsset(path), "Reading asset").bytes;
  } else {
    const file = pickBrowserFile ? await pickBrowserFile(ext) : null;
    if (!file) return null;
    bytes = new Uint8Array(await file.arrayBuffer());
    sha256 = await sha256Hex(bytes);
  }
  if (item.role === "site_model") {
    const { restoreImportedModel } = await import("../components/preview/modelLibrary.js");
    await restoreImportedModel({ id: item.locator.assetId, name: item.name, bytes });
  } else if (item.id === "audio:programmer") {
    const file = makeFile(bytes, item.name, item.type, path);
    attachAsset(item.id, file);
    const project = useProjectStore.getState();
    project.rememberProgrammer?.({ ...project.programmer, audioFile: file });
  }
  const status = item.sha256 ? (sha256 === item.sha256 ? "ok" : "relinked-different") : "relinked";
  log(status === "ok" ? "info" : "warn", `Relinked ${item.name} → ${path || "(browser file)"}: ${status}`);
  return { ...item, status, resolvedPath: path, actualSha256: sha256, resolvedVia: "relink" };
}

/** Desktop recent files ({ path, name, openedAt, exists }). */
export async function listRecentProjectFiles() {
  const bridge = desktopProjectBridge();
  if (!bridge) return [];
  return unwrap(await bridge.recent(), "Recent files")?.files || [];
}
