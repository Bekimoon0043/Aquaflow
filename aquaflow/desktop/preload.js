// AquaFlow Studio — Electron preload (context bridge).
//
// AF-PKG-001 scaffolding: empty bridge. Renderer-facing APIs (open-show events, backend
// port, app version, update notifications) are added in later tasks (AF-PKG-004/005/006/007).
// contextIsolation is on and nodeIntegration is off, so the renderer only ever sees what
// is explicitly exposed here.

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("aquaflow", {
  // Placeholder — populated by later packaging tasks.
  shell: "electron",
  scaffold: true,
});
