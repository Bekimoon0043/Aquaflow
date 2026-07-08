/**
 * AppLicenseGate.jsx — AF-PKG-ENABLE-LICENSE
 * ────────────────────────────────────────────────────────────
 * Whole-app license gate. Until a valid machine-locked license is active, this renders a
 * clean activation screen (machine ID + Load License File) instead of the studio. Once the
 * backend reports VALID / GRACE_PERIOD, the wrapped app renders.
 *
 * Designed for the PACKAGED desktop app: the machine ID is read from the backend
 * (/api/license/fingerprint) and shown on-screen with a copy button (employees have no
 * Python to run get_fingerprint), and a license file is loaded via the Electron file dialog
 * (window.aquaflow.installLicenseFromFile) which validates it, then atomically installs it to
 * ~/.aquaflow/license.json.
 */

import React, { useEffect, useState, useCallback } from "react";
import { useLicense } from "../hooks/useLicense";
import { API_BASE_URL } from "../config";

// Per-status wording. INVALID_HW (wrong machine) and INVALID_SIG (corrupt/tampered) are
// distinct problems and must read differently (Codex audit fix #2).
const STATUS_INFO = {
  INVALID_HW:   { msg: "This license was issued for a different computer.",
                  help: "Send the Machine ID below to LuxuryCon to get a license for THIS machine." },
  INVALID_SIG:  { msg: "This license file is invalid or damaged.",
                  help: "The file may be corrupted or incomplete. Ask LuxuryCon to re-send your license file." },
  INVALID_FILE: { msg: "That file is not a valid AquaFlow license.",
                  help: "Make sure you selected the license.json file LuxuryCon sent you." },
  EXPIRED:      { msg: "This AquaFlow Studio license has expired.",
                  help: "Contact LuxuryCon Fountain Systems to renew your license." },
  GRACE_EXPIRED:{ msg: "This AquaFlow Studio license has expired.",
                  help: "Contact LuxuryCon Fountain Systems to renew your license." },
  ERROR:        { msg: "Could not verify the license. Is the engine running?", help: "" },
};

