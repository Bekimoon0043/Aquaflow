// AF-NEXT-006 — atomic save, snapshot rotation, unclean-exit detection, asset resolution.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const {
  atomicWriteFile, createSnapshotStore, planSnapshotRotation, acquireSessionLock, releaseSessionLock,
  recordCleanSave, addRecentFile, listRecentFiles, resolveAssetPath, describeAsset, registerProjectIpc,
} = require("../project-files");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "aquaflow-af-next-006-"));

// A real filesystem whose chosen operation throws once — simulates a crash/disk error mid-save.
function failingFs(op, { afterBytes = null } = {}) {
  const wrapped = Object.create(fs);
  if (op === "writeSync") {
    let written = 0;
    wrapped.writeSync = (fd, buf, off, len) => {
      const n = Math.min(len, Math.max(1, afterBytes - written));
      if (written >= afterBytes) { const e = new Error("ENOSPC: simulated disk full mid-write"); e.code = "ENOSPC"; throw e; }
      written += fs.writeSync(fd, buf, off, n);
      return n;
    };
  } else {
    wrapped[op] = () => { const e = new Error(`simulated ${op} failure`); e.code = "EIO"; throw e; };
  }
  return wrapped;
}

test("atomic write replaces the file and keeps the previous version as .bak", () => {
  const dir = tmpDir(), file = path.join(dir, "show.aqua");
  fs.writeFileSync(file, "VERSION-1");
  const res = atomicWriteFile(file, "VERSION-2");
  assert.equal(fs.readFileSync(file, "utf8"), "VERSION-2");
  assert.equal(fs.readFileSync(`${file}.bak`, "utf8"), "VERSION-1");
  assert.equal(res.size, 9);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

for (const [label, op, opts] of [
  ["half the bytes written (disk full)", "writeSync", { afterBytes: 4 }],
  ["fsync failing", "fsyncSync", {}],
  ["the final rename failing", "renameSync", {}],
]) {
  test(`atomic write: failure during ${label} leaves the original intact`, () => {
    const dir = tmpDir(), file = path.join(dir, "show.aqua");
    const original = JSON.stringify({ aquaflow: "1.1", show: { name: "Original" } });
    fs.writeFileSync(file, original);
    assert.throws(() => atomicWriteFile(file, "x".repeat(4096), { fs: failingFs(op, opts) }));
    assert.equal(fs.readFileSync(file, "utf8"), original, "original bytes unchanged");
    assert.equal(fs.existsSync(`${file}.tmp`), false, "temp file cleaned up");
  });
}

test("atomic write into a new folder creates it; Uint8Array payloads are written verbatim", () => {
  const dir = tmpDir(), file = path.join(dir, "nested", "pkg.aquapkg");
  atomicWriteFile(file, new Uint8Array([0x50, 0x4b, 3, 4]));
  assert.deepEqual([...fs.readFileSync(file)], [0x50, 0x4b, 3, 4]);
  assert.equal(fs.existsSync(`${file}.bak`), false);
});

test("snapshot rotation keeps the newest N per project and never touches the original", () => {
  const dir = tmpDir(), original = path.join(dir, "show.aqua");
  fs.writeFileSync(original, "ORIGINAL");
  let clock = 1_700_000_000_000;
  const store = createSnapshotStore({ dir: path.join(dir, "snaps"), limit: 3, now: () => (clock += 1000) });
  for (let i = 1; i <= 5; i++) store.write("project-A", { rev: i }, { name: "A", originalPath: original });
  store.write("project-B", { rev: 1 }, { name: "B" });
  const a = store.list("project-A");
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((s) => store.read(s.id).project.rev), [5, 4, 3], "newest first");
  assert.equal(store.list("project-B").length, 1);
  assert.equal(store.list(null).length, 4);
  assert.equal(a[0].originalPath, original);
  assert.equal(fs.readFileSync(original, "utf8"), "ORIGINAL");
  store.discard(a[0].id);
  assert.equal(store.list("project-A").length, 2);
  assert.throws(() => store.read("../../etc/passwd"), /Unknown snapshot/);
});

test("planSnapshotRotation honours the global cap", () => {
  const entries = Array.from({ length: 8 }, (_, i) => ({ key: `k${i % 2}`, time: i, seq: 0 }));
  const { keep, drop } = planSnapshotRotation(entries, 10, 5);
  assert.equal(keep.length, 5);
  assert.equal(drop.length, 3);
  assert.deepEqual(keep.map((e) => e.time), [7, 6, 5, 4, 3]);
});

test("session lock: a leftover lock is reported as an unclean exit; a clean release is not", () => {
  const dir = tmpDir();
  const first = acquireSessionLock(dir, { pid: 111 });
  assert.equal(first.uncleanExit, false);
  // Simulate the app being killed: no release. The next start sees the old lock.
  const second = acquireSessionLock(dir, { pid: 222 });
  assert.equal(second.uncleanExit, true);
  assert.equal(second.previous.pid, 111);
  releaseSessionLock(dir);
  const third = acquireSessionLock(dir, { pid: 333 });
  assert.equal(third.uncleanExit, false);
});

test("clean saves and recent files persist atomically", () => {
  const dir = tmpDir();
  recordCleanSave(dir, "project-A", { path: "C:/shows/a.aqua" }, { now: () => 5000 });
  const saves = JSON.parse(fs.readFileSync(path.join(dir, "clean-saves.json"), "utf8"));
  assert.equal(saves["project-A"].savedAt, new Date(5000).toISOString());
  const show = path.join(dir, "a.aqua"); fs.writeFileSync(show, "{}");
  addRecentFile(dir, { path: show, name: "a" });
  addRecentFile(dir, { path: path.join(dir, "gone.aqua"), name: "gone" });
  addRecentFile(dir, { path: show, name: "a" });
  const recent = listRecentFiles(dir);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].path, show);
  assert.equal(recent[0].exists, true);
  assert.equal(recent[1].exists, false);
});

