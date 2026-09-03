import { useState, useEffect, useRef } from "react";
import { useShowStore } from "../../store/showStore";
import { API_BASE_URL } from "../../config";

const API = `${API_BASE_URL}/plc`;

// AF-IO-006 — only genuinely usable (REAL) types are offered. The old list showed
// Allen Bradley / OPC UA / Omron / Beckhoff, most of which the backend silently
// routed to a Modbus driver; the backend now refuses them with a 400.
const PLC_TYPES = [
  { id: "siemens_s7",    label: "Siemens S7",        port: 102,   color: "#00d4ff" },
  { id: "modbus_tcp",    label: "Modbus TCP",         port: 502,   color: "#f97316" },
];

export default function PLCPanel() {
  const [tab, setTab] = useState("connect");
  const { devices, addServerLog } = useShowStore();

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36, background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 13 }}>⚙</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          PLC Integration
        </span>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", flexShrink: 0 }}>
        {[["connect","Connect"],["tags","Tag Browser"],["map","Tag Map"],["monitor","Monitor"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex: 1, padding: "7px 0", background: "transparent", border: "none",
            borderBottom: tab === key ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab === key ? "var(--text-accent)" : "var(--text-muted)",
            fontFamily: "var(--font-body)", fontSize: 10, fontWeight: tab === key ? 600 : 400,
            textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer",
          }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "connect" && <ConnectTab addServerLog={addServerLog} />}
        {tab === "tags"    && <TagBrowserTab addServerLog={addServerLog} />}
        {tab === "map"     && <TagMapTab devices={devices} addServerLog={addServerLog} />}
        {tab === "monitor" && <MonitorTab />}
      </div>
    </div>
  );
}

