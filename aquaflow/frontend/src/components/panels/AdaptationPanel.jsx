// AdaptationPanel.jsx — AquaFlow Autonomous Show Adaptation (AQ-S5-003)
//
// Live context (weather, crowd, event) drives an autonomous adaptation plan that
// re-scales the running show while respecting safety. Adjust the inputs and the plan
// recomputes in real time via /api/adaptation/plan.
import { useEffect, useState, useCallback } from "react";
import { apiPost } from "../../utils/apiClient";

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };
const SRC_COLOR = { weather: "#38bdf8", crowd: "#a78bfa", event: "#f59e0b" };
const EVENTS = ["normal", "quiet_hours", "celebration", "finale", "vip", "countdown"];
const CONDITIONS = ["clear", "haze", "rain", "heavy_rain", "storm"];

export default function AdaptationPanel() {
  const [wind, setWind] = useState(3);
  const [condition, setCondition] = useState("clear");
  const [crowd, setCrowd] = useState(0.5);
  const [event, setEvent] = useState("normal");
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");

  const compute = useCallback(async () => {
    try {
      setPlan(await apiPost("/adaptation/plan", {
        weather: { wind_speed: wind, condition },
        crowd: { level: crowd }, event: { type: event },
      }));
      setError("");
    } catch (e) { setError(String(e.message || e)); }
  }, [wind, condition, crowd, event]);

  useEffect(() => { compute(); }, [compute]);

  const bar = (label, value, max = 1.5) => (
    <div style={{ ...box, padding: 8, flex: 1, minWidth: 100 }}>
      <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--accent)" }}>×{value}</div>
      <div style={{ height: 4, background: "var(--bg-panel)", borderRadius: 2, marginTop: 3 }}>
        <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: "100%",
          background: value < 1 ? "#f59e0b" : "#22c55e", borderRadius: 2 }} />
      </div>
    </div>
  );

  const m = plan?.modifications;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>🤖</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Autonomous Adaptation
        </span>
        {plan && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600, padding: "2px 8px",
          borderRadius: 10, background: plan.safe ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          color: plan.safe ? "#22c55e" : "#ef4444" }}>{plan.safe ? "Safe" : "Unsafe weather"}</span>}
      </div>

      {/* live context controls */}
      <div style={{ display: "flex", gap: 10, padding: "10px 12px", flexWrap: "wrap",
        borderBottom: "1px solid var(--border)" }}>
        <label style={{ fontSize: 10, color: "var(--text-muted)", flex: 1, minWidth: 130, display: "flex", flexDirection: "column" }}>
          Wind: <b style={{ color: "var(--text-primary)" }}>{wind} m/s</b>
          <input type="range" min="0" max="25" step="1" value={wind} onChange={(e) => setWind(Number(e.target.value))} />
        </label>
        <label style={{ fontSize: 10, color: "var(--text-muted)", flex: 1, minWidth: 130, display: "flex", flexDirection: "column" }}>
          Crowd: <b style={{ color: "var(--text-primary)" }}>{Math.round(crowd * 100)}%</b>
          <input type="range" min="0" max="1" step="0.05" value={crowd} onChange={(e) => setCrowd(Number(e.target.value))} />
        </label>
        <label style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 2 }}>
          Condition
          <select value={condition} onChange={(e) => setCondition(e.target.value)}
            style={{ ...box, padding: 5, fontSize: 11, color: "var(--text-primary)" }}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 2 }}>
          Event
          <select value={event} onChange={(e) => setEvent(e.target.value)}
            style={{ ...box, padding: 5, fontSize: 11, color: "var(--text-primary)" }}>
            {EVENTS.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
          </select>
        </label>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {error && <div style={{ ...box, padding: 8, color: "#ef4444", fontSize: 11 }}>⛔ {error}</div>}
        {m && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {bar("Intensity", m.intensity_scale)}
              {bar("Jet height", m.jet_height_scale, 1.3)}
              {bar("Tempo", m.tempo_scale)}
            </div>
            {(m.disabled_effects.length > 0 || m.enabled_effects.length > 0) && (
              <div style={{ fontSize: 11, marginBottom: 10 }}>
                {m.disabled_effects.length > 0 && <span style={{ color: "#ef4444" }}>
                  ⊘ disabled: {m.disabled_effects.join(", ")} </span>}
                {m.enabled_effects.length > 0 && <span style={{ color: "#22c55e" }}>
                  ✓ enabled: {m.enabled_effects.join(", ")}</span>}
              </div>
            )}
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>ADAPTATION TRIGGERS</div>
            {plan.triggers.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No adaptations — running as designed.</div>
            ) : plan.triggers.map((t, i) => (
              <div key={i} style={{ ...box, padding: "6px 8px", marginBottom: 4,
                borderLeft: `3px solid ${SRC_COLOR[t.source] || "#888"}` }}>
                <span style={{ color: SRC_COLOR[t.source], fontSize: 10, textTransform: "uppercase" }}>{t.source}</span>
                <span style={{ fontSize: 11, color: "var(--text-primary)" }}> — {t.reason}</span>
              </div>
            ))}
            <div style={{ ...box, padding: 8, marginTop: 10, fontSize: 10, color: "var(--text-muted)" }}>{plan.summary}</div>
          </>
        )}
      </div>
    </div>
  );
}
