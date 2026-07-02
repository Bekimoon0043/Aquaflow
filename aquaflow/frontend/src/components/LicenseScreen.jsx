/**
 * frontend/src/components/LicenseScreen.jsx  — BETA EDITION
 * ────────────────────────────────────────────────────────────
 * Full-screen license gate shown before the app opens.
 * Exact error messages match the beta spec.
 */

import React, { useState } from "react";
import { useLicense } from "../hooks/useLicense";

export default function LicenseScreen({ onActivated }) {
  const {
    status, message, valid, loading,
    daysRemaining, edition, company_name, user_name,
    licenseKey, expiresAt,
    activateLicense, recheckLicense,
  } = useLicense();

  const [licensePath, setLicensePath] = useState("");
  const [activating, setActivating]   = useState(false);
  const [error, setError]             = useState("");
  const [success, setSuccess]         = useState(false);

  // If valid or grace period — let the user through
  if (!loading && (status === "VALID" || status === "GRACE_PERIOD")) {
    return null; // App renders normally — LicenseGate handles feature blocking
  }

  // Exact error messages from spec
  const ERROR_MESSAGES = {
    INVALID_HW:    "This AquaFlow Studio beta license is not valid for this computer.",
    INVALID_SIG:   "This AquaFlow Studio beta license is not valid for this computer.",
    EXPIRED:       "This AquaFlow Studio beta license has expired.",
    GRACE_EXPIRED: "This AquaFlow Studio beta license has expired.",
    NOT_FOUND:     null, // show activation form instead
    ERROR:         "License verification failed. Please contact LuxuryCon.",
    CHECKING:      null,
  };

  const errorMsg = ERROR_MESSAGES[status];
  const showActivationForm = status === "NOT_FOUND" || status === "CHECKING" || loading;

  const handleActivate = async () => {
    setActivating(true);
    setError("");
    const result = await activateLicense(licensePath || null);
    setActivating(false);
    if (result.success) {
      setSuccess(true);
      setTimeout(() => onActivated?.(), 1200);
    } else {
      setError(result.error || "Activation failed");
    }
  };

  return (
    <div style={s.overlay}>
      <div style={s.card}>

        {/* Logo */}
        <div style={s.logo}>
          <span style={s.logoBlue}>Aqua</span>Flow Studio
        </div>
        <div style={s.vendor}>LuxuryCon Fountain Systems</div>
        <div style={s.divider} />

        {/* Loading */}
        {loading && (
          <div style={s.statusRow}>
            <span style={s.dot}>●</span>
            <span style={s.statusText}>Verifying license…</span>
          </div>
        )}

        {/* Specific error messages — exact wording from spec */}
        {!loading && errorMsg && (
          <div style={s.errorBlock}>
            <div style={s.errorIcon}>⚠</div>
            <div style={s.errorMsg}>{errorMsg}</div>
            {status === "EXPIRED" || status === "GRACE_EXPIRED" ? (
              <div style={s.helpText}>
                Please contact LuxuryCon Fountain Systems to renew your license.
              </div>
            ) : (
              <div style={s.helpText}>
                This license file was issued for a different computer.<br/>
                Contact LuxuryCon to transfer your license to this machine.
              </div>
            )}
          </div>
        )}

        {/* Activation form — shown when no license found */}
        {!loading && showActivationForm && !errorMsg && (
          <>
            {success ? (
              <div style={s.successBlock}>
                <div style={s.successIcon}>✓</div>
                <div style={s.successMsg}>License activated successfully</div>
              </div>
            ) : (
              <>
                <div style={s.formTitle}>License Activation</div>
                <div style={s.formDesc}>
                  Place your <code style={s.code}>active_license.json</code> file in the{" "}
                  <code style={s.code}>backend/license/</code> folder,
                  then click <strong>Check Again</strong>.
                </div>

                <div style={s.divider} />

                <div style={s.orLabel}>— or enter file path manually —</div>
                <input
                  style={s.input}
                  value={licensePath}
                  onChange={(e) => setLicensePath(e.target.value)}
                  placeholder="C:\AquaFlow\active_license.json"
                />
                {error && <div style={s.inlineError}>{error}</div>}
                <button
                  style={{ ...s.btnPrimary, opacity: activating ? 0.6 : 1 }}
                  onClick={handleActivate}
                  disabled={activating}
                >
                  {activating ? "Activating…" : "Activate License"}
                </button>
              </>
            )}
          </>
        )}

        {/* Recheck button — always shown except on success */}
        {!loading && !success && (
          <button style={s.btnSecondary} onClick={recheckLicense}>
            Check Again
          </button>
        )}

        <div style={s.divider} />

        {/* Contact */}
        <div style={s.contactRow}>
          <span style={s.contactLabel}>Need help?</span>
          <span style={s.contactValue}>support@luxurycon.com</span>
        </div>

        {/* Fingerprint helper */}
        <details style={s.details}>
          <summary style={s.detailsSummary}>
            Need to get your machine fingerprint?
          </summary>
          <div style={s.detailsBody}>
            Run this in your backend folder:<br/>
            <code style={s.codeBlock}>python -m license.get_fingerprint</code><br/>
            Send the output to LuxuryCon to receive your license file.
          </div>
        </details>

      </div>
    </div>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const s = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 9999,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "var(--bg-panel)",
  },
  card: {
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "36px 40px", gap: 12,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 12, width: 400,
    boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
  },
  logo: {
    fontSize: 24, fontWeight: 700, color: "var(--text-primary)",
    letterSpacing: "0.03em",
  },
  logoBlue: { color: "var(--accent)" },
  vendor: {
    fontSize: 10, color: "var(--text-muted)",
    letterSpacing: "0.1em", textTransform: "uppercase",
  },
  divider: {
    width: "100%", height: 1,
    background: "var(--border)", margin: "2px 0",
  },
  statusRow: {
    display: "flex", alignItems: "center", gap: 8,
    fontSize: 12, color: "var(--text-muted)",
  },
  dot: { fontSize: 8, color: "var(--accent)" },
  statusText: { fontFamily: "var(--font-mono)" },

  // Error block
  errorBlock: {
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: 8, width: "100%",
    padding: "16px 20px",
    background: "rgba(255,60,60,0.06)",
    border: "1px solid rgba(255,60,60,0.2)",
    borderRadius: 8, textAlign: "center",
  },
  errorIcon: { fontSize: 24 },
  errorMsg: {
    fontSize: 13, fontWeight: 500, color: "var(--red)",
    lineHeight: 1.5,
  },
  helpText: {
    fontSize: 10, color: "var(--text-muted)", lineHeight: 1.7,
  },

  // Success block
  successBlock: {
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: 8, width: "100%",
    padding: "16px 20px",
    background: "rgba(0,255,100,0.06)",
    border: "1px solid rgba(0,255,100,0.2)",
    borderRadius: 8, textAlign: "center",
  },
  successIcon: { fontSize: 28, color: "var(--green)" },
  successMsg: { fontSize: 13, fontWeight: 500, color: "var(--green)" },

  // Form
  formTitle: {
    fontSize: 14, fontWeight: 600, color: "var(--text-primary)",
    alignSelf: "flex-start",
  },
  formDesc: {
    fontSize: 11, color: "var(--text-muted)",
    lineHeight: 1.7, alignSelf: "flex-start",
  },
  orLabel: {
    fontSize: 9, color: "var(--text-muted)",
    letterSpacing: "0.08em",
  },
  input: {
    width: "100%", padding: "8px 10px",
    background: "var(--bg-raised)",
    border: "1px solid var(--border)",
    borderRadius: 5, color: "var(--text-primary)",
    fontSize: 12, outline: "none",
    fontFamily: "var(--font-mono)",
    boxSizing: "border-box",
  },
  inlineError: {
    fontSize: 11, color: "var(--red)", alignSelf: "flex-start",
  },

  // Buttons
  btnPrimary: {
    width: "100%", padding: "10px",
    background: "rgba(0,212,255,0.12)",
    border: "1px solid rgba(0,212,255,0.3)",
    borderRadius: 6, color: "var(--accent)",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  btnSecondary: {
    width: "100%", padding: "8px",
    background: "var(--bg-raised)",
    border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text-muted)",
    fontSize: 11, cursor: "pointer",
  },

  // Contact
  contactRow: {
    display: "flex", gap: 8, alignItems: "center",
    fontSize: 10,
  },
  contactLabel: { color: "var(--text-muted)" },
  contactValue: {
    color: "var(--accent)", fontFamily: "var(--font-mono)",
  },

  // Details
  details: { width: "100%", marginTop: 4 },
  detailsSummary: {
    fontSize: 10, color: "var(--text-muted)",
    cursor: "pointer", userSelect: "none",
  },
  detailsBody: {
    fontSize: 10, color: "var(--text-muted)",
    lineHeight: 1.9, marginTop: 6, paddingLeft: 8,
  },
  code: {
    fontFamily: "var(--font-mono)", fontSize: 10,
    color: "var(--accent)", background: "rgba(0,212,255,0.08)",
    padding: "1px 5px", borderRadius: 3,
  },
  codeBlock: {
    display: "block", fontFamily: "var(--font-mono)", fontSize: 11,
    color: "var(--accent)", background: "rgba(0,212,255,0.06)",
    padding: "6px 10px", borderRadius: 4, marginTop: 4,
  },
};
