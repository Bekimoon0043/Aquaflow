import React, { useState, useEffect, useRef } from "react";

const API = "http://localhost:8000/api";

const STATE_COLORS = {
  BOOT:            "#556677",
  SAFE_IDLE:       "#00aaff",
  ARMED:           "#ffcc00",
  LIVE:            "#00ff88",
  FAULT:           "#ff4444",
  EMERGENCY_STOP:  "#ff0000",
  RECOVERY:        "#ff8800",
  MAINTENANCE:     "#aa88ff",
  DRY_RUN:         "#00ccaa",
};

const TRANSPORT_COLORS = {
  IDLE:    "#334455",
  READY:   "#00aaff",
  PLAYING: "#00ff88",
  PAUSED:  "#ffcc00",
  STOPPED: "#aabbcc",
  FAULT:   "#ff4444",
  ENDED:   "#aa88ff",
};

const FAULT_LABELS = {
  LOW_WATER:        "Low Water Level",
  OVER_PRESSURE:    "Over Pressure",
  PUMP_DRY_RUN:     "Pump Dry Run",
  VALVE_TIMEOUT:    "Valve Timeout",
  VFD_FAULT:        "VFD Fault",
  PLC_COMM_LOSS:    "PLC Comm Loss",
  THERMAL_OVERLOAD: "Thermal Overload",
  FLAME_INHIBIT:    "Flame Inhibit",
  LASER_INHIBIT:    "Laser Inhibit",
  ESTOP_OPEN:       "E-Stop Chain Open",
  WATCHDOG_MISSED:  "Watchdog Missed",
  RUNTIME_FAULT:    "Runtime Fault",
};

