/**
 * PreviewPanel_v5.jsx — Full 3D Preview with Engineering Sync
 * - Proper mouse orbit (drag to rotate, scroll to zoom, right-click pan)
 * - Full rendering options panel
 * - Engineering design live sync
 * - Quality presets
 * - Screenshot and video export
 */
import { deriveRuntimeSignals } from "../../utils/runtimeSignalSelector";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { FountainScene, ENVIRONMENTS, CAMERA_MODES, RENDER_QUALITY } from "./FountainScene_v6";
import { useEngineeringSync } from "../../hooks/useEngineeringSync";
import { normalizeCameraViews, resolveCameraView, NAMED_CAMERA_MODE } from "../../utils/cameraViews";
import useEngineeringStore from "../../store/engineeringStore";
import { useShowStore } from "../../store/showStore";
import useProjectStore from "../../store/projectStore";
import { useICANPreviewStore } from "../../store/icanPreviewStore";
import { evaluateICANPreview } from "../../utils/icanPatternPreview";
import ICANPreviewControls from "./ICANPreviewControls";
import HydraulicPreviewPanel, { useEngineeringPreview } from "./HydraulicPreviewPanel";
// AF-3D-VID-001 - baked (frame-exact) video render.
import { planBake, etaSeconds } from "../../video/bakedTimeline";
import { createBakeSampler } from "../../video/bakeSignalSampler";
// AQ-S3-013 — the 3D view as an editing workspace, not just a render.
import { SceneEditor } from "./editor/sceneEditor";
import { SceneGraph } from "./editor/sceneGraph";
import { defaultVenueModels } from "./modelLibrary";
// AF-NEXT-013: GPU-aware starting tier, eco extras and adaptive quality.
import { detectGpuProfile, resolveStartTier, resolveTierLimit } from "./gpuTier";
import { applyTierExtras, applyRenderScale, AdaptiveQualityController } from "./sceneAdaptive";
import {
  importDesign, importEngineeringFixtures, importSiteModels, graphToNozzles, graphToLights,
  graphToEngineeringFixtures, graphToSiteModels, reconcileEngineeringGraph,
} from "./editor/fixtureBridge";
import { poolCenter, engineeringToWorld } from "../../engineering/geometryContract";
// AF-CAD-031..033: shared 2D/3D command history + plan frame for snapping and drafting.
import { createPlanFrame, createStoreSceneHistory } from "./editor/engineeringDraftingBridge";
import { sharedDraftingHistory } from "../../engineering/drafting/commands";
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

  // View state belongs to the unified AquaFlow project, not to this component.
  // Changing workspaces or reopening the .aqua file now restores the same view,
  // quality, environment and export settings the designer was using.
  const renderSettings = useProjectStore((state) => state.render);
  const updateRender = useProjectStore((state) => state.updateRender);
  const setRenderField = (key) => (value) => {
    const current = useProjectStore.getState().render[key];
    updateRender({ [key]: typeof value === "function" ? value(current) : value });
  };
  const env = renderSettings.environment;
  const cam = renderSettings.cameraMode;
  const quality = renderSettings.quality;
  const pattern = renderSettings.pattern;
  const lightCol = renderSettings.lightColor;
  const windX = renderSettings.windX;
  const windZ = renderSettings.windZ;
  const waveResponse = renderSettings.waveResponse;
  const waveDamping = renderSettings.waveDamping;
  const waveBoundaryDamping = renderSettings.waveBoundaryDamping;
  const reviewMode = renderSettings.reviewMode;
  const reviewOverlays = renderSettings.reviewOverlays;
  const showPerf = renderSettings.showPerformance;
  const setEnv = setRenderField("environment");
  const setCam = setRenderField("cameraMode");
  // AF-NEXT-002: project-saved named views (render.cameraViews / activeCameraView).
  const cameraViews = normalizeCameraViews(renderSettings.cameraViews);
  const activeCameraView = renderSettings.activeCameraView || null;
  const selectCameraView = (id) => updateRender({ cameraMode: NAMED_CAMERA_MODE, activeCameraView: id });
  const setQuality = setRenderField("quality");
  // AF-NEXT-013: the tier actually rendered. Starts from the GPU profile (auto) or the
  // user's choice, then adaptive quality may step it down/up at runtime. Not saved.
  const adaptiveQuality = renderSettings.adaptiveQuality !== false;
  const setAdaptiveQuality = setRenderField("adaptiveQuality");
  const gpuProfile = useMemo(() => detectGpuProfile(), []);
  const startTier = resolveStartTier({ quality, adaptive: adaptiveQuality, profile: gpuProfile });
  const tierLimit = resolveTierLimit({ quality, adaptive: adaptiveQuality, profile: gpuProfile });
  const [effectiveQuality, setEffectiveQuality] = useState(startTier);
  useEffect(() => { setEffectiveQuality(startTier); }, [startTier]);
  const toneMapping = renderSettings.toneMapping || "aces";
  const setToneMapping = setRenderField("toneMapping");
  const halfResSpray = !!renderSettings.halfResSpray;
  const setHalfResSpray = setRenderField("halfResSpray");
  const setPattern = setRenderField("pattern");
  const setLightCol = setRenderField("lightColor");
  const setWindX = setRenderField("windX");
  const setWindZ = setRenderField("windZ");
  const setWaveResponse = setRenderField("waveResponse");
  const setWaveDamping = setRenderField("waveDamping");
  const setWaveBoundaryDamping = setRenderField("waveBoundaryDamping");
  const setReviewMode = setRenderField("reviewMode");
  const setReviewOverlays = setRenderField("reviewOverlays");
  const setShowPerf = setRenderField("showPerformance");
  const [perfStats, setPerfStats] = useState(null);
  const sidebarOpen = renderSettings.sidebarOpen;
  const setSidebarOpen = setRenderField("sidebarOpen");

  // Panel visibility
  const tab = renderSettings.sidebarTab;
  const setTab = setRenderField("sidebarTab"); // render | design | signals | info

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
  // Direct manipulation is the primary viewport mode: click an object immediately,
  // then W/E (or the toolbar) moves/rotates it. Review mode remains one click away.
  const editMode = renderSettings.editMode;
  const setEditMode = setRenderField("editMode");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [engineeringSaveState, setEngineeringSaveState] = useState("Synced");
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
  const exportRes = renderSettings.exportResolution;
  const setExportRes = setRenderField("exportResolution");
  const exportFps = renderSettings.exportFps;
  const setExportFps = setRenderField("exportFps");
  // Baked render: the scene is stepped on a virtual clock and every frame is encoded
  // with an exact timestamp, so the file is smooth regardless of GPU speed.
  const bakeStart = renderSettings.bakeStart;
  const setBakeStart = setRenderField("bakeStart");
  const bakeDuration = renderSettings.bakeDuration;   // 0 = whole show
  const setBakeDuration = setRenderField("bakeDuration");
  const bakeAudio = renderSettings.bakeAudio;
  const setBakeAudio = setRenderField("bakeAudio");
  const [bake, setBake] = useState(null);              // { frame, frames, phase, eta } | null
  const [bakeMsg, setBakeMsg] = useState("");
  const bakeAbortRef = useRef(null);

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
  const projectName = useEngineeringStore(s => s.projectName);
  const engineeringFixtures = useEngineeringStore(s => s.fixtures);
  const fixtureCount = engineeringFixtures.length;
  const siteWaterCount = engineeringFixtures.filter(fixture =>
    ["running-fountain", "foam", "peacock"].includes(fixture.engineering?.siteFunction)
      && String(fixture.type || "").startsWith("nozzle_")
  ).length;
  const sitePumpCount = engineeringFixtures.filter(fixture => fixture.type === "pump").length;
  const hydraulics = useEngineeringStore(s => s.hydraulicSummary);
  const poolType     = useEngineeringStore(s => s.poolType);
  const params       = useEngineeringStore(s => s.params);
  const timelineTracks = useShowStore(s => s.timelineTracks);
