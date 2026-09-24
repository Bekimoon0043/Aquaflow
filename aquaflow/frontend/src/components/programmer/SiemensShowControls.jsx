import { useEffect, useState } from "react";
import { siemensRequest, programmerSiemensClips } from "../../utils/siemensSite";

export default function SiemensShowControls({ clips, onLoadExample, selectedSite, configurationPending = false }) {
  const [sites, setSites] = useState([]);
  const [sid, setSid] = useState(selectedSite?.id || "");
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [valveId, setValveId] = useState("");
  const site = selectedSite || sites.find(s => s.id === sid);
  const id = site?.id || sid;
  useEffect(() => {
    let alive = true;
    if (!selectedSite) siemensRequest().then(r => { if (alive) setSites(r.sites); }).catch(e => { if (alive) setMessage(e.message); });
    return () => { alive = false; };
  }, [selectedSite]);
  useEffect(() => {
    setConfirmed(false); setStatus(null); setValveId("");
    if (!id) return undefined;
    let alive = true;
    const poll = () => siemensRequest(`/${id}/status`).then(r => { if (alive) setStatus(r); }).catch(e => { if (alive) setMessage(e.message); });
    poll();
    const timer = setInterval(poll, 500);
    return () => { alive = false; clearInterval(timer); };
  }, [id, site?.revision]);
  const action = async (label, fn) => {
    setBusy(true); setMessage("");
    try { const result = await fn(); setMessage(result?.message || `${label} completed`); }
    catch (e) { setMessage(e.message); }
    finally { setBusy(false); }
  };
  const button = (label, fn, disabled = false) => <button className="btn" type="button" disabled={disabled || busy || !id || configurationPending} onClick={() => action(label, fn)}>{label}</button>;
  if (!selectedSite && !sites.length && !message) return null;
  return <section style={{ padding: 12, background: "#101e2a", color: "#d3e7ef", fontSize: 12, border: "1px solid #284454", borderRadius: 6 }}>
    <strong>Siemens show output {site ? `— ${site.mode === "simulated" ? "SIMULATED" : "PHYSICAL PLC"}` : ""}</strong>
    {!selectedSite && <div style={{ margin: "8px 0" }}>
      <select className="select" aria-label="Siemens show site" value={sid} onChange={e => setSid(e.target.value)}>
        <option value="">Choose a saved Siemens site</option>
        {sites.map(s => <option key={s.id} value={s.id}>{s.name} ({s.mode})</option>)}
      </select>
      <button className="btn" onClick={() => action("Reload sites", async () => setSites((await siemensRequest()).sites))}>Reload sites</button>
    </div>}
    <p>Use pump Speed, valve Open, and light Intensity/Red/Green/Blue tracks. TIA Portal may be closed after the matching PLC program is commissioned.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {button("Verify", () => siemensRequest(`/${id}/verify`, "POST"), status?.running)}
      {site?.mode === "physical" && button("Identify CPU", async () => {
        const result = await siemensRequest(`/${id}/identify`, "POST");
        const identity = result.identity || {};
        const known = identity.order_number || identity.module_name;
        if (known) {
          return { message: `CPU: ${known} ${identity.firmware_version || ""}${identity.plc_name ? ` · station ${identity.plc_name}` : ""}`.trim() };
        }
        // No identity: say how far the exchange got and exactly why it stopped, so the
        // operator can tell "simulator does not serve SZL" from "wrong address".
        const why = [result.reason, ...(result.warnings || [])].filter(Boolean).join(" · ");
        return { message: `CPU identity unavailable (stage ${result.stage || "none"}${result.pdu_size ? `, PDU ${result.pdu_size}` : ""}). ${why} — Verify does not need the identity; leave expected order number/firmware blank.` };
      }, status?.running)}
      {site?.mode === "physical" && button("Reconnect safely", () => siemensRequest(`/${id}/reconnect`, "POST"), status?.running)}
      {button("Arm", () => siemensRequest(`/${id}/arm`, "POST", { flow_path_confirmed: confirmed }), status?.running || (site?.mode === "physical" && !confirmed))}
      {button("Compile current clips", () => siemensRequest(`/${id}/compile`, "POST", { revision: site.revision, clips }), !clips?.length || status?.running)}
      {onLoadExample && button("Load 60-second example", async () => {
        const response = await siemensRequest(`/${id}/example`);
        if (!clips?.length || window.confirm("Replace the current timeline with the Siemens example?")) onLoadExample(programmerSiemensClips(response.clips));
      }, status?.running)}
      {button("Compile 60-second example", async () => {
        const example = await siemensRequest(`/${id}/example`);
        await siemensRequest(`/${id}/compile`, "POST", { revision: site.revision, clips: example.clips });
      }, status?.running)}
      {button(site?.mode === "physical" ? "Start PLC show" : "Start simulation", () => siemensRequest(`/${id}/start`, "POST"), !status?.armed || status?.running)}
      <button className="btn" type="button" disabled={!id} style={{ background: "#942b36", color: "white" }} onClick={() => action("Stop", () => siemensRequest(`/${id}/stop`, "POST"))}>STOP / Disarm</button>
    </div>
    {site?.mode === "physical" && <p><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> Site staff confirmed a safe water flow path and readiness to enable outputs</label></p>}
    {site && <div style={{ marginTop: 10 }}>
      <select className="select" aria-label="Commissioning outlet" value={valveId} onChange={e => setValveId(e.target.value)}>
        <option value="">Choose one outlet to identify</option>
        {site.channels.filter(c => c.kind === "valve").map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {button("Test outlet · 3s / 10%", () => siemensRequest(`/${id}/test-outlet`, "POST", { valve_id: valveId, seconds: 3, flow_path_confirmed: confirmed }), !valveId || status?.running || (site.mode === "physical" && !confirmed))}
      <div>Runs only the chosen valve and its supplying pump, then disarms. Physical testing requires verification, mapped outputs and safety permits. Ten percent may be below the drive's usable speed.</div>
    </div>}
    {status && <div aria-live="polite" style={{ marginTop: 10 }}>
      {status.quality} · {status.running ? "RUNNING" : "IDLE"} · {status.armed ? "ARMED" : "DISARMED"} · {(status.elapsed || 0).toFixed(1)}s
      <div>Verification: {status.verified ? (status.hardware_verified ? "PLC contract verified" : "simulation only") : "required"}. Stop: {status.stop_confirmed ? "OFF command acknowledged" : "unconfirmed"}</div>
      <div>Connection: {status.connection_state || "not connected"} · Contract v{status.contract_version || "?"} · Fault: {status.fault || "none"}</div>
      {Object.entries(status.values || {}).map(([cid, value]) => <div key={cid}>Commanded {site?.channels.find(c => c.id === cid)?.name || cid}: {typeof value === "number" ? `${value.toFixed(1)}%` : `RGB ${value.red}/${value.green}/${value.blue}`}</div>)}
      {Object.entries(status.feedback || {}).map(([cid, value]) => <div key={`fb-${cid}`}>Feedback {site?.channels.find(c => c.id === cid)?.name || cid}: {value.kind === "pump" ? `${value.running ? "RUNNING" : "STOPPED"}, ${value.applied_percent.toFixed(1)}%${value.fault ? ", FAULT" : ""}` : value.kind === "valve" ? (value.open ? "OPEN" : "CLOSED") : `RGB ${value.rgb.join("/")}`} ({value.source})</div>)}
      {status.error && <div role="alert" style={{ color: "#ff919a" }}>{status.error}</div>}
    </div>}
    {message && <p role="status" style={{ color: "#f6d795" }}>{message}</p>}
  </section>;
}
