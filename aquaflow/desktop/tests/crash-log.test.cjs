// Crash log: rotation, redaction, crash records, memory samples (temp folders only).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createRotatingLog, writeCrashRecord, redact, redactObj, addSecret, sampleMemory, formatMemorySample, _clearSecrets,
} = require("../crash-log");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "aquaflow-crash-log-"));
const fixedNow = () => new Date("2026-10-22T08:00:00.000Z");

test("log lines are timestamped and appended on flush", () => {
  const dir = tmpDir();
  const log = createRotatingLog({ dir, now: fixedNow });
  log.write("engine started\nsecond line\n\n");
  assert.equal(fs.existsSync(log.file), false, "buffered until flush");
  log.flush();
  const text = fs.readFileSync(log.file, "utf8");
  assert.equal(text, "2026-10-22T08:00:00.000Z engine started\n2026-10-22T08:00:00.000Z second line\n");
  log.write("crash!", { sync: true });
  assert.match(fs.readFileSync(log.file, "utf8"), /crash!\n$/);
  assert.equal(log.tail().length, 3);
});

test("log rotates at the size limit and keeps only `keep` files", () => {
  const dir = tmpDir();
  const log = createRotatingLog({ dir, maxBytes: 200, keep: 3, now: fixedNow });
  for (let i = 0; i < 40; i++) log.write(`line ${String(i).padStart(3, "0")} ${"x".repeat(40)}`, { sync: true });
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ["aquaflow-main.log", "aquaflow-main.log.1", "aquaflow-main.log.2"]);
  for (const f of files) assert.ok(fs.statSync(path.join(dir, f)).size <= 200, `${f} within limit`);
  assert.match(fs.readFileSync(log.file, "utf8"), /line 039/, "newest line in the live file");
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "aquaflow-main.log.2"), "utf8"), /line 039/);
});

test("an existing log keeps growing from its current size and rotates later", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "aquaflow-main.log"), "y".repeat(190));
  const log = createRotatingLog({ dir, maxBytes: 200, keep: 2, now: fixedNow });
  log.write("next", { sync: true });
  assert.equal(fs.readFileSync(path.join(dir, "aquaflow-main.log.1"), "utf8"), "y".repeat(190));
  assert.match(fs.readFileSync(log.file, "utf8"), /next/);
});

test("redaction hides keys, tokens, licence secrets and registered values", () => {
  _clearSecrets();
  addSecret("hunter2-licence-secret");
  const line = redact("ANTHROPIC_API_KEY=sk-ant-api03-abcdef123 token: abc.def license_key=\"XYZ\" secret hunter2-licence-secret Authorization: Bearer eyJhbGciOi.x.y");
  assert.doesNotMatch(line, /sk-ant|abc\.def|XYZ|hunter2|eyJhbGciOi/);
  assert.match(line, /\[redacted\]/);
  assert.equal(redact("engine on 127.0.0.1:8000 · health ok"), "engine on 127.0.0.1:8000 · health ok");
  assert.match(redact(`hash ${"a".repeat(64)}`), /hash \[redacted\]/, "long opaque tokens are masked");
  const obj = redactObj({ licenseSecret: "s3cr3t-value", nested: { apiKey: "k", note: "password=abc" }, list: ["sk-ant-zzz"] });
  assert.equal(obj.licenseSecret, "[redacted]");
  assert.equal(obj.nested.apiKey, "[redacted]");
  assert.equal(obj.nested.note, "password=[redacted]");
  assert.deepEqual(obj.list, ["[redacted]"]);
  _clearSecrets();
});

test("log file never contains a registered secret", () => {
  _clearSecrets();
  const dir = tmpDir();
  addSecret("LICENCE-SECRET-123456");
  const log = createRotatingLog({ dir, now: fixedNow });
  log.write("[engine] env AQUAFLOW_LICENSE_SECRET=LICENCE-SECRET-123456 loaded", { sync: true });
  assert.doesNotMatch(fs.readFileSync(log.file, "utf8"), /LICENCE-SECRET-123456/);
  _clearSecrets();
});

test("crash record is redacted JSON with the recent log; old records are pruned", () => {
  const dir = tmpDir();
  let t = Date.parse("2026-10-22T08:00:00.000Z");
  for (let i = 0; i < 4; i++) {
    writeCrashRecord(dir, { kind: "renderer", details: { reason: "oom", exitCode: -536870904 }, recentLog: ["api_key=abc123"] },
      { now: () => new Date(t += 1000), keep: 3 });
  }
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("crash-")).sort();
  assert.equal(files.length, 3, "only the newest 3 kept");
  const rec = JSON.parse(fs.readFileSync(path.join(dir, files[2]), "utf8"));
  assert.equal(rec.kind, "renderer");
  assert.equal(rec.details.reason, "oom");
  assert.equal(rec.at, "2026-10-22T08:00:04.000Z");
  assert.deepEqual(rec.recentLog, ["api_key=[redacted]"]);
  assert.match(files[2], /^crash-2026-10-22T08-00-04-000Z-renderer\.json$/);
});

test("a log folder that cannot be written does not throw", () => {
  const dir = tmpDir();
  const broken = Object.create(fs);
  broken.appendFileSync = () => { throw Object.assign(new Error("EROFS"), { code: "EROFS" }); };
  const log = createRotatingLog({ dir, fs: broken, now: fixedNow });
  assert.doesNotThrow(() => log.write("x", { sync: true }));
  assert.doesNotThrow(() => log.write("y", { sync: true }));
});

test("memory sample sums working set per process type", () => {
  const s = sampleMemory({
    appMetrics: [
      { type: "Browser", memory: { workingSetSize: 102400, privateBytes: 51200 } },
      { type: "Tab", memory: { workingSetSize: 1572864, privateBytes: 1048576 } },
      { type: "GPU", memory: { workingSetSize: 307200 } },
      { type: "Utility", memory: { workingSetSize: 20480 } },
      { type: "Utility", memory: { workingSetSize: 20480 } },
    ],
    freemem: 2 * 1024 ** 3, totalmem: 16 * 1024 ** 3, systemInfo: { total: 16e6, free: 2e6, swapTotal: 16 * 1024 * 1024, swapFree: 1024 * 1024 },
  });
  assert.equal(s.byType.Tab.workingSetMB, 1536);
  assert.equal(s.byType.Utility.count, 2);
  assert.equal(s.totalWorkingSetMB, 100 + 1536 + 300 + 40);
  assert.equal(s.freePhysMB, 2048);
  assert.equal(s.swapFreeMB, 1024);
  assert.match(formatMemorySample(s), /Tab=1536MB/);
  assert.match(formatMemorySample(s), /Utility×2=40MB/);
});
