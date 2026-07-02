import { useState, useEffect, useRef } from "react";
import { API_BASE_URL } from "../../config";

const API = API_BASE_URL;

const STATE_COLORS = {
  SAFE_IDLE:"#00aaff", ARMED:"#ffcc00", LIVE:"#00ff88",
  FAULT:"#ff4444", EMERGENCY_STOP:"#ff0000",
  RECOVERY:"#ff8800", MAINTENANCE:"#aa88ff", DRY_RUN:"#00ccaa", BOOT:"#556677",
};
const TRANSPORT_COLORS = {
  IDLE:"#556677", READY:"#00aaff", PLAYING:"#00ff88",
  PAUSED:"#ffcc00", STOPPED:"#aabbcc", FAULT:"#ff4444", ENDED:"#aa88ff",
};

function fmt(ms) {
  const s = Math.floor((ms||0)/1000);
  const m = Math.floor(s/60);
  return `${String(m).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
}

async function apiPost(path) {
  const res = await fetch(`${API}${path}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:"{}" });
  return res.json();
}

export default function OperatorPanel() {
  const [status, setStatus]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [log, setLog]         = useState([]);
  const pollRef = useRef(null);

  const poll = async () => {
    try {
      const res = await fetch(`${API}/operator/status`);
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  useEffect(() => {
    poll();
    pollRef.current = setInterval(poll, 500);
    return () => clearInterval(pollRef.current);
  }, []);

  const loadLatestBundle = async () => {
    setLoading(true);
    try {
      // Get list of compiled bundles
      const res = await fetch(`${API}/compiler/bundles`);
      const data = await res.json();
      const bundles = data.bundles || [];
      if (bundles.length === 0) {
        // No bundle — load show directly into transport using engine state
        const engine = status?.engine || {};
        const showId = engine.show_id || "show-001";
        const durationMs = Math.round((engine.duration || 240) * 1000);
        await fetch(`${API}/transport/load`, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ show_id: showId, duration_ms: durationMs })
        });
        setLog(l => [...l.slice(-19), { time: new Date().toLocaleTimeString(), msg: `Loaded show: ${showId} (${durationMs}ms)` }]);
      } else {
        // Load latest bundle
        const latest = bundles[0];
        const res2 = await fetch(`${API}/compiler/load/${latest.bundle_id}`, {
          method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"
        });
        const d = await res2.json();
        setLog(l => [...l.slice(-19), { time: new Date().toLocaleTimeString(), msg: `Loaded bundle: ${latest.bundle_id}` }]);
      }
      await poll();
    } catch(e) {
      setLog(l => [...l.slice(-19), { time: new Date().toLocaleTimeString(), msg: `Load error: ${e.message}`, err: true }]);
    }
    setLoading(false);
  };

  const act = async (path, label) => {
    setLoading(true);
    try {
      // For transport play, auto-load the current show first if transport is IDLE
      if (path === "/transport/play" && status?.transport?.state === "IDLE") {
        const engine = status?.engine || {};
        const showId = engine.show_id || "show-001";
        const durationMs = Math.round((engine.duration || 240) * 1000);
        await fetch(`${API}/compiler/load/${showId}`, {
          method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"
        }).catch(() => {
          // If no compiled bundle, load via transport directly
          fetch(`${API}/transport/load`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ show_id: showId, duration_ms: durationMs })
          });
        });
        await new Promise(r => setTimeout(r, 200));
      }
      const res = await fetch(`${API}${path}`, {
        method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"
      });
      const data = await res.json();
      const msg = data.ok === false ? `${label} — ${data.detail || "rejected"}` : label;
      setLog(l => [...l.slice(-19), { time: new Date().toLocaleTimeString(), msg, err: data.ok === false }]);
      await poll();
    } catch(e) {
      setLog(l => [...l.slice(-19), { time: new Date().toLocaleTimeString(), msg: `ERROR: ${e.message}`, err: true }]);
    }
    setLoading(false);
  };

  const safety    = status?.safety    || {};
  const transport = status?.transport || {};
  const engine    = status?.engine    || {};
  const sc = STATE_COLORS[safety.state]    || "#556677";
  const tc = TRANSPORT_COLORS[transport.state] || "#556677";
  const isLive    = safety.state === "LIVE" || transport.state === "PLAYING";
  const isFault   = safety.state === "FAULT" || safety.state === "EMERGENCY_STOP";

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#040810", color:"#cce8ff", fontFamily:"monospace", fontSize:"11px", overflow:"auto" }}>

      {/* Header */}
      <div style={{ padding:"8px 12px", borderBottom:"1px solid #0a2030", background:"#030608", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
        <span style={{ color:"#00aaff", fontSize:13, fontWeight:"bold" }}>OPERATOR PANEL</span>
        <div style={{ flex:1 }}/>
        <span style={{ color: isLive ? "#00ff88" : "#556677", fontSize:10 }}>
          {isLive ? "● LIVE" : "○ STANDBY"}
        </span>
      </div>

      <div style={{ display:"flex", gap:8, padding:8, flex:1, minHeight:0, overflow:"auto", flexWrap:"wrap" }}>

        {/* Safety state card */}
        <div style={{ flex:"1 1 180px", background:"#050d18", border:`1px solid ${sc}44`, borderRadius:6, padding:12 }}>
          <div style={{ color:"#556677", fontSize:9, marginBottom:6 }}>SAFETY STATE</div>
          <div style={{ color:sc, fontSize:20, fontWeight:"bold", marginBottom:8 }}>{safety.state || "—"}</div>
          {(safety.active_faults||[]).length > 0 && (
            <div style={{ marginBottom:8 }}>
              {safety.active_faults.map(f => (
                <div key={f} style={{ color:"#ff4444", fontSize:9, padding:"1px 0" }}>⚠ {f.replace(/_/g," ")}</div>
              ))}
            </div>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <button onClick={()=>act("/safety/arm","ARM")} style={btnStyle("#ffcc00")}>ARM</button>
            <button onClick={()=>act("/safety/disarm","DISARM")} style={btnStyle("#00aaff")}>DISARM</button>
            <button onClick={()=>act("/safety/dry-run","DRY RUN")} style={btnStyle("#00ccaa")}>DRY RUN</button>
            <button onClick={()=>act("/safety/reset","RESET FAULTS")} style={btnStyle("#00ff88")}>RESET FAULTS</button>
          </div>
          <button onClick={()=>act("/safety/estop","E-STOP")} style={{
            width:"100%", marginTop:8, padding:"10px 0",
            background:"#2a0000", color:"#ff0000",
            border:"2px solid #ff0000", borderRadius:4,
            cursor:"pointer", fontFamily:"monospace", fontSize:13, fontWeight:"bold",
          }}>⛔ E-STOP</button>
        </div>

        {/* Transport card */}
        <div style={{ flex:"1 1 180px", background:"#050d18", border:`1px solid ${tc}44`, borderRadius:6, padding:12 }}>
          <div style={{ color:"#556677", fontSize:9, marginBottom:6 }}>TRANSPORT</div>
          <div style={{ color:tc, fontSize:18, fontWeight:"bold", marginBottom:4 }}>{transport.state || "—"}</div>
          <div style={{ color:"#7ab", fontSize:12, marginBottom:10 }}>
            {fmt(transport.position_ms)} / {fmt(transport.duration_ms)}
          </div>
          {/* Progress bar */}
          <div style={{ height:4, background:"#0a1825", borderRadius:2, marginBottom:10, overflow:"hidden" }}>
            <div style={{ width:`${transport.duration_ms > 0 ? (transport.position_ms/transport.duration_ms*100) : 0}%`, height:"100%", background:tc, borderRadius:2, transition:"width 0.5s" }} />
          </div>
          <button onClick={loadLatestBundle} style={{
            width:"100%", marginBottom:6, padding:"5px 0",
            background: transport.state==="IDLE" ? "#001a10" : "#0a1825",
            color: transport.state==="IDLE" ? "#00ff44" : "#334455",
            border:`1px solid ${transport.state==="IDLE" ? "#00ff4444" : "#0a2030"}`,
            borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:10,
          }}>
            {transport.state === "IDLE" ? "↓ LOAD SHOW FIRST" : `✓ LOADED: ${transport.show_id || "—"}`}
          </button>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
            <button onClick={()=>act("/transport/play","PLAY")}  style={btnStyle("#00ff88")}>▶ PLAY</button>
            <button onClick={()=>act("/transport/pause","PAUSE")} style={btnStyle("#ffcc00")}>⏸ PAUSE</button>
            <button onClick={()=>act("/transport/stop","STOP")}  style={btnStyle("#ff6644")}>⏹ STOP</button>
            <button onClick={()=>act("/transport/recover","RECOVER")} style={btnStyle("#00aaff")}>↩ RECOVER</button>
          </div>
          <div style={{ marginTop:6, fontSize:9, color:"#334455" }}>
            Snapshots: {transport.snapshot_count || 0} · Ticks: {transport.tick_count || 0}
          </div>
        </div>

        {/* Signal levels */}
        <div style={{ flex:"1 1 180px", background:"#050d18", border:"1px solid #0a2030", borderRadius:6, padding:12 }}>
          <div style={{ color:"#556677", fontSize:9, marginBottom:8 }}>SIGNAL LEVELS</div>
          {[
            ["PUMP",    engine.pump    || 0, "#00aaff"],
            ["VALVE",   engine.valve   || 0, "#00ccaa"],
            ["LIGHT",   engine.lighting|| 0, "#ffcc00"],
            ["FLAME",   engine.flame   || 0, "#ff6600"],
            ["FOG",     engine.fog     || 0, "#aabbcc"],
            ["LASER",   engine.laser   || 0, "#ff00ff"],
          ].map(([label, val, color]) => (
            <div key={label} style={{ marginBottom:6 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                <span style={{ color:"#556677", fontSize:9 }}>{label}</span>
                <span style={{ color, fontSize:9, fontFamily:"monospace" }}>{Math.round((val||0)*100)}%</span>
              </div>
              <div style={{ height:3, background:"#0a1825", borderRadius:2, overflow:"hidden" }}>
                <div style={{ width:`${Math.round((val||0)*100)}%`, height:"100%", background:color, borderRadius:2, transition:"width 0.1s" }} />
              </div>
            </div>
          ))}
          <div style={{ marginTop:8, fontSize:9, color:"#334455" }}>
            BPM: {engine.bpm || "—"} · {engine.state === "playing" ? "▶ PLAYING" : "■ STOPPED"}
          </div>
        </div>

        {/* Device health */}
        <div style={{ flex:"1 1 180px", background:"#050d18", border:"1px solid #0a2030", borderRadius:6, padding:12 }}>
          <div style={{ color:"#556677", fontSize:9, marginBottom:8 }}>DEVICE HEALTH</div>
          {status?.devices ? (
            <div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, marginBottom:8 }}>
                {[
                  ["Online",  status.devices.online  || 0, "#00ff88"],
                  ["Offline", status.devices.offline || 0, "#ff4444"],
                  ["Warning", status.devices.warning || 0, "#ffcc00"],
                  ["Total",   status.devices.total   || 0, "#7ab"],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ padding:"4px 6px", background:"#0a1520", borderRadius:3 }}>
                    <div style={{ color:"#334455", fontSize:8 }}>{label}</div>
                    <div style={{ color, fontSize:14, fontWeight:"bold" }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ color:"#334455", fontSize:10 }}>Loading...</div>
          )}

          {/* Safety permits */}
          <div style={{ color:"#556677", fontSize:9, marginBottom:5, marginTop:4 }}>PERMITS</div>
          {[
            ["Master permit", safety.permit],
            ["Pump enable",   safety.pump_enable],
            ["Valve enable",  safety.valve_enable],
            ["Fog enable",    safety.fog_enable],
            ["Light enable",  safety.lighting_enable],
          ].map(([label, val]) => (
            <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"2px 0", borderBottom:"1px solid #0a1520" }}>
              <span style={{ color:"#7ab", fontSize:9 }}>{label}</span>
              <span style={{ color: val ? "#00ff88" : "#ff4444", fontSize:9 }}>{val ? "YES" : "NO"}</span>
            </div>
          ))}
        </div>

        {/* Recent faults + event log */}
        <div style={{ flex:"2 1 360px", background:"#050d18", border:"1px solid #0a2030", borderRadius:6, padding:12 }}>
          <div style={{ color:"#556677", fontSize:9, marginBottom:6 }}>RECENT FAULTS</div>
          {(status?.recent_faults||[]).length === 0 ? (
            <div style={{ color:"#223344", fontSize:9, marginBottom:10 }}>No recent faults</div>
          ) : (
            (status.recent_faults||[]).slice(0,3).map((ev,i) => (
              <div key={i} style={{ padding:"3px 6px", background:"#1a0808", borderRadius:3, marginBottom:3, fontSize:9, color:"#ff8866" }}>
                <span style={{ color:"#556677", marginRight:6 }}>{new Date((ev.timestamp||0)*1000).toLocaleTimeString()}</span>
                {ev.message}
              </div>
            ))
          )}

          <div style={{ color:"#556677", fontSize:9, marginBottom:6, marginTop:8, display:"flex", justifyContent:"space-between" }}>
            <span>OPERATOR LOG</span>
            <button onClick={()=>setLog([])} style={{ background:"none", border:"none", color:"#334455", cursor:"pointer", fontSize:9 }}>CLEAR</button>
          </div>
          <div style={{ overflowY:"auto", maxHeight:120 }}>
            {log.length === 0 && <div style={{ color:"#223344", fontSize:9 }}>No actions yet</div>}
            {[...log].reverse().map((e,i) => (
              <div key={i} style={{ padding:"2px 0", fontSize:9, color: e.err ? "#ff6644" : "#7ab", borderBottom:"1px solid #0a1520" }}>
                <span style={{ color:"#334455", marginRight:6 }}>{e.time}</span>{e.msg}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

function btnStyle(color) {
  return {
    padding:"5px 0", background:"#0a1825", color,
    border:`1px solid ${color}44`, borderRadius:3,
    cursor:"pointer", fontFamily:"monospace", fontSize:10,
  };
}
