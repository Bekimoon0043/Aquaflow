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
// AQ-S3-013 — the 3D view as an editing workspace, not just a render.
import { SceneEditor } from "./editor/sceneEditor";
import { SceneGraph } from "./editor/sceneGraph";
import { importDesign, graphToNozzles, graphToLights } from "./editor/fixtureBridge";
import {
  EditorToolbar, LibraryPalette, SceneTree, Inspector, ShortcutHint, useLibraryDrop,
} from "./editor/ui/workspaceUI";
import ResizeHandle from "../layout/ResizeHandle";
import { useResizableLayout } from "../layout/useResizableLayout";

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
  const [reviewMode, setReviewMode] = useState(true);
  const [reviewOverlays, setReviewOverlays] = useState(true);

  // Panel visibility
  const [tab, setTab] = useState("render"); // render | design | signals | info

  // Sidebar width is draggable and shared with the shell's persisted layout, so the
  // preview remembers it the same way every other panel does.
  const { layout, resize, beginDrag, endDrag, resetPanel } = useResizableLayout();

  /**
   * Match the renderer's drawing buffer and camera aspect to the canvas's real size.
   * Measured after a frame so the browser has finished laying the flex row out —
   * reading immediately returns the pre-drag width and the 3D view stays stretched.
   */
  const syncCanvasSize = useCallback(() => {
    requestAnimationFrame(() => {
      const c = canvasRef.current, s = sceneRef.current;
      if (!c || !s) return;
      const w = c.clientWidth, h = c.clientHeight;
      if (w > 0 && h > 0) s.resize(w, h);
    });
  }, []);

  // A sidebar drag changes the canvas width without any event the observer above sees,
  // so drive the resize from the width itself.
  useEffect(() => { syncCanvasSize(); }, [layout.previewSidebar, syncCanvasSize]);

  // ── 3D editing workspace (AQ-S3-013) ──────────────────────────────────────
  const editorRef = useRef(null);
  const [editMode, setEditMode] = useState(false);
  // Bumped once the editor exists, so the workspace panels mount after it rather than
  // rendering against a null ref on the first pass.
  const [editorReady, setEditorReady] = useState(0);

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
    scene.setReviewOverlays?.(reviewOverlays);
    scene.fitCameraToDesign?.();
    sceneRef.current = scene;

    // ── Editing workspace ────────────────────────────────────────────────────
    // Seed the scene graph from whatever design already exists, so switching into
    // edit mode never presents an empty scene to someone who has already laid out
    // a fountain in the Engineering Designer.
    const graph = new SceneGraph();
    try {
      const eng = useEngineeringStore.getState?.();
      importDesign(graph, {
        nozzles: eng?.design?.nozzles || eng?.nozzles || scene.getNozzles?.() || [],
        lights: eng?.design?.lights || eng?.lights || [],
      });
    } catch {
      // A malformed store must not stop the workspace opening; it just starts empty.
    }
    const editor = new SceneEditor({
      THREE: scene.THREE, scene: scene.scene, camera: scene.camera,
      renderer: scene.renderer, canvas: canvasRef.current, graph,
    });
    scene.attachEditor(editor);
    editor.attachViewportSource(scene);
    editor.syncProxies();
    editorRef.current = editor;
    setEditorReady(n => n + 1);

    // Push the imported design once up front. Without this the viewport shows nothing
    // until the first edit fires an event, which reads as "my design disappeared".
    if (graph.count() > 0) {
      scene.setNozzlesFromEngineering(graphToNozzles(graph));
      scene.setEngineeringLights?.(graphToLights(graph));
    }

    // The graph is the source of truth for layout; push every structural change
    // straight into the renderer so the viewport always shows the real model.
    const offEditor = editor.subscribe((reason) => {
      if (reason === "structure" || reason === "transform" || reason === "transform-live"
        || reason === "props" || reason === "visibility") {
        scene.setNozzlesFromEngineering(graphToNozzles(graph));
        scene.setEngineeringLights?.(graphToLights(graph));
      }
    });

    // VR Walkthrough (AQ-S3-006): probe headset availability for the toolbar.
    if (scene.supportsVR) scene.supportsVR().then(setVrSupported).catch(() => setVrSupported(false));
    // Size the renderer from the CANVAS, not the container. The container includes the
    // sidebar, so feeding its width to the renderer sized the drawing buffer and camera
    // aspect for a viewport ~200px wider than the canvas really is — a stretch that was
    // easy to miss with a fixed sidebar and impossible to miss once it became draggable.
    //
    // The observer is attached to the CONTAINER rather than the canvas: a ResizeObserver
    // on a flex-sized <canvas> does not reliably re-fire when a sibling's width changes,
    // so watching the canvas alone silently left the drawing buffer at its old size.
    // The container reliably reports window resizes; sidebar drags are handled by the
    // effect below, which calls the same function.
    const ro = new ResizeObserver(() => syncCanvasSize());
    if (containerRef.current) ro.observe(containerRef.current);
    syncCanvasSize();
    return () => {
      ro.disconnect();
      offEditor();
      editor.dispose();
      editorRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, [quality]);

  // Entering edit mode hands the viewport's pointer and camera to the editor.
  useEffect(() => {
    sceneRef.current?.setEditorMode?.(editMode);
    if (editMode) editorRef.current?.focusSelection?.();
  }, [editMode]);

  useEffect(() => { sceneRef.current?.setEnvironment(env); }, [env]);
  useEffect(() => { sceneRef.current?.setCameraMode(cam); }, [cam]);
  useEffect(() => { sceneRef.current?.setLightColor(lightCol); }, [lightCol]);
  useEffect(() => { sceneRef.current?.setWind(windX, windZ); }, [windX, windZ]);
  useEffect(() => { sceneRef.current?.setReviewOverlays?.(reviewOverlays); }, [reviewOverlays]);
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

  // Library drag-and-drop into the viewport. Declared here so the container element
  // below can carry the handlers; a no-op until edit mode is on.
  const libraryDrop = useLibraryDrop(editorRef.current);

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
    <div ref={containerRef}
      onDragOver={libraryDrop.onDragOver}
      onDrop={libraryDrop.onDrop}
      style={{ position:"relative", width:"100%", height:"100%", background:"#020610", overflow:"hidden", display:"flex" }}>

      {/* ── 3D Canvas ── */}
      <canvas ref={canvasRef} style={{ flex:1, display:"block", minWidth:0 }} />

      {/* ── Editing workspace chrome ── */}
      {editMode && editorRef.current && (
        <EditorToolbar editor={editorRef.current} scene={sceneRef.current}
          onExitEditor={() => { sceneRef.current?.setQuadView?.(false); setEditMode(false); }} />
      )}

      {reviewMode && (
        <div style={{
          position:"absolute", top:12, left:12, zIndex:14, pointerEvents:"none",
          minWidth:190, padding:"10px 12px", borderRadius:6,
          background:"rgba(4,10,16,0.76)", border:"1px solid rgba(215,185,87,0.34)",
          boxShadow:"0 12px 34px rgba(0,0,0,0.34)", backdropFilter:"blur(6px)",
        }}>
          <div style={{ color:"#d7b957", fontSize:10, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>
            3D Review
          </div>
          <div style={{ color:"#e8eef6", fontSize:13, fontWeight:700, lineHeight:1.2, marginBottom:6 }}>
            {projectName || "AquaFlow Scene"}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, fontFamily:"monospace", fontSize:10 }}>
            <div style={{ color:"#8ea4b8" }}>Fixtures <span style={{ color:"#58c7ff" }}>{fixtureCount}</span></div>
            <div style={{ color:"#8ea4b8" }}>Pool <span style={{ color:"#58c7ff" }}>{poolDesc}</span></div>
            <div style={{ color:"#8ea4b8" }}>Signal <span style={{ color:"#58c7ff" }}>{engineSignals?.source || "manual"}</span></div>
            <div style={{ color:"#8ea4b8" }}>Flow <span style={{ color:"#58c7ff" }}>{(hydraulics?.totalFlowM3Hr||0).toFixed(1)} m3/h</span></div>
          </div>
        </div>
      )}

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

      {/* ── Right sidebar (drag its left edge to resize) ── */}
      <ResizeHandle
        axis="x"
        title="Drag to resize the preview sidebar · double-click to reset"
        onStart={() => beginDrag("previewSidebar")}
        onEnd={endDrag}
        onReset={() => resetPanel("previewSidebar")}
        onResize={(d) => resize("previewSidebar", d, {
          invert: true, containerPx: containerRef.current?.clientWidth || 0,
        })}
      />
      <div style={{ width:layout.previewSidebar, flexShrink:0, background:"#030812", borderLeft:"1px solid #0a2030", display:"flex", flexDirection:"column", overflow:"hidden" }}>

        {/* Tabs */}
        <div style={{ display:"flex", borderBottom:"1px solid #0a2030" }}>
          {[["render","◈ Render"],["design","✥ Design"],["signals","⚡ Live"],["info","⬡ Eng"]].map(([key,label])=>(
            <button key={key} onClick={()=>setTab(key)} style={{
              flex:1, padding:"6px 0", background:"transparent", border:"none",
              borderBottom: tab===key ? "2px solid #00aaff" : "2px solid transparent",
              color: tab===key ? "#00aaff" : "#334455",
              fontSize:9, cursor:"pointer", fontFamily:"monospace",
            }}>{label}</button>
          ))}
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"8px 10px" }}>

          {/* ── DESIGN TAB — the 3D editing workspace ── */}
          {tab==="design" && (<>
            <button
              onClick={() => setEditMode(v => !v)}
              style={{
                ...btnSm(editMode), width:"100%", textAlign:"center",
                padding:"6px 0", marginBottom:8, fontSize:11,
              }}>
              {editMode ? "◼ Exit Edit Mode" : "✥ Enter Edit Mode"}
            </button>

            {!editMode && (
              <div style={{ color:"#334455", fontSize:10, fontFamily:"monospace", lineHeight:1.5, marginBottom:10 }}>
                Edit mode makes the viewport a workspace: click a fixture to select it,
                drag the gizmo to move or rotate it, drag new fixtures in from the
                library, and type exact coordinates.
              </div>
            )}

            {editMode && editorRef.current && (<>
              <div style={{ marginBottom:10 }}><LibraryPalette editor={editorRef.current} /></div>
              <div style={{ marginBottom:10 }}><SceneTree editor={editorRef.current} /></div>
              <div style={{ marginBottom:10 }}><Inspector editor={editorRef.current} /></div>
              <div style={{ marginBottom:10 }}><ShortcutHint /></div>
            </>)}
          </>)}

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
              <button onClick={() => sceneRef.current?.fitCameraToDesign?.()} style={{
                ...btnSm(false,"#00ff88"), textAlign:"left", padding:"4px 6px",
              }}>Fit design</button>
              {CAMS.map(c=>(
                <button key={c.key} onClick={()=>setCam(c.key)} style={{
                  ...btnSm(cam===c.key), textAlign:"left", padding:"4px 6px",
                }}>{c.icon} {c.label}</button>
              ))}
            </div>

            <div style={sectionLabel}>Review</div>
            <div style={{ display:"flex", flexDirection:"column", gap:3, marginBottom:10 }}>
              <button onClick={() => setReviewMode(v => !v)} style={{
                ...btnSm(reviewMode,"#d7b957"), textAlign:"left", padding:"4px 6px",
              }}>{reviewMode ? "Review UI on" : "Review UI off"}</button>
              <button onClick={() => setReviewOverlays(v => !v)} style={{
                ...btnSm(reviewOverlays,"#58c7ff"), textAlign:"left", padding:"4px 6px",
              }}>{reviewOverlays ? "Scale overlays on" : "Scale overlays off"}</button>
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
