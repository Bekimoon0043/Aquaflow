import { useEffect, useState } from "react";
import useProjectStore from "../../../store/projectStore";
import { siemensRequest } from "../../../utils/siemensSite";

// Shows, inside the Engineering Designer, which Siemens PLC tags drive the selected item.
export function pointsForFixture(points = [], fixtureId) {
  if (!fixtureId) return { direct: [], viaValve: [] };
  const direct = points.filter(p => p.device_id === fixtureId || p.fixture_id === fixtureId);
  const viaValve = direct.length ? [] : points.filter(p => p.nozzle_ids?.includes(fixtureId));
  return { direct, viaValve };
}

export default function SiemensFixtureLink({ fixtureId }) {
  const siteId = useProjectStore(s => s.integrations?.siemensSiteId);
  const [points, setPoints] = useState(null);
  useEffect(() => {
    let alive = true;
    setPoints(null);
    if (!siteId || !fixtureId) return undefined;
    siemensRequest(`/${siteId}/io-map`).then(r => alive && setPoints(r.points)).catch(() => alive && setPoints([]));
    return () => { alive = false; };
  }, [siteId, fixtureId]);
  const box = { marginTop: 6, padding: "5px 6px", border: "1px solid #0a3040", borderRadius: 3, fontSize: 9, color: "#9cc", lineHeight: 1.5 };
  if (!siteId) return <div style={box}>Siemens wiring: no site selected (Devices → PLC → Siemens Setup).</div>;
  if (!points) return null;
  const { direct, viaValve } = pointsForFixture(points, fixtureId);
  const rows = direct.length ? direct : viaValve;
  if (!rows.length) return <div style={box}>Siemens wiring: this item is not driven by the selected PLC site.</div>;
  return <div style={box}>
    <div style={{ color: "#7ab", marginBottom: 2 }}>Siemens wiring{viaValve.length ? ` (via ${viaValve[0].device_name})` : ""}</div>
    {rows.map(p => <div key={`${p.device_id}-${p.role}`} style={{ fontFamily: "monospace", color: p.address ? "#ffcc00" : "#ff8a8a" }}>
      {p.plc_tag} · {p.address || "not wired"}{p.module ? ` · ${p.module}` : ""}
    </div>)}
  </div>;
}
