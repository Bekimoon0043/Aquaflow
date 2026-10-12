import React, { useEffect, useState } from "react";
import { siemensRequest, programmerSiemensClips } from "../../utils/siemensSite";
import { explainS7Error } from "../../utils/siemensDevices";
import { apiGet, apiPost } from "../../utils/apiClient";
import useProjectStore from "../../store/projectStore";
import "./siemensShowControls.css";

export function SiemensLinkStatus({ status, mode }) {
  const simulated = mode === "simulated";
  const age = status?.last_rx_age_seconds;
  const fault = status?.connection_state === "lost" || status?.connection_state === "failed" || status?.connection_state === "stop_unconfirmed" || Boolean(status?.error);
  const recent = !simulated && !fault && status?.hardware_verified && status?.telemetry_fresh && typeof age === "number" && age <= 2;
  const label = simulated ? "Internal AquaFlow preview only" : fault ? "Communication fault" : recent ? "PLC responding" : status?.hardware_verified ? "Verified · idle" : "PLC not verified";
  return <div className={`siemens-link ${recent ? "siemens-link--active" : ""} ${fault ? "siemens-link--fault" : ""}`} aria-label={`Siemens connection: ${label}`}>
    <div className="siemens-link__path" aria-hidden="true">
      <span className="siemens-link__node">AquaFlow</span>
      <span className="siemens-link__wire"><span className="siemens-link__packet" /></span>
      <span className="siemens-link__node">S7-1200</span>
    </div>
    <div className="siemens-link__details">
      <strong>{label}</strong>
      <span>{simulated ? "No S7 traffic · TIA/PLCSIM DB100 will not change" : recent ? `Last reply ${age.toFixed(1)}s ago` : status?.hardware_verified && age != null ? `No recent PLC traffic · last reply ${age.toFixed(1)}s ago` : "Verify to check the PLC contract"}</span>
      {status?.contract_version && <span>Contract v{status.contract_version}</span>}
    </div>
  </div>;
}

export function compileMessage(result) {
  const base = `Compiled ${result?.clips?.length || 0} PLC commands (${Number(result?.duration || 0).toFixed(1)} s).`;
  const t = result?.translation;
  if (!t) return base;
  const parts = [];
  if (t.nozzle_clips) parts.push(`${t.nozzle_clips} nozzle clip(s) became valve open/close commands`);
  if (t.auto_pumps?.length) parts.push(`${t.auto_pumps.map(p => `${p.pump} runs at ${p.percent}% while its nozzles play`).join("; ")}`);
  if (t.stretched) parts.push(`${t.stretched} short pulse(s) lengthened to the valve minimum on-time`);
  if (t.merged) parts.push(`${t.merged} tiny gap(s) closed for the valve minimum off-time`);
  if (t.capped) parts.push(`${t.capped} pump value(s) capped at the speed ceiling`);
  if (t.ignored) parts.push(`${t.ignored} clip(s) on devices the PLC does not drive were skipped`);
  return parts.length ? `${base} ${parts.join(". ")}.` : base;
}

