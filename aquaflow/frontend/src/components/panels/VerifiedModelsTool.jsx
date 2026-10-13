// VerifiedModelsTool.jsx — AF-NEXT-012 (Fixture data trust)
// Lists the verified equipment set (GET /api/equipment/models) and lets the user
// enter a user-measured (or properly documented datasheet) model: measured jet
// height vs pressure, pump curve points, valve Kv, light DMX/power.
// Nothing here is pre-filled with real manufacturer data.
import { useState } from "react";
import { apiGet, apiPost, apiUrl } from "../../utils/apiClient";
import ProvenanceBadge from "./ProvenanceBadge";
import { POINTS_HINT, VERIFIED_KINDS, buildVerifiedModelRecord, emptyVerifiedForm } from "../../engineering/verifiedModelForm";

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };
const input = { ...box, padding: 4, fontSize: 10.5, color: "var(--text-primary)", width: "100%", boxSizing: "border-box" };
const lbl = { fontSize: 10, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 2 };

export default function VerifiedModelsTool() {
  const [models, setModels] = useState(null);
  const [form, setForm] = useState(emptyVerifiedForm());
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState([]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = async () => {
    try { setModels((await apiGet("/equipment/models")).models || []); setMsg(""); }
    catch (e) { setMsg(`Could not load: ${e.message || e}`); }
  };
  const submit = async () => {
    const { record, errors: errs } = buildVerifiedModelRecord(form);
    setErrors(errs);
    if (errs.length) return;
    try {
      const r = await apiPost("/equipment/models", record);
      setMsg(`Saved ${r.model.id} (${r.model.provenance.label}).`);
      setForm(emptyVerifiedForm(form.kind));
      load();
    } catch (e) { setMsg(`Refused: ${e.message || e}`); }
  };
  const remove = async (m) => {
    try {
      const res = await fetch(apiUrl(`/equipment/models/${m.kind}/${encodeURIComponent(m.id)}`), { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch (e) { setMsg(`Delete failed: ${e.message || e}`); }
  };

  const F = (k, label, props = {}) => (
    <label style={lbl}>{label}<input value={form[k]} onChange={(e) => set(k, e.target.value)} style={input} {...props} /></label>
  );
  const isDatasheet = form.source === "manufacturer_datasheet";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
        Verified equipment set · <code>GET/POST /equipment/models</code>. AquaFlow ships no manufacturer data; add your own
        measurements, or datasheet values you have permission to use. Everything else stays a generic estimate.
      </div>
      <div><button onClick={load} style={{ ...box, padding: "5px 10px", fontSize: 10, color: "var(--text-primary)", cursor: "pointer" }}>Load verified models</button></div>
      {models && (models.length === 0
        ? <div style={{ fontSize: 10, color: "#fbbf24" }}>No verified models yet — all calculations use generic estimates.</div>
        : (
          <table style={{ fontSize: 10, borderCollapse: "collapse", color: "var(--text-primary)" }}>
            <thead><tr>{["Kind", "Model", "Source", "Revision / date", "Origin", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: 3, color: "var(--text-muted)" }}>{h}</th>)}</tr></thead>
            <tbody>
              {models.map((m) => (
                <tr key={`${m.kind}:${m.id}`} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: 3 }}>{m.kind}</td>
                  <td style={{ padding: 3 }}>{m.label}<div style={{ color: "var(--text-muted)" }}>{m.id}</div></td>
                  <td style={{ padding: 3 }}><ProvenanceBadge provenance={m.provenance} /></td>
                  <td style={{ padding: 3 }}>{m.provenance.revision || "—"} · {m.provenance.date || "—"}</td>
                  <td style={{ padding: 3 }}>{m.origin}</td>
                  <td style={{ padding: 3 }}>{m.origin === "user" && <button onClick={() => remove(m)} style={{ fontSize: 9, cursor: "pointer" }}>Delete</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      <div style={{ ...box, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>Add a verified model</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6 }}>
          <label style={lbl}>Kind
            <select aria-label="Verified model kind" value={form.kind} onChange={(e) => setForm({ ...emptyVerifiedForm(e.target.value), source: form.source })} style={input}>
              {VERIFIED_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label style={lbl}>Data source
            <select aria-label="Verified model source" value={form.source} onChange={(e) => set("source", e.target.value)} style={input}>
              <option value="user_measured">User measured</option>
              <option value="manufacturer_datasheet">Manufacturer datasheet</option>
            </select>
          </label>
          {F("label", "Label *")}
          {F("model", "Model *")}
          {F("manufacturer", isDatasheet ? "Manufacturer *" : "Manufacturer")}
          {F("date", isDatasheet ? "Datasheet date" : "Measurement date *", { type: "date" })}
          {F("revision", isDatasheet ? "Datasheet revision *" : "Run / revision")}
          {F("documentTitle", isDatasheet ? "Document title * (or URL/file)" : "Test sheet title")}
          {F("documentUrl", "Document URL")}
          {F("documentFile", "Document file")}
          <label style={lbl}>Confidence
            <select value={form.confidence} onChange={(e) => set("confidence", e.target.value)} style={input}>
              {["high", "medium", "low"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {F("licence", isDatasheet ? "Licence / permission note *" : "Licence / permission note")}
          {F("fixtureKey", "Library fixture key (optional)")}
        </div>
        {(form.kind === "nozzle" || form.kind === "pump") && (
          <label style={lbl}>{form.kind === "nozzle" ? "Measured jet height vs pressure" : "Pump curve points"} — {POINTS_HINT[form.kind]}
            <textarea aria-label="Measured points" value={form.points} onChange={(e) => set("points", e.target.value)} spellCheck={false}
              style={{ ...input, height: 90, fontFamily: "monospace" }} placeholder={form.kind === "nozzle" ? "0.5, 40, 3.0\n1.0, 57, 6.0" : "0, 30\n0.01, 28\n0.02, 23"} />
          </label>
        )}
        {form.kind === "valve" && <div style={{ display: "flex", gap: 6 }}>{F("kv", "Kv (m3/h/sqrt(bar)) *")}{F("size", "Size (e.g. DN80)")}</div>}
        {form.kind === "light" && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{F("powerW", "Power W *")}{F("dmxChannels", "DMX channels *")}{F("voltageV", "Voltage V")}{F("beamAngleDeg", "Beam angle °")}</div>}
        {F("notes", "Notes")}
        {errors.length > 0 && <div role="alert" style={{ color: "#ef4444", fontSize: 10 }}>{errors.map((e) => <div key={e}>• {e}</div>)}</div>}
        <div><button onClick={submit} style={{ background: "var(--accent)", color: "#04140a", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Save model ▶</button></div>
        {msg && <div role="status" style={{ fontSize: 10, color: "var(--text-muted)" }}>{msg}</div>}
      </div>
    </div>
  );
}
