// RealtimeValidationPanel.jsx — AquaFlow Real-Time Validation Display (AQ-X-011)
//
// Live system-monitoring panel: re-validates the current design on every change and
// shows errors/warnings immediately, each linked to the offending fixture. Runs the
// pure liveValidation engine locally (no network) so the result is always well within
// the 100 ms latency budget, which is displayed for transparency.
import { useMemo } from "react";
import useEngineeringStore from "../../store/engineeringStore";
import { validateSystem, LATENCY_BUDGET_MS } from "../../validation/liveValidation";

const SEV = {
  error:   { color: "#ef4444", icon: "⛔", label: "Error" },
  warning: { color: "#f59e0b", icon: "⚠", label: "Warning" },
  info:    { color: "#38bdf8", icon: "ℹ", label: "Info" },
};

export default function RealtimeValidationPanel() {
  const fixtures = useEngineeringStore((s) => s.fixtures) || [];
  const selectFixture = useEngineeringStore((s) => s.selectFixture || s.setSelectedFixture);

  // Re-runs synchronously on every fixture change → real-time, immediate highlighting.
  const validation = useMemo(() => validateSystem({ fixtures }), [fixtures]);
  const { ok, results, counts, durationMs, withinLatencyBudget } = validation;

  const jump = (target) => {
    if (target && typeof selectFixture === "function") selectFixture(target);
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
      background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>◉</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Live Validation
        </span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {/* latency badge */}
          <span title="Validation compute time" style={{ fontSize: 9,
            color: withinLatencyBudget ? "#22c55e" : "#ef4444",
            fontFamily: "var(--font-mono, monospace)" }}>
            {durationMs.toFixed(1)} ms {withinLatencyBudget ? `✓ <${LATENCY_BUDGET_MS}ms` : "⚠ slow"}
          </span>
          {/* status pill */}
          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
            background: ok ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
            color: ok ? "#22c55e" : "#ef4444" }}>
            {ok ? "All checks passed" : `${counts.error} error${counts.error === 1 ? "" : "s"}`}
            {counts.warning ? ` · ${counts.warning} warn` : ""}
          </span>
        </span>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
        {results.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: "100%", color: "#22c55e", gap: 6 }}>
            <div style={{ fontSize: 30 }}>✓</div>
            <div style={{ fontSize: 12 }}>System valid — {fixtures.length} fixtures checked in {durationMs.toFixed(1)} ms</div>
          </div>
        ) : (
          results.map((r) => {
            const s = SEV[r.severity] || SEV.info;
            return (
              <div key={r.id}
                onClick={() => jump(r.target)}
                style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 8px",
                  marginBottom: 4, borderRadius: 6, background: "var(--bg-surface)",
                  borderLeft: `3px solid ${s.color}`,
                  cursor: r.target ? "pointer" : "default" }}>
                <span style={{ color: s.color, fontSize: 12, lineHeight: "16px" }}>{s.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "var(--text-primary)" }}>{r.message}</div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 1 }}>
                    {r.code.replace(/_/g, " ")}
                    {r.target ? <span style={{ color: s.color }}> · {r.target} ↗</span> : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-surface)",
        padding: "5px 12px", flexShrink: 0, fontSize: 9, color: "var(--text-muted)",
        display: "flex", gap: 14 }}>
        <span>🔴 {counts.error} errors</span>
        <span>🟡 {counts.warning} warnings</span>
        <span style={{ marginLeft: "auto" }}>Re-validated live on every design change</span>
      </div>
    </div>
  );
}
