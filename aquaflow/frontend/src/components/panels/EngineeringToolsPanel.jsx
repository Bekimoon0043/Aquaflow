// EngineeringToolsPanel.jsx — AquaFlow Backend API Integration (AQ-X-014)
//
// Wires the previously-unconnected backend calculation engines to the UI: the
// hydraulic solver, pipe sizing, nozzle database, BOM generator, P&ID generator,
// energy model and weather simulation. Each tab sends a request to its endpoint and
// renders the result, pre-filled with a working sample (or the current design's
// fixtures) so the feature is usable immediately.
import { useMemo, useState } from "react";
import useEngineeringStore from "../../store/engineeringStore";
import { apiGet, apiPost, apiPostText } from "../../utils/apiClient";

const TABS = [
  ["hydraulics", "Hydraulics"], ["sizing", "Pipe Sizing"], ["nozzles", "Nozzles"],
  ["bom", "BOM"], ["pid", "P&ID"], ["energy", "Energy"], ["weather", "Weather"],
];

const SAMPLE = {
  hydraulics: {
    method: "hazen-williams",
    nodes: [{ id: "R", fixed_head: 50, elevation: 0 }, { id: "J", demand: 0.01, elevation: 0 }],
    pipes: [{ id: "P1", from: "R", to: "J", length: 100, diameter: 0.1, roughness: 130 }],
  },
  sizing: {
    pipes: [{ id: "P1", flow_m3s: 0.03, diameter: 0.1 }, { id: "P2", flow_m3s: 0.008, diameter: 0.025 }],
    velocity_limits: { v_min: 0.6, v_max: 2.5, v_target: 1.5 },
  },
  energy: {
    loads: [{ id: "pump-1", power_w: 4000, hours_per_day: 8, days_per_year: 300, duty_cycle: 0.8 },
            { id: "lights", power_w: 600, hours_per_day: 6, days_per_year: 300 }],
    simultaneity_factor: 0.9,
    tariff: { energy_rate: 0.18, demand_charge: 12, currency: "USD", co2_factor_kg_per_kwh: 0.4 },
  },
};

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };

