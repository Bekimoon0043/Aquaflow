import { useState, useEffect, useMemo } from "react";
import { API_BASE_URL } from "../../config";
import useEngineeringStore from "../../store/engineeringStore";
import { FIXTURE_LIBRARY } from "../../data/fixtureLibrary";

const API = API_BASE_URL;

const NOZZLE_TYPES = ["geyser","jet_3d","arch","fan_jet","ring","cascade","mist"];

const DEFAULT_VENUE = {
  name: "Default Venue",
  elevation_m: 0,
  wind_speed_ms: 0,
  wind_direction_deg: 0,
  water_temp_c: 20,
  ambient_temp_c: 22,
};

const DEFAULT_NOZZLES = [
  { id:"n-center", label:"Center Geyser", type:"geyser",  pressure_kpa:180, height_mult:1.0, angle_offset:0, flow_correction:1.0 },
  { id:"n-inner-0",label:"Inner 1",       type:"jet_3d",  pressure_kpa:120, height_mult:1.0, angle_offset:0, flow_correction:1.0 },
  { id:"n-inner-1",label:"Inner 2",       type:"jet_3d",  pressure_kpa:120, height_mult:1.0, angle_offset:0, flow_correction:1.0 },
  { id:"n-arch-0", label:"Arch 1",        type:"arch",    pressure_kpa:150, height_mult:1.0, angle_offset:0, flow_correction:1.0 },
  { id:"n-arch-1", label:"Arch 2",        type:"arch",    pressure_kpa:150, height_mult:1.0, angle_offset:0, flow_correction:1.0 },
  { id:"n-fan-0",  label:"Fan Jet 1",     type:"fan_jet", pressure_kpa:100, height_mult:1.0, angle_offset:0, flow_correction:1.0 },
  { id:"n-mist-0", label:"Mist 1",        type:"mist",    pressure_kpa:60,  height_mult:0.8, angle_offset:0, flow_correction:1.0 },
];

// Calibration rows for the nozzles in the open Engineering design (falls back to samples).
export function nozzlesFromDesign(fixtures = []) {
  const categories = new Map(FIXTURE_LIBRARY.map(item => [item.key, item.category]));
  return fixtures
    .filter(f => f?.id && (categories.get(f.type) === "Nozzles" || String(f.type || "").startsWith("nozzle")))
    .map(f => {
      const bar = Number(f.engineering?.pressureBar ?? FIXTURE_LIBRARY.find(i => i.key === f.type)?.engineering?.pressureBar) || 1;
      return { id: f.id, label: f.label || f.type, type: String(f.type).replace(/^nozzle_/, ""),
        pressure_kpa: Math.round(bar * 100), height_mult: 1.0, angle_offset: 0, flow_correction: 1.0 };
    });
}

// Inputs this panel itself forced to a fault. "Undo test faults" restores only these,
// never forcing any other safety input to OK.
export function restoreBody(injected) {
  return Object.fromEntries([...injected].map(key => [key, true]));
}

