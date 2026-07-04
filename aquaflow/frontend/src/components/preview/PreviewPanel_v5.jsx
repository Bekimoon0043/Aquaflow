/**
 * PreviewPanel_v5.jsx — Full 3D Preview with Engineering Sync
 * - Proper mouse orbit (drag to rotate, scroll to zoom, right-click pan)
 * - Full rendering options panel
 * - Engineering design live sync
 * - Quality presets
 * - Screenshot and video export
 */
import { deriveRuntimeSignals } from "../../utils/runtimeSignalSelector";
import { useEffect, useRef, useState, useCallback } from "react";
import { FountainScene, ENVIRONMENTS, CAMERA_MODES, RENDER_QUALITY } from "./FountainScene_v6";
import { useEngineeringSync } from "../../hooks/useEngineeringSync";
import useEngineeringStore from "../../store/engineeringStore";
import { useShowStore } from "../../store/showStore";

// ─── NEW: Dry-run preview support ──────────────────────────────────────────
// This will be populated by ShowProgrammerPanel via prop or context
// For now, we'll check for a global variable
const getDryRunSession = () => {
  if (typeof window !== 'undefined' && window.__dryRunSession) {
    return window.__dryRunSession;
  }
  return null;
};

const ENVS = [
  { key:"night", label:"Night",  color:"#030810" },
  { key:"dusk",  label:"Dusk",   color:"#180820" },
  { key:"day",   label:"Day",    color:"#6ab4d8" },
  { key:"arena", label:"Arena",  color:"#010305" },
];
const CAMS = [
  { key:"orbit",      label:"Orbit",    icon:"↻" },
  { key:"front",      label:"Front",    icon:"▣" },
  { key:"top",        label:"Top",      icon:"⬆" },
  { key:"aerial",     label:"Aerial",   icon:"◎" },
  { key:"flythrough", label:"Fly",      icon:"→" },
  { key:"dramatic",   label:"Rise",     icon:"↑" },
  { key:"audience",   label:"Crowd",    icon:"👥" },
];
const PATTERNS = ["none","wave","pulse","ripple","chase","burst","alternate","spiral","firework"];
const LIGHT_PRESETS = [
  { color:"#0066ff", label:"Blue" },
  { color:"#00aaff", label:"Cyan" },
  { color:"#00ffcc", label:"Teal" },
  { color:"#ffffff", label:"White" },
  { color:"#ff6600", label:"Amber" },
  { color:"#ff0088", label:"Pink" },
  { color:"#aa00ff", label:"Purple" },
  { color:"#ffcc00", label:"Gold" },
];