function Result({ state }) {
  if (state.loading) return <div style={{ color: "var(--text-muted)", fontSize: 11, padding: 8 }}>Running…</div>;
  if (state.error) return <div style={{ color: "#ef4444", fontSize: 11, padding: 8, ...box }}>⛔ {state.error}</div>;
  if (state.data === undefined) return null;
  return (
    <pre style={{ ...box, padding: 8, fontSize: 10.5, lineHeight: 1.5, maxHeight: "50vh",
      overflow: "auto", color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
      {typeof state.data === "string" ? state.data : JSON.stringify(state.data, null, 2)}
    </pre>
  );
}

function RunButton({ onClick, label = "Run" }) {
  return (
    <button onClick={onClick} style={{ background: "var(--accent)", color: "#04140a", border: "none",
      borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
      {label} ▶
    </button>
  );
}

// Generic "edit JSON → POST → show result" tool.
function JsonTool({ endpoint, sample, hint }) {
  const [text, setText] = useState(JSON.stringify(sample, null, 2));
  const [state, setState] = useState({});
  const run = async () => {
    setState({ loading: true });
    try { setState({ data: await apiPost(endpoint, JSON.parse(text)) }); }
    catch (e) { setState({ error: String(e.message || e) }); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{hint} · <code>POST {endpoint}</code></div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
        style={{ ...box, height: 150, fontFamily: "monospace", fontSize: 10.5, padding: 8,
          color: "var(--text-primary)", resize: "vertical" }} />
      <div><RunButton onClick={run} /></div>
      <Result state={state} />
    </div>
  );
}

function fixtureModel(fixtures) {
  const NOZ = /nozzle|jet|geyser|spray|fan|arch|laminar|foam|running|mist|crown/i;
  const equipment = [], nozzles = [];
  for (const f of fixtures) {
    const t = f.type || "equipment";
    if (NOZ.test(t)) nozzles.push({ model: t, quantity: 1 });
    else equipment.push({ id: f.id, type: t, label: f.label || f.id, quantity: 1, x: f.x, y: f.y });
  }
  return { project: "AquaFlow Design", equipment, nozzles, pipes: [] };
}

function NozzleTool() {
  const [models, setModels] = useState(null);
  const [state, setState] = useState({});
  const [modelId, setModelId] = useState("");
  const [pressure, setPressure] = useState(2.0);
  const load = async () => {
    try { const r = await apiGet("/nozzles/models"); setModels(r.models || []);
      if (r.models?.length) setModelId(r.models[0].model_id || r.models[0].id); }
    catch (e) { setState({ error: String(e.message || e) }); }
  };
  const query = async () => {
    setState({ loading: true });
    try { setState({ data: await apiPost("/nozzles/query", { model_id: modelId, pressure: Number(pressure) }) }); }
    catch (e) { setState({ error: String(e.message || e) }); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Nozzle performance database · <code>GET /nozzles/models</code>, <code>POST /nozzles/query</code></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <RunButton onClick={load} label="Load models" />
        {models && (
          <>
            <select value={modelId} onChange={(e) => setModelId(e.target.value)}
              style={{ ...box, padding: 6, fontSize: 11, color: "var(--text-primary)" }}>
              {models.map((m) => <option key={m.model_id || m.id} value={m.model_id || m.id}>
                {m.model_id || m.id} — {m.manufacturer || ""}</option>)}
            </select>
            <label style={{ fontSize: 10, color: "var(--text-muted)" }}>Pressure (bar)
              <input type="number" step="0.1" value={pressure} onChange={(e) => setPressure(e.target.value)}
                style={{ ...box, width: 64, padding: 4, marginLeft: 4, color: "var(--text-primary)" }} /></label>
            <RunButton onClick={query} label="Query flow" />
          </>
        )}
      </div>
      {models && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{models.length} models loaded.</div>}
      <Result state={state} />
    </div>
  );
}

function FixtureTool({ endpoint, label, svg }) {
  const fixtures = useEngineeringStore((s) => s.fixtures) || [];
  const [state, setState] = useState({});
  const model = useMemo(() => fixtureModel(fixtures), [fixtures]);
  const run = async () => {
    setState({ loading: true });
    try {
      if (svg) setState({ data: await apiPostText(`${endpoint}?format=svg`, pidModel(fixtures)) });
      else setState({ data: await apiPost(endpoint, model) });
    } catch (e) { setState({ error: String(e.message || e) }); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
        {label} from {fixtures.length} design fixtures · <code>POST {endpoint}</code>
      </div>
      <div><RunButton onClick={run} /></div>
      {svg && state.data ? (
        <div style={{ ...box, padding: 8, overflow: "auto", maxHeight: "50vh" }}
          dangerouslySetInnerHTML={{ __html: state.data }} />
      ) : <Result state={state} />}
    </div>
  );
}

function pidModel(fixtures) {
  return {
    title: "AquaFlow P&ID",
    equipment: fixtures.map((f) => ({ id: f.id, type: f.type || "equipment",
      label: f.label || f.id, x: f.x, y: f.y })),
    lines: [],
  };
}

function WeatherTool() {
  const [c, setC] = useState({ wind_speed: 6, wind_direction: 270, temperature_c: 24, humidity_pct: 55, condition: "clear" });
  const [state, setState] = useState({});
  const set = (k, v) => setC({ ...c, [k]: v });
  const run = async () => {
    setState({ loading: true });
    try { setState({ data: await apiPost("/weather/simulate", { conditions: c, jet_height_m: 4, pool_area_m2: 50 }) }); }
    catch (e) { setState({ error: String(e.message || e) }); }
  };
  const F = ({ k, label, step = 1 }) => (
    <label style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", flexDirection: "column" }}>
      {label}
      <input type="number" step={step} value={c[k]} onChange={(e) => set(k, Number(e.target.value))}
        style={{ ...box, width: 80, padding: 4, color: "var(--text-primary)" }} />
    </label>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Weather simulation · <code>POST /weather/simulate</code></div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <F k="wind_speed" label="Wind m/s" step={0.5} />
        <F k="wind_direction" label="Wind from °" step={5} />
        <F k="temperature_c" label="Temp °C" />
        <F k="humidity_pct" label="Humidity %" />
      </div>
      <div><RunButton onClick={run} label="Simulate" /></div>
      <Result state={state} />
    </div>
  );
}

export default function EngineeringToolsPanel() {
  const [tab, setTab] = useState("hydraulics");
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>🧮</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Engineering Tools
        </span>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", flexWrap: "wrap" }}>
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: "7px 12px", background: "transparent",
            border: "none", borderBottom: tab === k ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab === k ? "var(--text-accent)" : "var(--text-muted)", fontSize: 10,
            fontWeight: tab === k ? 600 : 400, cursor: "pointer" }}>{label}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {tab === "hydraulics" && <JsonTool endpoint="/hydraulics/solve" sample={SAMPLE.hydraulics} hint="Solve a hydraulic network (Global Gradient Algorithm)" />}
        {tab === "sizing" && <JsonTool endpoint="/hydraulics/size" sample={SAMPLE.sizing} hint="Size / audit pipes by velocity" />}
        {tab === "nozzles" && <NozzleTool />}
        {tab === "bom" && <FixtureTool endpoint="/bom/generate" label="Generate the Bill of Materials" />}
        {tab === "pid" && <FixtureTool endpoint="/pid/generate" label="Generate the P&ID drawing" svg />}
        {tab === "energy" && <JsonTool endpoint="/energy/model" sample={SAMPLE.energy} hint="Energy consumption + cost model" />}
        {tab === "weather" && <WeatherTool />}
      </div>
    </div>
  );
}
