import { useEffect, useState } from "react";
import useEngineeringStore from "../../store/engineeringStore";
import useProjectStore from "../../store/projectStore";
import { SIEMENS_API, siemensRequest, siemensEngineeringLayout, siemensPackageName } from "../../utils/siemensSite";
import SiemensShowControls from "../programmer/SiemensShowControls";
import SiemensEasyWorkflow from "./SiemensEasyWorkflow";
import SiemensReadiness from "./SiemensReadiness";

export default function SiemensSitePanel() {
  const rememberedSiteId = useProjectStore((state) => state.integrations.siemensSiteId);
  const projectLoadRevision = useProjectStore((state) => state.loadRevision);
  const updateIntegrations = useProjectStore((state) => state.updateIntegrations);
  const [sites, setSites] = useState([]);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState("New Siemens Test Site");
  const [pumps, setPumps] = useState(1);
  const [valves, setValves] = useState(4);
  const [lights, setLights] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [engineeringStatus, setEngineeringStatus] = useState(null);
  const [downloadConfirmation, setDownloadConfirmation] = useState("");
  const [cpuStopAcknowledged, setCpuStopAcknowledged] = useState(false);
  const [targetHardwareConfirmed, setTargetHardwareConfirmed] = useState(false);
  const [memoryResetConfirmed, setMemoryResetConfirmed] = useState(false);
  const [plcPassword, setPlcPassword] = useState("");
  const refresh = async () => setSites((await siemensRequest()).sites);
  const refreshEngineering = async sid => setEngineeringStatus(await siemensRequest(sid ? `/${sid}/engineering/status` : "/engineering/status"));
  useEffect(() => { Promise.all([refresh(), refreshEngineering()]).catch(e => setMessage(e.message)); }, []);
  const action = async (fn, pending = "Working…") => {
    setBusy(true); setMessage(pending);
    try { await fn(); } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  const change = patch => { setDraft(d => ({ ...d, ...patch })); setDirty(true); };
  const edit = (id, patch) => change({ channels: draft.channels.map(c => c.id === id ? { ...c, ...patch } : c) });
  const choose = id => {
    if (dirty && !window.confirm("Discard unsaved Siemens mapping edits?")) return;
    const selected = sites.find(s => s.id === id) || null;
    updateIntegrations({ siemensSiteId: selected?.id || null });
    setDraft(selected); setDirty(false); setMessage(""); setDownloadConfirmation(""); setCpuStopAcknowledged(false); setTargetHardwareConfirmed(false); setMemoryResetConfirmed(false); setPlcPassword("");
    refreshEngineering(selected?.id).catch(e => setMessage(e.message));
  };
  useEffect(() => {
    if (!rememberedSiteId || !sites.length) return;
    const selected = sites.find(site => site.id === rememberedSiteId);
    if (!selected || (draft?.id === selected.id && !projectLoadRevision)) return;
    setDraft(selected);
    setDirty(false);
    setMessage("");
    refreshEngineering(selected.id).catch(e => setMessage(e.message));
  }, [rememberedSiteId, sites, projectLoadRevision]);
  const engineer = (path, body = {}) => action(async () => {
    const result = await siemensRequest(`/${draft.id}/engineering/${path}`, "POST", { revision: draft.revision, ...body });
    await refreshEngineering(draft.id);
    setMessage(path === "diagnostics" ? `TIA state: ${result.online_state || "reported"}` : `TIA engineering stage: ${result.stage || path}`);
  });
  const saveMapping = () => action(async () => {
    const saved = await siemensRequest(`/${draft.id}`, "PUT", draft);
    await refresh(); setDraft(saved); setDirty(false); await refreshEngineering(saved.id);
    setMessage("Mapping saved. Verification, TIA artifacts and arming must be revalidated against this revision.");
  }, "Saving mapping…");
  const createQuickTest = () => action(async () => {
    if (dirty && !window.confirm("Discard unsaved Siemens mapping edits and create the ready PLCSIM test?")) return;
    const site = await siemensRequest("/quick-test", "POST", {
      name: "TIA V17 PLCSIM Test - 20s", tia_version: 17,
    });
    const result = await siemensRequest();
    setSites(result.sites); setDraft(site); setDirty(false);
    updateIntegrations({ siemensSiteId: site.id });
    await refreshEngineering(site.id);
    setMessage("Ready: DB100, one pump, two valves and a compiled 20-second PLCSIM pattern. Export the TIA ZIP in step 3.");
  }, "Creating the ready TIA/PLCSIM test…");
  const createLargeIoTest = () => action(async () => {
    if (dirty && !window.confirm("Discard unsaved Siemens mapping edits and create the CPU 1215C large I/O test?")) return;
    const site = await siemensRequest("/large-io-test", "POST", {
      name: "S7-1215C Large I-O PLCSIM Test - 60s", tia_version: 17,
    });
    const result = await siemensRequest();
    setSites(result.sites); setDraft(site); setDirty(false);
    updateIntegrations({ siemensSiteId: site.id });
    await refreshEngineering(site.id);
    setMessage("Ready: two pumps, eight valves, four DB RGB groups, five safety inputs and a compiled 60-second pattern. Export the PLC interface ZIP.");
  }, "Creating the CPU 1215C large I/O simulation…");
  const create1212cStarter = () => action(async () => {
    if (dirty && !window.confirm("Discard unsaved mapping edits and create the CPU 1212C simulation starter?")) return;
    const site = await siemensRequest("/1212c-starter", "POST", {
      name: "CPU 1212C fountain starter - simulation", tia_version: 17,
    });
    await refresh(); setDraft(site); setDirty(false); await refreshEngineering(site.id);
    updateIntegrations({ siemensSiteId: site.id });
    setMessage("1212C starter created: 20-second simulation, one pump and two valves. Pump %QW64 is virtual; this CPU needs an added analog output. No equipment is marked commissioned.");
  }, "Creating the CPU 1212C simulation starter…");
  const download = async () => {
    const response = await fetch(`${SIEMENS_API}/${draft.id}/tia-package`);
    if (!response.ok) throw new Error((await response.json()).detail);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = siemensPackageName(draft); link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("TIA source package exported. Review, compile and download in TIA Portal.");
  };
  const input = { background: "#0b1720", color: "#deedf4", border: "1px solid #3c5362", padding: 5, maxWidth: "100%" };
  return <div style={{ padding: 16, color: "var(--text-primary)", fontSize: 12 }}>
    <h3 style={{ marginBottom: 4 }}>Siemens Site</h3>
    <p style={{ color: "var(--text-secondary)", marginBottom: 12 }}>Select a site to connect, verify and run its fountain show.</p>
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
      <select style={input} aria-label="Saved Siemens site" value={draft?.id || ""} onChange={e => choose(e.target.value)}>
        <option value="">Choose a saved site</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name} · revision {s.revision}</option>)}
      </select>
      <button className="btn" disabled={busy} onClick={() => action(refresh)}>Reload sites</button>
    </div>
    {draft && <SiemensShowControls selectedSite={sites.find(s => s.id === draft.id) || draft} configurationPending={dirty} onCompiled={() => refresh().catch(() => {})} />}
    <details style={{ border: "1px solid #31504c", borderRadius: 8, padding: 11, marginBottom: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Create a new site or PLCSIM test</summary>
    <div style={{ border: "1px solid #2f7280", borderRadius: 8, padding: 11, marginBottom: 12, background: "rgba(21,89,105,.14)" }}>
      <b style={{ color: "#8de3d0" }}>Ready-made PLCSIM tests</b>
      <p style={{ margin: "5px 0 8px" }}>Created in simulation mode. Select Physical mode later to connect.</p>
      <button className="btn" disabled={busy} onClick={createQuickTest}>Create ready 20-second TIA/PLCSIM test</button>
      <button className="btn" disabled={busy} onClick={create1212cStarter}>Create CPU 1212C starter (simulation)</button>
      <button className="btn" disabled={busy} onClick={createLargeIoTest}>Create CPU 1215C large I/O test (60 seconds)</button>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
      <label>Site name <input style={input} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Pumps <input style={{ ...input, width: 55 }} type="number" min="1" max="16" value={pumps} onChange={e => setPumps(Number(e.target.value))} /></label>
      <label>Valve / nozzle outlets <input style={{ ...input, width: 55 }} type="number" min="1" max="512" value={valves} onChange={e => setValves(Number(e.target.value))} /></label>
      <label>RGB lights <input style={{ ...input, width: 55 }} type="number" min="0" max="32" value={lights} onChange={e => setLights(Number(e.target.value))} /></label>
      <button className="btn" disabled={busy} onClick={() => action(async () => {
        if (dirty && !window.confirm("Discard unsaved edits and create a new site?")) return;
        const site = await siemensRequest("", "POST", { name, pumps, valves, lights }); await refresh(); setDraft(site); setDirty(false); updateIntegrations({ siemensSiteId: site.id });
      })}>Create simulated site</button>
    </div>
    </details>
    {engineeringStatus && <details style={{ margin: "12px 0", padding: 10, border: `1px solid ${engineeringStatus.available ? "#1f9d68" : "#8a6431"}` }}>
      <summary style={{ cursor: "pointer" }}>TIA automation: {engineeringStatus.available ? "ready" : "manual ZIP import"}</summary>
      <b>Local TIA integration: {engineeringStatus.available ? "AUTOMATION READY" : "MANUAL ZIP WORKFLOW"}</b>
      <div>{engineeringStatus.public_apis?.length ? `Detected Siemens PublicAPI: ${engineeringStatus.public_apis.map(x => `V${x.version}`).join(", ")}` : "A Siemens PublicAPI has not been detected yet. Refresh after TIA finishes installing."}</div>
      {!engineeringStatus.available && <div>The manual AquaFlow ZIP import still works. Openness is required only for AquaFlow's automatic project/compile/download buttons.</div>}
      {!engineeringStatus.openness_group_member && <div>Current Windows user is not in the Siemens TIA Openness group.</div>}
      {engineeringStatus.requirements?.map(item => <div key={item}>• {item}</div>)}
      <button className="btn" disabled={busy} onClick={() => action(() => refreshEngineering(draft?.id), "Checking the local Siemens installation…")}>Refresh TIA detection</button>
    </details>}
    {draft && <>
      <SiemensReadiness siteId={draft.id} revision={draft.revision} dirty={dirty} />
      <SiemensEasyWorkflow site={draft} dirty={dirty} busy={busy} engineeringStatus={engineeringStatus}
        onSave={saveMapping}
        onExport={() => action(download, "Preparing TIA V17+ commissioning package…")}
        onUseDetectedTia={version => change({ tia: { ...draft.tia, version } })}
        onMakePlcSim={() => change({ mode: "plcsim", plc: { ...draft.plc, port: 102, rack: 0, slot: 1, db: draft.plc.db || 100 } })}
        onMakePhysical={() => change({ mode: "physical", plc: { ...draft.plc, port: 102, rack: 0, slot: 1, db: draft.plc.db || 100 } })} />
      <details open={dirty ? true : undefined} style={{ border: "1px solid #31504c", borderRadius: 8, padding: 11, margin: "12px 0" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Controller, safety inputs and channel mapping {dirty ? "· unsaved" : ""}</summary>
      <h4>Controller and safety inputs</h4>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label>Name <input style={input} value={draft.name} onChange={e => change({ name: e.target.value })} /></label>
        <label>Mode <select style={input} value={draft.mode} onChange={e => change({ mode: e.target.value })}><option value="simulated">INTERNAL PREVIEW — no DB writes</option><option value="plcsim">PLCSIM NETWORK — writes simulator DB</option><option value="physical">PHYSICAL — commissioned Siemens PLC</option></select></label>
        {Object.keys(draft.plc).map(key => {
          const numeric = ["port", "rack", "slot", "db"].includes(key);
          return <label key={key}>{key.replaceAll("_", " ").toUpperCase()} <input style={{ ...input, width: numeric ? 55 : 150 }} value={draft.plc[key]} onChange={e => change({ plc: { ...draft.plc, [key]: numeric ? Number(e.target.value) : e.target.value } })} /></label>;
        })}
      </div>
      <p>Healthy-high PLC safety inputs (%I0.0 style). Missing bindings remain FALSE in the exported program.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{Object.keys(draft.inputs).map(key => <label key={key}>{key} <input style={{ ...input, width: 90 }} placeholder="%I0.0" value={draft.inputs[key]} onChange={e => change({ inputs: { ...draft.inputs, [key]: e.target.value } })} /></label>)}</div>
      <details style={{ margin: "12px 0" }}><summary style={{ cursor: "pointer" }}>Advanced TIA hardware configuration</summary>
      <p>Copy TypeIdentifier values from the installed TIA hardware catalog.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label>TIA version <input style={{ ...input, width: 50 }} type="number" min="17" max="21" value={draft.tia.version} onChange={e => change({ tia: { ...draft.tia, version: Number(e.target.value) } })} /></label>
        {[["project_name", "Project"], ["device_name", "Device"], ["cpu_name", "CPU"]].map(([key, label]) => <label key={key}>{label} name <input style={input} value={draft.tia[key]} onChange={e => change({ tia: { ...draft.tia, [key]: e.target.value } })} /></label>)}
        <label style={{ flex: "1 1 420px" }}>CPU TypeIdentifier <input style={{ ...input, width: "100%" }} placeholder="OrderNumber:6ES7 .../V..." value={draft.tia.cpu_type_identifier} onChange={e => change({ tia: { ...draft.tia, cpu_type_identifier: e.target.value } })} /></label>
        <label>PG/PC interface <input style={input} placeholder="Exact Siemens interface name" value={draft.tia.network_interface} onChange={e => change({ tia: { ...draft.tia, network_interface: e.target.value } })} /></label>
      </div>
      <div style={{ marginTop: 8 }}><b>Signal and communication modules</b>
        {draft.tia.modules.map((module, index) => <div key={`${index}-${module.name}`} style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
          <input aria-label={`Module ${index + 1} name`} style={input} placeholder="Module name" value={module.name} onChange={e => change({ tia: { ...draft.tia, modules: draft.tia.modules.map((m, i) => i === index ? { ...m, name: e.target.value } : m) } })} />
          <input aria-label={`Module ${index + 1} TypeIdentifier`} style={{ ...input, minWidth: 360 }} placeholder="OrderNumber:.../V..." value={module.type_identifier} onChange={e => change({ tia: { ...draft.tia, modules: draft.tia.modules.map((m, i) => i === index ? { ...m, type_identifier: e.target.value } : m) } })} />
          <input aria-label={`Module ${index + 1} position`} style={{ ...input, width: 70 }} type="number" min="1" value={module.position} onChange={e => change({ tia: { ...draft.tia, modules: draft.tia.modules.map((m, i) => i === index ? { ...m, position: Number(e.target.value) } : m) } })} />
          <button className="btn" onClick={() => change({ tia: { ...draft.tia, modules: draft.tia.modules.filter((_, i) => i !== index) } })}>Remove</button>
        </div>)}
        <button className="btn" onClick={() => change({ tia: { ...draft.tia, modules: [...draft.tia.modules, { name: `Module_${draft.tia.modules.length + 1}`, type_identifier: "", position: draft.tia.modules.length + 1 }] } })}>Add module</button>
      </div>
      </details>
      <h4>Saved channel map</h4>
      <p>Map each output to its PLC address. Save changes before verifying or running.</p>
      <p style={{ color: "#f5cf91" }}>Pump fault inputs and pump/valve feedback are supported. Valve/light fault inputs and light feedback are not implemented by this runtime; packages with those bindings are blocked. RGB bytes require a compatible lighting interface, not direct DMX wiring.</p>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["Channel", "Zone", "Supplying pump", "PLC output", "Pump enable", "Feedback input", "Fault input", "Speed ceiling %", "Min on/off ms", "Commissioning observation"].map(h => <th key={h} style={{ textAlign: "left", padding: 6 }}>{h}</th>)}</tr></thead>
        <tbody>{draft.channels.map(c => <tr key={c.id}>
          <td>{c.kind} #{c.index + 1}<input style={{ ...input, width: 110 }} value={c.name} onChange={e => edit(c.id, { name: e.target.value })} /></td>
          <td><input style={{ ...input, width: 95 }} value={c.zone || ""} onChange={e => edit(c.id, { zone: e.target.value })} /></td>
          <td>{c.kind === "valve" && <select style={input} value={c.pump_id} onChange={e => edit(c.id, { pump_id: e.target.value })}>{draft.channels.filter(p => p.kind === "pump").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</td>
          <td><input aria-label={`${c.name} output`} style={{ ...input, width: 80 }} placeholder={c.kind === "pump" ? "%QW64" : c.kind === "light" ? "%QB100" : "%Q0.1"} value={c.output} onChange={e => edit(c.id, { output: e.target.value })} /></td>
          <td>{c.kind === "pump" && <input style={{ ...input, width: 80 }} placeholder="%Q0.0" value={c.enable_output} onChange={e => edit(c.id, { enable_output: e.target.value })} />}</td>
          <td><input style={{ ...input, width: 75 }} placeholder="%I0.0" value={c.feedback_input || ""} onChange={e => edit(c.id, { feedback_input: e.target.value })} /></td>
          <td><input style={{ ...input, width: 75 }} placeholder="%I0.1" value={c.fault_input || ""} onChange={e => edit(c.id, { fault_input: e.target.value })} /></td>
          <td>{c.kind === "pump" && <input style={{ ...input, width: 55 }} type="number" min="1" max="100" value={c.max_percent} onChange={e => edit(c.id, { max_percent: Number(e.target.value) })} />}</td>
          <td>{c.kind === "valve" && <>{["min_on_ms", "min_off_ms"].map(key => <input key={key} aria-label={`${c.name} ${key}`} style={{ ...input, width: 60 }} type="number" min="100" max="30000" value={c[key]} onChange={e => edit(c.id, { [key]: Number(e.target.value) })} />)}</>}</td>
          <td><input style={input} placeholder="Actual observed response" value={c.observation} onChange={e => edit(c.id, { observation: e.target.value })} /><label><input type="checkbox" checked={c.commissioned} onChange={e => edit(c.id, { commissioned: e.target.checked })} />Observed on site</label></td>
        </tr>)}</tbody>
      </table></div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0" }}>
        <button className="btn" disabled={busy} onClick={saveMapping}>{busy ? "Working…" : "Save mapping"}</button>
        <button className="btn" disabled={dirty || busy} title={dirty ? "Save mapping before exporting" : "Download the reviewable TIA source package"}
          onClick={() => action(download, "Preparing TIA V17+ commissioning package…")}>Export PLC interface package (.zip)</button>
        <button className="btn" disabled={dirty || busy || draft.source?.kind === "engineering"} title={draft.source?.kind === "engineering" ? "This site was created from your design; its devices already are your Engineering fixtures" : ""} onClick={() => {
          if (!window.confirm("Load this Siemens layout into Engineering Design? Save your current design first; this replaces its open draft.")) return;
          useEngineeringStore.getState().loadProject(siemensEngineeringLayout(draft)); setMessage("Layout loaded. Open Engineering Design, then Show Programmer and import its fixtures.");
        }}>Load layout in Engineering Design</button>
        <button className="btn" disabled={busy} onClick={() => {
          const project = useEngineeringStore.getState().getProjectPayload();
          if (project.id !== draft.id || !draft.channels.every(c => project.fixtures.some(f => f.id === c.id))) { setMessage("Load this Siemens layout first. Retain its mapped pump and valve fixture IDs while editing."); return; }
          change({ engineering: project }); setMessage("Engineering layout attached to the draft. Save mapping to keep it.");
        }}>Keep current engineering layout</button>
      </div>
      <div aria-live="polite" style={{ minHeight: 28, margin: "-6px 0 12px", padding: "6px 8px", border: "1px solid #3c5362", color: "#f6c978" }}>
        {message || (dirty ? "Unsaved changes: click Save mapping before Export TIA package becomes available." : "Mapping is saved; the TIA package can be exported.")}
      </div>
      </details>
      <details style={{ padding: 10, border: "1px solid #3c5362", marginBottom: 12 }}><summary style={{ cursor: "pointer" }}>TIA automatic engineering and download</summary>
        <h4 style={{ marginTop: 0 }}>Official Siemens engineering workflow</h4>
        <p>Stages are recorded separately: source → TIA project → successful Siemens compilation → physical download. A ZIP export or S7 connection never counts as a compiled/downloaded PLC program.</p>
        <div>Current stage: <b>{engineeringStatus?.engineering?.stage || "not generated"}</b>{engineeringStatus?.current === false && engineeringStatus?.engineering ? " (stale — regenerate)" : ""}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <button className="btn" disabled={dirty || busy || !engineeringStatus?.available} onClick={() => engineer("generate")}>1. Generate TIA project</button>
          <button className="btn" disabled={dirty || busy || !engineeringStatus?.available || engineeringStatus?.engineering?.stage !== "project_generated"} onClick={() => engineer("compile")}>2. Compile with Siemens</button>
          <button className="btn" disabled={dirty || busy || !engineeringStatus?.available || !engineeringStatus?.engineering} onClick={() => engineer("diagnostics")}>Read TIA status</button>
        </div>
        <p><b>AquaFlowCycle is automatic:</b> Step 1 generates the S7-1200 cyclic-interrupt OB through the matching Siemens Openness installation, then reads back and verifies OB200, cycle 100 ms, phase 0, the DB number and all safety-input arguments. If Siemens cannot confirm those properties, project generation fails and compile/download stay blocked.</p>
        {engineeringStatus?.cpu_compatibility?.supported === false && <p style={{ color: "#ff7777" }}>The saved CPU TypeIdentifier is outside the reviewed standard S7-1200 CPU scope.</p>}
        <p>Download changes the physical PLC and can put it in STOP. Secure the fountain electrically and verify the selected CPU/network first. AquaFlow leaves the CPU in STOP after download.</p>
        <label>Confirmation <input style={{ ...input, minWidth: 280 }} placeholder={`DOWNLOAD ${draft.name}`} value={downloadConfirmation} onChange={e => setDownloadConfirmation(e.target.value)} /></label>
        <label style={{ marginLeft: 8 }}><input type="checkbox" checked={cpuStopAcknowledged} onChange={e => setCpuStopAcknowledged(e.target.checked)} /> Outputs secured; CPU STOP allowed</label>
        <label style={{ marginLeft: 8 }}><input type="checkbox" checked={targetHardwareConfirmed} onChange={e => setTargetHardwareConfirmed(e.target.checked)} /> CPU order/firmware and modules match the cabinet</label>
        <label style={{ marginLeft: 8 }}><input type="checkbox" checked={memoryResetConfirmed} onChange={e => setMemoryResetConfirmed(e.target.checked)} /> Allow DB/memory reinitialization if Siemens requires it</label>
        <label style={{ marginLeft: 8 }}>PLC password <input style={input} type="password" autoComplete="off" value={plcPassword} onChange={e => setPlcPassword(e.target.value)} /></label>
        <button className="btn" disabled={dirty || busy || !engineeringStatus?.available || engineeringStatus?.engineering?.stage !== "compiled" || downloadConfirmation !== `DOWNLOAD ${draft.name}` || !cpuStopAcknowledged || !targetHardwareConfirmed}
          onClick={() => engineer("download", { confirmation: downloadConfirmation, cpu_stop_acknowledged: cpuStopAcknowledged, target_hardware_confirmed: targetHardwareConfirmed, memory_reinitialization_confirmed: memoryResetConfirmed, password: plcPassword }).finally(() => setPlcPassword(""))}>3. Download to PLC (leave STOP)</button>
        {engineeringStatus?.engineering?.diagnostics?.map((item, index) => <div key={index} style={{ color: item.severity?.toLowerCase().includes("error") ? "#ff7777" : "#f6c978" }}>{item.severity}: {item.message || item.description}</div>)}
      </details>
      {dirty && <p>Save mapping before verification, export or playback. STOP remains available.</p>}
    </>}
  </div>;
}
