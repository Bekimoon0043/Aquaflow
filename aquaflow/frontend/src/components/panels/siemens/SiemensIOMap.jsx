import { useCallback, useEffect, useState } from "react";
import { siemensRequest } from "../../../utils/siemensSite";
import { apiGet, apiPost } from "../../../utils/apiClient";
import {
  KIND_ICON, KIND_LABEL, downloadFrom, groupPoints, livePointValue, missingRequired, printHtml, wiringSheetHtml,
} from "../../../utils/siemensDevices";
import SiemensTerm from "./SiemensTerm";
import SiemensTagImport from "./SiemensTagImport";

const FIELD_OF_ROLE = {
  pump_speed: "output", pump_run: "enable_output", pump_running: "feedback_input", pump_fault: "fault_input",
  valve_open: "output", valve_feedback: "feedback_input", light_rgb: "output",
};
const PLACEHOLDER = { pump_speed: "%QW64", pump_run: "%Q0.0", pump_running: "%I0.5", pump_fault: "%I0.6", valve_open: "%Q0.1", valve_feedback: "%I1.0", light_rgb: "%QB200" };

function Live({ value }) {
  if (!value) return <span className="s7-live" title="No live data: verify the PLC connection"><span className="s7-live__dot" />—</span>;
  return <span className={`s7-live ${value.alarm ? "s7-live--alarm" : value.on ? "s7-live--on" : ""}`}><span className="s7-live__dot" />{value.text}</span>;
}

