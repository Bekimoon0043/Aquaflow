import { useEffect, useRef, useState } from "react";
import { siemensRequest } from "../../../utils/siemensSite";
import { explainS7Error } from "../../../utils/siemensDevices";
import SiemensTerm from "./SiemensTerm";

const PERMITS = [["E-stop", 2], ["Level", 4], ["Thermal", 8], ["Drive", 16], ["Pressure", 32]];

export function plcStateText(header = {}, live = {}) {
  if (header.plc_running) return "RUNNING";
  if (header.plc_ready) return "READY";
  return live.armed || live.running ? "NOT READY" : "IDLE · waiting for Arm";
}

export function commandText(channel, value) {
  if (value == null) return "—";
  if (channel.kind === "light") return typeof value === "object" ? `RGB ${value.red}/${value.green}/${value.blue}` : "—";
  if (channel.kind === "valve") return value > 0 ? "OPEN" : "CLOSED";
  return `${Number(value).toFixed(0)}%`;
}

export function feedbackText(channel, fb) {
  if (!fb) return "—";
  if (fb.kind === "pump") return `${fb.running ? "RUNNING" : "STOPPED"} ${fb.applied_percent.toFixed(0)}%${fb.fault ? " FAULT" : ""}`;
  if (fb.kind === "valve") return fb.open ? "OPEN" : "CLOSED";
  return `RGB ${fb.rgb.join("/")}`;
}

// What the PLC (PLCSIM or real) holds in the AquaFlow data block right now, like a TIA watch table.
export default function SiemensPlcMonitor({ site }) {
  const [live, setLive] = useState(null);
  const [beat, setBeat] = useState({ last: null, moving: false });
  const lastBeat = useRef(null);
  useEffect(() => {
    let alive = true;
    const poll = () => siemensRequest(`/${site.id}/plc-live`).then(data => {
      if (!alive) return;
      const hb = data.header?.plc_heartbeat;
      setBeat({ last: hb, moving: hb != null && lastBeat.current != null && hb !== lastBeat.current });
      lastBeat.current = hb ?? lastBeat.current;
      setLive(data);
    }).catch(e => alive && setLive({ source: "error", error: e.message }));
    poll();
    const timer = setInterval(poll, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [site.id, site.revision]);
  if (!live) return null;
  if (live.source === "preview") return <div className="s7-card s7-card--bad"><b>Internal preview: no PLC is connected.</b> PLCSIM / TIA Portal will not change in this mode. Switch to “PLCSIM test PLC” in the Connect step.</div>;
  if (live.source === "not_connected") return <div className="s7-card s7-card--warn"><b>PLC monitor</b><p>Not connected yet. Click Verify in the Connect step; the monitor then reads DB{site.plc.db} from {site.mode === "plcsim" ? "PLCSIM" : "the PLC"} every second.</p></div>;
  if (live.source === "error") return <div className="s7-card s7-card--bad"><b>PLC monitor: read failed</b><p>{explainS7Error(live.error, site) || live.error}</p></div>;
  const h = live.header || {};
  const fault = h.fault && h.fault !== "none" && !(h.fault === "command_watchdog_expired" && !live.armed && !live.running);
  return <div className="s7-card s7-card--ok">
    <div className="s7-row"><b>Live from {site.mode === "plcsim" ? "PLCSIM" : "the PLC"} · DB{site.plc.db}</b>
      <span className={`s7-badge ${beat.moving || live.running ? "s7-badge--ok" : "s7-badge--warn"}`}><SiemensTerm k="heartbeat">heartbeat</SiemensTerm> {h.plc_heartbeat ?? "?"}{beat.moving || live.running ? " · moving" : ""}</span>
      <span className={`s7-badge ${h.plc_running ? "s7-badge--ok" : "s7-badge--muted"}`}>{plcStateText(h, live)}</span>
      <span className={`s7-badge ${h.watchdog_healthy ? "s7-badge--ok" : live.armed || live.running ? "s7-badge--bad" : "s7-badge--muted"}`}><SiemensTerm k="watchdog">watchdog</SiemensTerm> {h.watchdog_healthy ? "OK" : live.armed || live.running ? "EXPIRED" : "idle (outputs held OFF)"}</span>
      {fault && <span className="s7-badge s7-badge--bad">fault: {h.fault}</span>}
      <span style={{ color: "var(--text-muted)" }}>command #{h.command_sequence ?? "?"} · acknowledged #{h.ack ?? "?"}</span>
    </div>
    <div className="s7-row" style={{ marginTop: 6 }}>{PERMITS.map(([label, bit]) => <span key={label} className={`s7-badge ${h.permit_bits & bit ? "s7-badge--ok" : "s7-badge--bad"}`}>{label} {h.permit_bits & bit ? "OK" : "NOT OK"}</span>)}</div>
    <table className="s7-table" style={{ marginTop: 8 }}>
      <thead><tr><th>Device</th><th>Tag</th><th>AquaFlow command</th><th>PLC applied / feedback</th></tr></thead>
      <tbody>{site.channels.map(channel => {
        const fb = live.feedback?.[channel.id];
        const active = fb && (fb.open || fb.running || fb.applied_percent > 0 || fb.rgb?.some(Boolean));
        return <tr key={channel.id}><td>{channel.name}</td><td className="s7-mono">{channel.tag || ""}</td>
          <td className="s7-mono">{commandText(channel, live.values?.[channel.id])}</td>
          <td className="s7-mono" style={{ color: active ? "#4cc38a" : undefined }}>{feedbackText(channel, fb)}</td></tr>;
      })}</tbody>
    </table>
    <p>{live.running ? "Values update with every frame AquaFlow sends." : "Read-only: AquaFlow is only reading. In TIA Portal, open DB" + site.plc.db + " and click Monitor all to see the same values."}</p>
  </div>;
}
