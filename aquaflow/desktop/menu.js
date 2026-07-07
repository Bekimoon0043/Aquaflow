// AF-PKG-005 — application menu + About dialog (LuxuryCon branding).
//
// File: Open Show / Save / Exit   ·   Help: About / Check for Updates / Documentation
// Menu actions that concern the show reach the renderer via preload-exposed events
// (window.aquaflow.onOpenShow / onSave); "Check for Updates" is wired to electron-updater
// in AF-PKG-007 (a no-op hook until then).

const { app, Menu, dialog, shell, BrowserWindow } = require("electron");
const path = require("path");

function sendToRenderer(channel, payload) {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (win) win.webContents.send(channel, payload);
}

async function openShowDialog() {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const res = await dialog.showOpenDialog(win, {
    title: "Open AquaFlow Show",
    filters: [{ name: "AquaFlow Show", extensions: ["aquashow"] }, { name: "All Files", extensions: ["*"] }],
    properties: ["openFile"],
  });
  if (!res.canceled && res.filePaths[0]) sendToRenderer("open-show", res.filePaths[0]);
}

function showAbout() {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  dialog.showMessageBox(win, {
    type: "info",
    title: "About AquaFlow Studio",
    message: "AquaFlow Studio",
    detail:
      `Version ${app.getVersion()}\n` +
      `© ${new Date().getFullYear()} LuxuryCon. All rights reserved.\n\n` +
      `Fountain design, engineering, programming & operation platform.\n` +
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
    buttons: ["OK"],
    icon: path.join(__dirname, "build", "icon.png"),
  });
}

// AF-PKG-007 replaces this with the real electron-updater check.
let checkForUpdatesHook = () => {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  dialog.showMessageBox(win, { type: "info", title: "Check for Updates",
    message: "Update checking is configured on launch.", buttons: ["OK"] });
};
function setCheckForUpdatesHook(fn) { checkForUpdatesHook = fn; }

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Open Show…", accelerator: "CmdOrCtrl+O", click: openShowDialog },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => sendToRenderer("menu-save") },
        { type: "separator" },
        { label: "Exit", accelerator: "CmdOrCtrl+Q", role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "Documentation", click: () => shell.openExternal("https://luxuryconworld.com/aquaflow/docs") },
        { label: "Check for Updates…", click: () => checkForUpdatesHook() },
        { type: "separator" },
        { label: "About AquaFlow Studio", click: showAbout },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu, showAbout, setCheckForUpdatesHook };
