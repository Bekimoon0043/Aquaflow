import { useEffect, useMemo, useState } from "react";
import { siemensEasyWorkflowState, siemensRequest } from "../../utils/siemensSite";

const TIA_CHECKS = [
  ["sources", "Generated AquaFlowSiteIO and AquaFlowSiteControl from the exported sources"],
  ["db", "Confirmed the AquaFlow DB is non-optimized and uses the exported DB number"],
  ["cycle", "Created/confirmed AquaFlowCycle as a 100 ms cyclic-interrupt OB with one instance call"],
  ["compile", "Compiled hardware and software with zero errors"],
  ["download", "Downloaded to the intended PLC/PLCSIM and placed the CPU in RUN"],
];

const openPanel = panel => window.dispatchEvent(new CustomEvent("aquaflow:open-panel", { detail: { panel } }));

export default function SiemensEasyWorkflow({ site, dirty, busy, engineeringStatus, onSave, onExport, onMakePlcSim, onMakePhysical, onUseDetectedTia }) {
  const state = useMemo(() => siemensEasyWorkflowState(site, dirty), [site, dirty]);
  const [checks, setChecks] = useState({});
  const [verifyMessage, setVerifyMessage] = useState("");
  const [verifying, setVerifying] = useState(false);
  useEffect(() => { setChecks({}); setVerifyMessage(""); }, [site?.id, site?.revision]);
  if (!site) return null;
  const detectedVersions = (engineeringStatus?.public_apis || [])
    .map(item => Number(item.version)).filter(Number.isFinite).sort((a, b) => b - a);
  const detectedVersion = detectedVersions.includes(Number(site.tia?.version))
    ? Number(site.tia.version) : detectedVersions[0];
  const tiaDone = TIA_CHECKS.every(([key]) => checks[key]);
  const card = complete => ({
    border: `1px solid ${complete ? "#278c67" : "#3c5362"}`, borderRadius: 7, padding: 11,
    background: complete ? "rgba(26,111,79,.13)" : "#0c1821", minWidth: 230, flex: "1 1 260px",
  });
  const verify = async () => {
    setVerifying(true); setVerifyMessage("Testing the saved PLC contract…");
    try {
      const result = await siemensRequest(`/${site.id}/verify`, "POST");
      setVerifyMessage(result.hardware_verified
        ? `Connected and verified: contract v${result.contract_version || "?"}, PLC heartbeat moving.`
        : "Simulation verified. Switch the site to Physical mode and enter the PLC or NetToPLCsim bridge IP for a real network check.");
    } catch (error) { setVerifyMessage(error.message); }
    finally { setVerifying(false); }
  };
  return <section style={{ border: "1px solid #2f7280", borderRadius: 8, padding: 13, margin: "12px 0", background: "#09151e" }}>
    <h4 style={{ margin: "0 0 9px", color: "#8de3d0" }}>Setup · Design → Map → Export → Program → Connect</h4>
    <details style={{ padding: 9, marginBottom: 8, border: "1px solid #365a69", background: "#0b1720" }}>
      <summary style={{ cursor: "pointer" }}>TIA installation on this PC</summary>
      <div>{detectedVersions.length
        ? `Siemens PublicAPI detected: ${detectedVersions.map(version => `V${version}`).join(", ")}.`
        : "Finish installing TIA Portal, then click Refresh TIA detection above."}</div>
      {detectedVersion && Number(site.tia?.version) !== detectedVersion && <button className="btn" type="button" disabled={busy || dirty} onClick={() => onUseDetectedTia(detectedVersion)}>Use detected TIA V{detectedVersion}</button>}
      <div style={{ color: "#9fb7c3", marginTop: 4 }}>Manual ZIP import needs TIA Portal only. Automatic project creation also needs TIA Openness and its Windows user group.</div>
    </details>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <div style={card(state.patternReady)}>
        <b>1 · Design and compile the pattern {state.patternReady ? "✓" : ""}</b>
        <p>{state.patternReady ? `${site.show.clips.length} commands · ${site.show.duration.toFixed(1)} seconds` : "Create and compile a show."}</p>
        <button className="btn" type="button" onClick={() => openPanel("show_programmer")}>Open Show Programmer</button>
      </div>
      <div style={card(state.outputsMapped && state.saved)}>
        <b>2 · Map and save the equipment {state.outputsMapped && state.saved ? "✓" : ""}</b>
        <p>{!state.outputsMapped ? "Enter the PLC outputs below." : dirty ? "Save your changes." : "Mapping saved."}</p>
        {!state.safetyMapped && <p style={{ color: "#f6c978" }}>Safety inputs are incomplete. Map real healthy-high inputs before physical commissioning.</p>}
        <button className="btn" type="button" disabled={busy || !dirty} onClick={onSave}>Save mapping</button>
      </div>
      <div style={card(false)}>
        <b>3 · Export one TIA commissioning ZIP</b>
        <p>Download the PLC source and show package.</p>
        <button className="btn" type="button" disabled={busy || dirty || !state.patternReady || !state.outputsMapped} onClick={onExport}>Export TIA V17+ + pattern</button>
        {!state.patternReady && <div style={{ color: "#f6c978", marginTop: 5 }}>Compile the pattern in step 1 first.</div>}
      </div>
    </div>
    <div style={{ ...card(tiaDone), marginTop: 8 }}>
      <b>4 · Import and program once in TIA Portal</b>
      <p>Follow <code>SAME-PC-PLCSIM-GUIDE.txt</code> in the ZIP. Confirm each completed step:</p>
      {TIA_CHECKS.map(([key, label]) => <label key={key} style={{ display: "block", margin: "5px 0" }}>
        <input type="checkbox" checked={Boolean(checks[key])} onChange={event => setChecks(value => ({ ...value, [key]: event.target.checked }))} /> {label}
      </label>)}
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", color: "#8de3d0" }}>Show the shortest TIA/PLCSIM procedure</summary>
        <ol style={{ lineHeight: 1.55, paddingLeft: 20 }}>
          <li>Add the exact S7-1200 CPU and enable approved PUT/GET access.</li>
          <li>Generate blocks from <code>AquaFlowSiteIO.db</code>, then <code>AquaFlowSiteControl.scl</code>.</li>
          <li>Create OB200 <code>AquaFlowCycle</code> as a cyclic interrupt: 100 ms, phase 0.</li>
          <li>Paste the call from <code>PLCSIM-ONLY-cyclic-call.txt</code> only for the isolated simulator.</li>
          <li>Confirm non-optimized DB100, rebuild all with zero errors, download to PLCSIM and put it in RUN.</li>
          <li>Confirm <code>PlcHeartbeat</code> changes. Start NetToPLCsim only when AquaFlow must connect to standard PLCSIM.</li>
        </ol>
      </details>
    </div>
    <div style={{ ...card(false), marginTop: 8 }}>
      <b>5 · Connect AquaFlow to PLCSIM or the commissioned PLC</b>
      <p>Choose PLCSIM network for the Windows NetToPLCsim bridge. Use Physical only for commissioned equipment. Enter the target IP below, save, then verify.</p>
      {site.mode !== "plcsim" && <button className="btn" type="button" disabled={!tiaDone} onClick={onMakePlcSim}>Use PLCSIM network mode</button>}
      {site.mode !== "physical" && <button className="btn" type="button" disabled={!tiaDone} onClick={onMakePhysical}>Use Physical PLC mode</button>}
      <button className="btn" type="button" disabled={busy || verifying || dirty || !tiaDone || !state.connectionReady} onClick={verify}>{verifying ? "Verifying…" : "Verify PLC connection"}</button>
      {!state.connectionReady && <span style={{ marginLeft: 8, color: "#f6c978" }}>Choose PLCSIM network or Physical mode and enter its IP, port, rack, slot and DB below, then save.</span>}
      {verifyMessage && <div role="status" style={{ marginTop: 7, color: verifyMessage.startsWith("Connected") ? "#8de3d0" : "#f6c978" }}>{verifyMessage}</div>}
    </div>
  </section>;
}
