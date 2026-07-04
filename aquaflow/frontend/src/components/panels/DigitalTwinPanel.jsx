// DigitalTwinPanel.jsx — AquaFlow Digital Twin (AQ-S5-001)
//
// Live mirror of the physical assets with predictive-maintenance forecasts. Shows each
// asset's mirrored telemetry, a fleet summary, and per-asset service forecast + trend
// alerts. Consumes /api/twin.
import { useEffect, useState, useCallback } from "react";
import { apiGet } from "../../utils/apiClient";

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };
const STATUS_COLOR = { ok: "#22c55e", due_soon: "#f59e0b", overdue: "#ef4444" };
const SEV_COLOR = { critical: "#ef4444", warning: "#f59e0b" };

export default function DigitalTwinPanel() {
  const [assets, setAssets] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const m = await apiGet("/twin/mirror"); setAssets(m.assets || []);
      setSummary(await apiGet("/twin/summary"));
      setError("");
    } catch (e) { setError(String(e.message || e)); }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);      // live mirror polling
    return () => clearInterval(t);
  }, [refresh]);

  const openAsset = async (id) => {
    setSelected(id);
    try { setDetail(await apiGet(`/twin/assets/${id}/forecast`)); }
    catch (e) { setError(String(e.message || e)); }
  };

  const cell = (label, value, color) => (
    <div style={{ ...box, padding: 8, minWidth: 84, flex: 1 }}>
      <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color || "var(--text-primary)" }}>{value}</div>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>🛰</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Digital Twin
        </span>
        <button onClick={refresh} style={{ marginLeft: "auto", background: "transparent",
          border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)",
          fontSize: 10, padding: "3px 8px", cursor: "pointer" }}>↻ Refresh</button>
      </div>

      {summary && (
        <div style={{ display: "flex", gap: 8, padding: 10, borderBottom: "1px solid var(--border)" }}>
          {cell("Assets", summary.asset_count)}
          {cell("Running", summary.running, "#22c55e")}
          {cell("Needs service", summary.needs_service, summary.needs_service ? "#ef4444" : "#22c55e")}
          {cell("Alerts", summary.alerts.length, summary.alerts.length ? "#f59e0b" : "#22c55e")}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ width: 220, borderRight: "1px solid var(--border)", overflow: "auto", flexShrink: 0, padding: 8 }}>
          {error && <div style={{ ...box, padding: 8, color: "#ef4444", fontSize: 10, marginBottom: 6 }}>⛔ {error}</div>}
          {assets.length === 0 && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No mirrored assets yet.</div>}
          {assets.map((a) => (
            <div key={a.id} onClick={() => openAsset(a.id)} style={{ ...box, padding: 8, marginBottom: 6, cursor: "pointer",
              borderColor: selected === a.id ? "var(--accent)" : "var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%",
                  background: a.state?.running ? "#22c55e" : "#64748b" }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{a.name}</span>
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{a.type}</span>
              </div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 3 }}>
                {a.state?.runtime_hours ?? 0} h
                {a.state?.temperature_c != null ? ` · ${a.state.temperature_c}°C` : ""}
                {" · "}{a.sample_count} samples
              </div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          {!detail ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Select an asset to see its predictive-maintenance forecast.</div>
          ) : (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
                {assets.find((a) => a.id === selected)?.name || selected}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {cell("Status", detail.forecast.status.replace("_", " ").toUpperCase(), STATUS_COLOR[detail.forecast.status])}
                {cell("Hours remaining", detail.forecast.hours_remaining)}
                {cell("h / day", detail.forecast.accrual_hours_per_day)}
                {cell("Days to service", detail.forecast.days_to_service ?? "—")}
              </div>
              {detail.forecast.estimated_service_date && (
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 10 }}>
                  Estimated service: {new Date(detail.forecast.estimated_service_date).toLocaleDateString()}
                </div>
              )}
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>PREDICTIVE ALERTS</div>
              {detail.alerts.length === 0 ? (
                <div style={{ fontSize: 11, color: "#22c55e" }}>✓ No predictive alerts.</div>
              ) : detail.alerts.map((al, i) => (
                <div key={i} style={{ ...box, padding: "6px 8px", marginBottom: 4,
                  borderLeft: `3px solid ${SEV_COLOR[al.severity] || "#888"}` }}>
                  <div style={{ fontSize: 11, color: "var(--text-primary)" }}>{al.message}</div>
                  <div style={{ fontSize: 9, color: SEV_COLOR[al.severity] }}>{al.severity} · {al.type.replace(/_/g, " ")}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
