// CommissioningBanner.jsx — AF-HUB-000C honest hardware labeling.
//
// Persistent banner shown on every screen (including all live/output screens)
// while the system-wide hardware-commissioning flag is FALSE:
//   "Hardware not commissioned — simulated output only"
//
// Fail-safe by design: the banner is shown unless the backend EXPLICITLY confirms
// hardware_commissioned === true. If the status is unknown or the backend is
// unreachable, we assume NOT commissioned and keep the banner up — the honest
// default. It can never be permanently dismissed while the flag is FALSE, so the
// "simulated output" claim can't silently disappear.
import React, { useEffect, useState } from "react";
import { apiGet } from "../utils/apiClient";

const DEFAULT_TEXT = "Hardware not commissioned — simulated output only";

export default function CommissioningBanner({ compact = false }) {
  const [status, setStatus] = useState(null); // null = unknown → show (fail-safe)

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await apiGet("/hardware/commissioning");
        if (alive) setStatus(s || {});
      } catch {
        if (alive) setStatus({ hardware_commissioned: false, banner: DEFAULT_TEXT });
      }
    };
    load();
    const t = setInterval(load, 60000); // re-check periodically; cheap
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Only hide when the backend explicitly reports commissioned === true.
  if (status && status.hardware_commissioned === true) return null;

  const text = (status && status.banner) || DEFAULT_TEXT;
  // Compact form for the status bar: the warning stays visible at all times (it is not
  // hidden behind a click); only the longer explanation folds away.
  if (compact) {
    return (
      <details className="pro-status-chip is-warn">
        <summary role="status" aria-live="polite" title={text}>⚠ Simulated output</summary>
        <div className="pro-status-pop">{text}</div>
      </details>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        flexShrink: 0,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "4px 12px",
        background: "repeating-linear-gradient(45deg,var(--bg-panel),var(--bg-panel) 10px,var(--bg-base) 10px,var(--bg-base) 20px)",
        borderBottom: "1px solid var(--warn)",
        color: "var(--warn)",
        fontSize: 11,
        fontFamily: "var(--font-mono, monospace)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        fontWeight: 700,
        zIndex: 400,
      }}
    >
      <span aria-hidden="true">⚠</span>
      <span>{text}</span>
      <span aria-hidden="true">⚠</span>
    </div>
  );
}