export default function PreviewPanel() {
  const canvasRef    = useRef(null);
  const sceneRef     = useRef(null);
  const containerRef = useRef(null);

  // View state
  const [env,      setEnv]      = useState("night");
  const [cam,      setCam]      = useState("orbit");
  const [quality,  setQuality]  = useState("medium");
  const [pattern,  setPattern]  = useState("none");
  const [lightCol, setLightCol] = useState("#0066ff");
  const [windX,    setWindX]    = useState(0);
  const [windZ,    setWindZ]    = useState(0);

  // Panel visibility
  const [tab, setTab] = useState("render"); // render | signals | info

  // Signals for manual override
  const [signals, setSignals] = useState({
    pump:0.75, valve:0.5, lighting:0.65, flame:0, fog:0, laser:0
  });
  const [recording, setRecording] = useState(false);
  
  // ─── NEW: Dry-run preview state ──────────────────────────────────────────
  const [useDryRunPreview, setUseDryRunPreview] = useState(false);
  const [dryRunState, setDryRunState] = useState(null);
  const lastDryRunRef = useRef(null);

  // 4K Video Export (AQ-S3-007)
  const [exportRes, setExportRes] = useState("1080p");
  const [exportFps, setExportFps] = useState(60);

  // VR Walkthrough (AQ-S3-006)
  const [vrSupported, setVrSupported] = useState(false);
  const [presenting,  setPresenting]  = useState(false);
  const [tourCaption, setTourCaption] = useState("");

  const enterVR = useCallback(() => { sceneRef.current?.enterVR?.(); }, []);
  const togglePresentation = useCallback(() => {
    const scene = sceneRef.current; if (!scene) return;
    if (presenting) {
      scene.stopPresentation?.();
      setPresenting(false); setTourCaption("");
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } else {
      scene.startPresentation?.(null, (cap) => setTourCaption(cap || ""));
      setPresenting(true);
      containerRef.current?.requestFullscreen?.().catch(() => {});
    }
  }, [presenting]);
  
  // Check for dry-run session every second when mode is enabled
  useEffect(() => {
    if (!useDryRunPreview) {
      setDryRunState(null);
      lastDryRunRef.current = null;
      return;
    }

    const interval = setInterval(() => {
      const session = getDryRunSession();

      if (session !== lastDryRunRef.current) {
        lastDryRunRef.current = session;
        setDryRunState(session || null);
      }
    }, 250);

    return () => {
      clearInterval(interval);
    };
  }, [useDryRunPreview]);

  // Engineering store
  const projectName  = useEngineeringStore(s => s.projectName);
  const fixtureCount = useEngineeringStore(s => s.fixtures.length);
  const hydraulics   = useEngineeringStore(s => s.hydraulicSummary);
  const poolType     = useEngineeringStore(s => s.poolType);
  const params       = useEngineeringStore(s => s.params);
  const timelineTracks = useShowStore(s => s.timelineTracks);
const playhead = useShowStore(s => s.playhead);
const playbackState = useShowStore(s => s.playbackState);
const manualPatterns = useShowStore(s => s.manualPatterns);
const manualPatternMeta = useShowStore(s => s.manualPatternMeta);
const manualPriority = useShowStore(s => s.manualPriority);

// ─── NEW: Use dry-run session if enabled ──────────────────────────────────
let engineSignals;

if (useDryRunPreview && dryRunState && dryRunState.evaluateAllChannels) {
  // Use dry-run preview session instead of timeline
  const channelState = dryRunState.evaluateAllChannels(playhead);
  
  // Convert channel state to expected signal format
  let pumpValue = 0;
  let valveValue = 0;
  let lightingIntensity = 0;
  let lightingR = 1, lightingG = 1, lightingB = 1;
  let flameValue = 0;
  let fogValue = 0;
  let laserValue = 0;
  
  // Extract values from channel state
  for (const [deviceId, channels] of Object.entries(channelState)) {
    for (const [channelId, value] of Object.entries(channels)) {
      if (channelId === 'intensity') lightingIntensity = Math.max(lightingIntensity, value);
      if (channelId === 'r') lightingR = value;
      if (channelId === 'g') lightingG = value;
      if (channelId === 'b') lightingB = value;
      if (channelId === 'pump_speed') pumpValue = Math.max(pumpValue, value);
      if (channelId === 'enable') valveValue = Math.max(valveValue, value);
      if (channelId === 'flame') flameValue = Math.max(flameValue, value);
      if (channelId === 'fog_density') fogValue = Math.max(fogValue, value);
      if (channelId === 'laser_beam' || channelId === 'laser_pattern') laserValue = Math.max(laserValue, value);
    }
  }
  
  engineSignals = {
    source: 'dry-run-preview',
    pump: pumpValue,
    valve: valveValue,
    lighting: lightingIntensity,
    flame: flameValue,
    fog: fogValue,
    laser: laserValue,
    lightingColor: { r: lightingR, g: lightingG, b: lightingB },
  activeClips: dryRunState.getAllEvents().filter(
    e => Math.abs((e.time ?? 0) - playhead) <= 0.05
  ),
    groups: {
      center_jets: pumpValue * 0.8,
      arch_jets: valveValue,
      rgb_lights: lightingIntensity,
      flame_units: flameValue,
      fog_machines: fogValue,
      laser_units: laserValue,
    },
    effectivePriority: 2,
  };
} else {
  // Normal mode: use timeline signals
  engineSignals = deriveRuntimeSignals({
    timelineTracks,
    playhead,
    playbackState,
    manualPatterns,
    manualPatternMeta,
    manualPriority,
    manualSignals: signals,
    mode: manualPriority ? "manualPattern" : pattern === "none" ? "timeline" : "manual",
  });
}

  // Live engineering sync
  const { hasData } = useEngineeringSync(sceneRef);

  // Init scene
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new FountainScene(canvasRef.current, {
      environment: env, quality, cameraMode: cam, lightColor: lightCol,
    });
    scene.init();
    sceneRef.current = scene;
    // VR Walkthrough (AQ-S3-006): probe headset availability for the toolbar.
    if (scene.supportsVR) scene.supportsVR().then(setVrSupported).catch(() => setVrSupported(false));
    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !sceneRef.current) return;
      const { clientWidth:w, clientHeight:h } = containerRef.current;
      sceneRef.current.resize(w, h);
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => { ro.disconnect(); scene.dispose(); sceneRef.current = null; };
  }, [quality]);

  useEffect(() => { sceneRef.current?.setEnvironment(env); }, [env]);
  useEffect(() => { sceneRef.current?.setCameraMode(cam); }, [cam]);
  useEffect(() => { sceneRef.current?.setLightColor(lightCol); }, [lightCol]);
  useEffect(() => { sceneRef.current?.setWind(windX, windZ); }, [windX, windZ]);
  useEffect(() => {
  if (!sceneRef.current) return;

  // When Pattern Designer has manual priority, Runtime Signal Selector controls the scene.
  // Do not also run FountainScene's internal pattern engine.
  if (manualPriority) {
    sceneRef.current.stopPattern();
    return;
  }

  if (pattern === "none") sceneRef.current.stopPattern();
  else sceneRef.current.playPattern(pattern, 0.88);
}, [pattern, manualPriority]);
  useEffect(() => {
  if (!sceneRef.current) return;
  sceneRef.current.setSignals(engineSignals);
}, [engineSignals]);

  const screenshot = () => {
    const url = canvasRef.current?.toDataURL("image/png");
    if (url) { const a=document.createElement("a"); a.href=url; a.download=`aquaflow-${Date.now()}.png`; a.click(); }
  };

  const toggleRecord = () => {
    if (!recording) {
      // 4K Video Export (AQ-S3-007) — capture at the chosen resolution + fps.
      if (sceneRef.current?.startRecording({ resolution: exportRes, fps: exportFps })) setRecording(true);
    } else { sceneRef.current?.stopRecording(); setRecording(false); }
  };

  const poolDesc = poolType === "circular"
    ? `Ø ${((params?.radius||6)*2).toFixed(1)}m`
    : `${(params?.width||12).toFixed(1)}×${(params?.length||8).toFixed(1)}m`;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const btnSm = (active, color="#00aaff") => ({
    padding:"3px 8px", fontSize:10, cursor:"pointer", borderRadius:3,
    background: active ? `${color}22` : "transparent",
    color: active ? color : "#556677",
    border: `1px solid ${active ? color+"66" : "#0a2030"}`,
    fontFamily:"monospace", flexShrink:0,
  });

  const sectionLabel = { color:"#334455", fontSize:9, letterSpacing:"0.06em",
    textTransform:"uppercase", marginBottom:5, fontFamily:"monospace" };

  return (
    <div ref={containerRef} style={{ position:"relative", width:"100%", height:"100%", background:"#020610", overflow:"hidden", display:"flex" }}>

      {/* ── 3D Canvas ── */}
      <canvas ref={canvasRef} style={{ flex:1, display:"block", minWidth:0 }} />

      {/* ── Presentation caption overlay (AQ-S3-006) ── */}
      {presenting && tourCaption && (
        <div style={{
          position:"absolute", left:0, right:0, bottom:24, display:"flex", justifyContent:"center",
          pointerEvents:"none", zIndex:20,
        }}>
          <div style={{
            maxWidth:"80%", padding:"10px 18px", borderRadius:10, textAlign:"center",
            background:"rgba(2,6,16,0.72)", color:"#eaf2ff", fontSize:15, letterSpacing:0.2,
            border:"1px solid rgba(120,150,200,0.3)", backdropFilter:"blur(4px)",
          }}>{tourCaption}</div>
        </div>
      )}

      {/* ── Right sidebar ── */}
      <div style={{ width:200, flexShrink:0, background:"#030812", borderLeft:"1px solid #0a2030", display:"flex", flexDirection:"column", overflow:"hidden" }}>

        {/* Tabs */}
        <div style={{ display:"flex", borderBottom:"1px solid #0a2030" }}>
          {[["render","◈ Render"],["signals","⚡ Live"],["info","⬡ Eng"]].map(([key,label])=>(
            <button key={key} onClick={()=>setTab(key)} style={{
              flex:1, padding:"6px 0", background:"transparent", border:"none",
              borderBottom: tab===key ? "2px solid #00aaff" : "2px solid transparent",
              color: tab===key ? "#00aaff" : "#334455",
              fontSize:9, cursor:"pointer", fontFamily:"monospace",
            }}>{label}</button>
          ))}
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"8px 10px" }}>

          {/* ── RENDER TAB ── */}
          {tab==="render" && (<>
            <div style={sectionLabel}>Environment</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:3, marginBottom:10 }}>
              {ENVS.map(e=>(
                <button key={e.key} onClick={()=>setEnv(e.key)} style={{
                  ...btnSm(env===e.key), padding:"5px 4px",
                  borderLeft: `3px solid ${e.color==='#030810'?'#0066ff':e.color==='#180820'?'#8800cc':e.color==='#6ab4d8'?'#ffaa00':'#ff2200'}`,
                }}>{e.label}</button>
              ))}
            </div>

            <div style={sectionLabel}>Camera</div>
            <div style={{ display:"flex", flexDirection:"column", gap:2, marginBottom:10 }}>
              {CAMS.map(c=>(
                <button key={c.key} onClick={()=>setCam(c.key)} style={{
                  ...btnSm(cam===c.key), textAlign:"left", padding:"4px 6px",
                }}>{c.icon} {c.label}</button>
              ))}
            </div>

            <div style={sectionLabel}>Walkthrough</div>
            <div style={{ display:"flex", flexDirection:"column", gap:3, marginBottom:10 }}>
              <button onClick={togglePresentation} style={{ ...btnSm(presenting), textAlign:"left", padding:"4px 6px" }}>
                {presenting ? "■ Stop presentation" : "▶ Present to client"}
              </button>
              <button onClick={enterVR} disabled={!vrSupported} title={vrSupported ? "Enter immersive VR" : "No VR headset detected"} style={{
                ...btnSm(false), textAlign:"left", padding:"4px 6px",
                opacity: vrSupported ? 1 : 0.5, cursor: vrSupported ? "pointer" : "not-allowed",
              }}>🥽 Enter VR {vrSupported ? "" : "(unavailable)"}</button>
            </div>

            <div style={sectionLabel}>Quality</div>
            <div style={{ display:"flex", gap:3, marginBottom:10 }}>
              {["low","medium","high"].map(q=>(
                <button key={q} onClick={()=>setQuality(q)} style={{ ...btnSm(quality===q), flex:1, textAlign:"center", textTransform:"capitalize" }}>{q}</button>
              ))}
            </div>

            <div style={sectionLabel}>Light Color</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:3, marginBottom:6 }}>
              {LIGHT_PRESETS.map(lp=>(
                <div key={lp.color} onClick={()=>setLightCol(lp.color)} title={lp.label} style={{
                  width:"100%", paddingBottom:"100%", background:lp.color, borderRadius:3,
                  cursor:"pointer", border:lightCol===lp.color?"2px solid #fff":"1px solid #222",
                  position:"relative",
                }}/>
              ))}
            </div>
            <input type="color" value={lightCol} onChange={e=>setLightCol(e.target.value)}
              style={{ width:"100%", height:22, cursor:"pointer", border:"none", background:"none", marginBottom:10 }}/>

            <div style={sectionLabel}>Patterns</div>
            <div style={{ display:"flex", flexDirection:"column", gap:2, marginBottom:10 }}>
              {PATTERNS.map(p=>(
                <button key={p} onClick={()=>setPattern(p)} style={{
                  ...btnSm(pattern===p,"#aa88ff"), textAlign:"left", padding:"3px 6px", textTransform:"capitalize",
                }}>{p==="none"?"▐ Manual":p}</button>
              ))}
            </div>

            <div style={sectionLabel}>Wind</div>
            {[["X",windX,setWindX],["Z",windZ,setWindZ]].map(([axis,val,setter])=>(
              <div key={axis} style={{ marginBottom:6 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                  <span style={{ color:"#556677", fontSize:9 }}>{axis}-axis</span>
                  <span style={{ color:"#00aaff", fontSize:9 }}>{val.toFixed(1)} m/s</span>
                </div>
                <input type="range" min={-4} max={4} step={0.1} value={val}
                  onChange={e=>setter(parseFloat(e.target.value))}
                  style={{ width:"100%", accentColor:"#00aaff" }}/>
              </div>
            ))}
          </>)}

          {/* ── SIGNALS TAB ── */}
          {tab==="signals" && (<>
            <div style={{ color:"#334455", fontSize:9, marginBottom:8, lineHeight:1.5 }}>
  Live engine signals from timeline/manual preview.
</div>

<div style={{ color:"#00aaff", fontSize:9, marginBottom:8, fontFamily:"monospace" }}>
  Source: {engineSignals?.source || "—"} · Active clips: {engineSignals?.activeClips?.length || 0}
</div>
<div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
  <div style={{
    width:18,
    height:18,
    borderRadius:3,
    border:"1px solid #334455",
    background:`rgb(
      ${Math.round((engineSignals?.lightingColor?.r ?? 1) * 255)},
      ${Math.round((engineSignals?.lightingColor?.g ?? 1) * 255)},
      ${Math.round((engineSignals?.lightingColor?.b ?? 1) * 255)}
    )`
  }} />
  <div style={{ color:"#778899", fontSize:9, fontFamily:"monospace" }}>
    RGB: R{Math.round((engineSignals?.lightingColor?.r ?? 1) * 255)}
    {" "}G{Math.round((engineSignals?.lightingColor?.g ?? 1) * 255)}
    {" "}B{Math.round((engineSignals?.lightingColor?.b ?? 1) * 255)}
  </div>
</div>
<div style={{ color:"#00ff88", fontSize:9, fontFamily:"monospace", marginBottom:8 }}>
  Manual Priority: {manualPriority ? "ON" : "OFF"} · Playback: {playbackState || "—"}
</div>
{engineSignals?.activeClips?.length > 0 && (
  <div style={{ marginBottom:8 }}>
    <div style={{ color:"#334455", fontSize:9, marginBottom:4, textTransform:"uppercase" }}>
      Active Clips
    </div>
    {engineSignals.activeClips.slice(0, 5).map((clip, idx) => (
      <div key={`${clip.id || idx}`} style={{ color:"#99aabb", fontSize:9, fontFamily:"monospace", marginBottom:2 }}>
        {clip.type} · {Math.round((clip.intensity || 0) * 100)}%
      </div>
    ))}
  </div>
)}
<div style={{ color:"#334455", fontSize:9, margin:"8px 0 4px", textTransform:"uppercase" }}>
  Device Groups
</div>

{Object.entries(engineSignals?.groups || {}).map(([groupId, value]) => (
  <div key={groupId} style={{ marginBottom:6 }}>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
      <span style={{ color:"#778899", fontSize:9 }}>
        {groupId.replaceAll("_", " ")}
      </span>
      <span style={{ color:"#00aaff", fontSize:9, fontFamily:"monospace" }}>
        {Math.round((value || 0) * 100)}%
      </span>
    </div>
    <div style={{ height:3, background:"#0a1825", borderRadius:1, overflow:"hidden" }}>
      <div style={{
        width:`${(value || 0) * 100}%`,
        height:"100%",
        background:"#00aaff",
        borderRadius:1
      }}/>
    </div>
  </div>
))}
            {[
              ["pump","Pump",       "#00aaff"],
              ["valve","Valve",     "#00ccaa"],
              ["lighting","Lights", "#ffcc00"],
              ["flame","Flame",     "#ff6600"],
              ["fog","Fog",         "#aabbcc"],
              ["laser","Laser",     "#ff00ff"],
            ].map(([key,label,color])=>(
              <div key={key} style={{ marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                  <span style={{ color, fontSize:9 }}>{label}</span>
                  <span style={{ color, fontSize:9, fontFamily:"monospace" }}>{Math.round((engineSignals?.[key] ?? 0)*100)}%</span>
                </div>
                <div style={{ height:3, background:"#0a1825", borderRadius:1, marginBottom:3, overflow:"hidden" }}>
                  <div style={{ width:`${(engineSignals?.[key] ?? 0)*100}%`, height:"100%", background:color, borderRadius:1 }}/>
                </div>
                <input type="range" min={0} max={1} step={0.01} value={engineSignals?.[key] ?? 0}
                  onChange={e => {
                                              if (useDryRunPreview) return;

                                             setSignals(s => ({
                                                    ...s,
                                                   [key]: parseFloat(e.target.value)
                                               }));
                                             }}
                  style={{ width:"100%", accentColor:color }}/>
              </div>
            ))}
          </>)}

          {/* ── ENGINEERING INFO TAB ── */}
          {tab==="info" && (<>
            <div style={{ color: hasData?"#00ff88":"#334455", fontSize:9, marginBottom:6 }}>
              {hasData ? "● Live sync active" : "○ No project loaded"}
            </div>
            <div style={{ color:"#556677", fontSize:9, marginBottom:2 }}>Project</div>
            <div style={{ color:"#7ab", fontSize:10, marginBottom:8, wordBreak:"break-word" }}>{projectName||"—"}</div>
            {[
              ["Pool type", poolType||"—",     "#00ccaa"],
              ["Dimensions", poolDesc,          "#00ccaa"],
              ["Fixtures",   `${fixtureCount}`, "#00aaff"],
              ["Flow",  `${(hydraulics?.totalFlowM3Hr||0).toFixed(2)} m³/h`, "#ffcc00"],
              ["Pipe",  `DN${hydraulics?.recommendedPipeMm||50}`,            "#ff8800"],
              ["Pump",  `${(hydraulics?.recommendedPumpKw||0).toFixed(2)} kW`,"#ff8800"],
              ["TDH",   `${(hydraulics?.totalDynamicHeadM||0).toFixed(1)} m`, "#ffcc00"],
              ["Power", `${(hydraulics?.totalWatts||0).toFixed(0)} W`,        "#ff4444"],
            ].map(([label,val,color])=>(
              <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:"1px solid #0a1520" }}>
                <span style={{ color:"#334455", fontSize:9 }}>{label}</span>
                <span style={{ color, fontSize:9, fontFamily:"monospace" }}>{val}</span>
              </div>
            ))}
            {!hasData && (
              <div style={{ marginTop:8, color:"#223344", fontSize:9, lineHeight:1.5 }}>
                Open Design → Engineering Designer, draw a pool and place fixtures to see them here
              </div>
            )}
          </>)}
        </div>

        {/* Bottom actions */}
        <div style={{ borderTop:"1px solid #0a2030", padding:"6px 8px", display:"flex", flexDirection:"column", gap:4 }}>
          {/* ─── DRY-RUN PREVIEW TOGGLE ─── */}
          <button 
            onClick={() => {
              if (!useDryRunPreview && !dryRunState) {
                alert("No dry-run session active.\n\nClick 'Dry-Run Preview' in Show Programmer first.");
              }
              setUseDryRunPreview(!useDryRunPreview);
            }} 
            style={{ 
              ...btnSm(useDryRunPreview, "#00ff88"), 
              color: useDryRunPreview ? "#00ff88" : (dryRunState ? "#8899aa" : "#334455"),
              textAlign: "center",
              border: `1px solid ${useDryRunPreview ? "#00ff88" : (dryRunState ? "#445566" : "#334455")}`,
            }}
            title={useDryRunPreview ? "Using compiled show preview" : "Use timeline signals"}
          >
            {useDryRunPreview ? "🎬 Live Compile Preview" : (dryRunState ? "📋 Use Compiled Preview" : "⛔ No Preview Session")}
          </button>
          
          <button onClick={screenshot} style={{ ...btnSm(false,"#00ff88"), color:"#00ff88", textAlign:"center" }}>
            📷 Screenshot PNG
          </button>
          {!recording && (
            <div style={{ display:"flex", gap:3 }}>
              <select value={exportRes} onChange={e=>setExportRes(e.target.value)} title="Export resolution"
                style={{ flex:1, fontSize:11, padding:"3px 4px", background:"#0b1220", color:"#cde", border:"1px solid #24405e", borderRadius:4 }}>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="1440p">1440p</option>
                <option value="4k">4K UHD</option>
              </select>
              <select value={exportFps} onChange={e=>setExportFps(Number(e.target.value))} title="Export frame rate"
                style={{ width:74, fontSize:11, padding:"3px 4px", background:"#0b1220", color:"#cde", border:"1px solid #24405e", borderRadius:4 }}>
                <option value={24}>24 fps</option>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </div>
          )}
          <button onClick={toggleRecord} style={{ ...btnSm(recording,"#ff4444"), color:recording?"#ff4444":"#ff8866", textAlign:"center" }}>
            {recording ? "⏹ Stop & Save" : `⏺ Record ${exportRes==="4k"?"4K":exportRes} · ${exportFps}fps`}
          </button>
        </div>
      </div>

      {/* ── Camera mode indicator ── */}
      <div style={{ position:"absolute", bottom:8, left:8, background:"rgba(0,0,0,0.7)", border:"1px solid #0a2030", borderRadius:4, padding:"4px 8px", fontSize:9, color:"#334455", fontFamily:"monospace", pointerEvents:"none" }}>
        {cam==="orbit" ? "Drag to orbit · Scroll to zoom · Right-drag to pan" :
         cam==="top"   ? "Top-down view" :
         cam==="front" ? "Front view" :
         "Cinematic — auto-animating"}
      </div>
    </div>
  );
}
