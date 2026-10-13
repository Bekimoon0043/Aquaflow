/**
 * ProjectRecoveryHost.jsx — AF-NEXT-006 UI for project safety.
 *
 *  - Crash-recovery prompt on startup: shown when the previous session did not quit cleanly
 *    AND an autosave snapshot is newer than that project's last clean save. Offers Restore
 *    snapshot / Open original / Discard. The original file is never modified by any choice.
 *  - Missing/changed asset report after opening a project with an asset manifest. It is a
 *    modal (and swallows Space) so playback cannot start before the user has seen it.
 *  - Non-blocking status toasts ("aquaflow:project-status"), e.g. autosave failures.
 *  - Desktop menu wiring: File > Save / Save As / Package / Open (window.aquaflow events).
 */
import { useEffect, useRef, useState } from "react";
import { findRecoveryCandidate, getSnapshotBackend, desktopProjectBridge } from "../utils/projectRecovery";
import {
  restoreSnapshot, openProjectPath, saveProject, packageProject, relinkAsset, notify,
} from "../utils/projectPersistence";

const PROMPT_DONE_KEY = "aquaflow.recoveryPromptHandled";

const overlay = { position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const card = { width: 620, maxWidth: "100%", maxHeight: "calc(100vh - 32px)", overflow: "auto", background: "var(--bg-panel, #10161c)", border: "1px solid var(--border-mid, #2a3640)", borderRadius: 10, padding: 20, color: "var(--text-primary, #e8eef2)", boxShadow: "0 24px 64px rgba(0,0,0,0.6)", fontSize: 13 };
const muted = { color: "var(--text-muted, #8a9aa6)", fontSize: 11 };
const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "never");

const STATUS_STYLE = {
  ok: ["OK", "var(--green, #3ddc84)"],
  unverified: ["FOUND (no hash)", "var(--text-muted, #8a9aa6)"],
  changed: ["CHANGED", "var(--amber, #f0b429)"],
  missing: ["MISSING", "var(--red, #ff5c5c)"],
  relinked: ["RELINKED", "var(--green, #3ddc84)"],
  "relinked-different": ["RELINKED (different file)", "var(--amber, #f0b429)"],
};

function pickBrowserFile(extensions) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extensions.map((e) => `.${e}`).join(",");
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

