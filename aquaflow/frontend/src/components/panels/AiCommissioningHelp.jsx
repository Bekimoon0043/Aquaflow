// ✦ Ask AI (Preflight panel, PLC diagnostics) — Claude explains preflight warnings, PLC faults and
// sync problems in plain words with step-by-step on-site checks. Advice only: this component
// reads the preflight result, the PLC status it is given, GET /faults/alerts and the in-app log;
// it never sends, arms, starts or pulses anything.
import { useState } from "react";
import { useShowStore } from "../../store/showStore";
import { activeFaults, commissioningInput, requestCommissioningHelp } from "../../preflight/aiCommissioning";
import { aiErrorMessage } from "../../utils/aiError";

const card = { background: "#0a1520", border: "1px solid #1d3a50", borderRadius: 4, padding: 6, marginTop: 4, color: "#cce8ff", fontSize: 10 };

/**
 * @param {object} p
 * @param {Array} [p.issues] preflight Diagnostics
 * @param {object} [p.plc] PLC status from the Siemens site, [p.mode] its mode
 * @param {string} [p.site] short site summary, [p.note] extra text (e.g. the last error)
 */
export default function AiCommissioningHelp({ issues = [], plc = null, mode = null, site = "", note = "", label = "✦ Ask AI", post, get }) {
  const [state, setState] = useState({});
  const ask = async () => {
    setState({ loading: true });
    try {
      const faults = await activeFaults(get ? { get } : undefined);
      const logs = [...(note ? [note] : []), ...(useShowStore.getState().serverLogs || [])];
      const body = commissioningInput({ issues, plc, mode, faults, logs, site });
      if (!body.preflight.length && !body.plc && !body.faults.length && !body.logs.length) throw new Error("Nothing to explain yet: run preflight or connect the PLC first");
      setState({ help: await requestCommissioningHelp(body, post ? { post } : undefined) });
    } catch (e) { setState({ error: aiErrorMessage(e, "The AI commissioning helper") }); }
  };
  const { help } = state;
  return <div data-testid="ai-commissioning" style={{ marginTop: 6 }}>
    <button type="button" onClick={ask} disabled={state.loading}
      title="Optional: Claude explains these warnings and faults in plain words with on-site steps. Advice only — nothing is sent to the equipment. Uses your Anthropic key (Your fountain → AI director)."
      style={{ padding: "3px 10px", background: "#0a1825", color: "#9fd8ff", border: "1px solid #2a5a7a", borderRadius: 3, cursor: state.loading ? "wait" : "pointer", fontFamily: "monospace", fontSize: 10 }}>
      {state.loading ? "Asking…" : label}
    </button>
    {state.error && <div role="alert" style={{ color: "#ff8866", fontSize: 10, marginTop: 4 }}>{state.error}</div>}
    {help && <div style={card}>
      {help.summary && <div style={{ marginBottom: 4 }}>{help.summary}</div>}
      {(help.safety || []).length > 0 && <div role="note" style={{ color: "#f6d795", border: "1px solid #b98539", borderRadius: 3, padding: 4, marginBottom: 4 }}>
        {(help.safety || []).map((s, i) => <div key={i}>⚠ {s}</div>)}
      </div>}
      <ol style={{ margin: 0, paddingLeft: 16 }}>
        {(help.steps || []).map((s, i) => <li key={i} data-testid="ai-step" style={{ marginBottom: 4 }}>
          <b>{s.title}</b>
          {s.detail && <div>{s.detail}</div>}
          {s.check && <div style={{ color: "#8fd" }}>Check: {s.check}</div>}
          {s.relatedIds?.length > 0 && <div style={{ color: "#556677" }}>Related: {s.relatedIds.join(", ")}</div>}
        </li>)}
      </ol>
      <div style={{ color: "#556677", fontSize: 9 }}>Advice from {help.model || "Claude"} — AquaFlow sent nothing to the equipment.</div>
    </div>}
  </div>;
}
