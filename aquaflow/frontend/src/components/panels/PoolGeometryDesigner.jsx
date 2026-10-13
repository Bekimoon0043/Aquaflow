/**
 * PoolGeometryDesigner.jsx — AquaFlow Phase 9
 * Interactive pool geometry designer:
 * - Draw any pool shape (circular, rectangular, freeform, multi-basin)
 * - Set dimensions, depth zones, walls
 * - Place nozzles and lights on the actual geometry
 * - False lake / false river mode
 * - Export geometry as JSON for hydraulic solver
 *
 * AF-CAD-030..034: the drafting rules live in engineering/drafting/ (entities, commands,
 * selection, snap, viewport, dynamic input, renderer); this component wires state, pointer
 * and keyboard to them. Panels are in ./designer/.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import useProjectStore from "../../store/projectStore";
import { generatePipework } from "../../engineering/pipeworkEngine";
import { calculateHydraulics } from "../../engineering/hydraulicEngine";
import { generateBOM } from "../../engineering/bomEngine";
import { useEngineeringPublisher } from "../../hooks/engineeringPublisher";
import useEngineeringStore from "../../store/engineeringStore";
import { useShowStore } from "../../store/showStore";
import { usePipeDrawing } from "../../engineering/usePipeDrawing";
import PipePropertiesPanel from "./PipePropertiesPanel";
import { fixtureMatchesTool } from "./FixtureLibraryBrowser";
import CADImportDialog from "./CADImportDialog";
import { useDesignerBasins } from "../../engineering/useDesignerBasins";
import { pointInAnyBasin, zonesForBasin, upsertBasinDepthZone } from "../../engineering/basins";
import { requestCadExportDxf } from "../../engineering/cadExchange";
import { prepareCadUnderlay, underlayLayerVisibility } from "../../engineering/cadUnderlay";
import { apiGet, apiPost } from "../../utils/apiClient";
import { geometryForPoolType, synchronizePoolGeometry, geometryMetrics, pointInGeometry, validateDepthZone } from "../../engineering/poolGeometry";
import { buildHydraulicPreviewPayload, normalizeHydraulicResult } from "../../engineering/hydraulicAdapter";
import { DEFAULT_DEPTH_ZONES, parseEngineeringProjectFile } from "../../engineering/engineeringProject";
import { LAND_SURFACE_TYPES, dedupeSurfacePoints, moveSurface, normalizeSiteSurfaces, pointInSurface, surfaceMetrics, updateSurfaceVertex } from "../../engineering/siteSurfaces";
import { createICANSiteEngineeringProject } from "../../data/icanSiteEngineeringProject";
import { takePendingFocus } from "../../preflight/preflight";
import { usePanelAction } from "../../workspaces/navigation"; // AF-NEXT-014
import { FIXTURE_TYPES, POOL_TYPES, TOOLS, mergeEngineeringLayers } from "../../engineering/drafting/designerCatalog";
import { renderDesignerCanvas } from "../../engineering/drafting/designerRenderer";
import { createFixtureEntity, duplicateFixtureEntity, ensureEntityIdentities, entityKey, ownerForPoint, toolLayerKey } from "../../engineering/drafting/entities";
import { buildSnapScene } from "../../engineering/drafting/snap";
import { resolveDraftPoint } from "../../engineering/drafting/session";
import { patchToStoreFields } from "../../engineering/drafting/commands";
import { useDraftingHistory } from "../../engineering/drafting/useDraftingHistory";
import { boxSelect, clickSelection, createGroup, expandToGroups, groupsContaining, keyOf, mergeSelection, pruneGroups, selectSimilar, ungroup } from "../../engineering/drafting/selection";
import { designBounds, fitViewTo, screenToWorld, zoomAbout, DEFAULT_VIEW } from "../../engineering/drafting/viewport";
import { editGeometryProperty, geometryMeta as outlineMeta, hitGrip, hitSurfaceVertex, pointInsideOutline, stretchFromGrip, translateGeometry } from "../../engineering/drafting/geometryEdit";
import { autoPlaceFixtures, buildFixtureArray } from "../../engineering/drafting/arrays";
import { angleOf, dynamicInputKey, emptyDynamicInput, resolveDynamicInput } from "../../engineering/drafting/dynamicInput";
import CommandPalette from "../../engineering/drafting/commandPalette";
import DynamicInputOverlay from "../../engineering/drafting/DynamicInputOverlay";
import FixturePropertiesPanel from "./designer/FixturePropertiesPanel";
import { buildBomCsv, buildProjectPayload as composeProjectPayload, downloadTextFile as saveTextFile, safeFileName } from "./designer/designerExport";
import {
  DimensionsSection, FixturePickerSection, LayersSection, PoolPropertiesSection, PoolTypeSection, ProjectHeaderSection,
  ProjectOutputSection, SiteSurfacesSection, SurfacePropertiesSection, ToolsSection,
} from "./designer/DesignerSidebar";

const ownerFnFor = (basins) => (entity) => ownerForPoint(basins, entity);
const DESIGNER_TYPING_TOOLS = new Set(["pipe"]);

export default function PoolGeometryDesigner() {
  const canvasRef = useRef(null);
  const canvasHostRef = useRef(null);
  const projectFileInputRef = useRef(null);
  const projectLoadRevision = useEngineeringStore((state) => state.loadRevision);
  const projectId = useEngineeringStore((state) => state.projectId);
  // AF-CAD-011: locked whole-drawing CAD underlay (reference only; never selectable/editable).
  const cadUnderlay = useEngineeringStore((state) => state.cadUnderlay);
  const updateCadUnderlay = useCallback((next) => useEngineeringStore.getState().updateEngineering({ cadUnderlay: next }), []);
  const [showCADImport, setShowCADImport] = useState(false);
  // AF-NEXT-014: "Import CAD" from the Design workspace guidance opens the existing dialog.
  usePanelAction("geometry", ({ action }) => { if (action === "cad-import") setShowCADImport(true); });
  const [cadExportBusy, setCadExportBusy] = useState(false);
  const [fitAfterCADImport, setFitAfterCADImport] = useState(false);
  const [tool, setTool] = useState("select");
  const [poolType, setPoolType] = useState(() => useEngineeringStore.getState().poolType || "rectangular");
  const [params, setParams] = useState(() => useEngineeringStore.getState().params || { width:12, length:8, radius:6, depth:0.8 });
  // AF-CAD-030: every entity carries a stable uuid + owner (lazy migration, ids preserved).
  const [fixtures, setFixtures] = useState(() => {
    const s = useEngineeringStore.getState();
    return ensureEntityIdentities(s.fixtures || [], ownerFnFor(s.basins));
  });
  const [siteSurfaces, setSiteSurfaces] = useState(() => ensureEntityIdentities(normalizeSiteSurfaces(useEngineeringStore.getState().siteSurfaces), "site"));
  const [groups, setGroups] = useState(() => useEngineeringStore.getState().groups || []);
  const hydraulicSummary = useMemo(() => calculateHydraulics(fixtures), [fixtures]);
  const [geometry, setGeometry] = useState(() => {
    const store = useEngineeringStore.getState();
    return store.geometry || geometryForPoolType(store.poolType || "rectangular", store.params || {});
  });

  // AF-NEXT-010: `geometry` is the ACTIVE basin being edited; the hook owns every basin.
  const basinState = useDesignerBasins({
    initialBasins: useEngineeringStore.getState().basins, geometry, setGeometry, poolType, setPoolType, params, setParams,
  });
  const { basins, activeBasinIndex, activeBasin, primary: primaryBasin, loadBasins } = basinState;
  const primaryBasinId = basins[0]?.id;
  const pipework = useMemo(() => generatePipework(fixtures, geometry), [fixtures, geometry]);
  const baseBomItems = useMemo(() => generateBOM(fixtures), [fixtures]);

  // AF-CAD-034: fixture selection is a list of entity keys (uuid, else legacy id).
  const [selection, setSelection] = useState([]);
  const [selectedSurfaceId, setSelectedSurfaceId] = useState(null);
  const [selectedSurfaceVertex, setSelectedSurfaceVertex] = useState(null);
  const [selectedObject, setSelectedObject] = useState(null);
  const [fixtureType, setFixtureType] = useState("nozzle_geyser");
  const [depthZone, setDepthZone] = useState("medium");
  const [zoom, setZoom] = useState(DEFAULT_VIEW.zoom); // pixels per meter
  const [pan, setPan] = useState({ ...DEFAULT_VIEW.pan });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({x:0,y:0});
  const [freeformPoints, setFreeformPoints] = useState([]);
  const [measurements, setMeasurements] = useState(() => useEngineeringStore.getState().measurements || []);
  const [measureStart, setMeasureStart] = useState(null);
  const bomItems = [...baseBomItems, ...(pipework?.bom || [])];
  const [showGrid, setShowGrid] = useState(true);
  const [showDepth, setShowDepth] = useState(true);
  const [projectName, setProjectName] = useState(() => useEngineeringStore.getState().projectName || "New Pool Project");
  const [saved, setSaved] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [showSavedProjects, setShowSavedProjects] = useState(false);
  const [savedProjects, setSavedProjects] = useState([]);
  const [selectedSavedProjectId, setSelectedSavedProjectId] = useState("");
  const [savedProjectsLoading, setSavedProjectsLoading] = useState(false);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [cursorWorld, setCursorWorld] = useState({ x:0, y:0 });
  const [cursorScreen, setCursorScreen] = useState(null);
  const [isDraggingGeometry, setIsDraggingGeometry] = useState(false);
  const [isDraggingSurface, setIsDraggingSurface] = useState(false);
  const [lastDragWorld, setLastDragWorld] = useState(null);
  const [drawStart, setDrawStart] = useState(null);
  const [drawPreview, setDrawPreview] = useState(null);
  const [polylinePoints, setPolylinePoints] = useState([]);
  const [landDrawPoints, setLandDrawPoints] = useState([]);
  const [landSurfaceType, setLandSurfaceType] = useState("grass");
  const [activeGrip, setActiveGrip] = useState(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [osnap, setOsnap] = useState(true);
  const [hoverSnap, setHoverSnap] = useState(null);
  const [gridStep, setGridStep] = useState(0.5);
  const [showDimensions, setShowDimensions] = useState(true);
  const [layers, setLayers] = useState(() => mergeEngineeringLayers(useEngineeringStore.getState().layers));
  const [depthZones, setDepthZones] = useState(() => {
    const saved = useEngineeringStore.getState().depthZones;
    return saved?.length ? saved : DEFAULT_DEPTH_ZONES;
  });
  const [depthDrawPoints, setDepthDrawPoints] = useState([]);
  const [depthZoneError, setDepthZoneError] = useState("");
  const [solvedHydraulics, setSolvedHydraulics] = useState(() => useEngineeringStore.getState().solvedHydraulics || null);
  const [hydraulicRunState, setHydraulicRunState] = useState({ loading: false, error: "" });
  const [canvasViewport, setCanvasViewport] = useState({ width: 900, height: 600, dpr: 1 });
  const [showLayerPanel, setShowLayerPanel] = useState(true);
  const [arrayMode, setArrayMode] = useState("centerline");
  const [arrayCount, setArrayCount] = useState(8);
  const [arrayRows, setArrayRows] = useState(3);
  const [arrayCols, setArrayCols] = useState(5);
  const [arrayInset, setArrayInset] = useState(1.0);
  const [exportStatus, setExportStatus] = useState("");
  const [pipeContextMenu, setPipeContextMenu] = useState(null);
  const [selectionBox, setSelectionBox] = useState(null);
  const [dynamicInput, setDynamicInput] = useState(emptyDynamicInput);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const fixtureDragRef = useRef(null);

  const selectedIndices = useMemo(() => {
    const keys = new Set(selection);
    return fixtures.map((f, i) => (keys.has(keyOf(f)) ? i : -1)).filter((i) => i >= 0);
  }, [fixtures, selection]);
  const selectedKeys = useMemo(() => new Set(selection), [selection]);
  const selectedFixture = selectedIndices.length === 1 ? selectedIndices[0] : null;
  const setSelectedFixture = useCallback((index) => {
    setSelection(index === null || index === undefined ? [] : (fixtures[index] ? [keyOf(fixtures[index])] : []));
  }, [fixtures]);

  useEffect(() => {
    if (!["nozzle", "light", "equipment"].includes(tool)) return;
    const selected = FIXTURE_TYPES.find((fixture) => fixture.key === fixtureType);
    if (selected && fixtureMatchesTool(selected, tool)) return;
    const firstMatch = FIXTURE_TYPES.find((fixture) => fixtureMatchesTool(fixture, tool));
    if (firstMatch) setFixtureType(firstMatch.key);
  }, [tool, fixtureType]);

  const pushFixturesToDevices = useCallback(() => {
    const { devices, timelineTracks } = useShowStore.getState();
    if (!fixtures.length) return;
    const mapped = [];
    const typesSeen = new Set();
    fixtures.forEach(f => {
      let deviceType = null;
      if (f.type?.startsWith("nozzle") || f.type?.includes("geyser") || f.type?.includes("jet") || f.type?.includes("foam")) deviceType = "pump";
      else if (f.type?.startsWith("light")) deviceType = "lighting";
      else if (f.type?.includes("flame") || f.type?.includes("fire")) deviceType = "flame";
      else if (f.type?.includes("fog")) deviceType = "fog";
      else if (f.type?.includes("laser")) deviceType = "laser";
      if (!deviceType || typesSeen.has(deviceType)) return;
      typesSeen.add(deviceType);
      const matchDevice = devices.find(d => d.type === deviceType && d.status !== "offline") || devices.find(d => d.type === deviceType);
      if (matchDevice) mapped.push({ deviceType, device: matchDevice });
    });
    if (!mapped.length) {
      alert("No matching devices found. Make sure devices are discovered first.");
      return;
    }
    mapped.forEach(({ deviceType, device }) => {
      if (timelineTracks.find(t => t.deviceId === device.id)) return;
      useShowStore.getState().addTimelineTrack(deviceType);
      const newTrack = useShowStore.getState().timelineTracks.at(-1);
      if (newTrack) {
        useShowStore.setState(s => {
          const t = s.timelineTracks.find(tr => tr.id === newTrack.id);
          if (t) { t.deviceId = device.id; t.label = device.label; }
        });
      }
    });
    alert(`✓ Mapped ${mapped.length} fixture type(s) to timeline tracks:\n${mapped.map(m => `• ${m.device.label}`).join("\n")}`);
  }, [fixtures]);

  const pipeDesign = useMemo(() => ({ geometry, basins, siteSurfaces }), [geometry, basins, siteSurfaces]);
  const pipeSystem = usePipeDrawing({ zoom, pan, snapToGrid, gridStep, fixtures, design: pipeDesign, osnap });
  const {
    pipes: manualPipes, setPipes: replacePipes,
    pipeDiameter, setPipeDiameter, pipeType, setPipeType, pipeDrawMode, setPipeDrawMode, orthogonalMode, setOrthogonalMode,
    selectedPipeId, selectedNode, selectedSegment, setSelectedPipeId, setSelectedNode, setSelectedSegment,
    onPipeMouseMove, onPipeClick, onPipeDoubleClick, cancelDrawing: cancelPipeDrawing,
    selectPipeAtPoint, selectNodeAtPoint, moveNode, deleteSelectedPipe, deleteSelectedSegment,
    updatePipeDiameter, updatePipeType, updatePipeProperties, insertNodeAtPoint, removeNode, renderPipes,
  } = pipeSystem;

  const selectedPipe = manualPipes.find(p => p.id === selectedPipeId) || null;
  const activePipeForPanel = selectedPipe || manualPipes.find(p => p.id === selectedSegment?.pipeId) || null;

  const engineeringSnapshot = useMemo(() => ({
    projectId, projectName, geometry, poolType, params, fixtures, siteSurfaces, manualPipes, layers,
    measurements, depthZones, solvedHydraulics, basins, activeBasinIndex, groups,
    arraySettings: { arrayMode, arrayCount, arrayRows, arrayCols, arrayInset },
  }), [
    projectId, projectName, geometry, poolType, params, fixtures, siteSurfaces, manualPipes, layers,
    measurements, depthZones, solvedHydraulics, basins, activeBasinIndex, groups, arrayMode, arrayCount, arrayRows, arrayCols, arrayInset,
  ]);

  const restoreEngineeringSnapshot = useCallback((snapshot) => {
    useEngineeringStore.getState().updateEngineering({ projectId: snapshot.projectId ?? null });
    setProjectName(snapshot.projectName);
    setGeometry(snapshot.geometry);
    setPoolType(snapshot.poolType);
    setParams(snapshot.params);
    setFixtures(snapshot.fixtures);
    setSiteSurfaces(normalizeSiteSurfaces(snapshot.siteSurfaces));
    replacePipes(snapshot.manualPipes || []);
    setLayers(mergeEngineeringLayers(snapshot.layers));
    setMeasurements(snapshot.measurements || []);
    setDepthZones(snapshot.depthZones || DEFAULT_DEPTH_ZONES);
    loadBasins(snapshot.basins || [], snapshot.activeBasinIndex || 0);
    setSolvedHydraulics(snapshot.solvedHydraulics || null);
    setGroups(snapshot.groups || []);
    const arrays = snapshot.arraySettings || {};
    setArrayMode(arrays.arrayMode || "centerline");
    setArrayCount(arrays.arrayCount || 8);
    setArrayRows(arrays.arrayRows || 3);
    setArrayCols(arrays.arrayCols || 5);
    setArrayInset(arrays.arrayInset ?? 1);
    setSelection([]);
    setSelectedSurfaceId(null);
    setSelectedSurfaceVertex(null);
    setSelectedObject(null);
  }, [replacePipes, loadBasins]);

  const restoreRef = useRef(restoreEngineeringSnapshot);
  restoreRef.current = restoreEngineeringSnapshot;

  // AF-CAD-031: one shared command history (2D designer + 3D editor), JSON deltas per gesture.
  const snapshotRef = useRef(engineeringSnapshot);
  snapshotRef.current = engineeringSnapshot;
  const applyHistoryPatch = useCallback((patch) => {
    const own = {}, external = {};
    for (const [key, value] of Object.entries(patch)) (key in snapshotRef.current ? own : external)[key] = value;
    if (Object.keys(own).length) restoreEngineeringSnapshot({ ...snapshotRef.current, ...own });
    if (Object.keys(external).length) useEngineeringStore.getState().updateEngineering(patchToStoreFields(external));
  }, [restoreEngineeringSnapshot]);
  const historyApi = useDraftingHistory({
    snapshot: engineeringSnapshot,
    apply: applyHistoryPatch,
    getExternal: () => ({ siteModels: useEngineeringStore.getState().siteModels || [] }),
  });
  const handleUndo = historyApi.undo;
  const handleRedo = historyApi.redo;
  // Existing call sites mark transaction boundaries (the next action is its own undo step).
  const pushUndo = historyApi.mark;

  // `.aqua` open/new actions can happen while this workspace stays mounted.
  // Rehydrate every local editor field from the canonical engineering store and
  // start a fresh history for that loaded project.
  useEffect(() => {
    if (!projectLoadRevision) return;
    const store = useEngineeringStore.getState();
    const loadedGeometry = store.geometry || geometryForPoolType(store.poolType, store.params);
    const loadedSnapshot = {
      projectId: store.projectId,
      projectName: store.projectName,
      geometry: loadedGeometry,
      poolType: store.poolType,
      params: store.params,
      fixtures: ensureEntityIdentities(store.fixtures || [], ownerFnFor(store.basins)),
      siteSurfaces: ensureEntityIdentities(normalizeSiteSurfaces(store.siteSurfaces || []), "site"),
      manualPipes: ensureEntityIdentities(store.manualPipes || store.pipes || []),
      layers: mergeEngineeringLayers(store.layers),
      measurements: store.measurements || [],
      depthZones: store.depthZones?.length ? store.depthZones : DEFAULT_DEPTH_ZONES,
      solvedHydraulics: store.solvedHydraulics || null,
      basins: store.basins || [],
      activeBasinIndex: 0,
      groups: store.groups || [],
      arraySettings: { arrayMode:"centerline", arrayCount:8, arrayRows:3, arrayCols:5, arrayInset:1 },
    };
    historyApi.reset(loadedSnapshot);
    restoreRef.current(loadedSnapshot);
    setSaved(false);
    setSaveStatus("");
    // Only a NEW project load may reset the history (never a re-created callback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectLoadRevision]);

  // AF-CAD-031: adopt fixture/pipe edits written to the store by another editor (the 3D
  // workspace). Those were already recorded in the shared history, so only rebase.
  const liveRef = useRef({ fixtures, manualPipes });
  liveRef.current = { fixtures, manualPipes };
  useEffect(() => useEngineeringStore.subscribe((next, previous) => {
    if (next.loadRevision !== previous.loadRevision) return;
    if (next.fixtures !== previous.fixtures && Array.isArray(next.fixtures) && next.fixtures !== liveRef.current.fixtures) {
      historyApi.rebase({ fixtures: next.fixtures });
      setFixtures(next.fixtures);
    }
    if (next.pipes !== previous.pipes && Array.isArray(next.pipes) && next.pipes !== liveRef.current.manualPipes) {
      historyApi.rebase({ manualPipes: next.pipes });
    }
    if (next.groups !== previous.groups && Array.isArray(next.groups)) setGroups((current) => (current === next.groups ? current : next.groups));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  useEffect(() => {
    document.body.dataset.activeWorkspace = "engineering";
    return () => { delete document.body.dataset.activeWorkspace; };
  }, []);

  const poolMetrics = useMemo(
    () => geometryMetrics(geometry, params, zonesForBasin(depthZones, activeBasin?.id || primaryBasinId, primaryBasinId)),
    [geometry, params, depthZones, activeBasin?.id, primaryBasinId]
  );

  // Keep the canvas drawing buffer matched to its CSS size and device pixel ratio.
  useEffect(() => {
    const host = canvasHostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;
    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(320, Math.round(rect.width));
      const height = Math.max(240, Math.round(rect.height));
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      setCanvasViewport((current) => (
        current.width === width && current.height === height && current.dpr === dpr ? current : { width, height, dpr }
      ));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, []);

  // Publish to engineering store — SINGLE sync path.
  // useEngineeringPublisher → engineeringStore → useEngineeringSync → 3D scene
  useEngineeringPublisher({
    projectName,
    // The store / 3D / legacy consumers see basins[0] as `geometry`; `basins` carries them all.
    geometry: primaryBasin.geometry,
    poolType: primaryBasin.poolType,
    params: primaryBasin.params,
    basins, fixtures, siteSurfaces, manualPipes, layers, measurements, depthZones,
    hydraulicSummary, solvedHydraulics, bomItems, groups,
  });

  const isLayerVisible = (key) => layers.find(l => l.key === key)?.visible !== false;
  const isLayerLocked = (key) => layers.find(l => l.key === key)?.locked === true;
  const toggleLayerVisible = (key) => setLayers(prev => prev.map(l => l.key === key ? { ...l, visible:!l.visible } : l));
  const toggleLayerLocked = (key) => setLayers(prev => prev.map(l => l.key === key ? { ...l, locked:!l.locked } : l));

  // ── AF-CAD-032: unified object snap ────────────────────────────────────────
  const snapScene = useMemo(() => buildSnapScene({ fixtures, pipes: manualPipes, geometry, basins, siteSurfaces, measurements }),
    [fixtures, manualPipes, geometry, basins, siteSurfaces, measurements]);
  // A visible CAD underlay vertex/centre inside the aperture is an object-snap candidate.
  const underlaySnap = (cadUnderlay && cadUnderlay.visible !== false)
    ? (pt, radius) => prepareCadUnderlay(cadUnderlay)?.index.nearestVertex(pt, radius, { visibleLayers: underlayLayerVisibility(cadUnderlay) })
    : null;
  const snapCtx = (extra = {}) => ({
    scene: snapScene, worldPerPx: 1 / zoom, grid: { enabled: snapToGrid, step: Number(gridStep || 0.5) },
    osnap, underlay: underlaySnap, polar: false, ...extra,
  });
  const resolvePoint = (pt, extra) => resolveDraftPoint(pt, snapCtx(extra));
  const snapPoint = (pt, extra) => resolvePoint(pt, extra).point;

  // Draw canvas
  useEffect(() => {
    const pipeSnap = tool === "pipe" ? pipeSystem.snapInfo : null;
    const polar = pipeSnap?.polar || hoverSnap?.polar;
    const polarFrom = pipeSnap?.polar ? pipeSnap.from : hoverSnap?.from;
    renderDesignerCanvas(canvasRef.current, {
      canvasViewport, showGrid, zoom, pan, cadUnderlay, isLayerVisible, siteSurfaces, selectedSurfaceId,
      tool, selectedSurfaceVertex, landDrawPoints, landSurfaceType, drawPreview, geometry, showDepth,
      pipework, fixtures, renderPipes, selectedObject, activeGrip, showDimensions, poolMetrics, params,
      basins, activeBasinIndex, depthZones, depthDrawPoints, depthZone, freeformPoints, drawStart,
      polylinePoints, selectedFixture, selectedKeys, measurements, selectionBox,
      snapResult: (pipeSnap ? pipeSnap.snap : hoverSnap?.snap) || null,
      polarGuide: polar && polarFrom ? { from: polarFrom, angleDeg: polar.angleDeg, locked: polar.locked, label: `${Math.round(polar.angleDeg)}°` } : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cadUnderlay, geometry, basins, activeBasinIndex, fixtures, selectedFixture, selectedKeys, siteSurfaces, selectedSurfaceId,
    selectedSurfaceVertex, landDrawPoints, landSurfaceType, freeformPoints, measurements, zoom, pan, showGrid, showDepth,
    tool, manualPipes, selectedPipeId, selectedNode, renderPipes, showDimensions, depthZones, depthDrawPoints, depthZone,
    drawPreview, canvasViewport, poolMetrics, layers, selectedObject, activeGrip, pipework, params, drawStart, polylinePoints,
    selectionBox, hoverSnap, pipeSystem.snapInfo,
  ]);

  // Canvas coordinate helpers
  const toCanvas = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { cx: clientX - rect.left, cy: clientY - rect.top };
  };
  const toWorld = (clientX, clientY) => {
    const { cx, cy } = toCanvas(clientX, clientY);
    return screenToWorld(cx, cy, { pan, zoom });
  };

  const resetView = useCallback(() => {
    setZoom(DEFAULT_VIEW.zoom);
    setPan({ ...DEFAULT_VIEW.pan });
  }, []);

  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    if(!canvas) return;
    const bounds = designBounds(geometry, siteSurfaces);
    if(!bounds) { resetView(); return; }
    const view = fitViewTo(bounds, canvas.clientWidth || canvasViewport.width, canvas.clientHeight || canvasViewport.height);
    setZoom(view.zoom);
    setPan(view.pan);
  }, [geometry, siteSurfaces, resetView, canvasViewport]);

  const clearSelection = useCallback(() => {
    setSelection([]);
    setSelectedObject(null);
    setSelectedSurfaceId(null);
    setSelectedSurfaceVertex(null);
  }, []);

  const deleteSelectedFixture = useCallback(() => {
    if (!selection.length) return false;
    pushUndo(selection.length > 1 ? `Delete ${selection.length} fixtures` : "Delete fixture");
    const keys = new Set(selection);
    setFixtures((current) => current.filter((f) => !keys.has(keyOf(f))));
    setGroups((current) => pruneGroups(current, fixtures.filter((f) => !keys.has(keyOf(f))).map(keyOf)));
    clearSelection();
    setSaveStatus("Selected engineering item deleted · Ctrl+Z to undo.");
    return true;
  }, [pushUndo, selection, fixtures, clearSelection]);

  const duplicateSelectedFixture = useCallback(() => {
    const sources = selectedIndices.map((i) => fixtures[i]).filter(Boolean);
    if (!sources.length) return false;
    pushUndo(sources.length > 1 ? `Duplicate ${sources.length} fixtures` : "Duplicate fixture");
    const copies = sources.map((source) => duplicateFixtureEntity(source));
    setFixtures((current) => [...current, ...copies]);
    setSelection(copies.map(keyOf));
    setSelectedObject("fixture");
    setSaveStatus("Fixture duplicated · drag it to position or edit exact coordinates.");
    return true;
  }, [fixtures, pushUndo, selectedIndices]);

  const deleteSelectedSurface = useCallback(() => {
    if (!selectedSurfaceId) return false;
    pushUndo("Delete surface");
    setSiteSurfaces((current) => current.filter((surface) => surface.id !== selectedSurfaceId));
    setSelectedSurfaceId(null);
    setSelectedSurfaceVertex(null);
    setSelectedObject(null);
    setSaveStatus("Selected land surface deleted · Ctrl+Z to undo.");
    return true;
  }, [pushUndo, selectedSurfaceId]);

  const duplicateSelectedSurface = useCallback(() => {
    const source = siteSurfaces.find((surface) => surface.id === selectedSurfaceId);
    if (!source) return false;
    pushUndo("Duplicate surface");
    const [copy] = ensureEntityIdentities([{ ...source, id: undefined, uuid: undefined, label: `${source.label} Copy`,
      points: source.points.map((point) => ({ x:point.x + 0.5, y:point.y + 0.5 })) }], "site");
    setSiteSurfaces((current) => [...current, copy]);
    setSelectedSurfaceId(copy.id);
    setSelectedSurfaceVertex(null);
    setSelectedObject("surface");
    setSaveStatus("Land surface duplicated · drag it or edit its vertices.");
    return true;
  }, [pushUndo, selectedSurfaceId, siteSurfaces]);

  // ── AF-CAD-034: multi-select, select-similar, groups ───────────────────────
  const selectAllFixtures = useCallback(() => {
    setSelection(fixtures.filter((f) => f.visible !== false).map(keyOf));
    setSelectedObject("fixture");
  }, [fixtures]);
  const selectSimilarFixtures = useCallback(() => {
    if (!selection.length) return;
    setSelection(selectSimilar(fixtures, selection));
    setSelectedObject("fixture");
  }, [fixtures, selection]);
  const groupSelection = useCallback(() => {
    if (selection.length < 2) return null;
    pushUndo("Group fixtures");
    const { groups: next, group } = createGroup(ungroup(groups, selection), selection);
    setGroups(next);
    setSaveStatus(`${group.name}: ${group.members.length} fixtures grouped · click any member to select the group.`);
    return group;
  }, [groups, pushUndo, selection]);
  const ungroupSelection = useCallback(() => {
    const next = ungroup(groups, selection);
    if (next === groups) return false;
    pushUndo("Ungroup fixtures");
    setGroups(next);
    return true;
  }, [groups, pushUndo, selection]);
  const updateFixturesBatch = useCallback((updater, label) => {
    if (label) pushUndo(label);
    setFixtures(updater);
  }, [pushUndo]);

  const deleteCurrentSelection = useCallback(() => {
    if (selectedNode) removeNode(selectedNode.pipeId, selectedNode.nodeIndex);
    else if (selectedSegment) deleteSelectedSegment();
    else if (selectedPipeId) deleteSelectedPipe();
    else if (selectedSurfaceId) deleteSelectedSurface();
    else deleteSelectedFixture();
  }, [selectedNode, selectedSegment, selectedPipeId, selectedSurfaceId, removeNode, deleteSelectedSegment, deleteSelectedPipe, deleteSelectedSurface, deleteSelectedFixture]);

  const deselectAll = useCallback(() => {
    clearSelection();
    setSelectedPipeId(null);
    setSelectedNode(null);
    setSelectedSegment(null);
  }, [clearSelection, setSelectedPipeId, setSelectedNode, setSelectedSegment]);

  useEffect(() => {
    const onEditCommand = (event) => {
      // The designer stays mounted (hidden) after you leave it: only act while it is on screen,
      // so Edit → Delete in another workspace never deletes a hidden selection here.
      if (useProjectStore.getState().workspace?.activePanel !== "geometry") return;
      if (["delete", "deselect"].includes(event.detail?.command)) event.detail.handled = true;
      if (event.detail?.command === "delete") deleteCurrentSelection();
      if (event.detail?.command === "deselect") deselectAll();
    };
    window.addEventListener("aquaflow:edit-command", onEditCommand);
    return () => window.removeEventListener("aquaflow:edit-command", onEditCommand);
  }, [deleteCurrentSelection, deselectAll]);

  // AF-NEXT-009: a preflight finding's "fix" opens the designer on the responsible item
  // (fixture, pipe, basin or land surface): select it and centre the view on it.
  const focusRef = useRef(null);
  focusRef.current = (rawId) => {
    const id = String(rawId ?? "");
    if (!id) return false;
    const match = (e) => String(e?.id) === id || String(e?.uuid) === id;
    const canvas = canvasRef.current;
    const width = canvas?.clientWidth || canvasViewport.width, height = canvas?.clientHeight || canvasViewport.height;
    const centreOn = (p) => setPan({ x: width / 2 - p.x * zoom, y: height / 2 - p.y * zoom });
    const fixture = fixtures.find(match);
    if (fixture) {
      setTool("select");
      setSelection([keyOf(fixture)]);
      setSelectedObject("fixture");
      centreOn({ x: Number(fixture.x) || 0, y: Number(fixture.y) || 0 });
      return true;
    }
    const pipe = manualPipes.find(match);
    if (pipe?.points?.length) {
      setTool("select");
      setSelection([]);
      setSelectedPipeId(pipe.id);
      setSelectedObject("pipe");
      const xs = pipe.points.map((p) => p.x), ys = pipe.points.map((p) => p.y);
      centreOn({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
      return true;
    }
    const basinIndex = basins.findIndex(match);
    if (basinIndex >= 0) {
      setTool("select");
      if (basinIndex !== activeBasinIndex) basinState.selectBasin(basinIndex);
      setSelection([]);
      setSelectedObject("pool");
      const bounds = designBounds(basinIndex === activeBasinIndex ? geometry : basins[basinIndex], []);
      const pts = bounds ? null : (basins[basinIndex].outer || []);
      if (bounds) centreOn({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 });
      else if (pts?.length) centreOn({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
      return true;
    }
    const surface = siteSurfaces.find(match);
    if (surface?.points?.length) {
      setTool("select");
      setSelection([]);
      setSelectedSurfaceId(surface.id);
      setSelectedObject("surface");
      centreOn({ x: surface.points.reduce((s, p) => s + p.x, 0) / surface.points.length, y: surface.points.reduce((s, p) => s + p.y, 0) / surface.points.length });
      return true;
    }
    setSaveStatus(`Preflight item ${id} was not found in this design.`);
    return false;
  };
  useEffect(() => {
    const targetOf = (detail) => detail?.target ?? detail?.id ?? null;
    const onSelectItem = (event) => {
      takePendingFocus("engineering"); // handled live — do not replay it on the next mount
      focusRef.current?.(targetOf(event.detail));
    };
    window.addEventListener("aquaflow:select-engineering-item", onSelectItem);
    const pendingFocus = takePendingFocus("engineering");
    if (pendingFocus) setTimeout(() => focusRef.current?.(targetOf(pendingFocus)), 0);
    return () => window.removeEventListener("aquaflow:select-engineering-item", onSelectItem);
  }, []);

  useEffect(() => {
    if (!fitAfterCADImport) return;
    fitView();
    setFitAfterCADImport(false);
  }, [fitAfterCADImport, fitView]);

  const finishDepthZone = () => {
    const basinId = activeBasin?.id || primaryBasinId;
    const validation = validateDepthZone(
      depthDrawPoints,
      geometry,
      zonesForBasin(depthZones, basinId, primaryBasinId).filter((zone) => (zone.zone || zone.key) !== depthZone)
    );
    if (!validation.valid) {
      setDepthZoneError(validation.errors.join(" "));
      return false;
    }
    // AF-NEXT-010: depth zones are scoped to the basin being edited.
    setDepthZones((zones) => upsertBasinDepthZone(zones, { zoneKey: depthZone, basinId, primaryId: primaryBasinId, points: depthDrawPoints }));
    setDepthDrawPoints([]);
    setDrawPreview(null);
    setDepthZoneError("");
    return true;
  };

  const cancelDepthZone = () => {
    setDepthDrawPoints([]);
    setDrawPreview(null);
    setDepthZoneError("");
  };

  const cancelDrawing = () => {
    setDrawStart(null);
    setDrawPreview(null);
    setPolylinePoints([]);
    setLandDrawPoints([]);
    setMeasureStart(null);
    setDynamicInput(emptyDynamicInput());
    cancelDepthZone();
  };

  const escapeAll = () => {
    setTool("select");
    setMeasureStart(null);
    setIsPanning(false);
    setDrawStart(null);
    setDrawPreview(null);
    setPolylinePoints([]);
    setLandDrawPoints([]);
    setDepthDrawPoints([]);
    setDepthZoneError("");
    setSelectionBox(null);
    setDynamicInput(emptyDynamicInput());
    cancelPipeDrawing();
    setSelectedPipeId(null);
    setSelectedNode(null);
    setSelectedSegment(null);
    setSelectedSurfaceVertex(null);
  };

  // ── AF-CAD-033: typed entry while a pipe waits for its next point ───────────
  const typedFrom = () => pipeSystem.drawing?.points?.at(-1) || null;
  const handleDynamicKey = (e) => {
    const drawingActive = DESIGNER_TYPING_TOOLS.has(tool) && pipeSystem.drawing?.points?.length;
    if (!drawingActive) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const { state, action, handled } = dynamicInputKey(dynamicInput, e.key);
    if (!handled) return false;
    e.preventDefault();
    if (action?.type === "cancel") {
      // Esc with a typed value clears it; Esc with an empty field cancels the command.
      if (dynamicInput.active) { setDynamicInput(emptyDynamicInput()); return true; }
      return false;
    }
    if (action?.type === "finish") { setDynamicInput(emptyDynamicInput()); pipeSystem.finishDrawing(); return true; }
    if (action?.type === "commit") {
      const from = typedFrom();
      const angle = pipeSystem.snapInfo?.polar?.angleDeg ?? (pipeSystem.mouseWorld && from ? angleOf(from, pipeSystem.mouseWorld) : 0);
      const point = resolveDynamicInput(from, state, { cursorAngleDeg: angle });
      if (!point) { setSaveStatus("Typed value not understood · use 12.5, 12.5<30, @dx,dy or x,y."); return true; }
      setDynamicInput(emptyDynamicInput());
      pipeSystem.addTypedPoint(point);
      return true;
    }
    setDynamicInput(state);
    return true;
  };

  // Single keyboard handler: undo/redo, palette, typed input, navigation, selection, delete.
  const keyHandlerRef = useRef(null);
  keyHandlerRef.current = (e) => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (["input","textarea","select"].includes(tag)) return;
    const key = e.key?.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && key === "k") { e.preventDefault(); setPaletteOpen((open) => !open); return; }
    if (paletteOpen) return;
    if (ctrl && !e.shiftKey && key === "z") { e.preventDefault(); handleUndo(); return; }
    if (ctrl && (key === "y" || (e.shiftKey && key === "z"))) { e.preventDefault(); handleRedo(); return; }
    if (handleDynamicKey(e)) return;
    if (e.code === "Space") { e.preventDefault(); setIsSpaceDown(true); }
    if (ctrl && key === "a") { e.preventDefault(); selectAllFixtures(); return; }
    if (ctrl && key === "g") { e.preventDefault(); if (e.shiftKey) ungroupSelection(); else groupSelection(); return; }
    if (!ctrl && key === "f") fitView();
    if (!ctrl && key === "h") resetView();
    if (ctrl && key === "d" && (selection.length || selectedSurfaceId)) {
      e.preventDefault();
      if (selectedSurfaceId) duplicateSelectedSurface();
      else duplicateSelectedFixture();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      const hasSelection = Boolean(selectedNode || selectedSegment || selectedPipeId || selection.length || selectedSurfaceId);
      if (!hasSelection) return;
      e.preventDefault();
      deleteCurrentSelection();
      return;
    }
    if (e.key === "Escape") escapeAll();
  };
  useEffect(() => {
    const onKeyDown = (e) => keyHandlerRef.current?.(e);
    const onKeyUp = (e) => {
      if(e.code === "Space") { e.preventDefault(); setIsSpaceDown(false); setIsPanning(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, []);

  const moveGeometryBy = (dx, dy) => {
    setGeometry(prev => translateGeometry(prev, dx, dy));
    setFixtures(prev => prev.map(f => ({ ...f, x:f.x + dx, y:f.y + dy })));
  };

  const onCanvasContextMenu = (e) => {
    e.preventDefault();
    const rawWorld = toWorld(e.clientX, e.clientY);
    if (selectNodeAtPoint(rawWorld)) {
      setSelectedObject("pipe_node");
      setPipeContextMenu({ x: e.clientX, y: e.clientY, world: rawWorld, type: "node" });
      return;
    }
    if (selectPipeAtPoint(rawWorld)) {
      setSelectedObject("pipe");
      setPipeContextMenu({ x: e.clientX, y: e.clientY, world: rawWorld, type: "pipe" });
      return;
    }
    setPipeContextMenu(null);
  };

  const placeFixture = (world) => {
    const layerKey = toolLayerKey(tool);
    if (layerKey && isLayerLocked(layerKey)) return;
    if (!pointInAnyBasin(basins, world)) return;
    pushUndo("Place fixture");
    const ft = FIXTURE_TYPES.find(t => t.key === fixtureType) || { key: fixtureType, label: fixtureType || "Equipment" };
    setFixtures(prev => [...prev, createFixtureEntity({
      type: fixtureType,
      x: Math.round(world.x * 10) / 10,
      y: Math.round(world.y * 10) / 10,
      label: `${ft.label} ${fixtures.filter(f=>f.type===fixtureType).length+1}`,
      zone: depthZone,
      owner: ownerForPoint(basins, world),
    })]);
  };

  const startFixtureDrag = (hitIndex, rawWorld, additive) => {
    const key = keyOf(fixtures[hitIndex]);
    if (additive) {
      setSelection((current) => clickSelection(current, key, { additive: true }));
      setSelectedObject("fixture");
      return;
    }
    const keys = selection.includes(key) ? selection : expandToGroups(groups, [key]);
    setSelection(keys);
    setSelectedObject("fixture");
    const moving = new Set(keys);
    const origins = new Map(fixtures.filter((f) => moving.has(keyOf(f))).map((f) => [keyOf(f), { x: Number(f.x) || 0, y: Number(f.y) || 0 }]));
    fixtureDragRef.current = {
      anchor: key, origins, moved: false,
      scene: buildSnapScene({ fixtures, pipes: manualPipes, geometry, basins, siteSurfaces, measurements }, { exclude: [...keys, ...fixtures.filter((f) => moving.has(keyOf(f))).map((f) => f.id)] }),
    };
    historyApi.beginGesture(keys.length > 1 ? `Move ${keys.length} fixtures` : "Move fixture");
  };

  const onCanvasMouseDown = (e) => {
    const rawWorld = toWorld(e.clientX, e.clientY);
    const world = snapPoint(rawWorld, tool === "polyline" && polylinePoints.length ? { from: polylinePoints.at(-1), polar: true, shift: e.shiftKey } : undefined);
    setPipeContextMenu(null);
    if (tool === "select") {
      const node = selectNodeAtPoint(rawWorld);
      if (node) { setSelectedObject("pipe_node"); setSelection([]); historyApi.beginGesture("Move pipe node"); return; }
      const pipeHit = selectPipeAtPoint(rawWorld);
      if (pipeHit) { setSelectedObject("pipe"); setSelection([]); return; }
    }
    if(e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || isSpaceDown))) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }
    if (tool === "pipe") { onPipeClick(rawWorld, { shift: e.shiftKey }); setDynamicInput(emptyDynamicInput()); return; }
    if (tool === "land") {
      if (isLayerLocked("landscape")) return;
      setLandDrawPoints((points) => [...points, world]);
      setDrawPreview(world);
      return;
    }
    if (tool === "depth") {
      if (!pointInGeometry(world, geometry)) { setDepthZoneError("Depth-zone points must be inside the pool."); return; }
      setDepthZoneError("");
      setDepthDrawPoints((points) => [...points, world]);
      setDrawPreview(world);
      return;
    }
    if(tool === "rectangle") {
      if(isLayerLocked("pool_outline")) return;
      if(!drawStart) { setDrawStart(world); setDrawPreview(world); return; }
      pushUndo("Draw rectangle pool");
      setPoolType("rectangular");
      setParams(p => ({ ...p, width: Math.max(1, Number(Math.abs(world.x - drawStart.x).toFixed(3))), length: Math.max(1, Number(Math.abs(world.y - drawStart.y).toFixed(3))) }));
      setGeometry({
        type:"rectangle",
        points:[
          {x:Math.min(drawStart.x, world.x), y:Math.min(drawStart.y, world.y)},
          {x:Math.max(drawStart.x, world.x), y:Math.min(drawStart.y, world.y)},
          {x:Math.max(drawStart.x, world.x), y:Math.max(drawStart.y, world.y)},
          {x:Math.min(drawStart.x, world.x), y:Math.max(drawStart.y, world.y)},
        ],
        closed:true,
      });
      setDrawStart(null);
      setDrawPreview(null);
      return;
    }
    if(tool === "circle") {
      if(isLayerLocked("pool_outline")) return;
      if(!drawStart) { setDrawStart(world); setDrawPreview(world); return; }
      pushUndo("Draw circular pool");
      const radius = Math.max(1, Number(Math.hypot(world.x - drawStart.x, world.y - drawStart.y).toFixed(3)));
      setPoolType("circular");
      setParams(p => ({ ...p, radius }));
      setGeometry({ type:"circle", center:drawStart, radius });
      setDrawStart(null);
      setDrawPreview(null);
      return;
    }
    if(tool === "polyline") {
      if(isLayerLocked("pool_outline")) return;
      setPolylinePoints(prev => [...prev, world]);
      setDrawPreview(world);
      return;
    }
    if(tool === "select") {
      // Fixture selection must happen before pool selection. Use rawWorld, not the
      // snapped point, otherwise small fixtures become hard to select.
      const fixtureHitRadius = Math.max(0.35, 12 / zoom);
      const hit = fixtures.findIndex(f => Math.hypot(f.x - rawWorld.x, f.y - rawWorld.y) <= fixtureHitRadius);
      if(hit >= 0) {
        setSelectedSurfaceId(null);
        setSelectedSurfaceVertex(null);
        setActiveGrip(null);
        setIsDraggingGeometry(false);
        setLastDragWorld(null);
        startFixtureDrag(hit, rawWorld, e.shiftKey);
        return;
      }
      const grip = hitGrip(geometry, world, zoom);
      if(grip) {
        historyApi.beginGesture("Stretch pool");
        setActiveGrip(grip);
        setSelection([]);
        setSelectedSurfaceId(null);
        setSelectedSurfaceVertex(null);
        setSelectedObject("pool");
        return;
      }
      if (!isLayerLocked("landscape")) {
        const surfaceVertex = hitSurfaceVertex(siteSurfaces.find((entry) => entry.id === selectedSurfaceId), rawWorld, zoom);
        if (surfaceVertex !== null) {
          historyApi.beginGesture("Edit surface vertex");
          setSelectedSurfaceVertex(surfaceVertex);
          setSelection([]);
          setSelectedObject("surface");
          setIsDraggingSurface(false);
          return;
        }
      }
      // AF-CAD-034: Ctrl-drag anywhere (or a press on empty space) opens a selection box.
      const insidePool = pointInsideOutline(geometry, world);
      if (e.ctrlKey || e.metaKey) { setSelectionBox({ start: rawWorld, end: rawWorld, additive: e.shiftKey }); return; }
      if(isLayerLocked("pool_outline") && insidePool) return;
      if (!e.shiftKey) {
        setSelection([]);
        setSelectedSurfaceId(null);
        setSelectedSurfaceVertex(null);
        setSelectedObject(null);
      }
      // If no fixture is selected, allow dragging the full pool geometry
      if(insidePool) {
        historyApi.beginGesture("Move pool");
        setSelectedObject("pool");
        setIsDraggingGeometry(true);
        setLastDragWorld(world);
        return;
      }
      if (!isLayerLocked("landscape")) {
        const surfaceHit = [...siteSurfaces].reverse().find((surface) => surface.visible !== false && pointInSurface(rawWorld, surface));
        if (surfaceHit) {
          historyApi.beginGesture("Move surface");
          setSelectedSurfaceId(surfaceHit.id);
          setSelectedObject("surface");
          setIsDraggingSurface(true);
          setLastDragWorld(world);
          return;
        }
      }
      setSelectionBox({ start: rawWorld, end: rawWorld, additive: e.shiftKey });
    } else if(tool === "nozzle" || tool === "light" || tool === "equipment") {
      placeFixture(world);
    } else if(tool === "measure") {
      if(!measureStart) setMeasureStart(world);
      else {
        setMeasurements(prev => [...prev, { x1:measureStart.x, y1:measureStart.y, x2:world.x, y2:world.y }]);
        setMeasureStart(null);
      }
    } else if(tool === "delete") {
      const hit = fixtures.findIndex(f => Math.hypot(f.x - world.x, f.y - world.y) < 0.5);
      if(hit >= 0) {
        pushUndo("Delete fixture");
        setFixtures(prev => prev.filter((_,i) => i !== hit));
        setSelection([]);
      } else {
        const surfaceHit = [...siteSurfaces].reverse().find((surface) => pointInSurface(world, surface));
        if (surfaceHit) { pushUndo("Delete surface"); setSiteSurfaces((current) => current.filter((surface) => surface.id !== surfaceHit.id)); }
      }
    }
  };

  const onCanvasMouseMove = (e) => {
    const rawWorld = toWorld(e.clientX, e.clientY);
    const polylineFrom = tool === "polyline" && polylinePoints.length ? polylinePoints.at(-1) : null;
    const resolved = resolvePoint(rawWorld, polylineFrom ? { from: polylineFrom, polar: true, shift: e.shiftKey } : undefined);
    const world = resolved.point;
    setCursorWorld({ x: world.x, y: world.y });
    const { cx, cy } = toCanvas(e.clientX, e.clientY);
    setCursorScreen({ x: cx, y: cy });
    if (tool !== "pipe" && tool !== "select") setHoverSnap({ snap: resolved.snap, polar: resolved.polar, from: polylineFrom });
    else if (hoverSnap) setHoverSnap(null);

    if (selectionBox) { setSelectionBox((box) => (box ? { ...box, end: rawWorld } : box)); return; }
    if (tool === "select" && selectedNode && e.buttons === 1) {
      moveNode(selectedNode.pipeId, selectedNode.nodeIndex, rawWorld);
      setSelectedObject("pipe_node");
      return;
    }
    if (tool === "pipe") {
      onPipeMouseMove(rawWorld, { shift: e.shiftKey });
      if (!isPanning) return;
    }
    if(isPanning) { setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y }); return; }
    if((tool === "rectangle" || tool === "circle") && drawStart) setDrawPreview(world);
    if (tool === "depth" && depthDrawPoints.length) setDrawPreview(world);
    if (tool === "land" && landDrawPoints.length) setDrawPreview(world);
    if(tool === "polyline") {
      if(isLayerLocked("pool_outline")) return;
      setDrawPreview(world);
    }
    if (tool === "select" && selectedSurfaceId && selectedSurfaceVertex !== null && e.buttons === 1) {
      setSiteSurfaces((current) => current.map((surface) => (
        surface.id === selectedSurfaceId ? updateSurfaceVertex(surface, selectedSurfaceVertex, world) : surface
      )));
      return;
    }
    if(activeGrip) {
      const next = stretchFromGrip({ geometry, params, poolType }, activeGrip, world);
      if (next) { setGeometry(next.geometry); setParams(next.params); }
      return;
    }
    if(isDraggingGeometry && lastDragWorld) {
      moveGeometryBy(world.x - lastDragWorld.x, world.y - lastDragWorld.y);
      setLastDragWorld(world);
      return;
    }
    if (isDraggingSurface && selectedSurfaceId && lastDragWorld) {
      const dx = world.x - lastDragWorld.x;
      const dy = world.y - lastDragWorld.y;
      setSiteSurfaces((current) => current.map((surface) => (surface.id === selectedSurfaceId ? moveSurface(surface, dx, dy) : surface)));
      setLastDragWorld(world);
      return;
    }
    const drag = fixtureDragRef.current;
    if(tool === "select" && e.buttons === 1 && drag) {
      // AF-CAD-002: full precision with SNAP off; snapped exactly once with SNAP on.
      // AF-CAD-032: object snaps (other fixtures' ports, pipe ends, pool edges) win over the grid.
      const res = resolveDraftPoint(rawWorld, { ...snapCtx(), scene: drag.scene });
      const origin = drag.origins.get(drag.anchor);
      const dx = res.point.x - origin.x, dy = res.point.y - origin.y;
      drag.moved = true;
      setHoverSnap({ snap: res.snap, polar: null, from: null });
      setFixtures(prev => prev.map((f) => {
        const o = drag.origins.get(keyOf(f));
        return o ? { ...f, x: keyOf(f) === drag.anchor ? res.point.x : o.x + dx, y: keyOf(f) === drag.anchor ? res.point.y : o.y + dy } : f;
      }));
    }
  };

  const onCanvasMouseUp = () => {
    if (selectionBox) {
      const picked = boxSelect(fixtures.filter((f) => f.visible !== false), selectionBox.start, selectionBox.end);
      const tiny = Math.hypot(selectionBox.end.x - selectionBox.start.x, selectionBox.end.y - selectionBox.start.y) * zoom < 3;
      if (!tiny) {
        const expanded = expandToGroups(groups, picked);
        setSelection((current) => (selectionBox.additive ? mergeSelection(current, expanded) : expanded));
        if (expanded.length) setSelectedObject("fixture");
      }
      setSelectionBox(null);
    }
    if (fixtureDragRef.current) { fixtureDragRef.current = null; setHoverSnap(null); }
    historyApi.endGesture();
    setIsPanning(false);
    setIsDraggingGeometry(false);
    setIsDraggingSurface(false);
    setLastDragWorld(null);
    setActiveGrip(null);
  };

  const onCanvasWheel = (e) => {
    e.preventDefault();
    if(!canvasRef.current) return;
    const { cx, cy } = toCanvas(e.clientX, e.clientY);
    const view = zoomAbout({ pan, zoom }, cx, cy, e.deltaY);
    setZoom(view.zoom);
    setPan(view.pan);
  };

  const finishPolyline = () => {
    if(polylinePoints.length >= 3) {
      pushUndo("Draw custom pool");
      setGeometry({ type:"freeform", points: polylinePoints, closed:true });
      setPoolType("freeform");
      setFreeformPoints([]);
    }
    setPolylinePoints([]);
    setDrawStart(null);
    setDrawPreview(null);
  };

  const finishLandSurface = () => {
    const points = dedupeSurfacePoints(landDrawPoints);
    if (points.length < 3) return false;
    pushUndo("Draw land surface");
    const preset = LAND_SURFACE_TYPES.find((entry) => entry.key === landSurfaceType) || LAND_SURFACE_TYPES[0];
    const sameTypeCount = siteSurfaces.filter((surface) => surface.type === preset.key).length;
    const [surface] = ensureEntityIdentities([{
      label: `${preset.label} Area ${sameTypeCount + 1}`, type: preset.key, color: preset.color, elevation: 0.02, visible: true, points,
    }], "site");
    setSiteSurfaces((current) => [...current, surface]);
    setSelectedSurfaceId(surface.id);
    setSelectedSurfaceVertex(null);
    setSelectedObject("surface");
    setLandDrawPoints([]);
    setDrawPreview(null);
    setTool("select");
    setSaveStatus(`${preset.label} surface created · select it to move or edit vertices.`);
    return true;
  };

  const clearMeasurements = () => setMeasurements([]);

  const buildProjectPayload = () => composeProjectPayload({
    projectId, projectName, primaryBasin, basins, fixtures, siteModels: useEngineeringStore.getState().siteModels, siteSurfaces,
    cadUnderlay, manualPipes, measurements, layers, depthZones, solvedHydraulics, poolMetrics, groups,
    arraySettings: { arrayMode, arrayCount, arrayRows, arrayCols, arrayInset }, hydraulicSummary, pipework, baseBomItems,
  });

  const downloadTextFile = (filename, content, mime = "text/plain") => {
    saveTextFile(filename, content, mime);
    setExportStatus(`Exported ${filename}`);
    setTimeout(() => setExportStatus(""), 2500);
  };
  const exportProjectJSON = () => downloadTextFile(`${safeFileName(projectName)}.aquaflow.json`, JSON.stringify(buildProjectPayload(), null, 2), "application/json");
  const exportBOMCSV = () => downloadTextFile(`${safeFileName(projectName)}_BOM.csv`, buildBomCsv(bomItems, hydraulicSummary), "text/csv");

  // AF-CAD-003: one writer — the backend ezdxf exporter when the engine is reachable, the
  // browser writer (same layers / XDATA / frame) only offline.
  const exportProjectDXF = async () => {
    try {
      const { dxf, writer } = await requestCadExportDxf(buildProjectPayload());
      downloadTextFile(`${safeFileName(projectName)}.dxf`, dxf, "application/dxf");
      if (writer === "browser") setExportStatus("DXF exported with the built-in writer (AquaFlow engine not running): no blocks/attributes or dimensions.");
    } catch (error) {
      setExportStatus(`CAD export failed: ${error.message}`);
    }
  };

  const exportProjectDWG = async () => {
    if (cadExportBusy) return;
    setCadExportBusy(true);
    setExportStatus("Creating AutoCAD DWG… Choose where to save the drawing.");
    try {
      if (!window.aquaflow?.exportDWG) throw new Error("Native DWG export needs the updated AquaFlow desktop app. Close and reopen it after installing the update.");
      // AF-CAD-018: the desktop app gates ODA File Converter by licence edition / acknowledgement.
      const licenseEdition = await apiGet("/license/status").then((s) => String(s?.edition || "UNKNOWN")).catch(() => "UNKNOWN");
      const { dxf } = await requestCadExportDxf(buildProjectPayload());
      const request = { name:projectName, dxf, licenseEdition };
      let result = await window.aquaflow.exportDWG(request);
      if (result?.needsOdaAcknowledgement && window.confirm(`${result.notice}\n\nConfirm that this export is for non-commercial use to convert with ODA File Converter.`)) {
        result = await window.aquaflow.exportDWG({ ...request, odaAcknowledged:true });
      }
      if (result?.canceled) setExportStatus("DWG export canceled.");
      else if (!result?.ok) throw new Error(result?.error || "The CAD engine could not create the DWG.");
      else setExportStatus(`DWG saved: ${result.path} (${result.engine}; AutoCAD 2022 compatible).`);
    } catch (error) { setExportStatus(`DWG export failed: ${error.message}`); }
    finally { setCadExportBusy(false); }
  };

  const applyCADDesign = (project, report) => {
    pushUndo("Import CAD design");
    const next = {
      ...engineeringSnapshot,
      projectId: project.id ?? null,
      projectName: project.name,
      geometry: project.geometry,
      poolType: project.pool_type,
      params: project.params,
      fixtures: ensureEntityIdentities(project.fixtures || [], ownerFnFor(project.basins)),
      siteSurfaces: project.site_surfaces || project.siteSurfaces || [],
      manualPipes: ensureEntityIdentities(project.manualPipes || []),
      layers: mergeEngineeringLayers(project.layers),
      measurements: project.measurements || [],
      depthZones: project.depth_zones || [],
      basins: project.basins || [],
      activeBasinIndex: 0,
      groups: project.groups || [],
      solvedHydraulics: null,
    };
    cancelPipeDrawing();
    setSelectedPipeId(null);
    setSelectedNode(null);
    setSelectedSegment(null);
    restoreEngineeringSnapshot(next);
    // The underlay is a reference drawing kept outside undo history (it can be 50k+ entities).
    updateCadUnderlay(project.cad_underlay ?? null);
    setShowCADImport(false);
    setFitAfterCADImport(true);
    setSaved(false);
    setSaveStatus(`Imported ${report.fileName}: ${report.imported} CAD fixtures, ${report.mode === "update" ? report.matched : 0} matched control records. Review the design, then SAVE PROJECT. Undo is available.`);
  };

  const saveProject = async () => {
    const project = buildProjectPayload();
    setSaveStatus("Saving engineering project…");
    try {
      const result = await apiPost("/geometry/projects", project);
      setSaved(true);
      setSaveStatus(`Saved as ${result.id}`);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      setSaved(false);
      setSaveStatus(`Save failed: ${error.message}`);
    }
  };

  const runHydraulics = async () => {
    setHydraulicRunState({ loading:true, error:"" });
    try {
      const payload = buildHydraulicPreviewPayload({ fixtures, params, volumeLitres: poolMetrics.capacityLitres });
      if (!payload.nozzles.length) throw new Error("Place at least one hydraulic nozzle before solving.");
      const result = await apiPost("/hydraulics/preview-physics", payload);
      setSolvedHydraulics(normalizeHydraulicResult(result));
      setHydraulicRunState({ loading:false, error:"" });
    } catch (error) {
      setHydraulicRunState({ loading:false, error:error.message });
    }
  };

  const applyFixtureArray = () => {
    if(!geometry) return;
    if(fixtureType?.startsWith("nozzle") && isLayerLocked("nozzles")) return;
    if(fixtureType?.startsWith("light") && isLayerLocked("lights")) return;
    const ft = FIXTURE_TYPES.find(t => t.key === fixtureType) || FIXTURE_TYPES[0];
    const made = buildFixtureArray({
      geometry, fixtureType, typeLabel: ft.label, existing: fixtures, mode: arrayMode, count: arrayCount, rows: arrayRows,
      cols: arrayCols, inset: arrayInset, zone: depthZone, owner: ownerForPoint(basins, { x: geometry.center?.x ?? 0, y: geometry.center?.y ?? 0 }),
    });
    if (!made.length) return;
    pushUndo(`Array ${made.length} fixtures`);
    setFixtures(prev => [...prev, ...made]);
  };

  const autoPlaceNozzles = () => {
    if(!geometry) return;
    pushUndo("Auto-place nozzles");
    setFixtures(prev => [...prev, ...autoPlaceFixtures(geometry, params)]);
  };

  const setGeometryProperty = (key, rawValue) => {
    const next = editGeometryProperty({ geometry, params }, key, rawValue);
    if (!next) return;
    if (next.geometry !== geometry) setGeometry(next.geometry);
    if (next.params !== params) setParams(next.params);
  };

  const selectedSurface = siteSurfaces.find((surface) => surface.id === selectedSurfaceId) || null;
  const selectedSurfaceMetrics = selectedSurface ? surfaceMetrics(selectedSurface.points) : null;
  const updateSelectedSurface = (patch) => {
    if (!selectedSurfaceId) return;
    setSiteSurfaces((current) => current.map((surface) => (surface.id === selectedSurfaceId ? { ...surface, ...patch } : surface)));
  };
  const sf = selectedFixture !== null ? fixtures[selectedFixture] : null;
  const geometryMeta = outlineMeta(geometry);

  const changePoolType = (nextType) => {
    if (nextType === poolType) return;
    setPoolType(nextType);
    setGeometry(synchronizePoolGeometry({ geometry, previousType: poolType, poolType: nextType, params }));
    setSelectedObject("pool");
  };

  const startCustomPoolDrawing = () => {
    pushUndo();
    cancelDrawing();
    setPoolType("freeform");
    setTool("polyline");
    setSelection([]);
    setSelectedObject("pool");
    setSaveStatus("CUSTOM POOL: click each boundary point, then double-click or choose Close Polyline.");
  };

  const setNumericParam = (key, value, min, max) => {
    const n = Number(value);
    if(Number.isNaN(n)) return;
    const nextParams = { ...params, [key]: Math.max(min, Math.min(max, n)) };
    setParams(nextParams);
    if (key !== "depth" && poolType !== "freeform") {
      setGeometry(synchronizePoolGeometry({ geometry, previousType: poolType, poolType, params: nextParams }));
    }
  };

  const safePoolTypes = POOL_TYPES;
  const safeDepthZones = depthZones.map((zone) => ({ ...zone, key: zone.zone || zone.key || zone.id }));

  const loadICANSiteDesign = () => {
    useEngineeringStore.getState().loadProject(createICANSiteEngineeringProject());
    setSaveStatus("Loaded confirmed 100-outlet site layout; dimensions remain provisional");
  };

  const chooseProjectFile = () => {
    const input = projectFileInputRef.current;
    if (!input) return;
    // Clearing first makes choosing the same file twice fire onChange again.
    input.value = "";
    input.click();
  };

  const openProjectFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSaveStatus(`Opening ${file.name}…`);
    try {
      const project = parseEngineeringProjectFile(await file.text());
      useEngineeringStore.getState().loadProject(project);
      setShowSavedProjects(false);
      setFitAfterCADImport(true);
      setSaveStatus(`Opened ${file.name} · ${project.fixtures.length} fixtures`);
    } catch (error) {
      setSaveStatus(`Open failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };

  const toggleSavedProjectBrowser = async () => {
    if (showSavedProjects) { setShowSavedProjects(false); return; }
    setSavedProjectsLoading(true);
    try {
      const result = await apiGet("/geometry/projects");
      const projects = Array.isArray(result?.projects) ? result.projects : [];
      setSavedProjects(projects);
      setSelectedSavedProjectId(projects[0]?.id || "");
      setShowSavedProjects(true);
      setSaveStatus(projects.length ? `${projects.length} saved engineering projects found` : "No saved engineering projects found");
    } catch (error) {
      setSaveStatus(`Load list failed: ${error.message}`);
    } finally {
      setSavedProjectsLoading(false);
    }
  };

  const openSavedProject = async () => {
    if (!selectedSavedProjectId) return;
    setSavedProjectsLoading(true);
    try {
      const project = await apiGet(`/geometry/projects/${encodeURIComponent(selectedSavedProjectId)}`);
      useEngineeringStore.getState().loadProject(project);
      setShowSavedProjects(false);
      setSaveStatus(`Opened ${project.name || selectedSavedProjectId}`);
    } catch (error) {
      setSaveStatus(`Open failed: ${error.message}`);
    } finally {
      setSavedProjectsLoading(false);
    }
  };

  // ── AF-CAD-033: every designer command, for the Ctrl+K palette ──────────────
  const hasFixtureSelection = selection.length > 0;
  const paletteCommands = [
    ...TOOLS.map((t) => ({ id: `tool:${t.key}`, group: "Tool", label: t.label, aliases: [t.key], run: () => { setTool(t.key); cancelDrawing(); } })),
    { id: "edit:undo", group: "Edit", label: "Undo", shortcut: "Ctrl+Z", enabled: historyApi.canUndo, run: handleUndo },
    { id: "edit:redo", group: "Edit", label: "Redo", shortcut: "Ctrl+Y", enabled: historyApi.canRedo, run: handleRedo },
    { id: "edit:delete", group: "Edit", label: "Delete selection", shortcut: "Del", run: deleteCurrentSelection },
    { id: "edit:duplicate", group: "Edit", label: "Duplicate selection", shortcut: "Ctrl+D", enabled: hasFixtureSelection || !!selectedSurfaceId, run: () => (selectedSurfaceId ? duplicateSelectedSurface() : duplicateSelectedFixture()) },
    { id: "select:all", group: "Select", label: "Select all fixtures", shortcut: "Ctrl+A", run: selectAllFixtures },
    { id: "select:similar", group: "Select", label: "Select similar (same type / block)", enabled: hasFixtureSelection, run: selectSimilarFixtures },
    { id: "select:none", group: "Select", label: "Deselect all", shortcut: "Esc", run: deselectAll },
    { id: "group:create", group: "Group", label: "Group selection", shortcut: "Ctrl+G", enabled: selection.length > 1, run: groupSelection },
    { id: "group:ungroup", group: "Group", label: "Ungroup selection", shortcut: "Ctrl+Shift+G", enabled: hasFixtureSelection, run: ungroupSelection },
    { id: "view:fit", group: "View", label: "Fit view", shortcut: "F", run: fitView },
    { id: "view:home", group: "View", label: "Home view", shortcut: "H", run: resetView },
    { id: "view:grid", group: "View", label: `Grid ${showGrid ? "off" : "on"}`, run: () => setShowGrid((g) => !g) },
    { id: "view:dims", group: "View", label: `Dimensions ${showDimensions ? "off" : "on"}`, run: () => setShowDimensions((v) => !v) },
    { id: "view:depth", group: "View", label: `Depth shading ${showDepth ? "off" : "on"}`, run: () => setShowDepth((v) => !v) },
    { id: "snap:grid", group: "Snap", label: `Grid snap ${snapToGrid ? "off" : "on"}`, run: () => setSnapToGrid((v) => !v) },
    { id: "snap:object", group: "Snap", label: `Object snap ${osnap ? "off" : "on"}`, aliases: ["osnap"], run: () => setOsnap((v) => !v) },
    { id: "pipe:ortho", group: "Pipe", label: `Ortho ${orthogonalMode ? "off" : "on"}`, run: () => setOrthogonalMode((v) => !v) },
    ...["straight", "polyline", "curve", "arc"].map((mode) => ({ id: `pipe:mode:${mode}`, group: "Pipe", label: `Pipe mode: ${mode}`, run: () => { setTool("pipe"); setPipeDrawMode(mode); } })),
    { id: "design:custom-pool", group: "Design", label: "Draw custom pool", run: startCustomPoolDrawing },
    { id: "design:array", group: "Design", label: "Apply fixture array", run: applyFixtureArray },
    { id: "design:autoplace", group: "Design", label: "Auto-place nozzles", run: autoPlaceNozzles },
    { id: "design:hydraulics", group: "Design", label: "Run hydraulic solver", run: runHydraulics },
    { id: "project:save", group: "Project", label: "Save project", run: saveProject },
    { id: "project:open", group: "Project", label: "Open project file…", run: chooseProjectFile },
    { id: "project:import-cad", group: "Project", label: "Import AutoCAD DWG / DXF", run: () => setShowCADImport(true) },
    { id: "export:json", group: "Export", label: "Export JSON", run: exportProjectJSON },
    { id: "export:bom", group: "Export", label: "Export BOM (CSV)", run: exportBOMCSV },
    { id: "export:dxf", group: "Export", label: "Export DXF", run: exportProjectDXF },
    { id: "export:dwg", group: "Export", label: "Export AutoCAD DWG", run: exportProjectDWG },
    { id: "devices:push", group: "Devices", label: "Push fixtures to devices", enabled: fixtures.length > 0, run: pushFixturesToDevices },
  ];

  // State bag for the sidebar sections (./designer/DesignerSidebar.jsx).
  const d = {
    activeBasin, activeBasinIndex, applyFixtureArray, arrayCols, arrayCount, arrayInset, arrayMode, arrayRows, autoPlaceNozzles,
    basinState, basins, bomItems, cadExportBusy, cadUnderlay, cancelDepthZone, cancelDrawing, cancelPipeDrawing, changePoolType,
    chooseProjectFile, clearMeasurements, deleteSelectedSurface, depthDrawPoints, depthZone, depthZoneError, drawStart,
    duplicateSelectedSurface, exportBOMCSV, exportProjectDWG, exportProjectDXF, exportProjectJSON, exportStatus, finishDepthZone,
    finishLandSurface, finishPolyline, fixtureType, fixtures, geometryMeta, hydraulicRunState, hydraulicSummary, isLayerLocked,
    landDrawPoints, landSurfaceType, layers, loadICANSiteDesign, measureStart, measurements, openProjectFile, openSavedProject,
    orthogonalMode, params, pipeDiameter, pipeDrawMode, pipeSystem, pipeType, pipework, polylinePoints, poolMetrics, poolType,
    projectFileInputRef, projectName, pushUndo, runHydraulics, safeDepthZones, safePoolTypes, saveProject, saveStatus, saved,
    savedProjects, savedProjectsLoading, selectedObject, selectedSavedProjectId, selectedSurface, selectedSurfaceId,
    selectedSurfaceMetrics, setArrayCols, setArrayCount, setArrayInset, setArrayMode, setArrayRows, setDepthZone, setDepthZones,
    setFixtureType, setGeometryProperty, setLandSurfaceType, setNumericParam, setOrthogonalMode, setPipeDiameter, setPipeDrawMode,
    setPipeType, setProjectName, setSelectedFixture, setSelectedObject, setSelectedSavedProjectId, setSelectedSurfaceId,
    setSelectedSurfaceVertex, setShowCADImport, setShowLayerPanel, setTool, showDimensions, showLayerPanel, showSavedProjects,
    siteSurfaces, solvedHydraulics, startCustomPoolDrawing, toggleLayerLocked, toggleLayerVisible, toggleSavedProjectBrowser, tool,
    updateCadUnderlay, updateSelectedSurface,
  };

  const drawing = drawStart || polylinePoints.length > 0 || landDrawPoints.length > 0 || pipeSystem.drawing;
  const pipeOverlay = tool === "pipe" ? pipeSystem.snapInfo : hoverSnap;
  const selectionLabel = selection.length > 1 ? `${selection.length} FIXTURES`
    : selectedObject === "fixture" && sf ? sf.label : selectedObject === "surface" && selectedSurface ? selectedSurface.label : selectedObject === "pool" ? "POOL" : "NONE";
  const overlayButton = { background:"none", border:"none", color:"#7ab", cursor:"pointer", fontSize:9, fontFamily:"monospace" };

  return (
    <div style={{ display:"flex", height:"100%", background:"#040810", color:"#cce8ff", fontFamily:"monospace", fontSize:"11px", overflow:"hidden" }}>

      {/* Left toolbar */}
      {showCADImport && <CADImportDialog currentProject={buildProjectPayload()} onApply={applyCADDesign} onClose={() => setShowCADImport(false)} />}
      <div style={{ width:220, flexShrink:0, borderRight:"1px solid #0a2030", display:"flex", flexDirection:"column", overflow:"auto" }}>
        <ProjectHeaderSection d={d} />
        <PoolTypeSection d={d} />
        <DimensionsSection d={d} />
        <ToolsSection d={d} />
        <FixturePickerSection d={d} />
        <PoolPropertiesSection d={d} />
        <SurfacePropertiesSection d={d} />
        {/* Selected fixture properties (AF-CAD-034: shared fields across a multi-selection) */}
        <FixturePropertiesPanel
          fixtures={fixtures} selectedIndices={selectedIndices} params={params} safeDepthZones={safeDepthZones}
          solvedHydraulics={solvedHydraulics} poolMetrics={poolMetrics}
          onUpdateFixtures={updateFixturesBatch}
          onApplyTrust={(next) => { pushUndo("Replace fixture type"); setFixtures(next); }} onHydraulics={setSolvedHydraulics}
          onDelete={deleteSelectedFixture} onSelectSimilar={selectSimilarFixtures} onGroup={groupSelection} onUngroup={ungroupSelection}
          groupCount={selection.reduce((n, key) => n + groupsContaining(groups, key).length, 0)} />
        {activePipeForPanel && (
          <PipePropertiesPanel
            pipe={activePipeForPanel} selectedNode={selectedNode} selectedSegment={selectedSegment}
            onUpdatePipe={updatePipeProperties} onUpdateDiameter={updatePipeDiameter} onUpdateType={updatePipeType}
            onDeletePipe={deleteSelectedPipe} onDeleteSegment={deleteSelectedSegment}
            onInsertNodeAtPoint={insertNodeAtPoint} onRemoveNode={removeNode} />
        )}
        <SiteSurfacesSection d={d} />
        <LayersSection d={d} />
        <ProjectOutputSection d={d} />
      </div>

      {/* Main canvas */}
      <div ref={canvasHostRef} style={{ flex:1, minWidth:0, minHeight:0, position:"relative", overflow:"hidden" }}>
        <div style={{ position: "absolute", top: 10, left: 10, zIndex: 20, display: "flex", gap: 8, alignItems: "center", pointerEvents: "none" }}>
          <div style={{ padding: "5px 8px", borderRadius: 6, background: "rgba(2,8,16,0.88)", border: "1px solid rgba(0,255,204,0.45)", color: "#7fffd4", fontSize: 10, fontFamily: "monospace", fontWeight: 800, boxShadow: "0 0 12px rgba(0,255,204,0.16)" }}>
            TOOL: {tool.toUpperCase()}
          </div>
          <div style={{
            padding: "5px 8px", borderRadius: 6, fontSize: 10, fontFamily: "monospace", fontWeight: 800,
            background: drawing ? "rgba(113,63,18,0.92)" : "rgba(2,8,16,0.88)",
            border: drawing ? "1px solid rgba(245,158,11,0.75)" : "1px solid rgba(148,163,184,0.28)",
            color: drawing ? "#fbbf24" : "#94a3b8",
            boxShadow: drawing ? "0 0 12px rgba(245,158,11,0.22)" : "none",
          }}>
            DRAW: {drawing ? "ACTIVE" : "IDLE"}
          </div>
        </div>
        <canvas
          ref={canvasRef}
          role="application"
          aria-label="Engineering pool plan canvas"
          tabIndex={0}
          onContextMenu={onCanvasContextMenu}
          style={{
            width:"100%", height:"100%", display:"block",
            cursor: isPanning || isDraggingGeometry || isDraggingSurface ? "grabbing" : isSpaceDown ? "grab" : tool==="select" ? "default" : "crosshair",
          }}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={onCanvasMouseUp}
          onWheel={onCanvasWheel}
          onDoubleClick={(e) => {
            const w = snapPoint(toWorld(e.clientX, e.clientY));
            if (tool === "pipe") { onPipeDoubleClick(w); setDynamicInput(emptyDynamicInput()); return; }
            if (tool === "depth") { finishDepthZone(); return; }
            if (tool === "polyline") { finishPolyline(); return; }
            if (tool === "land") { finishLandSurface(); return; }
            if (tool === "select" && selectedObject === "pipe") { insertNodeAtPoint(w); return; }
            fitView();
          }}
        />
        <DynamicInputOverlay input={dynamicInput} screen={cursorScreen} polar={pipeOverlay?.polar} snap={pipeOverlay?.snap} />
        <CommandPalette open={paletteOpen} commands={paletteCommands} onClose={() => setPaletteOpen(false)} />
        {pipeContextMenu && (
          <div style={{ position:"fixed", left:pipeContextMenu.x, top:pipeContextMenu.y, background:"#050d14", border:"1px solid #0a3040", borderRadius:4, padding:4, zIndex:9999, minWidth:150, boxShadow:"0 4px 12px rgba(0,0,0,0.45)" }}>
            <button onClick={() => { insertNodeAtPoint(pipeContextMenu.world); setPipeContextMenu(null); }}
              style={{ width:"100%", padding:"5px", background:"#06121c", color:"#00ccaa", border:"1px solid #00ccaa44", cursor:"pointer", fontSize:9, marginBottom:3 }}>
              ＋ Insert Node
            </button>
            {selectedSegment && (
              <button onClick={() => { deleteSelectedSegment(); setPipeContextMenu(null); }}
                style={{ width:"100%", padding:"5px", background:"#1a0808", color:"#ff8888", border:"1px solid #ff444422", cursor:"pointer", fontSize:9, marginBottom:3 }}>
                ✕ Delete Segment
              </button>
            )}
            <button onClick={() => { deleteSelectedPipe(); setPipeContextMenu(null); }}
              style={{ width:"100%", padding:"5px", background:"#1a0808", color:"#ff4444", border:"1px solid #ff444422", cursor:"pointer", fontSize:9, marginBottom:3 }}>
              ✕ Delete Pipe
            </button>
            <button onClick={() => { setSelectedPipeId(null); setSelectedNode(null); setSelectedSegment(null); setPipeContextMenu(null); }}
              style={{ width:"100%", padding:"5px", background:"#06121c", color:"#7ab", border:"1px solid #0a3040", cursor:"pointer", fontSize:9 }}>
              Clear Selection
            </button>
          </div>
        )}

        {/* Top overlay toolbar */}
        <div style={{ position:"absolute", top:8, left:8, display:"flex", gap:5, background:"rgba(0,0,0,0.7)", border:"1px solid #0a2030", borderRadius:5, padding:"4px 8px", alignItems:"center" }}>
          <button onClick={()=>setZoom(z=>Math.min(100,z*1.2))} style={{ ...overlayButton, fontSize:14, padding:"0 3px" }}>+</button>
          <span style={{ color:"#334455", fontSize:10, minWidth:40, textAlign:"center" }}>{Math.round(zoom)}px/m</span>
          <button onClick={()=>setZoom(z=>Math.max(10,z/1.2))} style={{ ...overlayButton, fontSize:14, padding:"0 3px" }}>−</button>
          <div style={{ width:1, height:14, background:"#0a2030" }}/>
          <button onClick={resetView} style={overlayButton}>⌂ HOME</button>
          <button onClick={fitView} style={overlayButton}>FIT</button>
          <div style={{ width:1, height:14, background:"#0a2030" }}/>
          <button onClick={handleUndo} disabled={!historyApi.canUndo} title={historyApi.state.undoLabel ? `Undo ${historyApi.state.undoLabel}` : "Nothing to undo"} style={{ ...overlayButton, color:historyApi.canUndo?"#00ccaa":"#334455" }}>↶ UNDO</button>
          <button onClick={handleRedo} disabled={!historyApi.canRedo} title={historyApi.state.redoLabel ? `Redo ${historyApi.state.redoLabel}` : "Nothing to redo"} style={{ ...overlayButton, color:historyApi.canRedo?"#00ccaa":"#334455" }}>↷ REDO</button>
          <div style={{ width:1, height:14, background:"#0a2030" }}/>
          <button onClick={pushFixturesToDevices} disabled={!fixtures.length} style={{ ...overlayButton, color: fixtures.length?"#ffcc00":"#334455" }}>⇒ PUSH TO DEVICES</button>
          <div style={{ width:1, height:14, background:"#0a2030" }}/>
          <button onClick={()=>setShowGrid(g=>!g)} style={{ ...overlayButton, color: showGrid?"#00ccaa":"#334455" }}>GRID</button>
          <button onClick={()=>setSnapToGrid(s=>!s)} style={{ background:snapToGrid?"rgba(255,204,0,0.12)":"none", border:`1px solid ${snapToGrid ? "rgba(255,204,0,0.55)" : "transparent"}`, borderRadius:3, padding:"2px 6px", color: snapToGrid?"#ffcc00":"#334455", cursor:"pointer", fontSize:9, fontFamily:"monospace", fontWeight:snapToGrid?800:400 }}>SNAP {snapToGrid ? `${gridStep}m` : "OFF"}</button>
          <select value={gridStep} onChange={e=>setGridStep(parseFloat(e.target.value))} style={{ background:"#06121c", color:"#7ab", border:"1px solid #0a3040", borderRadius:3, fontSize:9, fontFamily:"monospace", height:18 }}>
            <option value={0.1}>0.10m</option>
            <option value={0.25}>0.25m</option>
            <option value={0.5}>0.50m</option>
            <option value={1}>1.00m</option>
          </select>
          <button onClick={()=>setOsnap(v=>!v)} title="Object snap: endpoint, port, intersection, midpoint, center, insertion, perpendicular, nearest (10 px aperture)" style={{ ...overlayButton, color: osnap?"#00ffcc":"#334455" }}>OSNAP</button>
          <button onClick={()=>setShowDepth(v=>!v)} style={{ ...overlayButton, color: showDepth?"#00ccaa":"#334455" }}>DEPTH</button>
          <button onClick={()=>setShowDimensions(v=>!v)} style={{ ...overlayButton, color: showDimensions?"#ffcc00":"#334455" }}>DIM</button>
          <button onClick={()=>setPaletteOpen(true)} title="Command palette (Ctrl+K)" style={overlayButton}>⌘K</button>
        </div>

        {/* Info overlay */}
        <div style={{ position:"absolute", bottom:8, left:8, background:"rgba(0,0,0,0.7)", border:"1px solid #0a2030", borderRadius:4, padding:"4px 8px", fontSize:9, color:"#334455" }}>
          {tool==="select" && "Drag grips to stretch · Drag pool to move · Shift+click adds · drag on empty space (or Ctrl+drag) selects: →window ←crossing · Ctrl+G groups · Del deletes · Ctrl+D duplicates · Ctrl+K commands"}
          {tool==="nozzle" && "Click on pool to place nozzle"}
          {tool==="light"  && "Click on pool to place light fixture"}
          {tool==="rectangle" && !drawStart && "Rectangle: click first corner"}
          {tool==="rectangle" && drawStart && "Rectangle: click opposite corner to finish"}
          {tool==="circle" && !drawStart && "Circle: click center point"}
          {tool==="circle" && drawStart && "Circle: click radius point to finish"}
          {tool==="polyline" && "Polyline: click points · Close Polyline to finish"}
          {tool==="pipe" && "Pipe: click a start point · move to a direction (15° tracking, Shift locks) · type a length + Enter · Enter again finishes"}
          {tool==="land" && "Land: choose a material · click boundary points · double-click to close"}
          {tool==="measure"&& "Click two points to measure distance"}
          {tool==="delete" && "Click a fixture to delete it"}
          {tool==="depth"  && "Click to set depth zone"}
        </div>

        {drawPreview && (drawStart || polylinePoints.length > 0 || landDrawPoints.length > 0) && (
          <div style={{ position:"absolute", top:40, right:8, background:"rgba(0,0,0,0.75)", border:"1px solid #0a3040", borderRadius:4, padding:"6px 8px", fontSize:10, color:"#00ccaa", fontFamily:"monospace" }}>
            {tool==="rectangle" && drawStart && <>
              W {Math.abs(drawPreview.x-drawStart.x).toFixed(3)} m<br/>
              L {Math.abs(drawPreview.y-drawStart.y).toFixed(3)} m
            </>}
            {tool==="circle" && drawStart && <>
              R {Math.hypot(drawPreview.x-drawStart.x, drawPreview.y-drawStart.y).toFixed(3)} m<br/>
              Ø {(Math.hypot(drawPreview.x-drawStart.x, drawPreview.y-drawStart.y)*2).toFixed(3)} m
            </>}
            {tool==="polyline" && <>
              POINTS {polylinePoints.length}<br/>
              X {drawPreview.x.toFixed(3)} · Y {drawPreview.y.toFixed(3)}
            </>}
            {tool==="land" && <>
              {(LAND_SURFACE_TYPES.find((entry) => entry.key === landSurfaceType)?.label || "Land").toUpperCase()} · {landDrawPoints.length} PTS<br/>
              X {drawPreview.x.toFixed(3)} · Y {drawPreview.y.toFixed(3)}
            </>}
          </div>
        )}

        {/* CAD coordinate readout */}
        <div style={{ position:"absolute", bottom:8, right:8, background:"rgba(0,0,0,0.72)", border:"1px solid #0a2030", borderRadius:4, padding:"4px 8px", fontSize:9, color:"#7ab", fontFamily:"monospace" }}>
          TOOL {tool.toUpperCase()}&nbsp;&nbsp; X {cursorWorld.x.toFixed(3)} m&nbsp;&nbsp; Y {cursorWorld.y.toFixed(3)} m&nbsp;&nbsp; ZOOM {Math.round(zoom)} px/m&nbsp;&nbsp; SNAP {snapToGrid ? gridStep + "m" : "OFF"}&nbsp;&nbsp; OSNAP {osnap ? "ON" : "OFF"}{pipeOverlay?.snap?.mode ? ` (${pipeOverlay.snap.label})` : ""}&nbsp;&nbsp; DRAW {drawing ? "ACTIVE" : "IDLE"}&nbsp;&nbsp; LAYERS {layers.filter(l=>l.visible).length}/{layers.length}&nbsp;&nbsp; SELECTED {selectionLabel}
        </div>
      </div>
    </div>
  );
}
