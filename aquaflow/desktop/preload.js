// AquaFlow Studio — Electron preload (context bridge).
//
// Exposes a minimal, safe surface to the renderer. contextIsolation is on and
// nodeIntegration is off, so the renderer only sees exactly what is bridged here.
// AF-PKG-005/006: open-show + save events from the menu and the .aquashow association.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aquaflow", {
  shell: "electron",

  // The main process emits 'open-show' with an absolute .aquashow path when the user
  // uses File > Open Show or double-clicks a .aquashow file (AF-PKG-006). The frontend
  // subscribes to load it. Returns an unsubscribe fn.
  onOpenShow(callback) {
    const handler = (_e, filePath) => callback(filePath);
    ipcRenderer.on("open-show", handler);
    return () => ipcRenderer.removeListener("open-show", handler);
  },

  // File > Save (Ctrl+S) — the frontend triggers its own save flow.
  onSave(callback) {
    const handler = () => callback();
    ipcRenderer.on("menu-save", handler);
    return () => ipcRenderer.removeListener("menu-save", handler);
  },
});
