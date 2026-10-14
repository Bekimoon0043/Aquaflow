// AquaFlow Studio — Electron preload (context bridge).
//
// Exposes a minimal, safe surface to the renderer. contextIsolation is on and
// nodeIntegration is off, so the renderer only sees exactly what is bridged here.
// AF-PKG-005/006: open-show + save events from the menu and the .aquashow association.

const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("aquaflow", {
  shell: "electron",
  getCadCapabilities() { return ipcRenderer.invoke("cad:capabilities"); },
  exportDWG(request) { return ipcRenderer.invoke("cad:export-dwg",request); },
  // AF-CAD-018: options = { licenseEdition, odaAcknowledged } (ODA licence gate). Returns the
  // converted ASCII DXF, which the renderer hands to the backend importer (POST /api/cad/import).
  importDWG(bytes, options) {
    const { licenseEdition, odaAcknowledged } = options || {};
    return ipcRenderer.invoke("cad:import-dwg",bytes,{ licenseEdition: String(licenseEdition || ""), odaAcknowledged: odaAcknowledged === true });
  },

  // The main process emits 'open-show' with an absolute .aquashow path when the user
  // uses File > Open Show or double-clicks a .aquashow file (AF-PKG-006). The frontend
  // subscribes to load it. Returns an unsubscribe fn.
  onOpenShow(callback) {
    const handler = (_e, filePath) => callback(filePath);
    ipcRenderer.on("open-show", handler);
    return () => ipcRenderer.removeListener("open-show", handler);
  },
  // The renderer calls this once its open-show handler is mounted (after the license gate).
  // Until then the main process queues launch/second-instance opens instead of dropping them.
  signalReadyForOpen() { ipcRenderer.send("renderer:ready-for-open"); },

  // File > Save (Ctrl+S) — the frontend triggers its own save flow.
  onSave(callback) {
    const handler = () => callback();
    ipcRenderer.on("menu-save", handler);
    return () => ipcRenderer.removeListener("menu-save", handler);
  },

  // AF-PKG-ENABLE-LICENSE: open an OS file dialog, validate the picked license.json, and
  // copy it to the user's license folder (~/.aquaflow/license.json). Returns
  // { ok, path } | { canceled: true } | { ok: false, error }. The activation screen then
  // asks the backend to activate that path.
  installLicenseFromFile() {
    return ipcRenderer.invoke("license:install-from-file");
  },

  // AF-NEXT-006 — File > Save As… / Package Project… menu events.
  onSaveAs(callback) {
    const handler = () => callback();
    ipcRenderer.on("menu-save-as", handler);
    return () => ipcRenderer.removeListener("menu-save-as", handler);
  },
  onPackage(callback) {
    const handler = () => callback();
    ipcRenderer.on("menu-package", handler);
    return () => ipcRenderer.removeListener("menu-package", handler);
  },
  // Absolute path of a File chosen in an <input type=file> (File.path was removed in Electron 32).
  getPathForFile(file) {
    try { return webUtils.getPathForFile(file) || null; } catch { return null; }
  },

  // AF-NEXT-006 — atomic project save/open, autosave snapshots, crash recovery and asset
  // manifest helpers. Every call resolves to { ok, ... } | { canceled } | { ok:false, error }.
  project: {
    // { path?, saveAs?, kind: "aqua"|"package", content?: string, bytes?: Uint8Array, suggestedName, projectKey, name }
    save(request) { return ipcRenderer.invoke("project:save", request); },
    saveDialog(request) { return ipcRenderer.invoke("project:save-dialog", request || {}); },
    openDialog() { return ipcRenderer.invoke("project:open-dialog"); },
    read(filePath) { return ipcRenderer.invoke("project:read", String(filePath || "")); },
    recent() { return ipcRenderer.invoke("project:recent"); },
    markClean(projectKey, info) { return ipcRenderer.invoke("project:mark-clean", String(projectKey || ""), info || {}); },
    writeSnapshot(projectKey, project, meta) { return ipcRenderer.invoke("snapshot:write", String(projectKey || ""), project, meta || {}); },
    listSnapshots(projectKey) { return ipcRenderer.invoke("snapshot:list", projectKey == null ? null : String(projectKey)); },
    readSnapshot(id) { return ipcRenderer.invoke("snapshot:read", String(id || "")); },
    discardSnapshot(id) { return ipcRenderer.invoke("snapshot:discard", id == null ? null : String(id)); },
    recoveryInfo() { return ipcRenderer.invoke("session:recovery-info"); },
    describeAssets(refs, projectPath) { return ipcRenderer.invoke("asset:describe", refs || [], projectPath || null); },
    resolveAssets(refs, projectPath) { return ipcRenderer.invoke("asset:resolve", refs || [], projectPath || null); },
    pickAsset(options) { return ipcRenderer.invoke("asset:pick", options || {}); },
    readAsset(filePath) { return ipcRenderer.invoke("asset:read", String(filePath || "")); },
  },
});
