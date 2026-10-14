// AF-3D-VID-002 — image-sequence export: the renderer asks the user for a folder once,
// then streams numbered frames (and an audio WAV + note) into it.
//
// Security model: the renderer never sends a path. "render:choose-folder" opens the OS
// folder dialog and returns an opaque token for the folder the USER picked; every write
// names that token plus a bare file name (no separators, PNG/WAV/TXT only). A compromised
// page can therefore only drop frame-like files into a folder the user just chose.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_FILE_BYTES = 256 * 1024 * 1024;           // one 8K PNG is far below this
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.(png|wav|txt)$/i;

function safeFileName(name) {
  const n = String(name || "");
  if (!SAFE_NAME.test(n) || n.includes("..") || path.basename(n) !== n) return null;
  return n;
}

function createRenderExportStore({ fs: fsx = fs } = {}) {
  const folders = new Map();   // token -> absolute folder
  return {
    approve(folder) {
      const token = crypto.randomBytes(16).toString("hex");
      folders.set(token, path.resolve(folder));
      return token;
    },
    write(token, name, bytes) {
      const folder = folders.get(String(token || ""));
      if (!folder) throw new Error("Choose an output folder first.");
      const file = safeFileName(name);
      if (!file) throw new Error(`Refusing to write "${String(name).slice(0, 80)}".`);
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
      if (data.byteLength > MAX_FILE_BYTES) throw new Error("Frame is too large.");
      const target = path.join(folder, file);
      if (path.dirname(target) !== folder) throw new Error("Invalid frame path.");
      const tmp = `${target}.part`;
      fsx.writeFileSync(tmp, data);
      fsx.renameSync(tmp, target);
      return { ok: true, size: data.byteLength };
    },
    folderFor(token) { return folders.get(String(token || "")) || null; },
  };
}

function registerRenderExportIpc({ ipcMain, dialog, getMainWindow, fs: fsx = fs }) {
  const store = createRenderExportStore({ fs: fsx });
  const senderAllowed = (event) => {
    const win = getMainWindow();
    return !!win && event.sender === win.webContents && (!event.senderFrame || event.senderFrame === event.sender.mainFrame);
  };
  const handle = (name, fn) => ipcMain.handle(name, async (event, ...args) => {
    if (!senderAllowed(event)) return { ok: false, error: "Untrusted render request." };
    try { return await fn(...args); }
    catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
  });

  handle("render:choose-folder", async (options = {}) => {
    const res = await dialog.showOpenDialog(getMainWindow(), {
      title: String(options.title || "Choose a folder for the image sequence").slice(0, 120),
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { canceled: true };
    const folder = res.filePaths[0];
    if (!fsx.statSync(folder).isDirectory()) throw new Error("Not a folder.");
    return { ok: true, path: folder, token: store.approve(folder) };
  });
  handle("render:write-file", async (token, name, bytes) => store.write(token, name, bytes));
  return store;
}

module.exports = { registerRenderExportIpc, createRenderExportStore, safeFileName, MAX_FILE_BYTES };
