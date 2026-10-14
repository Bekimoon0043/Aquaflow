// AF-3D-VID-002 — PNG-sequence folder export: only user-chosen folders, only bare frame names.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRenderExportStore, registerRenderExportIpc, safeFileName } = require("../render-export");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "aquaflow-render-export-"));

test("safe names: numbered frames, WAV and note only; no paths", () => {
  assert.equal(safeFileName("lebu_00007.png"), "lebu_00007.png");
  assert.equal(safeFileName("lebu_audio.wav"), "lebu_audio.wav");
  assert.equal(safeFileName("README.txt"), "README.txt");
  for (const bad of ["../x.png", "..\\x.png", "a/b.png", "C:\\x.png", "x.exe", ".hidden.png", "x.png.js", "", "a..b.png"]) {
    assert.equal(safeFileName(bad), null, bad);
  }
});

test("writes only into an approved folder token", () => {
  const dir = tmpDir();
  const store = createRenderExportStore();
  assert.throws(() => store.write("nope", "a_00000.png", new Uint8Array([1])), /Choose an output folder/);
  const token = store.approve(dir);
  const res = store.write(token, "a_00000.png", new Uint8Array([137, 80, 78, 71]));
  assert.equal(res.ok, true);
  assert.deepEqual([...fs.readFileSync(path.join(dir, "a_00000.png"))], [137, 80, 78, 71]);
  assert.equal(fs.existsSync(path.join(dir, "a_00000.png.part")), false);
  assert.throws(() => store.write(token, "../escape.png", new Uint8Array([1])), /Refusing/);
  assert.equal(fs.existsSync(path.join(dir, "..", "escape.png")), false);
});

test("IPC: folder dialog returns a token; untrusted senders are refused", async () => {
  const dir = tmpDir();
  const handlers = {};
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
  const win = { webContents: { mainFrame: "main" } };
  const event = { sender: win.webContents, senderFrame: "main" };
  registerRenderExportIpc({
    ipcMain, getMainWindow: () => win,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [dir] }) },
  });
  const chosen = await handlers["render:choose-folder"](event, {});
  assert.equal(chosen.ok, true);
  assert.equal(chosen.path, dir);
  const w = await handlers["render:write-file"](event, chosen.token, "show_00001.png", new Uint8Array([1, 2]));
  assert.equal(w.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, "show_00001.png")).length, 2);
  const bad = await handlers["render:write-file"]({ sender: {}, senderFrame: null }, chosen.token, "x_00000.png", new Uint8Array([1]));
  assert.equal(bad.ok, false);
  const traversal = await handlers["render:write-file"](event, chosen.token, "..\\evil.png", new Uint8Array([1]));
  assert.equal(traversal.ok, false);
});

test("IPC: cancelled dialog", async () => {
  const handlers = {};
  const win = { webContents: { mainFrame: "main" } };
  registerRenderExportIpc({
    ipcMain: { handle: (n, f) => { handlers[n] = f; } }, getMainWindow: () => win,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  });
  const res = await handlers["render:choose-folder"]({ sender: win.webContents, senderFrame: "main" });
  assert.deepEqual(res, { canceled: true });
});
