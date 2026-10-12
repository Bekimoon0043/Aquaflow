import { useEffect, useState } from "react";
import useProjectStore from "../../../store/projectStore";
import { siemensRequest } from "../../../utils/siemensSite";
import SiemensIOMap from "./SiemensIOMap";
import "./siemensSetup.css";

// Stand-alone I/O map tab: the same view as the wizard's Wiring step, for the selected site.
export default function SiemensIOMapTab({ onOpenSetup }) {
  const siteId = useProjectStore(s => s.integrations.siemensSiteId);
  const updateIntegrations = useProjectStore(s => s.updateIntegrations);
  const [sites, setSites] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => { siemensRequest().then(r => setSites(r.sites)).catch(e => setError(e.message)); }, []);
  const site = sites.find(s => s.id === siteId);
  return <div className="s7">
    <h3>I/O map</h3>
    <div className="s7-row" style={{ marginBottom: 8 }}>
      <select aria-label="Siemens site" value={siteId || ""} onChange={e => updateIntegrations({ siemensSiteId: e.target.value || null })}>
        <option value="">Choose a Siemens site…</option>
        {sites.map(s => <option key={s.id} value={s.id}>{s.name} · rev {s.revision}</option>)}
      </select>
      {onOpenSetup && <button className="btn" onClick={onOpenSetup}>Open setup wizard</button>}
    </div>
    {error && <div className="s7-msg s7-msg--bad">{error}</div>}
    {site ? <SiemensIOMap site={site} onSaved={updated => setSites(list => list.map(s => s.id === updated.id ? updated : s))} onOpenHardware={onOpenSetup} />
      : <p>{sites.length ? "Choose a site to see which PLC tag drives which pump, valve, light and safety input." : "No Siemens site yet. Create one from your design in the setup wizard."}</p>}
  </div>;
}
