// Launch/second-instance project opens must survive the license gate: they are held until the
// renderer signals that its open handler (ProjectRecoveryHost) is mounted.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createOpenQueue, READY_CHANNEL, OPEN_CHANNEL } = require("../open-queue");

const harness = () => {
  const sent = [];
  let windowAlive = true;
  const q = createOpenQueue({ send: (p) => { if (!windowAlive) return false; sent.push(p); return true; } });
  return { q, sent, kill: () => { windowAlive = false; }, revive: () => { windowAlive = true; } };
};

test("a path opened at launch is held until the renderer signals ready, then delivered once", () => {
  const { q, sent } = harness();
  q.enqueue("C:\\shows\\Lebu.aquapkg");
  assert.deepEqual(sent, [], "nothing is sent while the license gate is up");
  assert.deepEqual(q.pending(), ["C:\\shows\\Lebu.aquapkg"]);
  q.markReady();
  assert.deepEqual(sent, ["C:\\shows\\Lebu.aquapkg"]);
  q.markReady();
  assert.deepEqual(sent, ["C:\\shows\\Lebu.aquapkg"], "a second ready signal does not re-open");
  assert.deepEqual(q.pending(), []);
});

test("second-instance opens before ready: the newest request wins; after ready they go straight through", () => {
  const { q, sent } = harness();
  q.enqueue("C:\\a.aqua");
  q.enqueue("C:\\b.aquapkg");
  q.markReady();
  assert.deepEqual(sent, ["C:\\b.aquapkg"]);
  q.enqueue("C:\\c.aquashow");
  assert.deepEqual(sent, ["C:\\b.aquapkg", "C:\\c.aquashow"]);
});

test("a reload/crash puts the queue back on hold; an undeliverable path stays queued", () => {
  const { q, sent, kill, revive } = harness();
  q.markReady();
  q.markNotReady();
  q.enqueue("C:\\d.aqua");
  assert.deepEqual(sent, []);
  kill();
  q.markReady();
  assert.deepEqual(sent, [], "window gone: not delivered");
  assert.deepEqual(q.pending(), ["C:\\d.aqua"]);
  revive();
  q.markReady();
  assert.deepEqual(sent, ["C:\\d.aqua"]);
});

test("empty/invalid paths are ignored and send is required", () => {
  const { q, sent } = harness();
  q.markReady();
  q.enqueue(null); q.enqueue(""); q.enqueue(42);
  assert.deepEqual(sent, []);
  assert.throws(() => createOpenQueue({}));
});

test("main.js and preload.js are wired to the ready signal (no send on did-finish-load)", () => {
  const dir = path.join(__dirname, "..");
  const main = fs.readFileSync(path.join(dir, "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(dir, "preload.js"), "utf8");
  const builder = fs.readFileSync(path.join(dir, "electron-builder.yml"), "utf8");
  assert.equal(READY_CHANNEL, "renderer:ready-for-open");
  assert.equal(OPEN_CHANNEL, "open-show");
  assert.match(main, /ipcMain\.on\(READY_CHANNEL/);
  assert.match(main, /openQueue\.enqueue\(filePath\)/);
  assert.doesNotMatch(main, /pendingOpenPath/);
  assert.match(main, /setOpenShowHook\(handleOpenShow\)/);
  assert.match(preload, /signalReadyForOpen\(\)\s*\{\s*ipcRenderer\.send\("renderer:ready-for-open"\)/);
  assert.match(builder, /- open-queue\.js/);
  const host = fs.readFileSync(path.join(dir, "..", "frontend", "src", "components", "ProjectRecoveryHost.jsx"), "utf8");
  assert.match(host, /signalReadyForOpen/);
});
