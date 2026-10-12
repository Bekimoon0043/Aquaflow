import { useState } from "react";
import { siemensRequest } from "../../../utils/siemensSite";
import { fileToBase64 } from "../../../utils/siemensDevices";

const ROLE_TEXT = {
  pump_speed: "Pump speed", pump_run: "Pump run", pump_running: "Pump running feedback", pump_fault: "Pump fault",
  valve_open: "Valve open", valve_feedback: "Valve feedback", light_rgb: "Light colour", safety: "Safety input",
};
const SAFETY_TEXT = { estop_ok: "Emergency stop OK", level_ok: "Water level OK", thermal_ok: "Thermal OK", drive_ok: "Drive OK", pressure_ok: "Pressure OK" };

export function targetOptions(site, row) {
  if (row.role === "safety") return Object.entries(SAFETY_TEXT).map(([key, label]) => [`safety:${key}`, label]);
  const kind = row.role.startsWith("pump") ? "pump" : row.role.startsWith("valve") ? "valve" : row.role === "light_rgb" ? "light" : "";
  return site.channels.filter(c => c.kind === kind).map(c => [c.id, `${c.tag || ""} ${c.name}`.trim()]);
}

export default function SiemensTagImport({ site, onSaved }) {
  const [rows, setRows] = useState(null);
  const [summary, setSummary] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const read = async file => {
    if (!file) return;
    setBusy(true); setMessage("Reading the tag table…");
    try {
      const result = await siemensRequest(`/${site.id}/tag-table/recognize`, "POST", { filename: file.name, data_base64: await fileToBase64(file) });
      setRows(result.suggestions); setSummary(result.summary);
      setMessage(`${result.summary.recognised} of ${result.summary.tags} tags recognised; ${result.summary.auto_accepted} ticked automatically. Check every ticked row before applying.`);
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  const patch = (index, change) => setRows(list => list.map((row, i) => i === index ? { ...row, ...change } : row));
  const apply = async () => {
    const accepted = rows.filter(r => r.accepted && r.target && r.role);
    if (!accepted.length) { setMessage("Tick at least one recognised tag."); return; }
    setBusy(true);
    try {
      const result = await siemensRequest(`/${site.id}/tag-table/apply`, "POST", { revision: site.revision, accepted });
      onSaved?.(result.site); setRows(null);
      setMessage(`${result.applied} tag(s) linked to devices. The PLC program must be exported again.`);
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  return <div>
    <p>In TIA Portal open <b>PLC tags → Show all tags</b>, click <b>Export</b>, then choose that .xlsx here (a CSV with Name, Data Type, Logical Address and Comment columns also works). AquaFlow reads the names and comments, guesses which pump, valve, light or safety input each tag belongs to and explains why. Nothing changes until you press Apply.</p>
    <input type="file" accept=".xlsx,.csv,.txt" disabled={busy} onChange={e => read(e.target.files?.[0])} />
    {rows && <div style={{ overflowX: "auto", marginTop: 10 }}><table className="s7-table">
      <thead><tr><th>Use</th><th>Tag</th><th>Address</th><th>Recognised as</th><th>Device</th><th>Why</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.name}-${index}`} style={{ opacity: row.role ? 1 : .55 }}>
        <td><input type="checkbox" aria-label={`Use ${row.name}`} disabled={!row.role || !row.target} checked={Boolean(row.accepted)} onChange={e => patch(index, { accepted: e.target.checked })} /></td>
        <td className="s7-mono">{row.name}{row.comment && <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-body)" }}>{row.comment}</div>}</td>
        <td className="s7-mono">{row.address}</td>
        <td>{row.role ? `${ROLE_TEXT[row.role]}${row.colour ? ` (${row.colour})` : ""}` : "—"}{row.role && <div><span className={`s7-badge ${row.confidence >= .8 ? "s7-badge--ok" : row.confidence >= .6 ? "s7-badge--warn" : "s7-badge--bad"}`}>{Math.round(row.confidence * 100)}%</span></div>}</td>
        <td>{row.role ? <select aria-label={`${row.name} device`} value={row.target} onChange={e => patch(index, { target: e.target.value, accepted: Boolean(e.target.value) })}>
          <option value="">Not used</option>{targetOptions(site, row).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : ""}</td>
        <td style={{ color: "var(--text-muted)" }}>{row.reason}</td>
      </tr>)}</tbody>
    </table>
    <div className="s7-row" style={{ marginTop: 8 }}>
      <button className="btn primary" disabled={busy} onClick={apply}>Apply ticked tags ({rows.filter(r => r.accepted && r.target).length})</button>
      <button className="btn" onClick={() => setRows(null)}>Cancel</button>
      {summary && <span>{summary.matched} matched to a device</span>}
    </div></div>}
    {message && <div className="s7-msg">{message}</div>}
  </div>;
}