const playhead = useShowStore(s => s.playhead);
const playbackState = useShowStore(s => s.playbackState);
const manualPatterns = useShowStore(s => s.manualPatterns);
const manualPatternMeta = useShowStore(s => s.manualPatternMeta);
const manualPriority = useShowStore(s => s.manualPriority);
const sitePreview = useICANPreviewStore();

// ─── NEW: Use dry-run session if enabled ──────────────────────────────────
let engineSignals;

if (sitePreview.active && sitePreview.plan) {
  engineSignals = evaluateICANPreview(sitePreview.plan, sitePreview.position, engineeringFixtures,
    sitePreview.playback === "stopped");
} else if (useDryRunPreview && dryRunState && dryRunState.evaluateAllChannels) {
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
  // AF-NEXT-007/008: creative vs engineering water response + splash envelope.
  const engineeringPreview = useEngineeringPreview({ sceneRef, sitePreview, wind: { x: windX, z: windZ } });

  // Init scene
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new FountainScene(canvasRef.current, {
      environment: env, quality: effectiveQuality, cameraMode: cam, lightColor: lightCol,
      toneMapping: useProjectStore.getState().render.toneMapping,
      halfResSpray: !!useProjectStore.getState().render.halfResSpray,
    });
    scene.init();
    applyTierExtras(scene);   // AF-NEXT-013: eco water/particles + particle budget
    scene.setWaterSimulation?.({
      response: waveResponse,
      damping: waveDamping,
      boundaryDamping: waveBoundaryDamping,
    });
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
      const center = poolCenter(eng?.geometry, eng?.params, eng?.poolType);
      if (eng?.fixtures?.length) importEngineeringFixtures(graph, eng.fixtures, { center });
      else importDesign(graph, {
        nozzles: eng?.design?.nozzles || eng?.nozzles || scene.getNozzles?.() || [],
        lights: eng?.design?.lights || eng?.lights || [],
      });
    } catch {
      // A malformed store must not stop the workspace opening; it just starts empty.
    }
    const modelLayoutKey = `aquaflow:venue-models:v2:${projectName}`;
    const legacyModelLayoutKey = `aquaflow:venue-models:v1:${projectName}`;
    let modelSpecs;
    modelSpecs = Array.isArray(useEngineeringStore.getState().siteModels)
      && useEngineeringStore.getState().siteModels.length
      ? useEngineeringStore.getState().siteModels
      : null;
    if (!modelSpecs) {
      try { modelSpecs = JSON.parse(localStorage.getItem(modelLayoutKey)); } catch { modelSpecs = null; }
    }
    const venueDefaults = defaultVenueModels({
      poolType, radius: params?.radius, width: params?.width, length: params?.length,
    }, effectiveQuality);
    if (!Array.isArray(modelSpecs)) {
      // Preserve already-arranged people/buildings from v1, but migrate the scene to
      // real editable tree models once. Subsequent user deletions stay deleted in v2.
      let legacySpecs;
      try { legacySpecs = JSON.parse(localStorage.getItem(legacyModelLayoutKey)); } catch { legacySpecs = null; }
      modelSpecs = Array.isArray(legacySpecs)
        ? [...legacySpecs, ...venueDefaults.filter(spec => spec.id.startsWith("venue-tree-"))]
        : venueDefaults;
    }
    importSiteModels(graph, modelSpecs);
    // Venue defaults and migrated v1 layouts become project-owned immediately. This
    // prevents the first Engineering edit from treating them as stale local-only data.
    if (!useEngineeringStore.getState().siteModels?.length && modelSpecs?.length) {
      useEngineeringStore.getState().updateEngineering({ siteModels: graphToSiteModels(graph) });
    }
    let publishTimer = null;
    let publishGraphToEngineering = () => {};
    // AF-CAD-031: 3D edits of engineering entities share the designer's command history.
    const sharedSceneHistory = createStoreSceneHistory(useEngineeringStore, {
      flush: () => { if (publishTimer) { clearTimeout(publishTimer); publishTimer = null; publishGraphToEngineering(); } },
    });
    const editor = new SceneEditor({
      THREE: scene.THREE, scene: scene.scene, camera: scene.camera,
      renderer: scene.renderer, canvas: canvasRef.current, graph, history: sharedSceneHistory,
    });
    editor.setPlanFrame(createPlanFrame(useEngineeringStore));
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
        || reason === "props" || reason === "visibility" || reason === "history") {
        scene.setNozzlesFromEngineering(graphToNozzles(graph));
        scene.setEngineeringLights?.(graphToLights(graph));
      }
    });
    let publishingToEngineering = false;
    publishGraphToEngineering = () => {
      publishTimer = null;
      const store = useEngineeringStore.getState();
      const center = poolCenter(store.geometry, store.params, store.poolType);
      const before = { fixtures: store.fixtures || [], siteModels: store.siteModels || [] };
      const after = {
        fixtures: graphToEngineeringFixtures(graph, store.fixtures, { center }),
        siteModels: graphToSiteModels(graph),
      };
      publishingToEngineering = true;
      try {
        store.updateEngineering(after);
      } finally {
        publishingToEngineering = false;
      }
      // One gizmo drag / duplicate / typed edit = one shared transaction (coalesced).
      sharedSceneHistory.recordPublish(before, after);
      setEngineeringSaveState("Synced");
    };
    const offModels = graph.subscribe((reason) => {
      if (!["add", "remove", "transform", "visibility", "reparent", "group", "ungroup",
        "props", "rename", "lock", "history"].includes(reason)) return;
      scene.syncModelGraph(graph);
      setEngineeringSaveState("Unsaved");
      clearTimeout(publishTimer);
      publishTimer = setTimeout(publishGraphToEngineering, reason === "transform" ? 60 : 0);
      try {
        const saved = graphToSiteModels(graph);
        localStorage.setItem(modelLayoutKey, JSON.stringify(saved));
      } catch (error) { console.warn("[PreviewPanel] Could not save model layout", error); }
    });

    // Engineering is the project source of truth. Keep this existing SceneGraph
    // instance in sync rather than recreating the viewport (which would lose camera,
    // selection and editor subscriptions whenever a designer changes workspace).
    const offEngineering = useEngineeringStore.subscribe((next, previous) => {
      if (publishingToEngineering) return;
      const graphDataChanged = next.fixtures !== previous.fixtures
        || next.siteModels !== previous.siteModels
        || next.geometry !== previous.geometry
        || next.params !== previous.params
        || next.poolType !== previous.poolType
        || next.loadRevision !== previous.loadRevision;
      if (!graphDataChanged) return;
      if (next.loadRevision !== previous.loadRevision) sharedDraftingHistory.clear("load");

      clearTimeout(publishTimer);
      const center = poolCenter(next.geometry, next.params, next.poolType);
      reconcileEngineeringGraph(graph, {
        fixtures: next.fixtures,
        siteModels: next.siteModels,
        center,
      });
      editor.clearHistory();
      editor.syncProxies();
      scene.setNozzlesFromEngineering(graphToNozzles(graph));
      scene.setEngineeringLights?.(graphToLights(graph));
      scene.syncModelGraph(graph);
      setEngineeringSaveState("Synced from Engineering");
    });

    // AF-CAD-011: the locked CAD underlay on the 3D ground plane, in the same frame
    // as the pool. The scene rebuilds it only when its items or the pool centre move.
    const syncCadUnderlay = (st) => {
      const center = poolCenter(st.geometry, st.params, st.poolType);
      scene.setCadUnderlay?.(st.cadUnderlay || null, {
        toWorld: (p) => engineeringToWorld(p, center),
        centerKey: `${center.cx},${center.cy}`,
      });
    };
    try { syncCadUnderlay(useEngineeringStore.getState()); } catch (e) { console.warn("[PreviewPanel] CAD underlay", e); }
    const offUnderlay = useEngineeringStore.subscribe((next, previous) => {
      if (next.cadUnderlay === previous.cadUnderlay && next.geometry === previous.geometry
        && next.params === previous.params && next.poolType === previous.poolType) return;
      try { syncCadUnderlay(next); } catch (e) { console.warn("[PreviewPanel] CAD underlay", e); }
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
      offModels();
      offEngineering();
      offUnderlay();
      clearTimeout(publishTimer);
      editor.dispose();
      sharedSceneHistory.dispose();
      editorRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, [effectiveQuality, projectName]);

  // AF-NEXT-013 adaptive quality: if the median frame time stays above 33 ms for ~2 s,
  // step the render scale 1 → 0.8 → 0.6, then drop a tier; step back up with headroom
  // (never above the user's/auto tier). Off = the user's tier at full scale, exactly.
  const adaptiveRef = useRef(null);
  const [renderScale, setRenderScaleState] = useState(1);
  useEffect(() => {
    adaptiveRef.current = adaptiveQuality
      ? new AdaptiveQualityController({ tier: startTier, ceiling: tierLimit, floor: "eco" })
      : null;
  }, [adaptiveQuality, startTier, tierLimit]);
  useEffect(() => {
    const scene = sceneRef.current;
    const ctl = adaptiveRef.current;
    if (!scene) return undefined;
    if (!ctl) { applyRenderScale(scene, 1); setRenderScaleState(1); return undefined; }
    ctl.tier = effectiveQuality;
    ctl.settle(performance.now());
    applyRenderScale(scene, ctl.scale);
    setRenderScaleState(ctl.scale);
    let raf = 0, prev = performance.now(), warm = 0;
    const tick = now => {
      const dt = now - prev; prev = now;
      // Skip the first frames after a rebuild (shader compiles) and baked renders.
      if (++warm > 30 && !scene._baking && !document.hidden) {
        const action = ctl.sample(dt, now);
        if (action?.type === "scale") { applyRenderScale(scene, action.scale); setRenderScaleState(action.scale); }
        else if (action?.type === "tier") { setEffectiveQuality(action.tier); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [effectiveQuality, adaptiveQuality, startTier, tierLimit]);

  // Entering edit mode hands the viewport's pointer and camera to the editor.
  useEffect(() => {
    sceneRef.current?.setEditorMode?.(editMode);
    if (editMode) editorRef.current?.focusSelection?.();
  }, [editMode]);

  useEffect(() => { sceneRef.current?.setEnvironment(env); }, [env]);
  useEffect(() => { sceneRef.current?.setCameraMode(cam); }, [cam]);
  useEffect(() => {
    if (cam !== NAMED_CAMERA_MODE) return;
    sceneRef.current?.setNamedView?.(resolveCameraView(useProjectStore.getState().render, activeCameraView));
  }, [cam, activeCameraView]);
  useEffect(() => { sceneRef.current?.setLightColor(lightCol); }, [lightCol]);
  useEffect(() => { sceneRef.current?.setWind(windX, windZ); }, [windX, windZ]);
  useEffect(() => {
    sceneRef.current?.setWaterSimulation?.({
      response: waveResponse,
      damping: waveDamping,
      boundaryDamping: waveBoundaryDamping,
    });
  }, [waveResponse, waveDamping, waveBoundaryDamping]);
  useEffect(() => { sceneRef.current?.setReviewOverlays?.(reviewOverlays); }, [reviewOverlays]);
  useEffect(() => { sceneRef.current?.setToneMapping?.(toneMapping); }, [toneMapping]);
  useEffect(() => { sceneRef.current?.setHalfResSpray?.(halfResSpray); }, [halfResSpray]);

  // Poll the renderer's own counters while the HUD is up. 4 Hz: the scene already
  // averages FPS over a second, so sampling faster would only add React renders.
  useEffect(() => {
    if (!showPerf) { setPerfStats(null); return; }
    const id = setInterval(() => {
      const s = sceneRef.current?.getPerfStats?.();
      if (s) setPerfStats({ ...s, renderScale: sceneRef.current?._renderScale ?? 1 });
    }, 250);
    return () => clearInterval(id);
  }, [showPerf]);
  useEffect(() => {
  if (!sceneRef.current) return;

  // When Pattern Designer has manual priority, Runtime Signal Selector controls the scene.
  // Do not also run FountainScene's internal pattern engine.
  if (manualPriority || sitePreview.active) {
    sceneRef.current.stopPattern();
    return;
  }

  if (pattern === "none") sceneRef.current.stopPattern();
  else sceneRef.current.playPattern(pattern, 0.88);
}, [pattern, manualPriority, sitePreview.active, effectiveQuality]);
  useEffect(() => {
  if (!sceneRef.current) return;
  sceneRef.current.setSignals({ ...engineSignals,
    fixtureIntensities: sitePreview.active ? engineSignals.fixtureIntensities : null,
    fixtureLightStates: sitePreview.active ? engineSignals.fixtureLightStates || null : null,
    fixtureMotion: sitePreview.active ? engineSignals.fixtureMotion || null : null });
}, [engineSignals, effectiveQuality]);

  const screenshot = () => {
    const url = canvasRef.current?.toDataURL("image/png");
    if (url) { const a=document.createElement("a"); a.href=url; a.download=`aquaflow-${Date.now()}.png`; a.click(); }
  };

  const renderSmoothVideo = async () => {
    const scene = sceneRef.current;
    if (!scene || bake) return;
    if (recording) { scene.stopRecording(); setRecording(false); }
    setBakeMsg("");
    const site = useICANPreviewStore.getState();
    const show = useShowStore.getState();
    const sampler = createBakeSampler({
      sitePreview: site,
      fixtures: useEngineeringStore.getState().fixtures,
      timeline: {
        timelineTracks: show.timelineTracks, manualPatterns: show.manualPatterns,
        manualPatternMeta: show.manualPatternMeta, manualPriority: show.manualPriority,
        manualSignals: signals,
        mode: show.manualPriority ? "manualPattern" : pattern === "none" ? "timeline" : "manual",
        showDuration: show.currentShow?.duration,
      },
    });
    const total = sampler.defaultDurationS || 10;
    const startS = Math.min(Math.max(0, Number(bakeStart) || 0), Math.max(0, total - 0.1));
    const durationS = Number(bakeDuration) > 0 ? Number(bakeDuration) : Math.max(0.1, total - startS);
    const plan = planBake({ resolution: exportRes, fps: exportFps, startS, durationS });
    const audio = bakeAudio && site.active && site.audioFile
      ? { file: site.audioFile, loopS: site.plan?.passMs ? site.plan.passMs / 1000 : 0 } : null;

    const abort = { aborted: false };
    bakeAbortRef.current = abort;
    setBake({ frame: 0, frames: plan.frames, phase: "prepare", eta: null });
    // Freeze the live preview clock so nothing else advances while baking.
    if (site.active && site.playback === "playing") site.pause();
    let encoder = null;
    try {
      const { openBakedEncoder } = await import("../../video/bakedEncoder");
      encoder = await openBakedEncoder(canvasRef.current, plan, { audio });
      await scene.bakeVideo({
        plan, encoder, abort,
        sampleSignals: sampler.sample,
        onProgress: (p) => setBake({ ...p, eta: etaSeconds(p.frame, p.frames, p.elapsedMs || 0) }),
      });
      setBake(b => ({ ...(b || {}), phase: "finalize" }));
      const { blob, ext, codec } = await encoder.finish();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aquaflow-${plan.width}x${plan.height}-${plan.fps}fps-${Date.now()}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setBakeMsg(`Saved ${plan.frames} frames · ${codec.video.toUpperCase()}${encoder.hasAudio ? " + audio" : ""} · ${(blob.size / 1e6).toFixed(1)} MB`);
    } catch (e) {
      await encoder?.cancel?.();
      setBakeMsg(e?.name === "AbortError" ? "Render cancelled." : `Render failed: ${e?.message || e}`);
    } finally {
      bakeAbortRef.current = null;
      setBake(null);
    }
  };
  const cancelBake = () => { if (bakeAbortRef.current) bakeAbortRef.current.aborted = true; };
  useEffect(() => () => cancelBake(), []);

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
  const saveViewportToEngineering = useCallback(() => {
    const graph = editorRef.current?.graph;
    if (!graph) return;
    const store = useEngineeringStore.getState();
    const center = poolCenter(store.geometry, store.params, store.poolType);
    store.updateEngineering({
      fixtures: graphToEngineeringFixtures(graph, store.fixtures, { center }),
      siteModels: graphToSiteModels(graph),
    });
    setEngineeringSaveState("Saved to Engineering");
    setTimeout(() => setEngineeringSaveState("Synced"), 1800);
  }, []);

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
  const subLabel = { color:"#4f6474", fontSize:9, marginBottom:4 };

  return (
    <div ref={containerRef}
      onDragOver={libraryDrop.onDragOver}
      onDrop={libraryDrop.onDrop}
      style={{ position:"relative", width:"100%", height:"100%", background:"#030806", overflow:"hidden", display:"flex" }}>

      {/* ── 3D Canvas ── */}
      <canvas ref={canvasRef} aria-label="Interactive 3D fountain viewport" style={{ flex:1, display:"block", minWidth:0 }} />

      {/* Compact DCC-style header: mode and scene state remain visible while the
          viewport keeps almost all available screen area. */}
      <div style={{
        position:"absolute", top:10, left:12, zIndex:21, display:"flex", alignItems:"center", gap:5,
        padding:"5px 6px", borderRadius:6, background:"rgba(5,8,7,0.88)",
        border:"1px solid rgba(26,107,58,0.38)", boxShadow:"0 10px 28px rgba(0,0,0,0.28)",
        backdropFilter:"blur(8px)", fontFamily:"var(--font-mono)",
      }}>
        <button onClick={() => setEditMode(v => !v)} title={editMode ? "Return to review mode" : "Edit objects in the viewport"} style={{
          ...btnSm(editMode, "#c9a227"), minWidth:52, padding:"4px 8px", color:editMode?"#e8d5a0":"#9aaa96",
        }}>{editMode ? "Edit" : "Object"}</button>
        <button onClick={() => { setEditMode(true); setAddMenuOpen(v => !v); }}
          aria-expanded={addMenuOpen} title="Add fixtures and 3D models"
          style={{ ...btnSm(addMenuOpen, "#3ddc84"), padding:"4px 9px", color:addMenuOpen?"#9fffc1":"#9aaa96", fontWeight:800 }}>
          ＋ Add
        </button>
        <span style={{ width:1, height:16, background:"rgba(26,107,58,0.35)" }} />
        <button onClick={() => sceneRef.current?.fitCameraToDesign?.()} title="Frame all objects" style={{ ...btnSm(false), padding:"4px 7px", color:"#9aaa96" }}>⤢</button>
        <span title={sitePreview.active ? "Simulation running — no hardware output" : `Signal source: ${engineSignals?.source || "preview"}`}
          style={{ width:7, height:7, borderRadius:"50%", margin:"0 4px", background:sitePreview.active ? "#34d399" : "#c9a227" }} />
        <button onClick={() => setSidebarOpen(v => !v)} title={sidebarOpen ? "Hide properties sidebar" : "Show properties sidebar"}
          aria-expanded={sidebarOpen} style={{ ...btnSm(sidebarOpen), padding:"4px 7px", color:sidebarOpen?"#58c7ff":"#607264" }}>
          ◧
        </button>
      </div>

      {addMenuOpen && editMode && editorRef.current && <div style={{
        position:"absolute", top:54, left:12, zIndex:30, width:360, maxWidth:"calc(100% - 24px)",
        maxHeight:"min(520px, calc(100% - 76px))", overflowY:"auto", padding:10,
        borderRadius:7, background:"rgba(3,8,18,0.96)", border:"1px solid rgba(61,220,132,0.38)",
        boxShadow:"0 18px 50px rgba(0,0,0,0.55)", backdropFilter:"blur(10px)",
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
          <strong style={{ color:"#cfe0f0", fontSize:11, letterSpacing:".06em" }}>ADD TO SCENE</strong>
          <button onClick={() => setAddMenuOpen(false)} style={{ ...btnSm(false), padding:"2px 6px" }}>✕</button>
        </div>
        <LibraryPalette editor={editorRef.current} compact />
      </div>}

      {/* ── Editing workspace chrome ── */}
      {editMode && editorRef.current && (
        <EditorToolbar editor={editorRef.current} scene={sceneRef.current}
          onSave={saveViewportToEngineering} saveLabel={engineeringSaveState}
          onExitEditor={() => { sceneRef.current?.setQuadView?.(false); setEditMode(false); }} />
      )}

      {reviewMode && (
        <div style={{
          position:"absolute", top:54, left:12, zIndex:14, pointerEvents:"none",
          padding:"7px 10px", borderRadius:6, background:"rgba(4,10,16,0.72)",
          border:"1px solid rgba(215,185,87,0.28)", backdropFilter:"blur(6px)",
        }}>
          <div style={{ color:"#e8eef6", fontSize:12, fontWeight:700, lineHeight:1.2 }}>{projectName || "AquaFlow Scene"}</div>
          <div style={{ color:"#8ea4b8", fontSize:10, fontFamily:"monospace", marginTop:3 }}>
            {fixtureCount} fixtures · {poolDesc} · {(hydraulics?.totalFlowM3Hr||0).toFixed(1)} m³/h
          </div>
        </div>
      )}

      {/* ── Performance HUD (AF-3D-013) ──
          The realism tiers are a frame-budget trade, so the budget has to be visible:
          without it, "is High affordable on this machine?" is guesswork. Polled at
          4 Hz — the scene already averages over a one-second window, and re-rendering
          this overlay every frame would itself cost frames. */}
      {showPerf && perfStats && (
        <div title={[
            `${perfStats.ms} ms · peak ${perfStats.worstMs} ms`,
            `Tier: ${perfStats.quality} · ${perfStats.backend} · ${adaptiveQuality ? "adaptive" : "fixed"}`,
            `Particles: ${perfStats.particles.toLocaleString()}`,
            `Draws: ${perfStats.drawCalls} · ${Math.round(perfStats.triangles / 1000)}k tris`,
            `Pixel ratio: ${perfStats.features.pixelRatio.toFixed(1)}x`,
          ].join("\n")}
          style={{
            position:"absolute", top:12, right:(sidebarOpen ? layout.previewSidebar : 0) + 20, zIndex:15,
            display:"flex", alignItems:"baseline", gap:6, padding:"4px 9px", borderRadius:6, fontFamily:"monospace",
            background:"rgba(4,10,16,0.72)", border:"1px solid rgba(88,199,255,0.22)", backdropFilter:"blur(6px)",
          }}>
          <span style={{ fontSize:14, fontWeight:700,
            color: perfStats.fps >= 55 ? "#3ddc84" : perfStats.fps >= 30 ? "#ffcc00" : "#ff5544" }}>{perfStats.fps}</span>
          <span style={{ fontSize:9, color:"#8ea4b8" }}>fps</span>
          <span style={{ fontSize:9, color:"#58c7ff", textTransform:"capitalize" }}>{perfStats.quality}</span>
          {perfStats.renderScale < 1 && <span style={{ fontSize:9, color:"#ffcc00" }}>{Math.round(perfStats.renderScale * 100)}%</span>}
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
      {sidebarOpen && <ResizeHandle
        axis="x"
        title="Drag to resize the preview sidebar · double-click to reset"
        onStart={() => beginDrag("previewSidebar")}
        onEnd={endDrag}
        onReset={() => resetPanel("previewSidebar")}
        onResize={(d) => resize("previewSidebar", d, {
          invert: true, containerPx: containerRef.current?.clientWidth || 0,
        })}
      />}
      {sidebarOpen && <div style={{ width:layout.previewSidebar, flexShrink:0, background:"linear-gradient(180deg,#0c1410 0%,#080e0a 100%)", borderLeft:"1px solid rgba(26,107,58,0.25)", display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"-12px 0 30px rgba(0,0,0,0.18)" }}>

        {/* Tabs */}
        <div style={{ display:"flex", borderBottom:"1px solid #0a2030" }}>
          {[["render","Render"],["design","Edit"],["signals","Live"],["info","Eng"]].map(([key,label])=>(
            <button key={key} onClick={()=>setTab(key)} title={key==="info" ? "Engineering" : undefined} style={{
              flex:1, minWidth:0, padding:"6px 0", background:"transparent", border:"none",
              borderBottom: tab===key ? "2px solid #c9a227" : "2px solid transparent",
              color: tab===key ? "#d4ac3a" : "#607264",
              fontSize:10, cursor:"pointer",
            }}>{label}</button>
          ))}
        </div>

        <div style={{ flex:1, minHeight:0, overflowY:"auto", padding:"8px 10px" }}>
          <ICANPreviewControls />

          {/* ── DESIGN TAB — the 3D editing workspace ── */}
          {tab==="design" && (<>
            <button
              onClick={() => setEditMode(v => !v)}
              title="Select fixtures, move or rotate them with the gizmo, drag in new fixtures and type exact coordinates"
              style={{
                ...btnSm(editMode), width:"100%", textAlign:"center",
                padding:"6px 0", marginBottom:8, fontSize:11,
              }}>
              {editMode ? "Exit edit mode" : "Edit objects"}
            </button>

            {editMode && editorRef.current && (<>
              <div style={{ marginBottom:10 }}><LibraryPalette editor={editorRef.current} /></div>
              <div style={{ marginBottom:10 }}><SceneTree editor={editorRef.current} /></div>
              <div style={{ marginBottom:10 }}><Inspector editor={editorRef.current} /></div>
              <div style={{ marginBottom:10 }}><ShortcutHint /></div>
            </>)}
          </>)}

          {/* ── RENDER TAB ── */}
          {tab==="render" && (<>
            <Section title="View" defaultOpen>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:3, marginBottom:10 }}>
              {ENVS.map(e=>(
                <button key={e.key} onClick={()=>setEnv(e.key)} style={{
                  ...btnSm(env===e.key), padding:"5px 4px",
                  borderLeft: `3px solid ${e.color==='#030810'?'#0066ff':e.color==='#180820'?'#8800cc':e.color==='#6ab4d8'?'#ffaa00':'#ff2200'}`,
                }}>{e.label}</button>
              ))}
            </div>

            <div style={subLabel}>Camera</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:3, marginBottom:8 }}>
              <button onClick={() => sceneRef.current?.fitCameraToDesign?.()} style={{
                ...btnSm(false,"#00ff88"), textAlign:"left", padding:"4px 6px",
              }}>Fit design</button>
              {CAMS.map(c=>(
                <button key={c.key} onClick={()=>setCam(c.key)} title={c.key==="orbit" ? "Drag to orbit · scroll to zoom · right-drag to pan" : c.label} style={{
                  ...btnSm(cam===c.key), textAlign:"left", padding:"4px 6px",
                }}>{c.icon} {c.label}</button>
              ))}
            </div>
            {cameraViews.length > 0 && (
              <>
                <div style={subLabel}>Saved views</div>
                <div style={{ display:"flex", flexDirection:"column", gap:2, marginBottom:10 }} data-testid="saved-camera-views">
                  {cameraViews.map(view => (
                    <button key={view.id} onClick={() => selectCameraView(view.id)} title={view.note || view.name} style={{
                      ...btnSm(cam === NAMED_CAMERA_MODE && activeCameraView === view.id), textAlign:"left", padding:"4px 6px",
                    }}>⌖ {view.name}</button>
                  ))}
                </div>
              </>
            )}

            </Section>
            <Section title="Quality" defaultOpen>
            <div style={{ display:"flex", gap:3, marginBottom:10 }}>
              {["auto","eco","low","medium","high"].map(q=>(
                <button key={q} onClick={()=>setQuality(q)} title={q==="auto" ? `Detected for this GPU: ${gpuProfile.tier}` : q==="eco" ? "Entry GPUs: small particle budget, no shadows/reflection" : undefined}
                  style={{ ...btnSm((quality || "auto")===q), flex:1, flexShrink:1, minWidth:0, padding:"3px 0", textAlign:"center", textTransform:"capitalize" }}>{q}</button>
              ))}
            </div>
            <label title={`Lowers resolution, then quality, when below 30 fps.\nGPU: ${gpuProfile.renderer || "unknown"} (${gpuProfile.gpuClass}) · rendering ${effectiveQuality}${renderScale < 1 ? ` at ${Math.round(renderScale * 100)}%` : ""}`}
              style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8, color:"#71869a", fontSize:9 }}>
              <input type="checkbox" checked={adaptiveQuality} onChange={e=>setAdaptiveQuality(e.target.checked)} />
              Adaptive
            </label>

            </Section>
            <Section title="Look">
            <div style={subLabel}>Tone mapping</div>
            <div style={{ display:"flex", gap:3, marginBottom:6 }}>
              {[["aces","ACES"],["agx","AgX"],["neutral","Neutral"]].map(([id,label])=>(
                <button key={id} onClick={()=>setToneMapping(id)} title={id==="aces" ? "Default look" : id==="agx" ? "Saturated night LED colour without hue skew" : "Hue-preserving daytime colour"}
                  style={{ ...btnSm(toneMapping===id), flex:1, textAlign:"center" }}>{label}</button>
              ))}
            </div>
            {effectiveQuality === "medium" && (
              <label style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10, color:"#71869a", fontSize:9 }}>
                <input type="checkbox" checked={halfResSpray} onChange={e=>setHalfResSpray(e.target.checked)} />
                Half-res spray
              </label>
            )}

            <div style={subLabel}>Light colour</div>
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

            <div style={subLabel}>Pattern</div>
            <select value={pattern} onChange={e => setPattern(e.target.value)}
              style={{ width:"100%", fontSize:10, padding:"3px 4px", marginBottom:6, background:"#0b1220", color:"#cde", border:"1px solid #24405e", borderRadius:4, textTransform:"capitalize" }}>
              {PATTERNS.map(p => <option key={p} value={p}>{p === "none" ? "Manual" : p}</option>)}
            </select>
            </Section>
            <Section title="Water">
            {[
              ["Impact response", waveResponse, setWaveResponse, 0, 2, 0.05, value => `${value.toFixed(2)}×`],
              ["Surface damping", waveDamping, setWaveDamping, 0.94, 0.999, 0.001, value => value.toFixed(3)],
              ["Edge reflection", waveBoundaryDamping, setWaveBoundaryDamping, 0.5, 1, 0.01, value => `${Math.round(value * 100)}%`],
            ].map(([label, value, setter, min, max, step, format]) => (
              <label key={label} style={{ display:"block", marginBottom:6 }}>
                <span style={{ display:"flex", justifyContent:"space-between", color:"#71869a", fontSize:9 }}>
                  <span>{label}</span><span style={{ color:"#58c7ff" }}>{format(value)}</span>
                </span>
                <input type="range" min={min} max={max} step={step} value={value}
                  onChange={event => setter(Number(event.target.value))}
                  style={{ width:"100%", accentColor:"#21b6d7" }} />
              </label>
            ))}

            <div style={subLabel}>Wind</div>
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
            </Section>
            <Section title="Overlays">
            {[
              ["Info card", reviewMode, setReviewMode],
              ["Scale overlays", reviewOverlays, setReviewOverlays],
              ["Performance", showPerf, setShowPerf],
            ].map(([label, on, setter]) => (
              <label key={label} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4, color:"#71869a", fontSize:9 }}>
                <input type="checkbox" checked={!!on} onChange={e => setter(e.target.checked)} />{label}
              </label>
            ))}
            </Section>
            <Section title="Present">
            <div style={{ display:"flex", flexDirection:"column", gap:3, marginBottom:10 }}>
              <button onClick={togglePresentation} style={{ ...btnSm(presenting), textAlign:"left", padding:"4px 6px" }}>
                {presenting ? "■ Stop presentation" : "▶ Present to client"}
              </button>
              <button onClick={enterVR} disabled={!vrSupported} title={vrSupported ? "Enter immersive VR" : "No VR headset detected"} style={{
                ...btnSm(false), textAlign:"left", padding:"4px 6px",
                opacity: vrSupported ? 1 : 0.5, cursor: vrSupported ? "pointer" : "not-allowed",
              }}>🥽 Enter VR {vrSupported ? "" : "(unavailable)"}</button>
            </div>

            </Section>
          </>)}

          {/* ── SIGNALS TAB ── */}
          {tab==="signals" && (<>

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
            <HydraulicPreviewPanel {...engineeringPreview} />
            <div style={{ color: hasData?"#00ff88":"#334455", fontSize:9, marginBottom:6 }}>
              {hasData ? "● Live sync active" : "○ No project loaded"}
            </div>
            <div style={{ color:"#556677", fontSize:9, marginBottom:2 }}>Project</div>
            <div style={{ color:"#7ab", fontSize:10, marginBottom:8, wordBreak:"break-word" }}>{projectName||"—"}</div>
            {[
              ["Pool type", poolType||"—",     "#00ccaa"],
              ["Dimensions", poolDesc,          "#00ccaa"],
              ["Fixtures",   `${fixtureCount}`, "#00aaff"],
              ...(siteWaterCount > 0 ? [["Site outlets", `${siteWaterCount}`, "#3ddc84"]] : []),
              ...(sitePumpCount > 0 ? [["Site pumps", `${sitePumpCount}`, "#ffcc55"]] : []),
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
                No design loaded
              </div>
            )}
          </>)}
        </div>

        {/* Bottom actions */}
        <div style={{ flexShrink:0, borderTop:"1px solid #0a2030", padding:"6px 8px", display:"flex", flexDirection:"column", gap:4 }}>
          {/* The old "Dry-Run Preview" toggle was removed: its session producer lived in the
              retired ShowProgrammerPanel, so it could never receive data. */}
          <div style={{ display:"flex", gap:4 }}>
            <button onClick={screenshot} title="Save a PNG screenshot" style={{ ...btnSm(false,"#00ff88"), color:"#00ff88", flex:1, textAlign:"center" }}>
              Screenshot
            </button>
            <button onClick={toggleRecord} disabled={!!bake} title={`Live screen capture at ${exportRes==="4k"?"4K":exportRes} · ${exportFps} fps (real time — may stutter on heavy scenes)`}
              style={{ ...btnSm(recording,"#ff4444"), color:recording?"#ff4444":"#ff8866", flex:1, textAlign:"center" }}>
              {recording ? "⏹ Stop" : "⏺ Record"}
            </button>
          </div>
          <details>
            <summary style={{ color:"#71869a", fontSize:9, cursor:"pointer", padding:"2px 0" }}>Video export</summary>
            <div style={{ display:"flex", flexDirection:"column", gap:4, marginTop:4 }}>
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
          <div style={{ border:"1px solid #1d4d3a", borderRadius:4, padding:6, display:"flex", flexDirection:"column", gap:4 }}>
            {!bake && (
              <div style={{ display:"flex", gap:3, fontSize:10, color:"#8ea4b8", alignItems:"center" }}>
                <span>from</span>
                <input type="number" min={0} step={0.5} value={bakeStart} onChange={e=>setBakeStart(e.target.value)}
                  title="Start time (s)" style={{ width:44, fontSize:10, background:"#0b1220", color:"#cde", border:"1px solid #24405e", borderRadius:3 }} />
                <span>len</span>
                <input type="number" min={0} step={1} value={bakeDuration} onChange={e=>setBakeDuration(e.target.value)}
                  title="Length in seconds (0 = to end of show)" style={{ width:44, fontSize:10, background:"#0b1220", color:"#cde", border:"1px solid #24405e", borderRadius:3 }} />
                <label title="Include the site preview music" style={{ display:"flex", alignItems:"center", gap:2 }}>
                  <input type="checkbox" checked={bakeAudio} onChange={e=>setBakeAudio(e.target.checked)} />♪
                </label>
              </div>
            )}
            {bake ? (
              <>
                <div style={{ height:6, background:"#0b1220", borderRadius:3, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${bake.frames ? (100 * bake.frame / bake.frames) : 0}%`, background:"#3ddc84" }} />
                </div>
                <div style={{ fontSize:10, color:"#bce2d9", fontFamily:"monospace" }}>
                  {bake.phase === "warmup" ? "Warming up water…" : bake.phase === "finalize" ? "Writing file…" : bake.phase === "prepare" ? "Preparing encoder…"
                    : `Frame ${bake.frame}/${bake.frames}${bake.eta != null ? ` · ~${Math.ceil(bake.eta)}s left` : ""}`}
                </div>
                <button onClick={cancelBake} style={{ ...btnSm(true,"#ff4444"), color:"#ff6666", textAlign:"center" }}>Cancel render</button>
              </>
            ) : (
              <button onClick={renderSmoothVideo} disabled={recording}
                title="Renders every frame at exact show time, then encodes. Smooth at any resolution; takes longer than real time on slow GPUs."
                style={{ ...btnSm(false,"#3ddc84"), color:"#3ddc84", textAlign:"center" }}>
                Render video
              </button>
            )}
            {bakeMsg && <div style={{ fontSize:9, color: bakeMsg.startsWith("Render failed") ? "#ff8866" : "#8ea4b8" }}>{bakeMsg}</div>}
          </div>
            </div>
          </details>
        </div>
      </div>}

    </div>
  );
}

/** Collapsible sidebar group — keeps the inspector short; detail is one click away. */
function Section({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom:"1px solid #0c1c26", marginBottom:6 }}>
      <button onClick={() => setOpen(v => !v)} aria-expanded={open} style={{
        display:"flex", width:"100%", alignItems:"center", justifyContent:"space-between", padding:"5px 0",
        background:"transparent", border:"none", cursor:"pointer", color: open ? "#9fb3c4" : "#5f7384",
        fontSize:10, fontWeight:600, letterSpacing:"0.04em",
      }}>
        <span>{title}</span><span style={{ fontSize:8 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div style={{ paddingBottom:6 }}>{children}</div>}
    </div>
  );
}
