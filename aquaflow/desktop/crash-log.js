// AquaFlow Studio — durable main-process log, crash records and memory samples.
//
// Packaged GUI launches have no console, so the `dbg` lines, the engine's stdout/stderr and
// renderer/GPU crashes used to vanish. This module keeps them in a small rotating log in the
// app's logs folder (Help → Open Logs Folder):
//
//   aquaflow-main.log  (+ .1, .2)   ~5 MB each, newest first; lines are timestamped
//   crash-<time>.json               one record per renderer/child-process crash or main
//                                   exception, with the last log lines and memory sample
//
// Nothing secret is written: every line goes through redact() (same rules as the engine's
// ai_commissioning.redact) and exact secret values registered with addSecret() (licence
// secret, AI key) are masked wherever they appear.
//
// Pure node (no electron import) so desktop/tests/crash-log.test.cjs can run it with
// node --test against a temp folder.

const fs = require("fs");
const path = require("path");

const LOG_NAME = "aquaflow-main.log";
const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_FILES = 3;            // the live log + 2 rotated copies
const MAX_LINE = 4000;
const TAIL_LINES = 200;
const MAX_CRASH_RECORDS = 20;

// What a secret looks like in free text (mirrors backend/services/ai_commissioning.py).
const SECRET_WORD = "(?:api[_ -]?key|secret|passw(?:or)?d|pwd|token|licen[cs]e[_ -]?key|licen[cs]e|auth(?:orization)?|credentials?|private[_ -]?key)";
const TEXT_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]"],
  [/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]"],
  [new RegExp(`(\\b${SECRET_WORD}\\b["']?\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s,;}]+)`, "gi"), "$1[redacted]"],
  [/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted]"],
  [/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, "[redacted]"],
];
const SECRET_KEY = new RegExp(SECRET_WORD, "i");

const knownSecrets = new Set();
/** Mask this exact value wherever it appears in later log lines (ignored when shorter than 6). */
function addSecret(value) {
  const s = value == null ? "" : String(value).trim();
  if (s.length >= 6) knownSecrets.add(s);
}

function redact(text) {
  let s = text == null ? "" : String(text);
  for (const secret of knownSecrets) if (s.includes(secret)) s = s.split(secret).join("[redacted]");
  for (const [pattern, repl] of TEXT_PATTERNS) s = s.replace(pattern, repl);
  return s;
}

/** Objects with secret-looking keys blanked and every string redacted. */
function redactObj(value, depth = 0) {
  if (depth > 6) return "…";
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redactObj(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 200)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redactObj(v, depth + 1);
    return out;
  }
  if (typeof value === "string") return redact(value).slice(0, MAX_LINE);
  return value;
}

const stamp = (d) => d.toISOString();
const fileStamp = (d) => d.toISOString().replace(/[:.]/g, "-");

/**
 * A size-rotated, redacting, buffered log file. Lines are queued and appended in one write
 * every `flushMs` (or at once when `sync` / flush() is called — e.g. on a crash), so a chatty
 * engine never blocks the main process with one disk write per line.
 */
function createRotatingLog({ dir, name = LOG_NAME, maxBytes = MAX_BYTES, keep = KEEP_FILES, flushMs = 500, fs: fsx = fs, now = () => new Date() } = {}) {
  if (!dir) throw new Error("createRotatingLog needs a folder");
  const file = path.join(dir, name);
  let size = 0;
  let queue = [];
  let timer = null;
  let broken = false;
  const tail = [];
  try { fsx.mkdirSync(dir, { recursive: true }); } catch { /* reported on first write */ }
  try { size = fsx.statSync(file).size; } catch { size = 0; }

  function rotate() {
    for (let i = keep - 1; i >= 1; i--) {
      const from = i === 1 ? file : `${file}.${i - 1}`;
      const to = `${file}.${i}`;
      try { if (i === keep - 1) fsx.rmSync(to, { force: true }); } catch { /* ignore */ }
      try { if (fsx.existsSync(from)) fsx.renameSync(from, to); } catch { /* ignore */ }
    }
    if (keep <= 1) { try { fsx.rmSync(file, { force: true }); } catch { /* ignore */ } }
    size = 0;
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length || broken) { queue = []; return; }
    const chunk = queue.join("");
    queue = [];
    const bytes = Buffer.byteLength(chunk);
    try {
      if (size > 0 && size + bytes > maxBytes) rotate();
      fsx.appendFileSync(file, chunk);
      size += bytes;
    } catch {
      broken = true; // a full/read-only disk must never take the app down
    }
  }

  function write(text, { sync = false } = {}) {
    const lines = String(text == null ? "" : text).split(/\r?\n/).filter((l) => l.trim() !== "");
    for (const raw of lines) {
      const line = `${stamp(now())} ${redact(raw).slice(0, MAX_LINE)}`;
      tail.push(line);
      if (tail.length > TAIL_LINES) tail.shift();
      queue.push(`${line}\n`);
    }
    if (sync) flush();
    else if (!timer && queue.length) {
      timer = setTimeout(flush, flushMs);
      if (timer.unref) timer.unref();
    }
  }

  return { file, dir, write, flush, tail: () => tail.slice(), size: () => size };
}

