import React from "react";
import { useShowStore } from "../store/showStore";
import { BACKEND_ORIGIN, HEALTH_URL } from "../config";

const STATES = {
  disconnected: { color: "#c9a227", bg: "rgba(201,162,39,0.08)", border: "rgba(201,162,39,0.2)", icon: "⚡", msg: "Connecting to LuxuryCon Fountain Studio backend..." },
  connecting:   { color: "#c9a227", bg: "rgba(201,162,39,0.08)", border: "rgba(201,162,39,0.2)", icon: "⟳", msg: "Connecting to backend..." },
  connected:    null,
  error:        { color: "#ef4444", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.2)", icon: "✕", msg: "Backend connection error. Retrying..." },
  failed:       { color: "#ef4444", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.2)", icon: "✕", msg: "Cannot reach backend. Confirm the Python server is running on port 8000." },
};

export default function ConnectionBanner({ compact = false }) {
  const { connectionState } = useShowStore();
  const cfg = STATES[connectionState];
  if (!cfg) return null;

  const showHints = connectionState === "failed" || connectionState === "error";

  // Compact form for the status bar: always visible while the engine is not connected.
  if (compact) {
    const level = showHints ? "is-error" : "is-warn";
    const label = showHints ? "Engine offline" : "Engine connecting…";
    return (
      <details className={`pro-status-chip ${level}`}>
        <summary role="status" aria-live="polite" title={cfg.msg}>{cfg.icon} {label}</summary>
        <div className="pro-status-pop">
          <p>{cfg.msg}</p>
          {showHints && (
            <>
              <p>Backend: <code>{BACKEND_ORIGIN}</code></p>
              <p>Health: <code>{HEALTH_URL}</code></p>
              <p>Windows: <code>cd backend &amp;&amp; py -m uvicorn main:app --reload --host 0.0.0.0 --port 8000</code></p>
            </>
          )}
        </div>
      </details>
    );
  }

  return (
    <div style={{
      background: cfg.bg,
      borderBottom: `1px solid ${cfg.border}`,
      color: cfg.color,
      fontSize: 11,
      fontFamily: "var(--font-mono)",
      padding: "5px 16px",
      display: "flex",
      alignItems: "center",
      gap: 8,
      flexShrink: 0,
      flexWrap: "wrap",
    }}>
      <span style={{ animation: connectionState === "connecting" ? "pulse-glow 1s infinite" : "none" }}>
        {cfg.icon}
      </span>
      <span>{cfg.msg}</span>
      {showHints && (
        <>
          <span style={{ opacity: 0.72 }}>
            backend: <code style={{ background: "rgba(0,0,0,0.2)", padding: "1px 6px", borderRadius: 3 }}>{BACKEND_ORIGIN}</code>
          </span>
          <span style={{ opacity: 0.72 }}>
            health: <code style={{ background: "rgba(0,0,0,0.2)", padding: "1px 6px", borderRadius: 3 }}>{HEALTH_URL}</code>
          </span>
          <span style={{ marginLeft: 8, opacity: 0.72 }}>
            Windows: <code style={{ background: "rgba(0,0,0,0.2)", padding: "1px 6px", borderRadius: 3 }}>
              cd backend && py -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
            </code>
          </span>
        </>
      )}
    </div>
  );
}
