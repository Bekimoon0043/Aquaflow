/**
 * PreviewPanel_v4.jsx — AquaFlow Phase 13 + Engineering Bridge
 *
 * This panel is now a pure VISUALIZATION LAYER.
 * It does NOT own any geometry or fixture data.
 * All data comes from the Engineering Store.
 *
 * When Engineering Design changes anything → this panel updates automatically.
 */
import { useEffect, useRef, useState } from "react";
import { FountainScene, ENVIRONMENTS, CAMERA_MODES, RENDER_QUALITY } from "./FountainScene_v6";
import { useEngineeringSync } from "../../hooks/useEngineeringSync";
import useEngineeringStore from "../../store/engineeringStore";
import { useShowStore } from "../../store/showStore";

const ENV_OPTIONS = [
  { key:ENVIRONMENTS.NIGHT, label:"Night",  icon:"🌙" },
  { key:ENVIRONMENTS.DUSK,  label:"Dusk",   icon:"🌆" },
  { key:ENVIRONMENTS.DAY,   label:"Day",    icon:"☀" },
  { key:ENVIRONMENTS.ARENA, label:"Arena",  icon:"🎆" },
];
const CAM_OPTIONS = [
  { key:CAMERA_MODES.ORBIT,      label:"Orbit",    icon:"↻" },
  { key:CAMERA_MODES.FRONT,      label:"Front",    icon:"▣" },
  { key:CAMERA_MODES.TOP,        label:"Top",      icon:"⬆" },
  { key:CAMERA_MODES.AERIAL,     label:"Aerial",   icon:"🚁" },
  { key:CAMERA_MODES.FLYTHROUGH, label:"Fly",      icon:"✈" },
  { key:CAMERA_MODES.DRAMATIC,   label:"Dramatic", icon:"★" },
  { key:CAMERA_MODES.AUDIENCE,   label:"Audience", icon:"👥" },
];
const PATTERNS = [
  "none","wave","pulse","ripple","chase","burst","alternate","spiral","firework"
];
const LIGHT_COLORS = [
  "#0066ff","#00aaff","#00ffcc","#ffffff",
  "#ff6600","#ff0088","#aa00ff","#ffcc00",
];

