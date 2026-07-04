// MobileMonitorPanel.jsx — AquaFlow Mobile Monitoring UI (AQ-X-014)
//
// Connects the mobile-monitoring backend (AQ-S3-009) to the UI: shows the live
// operator snapshot and prioritised alerts, and lets the operator acknowledge alerts.
import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost } from "../../utils/apiClient";

const HEALTH_COLOR = { estop: "#ef4444", critical: "#ef4444", warning: "#f59e0b", live: "#22c55e", idle: "#64748b" };
const SEV_COLOR = { critical: "#ef4444", warning: "#f59e0b", info: "#38bdf8" };
const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };

export default function MobileMonitorPanel() {
  const [snapshot, setSnapshot] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const s = await apiGet("/mobile/status");
      setSnapshot(s.snapshot || s);
      const a = await apiGet("/mobile/alerts");
      setAlerts(a.alerts || a || []);
      setError("");
    } catch (e) { setError(String(e.message || e)); }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);       // live polling
    return () => clearInterval(t);
  }, [refresh]);

  const ack = async (code) => {
    try { await apiPost("/mobile/alerts/ack", { code }); refresh(); }
    catch (e) { setError(String(e.message || e)); }
  };

  const cell = (label, value, color) => (
    <div style={{ ...box, padding: 8, minWidth: 90, flex: 1 }}>
      <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: color || "var(--text-primary)" }}>{value}</div>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>📱</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Mobile Monitoring
        </span>
        <button onClick={refresh} style={{ marginLeft: "auto", background: "transparent",
          border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)",
          fontSize: 10, padding: "3px 8px", cursor: "pointer" }}>↻ Refresh</button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 10 }}>
        {error && <div style={{ ...box, padding: 8, color: "#ef4444", fontSize: 11, marginBottom: 8 }}>⛔ {error}</div>}
        {snapshot && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {cell("Health", (snapshot.health || "—").toUpperCase(), HEALTH_COLOR[snapshot.health])}
            {cell("State", snapshot.state || "—")}
            {cell("Playing", snapshot.playing ? "▶ Yes" : "❚❚ No")}
            {cell("Progress", `${snapshot.progress_pct ?? 0}%`)}
            {cell("Permit", snapshot.permit ? "granted" : "—", snapshot.permit ? "#22c55e" : "#ef4444")}
            {cell("Faults", snapshot.fault_count ?? 0, (snapshot.fault_count ? "#ef4444" : undefined))}
            {cell("PLC", snapshot.plc_online ? "online" : "offline", snapshot.plc_online ? "#22c55e" : "#ef4444")}
          </div>
        )}

        <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>ALERTS ({alerts.length})</div>
        {alerts.length === 0 ? (
          <div style={{ color: "#22c55e", fontSize: 11 }}>✓ No active alerts.</div>
        ) : alerts.map((a, i) => (
          <div key={i} style={{ ...box, display: "flex", gap: 8, alignItems: "center", padding: "6px 8px",
            marginBottom: 4, borderLeft: `3px solid ${SEV_COLOR[a.severity] || "#888"}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-primary)" }}>{a.message}</div>
              <div style={{ fontSize: 9, color: SEV_COLOR[a.severity] }}>{a.severity} · {a.code}
                {a.acknowledged ? " · acknowledged" : ""}</div>
            </div>
            {!a.acknowledged && (
              <button onClick={() => ack(a.code)} style={{ background: "transparent",
                border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)",
                fontSize: 10, padding: "3px 8px", cursor: "pointer" }}>Ack</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