export default function SiemensShowControls({ clips, onLoadExample, selectedSite, configurationPending = false, onCompiled }) {
  const [sites, setSites] = useState([]);
  const rememberedSiteId = useProjectStore(state => state.integrations?.siemensSiteId);
  const [sid, setSid] = useState(selectedSite?.id || rememberedSiteId || "");
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [valveId, setValveId] = useState("");
  const site = selectedSite || sites.find(s => s.id === sid);
  const id = site?.id || sid;
  const networked = site?.mode === "physical" || site?.mode === "plcsim";
  useEffect(() => {
    let alive = true;
    if (!selectedSite) siemensRequest().then(r => { if (alive) setSites(r.sites); }).catch(e => { if (alive) setMessage(e.message); });
    return () => { alive = false; };
  }, [selectedSite]);
  useEffect(() => {
    setConfirmed(false); setStatus(null); setValveId("");
    if (!id) return undefined;
    let alive = true;
    const poll = () => siemensRequest(`/${id}/status`).then(r => { if (alive) setStatus(r); }).catch(e => { if (alive) { setStatus(null); setMessage(e.message); } });
    poll();
    const timer = setInterval(poll, 500);
    return () => { alive = false; clearInterval(timer); };
  }, [id, site?.revision]);
  const action = async (label, fn) => {
    setBusy(true); setMessage("");
    try { const result = await fn(); setMessage(result?.message || `${label} completed`); }
    catch (e) { const hint = explainS7Error(e.message, site); setMessage(hint ? `${hint}  (Details: ${e.message})` : e.message); }
    finally { setBusy(false); }
  };
  const prepareAndArm = async () => {
    const safety = await apiGet("/safety/status");
    let armedHere = false;
    if (safety.state === "SAFE_IDLE") {
      await apiPost("/safety/arm", {});
      armedHere = true;
    } else if (safety.state !== "ARMED") {
      throw new Error(`AquaFlow master safety is ${safety.state}; resolve that state before arming this site.`);
    }
    try {
      return await siemensRequest(`/${id}/arm`, "POST", { flow_path_confirmed: confirmed });
    } catch (error) {
      if (armedHere) await apiPost("/safety/disarm", {}).catch(() => {});
      throw error;
    }
  };
  const stopAndDisarm = async () => {
    const result = await siemensRequest(`/${id}/stop`, "POST");
    await apiPost("/safety/disarm", {});
    return { message: result.stop_confirmed ? "OFF acknowledged; PLC stopped and AquaFlow returned to SAFE_IDLE." : "STOP UNCONFIRMED — check the PLC and field equipment." };
  };
  const button = (label, fn, disabled = false) => <button className="btn" type="button" disabled={disabled || busy || !id || configurationPending} onClick={() => action(label, fn)}>{label}</button>;
  if (!selectedSite && !sites.length && !message) return null;
  return <section className="siemens-runtime">
    <div className="siemens-runtime__heading"><div><strong>PLC connection &amp; show</strong><span>{site?.name || "Choose a site"}</span></div><span className={`siemens-runtime__mode ${networked ? "siemens-runtime__mode--physical" : ""}`}>{site?.mode === "physical" ? "PHYSICAL PLC NETWORK" : site?.mode === "plcsim" ? "PLCSIM NETWORK · DB WRITES" : "INTERNAL PREVIEW · NO PLC"}</span></div>
    {!selectedSite && <div style={{ margin: "8px 0" }}>
      <select className="select" aria-label="Siemens show site" value={sid} onChange={e => setSid(e.target.value)}>
        <option value="">Choose a saved Siemens site</option>
        {sites.map(s => <option key={s.id} value={s.id}>{s.name} ({s.mode})</option>)}
      </select>
      <button className="btn" onClick={() => action("Reload sites", async () => setSites((await siemensRequest()).sites))}>Reload sites</button>
    </div>}
    <SiemensLinkStatus status={status} mode={site?.mode} />
    {site?.mode === "simulated" && <div role="alert" style={{ margin: "8px 0", padding: 8, border: "1px solid #b98539", color: "#ffe0a3", background: "rgba(185,133,57,.12)" }}>
      This mode animates AquaFlow only. It never writes DB100. To monitor changing values in TIA Portal, switch the saved site to PLCSIM network mode, start NetToPLCsim, then Verify and Prepare &amp; Arm.
    </div>}
    {!site?.show?.clips?.length && <div role="alert" style={{ margin: "8px 0", color: "#ffb4b4" }}>No compiled show is saved for this revision (saving any setting clears it on purpose). {site?.previous_show_clips?.length ? "Recompile the previous show below, or compile the current timeline." : "Compile the example or the current timeline before starting."}
      {site?.previous_show_clips?.length > 0 && <div style={{ marginTop: 6 }}>{button(`Recompile previous show (${site.previous_show_clips.length} commands)`, async () => {
        const result = await siemensRequest(`/${id}/compile`, "POST", { revision: site.revision, clips: site.previous_show_clips });
        if (!selectedSite) setSites((await siemensRequest()).sites);
        onCompiled?.();
        return { message: `${compileMessage(result)} Now Verify, Prepare & Arm, then Start.` };
      }, status?.running)}</div>}
    </div>}
    <div className="siemens-runtime__state">
      <span>{status?.running ? "Show running" : status?.armed ? "Armed" : "Stopped"}</span>
      <span>{!status?.verified ? "Verification required" : status.stop_confirmed ? "OFF acknowledged" : "Stop not confirmed"}</span>
      {status?.running && <span>{(status.elapsed || 0).toFixed(1)}s</span>}
      {status?.fault && <span className="siemens-runtime__error">{status.fault}</span>}
    </div>
    <div className="siemens-runtime__actions">
      {button("Verify", () => siemensRequest(`/${id}/verify`, "POST"), status?.running)}
      {button("Prepare & Arm", prepareAndArm, status?.running || (networked && !confirmed))}
      {button(networked ? (site?.mode === "plcsim" ? "Start PLCSIM show" : "Start physical PLC show") : "Run AquaFlow preview (no PLC)", async () => {
        const result = await siemensRequest(`/${id}/start`, "POST");
        return { message: result.running
          ? networked ? `${site?.mode === "plcsim" ? "PLCSIM" : "PLC"} playback started; monitor acknowledgement and feedback.` : "AquaFlow-only playback started. No S7 writes are sent; TIA/PLCSIM DB100 will not change."
          : "Start did not enter playback; check the saved show and runtime status." };
      }, !status?.armed || status?.running || !site?.show?.clips?.length)}
      <button className="btn siemens-runtime__stop" type="button" disabled={!id} onClick={() => action("Stop", stopAndDisarm)}>STOP / Disarm</button>
    </div>
    {networked && <label className="siemens-runtime__confirmation"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> {site?.mode === "plcsim" ? "I confirm this target is the isolated PLCSIM bridge, not a physical PLC" : "Site staff confirmed a safe water flow path and readiness to enable outputs"}</label>}
    <details className="siemens-runtime__more"><summary>Pattern tools and commissioning test</summary><div className="siemens-runtime__actions">
      {networked && button("Identify CPU", async () => {
        const result = await siemensRequest(`/${id}/identify`, "POST");
        const identity = result.identity || {};
        const known = identity.order_number || identity.module_name;
        if (known) {
          const generation = result.cpu_generation;
          return { message: `CPU: ${known} ${identity.firmware_version || ""}${identity.plc_name ? ` · station ${identity.plc_name}` : ""}${generation ? ` — ${generation.message}` : ""}`.trim() };
        }
        // No identity: say how far the exchange got and exactly why it stopped, so the
        // operator can tell "simulator does not serve SZL" from "wrong address".
        const why = [result.reason, ...(result.warnings || [])].filter(Boolean).join(" · ");
        return { message: `CPU identity unavailable (stage ${result.stage || "none"}${result.pdu_size ? `, PDU ${result.pdu_size}` : ""}). ${why} — Verify does not need the identity; leave expected order number/firmware blank.` };
      }, status?.running)}
      {networked && button("Reconnect safely", () => siemensRequest(`/${id}/reconnect`, "POST"), status?.running)}
      {button("Compile current clips", async () => {
        const result = await siemensRequest(`/${id}/compile`, "POST", { revision: site.revision, clips, translate: site?.source?.kind === "engineering" });
        if (!selectedSite) setSites((await siemensRequest()).sites);
        return { message: compileMessage(result) };
      }, !clips?.length || status?.running)}
      {onLoadExample && button("Load 60-second example", async () => {
        const response = await siemensRequest(`/${id}/example`);
        if (!clips?.length || window.confirm("Replace the current timeline with the Siemens example?")) onLoadExample(programmerSiemensClips(response.clips));
      }, status?.running)}
      {button("Compile 60-second example", async () => {
        const example = await siemensRequest(`/${id}/example`);
        await siemensRequest(`/${id}/compile`, "POST", { revision: site.revision, clips: example.clips });
      }, status?.running)}
    </div>
    {site && <div style={{ marginTop: 10 }}>
      <select className="select" aria-label="Commissioning outlet" value={valveId} onChange={e => setValveId(e.target.value)}>
        <option value="">Choose one device to identify</option>
        {["valve", "pump", "light"].map(kind => <optgroup key={kind} label={kind === "valve" ? "Valves" : kind === "pump" ? "Pumps" : "Lights"}>
          {site.channels.filter(c => c.kind === kind).map(c => <option key={c.id} value={c.id}>{c.tag ? `${c.tag} · ` : ""}{c.name}</option>)}
        </optgroup>)}
      </select>
      {button("Test device · 3s", () => siemensRequest(`/${id}/test-device`, "POST", { device_id: valveId, seconds: 3, flow_path_confirmed: confirmed }), !valveId || status?.running || (networked && !confirmed))}
      <small>A valve opens with its pump at 10%; a pump runs at 10% through its first outlet; a light cycles red, green, blue. Then everything returns to OFF. Ten percent may be below the drive's usable speed.</small>
    </div>}
    </details>
    {status && <details className="siemens-runtime__more"><summary>PLC feedback and diagnostics</summary><div style={{ marginTop: 10 }}>
      {status.quality} · {status.running ? "RUNNING" : "IDLE"} · {status.armed ? "ARMED" : "DISARMED"} · {(status.elapsed || 0).toFixed(1)}s
      {status.plc_running && !status.running && <div role="alert" style={{ color: "#ff919a" }}>Last PLC status reported RUN while AquaFlow playback is stopped. Check the PLC and field equipment.</div>}
      <div>Verification: {status.verified ? (status.hardware_verified ? "PLC contract verified" : "simulation only") : "required"}. Stop: {status.stop_confirmed ? "OFF acknowledged; PLC reports stopped" : "unconfirmed — check PLC state"}</div>
      {networked && status.verified && !status.telemetry_fresh && <div style={{ color: "#f6d795" }}>Idle PLC readings are {status.last_rx_age_seconds ?? "?"} seconds old. Arm will recheck the heartbeat and local permit.</div>}
      <div>Connection: {status.connection_state || "not connected"} · Contract v{status.contract_version || "?"} · Fault: {status.fault || "none"}</div>
      {Object.entries(status.values || {}).map(([cid, value]) => <div key={cid}>Commanded {site?.channels.find(c => c.id === cid)?.name || cid}: {typeof value === "number" ? `${value.toFixed(1)}%` : `RGB ${value.red}/${value.green}/${value.blue}`}</div>)}
      {!status.feedback_valid && status.feedback && Object.keys(status.feedback).length > 0 && <div role="alert" style={{ color: "#ff919a" }}>PLC feedback is stale; reconnect and verify before relying on it.</div>}
      {status.feedback_valid && Object.entries(status.feedback || {}).map(([cid, value]) => <div key={`fb-${cid}`}>Feedback {site?.channels.find(c => c.id === cid)?.name || cid}: {value.kind === "pump" ? `${value.running ? "RUNNING" : "STOPPED"}, ${value.applied_percent.toFixed(1)}%${value.fault ? ", FAULT" : ""}` : value.kind === "valve" ? (value.open ? "OPEN" : "CLOSED") : `RGB ${value.rgb.join("/")}`} ({value.source})</div>)}
      {status.error && <div role="alert" style={{ color: "#ff919a" }}>{status.error}</div>}
    </div></details>}
    {message && <p role="status" style={{ color: "#f6d795" }}>{message}</p>}
  </section>;
}