export default function AppLicenseGate({ children }) {
  const { loading, valid, status, activateLicense, recheckLicense } = useLicense();

  const [fingerprint, setFingerprint] = useState("");
  const [fpError, setFpError]         = useState(false);
  const [copied, setCopied]           = useState(false);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState("");
  const [manualPath, setManualPath]   = useState("");

  // Fetch this machine's ID so the employee can send it to LuxuryCon. On failure the screen
  // must not silently sit on "reading machine ID" — show an error + Retry (Codex audit fix #3).
  const fetchFingerprint = useCallback(() => {
    setFpError(false);
    setFingerprint("");
    fetch(`${API_BASE_URL}/license/fingerprint`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (d && d.fingerprint) setFingerprint(d.fingerprint);
        else throw new Error("no fingerprint in response");
      })
      .catch(() => setFpError(true));
  }, []);

  useEffect(() => { fetchFingerprint(); }, [fetchFingerprint]);

  const copyId = useCallback(async () => {
    try { await navigator.clipboard.writeText(fingerprint); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard may be unavailable; the value is selectable on screen */ }
  }, [fingerprint]);

  // Packaged flow: the OS dialog picks a file, the main process VALIDATES it, and only then
  // atomically installs it. We just react to the result and re-check.
  const loadLicenseFile = useCallback(async () => {
    setError("");
    setBusy(true);
    try {
      const res = await window.aquaflow?.installLicenseFromFile?.();
      if (!res) { setError("File loading is only available in the desktop app."); return; }
      if (res.canceled) return;
      if (!res.ok) { setError((STATUS_INFO[res.status] && STATUS_INFO[res.status].msg) || res.error || "Could not load that license file."); return; }
      const ok = await recheckLicense();
      if (!ok) setError("License installed but could not be verified — click Check Again.");
    } catch (e) {
      setError(String(e && e.message ? e.message : e));
    } finally {
      setBusy(false);
    }
  }, [recheckLicense]);

  const activateManual = useCallback(async () => {
    if (!manualPath.trim()) return;
    setError(""); setBusy(true);
    const act = await activateLicense(manualPath.trim());
    setBusy(false);
    if (!act.success) setError(act.error || "Activation failed.");
  }, [manualPath, activateLicense]);

  // ── Verifying ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={s.overlay}>
        <div style={s.card}>
          <Logo />
          <div style={s.statusRow}><span style={s.dot}>●</span>
            <span style={s.statusText}>Verifying license…</span></div>
        </div>
      </div>
    );
  }

  // ── Licensed → run the app ───────────────────────────────────────────────────
  if (valid || status === "VALID" || status === "GRACE_PERIOD") {
    return children;
  }

  // ── Locked → activation screen ───────────────────────────────────────────────
  const active = STATUS_INFO[status]; // the CURRENTLY-STORED license is bad (not just NOT_FOUND)
  const hasElectron = typeof window !== "undefined" && !!(window.aquaflow && window.aquaflow.installLicenseFromFile);

  return (
    <div style={s.overlay}>
      <div style={s.card}>
        <Logo />
        <div style={s.divider} />

        {active && (
          <div style={s.errorBlock}>
            <div style={s.errorIcon}>⚠</div>
            <div style={s.errorMsg}>{active.msg}</div>
            {active.help && <div style={s.helpText}>{active.help}</div>}
          </div>
        )}

        {!active && (
          <div style={s.lead}>Activate AquaFlow Studio to continue.</div>
        )}

        {/* Machine ID */}
        <div style={s.idLabel}>Your Machine ID</div>
        <div style={s.idBox} title="Send this to LuxuryCon to receive your license">
          {fpError ? (
            <span style={s.idErr}>⚠ Could not read Machine ID — is the engine running?</span>
          ) : (
            <span style={s.idText}>{fingerprint || "…reading machine ID…"}</span>
          )}
        </div>
        {fpError ? (
          <button style={s.btnGhost} onClick={fetchFingerprint}>Retry reading Machine ID</button>
        ) : (
          <button style={s.btnGhost} onClick={copyId} disabled={!fingerprint}>
            {copied ? "✓ Copied" : "Copy Machine ID"}
          </button>
        )}

        <div style={s.instr}>
          1. Send your Machine ID to LuxuryCon.<br/>
          2. You'll receive a <code style={s.code}>license.json</code> file.<br/>
          3. Load it below to unlock AquaFlow on this computer.
        </div>

        {error && <div style={s.inlineError}>{error}</div>}

        {hasElectron ? (
          <button style={{ ...s.btnPrimary, opacity: busy ? 0.6 : 1 }} onClick={loadLicenseFile} disabled={busy}>
            {busy ? "Activating…" : "Load License File…"}
          </button>
        ) : (
          <>
            <input style={s.input} value={manualPath} onChange={(e) => setManualPath(e.target.value)}
                   placeholder="Path to license.json" />
            <button style={{ ...s.btnPrimary, opacity: busy ? 0.6 : 1 }} onClick={activateManual} disabled={busy}>
              {busy ? "Activating…" : "Activate License"}
            </button>
          </>
        )}

        <button style={s.btnSecondary} onClick={recheckLicense}>Check Again</button>

        <div style={s.divider} />
        <div style={s.contactRow}>
          <span style={s.contactLabel}>Need help?</span>
          <span style={s.contactValue}>support@luxurycon.com</span>
        </div>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <>
      <div style={s.logo}><span style={s.logoBlue}>Aqua</span>Flow Studio</div>
      <div style={s.vendor}>LuxuryCon Fountain Systems</div>
    </>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center",
             justifyContent: "center", background: "var(--bg-panel, #0a0e12)" },
  card: { display: "flex", flexDirection: "column", alignItems: "center", padding: "34px 40px",
          gap: 11, background: "var(--bg-surface, #12181f)", border: "1px solid var(--border, #223)",
          borderRadius: 12, width: 420, boxShadow: "0 8px 40px rgba(0,0,0,0.45)" },
  logo: { fontSize: 24, fontWeight: 700, color: "var(--text-primary, #eaf2ec)", letterSpacing: "0.03em" },
  logoBlue: { color: "var(--accent, #00d4ff)" },
  vendor: { fontSize: 10, color: "var(--text-muted, #7c8a90)", letterSpacing: "0.1em", textTransform: "uppercase" },
  divider: { width: "100%", height: 1, background: "var(--border, #223)", margin: "2px 0" },
  statusRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted, #7c8a90)" },
  dot: { fontSize: 8, color: "var(--accent, #00d4ff)" },
  statusText: { fontFamily: "var(--font-mono, monospace)" },
  lead: { fontSize: 13, color: "var(--text-primary, #eaf2ec)", textAlign: "center" },
  idLabel: { fontSize: 10, color: "var(--text-muted, #7c8a90)", letterSpacing: "0.08em",
             textTransform: "uppercase", alignSelf: "flex-start" },
  idBox: { width: "100%", padding: "10px 12px", background: "var(--bg-raised, #0c1116)",
           border: "1px solid var(--border, #223)", borderRadius: 6, boxSizing: "border-box" },
  idText: { fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--accent, #00d4ff)",
            wordBreak: "break-all", userSelect: "all", lineHeight: 1.5 },
  idErr: { fontSize: 11, color: "var(--red, #e0685f)", lineHeight: 1.5 },
  instr: { fontSize: 11, color: "var(--text-muted, #7c8a90)", lineHeight: 1.9, alignSelf: "flex-start" },
  code: { fontFamily: "var(--font-mono, monospace)", fontSize: 10, color: "var(--accent, #00d4ff)",
          background: "rgba(0,212,255,0.08)", padding: "1px 5px", borderRadius: 3 },
  input: { width: "100%", padding: "8px 10px", background: "var(--bg-raised, #0c1116)",
           border: "1px solid var(--border, #223)", borderRadius: 5, color: "var(--text-primary, #eaf2ec)",
           fontSize: 12, outline: "none", fontFamily: "var(--font-mono, monospace)", boxSizing: "border-box" },
  inlineError: { fontSize: 11, color: "var(--red, #e0685f)", alignSelf: "flex-start", lineHeight: 1.5 },
  btnPrimary: { width: "100%", padding: "10px", background: "rgba(0,212,255,0.12)",
                border: "1px solid rgba(0,212,255,0.3)", borderRadius: 6, color: "var(--accent, #00d4ff)",
                fontSize: 13, fontWeight: 600, cursor: "pointer" },
  btnSecondary: { width: "100%", padding: "8px", background: "var(--bg-raised, #0c1116)",
                  border: "1px solid var(--border, #223)", borderRadius: 6, color: "var(--text-muted, #7c8a90)",
                  fontSize: 11, cursor: "pointer" },
  btnGhost: { alignSelf: "flex-start", padding: "5px 10px", background: "transparent",
              border: "1px solid var(--border, #223)", borderRadius: 5, color: "var(--text-muted, #7c8a90)",
              fontSize: 11, cursor: "pointer" },
  errorBlock: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "100%",
                padding: "14px 18px", background: "rgba(255,60,60,0.06)",
                border: "1px solid rgba(255,60,60,0.2)", borderRadius: 8, textAlign: "center" },
  errorIcon: { fontSize: 22 },
  errorMsg: { fontSize: 13, fontWeight: 500, color: "var(--red, #e0685f)", lineHeight: 1.5 },
  helpText: { fontSize: 10, color: "var(--text-muted, #7c8a90)", lineHeight: 1.7 },
  contactRow: { display: "flex", gap: 8, alignItems: "center", fontSize: 10 },
  contactLabel: { color: "var(--text-muted, #7c8a90)" },
  contactValue: { color: "var(--accent, #00d4ff)", fontFamily: "var(--font-mono, monospace)" },
};