export default function ProjectRecoveryHost() {
  const [recovery, setRecovery] = useState(null);
  const [assetReport, setAssetReport] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(false);
  const toastId = useRef(0);

  // Toasts.
  useEffect(() => {
    const onStatus = (e) => {
      const { text, level = "info" } = e.detail || {};
      if (!text) return;
      const id = ++toastId.current;
      setToasts((list) => [...list.slice(-3), { id, text, level }]);
      setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), level === "error" ? 12000 : 6000);
    };
    window.addEventListener("aquaflow:project-status", onStatus);
    return () => window.removeEventListener("aquaflow:project-status", onStatus);
  }, []);

  // Crash-recovery check on startup.
  useEffect(() => {
    let alive = true;
    try { if (window.sessionStorage.getItem(PROMPT_DONE_KEY)) return undefined; } catch { /* ignore */ }
    getSnapshotBackend().recoveryInfo().then((info) => {
      const candidate = findRecoveryCandidate(info);
      if (alive && candidate) setRecovery({ ...candidate, info });
    }).catch((e) => notify(`Crash-recovery check failed: ${e.message}`, "warn"));
    return () => { alive = false; };
  }, []);

  // Asset reports from opened projects.
  useEffect(() => {
    const onReport = (e) => { if (e.detail?.report?.total) setAssetReport(e.detail); };
    window.addEventListener("aquaflow:asset-report", onReport);
    return () => window.removeEventListener("aquaflow:asset-report", onReport);
  }, []);

  // While a modal is open, Space must not start playback underneath it.
  useEffect(() => {
    if (!assetReport && !recovery) return undefined;
    const block = (e) => { if (e.code === "Space" && !/input|textarea|select/i.test(e.target?.tagName || "")) { e.stopPropagation(); e.preventDefault(); } };
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, [assetReport, recovery]);

  // Desktop menu: Save / Save As / Package / Open.
  useEffect(() => {
    const api = typeof window !== "undefined" ? window.aquaflow : null;
    if (!api) return undefined;
    const run = (fn) => () => { fn().catch(() => { /* already reported via toast */ }); };
    const offs = [
      api.onSave?.(run(() => saveProject())),
      api.onSaveAs?.(run(() => saveProject({ saveAs: true }))),
      api.onPackage?.(run(() => packageProject())),
      api.onOpenShow?.((filePath) => { openProjectPath(filePath).catch(() => {}); }),
    ];
    return () => offs.forEach((off) => typeof off === "function" && off());
  }, []);

  const closeRecovery = () => {
    try { window.sessionStorage.setItem(PROMPT_DONE_KEY, "1"); } catch { /* ignore */ }
    setRecovery(null);
  };

  const snap = recovery?.snapshot;
  const originalPath = snap?.originalPath || null;
  const canOpenOriginal = !!originalPath && !!desktopProjectBridge();

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); closeRecovery(); }
    catch (e) { notify(e.message, "error"); }
    finally { setBusy(false); }
  };

  const relink = async (item) => {
    try {
      const updated = await relinkAsset(item, { pickBrowserFile });
      if (!updated) return;
      setAssetReport((cur) => {
        const next = cur && ({ ...cur, report: { ...cur.report, items: cur.report.items.map((i) => (i.id === item.id ? updated : i)) } });
        // AF-NEXT-014: keep the workspace's missing-asset diagnostics in step with the relink.
        if (next) setTimeout(() => window.dispatchEvent(new CustomEvent("aquaflow:asset-report-updated", { detail: next })), 0);
        return next;
      });
    } catch (e) { notify(`Relink failed: ${e.message}`, "error"); }
  };

  const items = assetReport?.report?.items || [];
  const problems = items.filter((i) => i.status === "missing" || i.status === "changed");

  return (
    <>
      {recovery && (
        <div style={overlay} role="dialog" aria-modal="true" aria-labelledby="af-recovery-title">
          <div style={card}>
            <h2 id="af-recovery-title" style={{ margin: "0 0 8px", fontSize: 16 }}>AquaFlow did not close normally</h2>
            <p style={{ margin: "0 0 12px" }}>
              An autosave of <strong>{snap.name || "Untitled Show"}</strong> from <strong>{fmt(snap.savedAt)}</strong> is newer than
              its last clean save ({fmt(recovery.lastCleanSaveAt)}).
            </p>
            <p style={muted}>
              {originalPath ? <>Original file: <code>{originalPath}</code> — it has not been modified.</> : "This project had not been saved to a file yet."}
              {" "}Restoring loads the autosave into the workspace; nothing is written to disk until you save.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn primary" disabled={busy} onClick={() => act(() => restoreSnapshot(snap.id))}>Restore autosave</button>
              {canOpenOriginal && <button className="btn" disabled={busy} onClick={() => act(() => openProjectPath(originalPath))}>Open original file</button>}
              <button className="btn" disabled={busy} onClick={() => act(async () => {
                // Discard = do not offer this autosave again. Snapshots stay in the rolling
                // history (Show Browser) until rotated out; the original stays untouched.
                await getSnapshotBackend().markClean(snap.projectKey, { discardedSnapshot: snap.id });
              })}>Discard</button>
            </div>
          </div>
        </div>
      )}

      {!recovery && assetReport && (
        <div style={overlay} role="dialog" aria-modal="true" aria-labelledby="af-assets-title">
          <div style={card}>
            <h2 id="af-assets-title" style={{ margin: "0 0 6px", fontSize: 16 }}>
              {problems.length ? `${problems.length} project asset${problems.length > 1 ? "s" : ""} need attention` : "All project assets verified"}
            </h2>
            <p style={muted}>
              {assetReport.projectPath || "Project"} · checked {items.length} referenced asset{items.length === 1 ? "" : "s"} by path and SHA-256
              {assetReport.kind === "package" ? " (embedded package)" : ""}. Review before playback; the show itself has loaded.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 12 }}>
              <thead><tr style={{ textAlign: "left", ...muted }}><th>Status</th><th>Asset</th><th>Role</th><th /></tr></thead>
              <tbody>
                {items.map((item) => {
                  const [label, color] = STATUS_STYLE[item.status] || [item.status, "inherit"];
                  return (
                    <tr key={item.id} style={{ borderTop: "1px solid var(--border, #1f2a33)" }}>
                      <td style={{ color, fontWeight: 600, padding: "6px 6px 6px 0", whiteSpace: "nowrap" }}>{label}</td>
                      <td style={{ padding: 6 }}>
                        <div>{item.name}</div>
                        <div style={muted}>{item.resolvedPath || item.relativePath || item.path || item.locator?.assetId || ""}{item.resolvedVia ? ` · via ${item.resolvedVia}` : ""}</div>
                        {item.status === "changed" && <div style={{ ...muted, color: "var(--amber, #f0b429)" }}>Content differs from the saved hash (size {item.size ?? "?"} → {item.actualSize ?? "?"} bytes).</div>}
                      </td>
                      <td style={{ padding: 6 }}>{item.role}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        {item.source !== "embedded" && item.status !== "ok" && (
                          <button className="btn" style={{ fontSize: 11 }} onClick={() => relink(item)}>{item.status === "missing" ? "Locate…" : "Relink…"}</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="btn primary" onClick={() => setAssetReport(null)}>
                {items.some((i) => i.status === "missing" || i.status === "changed") ? "Continue without these assets" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div style={{ position: "fixed", right: 16, bottom: 36, zIndex: 3100, display: "flex", flexDirection: "column", gap: 8, maxWidth: "min(420px, calc(100vw - 32px))" }} aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} role={t.level === "error" ? "alert" : "status"} style={{
              background: "var(--bg-surface, #151d24)", color: "var(--text-primary, #e8eef2)", fontSize: 12, padding: "10px 12px", borderRadius: 8,
              border: `1px solid ${t.level === "error" ? "var(--red, #ff5c5c)" : t.level === "warn" ? "var(--amber, #f0b429)" : "var(--border-mid, #2a3640)"}`,
              boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
            }}>{t.text}</div>
          ))}
        </div>
      )}
    </>
  );
}