test("asset resolution: relative → absolute → search alongside the project", async () => {
  const dir = tmpDir(), projectDir = path.join(dir, "Show"), audioDir = path.join(projectDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const song = path.join(audioDir, "song.mp3"); fs.writeFileSync(song, "ID3-audio-bytes");
  assert.equal(resolveAssetPath({ relativePath: "audio/song.mp3" }, { projectDir }).via, "relative");
  assert.equal(resolveAssetPath({ path: song }, { projectDir: dir }).via, "absolute");
  const moved = resolveAssetPath({ path: "D:/old-pc/music/song.mp3", name: "song.mp3" }, { projectDir });
  assert.equal(moved.found, true); assert.equal(moved.via, "search"); assert.equal(moved.path, song);
  assert.equal(resolveAssetPath({ path: "D:/old-pc/missing.mp3", name: "missing.mp3" }, { projectDir }).found, false);
  const d = await describeAsset(song);
  assert.equal(d.sha256, crypto.createHash("sha256").update("ID3-audio-bytes").digest("hex"));
  assert.equal(d.size, 15);
});

test("IPC: untrusted senders are refused; save writes atomically and records a clean save", async () => {
  const dir = tmpDir(), handlers = new Map(), frame = {}, sender = { mainFrame: frame }, win = { webContents: sender };
  registerProjectIpc({ ipcMain: { handle: (n, fn) => handlers.set(n, fn) }, dialog: {}, getMainWindow: () => win, userDataDir: dir, sessionInfo: { uncleanExit: true, previous: { pid: 1 } } });
  const ok = { sender, senderFrame: frame };
  assert.match((await handlers.get("project:save")({ sender: {} }, {})).error, /Untrusted/);
  const file = path.join(dir, "show.aqua");
  const res = await handlers.get("project:save")(ok, { path: file, content: "{\"aquaflow\":\"1.1\"}", projectKey: "p1", name: "Show" });
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(file, "utf8"), "{\"aquaflow\":\"1.1\"}");
  const bad = await handlers.get("project:save")(ok, { path: path.join(dir, "evil.exe"), content: "x" });
  assert.equal(bad.ok, false);
  const info = await handlers.get("session:recovery-info")(ok);
  assert.equal(info.uncleanExit, true);
  assert.ok(info.cleanSaves.p1.savedAt);
  const read = await handlers.get("project:read")(ok, file);
  assert.equal(read.content, "{\"aquaflow\":\"1.1\"}");
  assert.equal((await handlers.get("asset:read")(ok, path.join(dir, "show.aqua"))).ok, false, "asset reads are limited to media types");
});
