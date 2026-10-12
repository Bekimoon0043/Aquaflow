import React, { useEffect, useState } from "react";
import { siemensRequest } from "../../utils/siemensSite";

export function SiemensReadinessReport({ report, dirty = false }) {
  const colors = { passed: "#91e1b7", recorded: "#b9daf5", review: "#f5cf91", blocked: "#ffb4b4", unverified: "#f5cf91" };
  return <section aria-label="Siemens commissioning readiness" style={{ background: "#0b1821", border: "1px solid #476578", borderRadius: 8, padding: 12, margin: "12px 0" }}>
    <h4 style={{ margin: "0 0 8px", color: "#ecf7ff" }}>Commissioning readiness · {report.status === "BLOCKED" ? "Action required" : "Hardware validation required"}</h4>
    <p style={{ color: "#d3e3ed" }}>Saved revision {report.revision} · {report.mode === "simulated" ? "Simulation — no physical commissioning" : "Network mode — connection alone does not prove equipment readiness"}</p>
    {dirty && <p role="status" style={{ color: "#f5cf91" }}>Unsaved edits: this report describes the saved mapping. Save to update it.</p>}
    <details>
      <summary style={{ cursor: "pointer", color: "#d3e3ed" }}>Review checks and Siemens family compatibility</summary>
      <ul style={{ paddingLeft: 20 }}>{report.checks.map(check => <li key={check.code} style={{ margin: "10px 0", color: "#d3e3ed" }}>
        <b style={{ color: colors[check.state] || "#d3e3ed" }}>{check.state.toUpperCase()} · {check.title}</b>
        <div style={{ marginTop: 3 }}>{check.detail}</div>
      </li>)}</ul>
      <h5 style={{ color: "#ecf7ff" }}>TIA programmability is not universal AquaFlow compatibility</h5>
      {report.support_matrix.map(row => <p key={row.family} style={{ color: "#d3e3ed" }}><b>{row.family}</b> — {row.status}</p>)}
    </details>
  </section>;
}

export default function SiemensReadiness({ siteId, revision, dirty }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setReport(null); setError("");
    siemensRequest(`/${siteId}/readiness`).then(value => { if (active) setReport(value); })
      .catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [siteId, revision, reload]);
  if (error) return <p role="alert">Readiness check unavailable: {error} <button className="btn" onClick={() => setReload(n => n + 1)}>Retry readiness check</button></p>;
  return report ? <>
    <SiemensReadinessReport report={report} dirty={dirty} />
    <button className="btn" onClick={() => setReload(n => n + 1)}>Refresh saved-site readiness</button>
  </> : <p role="status">Checking the saved Siemens mapping…</p>;
}
