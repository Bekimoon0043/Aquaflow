/**
 * MemoryBanner.jsx — non-blocking warning when Windows has no page file or little commit left.
 *
 * The desktop shell checks once at startup (desktop/memory-check.js) and answers
 * window.aquaflow.system.memoryStatus(). Without a page file Windows can only hand out as
 * much memory as there is RAM; when a browser and AquaFlow together reach that limit Windows
 * closes programs ("low virtual memory") — AquaFlow among them. The banner explains the fix
 * in plain steps. "Don't show again" is remembered on this PC; Close hides it for this session.
 */
import { useEffect, useState } from "react";

export const MEMORY_BANNER_DISMISS_KEY = "aquaflow.memoryBanner.dismissed";

const readDismissed = () => {
  try { return globalThis.localStorage?.getItem(MEMORY_BANNER_DISMISS_KEY) === "1"; } catch { return false; }
};

export function memoryBannerText(status) {
  const reasons = status?.reasons || [];
  const free = Number.isFinite(status?.freeCommitMB) ? `${(status.freeCommitMB / 1024).toFixed(1)} GB` : null;
  if (reasons.includes("no-page-file")) {
    return `Windows has no page file on this PC${free ? ` (only ${free} of memory left to hand out)` : ""}. When memory runs out, Windows closes programs — AquaFlow can close without warning.`;
  }
  return `This PC is low on memory${free ? ` (${free} left to hand out)` : ""}. Windows may close AquaFlow if it runs out — close other programs (browsers) or enlarge the page file.`;
}

const bar = {
  position: "fixed", left: 16, right: 16, top: 12, zIndex: 2900, margin: "0 auto", maxWidth: 760,
  background: "var(--bg-surface, #151d24)", color: "var(--text-primary, #e8eef2)", fontSize: 12,
  border: "1px solid var(--amber, #f0b429)", borderRadius: 8, padding: "10px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
};

const defaultGetStatus = () => globalThis.window?.aquaflow?.system?.memoryStatus?.();

export default function MemoryBanner({ getStatus = defaultGetStatus }) {
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState(false);

  useEffect(() => {
    if (readDismissed()) return undefined;
    let alive = true;
    let pending;
    try { pending = getStatus(); } catch { pending = null; }
    Promise.resolve(pending).then((s) => { if (alive && s?.warn) { setStatus(s); setOpen(true); } }).catch(() => {});
    return () => { alive = false; };
  }, [getStatus]);

  if (!open || !status) return null;
  const dontShowAgain = () => {
    try { globalThis.localStorage?.setItem(MEMORY_BANNER_DISMISS_KEY, "1"); } catch { /* ignore */ }
    setOpen(false);
  };
  return (
    <div style={bar} role="alert" aria-label="Memory warning">
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <strong style={{ color: "var(--amber, #f0b429)", whiteSpace: "nowrap" }}>Memory</strong>
        <div style={{ flex: 1 }}>
          <div>{memoryBannerText(status)}</div>
          {steps && (
            <ol style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
              <li>Press <b>Windows + R</b>, type <code>sysdm.cpl</code> and press Enter.</li>
              <li>Open the <b>Advanced</b> tab → under Performance click <b>Settings…</b></li>
              <li>Open the <b>Advanced</b> tab → under Virtual memory click <b>Change…</b></li>
              <li>Tick <b>Automatically manage paging file size for all drives</b>, then <b>OK</b>.</li>
              <li>Restart Windows when asked. Save your show first.</li>
            </ol>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn" style={{ fontSize: 11 }} onClick={() => setSteps((v) => !v)}>{steps ? "Hide steps" : "How to fix"}</button>
            <button className="btn" style={{ fontSize: 11 }} onClick={dontShowAgain}>Don't show again</button>
            <button className="btn" style={{ fontSize: 11 }} onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
