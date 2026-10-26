// Startup page-file / commit check: parsing, decision, timeout, caching (no real PowerShell).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseMemoryReport, assessMemory, queryWindowsMemory, createMemoryCheck, formatMemoryCheck } = require("../memory-check");

const NO_PAGE_FILE = JSON.stringify({ commitLimitKB: 16549888, freeCommitKB: 771072, physKB: 16549888, freePhysKB: 4333568, pageFiles: [] });
const WITH_PAGE_FILE = JSON.stringify({ commitLimitKB: 33554432, freeCommitKB: 12582912, physKB: 16549888, freePhysKB: 4333568, pageFiles: "C:\\pagefile.sys" });

test("parses the PowerShell JSON (single page file comes back as a string)", () => {
  const none = parseMemoryReport(NO_PAGE_FILE);
  assert.equal(none.hasPageFile, false);
  assert.equal(none.commitLimitMB, 16162);
  assert.equal(none.freeCommitMB, 753);
  const one = parseMemoryReport(WITH_PAGE_FILE);
  assert.deepEqual(one.pageFiles, ["C:\\pagefile.sys"]);
  assert.equal(one.hasPageFile, true);
  assert.equal(parseMemoryReport("not json"), null);
  assert.equal(parseMemoryReport("{}"), null);
});

test("warns without a page file or with less than 2 GB commit free", () => {
  assert.deepEqual(assessMemory(parseMemoryReport(NO_PAGE_FILE)).reasons, ["no-page-file", "low-free-commit"]);
  const fine = assessMemory(parseMemoryReport(WITH_PAGE_FILE));
  assert.equal(fine.warn, false);
  const low = assessMemory({ ...parseMemoryReport(WITH_PAGE_FILE), freeCommitMB: 1500 });
  assert.deepEqual(low.reasons, ["low-free-commit"]);
  assert.equal(assessMemory(null).warn, false);
  assert.match(formatMemoryCheck(assessMemory(parseMemoryReport(NO_PAGE_FILE))), /page file NONE · WARN/);
});

test("query is skipped off Windows and returns null on errors", async () => {
  assert.equal(await queryWindowsMemory({ platform: "linux" }), null);
  const failing = (_cmd, _args, _opts, cb) => { cb(new Error("powershell missing")); return { kill() {} }; };
  assert.equal(await queryWindowsMemory({ platform: "win32", exec: failing }), null);
  const ok = (_cmd, _args, _opts, cb) => { cb(null, NO_PAGE_FILE); return { kill() {} }; };
  assert.equal((await queryWindowsMemory({ platform: "win32", exec: ok })).hasPageFile, false);
});

test("query is time-boxed: a hung PowerShell is killed and resolves null", async () => {
  let killed = false;
  const hung = () => ({ kill() { killed = true; } });
  const t = Date.now();
  assert.equal(await queryWindowsMemory({ platform: "win32", exec: hung, timeoutMs: 50 }), null);
  assert.ok(Date.now() - t < 2000);
  assert.equal(killed, true);
});

test("the check runs once per session and is cached", async () => {
  let calls = 0;
  const exec = (_cmd, _args, _opts, cb) => { calls++; setTimeout(() => cb(null, NO_PAGE_FILE), 5); return { kill() {} }; };
  const check = createMemoryCheck({ platform: "win32", exec });
  const [a, b] = await Promise.all([check(), check()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(a.warn, true);
});