async function apiPost(path, body = {}) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(path) {
  try {
    const res = await fetch(`${API}${path}`);
    return res.json();
  } catch { return null; }
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2,"0")}:${String(s%60).padStart(2,"0")}.${String(ms%1000).padStart(3,"0")}`;
}

export default function SafetyMonitorPanel() {
  const [safety, setSafety]     = useState(null);
  const [transport, setTransport] = useState(null);
  const [error, setError]       = useState(null);
  const [log, setLog]           = useState([]);
  const pollRef                 = useRef(null);

  const poll = async () => {
    const [s, t] = await Promise.all([
      apiGet("/safety/status"),
      apiGet("/transport/status"),
    ]);
    if (s) {
      // Detect state changes for log
      setSafety(prev => {
        if (prev && prev.state !== s.state) {
          setLog(l => [...l.slice(-19), {
            time: new Date().toLocaleTimeString(),
            msg: `Safety: ${prev.state} → ${s.state}`,
            level: s.state === "EMERGENCY_STOP" || s.state === "FAULT" ? "error" : "info",
          }]);
        }
        return s;
      });
    }
    if (t) setTransport(t);
  };

  useEffect(() => {
    poll();
    pollRef.current = setInterval(poll, 500);
    return () => clearInterval(pollRef.current);
  }, []);

  const action = async (path, body = {}) => {
    try {
      const r = await apiPost(path, body);
      setLog(l => [...l.slice(-19), {
        time: new Date().toLocaleTimeString(),
        msg: `→ ${path}: ${r.ok ? "OK" : JSON.stringify(r)}`,
        level: r.ok ? "ok" : "error",
      }]);
      await poll();
    } catch(e) {
      setLog(l => [...l.slice(-19), {
        time: new Date().toLocaleTimeString(),
        msg: `ERROR ${path}: ${e.message}`,
        level: "error",
      }]);
    }
  };

  const safetyState  = safety?.state || "—";
  const transportState = transport?.state || "—";
  const safetyColor  = STATE_COLORS[safetyState]  || "#556677";
  const transportColor = TRANSPORT_COLORS[transportState] || "#556677";
  const faults       = safety?.active_faults || [];
  const inputs       = safety?.inputs || {};

  return (
    <div style={{
      display:"flex", flexDirection:"column", height:"100%",
      background:"#040810", color:"#cce8ff", fontFamily:"monospace",
      fontSize:"11px", overflow:"auto",
    }}>

      {/* Header */}
      <div style={{ padding:"8px 12px", borderBottom:"1px solid #0a2030", background:"#030608", display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ color:"#ff4444", fontSize:13, fontWeight:"bold" }}>⚡ SAFETY MONITOR</span>
        <div style={{ flex:1 }} />
        <span style={{ color:"#334455", fontSize:9 }}>PHASE 6</span>
      </div>

      <div style={{ display:"flex", gap:8, padding:8, flex:1, minHeight:0, overflow:"auto" }}>

        {/* Left column — states + controls */}
        <div style={{ width:200, display:"flex", flexDirection:"column", gap:8, flexShrink:0 }}>

          {/* Safety state */}
          <div style={{ background:"#050d18", border:`1px solid ${safetyColor}44`, borderRadius:6, padding:10 }}>
            <div style={{ color:"#556677", fontSize:9, marginBottom:4 }}>SAFETY STATE</div>
            <div style={{ color:safetyColor, fontSize:16, fontWeight:"bold", letterSpacing:1 }}>
              {safetyState}
            </div>
            {faults.length > 0 && (
              <div style={{ marginTop:6 }}>
                {faults.map(f => (
                  <div key={f} style={{ color:"#ff4444", fontSize:9, padding:"2px 0" }}>
                    ⚠ {FAULT_LABELS[f] || f}
                  </div>
                ))}
              </div>
            )}
            {safety?.fault_message && (
              <div style={{ color:"#ff6644", fontSize:9, marginTop:4, fontStyle:"italic" }}>
                {safety.fault_message}
              </div>
            )}
          </div>

          {/* Transport state */}
          <div style={{ background:"#050d18", border:`1px solid ${transportColor}44`, borderRadius:6, padding:10 }}>
            <div style={{ color:"#556677", fontSize:9, marginBottom:4 }}>TRANSPORT</div>
            <div style={{ color:transportColor, fontSize:14, fontWeight:"bold" }}>
              {transportState}
            </div>
            {transport && (
              <div style={{ color:"#7ab", fontSize:10, marginTop:4 }}>
                {formatMs(transport.position_ms || 0)} / {formatMs(transport.duration_ms || 0)}
              </div>
            )}
          </div>

          {/* Safety controls */}
          <div style={{ background:"#050d18", border:"1px solid #0a2030", borderRadius:6, padding:10 }}>
            <div style={{ color:"#556677", fontSize:9, marginBottom:6 }}>SAFETY CONTROLS</div>
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              {[
                { label:"ARM",         path:"/safety/arm",         color:"#ffcc00" },
                { label:"DISARM",      path:"/safety/disarm",      color:"#00aaff" },
                { label:"DRY RUN",     path:"/safety/dry-run",     color:"#00ccaa" },
                { label:"MAINTENANCE", path:"/safety/maintenance",  color:"#aa88ff" },
                { label:"RESET FAULTS",path:"/safety/reset",       color:"#00ff88" },
              ].map(b => (
                <button key={b.label} onClick={()=>action(b.path)} style={{
                  padding:"5px 0", background:"#0a1825", color:b.color,
                  border:`1px solid ${b.color}44`, borderRadius:3,
                  cursor:"pointer", fontFamily:"monospace", fontSize:10,
                }}>{b.label}</button>
              ))}
              {/* E-STOP — big red */}
              <button onClick={()=>action("/safety/estop")} style={{
                padding:"8px 0", background:"#2a0000", color:"#ff0000",
                border:"2px solid #ff0000", borderRadius:4, marginTop:4,
                cursor:"pointer", fontFamily:"monospace", fontSize:12, fontWeight:"bold",
                letterSpacing:2,
              }}>⛔ E-STOP</button>
            </div>
          </div>

          {/* Transport controls */}
          <div style={{ background:"#050d18", border:"1px solid #0a2030", borderRadius:6, padding:10 }}>
            <div style={{ color:"#556677", fontSize:9, marginBottom:6 }}>TRANSPORT</div>
            <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
              {[
                { label:"▶ PLAY",  path:"/transport/play",   color:"#00ff88" },
                { label:"⏸ PAUSE", path:"/transport/pause",  color:"#ffcc00" },
                { label:"⏹ STOP",  path:"/transport/stop",   color:"#ff6644" },
                { label:"↩ RECOVER",path:"/transport/recover",color:"#00aaff" },
              ].map(b => (
                <button key={b.label} onClick={()=>action(b.path)} style={{
                  padding:"4px 8px", background:"#0a1825", color:b.color,
                  border:`1px solid ${b.color}44`, borderRadius:3,
                  cursor:"pointer", fontFamily:"monospace", fontSize:9, flex:1,
                }}>{b.label}</button>
              ))}
            </div>
            <button onClick={()=>action("/transport/rollback",{steps:1})} style={{
              width:"100%", marginTop:5, padding:"4px 0",
              background:"#0a1520", color:"#7799bb",
              border:"1px solid #0a2535", borderRadius:3,
              cursor:"pointer", fontFamily:"monospace", fontSize:9,
            }}>↩ ROLLBACK 1 STEP</button>
          </div>
        </div>

        {/* Right column — interlocks + log */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", gap:8, minWidth:0 }}>

          {/* Interlock grid */}
          <div style={{ background:"#050d18", border:"1px solid #0a2030", borderRadius:6, padding:10 }}>
            <div style={{ color:"#556677", fontSize:9, marginBottom:8 }}>INTERLOCKS & PERMITS</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
              {[
                ["Water Level",     inputs.water_level_ok,     true],
                ["Pressure OK",     inputs.pressure_ok,        true],
                ["E-Stop Chain",    inputs.estop_chain_closed,  true],
                ["PLC Heartbeat",   inputs.plc_heartbeat_ok,   true],
                ["Flame Permit",    inputs.flame_permit,       false],
                ["Laser Permit",    inputs.laser_permit,       false],
                ["Safety Permit",   safety?.permit,            true],
                ["Pump Enable",     safety?.pump_enable,       true],
                ["Valve Enable",    safety?.valve_enable,      true],
                ["Flame Enable",    safety?.flame_enable,      false],
                ["Fog Enable",      safety?.fog_enable,        true],
                ["Lighting Enable", safety?.lighting_enable,   true],
              ].map(([label, val, critical]) => (
                <div key={label} style={{
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"3px 6px", background:"#0a1520", borderRadius:3,
                  border:`1px solid ${val ? "#0a3020" : (critical ? "#3a0a0a" : "#1a1a2a")}`,
                }}>
                  <span style={{ color:"#7ab", fontSize:9 }}>{label}</span>
                  <span style={{
                    color: val ? "#00ff88" : (critical ? "#ff4444" : "#334455"),
                    fontSize:9, fontWeight:"bold",
                  }}>{val ? "OK" : (val === undefined ? "—" : "NO")}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Transport details */}
          {transport && (
            <div style={{ background:"#050d18", border:"1px solid #0a2030", borderRadius:6, padding:10 }}>
              <div style={{ color:"#556677", fontSize:9, marginBottom:6 }}>TRANSPORT DETAILS</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:4 }}>
                {[
                  ["Show ID",     transport.show_id || "—"],
                  ["Ticks",       transport.tick_count || 0],
                  ["Snapshots",   transport.snapshot_count || 0],
                ].map(([k,v]) => (
                  <div key={k} style={{ padding:"3px 6px", background:"#0a1520", borderRadius:3 }}>
                    <div style={{ color:"#334455", fontSize:8 }}>{k}</div>
                    <div style={{ color:"#7ab", fontSize:10 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Event log */}
          <div style={{ background:"#050d18", border:"1px solid #0a2030", borderRadius:6, padding:10, flex:1, minHeight:0 }}>
            <div style={{ color:"#556677", fontSize:9, marginBottom:6, display:"flex", justifyContent:"space-between" }}>
              <span>EVENT LOG</span>
              <button onClick={()=>setLog([])} style={{ background:"none", border:"none", color:"#334455", cursor:"pointer", fontSize:9 }}>CLEAR</button>
            </div>
            <div style={{ overflowY:"auto", maxHeight:180 }}>
              {log.length === 0 && <div style={{ color:"#223344", fontSize:9 }}>No events yet</div>}
              {[...log].reverse().map((entry, i) => (
                <div key={i} style={{
                  padding:"2px 0", borderBottom:"1px solid #0a1520",
                  color: entry.level === "error" ? "#ff6644" : entry.level === "ok" ? "#00ff88" : "#7ab",
                  fontSize:9,
                }}>
                  <span style={{ color:"#334455", marginRight:6 }}>{entry.time}</span>
                  {entry.msg}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
