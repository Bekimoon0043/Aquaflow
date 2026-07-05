// FleetPanel.jsx — AquaFlow Fleet Management (AQ-S5-004)
//
// Central dashboard for a fleet of fountain sites: per-site health, an online/offline
// + health rollup, and one centralised, severity-ranked alert feed with acknowledge.
// Consumes /api/fleet.
import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost } from "../../utils/apiClient";

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };
const HEALTH = {
  live: "#22c55e", warning: "#f59e0b", critical: "#ef4444", estop: "#ef4444",
  idle: "#64748b", offline: "#64748b",
};
const SEV = { critical: "#ef4444", warning: "#f59e0b", info: "#38bdf8" };

export default function FleetPanel() {
  const [dash, setDash] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setDash(await apiGet("/fleet/dashboard"));
      setAlerts((await apiGet("/fleet/alerts")).alerts || []);
      setError("");
    } catch (e) { setError(String(e.message || e)); }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);      // central live monitoring
    return () => clearInterval(t);
  }, [refresh]);

  const ack = async (site_id, code) => {
    try { await apiPost("/fleet/alerts/ack", { site_id, code }); refresh(); }
    catch (e) { setError(String(e.message || e)); }
  };

  const stat = (label, value, color) => (
    <div style={{ ...box, padding: 8, minWidth: 80, flex: 1 }}>
      <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || "var(--text-primary)" }}>{value}</div>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>🌐</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Fleet Management
        </span>
        <button onClick={refresh} style={{ marginLeft: "auto", background: "transparent",
          border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)",
          fontSize: 10, padding: "3px 8px", cursor: "pointer" }}>↻ Refresh</button>
      </div>

      {dash && (
        <div style={{ display: "flex", gap: 8, padding: 10, borderBottom: "1px solid var(--border)" }}>
          {stat("Sites", dash.site_count)}
          {stat("Online", dash.online, "#22c55e")}
          {stat("Offline", dash.offline, dash.offline ? "#f59e0b" : "#22c55e")}
          {stat("Alerts", dash.total_active_alerts, dash.total_active_alerts ? "#f59e0b" : "#22c55e")}
          {stat("Critical", dash.critical_alerts, dash.critical_alerts ? "#ef4444" : "#22c55e")}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* sites */}
        <div style={{ flex: 1, overflow: "auto", padding: 10, borderRight: "1px solid var(--border)" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 4 }}>SITES</div>
          {error && <div style={{ ...box, padding: 8, color: "#ef4444", fontSize: 10, marginBottom: 6 }}>⛔ {error}</div>}
          {(dash?.sites || []).map((s) => (
            <div key={s.id} style={{ ...box, padding: "8px 10px", marginBottom: 5,
              borderLeft: `3px solid ${HEALTH[s.health] || "#888"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: HEALTH[s.health] }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{s.name}</span>
                <span style={{ fontSize: 9, color: HEALTH[s.health], textTransform: "uppercase" }}>{s.health}</span>
              </div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 3 }}>
                {s.location || "—"}{s.playing ? " · ▶ playing" : ""}{s.alert_count ? ` · ${s.alert_count} alerts` : ""}
                {!s.online ? " · offline" : ""}
              </div>
            </div>
          ))}
        </div>

        {/* centralised alerts */}
        <div style={{ width: 300, overflow: "auto", padding: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 4 }}>CENTRALISED ALERTS ({alerts.length})</div>
          {alerts.length === 0 ? (
            <div style={{ fontSize: 11, color: "#22c55e" }}>✓ No active fleet alerts.</div>
          ) : alerts.map((a, i) => (
            <div key={i} style={{ ...box, padding: "6px 8px", marginBottom: 4,
              borderLeft: `3px solid ${SEV[a.severity] || "#888"}`, opacity: a.acknowledged ? 0.6 : 1 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: SEV[a.severity], fontWeight: 600 }}>{a.site_name}</div>
                  <div style={{ fontSize: 10.5, color: "var(--text-primary)" }}>{a.message}</div>
                  <div style={{ fontSize: 8.5, color: "var(--text-muted)" }}>{a.severity} · {a.code}
                    {a.acknowledged ? " · acknowledged" : ""}</div>
                </div>
                {!a.acknowledged && a.code !== "SITE_OFFLINE" && (
                  <button onClick={() => ack(a.site_id, a.code)} style={{ background: "transparent",
                    border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)",
                    fontSize: 9, padding: "2px 6px", cursor: "pointer", alignSelf: "flex-start" }}>Ack</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
