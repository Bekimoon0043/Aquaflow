import { useState, useEffect, useRef } from "react";
import { useShowStore } from "../../store/showStore";
import { API_BASE_URL } from "../../config";
import { apiGet, apiPost } from "../../utils/apiClient";
import SiemensSitePanel from "./SiemensSitePanel";
import SiemensSetupWizard from "./siemens/SiemensSetupWizard";
import SiemensIOMapTab from "./siemens/SiemensIOMapTab";
import { usePanelAction } from "../../workspaces/navigation"; // AF-NEXT-014
import {
  PREFILL_KEY, PREFILL_EVENT, applyPlcPrefill, buildConnectBody, profileGateSatisfied,
  parseModbusPoints, verifyOutcomeStyle, verifySummary,
} from "../../utils/plcConfig";

export { applyPlcPrefill, buildConnectBody, profileGateSatisfied, parseModbusPoints, verifyOutcomeStyle, verifySummary };

const API = `${API_BASE_URL}/plc`;

// AF-IO-006/AF-CAT — ALL families are listed (operator request), each honestly
// labeled. REAL = full driver. connectAs = the unit's Modbus TCP interface is
// used, said out loud (Delta/Mitsubishi/Omron units that speak Modbus). Entries
// with `reason` have no driver: shown so the operator knows AquaFlow knows them,
// but Connect is disabled — never the old silent wrong-driver connection.
export const PLC_TYPES = [
  { id: "siemens_s7",    label: "Siemens S7",         port: 102,   color: "#00d4ff", tier: "REAL" },
  { id: "modbus_tcp",    label: "Modbus TCP",         port: 502,   color: "#f97316", tier: "REAL" },
  { id: "delta",         label: "Delta DVP/AS",       port: 502,   color: "#06b6d4", tier: "GATED", connectAs: "modbus_tcp" },
  { id: "mitsubishi",    label: "Mitsubishi MELSEC",  port: 502,   color: "#10b981", tier: "GATED", connectAs: "modbus_tcp" },
  { id: "omron",         label: "Omron CJ/CS/NX",     port: 502,   color: "#f43f5e", tier: "GATED", connectAs: "modbus_tcp" },
  { id: "opc_ua",        label: "OPC UA",             port: 4840,  color: "#8b5cf6", tier: "REAL",
    hint: "asyncua bundled — tag address is the NodeId string, e.g. ns=3;s=\"DB_Fountain\".\"Pump1_Speed\"" },
  { id: "allen_bradley", label: "Allen Bradley",      port: 44818, color: "#f59e0b", tier: "REAL",
    hint: "pycomm3 bundled — tag address is the Logix tag name, e.g. Pump1_Speed, Speeds[2], Program:Main.Valve1" },
  { id: "beckhoff",      label: "Beckhoff TwinCAT",   port: 4840,  color: "#a78bfa", tier: "UNSUPPORTED",
    reason: "ADS driver not implemented — identifiable in Discovery → Controllers, not drivable" },
];

// Pure helpers (exported for tests).
export function plcConnectAs(t) { return (t && (t.connectAs || t.id)) || ""; }
export function plcConnectable(t) { return !!t && (t.tier === "REAL" || !!t.connectAs); }
export function plcTypeSubLabel(t) {
  if (!t || t.tier === "REAL") return "";
  if (t.connectAs) return "via Modbus TCP";
  return "no driver";
}