// ── Connect Tab ────────────────────────────────────────────────────────────────
function ConnectTab({ addServerLog }) {
  const [plcs, setPlcs] = useState([]);
  const [form, setForm] = useState({ name: "My PLC", plc_type: "siemens_s7", ip: "192.168.1.100", port: 102, rack: 0, slot: 1 });
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => { loadPLCs(); }, []);

  const loadPLCs = async () => {
    try {
      const res = await fetch(`${API}/`);
      const data = await res.json();
      setPlcs(data.plcs || []);
    } catch {}
  };

  const selectedType = PLC_TYPES.find(t => t.id === form.plc_type);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API}/test-connection?ip=${form.ip}&plc_type=${form.plc_type}&port=${form.port}`, { method: "POST" });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ reachable: false, error: "Backend offline" });
    } finally { setTesting(false); }
  };

  const connect = async () => {
    setConnecting(true);
    addServerLog({ level: "info", msg: `Connecting to ${form.name} (${form.plc_type}) @ ${form.ip}...` });
    try {
      const res = await fetch(`${API}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, id: `plc-${Date.now()}` }),
      });
      const data = await res.json();
      if (data.connected) {
        addServerLog({ level: "info", msg: `✓ ${form.name} connected — ${data.tag_count} tags loaded` });
      } else {
        addServerLog({ level: "warn", msg: `${form.name} connection failed: ${data.error || "Unknown error"}` });
      }
      loadPLCs();
    } catch {
      addServerLog({ level: "warn", msg: `Connect failed — backend offline` });
    } finally { setConnecting(false); }
  };

  return (
    <div style={{ padding: 12 }}>
      <SectionLabel>PLC Type</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 12 }}>
        {PLC_TYPES.map((t) => (
          <button key={t.id} onClick={() => setForm(f => ({ ...f, plc_type: t.id, port: t.port }))}
            style={{
              padding: "6px 8px", borderRadius: "var(--radius-sm)", cursor: "pointer",
              background: form.plc_type === t.id ? `${t.color}15` : "var(--bg-surface)",
              border: `1px solid ${form.plc_type === t.id ? t.color : "var(--border)"}`,
              color: form.plc_type === t.id ? t.color : "var(--text-muted)",
              fontSize: 10, textAlign: "left", fontWeight: form.plc_type === t.id ? 600 : 400,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <SectionLabel>Connection Settings</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        <FieldRow label="Name">
          <input className="input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} style={{ fontSize: 11 }} />
        </FieldRow>
        <FieldRow label="IP Address">
          <input className="input" value={form.ip} onChange={e => setForm(f => ({...f, ip: e.target.value}))} style={{ fontSize: 11, fontFamily: "var(--font-mono)" }} />
        </FieldRow>
        <FieldRow label="Port">
          <input className="input" type="number" value={form.port} onChange={e => setForm(f => ({...f, port: parseInt(e.target.value)}))} style={{ fontSize: 11, fontFamily: "var(--font-mono)" }} />
        </FieldRow>
        {form.plc_type === "siemens_s7" && (
          <>
            <FieldRow label="Rack">
              <input className="input" type="number" value={form.rack} onChange={e => setForm(f => ({...f, rack: parseInt(e.target.value)}))} style={{ fontSize: 11, fontFamily: "var(--font-mono)" }} />
            </FieldRow>
            <FieldRow label="Slot">
              <input className="input" type="number" value={form.slot} onChange={e => setForm(f => ({...f, slot: parseInt(e.target.value)}))} style={{ fontSize: 11, fontFamily: "var(--font-mono)" }} />
            </FieldRow>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button className="btn" onClick={testConnection} disabled={testing}
          style={{ flex: 1, justifyContent: "center", fontSize: 11 }}>
          {testing ? "Testing..." : "⟳ Test Connection"}
        </button>
        <button className="btn primary" onClick={connect} disabled={connecting}
          style={{ flex: 1, justifyContent: "center", fontSize: 11 }}>
          {connecting ? "Connecting..." : "⚡ Connect"}
        </button>
      </div>

      {testResult && (
        <div style={{ padding: "7px 10px", marginBottom: 10, borderRadius: "var(--radius-sm)", fontSize: 11,
          background: testResult.reachable ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
          border: `1px solid ${testResult.reachable ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
          color: testResult.reachable ? "var(--green)" : "var(--red)" }}>
          {testResult.reachable ? `✓ ${form.ip}:${form.port} is reachable` : `✕ ${testResult.error || "Not reachable"}`}
        </div>
      )}

      <SectionLabel>Connected PLCs ({plcs.length})</SectionLabel>
      {plcs.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>
          No PLCs connected yet
        </div>
      ) : plcs.map((p) => {
        const typeInfo = PLC_TYPES.find(t => t.id === p.type) || {};
        return (
          <div key={p.id} style={{ padding: "8px 10px", marginBottom: 6, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: p.connected ? "var(--green)" : "var(--red)", boxShadow: p.connected ? "0 0 4px var(--green)" : "none" }} />
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", flex: 1 }}>{p.name}</span>
              <span style={{ fontSize: 9, color: typeInfo.color || "var(--text-muted)", fontFamily: "var(--font-mono)", background: `${typeInfo.color || "#888"}15`, padding: "1px 6px", borderRadius: 3, border: `1px solid ${typeInfo.color || "#888"}33` }}>
                {p.type?.replace("_", " ").toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", display: "flex", gap: 12 }}>
              <span>{p.ip}</span>
              <span>{p.tag_count} tags</span>
              {p.last_error && <span style={{ color: "var(--red)" }}>{p.last_error}</span>}
            </div>
          </div>
        );
      })}

      {/* Library requirements */}
      <SectionLabel>Required Libraries</SectionLabel>
      {[
        { label: "Siemens S7", cmd: "pip install python-snap7", note: "Also install snap7 C library" },
        { label: "OPC UA",     cmd: "pip install asyncua" },
        { label: "Allen Bradley", cmd: "pip install pycomm3" },
      ].map((lib) => (
        <div key={lib.label} style={{ padding: "6px 10px", marginBottom: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", marginBottom: 2 }}>{lib.label}</div>
          <code style={{ fontSize: 10, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{lib.cmd}</code>
          {lib.note && <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>{lib.note}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Tag Browser Tab ────────────────────────────────────────────────────────────
function TagBrowserTab({ addServerLog }) {
  const [plcId, setPlcId] = useState("");
  const [tags, setTags] = useState([]);
  const [plcs, setPlcs] = useState([]);
  const [writeTag, setWriteTag] = useState(null);
  const [writeValue, setWriteValue] = useState("");

  useEffect(() => {
    fetch(`${API}/`).then(r => r.json()).then(d => setPlcs(d.plcs || [])).catch(() => {});
  }, []);

  const loadTags = async (id) => {
    setPlcId(id);
    try {
      const res = await fetch(`${API}/${id}/tags`);
      const data = await res.json();
      setTags(data.tags || []);
    } catch {
      // Show default tags for demo
      const res2 = await fetch(`${API}/default-tags/modbus_tcp`).catch(() => null);
      if (res2) {
        const d = await res2.json().catch(() => ({}));
        setTags(d.tags || []);
      }
    }
  };

  const doWrite = async () => {
    if (!writeTag || writeValue === "") return;
    try {
      await fetch(`${API}/${plcId}/tags/${writeTag.id}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: parseFloat(writeValue) }),
      });
      addServerLog({ level: "info", msg: `Wrote ${writeValue} to ${writeTag.name}` });
      setWriteTag(null);
    } catch {
      addServerLog({ level: "warn", msg: "Write failed — PLC not connected" });
    }
  };

  const TYPE_COLORS = { bool: "#10b981", int: "#00d4ff", real: "#f59e0b", word: "#8b5cf6", dint: "#f97316" };

  return (
    <div style={{ padding: 12 }}>
      <SectionLabel>Select PLC</SectionLabel>
      <select className="select" value={plcId} onChange={e => loadTags(e.target.value)}
        style={{ width: "100%", marginBottom: 12, fontSize: 11 }}>
        <option value="">-- Select PLC --</option>
        {plcs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value="demo">Demo (Default Tags)</option>
      </select>

      {plcId === "demo" && tags.length === 0 && (
        <button className="btn primary" onClick={() => fetch(`${API}/default-tags/siemens_s7`).then(r=>r.json()).then(d=>setTags(d.tags||[]))}
          style={{ width: "100%", justifyContent: "center", fontSize: 11, marginBottom: 10 }}>
          Load Demo Tags
        </button>
      )}

      {writeTag && (
        <div style={{ padding: "10px 12px", background: "rgba(0,212,255,0.05)", border: "1px solid var(--border-accent)", borderRadius: "var(--radius-md)", marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>Write to: <strong style={{ color: "var(--text-primary)" }}>{writeTag.name}</strong></div>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" type="number" value={writeValue} onChange={e => setWriteValue(e.target.value)}
              placeholder={`${writeTag.min_value} - ${writeTag.max_value}`} style={{ flex: 1, fontSize: 11 }} />
            <button className="btn primary" onClick={doWrite} style={{ fontSize: 10 }}>Write</button>
            <button className="btn" onClick={() => setWriteTag(null)} style={{ fontSize: 10 }}>✕</button>
          </div>
        </div>
      )}

      {tags.length > 0 && (
        <div>
          <SectionLabel>Tags ({tags.length})</SectionLabel>
          {tags.map((tag, i) => (
            <div key={i} style={{ padding: "7px 10px", marginBottom: 5, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
              onClick={() => setWriteTag(tag)}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, fontFamily: "var(--font-mono)", background: `${TYPE_COLORS[tag.tag_type] || "#888"}15`, color: TYPE_COLORS[tag.tag_type] || "#888", border: `1px solid ${TYPE_COLORS[tag.tag_type] || "#888"}33` }}>
                  {tag.tag_type?.toUpperCase()}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-primary)", flex: 1 }}>{tag.name}</span>
                {tag.current_value !== null && tag.current_value !== undefined && (
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-accent)" }}>
                    {typeof tag.current_value === "boolean" ? (tag.current_value ? "ON" : "OFF") : Number(tag.current_value).toFixed(1)}
                    {tag.unit ? ` ${tag.unit}` : ""}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                {tag.address} {tag.mapped_device ? `→ ${tag.mapped_device}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tag Map Tab ────────────────────────────────────────────────────────────────
function TagMapTab({ devices, addServerLog }) {
  const [plcs, setPlcs] = useState([]);
  const [selectedPlc, setSelectedPlc] = useState("");
  const [tags, setTags] = useState([]);
  const [mappings, setMappings] = useState([
    { tag: "pump_speed",  device: "pump-01",  param: "speed",    description: "Controls pump VFD speed 0-100%" },
    { tag: "pump_run",    device: "pump-01",  param: "run",      description: "Pump run/stop command" },
    { tag: "valve_bank",  device: "valve-01", param: "pattern",  description: "Solenoid valve bit pattern" },
    { tag: "pressure",    device: "sensor-01",param: "pressure", description: "Pressure sensor feedback" },
  ]);

  useEffect(() => {
    fetch(`${API}/`).then(r=>r.json()).then(d=>setPlcs(d.plcs||[])).catch(()=>{});
  }, []);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>
        Map PLC tags to AquaFlow device parameters. During show playback, values are automatically written to the PLC.
      </div>

      <SectionLabel>Current Mappings</SectionLabel>
      {mappings.map((m, i) => (
        <div key={i} style={{ padding: "8px 10px", marginBottom: 6, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{m.tag}</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>→</span>
            <span style={{ fontSize: 11, color: "var(--text-primary)" }}>{m.device}</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>.</span>
            <span style={{ fontSize: 11, color: "var(--amber)" }}>{m.param}</span>
            <button className="btn" style={{ marginLeft: "auto", padding: "1px 6px", fontSize: 9 }}
              onClick={() => setMappings(ms => ms.filter((_, j) => j !== i))}>✕</button>
          </div>
          <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{m.description}</div>
        </div>
      ))}

      <SectionLabel>Add Mapping</SectionLabel>
      <AddMappingForm devices={devices} onAdd={(m) => { setMappings(ms => [...ms, m]); addServerLog({ level: "info", msg: `Tag mapped: ${m.tag} → ${m.device}.${m.param}` }); }} />

      {/* Safety interlocks */}
      <SectionLabel>Safety Interlocks</SectionLabel>
      {[
        { label: "Max Pump Speed",    value: "85%",    tag: "pump_speed",  condition: ">" },
        { label: "Min Water Pressure",value: "1.5 bar",tag: "pressure",    condition: "<" },
        { label: "Emergency Stop",    value: "0",      tag: "estop",       condition: "==" },
      ].map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 4, background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: "var(--radius-sm)" }}>
          <span style={{ fontSize: 10, color: "var(--red)" }}>⚠</span>
          <span style={{ fontSize: 11, color: "var(--text-secondary)", flex: 1 }}>{s.label}</span>
          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--red)" }}>{s.condition} {s.value}</span>
        </div>
      ))}
    </div>
  );
}

function AddMappingForm({ devices, onAdd }) {
  const [form, setForm] = useState({ tag: "", device: "", param: "speed", description: "" });
  const PARAMS = ["speed", "run", "pattern", "intensity", "pressure", "flow", "temperature"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
      <input className="input" placeholder="Tag address (e.g. pump_speed)" value={form.tag}
        onChange={e => setForm(f=>({...f, tag: e.target.value}))} style={{ fontSize: 11, fontFamily: "var(--font-mono)" }} />
      <div style={{ display: "flex", gap: 6 }}>
        <select className="select" value={form.device} onChange={e => setForm(f=>({...f, device: e.target.value}))} style={{ flex: 1, fontSize: 11 }}>
          <option value="">Device...</option>
          {devices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <select className="select" value={form.param} onChange={e => setForm(f=>({...f, param: e.target.value}))} style={{ flex: 1, fontSize: 11 }}>
          {PARAMS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <button className="btn primary" onClick={() => { if (form.tag && form.device) { onAdd(form); setForm({ tag: "", device: "", param: "speed", description: "" }); } }}
        style={{ justifyContent: "center", fontSize: 11 }}>
        + Add Mapping
      </button>
    </div>
  );
}

// ── Monitor Tab ────────────────────────────────────────────────────────────────
function MonitorTab() {
  const [values, setValues] = useState({});
  const [plcs, setPlcs] = useState([]);
  const [selectedPlc, setSelectedPlc] = useState("");
  const intervalRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/`).then(r=>r.json()).then(d=>{ setPlcs(d.plcs||[]); if(d.plcs?.length) setSelectedPlc(d.plcs[0].id); }).catch(()=>{});
  }, []);

  useEffect(() => {
    if (!selectedPlc) return;
    const poll = async () => {
      try {
        const res = await fetch(`${API}/${selectedPlc}/values`);
        const data = await res.json();
        setValues(data.values || {});
      } catch {}
    };
    poll();
    intervalRef.current = setInterval(poll, 500);
    return () => clearInterval(intervalRef.current);
  }, [selectedPlc]);

  const DEMO_VALUES = { pump_speed: 72.5, pump_run: 1, valve_bank: 255, pressure: 4.2, flow_rate: 125.0 };
  const displayValues = Object.keys(values).length > 0 ? values : DEMO_VALUES;

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
        <select className="select" value={selectedPlc} onChange={e => setSelectedPlc(e.target.value)} style={{ flex: 1, fontSize: 11 }}>
          <option value="">-- Select PLC --</option>
          {plcs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="demo">Demo Values</option>
        </select>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 6px var(--green)", animation: "pulse-glow 1s infinite" }} />
      </div>

      <SectionLabel>Live Tag Values</SectionLabel>
      {Object.entries(displayValues).map(([key, val]) => (
        <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", marginBottom: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", flex: 1 }}>{key}</span>
          <div style={{ width: 60, height: 3, background: "var(--border)", borderRadius: 2 }}>
            <div style={{ width: `${Math.min(100, (parseFloat(val) / 1000) * 100)}%`, height: "100%", background: "var(--accent)", borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-accent)", minWidth: 50, textAlign: "right" }}>
            {typeof val === "boolean" ? (val ? "ON" : "OFF") : Number(val).toFixed(1)}
          </span>
        </div>
      ))}

      <SectionLabel>PLC Status</SectionLabel>
      {plcs.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", padding: "12px 0" }}>
          Connect a PLC in the Connect tab to see live values
        </div>
      ) : plcs.map(p => (
        <div key={p.id} style={{ display: "flex", gap: 8, padding: "6px 10px", marginBottom: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 10 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", marginTop: 2, background: p.connected ? "var(--green)" : "var(--red)" }} />
          <span style={{ color: "var(--text-primary)", flex: 1 }}>{p.name}</span>
          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{p.ip}</span>
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 9, fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 7, marginTop: 12, borderBottom: "1px solid var(--border)", paddingBottom: 3 }}>
      {children}
    </div>
  );
}

function FieldRow({ label, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 10, color: "var(--text-muted)", width: 70, flexShrink: 0, textAlign: "right", fontFamily: "var(--font-mono)" }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
