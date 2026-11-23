// AI director key (moved here from the Pattern Builder's music section).
// The key is stored by the AquaFlow engine on this computer, never in the project file.
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../utils/apiClient";

export default function AiDirectorSettings() {
  const [state, setState] = useState({ checked: false, sdk: false, configured: false });
  const [key, setKey] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    apiGet("/director/status")
      .then((s) => alive && setState({ checked: true, sdk: false, configured: false, ...s }))
      .catch(() => alive && setState({ checked: true, sdk: false, configured: false }));
    return () => { alive = false; };
  }, []);

  const save = () => apiPost("/director/key", { key })
    .then(() => { setKey(""); setState((s) => ({ ...s, configured: true })); setNote("Key saved on this computer"); })
    .catch((e) => setNote(`Could not save the key: ${e.message}`));

  const status = !state.checked ? "Checking the engine…"
    : !state.sdk ? "Not available in this engine"
    : state.configured ? "Ready (✦ AI director on the plan strip)"
    : "Needs an Anthropic API key";

  return (
    <div className="pref-ai-director" title="Optional: Claude (Anthropic) directs the show's arc from the song and your fountain.">
      <div className="pref-ai-director-head">
        <span>AI director</span>
        <small>{status}</small>
      </div>
      {state.sdk && (
        <div className="pref-ai-director-row">
          <input aria-label="Anthropic API key" type="password" className="input"
            placeholder={state.configured ? "Replace key…" : "sk-ant-…"} value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn" onClick={save} disabled={key.length < 10}>Save key</button>
        </div>
      )}
      {note && <small role="status">{note}</small>}
    </div>
  );
}
