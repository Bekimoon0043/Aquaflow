/**
 * RealismReport.jsx — the 3D preview's "Real-world" sidebar section: the real-world /
 * artistic toggle and the realism report (realWorldLook.realismReport): what in the
 * preview rests on generic estimates, and which non-physical overrides are ignored.
 */
import { useMemo, useState } from "react";
import { fixturesToNozzleConfigs } from "../../hooks/fixtureTypeMap";
import { realismReport } from "./realWorldLook";

const LEVEL_STYLE = {
  ignored: { color: "#ffbe46", mark: "⚠" },
  estimate: { color: "#8ea4b8", mark: "≈" },
  info: { color: "#58c7ff", mark: "ℹ" },
};

export function useRealismReport(fixtures, realWorld) {
  return useMemo(() => {
    try {
      const { nozzleConfigs, lightConfigs } = fixturesToNozzleConfigs(Array.isArray(fixtures) ? fixtures : []);
      return realismReport(nozzleConfigs, lightConfigs, { realWorld });
    } catch {
      return [];
    }
  }, [fixtures, realWorld]);
}

export default function RealismReport({ fixtures, realWorld, onToggle }) {
  const items = useRealismReport(fixtures, realWorld);
  const [open, setOpen] = useState(null);
  return (
    <div data-testid="realism-report">
      <label title="On: water and light look only as the specified equipment will (nozzle family, outlet, pressure, real lights). Off: manual looks are drawn and every frame is stamped “Artistic preview”."
        style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6, color:"var(--text-primary)", fontSize:11 }}>
        <input type="checkbox" checked={realWorld} onChange={e => onToggle(e.target.checked)} />
        Real-world simulation
      </label>
      {!realWorld && (
        <div style={{ color:"var(--warn)", fontSize:11, marginBottom:6 }}>
          Artistic preview — not real-world. Exports are stamped.
        </div>
      )}
      <div style={{ color:"var(--text-muted)", fontSize:11, marginBottom:4 }}>
        Realism report{items.length ? ` · ${items.length}` : ""}
      </div>
      {items.length === 0 && (
        <div style={{ color:"var(--ok)", fontSize:11, marginBottom:6 }}>No estimates or ignored overrides.</div>
      )}
      <ul style={{ listStyle:"none", margin:0, padding:0, marginBottom:6 }}>
        {items.map(it => {
          const st = LEVEL_STYLE[it.level] || LEVEL_STYLE.info;
          const shown = open === it.id;
          return (
            <li key={it.id} style={{ fontSize:11, lineHeight:1.35, marginBottom:4, color:"var(--info)" }}>
              <span style={{ color: st.color, marginRight:4 }}>{st.mark}</span>{it.text}
              {it.ids.length > 0 && (
                <button onClick={() => setOpen(shown ? null : it.id)}
                  style={{ marginLeft:4, fontSize:11, padding:"0 4px", background:"none", color:"var(--info)", border:"1px solid var(--info)", borderRadius:3, cursor:"pointer" }}>
                  {shown ? "hide" : "ids"}
                </button>
              )}
              {shown && (
                <div style={{ color:"var(--text-muted)", fontFamily:"monospace", fontSize:11, wordBreak:"break-word", marginTop:2 }}>
                  {it.ids.slice(0, 120).join(", ")}{it.ids.length > 120 ? ` … +${it.ids.length - 120}` : ""}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
