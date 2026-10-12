import { useEffect, useMemo, useState } from "react";
import useEngineeringStore from "../../../store/engineeringStore";
import useProjectStore from "../../../store/projectStore";
import { siemensRequest, siemensPackageName } from "../../../utils/siemensSite";
import { WIZARD_STEPS, addressOnThisPc, designSummary, downloadFrom, engineeringDevices, explainS7Error, wizardProgress } from "../../../utils/siemensDevices";
import { apiGet } from "../../../utils/apiClient";
import SiemensShowControls from "../../programmer/SiemensShowControls";
import SiemensTerm from "./SiemensTerm";
import SiemensHardwarePicker from "./SiemensHardwarePicker";
import SiemensIOMap from "./SiemensIOMap";
import SiemensAcceptance from "./SiemensAcceptance";
import SiemensPlcMonitor from "./SiemensPlcMonitor";
import "./siemensSetup.css";

function Message({ value }) {
  if (!value?.text) return null;
  return <div role="status" className={`s7-msg ${value.tone === "ok" ? "s7-msg--ok" : value.tone === "bad" ? "s7-msg--bad" : ""}`}>{value.text}</div>;
}

export default function SiemensSetupWizard({ onOpenAdvanced }) {
  const fixtures = useEngineeringStore(s => s.fixtures);
  const projectName = useEngineeringStore(s => s.projectName);
  const projectId = useEngineeringStore(s => s.projectId);
  const rememberedSiteId = useProjectStore(s => s.integrations.siemensSiteId);
  const updateIntegrations = useProjectStore(s => s.updateIntegrations);
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState(rememberedSiteId || "");
  const [step, setStep] = useState("design");
  const [status, setStatus] = useState(null);
  const [acceptance, setAcceptance] = useState(null);
  const [designReport, setDesignReport] = useState(null);
  const [message, setMessage] = useState({ text: "", tone: "" });
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState({ max_percent: 40, show_percent: 30 });
  const [pendingMode, setPendingMode] = useState(null);
  const [previewChosen, setPreviewChosen] = useState(false);
  const site = sites.find(s => s.id === siteId) || null;
  const summary = useMemo(() => designSummary(fixtures), [fixtures]);
  const progress = wizardProgress(site, { acceptance: acceptance?.site_revision === site?.revision ? acceptance : null, status });
  const reload = async () => { const result = await siemensRequest(); setSites(result.sites); return result.sites; };
  useEffect(() => { reload().catch(e => setMessage({ text: e.message, tone: "bad" })); }, []);
  useEffect(() => { if (rememberedSiteId && rememberedSiteId !== siteId) setSiteId(rememberedSiteId); }, [rememberedSiteId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setStatus(null); setAcceptance(null);
    if (!siteId) return undefined;
    let alive = true;
    const poll = () => siemensRequest(`/${siteId}/status`).then(s => alive && setStatus(s)).catch(() => alive && setStatus(null));
    poll();
    const timer = setInterval(poll, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [siteId]);
  const choose = id => { setPendingMode(null); setPreviewChosen(false); setSiteId(id); updateIntegrations({ siemensSiteId: id || null }); setDesignReport(null); setMessage({ text: "", tone: "" }); };
  const saved = updated => setSites(list => list.map(s => s.id === updated.id ? updated : s));
  const action = async (fn, pending) => {
    setBusy(true); setMessage({ text: pending || "Working…", tone: "" });
    try { const text = await fn(); setMessage({ text: text || "", tone: "ok" }); }
    catch (e) { setMessage({ text: e.message, tone: "bad" }); }
    finally { setBusy(false); }
  };
  const devices = () => engineeringDevices(fixtures);
  const createFromDesign = () => action(async () => {
    const result = await siemensRequest("/from-design", "POST", { name: projectName || "Fountain", project_id: projectId || "", devices: devices(), options });
    await reload(); choose(result.site.id); setDesignReport({ ...result.design, assignment: result.assignment });
    return `Created "${result.site.name}": ${result.design.counts.pumps} pump(s), ${result.design.counts.valves} valve(s) for ${result.design.counts.nozzles} nozzle(s), ${result.design.counts.lights} light(s). ${result.assignment.complete ? "Every signal has an address on the default CPU 1215C." : "Choose the hardware next: not everything fits yet."}`;
  }, "Reading your design…");
  const syncDesign = () => action(async () => {
    const result = await siemensRequest(`/${site.id}/sync-design`, "POST", { revision: site.revision, devices: devices(), options });
    saved(result.site); setDesignReport(result.design);
    const { added, removed } = result.design;
    return `${added.length} device(s) added, ${removed.length} removed, existing wiring kept.${result.design.program_changed ? " The PLC program changed: assign addresses for new devices, then export the TIA package again." : ""}`;
  }, "Comparing with your design…");
  const saveConnection = patch => action(async () => {
    const body = { ...site, ...patch, plc: { ...site.plc, ...(patch.plc || {}) } };
    const updated = await siemensRequest(`/${site.id}`, "PUT", body);
    saved(updated); setPendingMode(null);
    return "Connection settings saved.";
  }, "Saving…");
  const verify = () => action(async () => {
    let result;
    try { result = await siemensRequest(`/${site.id}/verify`, "POST"); }
    catch (e) { const hint = explainS7Error(e.message, site); throw new Error(hint ? `${hint}  (Details: ${e.message})` : e.message); }
    setStatus(result);
    return site.mode === "simulated" ? "Internal preview verified (no PLC is contacted in this mode)." : `PLC answered: AquaFlow program contract v${result.contract_version} matches this site, and the heartbeat is moving.`;
  }, "Contacting the PLC…");
  const compile = async (clips, label) => {
    const result = await siemensRequest(`/${site.id}/compile`, "POST", { revision: site.revision, clips, translate: site.source?.kind === "engineering" });
    await reload();
    return `${label} compiled: ${result.clips.length} PLC commands, ${Number(result.duration).toFixed(1)} s. You can now Prepare & Arm, then Start.`;
  };
  const index = WIZARD_STEPS.findIndex(s => s.key === step);
  const fromDesign = site?.source?.kind === "engineering";
  const networked = site?.mode === "plcsim" || site?.mode === "physical";
  const connectMode = pendingMode || (site?.mode === "simulated" && step === "connect" && !previewChosen ? "plcsim" : site?.mode);
  return <div className="s7">
    <h3>Siemens PLC setup</h3>
    <p>From your fountain design to a running Siemens PLC, one step at a time. Underlined words explain themselves when you point at them.</p>
    <div className="s7-row">
      <select aria-label="Siemens site" value={siteId} onChange={e => choose(e.target.value)}>
        <option value="">{sites.length ? "Choose a Siemens site…" : "No Siemens site yet"}</option>
        {sites.map(s => <option key={s.id} value={s.id}>{s.name} · {s.mode === "plcsim" ? "PLCSIM" : s.mode === "physical" ? "physical PLC" : "preview"} · rev {s.revision}</option>)}
      </select>
      <button className="btn" disabled={busy || !fixtures.length} onClick={createFromDesign} title={fixtures.length ? "" : "Open or draw a design in Engineering first"}>+ New site from my design</button>
      {onOpenAdvanced && <button className="btn" onClick={onOpenAdvanced}>Advanced site settings</button>}
    </div>
    <nav className="s7-steps" aria-label="Setup steps">{WIZARD_STEPS.map((s, i) => <button key={s.key} type="button" disabled={!site && s.key !== "design"}
      className={`s7-step ${step === s.key ? "s7-step--active" : ""} ${progress[s.key] ? "s7-step--done" : ""}`} aria-current={step === s.key ? "step" : undefined} onClick={() => setStep(s.key)}>
      <b><span className="s7-step__dot" />{i + 1}. {s.label}</b><small>{s.hint}</small></button>)}</nav>
    <Message value={message} />

    {step === "design" && <div>
      <div className="s7-card">
        <b>Your design{projectName ? ` — ${projectName}` : ""}</b>
        <p>{summary.pumps} pump(s) · {summary.valves} valve(s) · {summary.nozzles} nozzle(s) · {summary.lights} light(s) · {summary.safety} safety item(s){summary.other ? ` · ${summary.other} other item(s)` : ""}</p>
        <p>AquaFlow turns these into PLC devices. Nozzles are switched by solenoid valves: a nozzle uses the valve you linked or placed nearest, otherwise AquaFlow gives it its own valve. Each valve is fed by its nearest pump unless you choose another one in the Wiring step. Your layout is never replaced.</p>
        <div className="s7-row">
          <label>Pump speed ceiling <input className="s7-input" type="number" min="1" max="100" style={{ width: 60 }} value={options.max_percent} onChange={e => setOptions(o => ({ ...o, max_percent: Number(e.target.value) }))} />%</label>
          <label>Pump speed during shows <input className="s7-input" type="number" min="1" max="100" style={{ width: 60 }} value={options.show_percent} onChange={e => setOptions(o => ({ ...o, show_percent: Number(e.target.value) }))} />%</label>
        </div>
        <div className="s7-row" style={{ marginTop: 8 }}>
          {site && fromDesign && <button className="btn primary" disabled={busy} onClick={syncDesign}>Update "{site.name}" from my design</button>}
          {(!site || !fromDesign) && <button className="btn primary" disabled={busy || !fixtures.length} onClick={createFromDesign}>Create Siemens site from my design</button>}
        </div>
        {site && !fromDesign && <p style={{ color: "#f6d795" }}>"{site.name}" was created as a test or by hand, not from a design. It keeps working as before; create a new site from your design to use the device model.</p>}
        {!fixtures.length && <p style={{ color: "#f6d795" }}>No design is open. Draw or open your fountain in Engineering Design first.</p>}
      </div>
      {designReport && <div className="s7-card">
        <b>What AquaFlow did</b>
        <ul>{designReport.notes?.map(n => <li key={n}>{n}</li>)}</ul>
        {designReport.unsupported?.length > 0 && <><b>Not controlled by the Siemens PLC ({designReport.unsupported.length})</b>
          <ul>{designReport.unsupported.slice(0, 12).map(u => <li key={u.id}>{u.label}: {u.reason}</li>)}</ul></>}
        {designReport.safety_devices && Object.keys(designReport.safety_devices).length > 0 && <p>Safety items found in the design: {Object.keys(designReport.safety_devices).map(k => ({ estop_ok: "emergency stop", level_ok: "water level", thermal_ok: "motor thermal", drive_ok: "drive ready", pressure_ok: "pressure" }[k] || k)).join(", ")}.</p>}
      </div>}
    </div>}

    {step === "hardware" && site && <SiemensHardwarePicker site={site} onSaved={saved} />}
    {step === "wiring" && site && <SiemensIOMap site={site} onSaved={saved} onOpenHardware={() => setStep("hardware")} />}

    {step === "export" && site && <div>
      <div className="s7-card">
        <b>1. Download the PLC program</b>
        <p>The ZIP contains the AquaFlow PLC program (data block, function block and cyclic block), the <SiemensTerm k="tag">PLC tag table</SiemensTerm>, the wiring schedule and step-by-step guides.</p>
        <div className="s7-row">
          <button className="btn primary" disabled={busy} onClick={() => action(async () => { await downloadFrom(`/${site.id}/tia-package`, siemensPackageName(site)); return "TIA package saved to Downloads."; }, "Preparing the package…")}>Download TIA package (.zip)</button>
          <button className="btn" disabled={busy} onClick={() => action(async () => { await downloadFrom(`/${site.id}/tag-table.xlsx`, `AquaFlow-${site.name.replace(/[^A-Za-z0-9]+/g, "-")}-PLC-Tags.xlsx`); return "Tag table saved to Downloads."; })}>Tag table only (.xlsx)</button>
        </div>
      </div>
      <div className="s7-card">
        <b>2. In <SiemensTerm k="tia">TIA Portal</SiemensTerm> (once)</b>
        <ol>
          <li>Add the exact CPU{site.hardware ? " and modules from the Hardware step" : ""}, set its <SiemensTerm k="ip">IP address</SiemensTerm>.</li>
          <li>CPU properties → Protection &amp; Security → Connection mechanisms → tick <SiemensTerm k="putget">Permit access with PUT/GET</SiemensTerm>.</li>
          <li>PLC tags → Show all tags → <b>Import</b> the tag table (.xlsx).</li>
          <li>External source files → add the .db and .scl files → <b>Generate blocks from source</b>. Open DB{site.plc.db} properties and switch <SiemensTerm k="nonoptimized">Optimized block access</SiemensTerm> OFF.</li>
          <li>Add a <SiemensTerm k="ob">Cyclic interrupt OB (100 ms)</SiemensTerm> and paste the call from <i>cyclic-call.txt</i>.</li>
          <li>Compile (0 errors), download, set the CPU to RUN. For a simulator use <SiemensTerm k="plcsim">PLCSIM</SiemensTerm> + <SiemensTerm k="nettoplcsim">NetToPLCsim</SiemensTerm>.</li>
        </ol>
        <p>Any change to wiring, hardware, DB number or safety inputs changes the program: AquaFlow will refuse to connect until you export and download again. That protects you from running a show against the wrong program.</p>
      </div>
    </div>}

    {step === "connect" && site && <div>
      <div className="s7-card">
        <b>Where is the PLC?</b>
        <div className="s7-row" style={{ marginTop: 6 }}>
          {[["plcsim", "Test PLC: PLCSIM on this PC (before buying)"], ["physical", "Real PLC"], ["simulated", "AquaFlow animation only (no PLC; TIA does not change)"]].map(([mode, label]) =>
            <label key={mode}><input type="radio" name="s7-mode" checked={connectMode === mode} disabled={busy}
              onChange={() => { setPreviewChosen(mode === "simulated"); return mode === "simulated" ? saveConnection({ mode, plc: { port: 102, rack: 0, slot: 1 } }) : setPendingMode(mode === site.mode ? null : mode); }} /> {label}</label>)}
        </div>
        {connectMode !== "simulated" && <ConnectFields site={site} mode={connectMode} pending={connectMode !== site.mode} busy={busy} onSave={plc => saveConnection({ mode: connectMode, plc })} />}
        {connectMode !== site.mode && <p style={{ color: "#f6d795" }}>Not saved yet: this site still runs as {site.mode === "simulated" ? "an AquaFlow animation that never talks to a PLC" : site.mode}. Check the address and press Save to use {connectMode === "plcsim" ? "PLCSIM as the test PLC" : "the real PLC"}.</p>}
        {site.mode === "simulated" && connectMode === "simulated" && <div className="s7-msg s7-msg--bad">AquaFlow animation only: Verify always passes here and nothing is sent to PLCSIM or TIA Portal.</div>}
        {connectMode === "plcsim" && <p>Standard PLCSIM is reached through NetToPLCsim: start it, add a station with your PLCSIM CPU (<SiemensTerm k="rackslot">rack 0 / slot 1</SiemensTerm>), let it stop the S7DOS service, then enter this PC's network address above. Check the path in PowerShell with <span className="s7-mono">Test-NetConnection &lt;ip&gt; -Port 102</span>.</p>}
      </div>
      <div className="s7-card">
        <div className="s7-row"><button className="btn primary" disabled={busy} onClick={verify}>Verify connection (read-only)</button>
          {status?.hardware_verified ? <span className="s7-badge s7-badge--ok">PLC VERIFIED</span> : status?.verified ? <span className="s7-badge s7-badge--warn">PREVIEW ONLY</span> : <span className="s7-badge s7-badge--muted">NOT VERIFIED</span>}</div>
        <p>Verify only reads. It checks that the PLC runs the AquaFlow program made for this site and that its <SiemensTerm k="heartbeat">heartbeat</SiemensTerm> is moving. Nothing moves.</p>
        {status?.error && <div className="s7-msg s7-msg--bad">{explainS7Error(status.error, site) || status.error}</div>}
      </div>
      {networked && <SiemensPlcMonitor site={site} />}
    </div>}

    {step === "test" && site && <div>
      <p>Pulse single devices from the Wiring step (Test buttons), or run the full acceptance test below.</p>
      <SiemensAcceptance site={site} onResult={setAcceptance} />
    </div>}

    {step === "run" && site && <div>
      {site.mode === "simulated" && <div className="s7-card s7-card--bad"><b>This site is an AquaFlow animation only.</b> Starting it never changes PLCSIM or TIA Portal.
        <div style={{ marginTop: 6 }}><button className="btn primary" onClick={() => setStep("connect")}>Switch to the PLCSIM test PLC</button></div></div>}
      {networked && <SiemensPlcMonitor site={site} />}
      <div className="s7-card">
        <b>Compile your show for this PLC</b>
        <p>Program the show as usual in Show Programming (nozzles, pumps, lights). Open <b>Compile / Siemens</b> there and choose this site: AquaFlow turns nozzle patterns into valve open/close commands, keeps every valve's minimum on/off time, and runs each pump while its nozzles play.</p>
        <button className="btn" onClick={() => { updateIntegrations({ siemensSiteId: site.id }); window.dispatchEvent(new CustomEvent("aquaflow:open-panel", { detail: { panel: "show_programmer" } })); }}>Open Show Programming</button>
        <p>{site.show?.clips?.length ? `A ${site.show.duration.toFixed(1)} s show with ${site.show.clips.length} commands is compiled for revision ${site.show.revision}.` : "No show is compiled for this revision. Saving any setting (mode, IP, wiring) clears the compiled show on purpose, so a show never runs against settings it was not checked with."}</p>
        <div className="s7-row">
          {!site.show && site.previous_show_clips?.length > 0 && <button className="btn primary" disabled={busy} onClick={() => action(() => compile(site.previous_show_clips, "Previous show"), "Compiling…")}>Recompile previous show ({site.previous_show_clips.length} commands)</button>}
          <button className="btn" disabled={busy} onClick={() => action(async () => compile((await siemensRequest(`/${site.id}/example`)).clips, "60-second test pattern"), "Compiling…")}>Compile a 60-second test pattern</button>
        </div>
      </div>
      <SiemensShowControls selectedSite={site} onCompiled={() => reload().catch(() => {})} />
    </div>}

    <div className="s7-nav">
      <button className="btn" disabled={index <= 0} onClick={() => setStep(WIZARD_STEPS[index - 1].key)}>← Back</button>
      <button className="btn" disabled={index >= WIZARD_STEPS.length - 1 || !site} onClick={() => setStep(WIZARD_STEPS[index + 1].key)}>Next →</button>
    </div>
  </div>;
}

function ConnectFields({ site, mode, pending, busy, onSave }) {
  const [plc, setPlc] = useState(site.plc);
  const [adapters, setAdapters] = useState([]);
  useEffect(() => { apiGet("/controllers/adapters").then(r => setAdapters((r.adapters || []).filter(a => a.kind === "physical"))).catch(() => setAdapters([])); }, []);
  useEffect(() => { if (mode === "plcsim" && !plc.ip && adapters[0]) setPlc(p => ({ ...p, ip: adapters[0].ip })); }, [mode, adapters]); // eslint-disable-line react-hooks/exhaustive-deps
  const pcAddress = mode === "plcsim" && adapters.length > 0 && plc.ip && !addressOnThisPc(plc.ip, adapters);
  useEffect(() => setPlc(site.plc), [site.id, site.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = pending || JSON.stringify(plc) !== JSON.stringify(site.plc);
  return <div className="s7-row" style={{ marginTop: 8 }}>
    <label><SiemensTerm k="ip">{mode === "plcsim" ? "PC / NetToPLCsim IP" : "PLC IP address"}</SiemensTerm> <input className="s7-input s7-mono" style={{ width: 130 }} placeholder="192.168.0.10" value={plc.ip} onChange={e => setPlc({ ...plc, ip: e.target.value.trim() })} /></label>
    <label><SiemensTerm k="db">DB number</SiemensTerm> <input className="s7-input" type="number" min="100" style={{ width: 70 }} value={plc.db} onChange={e => setPlc({ ...plc, db: Number(e.target.value) })} /></label>
    <span style={{ color: "var(--text-muted)" }}>Port {plc.port} · <SiemensTerm k="rackslot">rack 0 / slot 1</SiemensTerm></span>
    <button className="btn" disabled={busy || !changed} onClick={() => onSave(plc)}>Save</button>
    {mode === "plcsim" && adapters.map(a => <button key={a.ip} className="btn" disabled={busy || plc.ip === a.ip} onClick={() => setPlc({ ...plc, ip: a.ip })}>Use this PC's {a.name} address {a.ip}</button>)}
    {pcAddress && <div className="s7-msg s7-msg--bad" style={{ flexBasis: "100%" }}>{plc.ip} is not an address of this PC right now ({adapters.map(a => `${a.name} ${a.ip}`).join(", ")}). NetToPLCsim listens on this PC's address, which changes when you join a different Wi-Fi. Pick the current one above, and select the same adapter in NetToPLCsim.</div>}
    {plc.db !== 100 && <div className="s7-msg" style={{ flexBasis: "100%" }}>DB{plc.db}: AquaFlow programs use DB100 unless you changed it on purpose. The DB number must match the data block in the PLC; changing it requires exporting and downloading the program again.</div>}
  </div>;
}
