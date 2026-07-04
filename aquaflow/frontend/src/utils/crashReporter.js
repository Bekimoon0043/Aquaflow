// crashReporter.js — AquaFlow client crash reporting (AQ-S4-002)
//
// Installs global handlers so any uncaught UI error or unhandled promise rejection is
// automatically captured and uploaded to the backend crash API (/api/crash/report),
// which fingerprints, spools and stores it. Deduplicates a burst of identical errors
// on the client so one bug does not flood the endpoint.
import { apiPost } from "./apiClient";

let _installed = false;
const _seen = new Map();          // signature → last-sent timestamp
const DEDUPE_MS = 10000;

function signature(name, message, stack) {
  // first stack frame (or the message) makes a light client-side group key
  const frame = (stack || "").split("\n")[1] || message || "";
  return `${name}|${frame.trim()}`;
}

export function buildCrashPayload(err, context = {}) {
  const e = err || {};
  return {
    exc_type: e.name || "Error",
    message: e.message || String(err),
    traceback: e.stack || "",
    context: { source: "frontend", url: (typeof location !== "undefined" ? location.href : ""), ...context },
  };
}

export async function reportCrash(err, context = {}) {
  const payload = buildCrashPayload(err, context);
  const sig = signature(payload.exc_type, payload.message, payload.traceback);
  const now = Date.now();
  if (_seen.has(sig) && now - _seen.get(sig) < DEDUPE_MS) return { deduped: true };
  _seen.set(sig, now);
  try {
    return await apiPost("/crash/report", payload);
  } catch {
    return { uploaded: false, offline: true };   // backend unreachable — swallow
  }
}

export function installGlobalCrashHandler(target = typeof window !== "undefined" ? window : null) {
  if (_installed || !target) return () => {};
  _installed = true;
  const onError = (event) => {
    const err = event.error || { name: "Error", message: event.message, stack: "" };
    reportCrash(err, { kind: "window.onerror" });
  };
  const onRejection = (event) => {
    const r = event.reason || {};
    reportCrash(r.stack ? r : { name: "UnhandledRejection", message: String(r), stack: "" },
      { kind: "unhandledrejection" });
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    _installed = false;
  };
}

// test helper
export function _resetCrashReporter() { _installed = false; _seen.clear(); }
