// WindDriftPanel.jsx — AquaFlow Wind Drift Safety Display (AQ-X-012)
//
// Operator display for outdoor-fountain wind safety: enter live weather (or feed a
// station) and the panel recomputes, in real time, how far the spray drifts, the
// resulting keep-clear/exclusion zone, and severity-ranked operator warnings. Runs
// the pure windDrift engine locally so the safety zone updates instantly.
import { useMemo, useState } from "react";
import useEngineeringStore from "../../store/engineeringStore";
import { analyzeWindDrift } from "../../weather/windDrift";

const NOZZLE_RE = /nozzle|jet|geyser|spray|fan|arch|laminar|foam|running|mist|crown/i;
const SEV = {
  critical: { color: "#ef4444", icon: "⛔" },
  warning:  { color: "#f97316", icon: "⚠" },
  caution:  { color: "#f59e0b", icon: "▲" },
  info:     { color: "#22c55e", icon: "✓" },
};

export default function WindDriftPanel() {
  const fixtures = useEngineeringStore((s) => s.fixtures) || [];
  const [windSpeed, setWindSpeed] = useState(6);
  const [windDirection, setWindDirection] = useState(270);
  const [keepClear, setKeepClear] = useState(5);

  const jets = useMemo(() => fixtures
    .filter((f) => f && f.x != null && f.y != null && NOZZLE_RE.test(f.type || ""))
    .map((f) => ({ id: f.id, x: f.x, y: f.y, height: f.height ?? 4, splashRadius: 0.5 })),
  [fixtures]);

  const result = useMemo(
    () => analyzeWindDrift({ keepClearM: keepClear, jets }, { windSpeed, windDirection }),
    [jets, windSpeed, windDirection, keepClear]);

  const { zones, warnings, summary } = result;
  // Top-down SVG scale: fit the exclusion radius into a 260px box.
  const R = Math.max(zones.exclusionRadiusM, keepClear, 1);
  const scale = 110 / R;
  const cxp = 140, cyp = 140;
  const wind = zones.wind;
  const wmag = Math.max(1e-9, wind.magnitude);
  const arrow = [wind.east / wmag, wind.north / wmag];

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
      background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>🌬</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Wind Drift Safety
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600, padding: "2px 8px",
          borderRadius: 10, background: summary.safe ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          color: summary.safe ? "#22c55e" : "#ef4444" }}>
          {summary.safe ? "Within safe limits" : `${summary.breachCount} breach${summary.breachCount === 1 ? "" : "es"}`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 10, padding: "8px 10px", flexWrap: "wrap",
        borderBottom: "1px solid var(--border)", fontSize: 10, color: "var(--text-muted)" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 120 }}>
          Wind speed: <b style={{ color: "var(--text-primary)" }}>{windSpeed.toFixed(1)} m/s</b>
          <input type="range" min="0" max="20" step="0.5" value={windSpeed}
            onChange={(e) => setWindSpeed(Number(e.target.value))} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 120 }}>
          Wind from: <b style={{ color: "var(--text-primary)" }}>{windDirection}°</b>
          <input type="range" min="0" max="360" step="5" value={windDirection}
            onChange={(e) => setWindDirection(Number(e.target.value))} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 120 }}>
          Keep-clear: <b style={{ color: "var(--text-primary)" }}>{keepClear} m</b>
          <input type="range" min="1" max="15" step="0.5" value={keepClear}
            onChange={(e) => setKeepClear(Number(e.target.value))} />
        </label>
      </div>

      <div style={{ flex: 1, overflow: "auto", display: "flex", gap: 10, padding: 10, flexWrap: "wrap" }}>
        {/* Zone map */}
        <svg width="280" height="280" viewBox="0 0 280 280"
          style={{ background: "var(--bg-surface)", borderRadius: 8, flexShrink: 0 }}
          role="img" aria-label="Wind drift exclusion zone">
          <circle cx={cxp} cy={cyp} r={keepClear * scale} fill="none"
            stroke="#3b82f6" strokeWidth="1.4" strokeDasharray="5 4" />
          <circle cx={cxp} cy={cyp} r={zones.exclusionRadiusM * scale} fill="rgba(239,68,68,0.10)"
            stroke={summary.safe ? "#22c55e" : "#ef4444"} strokeWidth="1.8" />
          {/* jets + landing points */}
          {zones.jets.map((j, i) => (
            <g key={i}>
              <circle cx={cxp + (j.origin[0] - zones.center[0]) * scale}
                cy={cyp - (j.origin[1] - zones.center[1]) * scale} r="2.5" fill="#00d4ff" />
              <circle cx={cxp + (j.landing[0] - zones.center[0]) * scale}
                cy={cyp - (j.landing[1] - zones.center[1]) * scale} r="2" fill="#f59e0b" />
            </g>
          ))}
          {/* wind arrow (points downwind) */}
          <line x1={cxp - arrow[0] * 90} y1={cyp + arrow[1] * 90}
            x2={cxp + arrow[0] * 90} y2={cyp - arrow[1] * 90}
            stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#wd-arrow)" />
          <defs>
            <marker id="wd-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
            </marker>
          </defs>
          <text x={cxp} y="16" textAnchor="middle" fontSize="9" fill="var(--text-muted)">
            exclusion {zones.exclusionRadiusM.toFixed(2)} m · keep-clear {keepClear} m
          </text>
        </svg>

        {/* Operator warnings */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>
            OPERATOR WARNINGS · {jets.length} jets · exclusion {zones.exclusionRadiusM.toFixed(2)} m
            (gust {zones.gustExclusionRadiusM.toFixed(2)} m)
          </div>
          {warnings.map((w, i) => {
            const s = SEV[w.severity] || SEV.info;
            return (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 8px",
                marginBottom: 4, borderRadius: 6, background: "var(--bg-surface)",
                borderLeft: `3px solid ${s.color}` }}>
                <span style={{ color: s.color, fontSize: 12 }}>{s.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--text-primary)" }}>{w.message}</div>
                  <div style={{ fontSize: 9, color: s.color, marginTop: 1 }}>
                    {w.severity} · {w.code.replace(/_/g, " ")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