export default function SiemensIOMap({ site, onSaved, onOpenHardware }) {
  const [map, setMap] = useState(null);
  const [status, setStatus] = useState(null);
  const [edit, setEdit] = useState(null); // { [device_id|safety]: patch }
  const [message, setMessage] = useState({ text: "", tone: "" });
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const networked = site.mode === "plcsim" || site.mode === "physical";
  const load = useCallback(() => siemensRequest(`/${site.id}/io-map`).then(setMap).catch(e => setMessage({ text: e.message, tone: "bad" })), [site.id]);
  useEffect(() => { load(); setEdit(null); }, [load, site.revision]);
  useEffect(() => {
    let alive = true;
    const poll = () => siemensRequest(`/${site.id}/status`).then(s => alive && setStatus(s)).catch(() => alive && setStatus(null));
    poll();
    const timer = setInterval(poll, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [site.id]);
  const action = async (fn, pending) => {
    setBusy(true); setMessage({ text: pending || "Working…", tone: "" });
    try { const text = await fn(); setMessage({ text: text || "", tone: text ? "ok" : "" }); }
    catch (e) { setMessage({ text: e.message, tone: "bad" }); }
    finally { setBusy(false); }
  };
  const draftValue = (point) => {
    if (point.kind === "safety") return edit?.inputs?.[point.role] ?? point.address;
    return edit?.channels?.[point.device_id]?.[FIELD_OF_ROLE[point.role]] ?? point.address;
  };
  const setDraft = (point, value) => setEdit(e => {
    const next = { channels: { ...(e?.channels || {}) }, inputs: { ...(e?.inputs || {}) } };
    if (point.kind === "safety") next.inputs[point.role] = value.toUpperCase();
    else next.channels[point.device_id] = { ...(next.channels[point.device_id] || {}), [FIELD_OF_ROLE[point.role]]: value.toUpperCase() };
    return next;
  });
  const setPump = (valveId, pumpId) => setEdit(e => ({ inputs: { ...(e?.inputs || {}) }, channels: { ...(e?.channels || {}), [valveId]: { ...(e?.channels?.[valveId] || {}), pump_id: pumpId } } }));
  const save = () => action(async () => {
    const body = { ...site, inputs: { ...site.inputs, ...(edit?.inputs || {}) },
      channels: site.channels.map(c => ({ ...c, ...(edit?.channels?.[c.id] || {}) })) };
    const saved = await siemensRequest(`/${site.id}`, "PUT", body);
    setEdit(null); onSaved?.(saved);
    return "Wiring saved. Export the TIA package again so the PLC program matches.";
  }, "Saving wiring…");
  const testDevice = device => action(async () => {
    if (networked && !confirmed) throw new Error("Tick the safety confirmation first.");
    if (networked) {
      const safety = await apiGet("/safety/status");
      if (safety.state === "SAFE_IDLE") await apiPost("/safety/arm", {});
      else if (safety.state !== "ARMED") throw new Error(`AquaFlow master safety is ${safety.state}; resolve it first.`);
    }
    await siemensRequest(`/${site.id}/verify`, "POST");
    await siemensRequest(`/${site.id}/test-device`, "POST", { device_id: device.id, seconds: 3, flow_path_confirmed: confirmed });
    return device.kind === "light" ? `${device.name}: red → green → blue for 3 s. Watch the light.`
      : device.kind === "pump" ? `${device.name}: running at 10% through its first outlet for 3 s.` : `${device.name}: open for 3 s with its pump at 10%. Watch the nozzle.`;
  }, `Testing ${device.name}…`);
  if (!map) return <div className="s7-msg">{message.text || "Loading the I/O map…"}</div>;
  const groups = groupPoints(map.points);
  const pumps = site.channels.filter(c => c.kind === "pump");
  const missing = missingRequired(map.points);
  const offHardware = map.points.filter(p => p.address && p.note === "Address is not on the selected hardware");
  const dirty = Boolean(edit);
  return <div>
    <p>Each row is one wire: the device on the left, its <SiemensTerm k="tag">PLC tag</SiemensTerm> and <SiemensTerm k="address">address</SiemensTerm> on the right, and what the PLC reports right now. Click an address to change it.</p>
    <div className="s7-row" style={{ marginBottom: 8 }}>
      <button className="btn" onClick={() => printHtml(wiringSheetHtml(site, map.points, map.bom))}>Print wiring sheet</button>
      <button className="btn" disabled={busy} onClick={() => action(async () => { await downloadFrom(`/${site.id}/tag-table.xlsx`, `AquaFlow-${site.name.replace(/[^A-Za-z0-9]+/g, "-")}-PLC-Tags.xlsx`); return "Tag table saved to Downloads. In TIA: PLC tags → Show all tags → Import."; })}>Export TIA tag table (.xlsx)</button>
      {!site.hardware && onOpenHardware && <button className="btn" onClick={onOpenHardware}>Choose PLC hardware to assign addresses automatically</button>}
      <span className="s7-grow" />
      {dirty && <><button className="btn" onClick={() => setEdit(null)}>Discard</button><button className="btn primary" disabled={busy} onClick={save}>Save wiring</button></>}
    </div>
    {missing.length > 0 && <div className="s7-card s7-card--warn"><b>{missing.length} required signal(s) have no address yet.</b> {site.hardware ? "Add the module AquaFlow suggests in the Hardware step, or type an address." : "Choose the PLC hardware so AquaFlow can assign them."}</div>}
    {offHardware.length > 0 && <div className="s7-card s7-card--warn">{offHardware.length} address(es) are not on the selected hardware: {offHardware.map(p => `${p.plc_tag} ${p.address}`).join(", ")}.</div>}
    {map.bom?.length > 0 && <p>Hardware: {map.bom.map(b => b.item).join(" + ")}.</p>}
    {networked && <label className="s7-row" style={{ margin: "6px 0" }}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
      {site.mode === "plcsim" ? "This is the isolated PLCSIM simulator, not a physical PLC" : "A person is watching and every outlet has a safe water path"}</label>}
    {["pump", "valve", "light", "safety"].map(kind => groups[kind].length > 0 && <div key={kind} className="s7-map-group">
      <h4>{KIND_LABEL[kind]} ({groups[kind].length})</h4>
      {groups[kind].map(device => <div key={device.id} className="s7-device">
        <div className="s7-device__head">
          <div><span className="s7-device__icon" aria-hidden="true">{KIND_ICON[kind]}</span><span className="s7-device__name">{device.name}</span></div>
          <div className="s7-device__meta">
            {kind !== "safety" && <span className="s7-mono">{device.tag}</span>}
            {kind === "valve" && device.nozzleIds?.length > 0 && <div>feeds {device.nozzleIds.length} nozzle{device.nozzleIds.length > 1 ? "s" : ""}</div>}
            {kind === "valve" && <div>pump: <select aria-label={`${device.name} supplying pump`} value={edit?.channels?.[device.id]?.pump_id ?? device.pumpId} onChange={e => setPump(device.id, e.target.value)}>
              {pumps.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
            {kind === "safety" && device.fixtureId && <div>linked to the design</div>}
            {kind !== "safety" && !device.fixtureId && <div>added by AquaFlow</div>}
          </div>
          {kind !== "safety" && <button className="btn" style={{ marginTop: 6 }} disabled={busy || dirty || status?.running || (networked && !confirmed)}
            title={networked ? "Pulse this device on the PLC" : "Runs the internal preview only"} onClick={() => testDevice(device)}>Test</button>}
        </div>
        <div className="s7-signals">{device.points.map(point => {
          const value = draftValue(point);
          const wire = !value ? "none" : point.direction === "input" ? "in" : "out";
          return <div key={point.role} className="s7-signal">
            <div className="s7-signal__label">{point.label.split(" (")[0]}{!point.required && <small>optional</small>}<small className="s7-signal__tag">{point.plc_tag}</small></div>
            <div className={`s7-signal__wire s7-signal__wire--${wire}`} title={point.direction === "input" ? "PLC input" : "PLC output"} />
            <div className="s7-signal__addr">
              <input className="s7-input s7-mono" style={{ width: 92 }} aria-label={`${point.plc_tag} address`} placeholder={point.kind === "safety" ? "%I0.0" : PLACEHOLDER[point.role]}
                value={value} onChange={e => setDraft(point, e.target.value)} />
              <small>{point.data_type}{point.direction === "input" ? " input" : " output"}</small>
            </div>
            <div className="s7-signal__addr"><small>{point.module ? `${point.module}${point.module_channel != null ? ` · channel ${point.module_channel}` : ""}` : point.note || (value ? "" : "not wired")}</small>{point.db_address && <small title="Where AquaFlow writes/reads this in the PLC data block">{point.db_address}</small>}</div>
            <Live value={livePointValue(point, status)} />
          </div>;
        })}</div>
      </div>)}
    </div>)}
    {message.text && <div className={`s7-msg ${message.tone === "ok" ? "s7-msg--ok" : message.tone === "bad" ? "s7-msg--bad" : ""}`} role="status">{message.text}</div>}
    <details className="s7-card"><summary style={{ cursor: "pointer", fontWeight: 600 }}>Import an existing TIA tag table (site already has a PLC program)</summary>
      <SiemensTagImport site={site} onSaved={saved => { onSaved?.(saved); load(); }} />
    </details>
  </div>;
}
