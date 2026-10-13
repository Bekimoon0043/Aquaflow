/**
 * projectSignals.js — AF-NEXT-014. Remembers the last preflight result and the last
 * project asset report so the workspace guidance can read them, whichever panel produced
 * them. Listeners are registered when this module is first imported (App startup), so a
 * report published before the guidance strip mounts is not lost.
 *
 * Events (published elsewhere):
 *   aquaflow:preflight-result      detail = runPreflight() result + {target, at}
 *   aquaflow:asset-report          detail = {report, projectPath, kind, source}   (AF-NEXT-006)
 *   aquaflow:asset-report-updated  detail = same, after a relink in the report dialog
 *   aquaflow:project-baseline      a project was opened → the old preflight no longer applies
 */
const state = { preflight: null, assets: null };
const listeners = new Set();
const notify = () => listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });

export const getProjectSignals = () => state;
export function subscribeProjectSignals(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function recordPreflightResult(result) {
  state.preflight = result ? { ...result, at: result.at || new Date().toISOString() } : null;
  notify();
}
export function recordAssetReport(detail) {
  state.assets = detail?.report ? detail : null;
  notify();
}
export function resetProjectSignals() { state.preflight = null; state.assets = null; notify(); }

if (typeof window !== "undefined") {
  window.addEventListener("aquaflow:preflight-result", e => recordPreflightResult(e.detail));
  window.addEventListener("aquaflow:asset-report", e => recordAssetReport(e.detail));
  window.addEventListener("aquaflow:asset-report-updated", e => recordAssetReport(e.detail));
  // A newly opened project invalidates the previous preflight (its asset report, if any,
  // is published right after the baseline event and recorded again).
  window.addEventListener("aquaflow:project-baseline", () => { state.preflight = null; state.assets = null; notify(); });
}

/** Reopen the AF-NEXT-006 asset report dialog (Locate…/Relink… live there). */
export function reopenAssetReport() {
  if (!state.assets || typeof window === "undefined") return false;
  window.dispatchEvent(new CustomEvent("aquaflow:asset-report", { detail: state.assets }));
  return true;
}