export default function PreviewPanel() {
  const canvasRef    = useRef(null);
  const sceneRef     = useRef(null);
  const containerRef = useRef(null);

  const [env,         setEnv]         = useState(ENVIRONMENTS.NIGHT);
  const [camMode,     setCamMode]     = useState(CAMERA_MODES.ORBIT);
  const [quality,     setQuality]     = useState(RENDER_QUALITY.MEDIUM);
  const [pattern,     setPattern]     = useState("none");
  const [lightCol,    setLightCol]    = useState("#0066ff");
  const [showFX,      setShowFX]      = useState(true);
  const [showSignals, setShowSignals] = useState(false);
  const [showInfo,    setShowInfo]    = useState(true);
  const [recording,   setRecording]   = useState(false);
  const [windX,       setWindX]       = useState(0);
  const [windZ,       setWindZ]       = useState(0);
  const [signals, setSignals] = useState({
    pump:0.75, valve:0.5, lighting:0.65, flame:0, fog:0, laser:0
  });

  // Engineering store — read project info for display
  const projectName    = useEngineeringStore(s => s.projectName);
  const fixtureCount   = useEngineeringStore(s => s.fixtures.length);
  const hydraulics     = useEngineeringStore(s => s.hydraulicSummary);
  const poolType       = useEngineeringStore(s => s.poolType);
  const params         = useEngineeringStore(s => s.params);
  const playhead       = useShowStore(s => s.playhead);
  const playbackState  = useShowStore(s => s.playbackState);
  const timelineTracks = useShowStore(s => s.timelineTracks);

 const manualPatterns = useShowStore(s => s.manualPatterns);
  const manualPriority = useShowStore(s => s.manualPriority);

  const engineSignals = manualPriority && manualPatterns ? {
    pump:     Math.max(0, ...[...manualPatterns.slice(0,4), 0]),
    valve:    Math.max(0, ...[...manualPatterns.slice(4,8), 0]),
    lighting: Math.max(0, ...[...manualPatterns.slice(8,12), 0]),
    fog:      Math.max(0, ...[...manualPatterns.slice(12,14), 0]),
    flame:    Math.max(0, ...[...manualPatterns.slice(14,16), 0]),
    laser:    0,
  } : {
    pump:     timelineTracks.filter(t=>t.type==="pump"&&!t.muted).reduce((max,t)=>{const c=t.clips?.find(c=>c.start<=playhead&&playhead<c.end);return c?Math.max(max,c.intensity/100):max},0.15),
    valve:    timelineTracks.filter(t=>t.type==="valve"&&!t.muted).reduce((max,t)=>{const c=t.clips?.find(c=>c.start<=playhead&&playhead<c.end);return c?Math.max(max,c.intensity/100):max},0),
    lighting: timelineTracks.filter(t=>t.type==="lighting"&&!t.muted).reduce((max,t)=>{const c=t.clips?.find(c=>c.start<=playhead&&playhead<c.end);return c?Math.max(max,c.intensity/100):max},0.15),
    flame:    timelineTracks.filter(t=>t.type==="flame"&&!t.muted).reduce((max,t)=>{const c=t.clips?.find(c=>c.start<=playhead&&playhead<c.end);return c?Math.max(max,c.intensity/100):max},0),
    fog:      timelineTracks.filter(t=>t.type==="fog"&&!t.muted).reduce((max,t)=>{const c=t.clips?.find(c=>c.start<=playhead&&playhead<c.end);return c?Math.max(max,c.intensity/100):max},0),
    laser:    timelineTracks.filter(t=>t.type==="laser"&&!t.muted).reduce((max,t)=>{const c=t.clips?.find(c=>c.start<=playhead&&playhead<c.end);return c?Math.max(max,c.intensity/100):max},0),
  };

  // Live engineering sync hook
  const { hasData } = useEngineeringSync(sceneRef);

  // Init scene
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new FountainScene(canvasRef.current, {
      environment: env, quality, cameraMode: camMode, lightColor: lightCol,
    });
    scene.init();
    sceneRef.current = scene;

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !sceneRef.current) return;
      const { clientWidth:w, clientHeight:h } = containerRef.current;
      sceneRef.current.resize(w, h);
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => { ro.disconnect(); scene.dispose(); sceneRef.current = null; };
  }, [quality]);

  useEffect(() => { sceneRef.current?.setEnvironment(env); }, [env]);
  useEffect(() => { sceneRef.current?.setCameraMode(camMode); }, [camMode]);
  useEffect(() => { sceneRef.current?.setLightColor(lightCol); }, [lightCol]);
  useEffect(() => { sceneRef.current?.setWind(windX, windZ); }, [windX, windZ]);

  useEffect(() => {
    if (!sceneRef.current) return;
    if (pattern === "none") sceneRef.current.stopPattern();
    else sceneRef.current.playPattern(pattern, 0.88);
  }, [pattern]);

  const _sigRef = useRef(null);
  _sigRef.current = engineSignals;
  useEffect(() => {
    let id;
    const tick = () => {
      if (sceneRef.current && _sigRef.current) sceneRef.current.setSignals(_sigRef.current);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const screenshot = () => {
    const url = canvasRef.current?.toDataURL("image/png");
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.download = `aquaflow-${Date.now()}.png`;
      a.click();
    }
  };

  const toggleRecord = () => {
    if (!recording) {
      const ok = sceneRef.current?.startRecording();
      if (ok) setRecording(true);
    } else {
      sceneRef.current?.stopRecording();
      setRecording(false);
    }
  };

  const btn = (active, color="#00aaff") => ({
    padding:"3px 8px", fontSize:10, cursor:"pointer",
    background: active ? `${color}22` : "#0a1825",
    color: active ? color : "#556677",
    border: `1px solid ${active ? color+"55" : "#0a2030"}`,
    borderRadius:3, fontFamily:"monospace", flexShrink:0,
  });

  const poolDesc = poolType === "circular"
    ? `Ø ${((params?.radius||6)*2).toFixed(1)}m`
    : `${(params?.width||12).toFixed(1)}×${(params?.length||8).toFixed(1)}m`;

  return (
    <div ref={containerRef} style={{ position:"relative", width:"100%", height:"100%", background:"#010408", overflow:"hidden" }}>
      <canvas ref={canvasRef} style={{ width:"100%", height:"100%", display:"block" }} />

      {/* Top toolbar */}
      <div style={{ position:"absolute", top:8, left:8, right:8, display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
        <div style={toolbar}>
          {ENV_OPTIONS.map(e=>(
            <button key={e.key} onClick={()=>setEnv(e.key)} style={btn(env===e.key)}>{e.icon} {e.label}</button>
          ))}
        </div>
        <div style={toolbar}>
          {CAM_OPTIONS.map(c=>(
            <button key={c.key} onClick={()=>setCamMode(c.key)} style={btn(camMode===c.key)}>{c.icon} {c.label}</button>
          ))}
        </div>
        <div style={toolbar}>
          {[RENDER_QUALITY.LOW,RENDER_QUALITY.MEDIUM,RENDER_QUALITY.HIGH].map(q=>(
            <button key={q} onClick={()=>setQuality(q)} style={btn(quality===q)}>{q}</button>
          ))}
        </div>
      </div>

      {/* Engineering info overlay */}
      {showInfo && (
        <div style={{ position:"absolute", top:52, left:8, background:"rgba(0,0,0,0.82)", border:"1px solid #0a2535", borderRadius:5, padding:"7px 10px", minWidth:170 }}>
          <div style={{ color:"#00ccaa", fontSize:9, fontWeight:"bold", marginBottom:5, textTransform:"uppercase", letterSpacing:"0.06em" }}>
            ⬡ Engineering Design
          </div>
          <div style={{ color:"#334455", fontSize:9, marginBottom:2 }}>Project</div>
          <div style={{ color:"#7ab", fontSize:10, marginBottom:5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:150 }}>
            {projectName || "—"}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
            {[
              ["Pool", `${poolType||"—"}`, "#00ccaa"],
              ["Size", poolDesc, "#00ccaa"],
              ["Fixtures", `${fixtureCount}`, "#00aaff"],
              ["Flow", `${(hydraulics?.totalFlowM3Hr||0).toFixed(1)} m³/h`, "#ffcc00"],
              ["Pipe", `DN${hydraulics?.recommendedPipeMm||50}`, "#ff8800"],
              ["Pump", `${(hydraulics?.recommendedPumpKw||0).toFixed(2)} kW`, "#ff8800"],
            ].map(([label,val,color])=>(
              <div key={label} style={{ padding:"3px 5px", background:"#060e18", borderRadius:3 }}>
                <div style={{ fontSize:8, color:"#334455" }}>{label}</div>
                <div style={{ fontSize:10, color, fontWeight:"bold" }}>{val}</div>
              </div>
            ))}
          </div>
          {!hasData && (
            <div style={{ marginTop:6, color:"#334455", fontSize:9, lineHeight:1.4 }}>
              Open Engineering Design panel to load a project
            </div>
          )}
          {hasData && (
            <div style={{ marginTop:6, color:"#00ff88", fontSize:9 }}>
              ● Live — synced with Engineering Design
            </div>
          )}
        </div>
      )}

      {/* Right FX panel */}
      {showFX && (
        <div style={{ position:"absolute", right:8, top:52, background:"rgba(0,0,0,0.85)", border:"1px solid #0a2030", borderRadius:6, padding:"8px 10px", minWidth:140 }}>
          <div style={label}>LIGHT COLOR</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:3, marginBottom:4 }}>
            {LIGHT_COLORS.map(col=>(
              <div key={col} onClick={()=>setLightCol(col)} style={{ width:18, height:18, borderRadius:3, background:col, cursor:"pointer", border:lightCol===col?"2px solid #fff":"1px solid #222" }}/>
            ))}
          </div>
          <input type="color" value={lightCol} onChange={e=>setLightCol(e.target.value)}
            style={{ width:"100%", height:20, cursor:"pointer", border:"none", background:"none", marginBottom:8 }}/>

          <div style={label}>PATTERN</div>
          {PATTERNS.map(p=>(
            <button key={p} onClick={()=>setPattern(p)} style={{ ...btn(pattern===p), width:"100%", textAlign:"left", marginBottom:2, textTransform:"capitalize" }}>
              {p==="none"?"Manual":p}
            </button>
          ))}

          <div style={{...label, marginTop:8}}>WIND</div>
          <div style={{ fontSize:9, color:"#334455", marginBottom:2 }}>X: {windX.toFixed(1)}</div>
          <input type="range" min={-3} max={3} step={0.1} value={windX} onChange={e=>setWindX(parseFloat(e.target.value))} style={{ width:"100%", accentColor:"#00aaff", marginBottom:4 }}/>
          <div style={{ fontSize:9, color:"#334455", marginBottom:2 }}>Z: {windZ.toFixed(1)}</div>
          <input type="range" min={-3} max={3} step={0.1} value={windZ} onChange={e=>setWindZ(parseFloat(e.target.value))} style={{ width:"100%", accentColor:"#00aaff" }}/>
        </div>
      )}

      {/* Signal overrides */}
      {showSignals && (
        <div style={{ position:"absolute", left:8, bottom:44, background:"rgba(0,0,0,0.9)", border:"1px solid #0a2030", borderRadius:6, padding:"8px 10px", minWidth:185 }}>
          <div style={label}>SIGNAL OVERRIDES</div>
          <div style={{ fontSize:9, color:"#334455", marginBottom:6 }}>
            Overrides show engine signals for preview
          </div>
          {Object.entries(signals).map(([key,val])=>(
            <div key={key} style={{ marginBottom:6 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:1 }}>
                <span style={{ color:"#556677", fontSize:9, textTransform:"uppercase" }}>{key}</span>
                <span style={{ color:"#00aaff", fontSize:9 }}>{Math.round(val*100)}%</span>
              </div>
              <input type="range" min={0} max={1} step={0.01} value={val}
                onChange={e=>setSignals(s=>({...s,[key]:parseFloat(e.target.value)}))}
                style={{ width:"100%", accentColor:"#00aaff" }}/>
            </div>
          ))}
        </div>
      )}

      {/* Bottom toolbar */}
      <div style={{ position:"absolute", bottom:8, left:8, right:8, display:"flex", gap:5, alignItems:"center" }}>
        <button onClick={()=>setShowInfo(v=>!v)} style={btn(showInfo,"#00ccaa")}>⬡ Eng Info</button>
        <button onClick={()=>setShowFX(v=>!v)} style={btn(showFX)}>◈ FX</button>
        <button onClick={()=>setShowSignals(v=>!v)} style={btn(showSignals)}>⚡ Signals</button>
        <div style={{ flex:1 }}/>
        <button onClick={screenshot} style={{ ...btn(false,"#00ff88"), color:"#00ff88" }}>📷 PNG</button>
        <button onClick={toggleRecord} style={{ ...btn(recording,"#ff4444"), color:recording?"#ff4444":"#ff8866" }}>
          {recording ? "⏹ Stop" : "⏺ Record"}
        </button>
      </div>
    </div>
  );
}

const toolbar = {
  display:"flex", gap:2,
  background:"rgba(0,0,0,0.78)",
  border:"1px solid #0a2030",
  borderRadius:5, padding:"3px 5px",
};
const label = {
  color:"#334455", fontSize:9, fontFamily:"monospace",
  marginBottom:4, textTransform:"uppercase", letterSpacing:"0.05em",
};
