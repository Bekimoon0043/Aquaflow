// EngineeringToolsPanel.jsx — AquaFlow Backend API Integration (AQ-X-014)
//
// Wires the previously-unconnected backend calculation engines to the UI: the
// hydraulic solver, pipe sizing, nozzle database, BOM generator, P&ID generator,
// energy model and weather simulation. Each tab sends a request to its endpoint and
// renders the result, pre-filled with a working sample (or the current design's
// fixtures) so the feature is usable immediately.
import { useMemo, useState } from "react";
import useEngineeringStore from "../../store/engineeringStore";
import { apiGet, apiPost, apiPostText, apiUrl } from "../../utils/apiClient";
// AF-NEXT-012 — data source / confidence badges, BOM provenance, verified models.
import ProvenanceBadge from "./ProvenanceBadge";
import VerifiedModelsTool from "./VerifiedModelsTool";
import { getFixtureProvenance } from "../../data/fixtureLibrary";
import { GENERIC_LABEL } from "../../data/fixtureProvenance";
import { usePanelAction } from "../../workspaces/navigation"; // AF-NEXT-014

const TABS = [
  ["hydraulics", "Hydraulics"], ["sizing", "Pipe Sizing"], ["nozzles", "Nozzles"],
  ["bom", "BOM"], ["pid", "P&ID"], ["energy", "Energy"], ["weather", "Weather"],
  ["verified", "Verified Models"],
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

// AF-NEXT-012 — find the provenance roll-up in any engine response.
function findProvenance(data) {
  if (!data || typeof data !== "object") return null;
  return data.data_provenance || data.summary?.data_provenance || null;
}

export function ProvenanceSummary({ provenance }) {
  if (!provenance) return null;
  const by = provenance.by_source || provenance.bySource || {};
  const generic = provenance.generic_items ?? provenance.genericItems ?? 0;
  return (
    <div data-testid="provenance-summary" style={{ ...box, padding: 6, fontSize: 10, color: generic ? "#fbbf24" : "#4ade80",
      borderColor: generic ? "#78350f" : "#166534" }}>
      Equipment data: {by.manufacturer_datasheet || 0} datasheet · {by.user_measured || 0} measured · {by.generic_estimate || 0} generic estimate
      {generic ? <div>{provenance.warning || GENERIC_LABEL}</div> : null}
    </div>
  );
}

function Result({ state }) {
  if (state.loading) return <div style={{ color: "var(--text-muted)", fontSize: 11, padding: 8 }}>Running…</div>;
  if (state.error) return <div style={{ color: "#ef4444", fontSize: 11, padding: 8, ...box }}>⛔ {state.error}</div>;
  if (state.data === undefined) return null;
  return (
    <>
    <ProvenanceSummary provenance={findProvenance(state.data)} />
    <pre style={{ ...box, padding: 8, fontSize: 10.5, lineHeight: 1.5, maxHeight: "50vh",
      overflow: "auto", color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
      {typeof state.data === "string" ? state.data : JSON.stringify(state.data, null, 2)}
    </pre>
    </>
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
    // AF-NEXT-012: each design item carries its provenance so the BOM line cites it.
    const trust = { provenance: getFixtureProvenance(f), ...(f.equipmentModelId ? { equipment_model_id: f.equipmentModelId } : {}) };
    if (NOZ.test(t)) nozzles.push({ model: t, quantity: 1, ...trust });
    else equipment.push({ id: f.id, type: t, label: f.label || f.id, quantity: 1, x: f.x, y: f.y, ...trust });
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
  const selectedModel = models?.find((x) => (x.model_id || x.id) === modelId) || null;
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
                {m.model_id || m.id} — {m.manufacturer || ""}{m.verified ? "" : " (generic estimate)"}</option>)}
            </select>
            <label style={{ fontSize: 10, color: "var(--text-muted)" }}>Pressure (bar)
              <input type="number" step="0.1" value={pressure} onChange={(e) => setPressure(e.target.value)}
                style={{ ...box, width: 64, padding: 4, marginLeft: 4, color: "var(--text-primary)" }} /></label>
            <RunButton onClick={query} label="Query flow" />
          </>
        )}
      </div>
      {models && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{models.length} models loaded.</div>}
      {selectedModel && (
        <div style={{ fontSize: 10, display: "flex", gap: 6, alignItems: "center" }}>
          <ProvenanceBadge provenance={selectedModel.provenance} />
          <span style={{ color: "var(--text-muted)" }}>rev {selectedModel.provenance?.revision || "—"}</span>
        </div>
      )}
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

// AF-NEXT-012 — BOM with per-line equipment model / data source / units / revision,
// and CSV / XLSX downloads that carry the same columns.
function BomTool() {
  const fixtures = useEngineeringStore((s) => s.fixtures) || [];
  const [state, setState] = useState({});
  const model = useMemo(() => fixtureModel(fixtures), [fixtures]);
  const run = async () => {
    setState({ loading: true });
    try { setState({ data: await apiPost("/bom/generate", model) }); }
    catch (e) { setState({ error: String(e.message || e) }); }
  };
  const download = async (format) => {
    try {
      const res = await fetch(apiUrl(`/bom/generate?format=${format}`), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(model) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `bom.${format}`; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setState((prev) => ({ ...prev, error: `Export failed: ${e.message || e}` })); }
  };
  const lines = state.data?.lines || [];
  const th = { textAlign: "left", padding: 3, color: "var(--text-muted)", fontWeight: 500 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
        Generate the Bill of Materials from {fixtures.length} design fixtures · <code>POST /bom/generate</code>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <RunButton onClick={run} />
        <RunButton onClick={() => download("csv")} label="CSV" />
        <RunButton onClick={() => download("xlsx")} label="XLSX" />
      </div>
      {state.loading && <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Running…</div>}
      {state.error && <div style={{ color: "#ef4444", fontSize: 11 }}>⛔ {state.error}</div>}
      {state.data && <ProvenanceSummary provenance={state.data.summary?.data_provenance} />}
      {lines.length > 0 && (
        <div style={{ overflow: "auto", maxHeight: "50vh" }}>
          <table style={{ fontSize: 10, borderCollapse: "collapse", color: "var(--text-primary)", width: "100%" }}>
            <thead><tr>{["#", "Description", "Qty", "Equipment model", "Data source", "Units", "Revision"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.item} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: 3 }}>{l.item}</td>
                  <td style={{ padding: 3 }}>{l.description}<div style={{ color: "var(--text-muted)" }}>{l.manufacturer} {l.part_number}</div></td>
                  <td style={{ padding: 3 }}>{l.quantity} {l.unit}</td>
                  <td style={{ padding: 3 }}>{l.equipment_model}</td>
                  <td style={{ padding: 3 }}><ProvenanceBadge provenance={l.citation || { data_source: l.data_source, confidence: l.confidence }} /></td>
                  <td style={{ padding: 3, color: "var(--text-muted)" }}>{l.units_basis}</td>
                  <td style={{ padding: 3 }}>{l.data_revision}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  // AF-NEXT-014: workspace guidance / data-trust warnings open a specific tab.
  usePanelAction("engtools", ({ action, detail }) => {
    if (action === "tab" && TABS.some(([k]) => k === detail?.tab)) setTab(detail.tab);
  });
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
        {tab === "bom" && <BomTool />}
        {tab === "pid" && <FixtureTool endpoint="/pid/generate" label="Generate the P&ID drawing" svg />}
        {tab === "energy" && <JsonTool endpoint="/energy/model" sample={SAMPLE.energy} hint="Energy consumption + cost model" />}
        {tab === "weather" && <WeatherTool />}
        {tab === "verified" && <VerifiedModelsTool />}
      </div>
    </div>
  );
}
