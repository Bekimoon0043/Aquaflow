// AquaFlow Studio — startup check of Windows virtual memory (page file / commit headroom).
//
// Windows can only hand out as much memory as RAM + page file (the "commit limit"). With the
// page file switched off, a PC with 16 GB RAM, a browser holding a few GB and AquaFlow working
// on a long show can run out of commit: Windows logs "low virtual memory" and closes
// programs — AquaFlow among them — even though Task Manager still shows free RAM.
//
// At startup (async, never blocking the window) we ask Windows once, time-boxed to 5 s:
//   Win32_OperatingSystem.TotalVirtualMemorySize / FreeVirtualMemory  → commit limit / free (KB)
//   Win32_PageFileUsage                                                → page files present
// The result is cached for the session and handed to the renderer (window.aquaflow.system
// .memoryStatus()), which shows a banner with the fix when there is no page file or less than
// 2 GB of commit free.
//
// Pure node (child_process injectable) for desktop/tests/memory-check.test.cjs.

const { execFile } = require("child_process");

const MIN_FREE_COMMIT_MB = 2048;
const TIMEOUT_MS = 5000;

const PS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$o=Get-CimInstance Win32_OperatingSystem",
  "$p=@(Get-CimInstance Win32_PageFileUsage | ForEach-Object { $_.Name })",
  "[pscustomobject]@{commitLimitKB=[double]$o.TotalVirtualMemorySize;freeCommitKB=[double]$o.FreeVirtualMemory;" +
    "physKB=[double]$o.TotalVisibleMemorySize;freePhysKB=[double]$o.FreePhysicalMemory;pageFiles=$p} | ConvertTo-Json -Compress",
].join("; ");

const toMB = (kb) => (Number.isFinite(Number(kb)) ? Math.round(Number(kb) / 1024) : null);

/** Parse the PowerShell JSON into MB figures; null when it is not what we asked for. */
function parseMemoryReport(stdout) {
  let raw;
  try { raw = JSON.parse(String(stdout || "").trim()); } catch { return null; }
  if (!raw || typeof raw !== "object" || raw.commitLimitKB == null) return null;
  const pageFiles = (Array.isArray(raw.pageFiles) ? raw.pageFiles : raw.pageFiles ? [raw.pageFiles] : [])
    .map(String).filter(Boolean);
  return {
    commitLimitMB: toMB(raw.commitLimitKB),
    freeCommitMB: toMB(raw.freeCommitKB),
    physMB: toMB(raw.physKB),
    freePhysMB: toMB(raw.freePhysKB),
    pageFiles,
    hasPageFile: pageFiles.length > 0,
  };
}

/** Decide whether to warn. Returns { warn, reasons[], ...report }. */
function assessMemory(report, { minFreeCommitMB = MIN_FREE_COMMIT_MB } = {}) {
  if (!report) return { ok: false, warn: false, reasons: [], unavailable: true };
  const reasons = [];
  if (!report.hasPageFile) reasons.push("no-page-file");
  if (Number.isFinite(report.freeCommitMB) && report.freeCommitMB < minFreeCommitMB) reasons.push("low-free-commit");
  return { ok: true, ...report, minFreeCommitMB, warn: reasons.length > 0, reasons };
}

/** Run the PowerShell query (Windows only). Resolves null on any failure or after timeoutMs. */
function queryWindowsMemory({ platform = process.platform, exec = execFile, timeoutMs = TIMEOUT_MS } = {}) {
  if (platform !== "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { try { child && child.kill(); } catch { /* ignore */ } finish(null); }, timeoutMs);
    if (timer.unref) timer.unref();
    let child = null;
    try {
      child = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS_SCRIPT],
        { windowsHide: true, timeout: timeoutMs }, (err, stdout) => finish(err ? null : parseMemoryReport(stdout)));
    } catch { finish(null); }
  });
}

/** One cached check per session: the first call starts it, later calls get the same promise. */
function createMemoryCheck(options = {}) {
  let pending = null;
  return () => {
    if (!pending) pending = queryWindowsMemory(options).then((r) => assessMemory(r, options)).catch(() => assessMemory(null));
    return pending;
  };
}

function formatMemoryCheck(result) {
  if (!result || result.unavailable) return "memory check: unavailable";
  return `memory check: commit ${result.freeCommitMB}/${result.commitLimitMB} MB free · RAM ${result.freePhysMB}/${result.physMB} MB free · ` +
    `page file ${result.hasPageFile ? result.pageFiles.join(", ") : "NONE"}${result.warn ? ` · WARN ${result.reasons.join(",")}` : ""}`;
}

module.exports = { MIN_FREE_COMMIT_MB, PS_SCRIPT, parseMemoryReport, assessMemory, queryWindowsMemory, createMemoryCheck, formatMemoryCheck };