export default function CalibrationPanel() {
  const fixtures = useEngineeringStore(s => s.fixtures);
  const designNozzles = useMemo(() => nozzlesFromDesign(fixtures), [fixtures]);
  const [tab, setTab]           = useState("nozzles");
  const [nozzles, setNozzles]   = useState(() => designNozzles.length ? designNozzles : DEFAULT_NOZZLES);
  const [injected, setInjected] = useState(() => new Set());
  const usingSamples = !designNozzles.length;
  useEffect(() => { if (designNozzles.length) setNozzles(designNozzles); }, [designNozzles]);
  const [venue, setVenue]       = useState(DEFAULT_VENUE);
  const [selected, setSelected] = useState(null);
  const [simActive, setSimActive] = useState(false);
  const [simValues, setSimValues] = useState({ pressure:180, flow:12.5, temp:22 });
  const [saved, setSaved]       = useState(false);

  // Simulated sensor readings — DISPLAY ONLY. This never writes to the safety kernel:
  // feeding fake "OK" inputs could hide a real fault on site.
  useEffect(() => {
    if (!simActive) return;
    const id = setInterval(() => {
      setSimValues({
        pressure: 170 + Math.random() * 20,
        flow:     11 + Math.random() * 3,
        temp:     21 + Math.random() * 2,
        water_level: 0.7 + Math.random() * 0.2,
      });
    }, 1000);
    return () => clearInterval(id);
  }, [simActive]);

  const updateNozzle = (id, field, value) => {
    setNozzles(prev => prev.map(n => n.id === id ? { ...n, [field]: value } : n));
  };

  const saveCalibration = async () => {
    // Persist to diagnostics log
    await fetch(`${API}/diagnostics/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: "info",
        category: "system",
        source: "calibration",
        message: `Calibration saved — ${nozzles.length} nozzles, venue: ${venue.name}`,
        data: { nozzles, venue },
      }),
    }).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const selectedNozzle = nozzles.find(n => n.id === selected);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#040810", color:"#cce8ff", fontFamily:"monospace", fontSize:"11px" }}>

      {/* Header */}
      <div style={{ padding:"8px 12px", borderBottom:"1px solid #0a2030", background:"#030608", display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
        <span style={{ color:"#00ccaa", fontWeight:"bold", fontSize:12 }}>⚙ CALIBRATION</span>
        <div style={{ flex:1 }}/>
        {saved && <span style={{ color:"#00ff88", fontSize:10 }}>✓ Saved</span>}
        <button onClick={saveCalibration} style={{ padding:"3px 10px", background:"#003520", color:"#00ff88", border:"1px solid #00aa4444", borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:10 }}>
          RECORD IN LOG
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:"1px solid #0a2030", background:"#030608", flexShrink:0 }}>
        {[["nozzles","Nozzles"],["venue","Venue Profile"],["simulation","Sim Feedback"]].map(([key,label]) => (
          <button key={key} onClick={()=>setTab(key)} style={{
            flex:1, padding:"6px 0", background:"transparent", border:"none",
            borderBottom: tab===key ? "2px solid #00ccaa" : "2px solid transparent",
            color: tab===key ? "#00ccaa" : "#334455",
            fontFamily:"monospace", fontSize:10, cursor:"pointer",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ flex:1, overflow:"auto", padding:10 }}>

        {/* ── NOZZLE CALIBRATION ── */}
        {tab === "nozzles" && (
          <div style={{ display:"flex", gap:10, height:"100%" }}>
            {/* Nozzle list */}
            <div style={{ width:180, flexShrink:0 }}>
              <div style={{ color:"#556677", fontSize:9, marginBottom:6 }}>SELECT NOZZLE</div>
              {usingSamples && <div style={{ color:"#c9a227", fontSize:9, marginBottom:6 }}>No design open — showing sample nozzles. Open your fountain in Engineering to calibrate its real nozzles.</div>}
              {nozzles.map(n => (
                <div key={n.id} onClick={()=>setSelected(n.id)} style={{
                  padding:"6px 8px", marginBottom:3, background:"#050d18",
                  border:`1px solid ${selected===n.id ? "#00ccaa44":"#0a2030"}`,
                  borderRadius:4, cursor:"pointer",
                  color: selected===n.id ? "#00ccaa" : "#7ab",
                }}>
                  <div style={{ fontSize:11 }}>{n.label}</div>
                  <div style={{ fontSize:9, color:"#334455" }}>{n.type} · {n.pressure_kpa} kPa</div>
                </div>
              ))}
            </div>

            {/* Nozzle editor */}
            {selectedNozzle ? (
              <div style={{ flex:1 }}>
                <div style={{ color:"#00ccaa", fontWeight:"bold", marginBottom:10, fontSize:12 }}>
                  {selectedNozzle.label}
                </div>
                {[
                  { key:"pressure_kpa",   label:"Pressure (kPa)",   min:0,   max:400, step:5  },
                  { key:"height_mult",    label:"Height multiplier", min:0.1, max:3.0, step:0.05 },
                  { key:"angle_offset",   label:"Angle offset (°)",  min:-30, max:30,  step:1  },
                  { key:"flow_correction",label:"Flow correction",   min:0.5, max:2.0, step:0.01 },
                ].map(field => (
                  <div key={field.key} style={{ marginBottom:10 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ color:"#7ab", fontSize:10 }}>{field.label}</span>
                      <span style={{ color:"#00ccaa", fontSize:10, fontFamily:"monospace" }}>
                        {Number(selectedNozzle[field.key]).toFixed(field.step < 1 ? 2 : 0)}
                      </span>
                    </div>
                    <input type="range"
                      min={field.min} max={field.max} step={field.step}
                      value={selectedNozzle[field.key]}
                      onChange={e=>updateNozzle(selectedNozzle.id, field.key, parseFloat(e.target.value))}
                      style={{ width:"100%" }}
                    />
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, color:"#334455" }}>
                      <span>{field.min}</span><span>{field.max}</span>
                    </div>
                  </div>
                ))}

                {/* Estimated performance */}
                <div style={{ background:"#050d18", border:"1px solid #0a2030", borderRadius:5, padding:8, marginTop:6 }}>
                  <div style={{ color:"#556677", fontSize:9, marginBottom:5 }}>ESTIMATED PERFORMANCE</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
                    {[
                      ["Jet height", `${(selectedNozzle.height_mult * selectedNozzle.pressure_kpa / 30).toFixed(1)} m`],
                      ["Flow rate",  `${(selectedNozzle.flow_correction * selectedNozzle.pressure_kpa / 15).toFixed(1)} L/s`],
                      ["Throw dist", `${(selectedNozzle.pressure_kpa / 25 * 0.8).toFixed(1)} m`],
                      ["Wind drift", `${(venue.wind_speed_ms * 0.3).toFixed(1)} m`],
                    ].map(([k,v]) => (
                      <div key={k} style={{ padding:"4px 6px", background:"#0a1520", borderRadius:3 }}>
                        <div style={{ fontSize:8, color:"#334455" }}>{k}</div>
                        <div style={{ fontSize:12, color:"#00ccaa", fontWeight:"bold" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#223344" }}>
                Select a nozzle to calibrate
              </div>
            )}
          </div>
        )}

        {/* ── VENUE PROFILE ── */}
        {tab === "venue" && (
          <div>
            <div style={{ color:"#556677", fontSize:9, marginBottom:8 }}>VENUE PROFILE</div>
            {[
              { key:"name",              label:"Venue name",         type:"text" },
              { key:"elevation_m",       label:"Elevation (m)",      type:"number", min:0,    max:5000 },
              { key:"wind_speed_ms",     label:"Wind speed (m/s)",   type:"number", min:0,    max:20 },
              { key:"wind_direction_deg",label:"Wind direction (°)", type:"number", min:0,    max:360 },
              { key:"water_temp_c",      label:"Water temp (°C)",    type:"number", min:0,    max:40 },
              { key:"ambient_temp_c",    label:"Ambient temp (°C)",  type:"number", min:-20,  max:50 },
            ].map(field => (
              <div key={field.key} style={{ marginBottom:8 }}>
                <div style={{ color:"#7ab", fontSize:9, marginBottom:3 }}>{field.label}</div>
                <input
                  type={field.type}
                  value={venue[field.key]}
                  min={field.min} max={field.max}
                  onChange={e=>setVenue(v=>({ ...v, [field.key]: field.type==="number" ? parseFloat(e.target.value)||0 : e.target.value }))}
                  style={{ width:"100%", padding:"4px 8px", background:"#0a1825", color:"#cce8ff", border:"1px solid #0a2535", borderRadius:3, fontFamily:"monospace", fontSize:10 }}
                />
              </div>
            ))}

            {/* Wind compensation preview */}
            <div style={{ background:"#050d18", border:"1px solid #0a2030", borderRadius:5, padding:8, marginTop:8 }}>
              <div style={{ color:"#556677", fontSize:9, marginBottom:5 }}>WIND COMPENSATION</div>
              <div style={{ color:"#7ab", fontSize:10 }}>
                {venue.wind_speed_ms < 2 ? "No compensation needed" :
                 venue.wind_speed_ms < 5 ? `Mild compensation: ${(venue.wind_speed_ms * 0.3).toFixed(1)}m drift expected` :
                 `Strong wind: ${(venue.wind_speed_ms * 0.3).toFixed(1)}m drift — reduce jet height`}
              </div>
            </div>
          </div>
        )}

        {/* ── SIMULATED FEEDBACK ── */}
        {tab === "simulation" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
              <div style={{ color:"#556677", fontSize:9 }}>SIMULATED SENSOR FEEDBACK</div>
              <div style={{ flex:1 }}/>
              <button onClick={()=>setSimActive(!simActive)} style={{
                padding:"4px 12px", background: simActive?"#003520":"#0a1825",
                color: simActive?"#00ff88":"#556677",
                border:`1px solid ${simActive?"#00aa4444":"#0a2030"}`,
                borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:10,
              }}>{simActive ? "⬤ SIM ACTIVE" : "○ START SIM"}</button>
            </div>

            <div style={{ fontSize:10, color:"#556677", marginBottom:10, lineHeight:1.6 }}>
              Simulation shows made-up sensor readings on this screen only. It never changes the safety system.
              Fault injection below forces a real safety input to FAULT (safe direction) to rehearse the recovery workflow on a bench. Never use it on a live fountain.
            </div>

            {/* Live sim values */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:10 }}>
              {[
                ["Manifold pressure", `${simValues.pressure?.toFixed(1)||"—"} kPa`,  "#00aaff"],
                ["Flow rate",         `${simValues.flow?.toFixed(2)||"—"} L/s`,       "#00ccaa"],
                ["Water temperature", `${simValues.temp?.toFixed(1)||"—"} °C`,        "#ffcc00"],
                ["Water level",       `${simValues.water_level ? Math.round(simValues.water_level*100)+"%" : "—"}`, "#aa88ff"],
              ].map(([label, value, color]) => (
                <div key={label} style={{ padding:"8px 10px", background:"#050d18", border:`1px solid ${simActive?"#0a3020":"#0a2030"}`, borderRadius:4 }}>
                  <div style={{ fontSize:9, color:"#334455", marginBottom:2 }}>{label}</div>
                  <div style={{ fontSize:14, color: simActive ? color : "#334455", fontWeight:"bold", fontFamily:"monospace" }}>
                    {simActive ? value : "—"}
                  </div>
                  {simActive && (
                    <div style={{ height:2, background:"#0a1825", borderRadius:1, marginTop:4, overflow:"hidden" }}>
                      <div style={{ width:"70%", height:"100%", background:color, borderRadius:1, animation:"pulse 1s ease-in-out infinite alternate" }}/>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Fault injection */}
            <div style={{ color:"#556677", fontSize:9, marginBottom:6 }}>FAULT INJECTION (for testing)</div>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {[
                { label:"Low water",    body:{ water_level_ok:false } },
                { label:"Over pressure",body:{ pressure_ok:false } },
                { label:"E-Stop open",  body:{ estop_chain_closed:false } },
                { label:"PLC loss",     body:{ plc_heartbeat_ok:false } },
              ].map(fault => (
                <button key={fault.label} onClick={()=>{
                  fetch(`${API}/safety/inputs`, {
                    method:"POST", headers:{"Content-Type":"application/json"},
                    body:JSON.stringify(fault.body)
                  }).then(() => setInjected(prev => new Set([...prev, ...Object.keys(fault.body)]))).catch(() => {});
                }} style={{
                  padding:"4px 8px", background:"#1a0808", color:"#ff8866",
                  border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:9,
                }}>{fault.label}</button>
              ))}
              <button disabled={!injected.size} title={injected.size ? `Restore only: ${[...injected].join(", ")}` : "No test faults injected from this screen"} onClick={async ()=>{
                if (!window.confirm(`Undo the test faults injected from this screen (${[...injected].join(", ")})?

Only these inputs are restored. Real sensors keep reporting their real state, and any other fault stays active.`)) return;
                await fetch(`${API}/safety/inputs`, {
                  method:"POST", headers:{"Content-Type":"application/json"},
                  body:JSON.stringify(restoreBody(injected))
                }).catch(() => {});
                await fetch(`${API}/safety/reset`, { method:"POST", headers:{"Content-Type":"application/json"}, body:"{}" }).catch(() => {});
                setInjected(new Set());
              }} style={{
                padding:"4px 8px", background:"#003520", color:"#00ff88",
                border:"1px solid #00aa4444", borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:9,
              }}>↩ UNDO TEST FAULTS{injected.size ? ` (${injected.size})` : ""}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
