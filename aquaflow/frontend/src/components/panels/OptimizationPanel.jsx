// OptimizationPanel.jsx — AquaFlow AI Optimization Engine (AQ-S5-002)
//
// Analyses a design and shows energy, water and performance optimisation
// recommendations with quantified savings. Consumes /api/optimize/analyze; pre-filled
// with a sample design the user can edit.
import { useMemo, useState } from "react";
import { apiPost } from "../../utils/apiClient";
import useEngineeringStore from "../../store/engineeringStore";
import { classifyFixtureType } from "../../hooks/fixtureTypeMap";

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };
const CAT_COLOR = { energy: "#f59e0b", water: "#38bdf8", performance: "#22c55e" };
const CAT_ICON = { energy: "⚡", water: "💧", performance: "★" };

const SAMPLE = {
  pumps: [{ id: "pump-1", power_w: 4000, speed: 1.0, required_flow_fraction: 0.75, hours_per_day: 10 }],
  lights: [{ id: "flood-1", power_w: 800, type: "incandescent", hours_per_day: 6 }],
  jets: [
    { id: "center", impact: 1.0, flow_lps: 1.5, height_m: 6 },
    { id: "ring-1", impact: 0.9, flow_lps: 1.0, height_m: 3 },
    { id: "mist", impact: 0.15, flow_lps: 4.0, height_m: 1 },
  ],
  pool: { surface_area_m2: 60, water_temp_c: 26 },
  recirculation: false,
  weather: { wind_speed: 4 },
  operating_hours_per_day: 8,
  tariff: { energy_rate: 0.2, water_rate: 0.002, currency: "USD" },
};

export default function OptimizationPanel() {
  const fixtures = useEngineeringStore((state) => state.fixtures);
  const params = useEngineeringStore((state) => state.params);
  const hydraulics = useEngineeringStore((state) => state.hydraulicSummary);
  const projectInput = useMemo(() => {
    const pumps = fixtures.filter((fixture) => String(fixture.type || "").toLowerCase().includes("pump")).map((fixture) => ({
      id: fixture.id, power_w: Number(fixture.engineering?.powerKw || fixture.powerKw || 0) * 1000,
      speed: 1, required_flow_fraction: 0.75, hours_per_day: 8,
    }));
    const lights = fixtures.filter((fixture) => classifyFixtureType(fixture.type) === "light").map((fixture) => ({
      id: fixture.id, power_w: Number(fixture.engineering?.wattage || fixture.wattage || 0),
      type: String(fixture.type || "led").toLowerCase().includes("led") ? "led" : "fixture", hours_per_day: 6,
    }));
    const jets = fixtures.filter((fixture) => classifyFixtureType(fixture.type) === "nozzle").map((fixture) => ({
      id: fixture.id, impact: 1, flow_lps: Number(fixture.spec?.flow_lpm || fixture.engineering?.flowLpm || 0) / 60,
      height_m: Number(fixture.spec?.jet_height_m || fixture.engineering?.jetHeightM || 0),
    }));
    return {
      pumps, lights, jets,
      pool: { surface_area_m2: Number(params?.width || 0) * Number(params?.length || 0), water_temp_c: 26 },
      recirculation: true, weather: { wind_speed: 0 }, operating_hours_per_day: 8,
      tariff: { energy_rate: 0.2, water_rate: 0.002, currency: "USD" },
      engineering_summary: hydraulics,
    };
  }, [fixtures, params, hydraulics]);
  const [text, setText] = useState(() => JSON.stringify(fixtures.length ? projectInput : SAMPLE, null, 2));
  const [res, setRes] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true); setError("");
    try { setRes(await apiPost("/optimize/analyze", JSON.parse(text))); }
    catch (e) { setError(String(e.message || e)); setRes(null); }
    finally { setLoading(false); }
  };

  const CatCard = ({ cat, percent, detail }) => (
    <div style={{ ...box, padding: 10, flex: 1, minWidth: 130, borderTop: `3px solid ${CAT_COLOR[cat]}` }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "capitalize" }}>
        {CAT_ICON[cat]} {cat}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: CAT_COLOR[cat] }}>{percent}%</div>
      <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{detail}</div>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>✨</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          AI Optimization
        </span>
        {res && <span style={{ marginLeft: "auto", fontSize: 10, color: "#22c55e" }}>
          Save {res.summary.total_cost_saving_per_day} /day · {res.summary.recommendation_count} recommendations
        </span>}
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ width: 300, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", padding: 10 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>DESIGN (edit + analyse)</div>
          <button onClick={() => setText(JSON.stringify(projectInput, null, 2))} disabled={!fixtures.length}
            style={{ ...box, color: "var(--text-primary)", padding: 6, marginBottom: 6, cursor: fixtures.length ? "pointer" : "default" }}>
            Use current Engineering Design ({fixtures.length} fixtures)
          </button>
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
            style={{ ...box, flex: 1, fontFamily: "monospace", fontSize: 10, padding: 8,
              color: "var(--text-primary)", resize: "none" }} />
          <button onClick={run} disabled={loading} style={{ marginTop: 8, background: "var(--accent)",
            color: "#04140a", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 11,
            fontWeight: 700, cursor: "pointer" }}>{loading ? "Optimising…" : "Optimise ▶"}</button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          {error && <div style={{ ...box, padding: 8, color: "#ef4444", fontSize: 11 }}>⛔ {error}</div>}
          {!res && !error && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
            Analyse a design to see energy, water and performance optimisations.</div>}
          {res && (
            <div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                <CatCard cat="energy" percent={res.summary.energy_savings_percent}
                  detail={`${res.energy.savings_kwh_day} kWh/day`} />
                <CatCard cat="water" percent={res.summary.water_savings_percent}
                  detail={`${res.water.savings_l_day} L/day`} />
                <CatCard cat="performance" percent={res.summary.performance_improvement_percent}
                  detail={`${res.performance.impact_retained_percent}% impact kept`} />
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>RECOMMENDATIONS</div>
              {res.recommendations.map((r, i) => (
                <div key={i} style={{ ...box, padding: "8px 10px", marginBottom: 5,
                  borderLeft: `3px solid ${CAT_COLOR[r.category] || "#888"}` }}>
                  <div style={{ fontSize: 11, color: "var(--text-primary)" }}>
                    <span style={{ color: CAT_COLOR[r.category] }}>{CAT_ICON[r.category]}</span> {r.action}
                  </div>
                  {(r.saving_kwh_day || r.saving_l_day || r.impact_retained_percent) && (
                    <div style={{ fontSize: 9, color: CAT_COLOR[r.category], marginTop: 2 }}>
                      {r.saving_kwh_day != null ? `${r.saving_kwh_day} kWh/day` : ""}
                      {r.saving_l_day != null ? `${r.saving_l_day} L/day` : ""}
                      {r.impact_retained_percent != null ? `${r.impact_retained_percent}% impact retained` : ""}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
