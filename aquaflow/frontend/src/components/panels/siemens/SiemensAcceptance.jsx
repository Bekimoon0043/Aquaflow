import { useEffect, useState } from "react";
import { siemensRequest } from "../../../utils/siemensSite";
import { apiGet, apiPost } from "../../../utils/apiClient";
import SiemensTerm from "./SiemensTerm";

export default function SiemensAcceptance({ site, onResult }) {
  const [state, setState] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [watchdog, setWatchdog] = useState(true);
  const [message, setMessage] = useState("");
  const networked = site.mode === "plcsim" || site.mode === "physical";
  useEffect(() => {
    let alive = true;
    const poll = () => siemensRequest(`/${site.id}/acceptance`).then(result => {
      if (!alive) return;
      setState(result);
      const latest = result.record || result.last;
      if (latest) onResult?.(latest);
    }).catch(e => alive && setMessage(e.message));
    poll();
    const timer = setInterval(poll, 800);
    return () => { alive = false; clearInterval(timer); };
  }, [site.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => {
    setMessage("");
    try {
      const safety = await apiGet("/safety/status");
      if (safety.state === "SAFE_IDLE") await apiPost("/safety/arm", {});
      else if (safety.state !== "ARMED") throw new Error(`AquaFlow master safety is ${safety.state}; resolve it first.`);
      setState(await siemensRequest(`/${site.id}/acceptance`, "POST", { flow_path_confirmed: confirmed, include_watchdog: watchdog, seconds: 2 }));
    } catch (e) { setMessage(e.message); }
  };
  const running = state?.state === "running";
  const record = state?.record || (!running ? state?.last : null);
  const steps = running ? state.steps : record?.steps || [];
  const devices = site.channels.filter(c => c.kind === "valve" || c.kind === "light").length;
  return <div>
    <p>One button proves the whole chain: AquaFlow verifies the PLC program, pulses every valve (with its pump) and every light for 2 seconds, checks what the PLC reports back, then goes silent to prove the <SiemensTerm k="watchdog">watchdog</SiemensTerm> switches everything off by itself. About {Math.ceil(devices * 3 + 6)} seconds.</p>
    {!networked && <div className="s7-card s7-card--warn">Switch the site to PLCSIM (or physical) in the Connect step first. The test proves a real PLC program, not AquaFlow's internal preview.</div>}
    {networked && <div className="s7-card">
      <label className="s7-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
        {site.mode === "plcsim" ? "This target is the isolated PLCSIM simulator, not a physical PLC" : "A person is watching every outlet and each one has a safe water path"}</label>
      <label className="s7-row"><input type="checkbox" checked={watchdog} onChange={e => setWatchdog(e.target.checked)} /> Include the communication-loss (watchdog) test</label>
      <div className="s7-row" style={{ marginTop: 8 }}>
        <button className="btn primary" disabled={!confirmed || running} onClick={start}>{running ? "Running…" : "Run acceptance test"}</button>
        {running && <span>{state.steps.length} / {state.total} steps</span>}
      </div>
    </div>}
    {steps.length > 0 && <div className={`s7-card ${running ? "" : record?.passed ? "s7-card--ok" : "s7-card--bad"}`}>
      <b>{running ? "Acceptance test running…" : record?.passed ? "PASSED" : "FAILED"}</b>{record && !running && <span style={{ color: "var(--text-muted)" }}> · {new Date(record.finished_at).toLocaleString()} · {record.mode} · signature {record.signature}</span>}
      <ol className="s7-progress">{steps.map((step, i) => <li key={i}>
        <span className={`s7-badge ${step.ok ? "s7-badge--ok" : "s7-badge--bad"}`}>{step.ok ? "PASS" : "FAIL"}</span> <b>{step.name}</b> — {step.detail}
      </li>)}</ol>
      {record?.meaning && !running && <p>{record.meaning}</p>}
    </div>}
    {state?.history?.length > 1 && <details><summary style={{ cursor: "pointer" }}>Earlier runs ({state.history.length})</summary>
      <table className="s7-table"><thead><tr><th>Finished</th><th>Mode</th><th>Result</th><th>Revision</th></tr></thead>
        <tbody>{[...state.history].reverse().map(r => <tr key={r.finished_at}><td>{new Date(r.finished_at).toLocaleString()}</td><td>{r.mode}</td><td>{r.passed ? "PASSED" : "FAILED"}</td><td>{r.site_revision}</td></tr>)}</tbody></table>
    </details>}
    {message && <div className="s7-msg s7-msg--bad">{message}</div>}
  </div>;
}