/** Write one crash record (JSON) next to the log; keeps the newest MAX_CRASH_RECORDS. */
function writeCrashRecord(dir, record, { fs: fsx = fs, now = () => new Date(), keep = MAX_CRASH_RECORDS } = {}) {
  const at = now();
  const kind = String(record && record.kind || "crash").replace(/[^a-z0-9-]+/gi, "-").slice(0, 40);
  const file = path.join(dir, `crash-${fileStamp(at)}-${kind}.json`);
  const body = redactObj({ at: stamp(at), ...record });
  try {
    fsx.mkdirSync(dir, { recursive: true });
    fsx.writeFileSync(file, JSON.stringify(body, null, 2));
  } catch { return null; }
  try {
    const old = fsx.readdirSync(dir).filter((f) => /^crash-.*\.json$/.test(f)).sort().reverse();
    for (const f of old.slice(keep)) fsx.rmSync(path.join(dir, f), { force: true });
  } catch { /* ignore */ }
  return file;
}

const MB = 1024 * 1024;
const round = (n) => Math.round(n * 10) / 10;

/**
 * One memory sample: working set / private bytes per Electron process type (from
 * app.getAppMetrics()), free physical memory and — where Chromium reports it — the commit
 * (page file) totals from process.getSystemMemoryInfo(). All sizes in MB.
 */
function sampleMemory({ appMetrics = [], freemem = 0, totalmem = 0, systemInfo = null } = {}) {
  const byType = {};
  for (const m of Array.isArray(appMetrics) ? appMetrics : []) {
    const type = m && m.type ? String(m.type) : "Unknown";
    const mem = (m && m.memory) || {};
    const t = byType[type] || (byType[type] = { count: 0, workingSetMB: 0, privateMB: 0 });
    t.count += 1;
    t.workingSetMB = round(t.workingSetMB + (Number(mem.workingSetSize) || 0) / 1024);
    t.privateMB = round(t.privateMB + (Number(mem.privateBytes) || 0) / 1024);
  }
  const totalWorkingSetMB = round(Object.values(byType).reduce((n, t) => n + t.workingSetMB, 0));
  const sample = { totalWorkingSetMB, byType, freePhysMB: round(freemem / MB), totalPhysMB: round(totalmem / MB) };
  if (systemInfo && Number.isFinite(systemInfo.swapTotal)) {
    sample.swapTotalMB = round(systemInfo.swapTotal / 1024);
    sample.swapFreeMB = round((Number(systemInfo.swapFree) || 0) / 1024);
  }
  return sample;
}

function formatMemorySample(s) {
  const types = Object.entries(s.byType || {})
    .map(([type, t]) => `${type}${t.count > 1 ? `×${t.count}` : ""}=${t.workingSetMB}MB`).join(" ");
  const swap = s.swapTotalMB != null ? ` swap/commit free ${s.swapFreeMB}/${s.swapTotalMB} MB` : "";
  return `memory: app ${s.totalWorkingSetMB} MB (${types}) · free RAM ${s.freePhysMB}/${s.totalPhysMB} MB${swap}`;
}

module.exports = {
  LOG_NAME, MAX_BYTES, KEEP_FILES, TAIL_LINES,
  addSecret, redact, redactObj, createRotatingLog, writeCrashRecord, sampleMemory, formatMemorySample,
  _clearSecrets: () => knownSecrets.clear(),
};