export default function PLCPanel() {
  const [tab, setTab] = useState("setup");
  const { devices, addServerLog } = useShowStore();
  // AF-NEXT-014: workspace guidance can open a tab (navigation only — nothing connects).
  usePanelAction("plc", ({ action, detail }) => {
    if (action === "tab" && ["setup", "map", "site", "connect", "tags", "monitor", "fieldio"].includes(detail?.tab)) setTab(detail.tab);
  });

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36, background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 13 }}>⚙</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          PLC Integration
        </span>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", flexShrink: 0 }}>
        {[["setup","Siemens Setup"],["map","I/O Map"],["site","Advanced Site"],["connect","Generic PLC"],["tags","Tag Browser"],["monitor","Monitor"],["fieldio","Field I/O"]].map(([key, label]) => (
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
        {tab === "setup"   && <SiemensSetupWizard onOpenAdvanced={() => setTab("site")} />}
        {tab === "map"     && <SiemensIOMapTab onOpenSetup={() => setTab("setup")} />}
        {tab === "connect" && <ConnectTab addServerLog={addServerLog} />}
        {tab === "site"    && <SiemensSitePanel />}
        {tab === "tags"    && <TagBrowserTab addServerLog={addServerLog} />}
        {tab === "monitor" && <MonitorTab />}
        {tab === "fieldio" && <FieldIOTab />}
      </div>
    </div>
  );
}

// ── Field I/O tab (AF-IO-007) ─────────────────────────────────────────────────
// Pure helpers exported for tests (the FixtureLibraryBrowser pattern).

export function fieldIoQualityColor(quality) {
  // GOOD is the only quality that may look calm. Everything else is a warning
  // the operator must be unable to miss.
  switch (quality) {
    case "GOOD": return "var(--green)";
    case "STALE": return "#f59e0b";
    case "FAULT": return "var(--red)";
    default: return "#8b5cf6";       // UNKNOWN — never read / no transport
  }
}

export function formatFieldIoValue(point) {
  if (point.value === null || point.value === undefined) return "—";
  if (typeof point.value === "boolean") return point.value ? "ON" : "OFF";
  const num = Number(point.value);
  const text = Number.isInteger(num) ? String(num) : num.toFixed(2);
  return point.unit ? `${text} ${point.unit}` : text;
}

export function formatFieldIoAge(ageS) {
  if (ageS === null || ageS === undefined) return "never";
  if (ageS < 1) return "<1s";
  if (ageS < 60) return `${Math.round(ageS)}s`;
  return `${Math.round(ageS / 60)}m`;
}

function FieldIOTab() {
  const [data, setData] = useState({ points: [], sources: {}, heartbeat_alive: null });
  const [error, setError] = useState("");
  const timer = useRef(null);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/field-io/points`);
      setData(await res.json());
      setError("");
    } catch {
      setError("backend unreachable");
    }
  };

  useEffect(() => {
    load();
    timer.current = setInterval(load, 2000);
    return () => clearInterval(timer.current);
  }, []);

  const mono = { fontFamily: "var(--font-mono)" };

  return (
    <div style={{ padding: 10 }}>
      <SectionLabel>Field points — live quality</SectionLabel>
      {error && <div style={{ fontSize: 10, color: "var(--red)" }}>{error}</div>}
      {data.points.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", padding: "12px 0" }}>
          No field points declared — see docs/S7_DB_CONTRACT.md for the site config
        </div>
      ) : data.points.map(p => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 10 }}>
          <div title={p.quality} style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: fieldIoQualityColor(p.quality) }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "var(--text-primary)" }}>
              {p.label}
              {p.required && <span title="gates the safety permit" style={{ color: "var(--red)", marginLeft: 4 }}>●req</span>}
              {p.binds_to && <span style={{ color: "var(--text-muted)", marginLeft: 6, ...mono }}>→{p.binds_to}</span>}
            </div>
            <div style={{ color: "var(--text-muted)", ...mono }}>{p.source} · {p.address}</div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ color: fieldIoQualityColor(p.quality), ...mono }}>{formatFieldIoValue(p)}</div>
            <div style={{ color: "var(--text-muted)", ...mono }}>
              {p.quality} · raw {p.raw ?? "—"} · {formatFieldIoAge(p.age_s)}
            </div>
          </div>
        </div>
      ))}

      <SectionLabel>Sources — last raw exchange</SectionLabel>
      {Object.keys(data.sources || {}).length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>no transports active</div>
      ) : Object.entries(data.sources).map(([src, s]) => (
        <div key={src} style={{ padding: "6px 10px", marginBottom: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 9, ...mono }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", marginTop: 2, background: s.connected ? "var(--green)" : "var(--red)" }} />
            <span style={{ color: "var(--text-primary)", flex: 1 }}>{src}</span>
            {s.last_error && <span style={{ color: "var(--red)" }}>{s.last_error}</span>}
          </div>
          <div style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>TX {s.last_tx_hex || "—"}</div>
          <div style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>RX {s.last_rx_hex || "—"}</div>
        </div>
      ))}
      {data.heartbeat_alive !== null && (
        <div style={{ fontSize: 10, marginTop: 6, color: data.heartbeat_alive ? "var(--green)" : "var(--red)", ...mono }}>
          PLC heartbeat: {data.heartbeat_alive ? "ALIVE (counter moving)" : "DEAD (counter frozen — halted CPU?)"}
        </div>
      )}
    </div>
  );
}

// ── Connect Tab ────────────────────────────────────────────────────────────────
// AF-DISC: accepts a prefill from Device Discovery (form only — never auto-connects),
// requires an EXPLICIT tag-profile selection + confirmation for Siemens (no silent
// DB1 assumptions), and offers a separate READ-ONLY verification step.
function ConnectTab({ addServerLog }) {
  const [plcs, setPlcs] = useState([]);
  const [form, setForm] = useState({ name: "My PLC", plc_type: "siemens_s7", ip: "192.168.1.100", port: 102, rack: 0, slot: 1, unit_id: 1 });
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState("");
  const [profileConfirmed, setProfileConfirmed] = useState(false);
  const [modbusPoints, setModbusPoints] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyError, setVerifyError] = useState("");

  useEffect(() => {
    loadPLCs();
    apiGet("/plc/profiles").then(d => setProfiles(d.profiles || [])).catch(() => {});
    // Prefill handed over by Device Discovery → Controllers → "Configure PLC".
    const applyDetail = (detail) => {
      if (!detail) return;
      setForm(f => applyPlcPrefill(f, detail));
      setVerifyResult(null);
      addServerLog?.({ level: "info", msg: `PLC form pre-filled from discovery (${detail.plc_type} @ ${detail.ip}) — review, then Connect` });
    };
    try {
      const raw = window.localStorage.getItem(PREFILL_KEY);
      if (raw) { applyDetail(JSON.parse(raw)); window.localStorage.removeItem(PREFILL_KEY); }
    } catch {}
    const onPrefill = (e) => applyDetail(e.detail);
    window.addEventListener(PREFILL_EVENT, onPrefill);
    return () => window.removeEventListener(PREFILL_EVENT, onPrefill);
  }, []);

  const loadPLCs = async () => {
    try {
      const res = await fetch(`${API}/`);
      const data = await res.json();
      setPlcs(data.plcs || []);
    } catch {}
  };

  const selectedType = PLC_TYPES.find(t => t.id === form.plc_type);
  const wireType = plcConnectAs(selectedType);
  const isSiemens = wireType === "siemens_s7";
  const profile = profiles.find(p => p.id === profileId);
  const gateOk = profileGateSatisfied(wireType, profileId, profileConfirmed);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API}/test-connection?ip=${form.ip}&plc_type=${form.plc_type}&port=${form.port}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setTestResult(data);
    } catch (e) {
      setTestResult({ reachable: false, error: e.message || "Backend offline" });
    } finally { setTesting(false); }
  };

  const connect = async () => {
    if (!plcConnectable(selectedType)) {
      addServerLog({ level: "warn", msg: `${selectedType?.label}: ${selectedType?.reason || "no driver"}` });
      return;
    }
    if (!gateOk) {
      addServerLog({ level: "warn", msg: "Confirm the selected Siemens tag profile before connecting" });
      return;
    }
    setConnecting(true);
    addServerLog({ level: "info", msg: `Connecting to ${form.name} (${selectedType.label}${wireType !== form.plc_type ? " via Modbus TCP" : ""}) @ ${form.ip}...` });
    try {
      const data = await apiPost("/plc/connect", buildConnectBody(form, wireType, { profileId, profileConfirmed }));
      if (data.connected) {
        addServerLog({ level: "info", msg: `✓ ${form.name} connected — ${data.tag_count} tags loaded${data.profile_id ? ` (profile ${data.profile_id})` : ""}. Not yet verified — run Verify (read-only).` });
      } else {
        addServerLog({ level: "warn", msg: `${form.name} connection failed: ${data.error || "Unknown error"}` });
      }
      if (data.note) addServerLog({ level: "info", msg: data.note });
      loadPLCs();
    } catch (e) {
      addServerLog({ level: "warn", msg: `Connect refused — ${e.message || "backend offline"}` });
    } finally { setConnecting(false); }
  };

  const verify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    setVerifyError("");
    try {
      let data;
      if (isSiemens) {
        if (!profileId) throw new Error("select a tag profile — verification reads only its declared input fields");
        data = await apiPost("/plc/verify", { ip: form.ip, port: Number(form.port), rack: Number(form.rack), slot: Number(form.slot), profile_id: profileId, samples: 4, interval_s: 0.3 });
      } else {
        const points = parseModbusPoints(modbusPoints);
        if (!points.length) throw new Error("list the known-safe input points to read — addresses are never guessed");
        data = await apiPost("/plc/verify-modbus", { ip: form.ip, port: Number(form.port), unit_id: Number(form.unit_id), points });
      }
      setVerifyResult(data);
      addServerLog({ level: data.ok ? "info" : "warn", msg: `PLC verify (read-only): ${verifySummary(data)}` });
    } catch (e) {
      setVerifyError(e.message || "verification failed");
    } finally { setVerifying(false); }
  };

  const inputStyle = { fontSize: 11, fontFamily: "var(--font-mono)" };

  return (
    <div style={{ padding: 12 }}>
      <SectionLabel>PLC Type</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 12 }}>
        {PLC_TYPES.map((t) => (
          <button key={t.id} onClick={() => { setForm(f => ({ ...f, plc_type: t.id, port: t.port })); setVerifyResult(null); }}
            style={{
              padding: "6px 8px", borderRadius: "var(--radius-sm)", cursor: "pointer",
              background: form.plc_type === t.id ? `${t.color}15` : "var(--bg-surface)",
              border: `1px solid ${form.plc_type === t.id ? t.color : "var(--border)"}`,
              color: form.plc_type === t.id ? t.color : "var(--text-muted)",
              fontSize: 10, textAlign: "left", fontWeight: form.plc_type === t.id ? 600 : 400,
              opacity: plcConnectable(t) ? 1 : 0.55,
            }}>
            {t.label}
            {plcTypeSubLabel(t) && (
              <span style={{ display: "block", fontSize: 8, fontFamily: "var(--font-mono)", color: plcConnectable(t) ? "var(--text-muted)" : "var(--red)" }}>
                {plcTypeSubLabel(t)}
              </span>
            )}
          </button>
        ))}
      </div>
      {selectedType && !plcConnectable(selectedType) && (
        <div style={{ padding: "6px 10px", marginBottom: 10, borderRadius: "var(--radius-sm)", fontSize: 10, background: "var(--bg-surface)", border: "1px solid var(--red)", color: "var(--red)" }}>
          {selectedType.reason}
        </div>
      )}
      {selectedType?.connectAs && (
        <div style={{ padding: "6px 10px", marginBottom: 10, borderRadius: "var(--radius-sm)", fontSize: 10, background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
          This family connects through its <b>Modbus TCP</b> interface (port 502) — make sure Modbus TCP is enabled on the unit.
        </div>
      )}
      {form.prefilled_from && (
        <div style={{ padding: "6px 10px", marginBottom: 10, borderRadius: "var(--radius-sm)", fontSize: 10, background: "rgba(0,212,255,0.05)", border: "1px solid var(--border-accent)", color: "var(--text-secondary)" }}>
          Pre-filled from discovery {form.prefill_vendor && <b>{form.prefill_vendor} {form.prefill_model}</b>} — not connected, not saved. Review the settings, then Connect.
        </div>
      )}

      <SectionLabel>Connection Settings</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        <FieldRow label="Name">
          <input className="input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} style={{ fontSize: 11 }} />
        </FieldRow>
        <FieldRow label="IP Address">
          <input className="input" value={form.ip} onChange={e => setForm(f => ({...f, ip: e.target.value}))} style={inputStyle} />
        </FieldRow>
        <FieldRow label="Port">
          <input className="input" type="number" value={form.port} onChange={e => setForm(f => ({...f, port: parseInt(e.target.value)}))} style={inputStyle} />
        </FieldRow>
        {isSiemens && (
          <>
            <FieldRow label="Rack">
              <input className="input" type="number" value={form.rack} onChange={e => setForm(f => ({...f, rack: parseInt(e.target.value)}))} style={inputStyle} />
            </FieldRow>
            <FieldRow label="Slot">
              <input className="input" type="number" value={form.slot} onChange={e => setForm(f => ({...f, slot: parseInt(e.target.value)}))} style={inputStyle} />
            </FieldRow>
            <FieldRow label="Tag profile">
              <select className="select" value={profileId} onChange={e => { setProfileId(e.target.value); setProfileConfirmed(false); setVerifyResult(null); }} style={{ fontSize: 11, width: "100%" }}>
                <option value="">none — connect without tags (nothing read)</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.label} · v{p.version}</option>)}
              </select>
            </FieldRow>
            {profile && (
              <div style={{ marginLeft: 78, padding: "6px 10px", borderRadius: "var(--radius-sm)", fontSize: 10, background: "var(--bg-surface)", border: `1px solid ${profileConfirmed ? "var(--green)" : "#f59e0b"}` }}>
                <div style={{ color: "var(--text-secondary)", marginBottom: 4 }}>
                  {profile.cpu} · rack {profile.rack} slot {profile.slot} · {profile.field_count} fields · contract {profile.contract}
                </div>
                <ul style={{ margin: "0 0 4px 14px", padding: 0, color: "var(--text-muted)", fontSize: 9 }}>
                  {(profile.requirements || []).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
                <label style={{ display: "flex", alignItems: "center", gap: 6, color: profileConfirmed ? "var(--green)" : "#f59e0b", cursor: "pointer" }}>
                  <input type="checkbox" checked={profileConfirmed} onChange={e => setProfileConfirmed(e.target.checked)} />
                  I confirm this PLC runs the {profile.label.split(" — ")[0]} program (DB1 as in {profile.contract})
                </label>
              </div>
            )}
          </>
        )}
        {!isSiemens && (
          <>
            <FieldRow label="Unit ID">
              <input className="input" type="number" min={0} max={247} value={form.unit_id} onChange={e => setForm(f => ({...f, unit_id: parseInt(e.target.value)}))} style={inputStyle} />
            </FieldRow>
            <FieldRow label="Verify points">
              <textarea className="input" rows={3} value={modbusPoints} onChange={e => setModbusPoints(e.target.value)}
                placeholder={"known-safe INPUT points to read, one per line:\n30001 input_register\n%MW10 holding_register\n3 discrete_input"}
                style={{ ...inputStyle, width: "100%", resize: "vertical" }} />
            </FieldRow>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button className="btn" onClick={testConnection} disabled={testing}
          style={{ flex: 1, justifyContent: "center", fontSize: 11 }}>
          {testing ? "Testing..." : "⟳ Test TCP"}
        </button>
        <button className="btn" onClick={verify} disabled={verifying || !plcConnectable(selectedType)}
          title="Read-only: reads declared inputs and watches the heartbeat change. Writes nothing."
          style={{ flex: 1, justifyContent: "center", fontSize: 11 }}>
          {verifying ? "Verifying..." : "🔍 Verify (read-only)"}
        </button>
        <button className="btn primary" onClick={connect} disabled={connecting || !plcConnectable(selectedType) || !gateOk}
          style={{ flex: 1, justifyContent: "center", fontSize: 11, opacity: plcConnectable(selectedType) && gateOk ? 1 : 0.5 }}>
          {connecting ? "Connecting..." : !plcConnectable(selectedType) ? "No driver" : !gateOk ? "Confirm profile" : "⚡ Connect"}
        </button>
      </div>

      {testResult && (
        <div style={{ padding: "7px 10px", marginBottom: 10, borderRadius: "var(--radius-sm)", fontSize: 11,
          background: testResult.reachable ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
          border: `1px solid ${testResult.reachable ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
          color: testResult.reachable ? "var(--green)" : "var(--red)" }}>
          {testResult.reachable ? `✓ ${form.ip}:${form.port} accepts TCP (proves reachability only — not a PLC, not a program)` : `✕ ${testResult.error || "Not reachable"}`}
        </div>
      )}

      {verifyError && (
        <div style={{ padding: "7px 10px", marginBottom: 10, borderRadius: "var(--radius-sm)", fontSize: 11, border: "1px solid rgba(239,68,68,0.3)", color: "var(--red)" }}>
          ✕ {verifyError}
        </div>
      )}
      {verifyResult && (() => {
        const st = verifyOutcomeStyle(verifyResult.outcome);
        return (
          <div style={{ padding: "8px 10px", marginBottom: 10, borderRadius: "var(--radius-sm)", fontSize: 10, background: "var(--bg-surface)", border: `1px solid ${st.color}` }}>
            <div style={{ color: st.color, fontWeight: 600, marginBottom: 3 }}>{st.label}</div>
            <div style={{ color: "var(--text-secondary)", marginBottom: 4 }}>{verifyResult.message}</div>
            <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 9 }}>{verifySummary(verifyResult)}</div>
            {(verifyResult.fields || []).length > 0 && (
              <div style={{ marginTop: 5, display: "grid", gridTemplateColumns: "1fr auto auto", gap: "2px 10px", fontFamily: "var(--font-mono)", fontSize: 9 }}>
                {verifyResult.fields.map((f) => (
                  <FieldStatusRow key={f.id} f={f} />
                ))}
              </div>
            )}
            {(verifyResult.warnings || []).map((w, i) => <div key={i} style={{ color: "#f59e0b", fontSize: 9, marginTop: 3 }}>⚠ {w}</div>)}
            <div style={{ color: "var(--text-muted)", fontSize: 9, marginTop: 4 }}>writes performed: {verifyResult.writes_performed ?? 0} · read-only verification</div>
          </div>
        );
      })()}

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

      {/* Bundled protocol libraries — shipped inside the engine since 1.2.5; nothing to pip install */}
      <SectionLabel>Bundled PLC Libraries</SectionLabel>
      {[
        { label: "Siemens S7", lib: "python-snap7 (pure Python) + validated raw S7comm fallback", note: "Tag address: DB1.DBW0 / DB1.DBD4 / DB1.DBX2.0 — PUT/GET permitted, DB non-optimized" },
        { label: "OPC UA",     lib: "asyncua", note: "Tag address: NodeId string as the server publishes it (ns=3;s=\"DB\".\"Tag\" or ns=2;i=1002). Writes are typed from the node's DataType." },
        { label: "Allen Bradley", lib: "pycomm3 (EtherNet/IP + CIP Read/Write Tag)", note: "Tag address: Logix tag name (Pump1_Speed, Speeds[2], Program:Main.Valve1). Types from the controller's tag list, else from your declared type." },
      ].map((lib) => (
        <div key={lib.label} style={{ padding: "6px 10px", marginBottom: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", marginBottom: 2 }}>{lib.label} <span style={{ color: "var(--green)" }}>● bundled</span></div>
          <code style={{ fontSize: 10, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{lib.lib}</code>
          {lib.note && <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>{lib.note}</div>}
        </div>
      ))}
    </div>
  );
}

function FieldStatusRow({ f }) {
  const ok = f.status === "ok";
  const value = f.value === null || f.value === undefined ? "—" : typeof f.value === "boolean" ? (f.value ? "1" : "0") : Array.isArray(f.value) ? f.value.join(",") : String(f.value);
  return (
    <>
      <span style={{ color: "var(--text-secondary)" }}>{f.name || f.id} <span style={{ color: "var(--text-muted)" }}>{f.address}</span></span>
      <span style={{ color: ok ? "var(--text-accent)" : "var(--text-muted)" }}>{value}</span>
      <span style={{ color: ok ? "var(--green)" : "var(--red)" }}>{ok ? "ok" : `${f.status}${f.error ? ` (${f.error})` : ""}`}</span>
    </>
  );
}

// ── Tag Browser Tab ────────────────────────────────────────────────────────────
// Pure helpers (exported for tests).

// Profile tags carry access "read" (PLC status/feedback) — never written.
export function isReadOnlyTag(tag) {
  const a = String(tag?.access || "").trim().toLowerCase();
  return a === "read" || a === "readonly" || a === "read_only" || a === "ro";
}

// Human-readable outcome of POST /plc/{id}/tags/{tag}/write. A 400/403 carries
// the backend's refusal reason in `detail` — show it verbatim.
export function plcWriteOutcome(ok, status, data) {
  if (!ok) {
    const detail = data && (typeof data.detail === "string" ? data.detail : data.detail ? JSON.stringify(data.detail) : "");
    if (status === 403) return { ok: false, msg: `Write refused by safety gate — ${detail || "safety permit not granted"}` };
    if (status === 400) return { ok: false, msg: `Write refused — ${detail || "tag is read-only"}` };
    return { ok: false, msg: `Write failed — ${detail || `HTTP ${status}`}` };
  }
  if (!data || data.success !== true) return { ok: false, msg: "Write not accepted — PLC not connected or tag not found" };
  return { ok: true, msg: "" };
}

function TagBrowserTab({ addServerLog }) {
  const [plcId, setPlcId] = useState("");
  const [tags, setTags] = useState([]);
  const [plcs, setPlcs] = useState([]);
  const [writeTag, setWriteTag] = useState(null);
  const [writeValue, setWriteValue] = useState("");
  const [confirmPending, setConfirmPending] = useState(false);
  const [writing, setWriting] = useState(false);
  const [writeMsg, setWriteMsg] = useState(null);   // { ok, msg }
  const [loadError, setLoadError] = useState("");

  const isDemo = plcId === "demo";

  useEffect(() => {
    fetch(`${API}/`).then(r => r.json()).then(d => setPlcs(d.plcs || [])).catch(() => {});
  }, []);

  const closeWrite = () => { setWriteTag(null); setConfirmPending(false); setWriteValue(""); };

  const loadTags = async (id) => {
    setPlcId(id);
    setTags([]);
    setLoadError("");
    setWriteMsg(null);
    closeWrite();
    if (!id || id === "demo") return;   // demo tags load only via the explicit button
    try {
      const res = await fetch(`${API}/${id}/tags`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setTags(data.tags || []);
    } catch (e) {
      // No silent demo fallback — a failed load must never look like real tags.
      setLoadError(`Could not load tags for this PLC — ${e.message || "backend unreachable"}`);
    }
  };

  const loadDemoTags = async () => {
    setLoadError("");
    try {
      const res = await fetch(`${API}/default-tags/modbus_tcp`);
      const d = await res.json();
      setTags(d.tags || []);
    } catch (e) {
      setLoadError(`Could not load demo tags — ${e.message || "backend unreachable"}`);
    }
  };

  const doWrite = async () => {
    if (!writeTag || writeValue === "" || isDemo) return;
    setWriting(true);
    try {
      const res = await fetch(`${API}/${plcId}/tags/${writeTag.id}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: parseFloat(writeValue) }),
      });
      const data = await res.json().catch(() => ({}));
      const out = plcWriteOutcome(res.ok, res.status, data);
      if (out.ok) {
        const msg = `Wrote ${writeValue} to ${writeTag.name} (${writeTag.address})`;
        addServerLog({ level: "info", msg });
        setWriteMsg({ ok: true, msg });
        closeWrite();
      } else {
        addServerLog({ level: "warn", msg: `${writeTag.name}: ${out.msg}` });
        setWriteMsg(out);
        setConfirmPending(false);
      }
    } catch {
      const out = { ok: false, msg: "Write failed — backend unreachable" };
      addServerLog({ level: "warn", msg: out.msg });
      setWriteMsg(out);
      setConfirmPending(false);
    } finally { setWriting(false); }
  };

  const TYPE_COLORS = { bool: "#10b981", int: "#00d4ff", real: "#f59e0b", word: "#8b5cf6", dint: "#f97316" };

  return (
    <div style={{ padding: 12 }}>
      <SectionLabel>Select PLC</SectionLabel>
      <select className="select" value={plcId} onChange={e => loadTags(e.target.value)}
        style={{ width: "100%", marginBottom: 12, fontSize: 11 }}>
        <option value="">-- Select PLC --</option>
        {plcs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value="demo">Demo (Default Tags) — not a real PLC</option>
      </select>

      {loadError && (
        <div style={{ padding: "7px 10px", marginBottom: 10, borderRadius: "var(--radius-sm)", fontSize: 10, border: "1px solid rgba(239,68,68,0.3)", color: "var(--red)" }}>
          ✕ {loadError}
        </div>
      )}

      {isDemo && (
        <div style={{ padding: "6px 10px", marginBottom: 10, borderRadius: "var(--radius-sm)", fontSize: 10, background: "var(--bg-surface)", border: "1px solid #f59e0b", color: "#f59e0b" }}>
          DEMO — example Modbus TCP tag layout only. Not a real PLC: no values, writes disabled.
        </div>
      )}

      {isDemo && tags.length === 0 && (
        <button className="btn primary" onClick={loadDemoTags}
          style={{ width: "100%", justifyContent: "center", fontSize: 11, marginBottom: 10 }}>
          Load Demo Tags
        </button>
      )}

      {writeMsg && (
        <div style={{ padding: "7px 10px", marginBottom: 10, borderRadius: "var(--radius-sm)", fontSize: 10,
          border: `1px solid ${writeMsg.ok ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
          color: writeMsg.ok ? "var(--green)" : "var(--red)" }}>
          {writeMsg.ok ? "✓" : "✕"} {writeMsg.msg}
        </div>
      )}

      {writeTag && (
        <div style={{ padding: "10px 12px", background: "rgba(0,212,255,0.05)", border: "1px solid var(--border-accent)", borderRadius: "var(--radius-md)", marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>
            Write to: <strong style={{ color: "var(--text-primary)" }}>{writeTag.name}</strong>
            <span style={{ fontFamily: "var(--font-mono)", marginLeft: 6 }}>{writeTag.address}</span>
          </div>
          {confirmPending ? (
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary" onClick={doWrite} disabled={writing}
                style={{ flex: 1, justifyContent: "center", fontSize: 10, borderColor: "#f59e0b" }}>
                {writing ? "Writing..." : `Confirm write ${writeValue} to ${writeTag.name} at ${writeTag.address}`}
              </button>
              <button className="btn" onClick={() => setConfirmPending(false)} disabled={writing} style={{ fontSize: 10 }}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input" type="number" value={writeValue} onChange={e => setWriteValue(e.target.value)}
                placeholder={`${writeTag.min_value} - ${writeTag.max_value}`} style={{ flex: 1, fontSize: 11 }} />
              <button className="btn primary" onClick={() => { setWriteMsg(null); setConfirmPending(true); }}
                disabled={writeValue === "" || isDemo} style={{ fontSize: 10 }}>Write…</button>
              <button className="btn" onClick={closeWrite} style={{ fontSize: 10 }}>✕</button>
            </div>
          )}
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 5 }}>
            Non-zero writes need the safety permit; writing 0 is always allowed.
          </div>
        </div>
      )}

      {tags.length > 0 && (
        <div>
          <SectionLabel>Tags ({tags.length}){isDemo ? " — demo" : ""}</SectionLabel>
          {tags.map((tag, i) => {
            const ro = isReadOnlyTag(tag);
            const writable = !ro && !isDemo;
            return (
              <div key={i} style={{ padding: "7px 10px", marginBottom: 5, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", cursor: writable ? "pointer" : "default" }}
                title={ro ? "Read-only PLC field — never written" : isDemo ? "Demo tag — not a real PLC" : "Click to write"}
                onClick={() => { if (writable) { setWriteTag(tag); setWriteValue(""); setConfirmPending(false); setWriteMsg(null); } }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, fontFamily: "var(--font-mono)", background: `${TYPE_COLORS[tag.tag_type] || "#888"}15`, color: TYPE_COLORS[tag.tag_type] || "#888", border: `1px solid ${TYPE_COLORS[tag.tag_type] || "#888"}33` }}>
                    {tag.tag_type?.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-primary)", flex: 1 }}>{tag.name}</span>
                  {ro && <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>READ-ONLY</span>}
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
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Monitor Tab ────────────────────────────────────────────────────────────────
// "Live" only when values actually arrived recently — never a decorative pulse.
export const MONITOR_LIVE_WINDOW_MS = 2000;
export function monitorIsLive(lastValuesAt, now, windowMs = MONITOR_LIVE_WINDOW_MS) {
  return !!lastValuesAt && now - lastValuesAt <= windowMs;
}

function MonitorTab() {
  const [values, setValues] = useState({});
  const [plcs, setPlcs] = useState([]);
  const [selectedPlc, setSelectedPlc] = useState("");
  const [lastValuesAt, setLastValuesAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const intervalRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/`).then(r=>r.json()).then(d=>{ setPlcs(d.plcs||[]); if(d.plcs?.length) setSelectedPlc(d.plcs[0].id); }).catch(()=>{});
  }, []);

  useEffect(() => {
    setValues({});
    setLastValuesAt(0);
    if (!selectedPlc) return;
    const poll = async () => {
      try {
        const res = await fetch(`${API}/${selectedPlc}/values`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const v = data.values || {};
        setValues(v);
        if (Object.keys(v).length > 0) setLastValuesAt(Date.now());
      } catch {
        setValues({});
      }
      setNow(Date.now());
    };
    poll();
    intervalRef.current = setInterval(poll, 500);
    return () => clearInterval(intervalRef.current);
  }, [selectedPlc]);

  const live = monitorIsLive(lastValuesAt, now);
  const entries = Object.entries(values);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
        <select className="select" value={selectedPlc} onChange={e => setSelectedPlc(e.target.value)} style={{ flex: 1, fontSize: 11 }}>
          <option value="">-- Select PLC --</option>
          {plcs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div title={live ? "live — values received in the last 2 s" : "no data"}
          style={live
            ? { width: 6, height: 6, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 6px var(--green)", animation: "pulse-glow 1s infinite" }
            : { width: 6, height: 6, borderRadius: "50%", background: "var(--text-muted)", opacity: 0.6 }} />
        <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: live ? "var(--green)" : "var(--text-muted)" }}>
          {live ? "LIVE" : "NO DATA"}
        </span>
      </div>

      <SectionLabel>Live Tag Values</SectionLabel>
      {entries.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", padding: "12px 0" }}>
          No live PLC values — connect a PLC first
        </div>
      ) : entries.map(([key, val]) => (
        <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", marginBottom: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", opacity: live ? 1 : 0.5 }}>
          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", flex: 1 }}>{key}</span>
          <div style={{ width: 60, height: 3, background: "var(--border)", borderRadius: 2 }}>
            <div style={{ width: `${Math.min(100, (parseFloat(val) / 1000) * 100)}%`, height: "100%", background: "var(--accent)", borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-accent)", minWidth: 50, textAlign: "right" }}>
            {val === null || val === undefined ? "—" : typeof val === "boolean" ? (val ? "ON" : "OFF") : Number(val).toFixed(1)}
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
