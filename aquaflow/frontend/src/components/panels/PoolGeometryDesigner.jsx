/**
 * PoolGeometryDesigner.jsx — AquaFlow Phase 9
 * Interactive pool geometry designer:
 * - Draw any pool shape (circular, rectangular, freeform, multi-basin)
 * - Set dimensions, depth zones, walls
 * - Place nozzles and lights on the actual geometry
 * - False lake / false river mode
 * - Export geometry as JSON for hydraulic solver
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { generatePipework } from "../../engineering/pipeworkEngine";
import { calculateHydraulics } from "../../engineering/hydraulicEngine";
import { generateBOM } from "../../engineering/bomEngine";
import { useEngineeringPublisher } from "../../hooks/engineeringPublisher";
import useEngineeringStore from "../../store/engineeringStore";
import { useShowStore } from "../../store/showStore";
import { usePipeDrawing, PIPE_COLORS } from "../../engineering/usePipeDrawing";
import { getSymbolForType, drawSymbol } from "../../engineering/fixtureSymbols";
import PipePropertiesPanel from "./PipePropertiesPanel";
import { API_BASE_URL } from "../../config";
import {
  FIXTURE_LIBRARY,
  getDefaultEngineering
} from "../../data/fixtureLibrary";

const API = API_BASE_URL;

const POOL_TYPES = [
  { key:"rectangular", label:"Rectangular",  icon:"▭" },
  { key:"circular",    label:"Circular",     icon:"○" },
  { key:"elliptical",  label:"Elliptical",   icon:"⬭" },
  { key:"lshape",      label:"L-Shape",      icon:"⌐" },
  { key:"freeform",    label:"Freeform",     icon:"~" },
  { key:"false_lake",  label:"False Lake",   icon:"≈" },
  { key:"false_river", label:"False River",  icon:"~≈" },
];

const DEPTH_ZONES = [
  { key:"shallow",  label:"Shallow",  depth:0.3, color:"#7ec8e3" },
  { key:"medium",   label:"Medium",   depth:0.8, color:"#0077b6" },
  { key:"deep",     label:"Deep",     depth:1.5, color:"#03045e" },
  { key:"display",  label:"Display",  depth:0.2, color:"#90e0ef" },
];


// ========== END ENGINEERING SYMBOL RENDERER SYSTEM ==========

const FIXTURE_TYPES = Array.isArray(FIXTURE_LIBRARY)
  ? FIXTURE_LIBRARY.map(f => ({
      key: f.key,
      label: f.label,
      color: f.color,
      icon: f.icon
    }))
  : [
      { key: "nozzle_geyser", label: "Geyser Nozzle", color: "#00ccaa", icon: "⬆" },
      { key: "nozzle_foam", label: "Foam Nozzle", color: "#88aaff", icon: "❄" },
      { key: "nozzle_running", label: "Running Nozzle", color: "#00ccaa", icon: "⟷" },
      { key: "light_rgb", label: "RGB Light", color: "#ff44aa", icon: "★" },
      { key: "pump", label: "Pump", color: "#22c55e", icon: "⚙" },
      { key: "valve", label: "Valve", color: "#ffaa44", icon: "◊" },
      { key: "motion_1d", label: "1D Motion", color: "#ffcc00", icon: "─" },
      { key: "motion_2d", label: "2D Motion", color: "#ffcc00", icon: "☖" },
      { key: "motion_3d", label: "3D Motion", color: "#ffcc00", icon: "⬚" },
    ];

// ========== ENGINEERING SYMBOL RENDERER SYSTEM ==========
const ENGINEERING_SYMBOLS_MAP = {
  "nozzle_geyser":   { type: "geyser",   shape: "circle",  icon: "⬆", color: "#00ccaa", size: 0.35 },
  "nozzle_foam":     { type: "foam",     shape: "circle",  icon: "❄", color: "#88aaff", size: 0.35 },
  "nozzle_laminar":  { type: "laminar",  shape: "circle",  icon: "⤨", color: "#44ddff", size: 0.35 },
  "nozzle_running":  { type: "running",  shape: "rect",    icon: "⟷", color: "#00ccaa", size: 0.35 },
  "nozzle_fan":      { type: "fan",      shape: "wedge",   icon: "◥", color: "#00ccaa", size: 0.35 },
  "nozzle_arch":     { type: "arch",     shape: "arc",     icon: "∩", color: "#00ccaa", size: 0.35 },
  "nozzle_mist":     { type: "mist",     shape: "circle",  icon: "⌣", color: "#88ccff", size: 0.35 },
  "nozzle_flame":    { type: "flame",    shape: "circle",  icon: "🔥", color: "#ff8844", size: 0.35 },
  "light_rgb":       { type: "rgb",      shape: "circle",  icon: "★", color: "#ff44aa", size: 0.30 },
  "light_underwater":{ type: "under",    shape: "circle",  icon: "💧", color: "#44aaff", size: 0.30 },
  "laser":           { type: "laser",    shape: "diamond", icon: "⚡", color: "#ff2266", size: 0.30 },
  "pump":            { type: "pump",     shape: "circle",  icon: "⚙", color: "#22c55e", size: 0.40 },
  "vfd":             { type: "vfd",      shape: "rect",    icon: "▯", color: "#44aaff", size: 0.35 },
  "valve":           { type: "valve",    shape: "diamond", icon: "◊", color: "#ffaa44", size: 0.30 },
  "solenoid":        { type: "solenoid", shape: "rect",    icon: "⎍", color: "#ff8844", size: 0.30 },
  "drain":           { type: "drain",    shape: "circle",  icon: "⨀", color: "#44aaff", size: 0.30 },
  "sensor":          { type: "sensor",   shape: "circle",  icon: "◉", color: "#88ff88", size: 0.25 },
  "filter":          { type: "filter",   shape: "rect",    icon: "≡", color: "#55ccff", size: 0.35 },
  "uv":              { type: "uv",       shape: "rect",    icon: "☀", color: "#aaffdd", size: 0.30 },
  "dosing":          { type: "dosing",   shape: "circle",  icon: "∅", color: "#ffaa88", size: 0.30 },
  "motion_1d":       { type: "motion1d", shape: "line",    icon: "─", color: "#ffcc00", size: 0.35 },
  "motion_2d":       { type: "motion2d", shape: "square",  icon: "☖", color: "#ffcc00", size: 0.35 },
  "motion_3d":       { type: "motion3d", shape: "cube",    icon: "⬚", color: "#ffcc00", size: 0.35 },
};

const getEngineeringSymbol = (typeKey) => {
  if (!typeKey) return ENGINEERING_SYMBOLS_MAP["nozzle_geyser"];
  if (ENGINEERING_SYMBOLS_MAP[typeKey]) return ENGINEERING_SYMBOLS_MAP[typeKey];
  if (typeKey.includes("geyser")) return ENGINEERING_SYMBOLS_MAP["nozzle_geyser"];
  if (typeKey.includes("foam")) return ENGINEERING_SYMBOLS_MAP["nozzle_foam"];
  if (typeKey.includes("laminar")) return ENGINEERING_SYMBOLS_MAP["nozzle_laminar"];
  if (typeKey.includes("running")) return ENGINEERING_SYMBOLS_MAP["nozzle_running"];
  if (typeKey.includes("fan")) return ENGINEERING_SYMBOLS_MAP["nozzle_fan"];
  if (typeKey.includes("arch")) return ENGINEERING_SYMBOLS_MAP["nozzle_arch"];
  if (typeKey.includes("mist")) return ENGINEERING_SYMBOLS_MAP["nozzle_mist"];
  if (typeKey.includes("flame")) return ENGINEERING_SYMBOLS_MAP["nozzle_flame"];
  if (typeKey.includes("rgb")) return ENGINEERING_SYMBOLS_MAP["light_rgb"];
  if (typeKey.includes("underwater")) return ENGINEERING_SYMBOLS_MAP["light_underwater"];
  if (typeKey.includes("laser")) return ENGINEERING_SYMBOLS_MAP["laser"];
  if (typeKey.includes("pump")) return ENGINEERING_SYMBOLS_MAP["pump"];
  if (typeKey.includes("vfd")) return ENGINEERING_SYMBOLS_MAP["vfd"];
  if (typeKey.includes("valve")) return ENGINEERING_SYMBOLS_MAP["valve"];
  if (typeKey.includes("solenoid")) return ENGINEERING_SYMBOLS_MAP["solenoid"];
  if (typeKey.includes("drain")) return ENGINEERING_SYMBOLS_MAP["drain"];
  if (typeKey.includes("sensor")) return ENGINEERING_SYMBOLS_MAP["sensor"];
  if (typeKey.includes("filter")) return ENGINEERING_SYMBOLS_MAP["filter"];
  if (typeKey.includes("uv")) return ENGINEERING_SYMBOLS_MAP["uv"];
  if (typeKey.includes("dosing")) return ENGINEERING_SYMBOLS_MAP["dosing"];
  if (typeKey.includes("1d")) return ENGINEERING_SYMBOLS_MAP["motion_1d"];
  if (typeKey.includes("2d")) return ENGINEERING_SYMBOLS_MAP["motion_2d"];
  if (typeKey.includes("3d")) return ENGINEERING_SYMBOLS_MAP["motion_3d"];
  return ENGINEERING_SYMBOLS_MAP["nozzle_geyser"];
};

const drawEngSymbol = (ctx, cx, cy, rotationDeg, scale, isSelected, symbol) => {
  const baseSize = 12;
  const size = baseSize * scale;
  const rotRad = (rotationDeg || 0) * Math.PI / 180;
  
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotRad);
  
  if (isSelected) {
    ctx.shadowBlur = 8;
    ctx.shadowColor = symbol.color;
  }
  
  ctx.beginPath();
  
  switch (symbol.shape) {
    case "circle":
      ctx.arc(0, 0, size/2, 0, Math.PI * 2);
      break;
    case "rect":
      ctx.rect(-size/2, -size/2, size, size);
      break;
    case "diamond":
      ctx.moveTo(0, -size/2);
      ctx.lineTo(size/2, 0);
      ctx.lineTo(0, size/2);
      ctx.lineTo(-size/2, 0);
      ctx.closePath();
      break;
    case "wedge":
      ctx.moveTo(0, -size/2);
      ctx.lineTo(size/2, size/2);
      ctx.lineTo(-size/2, size/2);
      ctx.closePath();
      break;
    case "arc":
      ctx.arc(0, 0, size/2.5, 0.2, Math.PI - 0.2);
      break;
    case "line":
      ctx.moveTo(-size/2, 0);
      ctx.lineTo(size/2, 0);
      break;
    case "square":
      ctx.rect(-size/2.5, -size/2.5, size/1.25, size/1.25);
      break;
    case "cube":
      ctx.rect(-size/2.5, -size/2.5, size/1.25, size/1.25);
      break;
    default:
      ctx.arc(0, 0, size/2, 0, Math.PI * 2);
  }
  
  ctx.fillStyle = `${symbol.color}33`;
  ctx.fill();
  ctx.strokeStyle = symbol.color;
  ctx.lineWidth = 2;
  ctx.stroke();
  
  ctx.shadowBlur = 0;
  
  ctx.font = `${Math.max(10, size * 1.2)}px monospace`;
  ctx.fillStyle = symbol.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(symbol.icon, 0, 0);
  
  ctx.restore();
};
// ========== END ENGINEERING SYMBOL RENDERER SYSTEM ==========

const MOTION_TYPES = [
  { key: "motion_1d", label: "1D Motion", color: "#ffcc00", icon: "─" },
  { key: "motion_2d", label: "2D Motion", color: "#ffcc00", icon: "☖" },
  { key: "motion_3d", label: "3D Motion", color: "#ffcc00", icon: "⬚" },
];
const getToolFixtureTypes = (tool) => {
  if (tool === "nozzle") {
    return FIXTURE_TYPES.filter(f => f.key.startsWith("nozzle"));
  }

  if (tool === "light") {
    return FIXTURE_TYPES.filter(f =>
      f.key.startsWith("light") || f.key.startsWith("laser")
    );
  }

  if (tool === "equipment") {
    return FIXTURE_TYPES.filter(f =>
      !f.key.startsWith("nozzle") &&
      !f.key.startsWith("light") &&
      !f.key.startsWith("laser")
    );
  }

  return FIXTURE_TYPES;
};

const getDefaultGroupId = (type) => {
  const t = String(type || "").toLowerCase();

  if (t.includes("ring") || t.includes("running")) return "outer_ring_jets";
  if (t.includes("arch") || t.includes("2d")) return "arch_jets";
  if (t.includes("1d") || t.includes("3d") || t.includes("geyser") || t.includes("jet")) return "center_jets";
  if (t.includes("light") || t.includes("rgb")) return "rgb_lights";
  if (t.includes("fire") || t.includes("flame")) return "flame_units";
  if (t.includes("air") || t.includes("burst") || t.includes("fog") || t.includes("mist")) return "fog_machines";
  if (t.includes("laser")) return "laser_units";

  return "engineering_equipment";
};

// Engineering defaults now come from frontend/src/data/fixtureLibrary.js

const TOOLS = [
  { key:"select", label:"Select", icon:"↖" },
  { key:"rectangle", label:"Rectangle", icon:"▭" },
  { key:"circle", label:"Circle", icon:"○" },
  { key:"polyline", label:"Polyline", icon:"⌁" },
{ key:"pipe", label:"Pipe", icon:"═" },
  { key:"nozzle", label:"Nozzle", icon:"⬆" },
  { key:"light", label:"Light", icon:"★" },
{ key:"equipment", label:"Equipment", icon:"⚙" },
  { key:"depth", label:"Depth", icon:"▦" },
  { key:"measure", label:"Measure", icon:"↔" },
  { key:"delete", label:"Delete", icon:"✕" },
];

const DEFAULT_LAYERS = [
  { key:"pool_outline", label:"POOL OUTLINE", color:"#00aaff", visible:true, locked:false },
  { key:"water_surface", label:"WATER SURFACE", color:"#0077b6", visible:true, locked:false },
  { key:"nozzles", label:"NOZZLES", color:"#00ffcc", visible:true, locked:false },
  { key:"lights", label:"LIGHTS", color:"#ffcc00", visible:true, locked:false },
{ key:"equipment", label:"EQUIPMENT", color:"#22c55e", visible:true, locked:false },
  { key:"measurements", label:"MEASUREMENTS", color:"#ffcc00", visible:true, locked:false },
  { key:"annotations", label:"ANNOTATIONS", color:"#ffcc00", visible:true, locked:false },
  { key:"pipework", label:"PIPEWORK", color:"#8b5cf6", visible:true, locked:false },
];


// Engineering defaults now come from frontend/src/data/fixtureLibrary.js

function generatePoolShape(type, params) {
  const { width=10, length=10, radius=5, depth=0.8 } = params;

  switch(type) {
    case "rectangular":
      return {
        points:[
          {x:0,y:0},
          {x:width,y:0},
          {x:width,y:length},
          {x:0,y:length}
        ],
        closed:true
      };

    case "circular":
      return {
        center:{x:0,y:0},
        radius,
        type:"circle"
      };

    case "elliptical":
      return {
        center:{x:0,y:0},
        rx:width/2,
        ry:length/2,
        type:"ellipse"
      };

    case "lshape": {
      const w=width, l=length, w2=width*0.5, l2=length*0.5;
      return {
        points:[
          {x:0,y:0},
          {x:w,y:0},
          {x:w,y:l2},
          {x:w2,y:l2},
          {x:w2,y:l},
          {x:0,y:l}
        ],
        closed:true
      };
    }

    case "false_lake": {
      const pts = [];
      const steps = 20;
      for(let i=0;i<steps;i++){
        const t = (i/steps)*Math.PI*2;
        const jitter = 0.8 + Math.sin(t*3.7)*0.15 + Math.cos(t*2.1)*0.1;
        pts.push({
          x: Math.cos(t)*radius*jitter*1.5,
          y: Math.sin(t)*radius*jitter
        });
      }
      return { points:pts, closed:true };
    }

    case "false_river": {
      const pts = [];
      const riverLen = length*2;
      const steps = 30;
      for(let i=0;i<=steps;i++){
        const t = i/steps;
        const sinuous = Math.sin(t*Math.PI*3)*width*0.3;
        pts.push({ x:sinuous, y:t*riverLen });
      }
      for(let i=steps;i>=0;i--){
        const t = i/steps;
        const sinuous = Math.sin(t*Math.PI*3)*width*0.3;
        pts.push({ x:sinuous+width*0.4, y:t*riverLen });
      }
      return { points:pts, closed:true };
    }

    default:
      return {
        points:[
          {x:0,y:0},
          {x:width,y:0},
          {x:width,y:length},
          {x:0,y:length}
        ],
        closed:true
      };
  }
}

export default function PoolGeometryDesigner() {
  const canvasRef = useRef(null);
  const [tool, setTool] = useState("select");
  const [poolType, setPoolType] = useState(() => useEngineeringStore.getState().poolType || "rectangular");
  const [params, setParams] = useState(() => useEngineeringStore.getState().params || { width:12, length:8, radius:6, depth:0.8 });
  const [fixtures, setFixtures] = useState(() => useEngineeringStore.getState().fixtures || []);
const hydraulicSummary = useMemo(() => calculateHydraulics(fixtures), [fixtures]);

const [geometry, setGeometry] = useState(() => useEngineeringStore.getState().geometry || null);

const pipework = useMemo(() => generatePipework(fixtures, geometry), [fixtures, geometry]);

const baseBomItems = useMemo(() => generateBOM(fixtures), [fixtures]);

  const [selectedFixture, setSelectedFixture] = useState(null);
  const [selectedObject, setSelectedObject] = useState(null);
  const [fixtureType, setFixtureType] = useState("nozzle_geyser");
  const [depthZone, setDepthZone] = useState("medium");
  const [zoom, setZoom] = useState(30); // pixels per meter
  const [pan, setPan] = useState({ x:60, y:60 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({x:0,y:0});
  const [freeformPoints, setFreeformPoints] = useState([]);
  const [drawingFreeform, setDrawingFreeform] = useState(false);
  const [measurements, setMeasurements] = useState(() => useEngineeringStore.getState().measurements || []);
  const [measureStart, setMeasureStart] = useState(null);
const bomItems = [
  ...baseBomItems,
  ...(pipework?.bom || []),
];
  const [showGrid, setShowGrid] = useState(true);
  const [showDepth, setShowDepth] = useState(true);
  const [projectName, setProjectName] = useState("New Pool Project");
  const [saved, setSaved] = useState(false);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [cursorWorld, setCursorWorld] = useState({ x:0, y:0 });
  const [isDraggingGeometry, setIsDraggingGeometry] = useState(false);
  const [lastDragWorld, setLastDragWorld] = useState(null);
  const [drawStart, setDrawStart] = useState(null);
  const [drawPreview, setDrawPreview] = useState(null);
  const [polylinePoints, setPolylinePoints] = useState([]);
  const [activeGrip, setActiveGrip] = useState(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridStep, setGridStep] = useState(0.5);
  const [showDimensions, setShowDimensions] = useState(true);
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [showLayerPanel, setShowLayerPanel] = useState(true);
  const [arrayMode, setArrayMode] = useState("centerline");
  const [arrayCount, setArrayCount] = useState(8);
  const [arrayRows, setArrayRows] = useState(3);
  const [arrayCols, setArrayCols] = useState(5);
  const [arrayInset, setArrayInset] = useState(1.0);
  const [exportStatus, setExportStatus] = useState("");
const [pipeContextMenu, setPipeContextMenu] = useState(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);

  const pushFixturesToDevices = useCallback(() => {
    const { devices, addTimelineTrack, timelineTracks } = useShowStore.getState();
    if (!fixtures.length) return;

    const mapped = [];
    const typesSeen = new Set();

    fixtures.forEach(f => {
      const eng = f.engineering || {};
      let deviceType = null;
      let matchDevice = null;

      if (f.type?.startsWith("nozzle") || f.type?.includes("geyser") || f.type?.includes("jet") || f.type?.includes("foam")) {
        deviceType = "pump";
      } else if (f.type?.startsWith("light")) {
        deviceType = "lighting";
      } else if (f.type?.includes("flame") || f.type?.includes("fire")) {
        deviceType = "flame";
      } else if (f.type?.includes("fog")) {
        deviceType = "fog";
      } else if (f.type?.includes("laser")) {
        deviceType = "laser";
      }

      if (!deviceType) return;
      if (typesSeen.has(deviceType)) return;
      typesSeen.add(deviceType);

      matchDevice = devices.find(d =>
        d.type === deviceType && d.status !== "offline"
      ) || devices.find(d => d.type === deviceType);

      if (matchDevice) {
        mapped.push({ deviceType, device: matchDevice });
      }
    });

    if (!mapped.length) {
      alert("No matching devices found. Make sure devices are discovered first.");
      return;
    }

    mapped.forEach(({ deviceType, device }) => {
      const exists = timelineTracks.find(t => t.deviceId === device.id);
      if (!exists) {
        useShowStore.getState().addTimelineTrack(deviceType);
        const newTrack = useShowStore.getState().timelineTracks.at(-1);
        if (newTrack) {
          useShowStore.setState(s => {
            const t = s.timelineTracks.find(tr => tr.id === newTrack.id);
            if (t) {
              t.deviceId = device.id;
              t.label = device.label;
            }
          });
        }
      }
    });

    alert(`✓ Mapped ${mapped.length} fixture type(s) to timeline tracks:\n${mapped.map(m => `• ${m.device.label}`).join("\n")}`);
  }, [fixtures]);

  const takeSnapshot = useCallback(() => ({
    fixtures: JSON.parse(JSON.stringify(fixtures)),
    geometry: JSON.parse(JSON.stringify(geometry || {})),
    params: JSON.parse(JSON.stringify(params)),
    poolType,
  }), [fixtures, geometry, params, poolType]);

  const pushUndo = useCallback(() => {
    undoStackRef.current.push(takeSnapshot());
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, [takeSnapshot]);

  const handleUndo = useCallback(() => {
    if (!undoStackRef.current.length) return;
    redoStackRef.current.push(takeSnapshot());
    const prev = undoStackRef.current.pop();
    setFixtures(prev.fixtures);
    setGeometry(prev.geometry?.type || prev.geometry?.points ? prev.geometry : null);
    setParams(prev.params);
    setPoolType(prev.poolType);
  }, [takeSnapshot]);

  const handleRedo = useCallback(() => {
    if (!redoStackRef.current.length) return;
    undoStackRef.current.push(takeSnapshot());
    const next = redoStackRef.current.pop();
    setFixtures(next.fixtures);
    setGeometry(next.geometry?.type || next.geometry?.points ? next.geometry : null);
    setParams(next.params);
    setPoolType(next.poolType);
  }, [takeSnapshot]);

  const pipeSystem = usePipeDrawing({ zoom, pan, snapToGrid, gridStep, fixtures });
  const {
  pipes: manualPipes,
  pipeDiameter, setPipeDiameter,
  pipeType, setPipeType,
  pipeDrawMode, setPipeDrawMode,
  orthogonalMode, setOrthogonalMode,
  selectedPipeId,
  selectedNode,
  selectedSegment,
setSelectedPipeId,
setSelectedNode,
setSelectedSegment,
  onPipeMouseMove,
  onPipeClick,
  onPipeDoubleClick,
  cancelDrawing: cancelPipeDrawing,
  selectPipeAtPoint,
  selectNodeAtPoint,
  moveNode,
  deleteSelectedPipe,
  deleteSelectedSegment,
  updatePipeDiameter,
  updatePipeType,
  updatePipeProperties,
  insertNode,
  insertNodeAtPoint,
  removeNode,
  renderPipes,
  getManualPipeBOM
} = pipeSystem;

const selectedPipe = manualPipes.find(p => p.id === selectedPipeId) || null;
const activePipeForPanel =
  selectedPipe ||
  manualPipes.find(p => p.id === selectedSegment?.pipeId) ||
  null;

  // Generate geometry when type/params change

  // â”€â”€ Engineering â†” 3D Bridge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   // Publish to engineering store — SINGLE sync path.
  // useEngineeringPublisher → engineeringStore → useEngineeringSync → 3D scene
  useEngineeringPublisher({
  projectName,
  geometry,
  poolType,
  params,
  fixtures,
  manualPipes,
  layers,
  measurements,
  hydraulicSummary,
  bomItems,
});
    useEffect(() => {
  if (poolType === "freeform") return;

  setGeometry(prev => {
    // If geometry already exists, keep its current world position.
    // This prevents the pool from jumping back to 0,0 while fixtures stay behind.
    if (prev?.points?.length) return prev;
    if (prev?.center) return prev;

    return generatePoolShape(poolType, params);
  });
}, [poolType]);

  // Draw canvas

  // â”€â”€ Engineering â†” 3D Bridge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  
    useEffect(() => {
    const canvas = canvasRef.current;
    if(!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);

    // Background
    ctx.fillStyle = "#020810";
    ctx.fillRect(0,0,W,H);

    // Grid
    if(showGrid) {
      ctx.strokeStyle = "#0a2030";
      ctx.lineWidth = 0.5;
      const gridSpacing = zoom; // 1m grid
      for(let x = (pan.x % gridSpacing); x < W; x += gridSpacing) {
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
      }
      for(let y = (pan.y % gridSpacing); y < H; y += gridSpacing) {
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
      }
      // 5m major grid
      ctx.strokeStyle = "#0a3040";
      ctx.lineWidth = 1;
      const major = zoom * 5;
      for(let x = (pan.x % major); x < W; x += major) {
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
      }
      for(let y = (pan.y % major); y < H; y += major) {
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
      }
      // Scale label
      ctx.fillStyle = "#334455";
      ctx.font = "10px monospace";
      ctx.fillText(`1m`, pan.x + 4, H - 8);
      ctx.strokeStyle = "#334455";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pan.x, H-14); ctx.lineTo(pan.x + zoom, H-14); ctx.stroke();
    }

    // World to canvas
    const wx = (x) => pan.x + x * zoom;
    const wy = (y) => pan.y + y * zoom;

    // Draw pool geometry
    if(geometry && (isLayerVisible("pool_outline") || isLayerVisible("water_surface"))) {
      if(geometry.type === "circle") {
        // Depth fill
        if(showDepth) {
          const grad = ctx.createRadialGradient(wx(geometry.center.x), wy(geometry.center.y), 0, wx(geometry.center.x), wy(geometry.center.y), geometry.radius*zoom);
          grad.addColorStop(0, "rgba(3,4,94,0.7)");
          grad.addColorStop(0.6, "rgba(0,119,182,0.5)");
          grad.addColorStop(1, "rgba(126,200,227,0.4)");
          ctx.fillStyle = isLayerVisible("water_surface") ? grad : "rgba(0,0,0,0)";
        } else {
          ctx.fillStyle = isLayerVisible("water_surface") ? "rgba(0,100,160,0.4)" : "rgba(0,0,0,0)";
        }
        ctx.beginPath();
        ctx.arc(wx(geometry.center.x), wy(geometry.center.y), geometry.radius*zoom, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = isLayerVisible("pool_outline") ? "#00aaff" : "rgba(0,0,0,0)";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if(geometry.type === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(wx(geometry.center.x), wy(geometry.center.y), geometry.rx*zoom, geometry.ry*zoom, 0, 0, Math.PI*2);
        ctx.fillStyle = isLayerVisible("water_surface") ? "rgba(0,100,160,0.4)" : "rgba(0,0,0,0)";
        ctx.fill();
        ctx.strokeStyle = isLayerVisible("pool_outline") ? "#00aaff" : "rgba(0,0,0,0)";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if(geometry.points) {
        ctx.beginPath();
        ctx.moveTo(wx(geometry.points[0].x), wy(geometry.points[0].y));
        geometry.points.forEach(p => ctx.lineTo(wx(p.x), wy(p.y)));
        if(geometry.closed) ctx.closePath();
        if(showDepth) {
          const minX = Math.min(...geometry.points.map(p=>p.x));
          const minY = Math.min(...geometry.points.map(p=>p.y));
          const maxX = Math.max(...geometry.points.map(p=>p.x));
          const maxY = Math.max(...geometry.points.map(p=>p.y));
          const cx = (minX+maxX)/2, cy = (minY+maxY)/2;
          const grad = ctx.createRadialGradient(wx(cx),wy(cy),0,wx(cx),wy(cy),(maxX-minX)*zoom*0.7);
          grad.addColorStop(0,"rgba(3,4,94,0.7)");
          grad.addColorStop(0.5,"rgba(0,119,182,0.5)");
          grad.addColorStop(1,"rgba(126,200,227,0.4)");
          ctx.fillStyle = isLayerVisible("water_surface") ? grad : "rgba(0,0,0,0)";
        } else {
          ctx.fillStyle = isLayerVisible("water_surface") ? "rgba(0,100,160,0.4)" : "rgba(0,0,0,0)";
        }
        ctx.fill();
        ctx.strokeStyle = isLayerVisible("pool_outline") ? "#00aaff" : "rgba(0,0,0,0)";
        ctx.lineWidth = 2;
        ctx.stroke();

// Pipework rendering
if (isLayerVisible("pipework") && pipework?.branches?.length > 0) {
  ctx.save();

  // Main header
  if (pipework.mainHeaderLengthM > 0) {
    const xs = fixtures.map(f => Number(f.x || 0));
    const ys = fixtures.map(f => Number(f.y || 0));

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const avgY = ys.reduce((a,b) => a + b, 0) / ys.length;

    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(wx(minX), wy(avgY));
    ctx.lineTo(wx(maxX), wy(avgY));
    ctx.stroke();
  }

  // Branch pipes
  ctx.strokeStyle = "#a78bfa";
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);

 pipework.branches.forEach(b => {
    if (b?.from?.x === undefined || b?.to?.x === undefined) return;
    if (!b.from || !b.to) return;
    ctx.beginPath();
    ctx.moveTo(wx(b.from.x), wy(b.from.y));
    ctx.lineTo(wx(b.to.x), wy(b.to.y));
    ctx.stroke();
  });

  ctx.restore();
}
if (isLayerVisible("pipework")) { renderPipes(ctx, wx, wy, zoom); }

        // Selection outline
        if(selectedObject === "pool") {
          ctx.save();
          ctx.strokeStyle = "#ffcc00";
          ctx.lineWidth = 1;
          ctx.setLineDash([6,4]);
          ctx.stroke();
          ctx.restore();
        }

        // Vertex handles
        if(tool === "select" || tool === "rectangle" || tool === "polyline") {
          geometry.points.forEach((p,i) => {
            const sx = wx(p.x), sy = wy(p.y);
            ctx.fillStyle = activeGrip?.index === i ? "#ffcc00" : "#00aaff";
            ctx.strokeStyle = "#001520";
            ctx.lineWidth = 1;
            ctx.fillRect(sx-5, sy-5, 10, 10);
            ctx.strokeRect(sx-5, sy-5, 10, 10);
          });
        }
      }

      // CAD-style dimension annotations
      if(showDimensions && isLayerVisible("annotations")) {
        ctx.save();
        ctx.strokeStyle = "#ffcc00";
        ctx.fillStyle = "#ffcc00";
        ctx.lineWidth = 1;
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const arrow = (x, y, dir) => {
          ctx.beginPath();
          if(dir === "left") {
            ctx.moveTo(x, y); ctx.lineTo(x+6, y-3); ctx.moveTo(x, y); ctx.lineTo(x+6, y+3);
          } else if(dir === "right") {
            ctx.moveTo(x, y); ctx.lineTo(x-6, y-3); ctx.moveTo(x, y); ctx.lineTo(x-6, y+3);
          } else if(dir === "up") {
            ctx.moveTo(x, y); ctx.lineTo(x-3, y+6); ctx.moveTo(x, y); ctx.lineTo(x+3, y+6);
          } else if(dir === "down") {
            ctx.moveTo(x, y); ctx.lineTo(x-3, y-6); ctx.moveTo(x, y); ctx.lineTo(x+3, y-6);
          }
          ctx.stroke();
        };

        if(geometry.points && geometry.points.length >= 4) {
          const xs = geometry.points.map(p=>p.x);
          const ys = geometry.points.map(p=>p.y);
          const minX = Math.min(...xs), maxX = Math.max(...xs);
          const minY = Math.min(...ys), maxY = Math.max(...ys);
          const width = maxX - minX;
          const length = maxY - minY;

          const topY = wy(minY) - 26;
          const leftX = wx(minX) - 28;
          const rightX = wx(maxX) + 28;
          const bottomY = wy(maxY) + 26;

          // Width dimension line
          ctx.beginPath();
          ctx.moveTo(wx(minX), topY);
          ctx.lineTo(wx(maxX), topY);
          ctx.stroke();
          arrow(wx(minX), topY, "right");
          arrow(wx(maxX), topY, "left");
          ctx.fillText(`${width.toFixed(3)} m`, wx((minX+maxX)/2), topY - 10);

          // Width extension lines
          ctx.beginPath();
          ctx.moveTo(wx(minX), wy(minY)); ctx.lineTo(wx(minX), topY+6);
          ctx.moveTo(wx(maxX), wy(minY)); ctx.lineTo(wx(maxX), topY+6);
          ctx.stroke();

          // Length dimension line
          ctx.beginPath();
          ctx.moveTo(rightX, wy(minY));
          ctx.lineTo(rightX, wy(maxY));
          ctx.stroke();
          arrow(rightX, wy(minY), "down");
          arrow(rightX, wy(maxY), "up");
          ctx.save();
          ctx.translate(rightX + 12, wy((minY+maxY)/2));
          ctx.rotate(-Math.PI/2);
          ctx.fillText(`${length.toFixed(3)} m`, 0, 0);
          ctx.restore();

          // Length extension lines
          ctx.beginPath();
          ctx.moveTo(wx(maxX), wy(minY)); ctx.lineTo(rightX-6, wy(minY));
          ctx.moveTo(wx(maxX), wy(maxY)); ctx.lineTo(rightX-6, wy(maxY));
          ctx.stroke();

          // Area/depth label inside
          ctx.fillStyle = "rgba(255,204,0,0.85)";
          ctx.font = "10px monospace";
          ctx.fillText(`A=${(width*length).toFixed(3)} m²`, wx((minX+maxX)/2), wy((minY+maxY)/2)-8);
          ctx.fillText(`D=${Number(params.depth || 0).toFixed(3)} m`, wx((minX+maxX)/2), wy((minY+maxY)/2)+8);
        }

        if(geometry.type === "circle") {
          const cx = wx(geometry.center.x);
          const cy = wy(geometry.center.y);
          const r = geometry.radius * zoom;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + r, cy);
          ctx.stroke();
          arrow(cx + r, cy, "left");
          ctx.fillText(`R ${geometry.radius.toFixed(3)} m`, cx + r/2, cy - 12);
          ctx.fillText(`Ø ${(geometry.radius*2).toFixed(3)} m`, cx, cy + r + 16);
        }

        if(geometry.type === "ellipse") {
          const cx = wx(geometry.center.x);
          const cy = wy(geometry.center.y);
          ctx.beginPath();
          ctx.moveTo(cx - geometry.rx*zoom, cy - geometry.ry*zoom - 24);
          ctx.lineTo(cx + geometry.rx*zoom, cy - geometry.ry*zoom - 24);
          ctx.stroke();
          arrow(cx - geometry.rx*zoom, cy - geometry.ry*zoom - 24, "right");
          arrow(cx + geometry.rx*zoom, cy - geometry.ry*zoom - 24, "left");
          ctx.fillText(`${(geometry.rx*2).toFixed(3)} m`, cx, cy - geometry.ry*zoom - 36);

          ctx.beginPath();
          ctx.moveTo(cx + geometry.rx*zoom + 24, cy - geometry.ry*zoom);
          ctx.lineTo(cx + geometry.rx*zoom + 24, cy + geometry.ry*zoom);
          ctx.stroke();
          arrow(cx + geometry.rx*zoom + 24, cy - geometry.ry*zoom, "down");
          arrow(cx + geometry.rx*zoom + 24, cy + geometry.ry*zoom, "up");
        }

        ctx.restore();
      }
    }

    // Freeform drawing preview
    if(freeformPoints.length > 0) {
      ctx.beginPath();
      ctx.moveTo(wx(freeformPoints[0].x), wy(freeformPoints[0].y));
      freeformPoints.forEach(p => ctx.lineTo(wx(p.x), wy(p.y)));
      ctx.strokeStyle = "#ffcc00";
      ctx.lineWidth = 2;
      ctx.setLineDash([5,3]);
      ctx.stroke();
      ctx.setLineDash([]);
      freeformPoints.forEach(p => {
        ctx.beginPath();
        ctx.arc(wx(p.x), wy(p.y), 4, 0, Math.PI*2);
        ctx.fillStyle = "#ffcc00";
        ctx.fill();
      });
    }

    // CAD drawing preview
    if(drawPreview) {
      ctx.save();
      ctx.strokeStyle = "#ffcc00";
      ctx.fillStyle = "rgba(255,204,0,0.08)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6,4]);

      if(tool === "rectangle" && drawStart) {
        const minX = Math.min(drawStart.x, drawPreview.x);
        const maxX = Math.max(drawStart.x, drawPreview.x);
        const minY = Math.min(drawStart.y, drawPreview.y);
        const maxY = Math.max(drawStart.y, drawPreview.y);
        ctx.strokeRect(wx(minX), wy(minY), (maxX-minX)*zoom, (maxY-minY)*zoom);
        ctx.fillRect(wx(minX), wy(minY), (maxX-minX)*zoom, (maxY-minY)*zoom);
      }

      if(tool === "circle" && drawStart) {
        const r = Math.sqrt((drawPreview.x-drawStart.x)**2 + (drawPreview.y-drawStart.y)**2);
        ctx.beginPath();
        ctx.arc(wx(drawStart.x), wy(drawStart.y), r*zoom, 0, Math.PI*2);
        ctx.stroke();
        ctx.fill();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(wx(drawStart.x), wy(drawStart.y));
        ctx.lineTo(wx(drawPreview.x), wy(drawPreview.y));
        ctx.stroke();
      }

      if(tool === "polyline" && polylinePoints.length) {
        ctx.beginPath();
        ctx.moveTo(wx(polylinePoints[0].x), wy(polylinePoints[0].y));
        polylinePoints.forEach(p => ctx.lineTo(wx(p.x), wy(p.y)));
        ctx.lineTo(wx(drawPreview.x), wy(drawPreview.y));
        ctx.stroke();
        polylinePoints.forEach(p => {
          ctx.beginPath();
          ctx.arc(wx(p.x), wy(p.y), 4, 0, Math.PI*2);
          ctx.fillStyle = "#ffcc00";
          ctx.fill();
        });
      }

      ctx.restore();
    }

    // Draw fixtures using PROFESSIONAL ENGINEERING SYMBOLS
    fixtures.forEach((f, i) => {
      const fixtureLayer = (() => {
        const t = (f.type || "").toLowerCase();
        if (t.includes("light") || t.includes("laser")) return "lights";
        if (t.includes("nozzle") || t.includes("jet") || t.includes("geyser") || t.includes("foam") || t.includes("mist")) return "nozzles";
        if (t.includes("pump") || t.includes("valve") || t.includes("solenoid") || t.includes("drain") || 
            t.includes("sensor") || t.includes("filter") || t.includes("uv") || t.includes("dosing") ||
            t.includes("vfd") || t.includes("motion")) return "equipment";
        return "equipment";
      })();
      
      if (!isLayerVisible(fixtureLayer)) return;
      
      const isSelected = selectedFixture === i;
      const cx = wx(f.x), cy = wy(f.y);
      
      const symbol = getEngineeringSymbol(f.type);
      const rotation = f.rotation || 0;
      const scale = Math.max(0.7, Math.min(1.4, zoom / 30));
      
      if (isSelected) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, 18 * scale, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,204,0,0.10)";
        ctx.fill();
        ctx.strokeStyle = "#ffcc00";
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 3]);
        ctx.shadowBlur = 14;
        ctx.shadowColor = "#ffcc00";
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = symbol.color;
        drawEngSymbol(ctx, cx, cy, rotation, scale * 1.18, true, symbol);
        ctx.restore();
      }
      
      drawEngSymbol(ctx, cx, cy, rotation, scale, isSelected, symbol);
      
      if (isSelected || zoom > 35) {
        ctx.fillStyle = symbol.color;
        ctx.font = `${Math.max(9, zoom * 0.24)}px monospace`;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(f.label || symbol.type, cx + 12, cy - 8);
      }
    });

    // Measurements
    if(isLayerVisible("measurements")) measurements.forEach(m => {
      ctx.beginPath();
      ctx.moveTo(wx(m.x1), wy(m.y1));
      ctx.lineTo(wx(m.x2), wy(m.y2));
      ctx.strokeStyle = "#ffcc00";
      ctx.lineWidth = 1;
      ctx.setLineDash([4,2]);
      ctx.stroke();
      ctx.setLineDash([]);
      const dist = Math.sqrt((m.x2-m.x1)**2 + (m.y2-m.y1)**2);
      const mx = (m.x1+m.x2)/2, my = (m.y1+m.y2)/2;
      ctx.fillStyle = "#ffcc00";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${dist.toFixed(2)}m`, wx(mx), wy(my)-8);
    });

    // Coordinate display
    ctx.fillStyle = "#334455";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`0,0`, pan.x+2, pan.y-4);

  }, [
  geometry,
  fixtures,
  selectedFixture,
  freeformPoints,
  measurements,
  zoom,
  pan,
  showGrid,
  showDepth,
  tool,
  manualPipes,
  selectedPipeId,
  selectedNode,
renderPipes
]);

  // Canvas coordinate helpers
  const toCanvas = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = (clientX - rect.left) * (canvasRef.current.width / rect.width);
    const cy = (clientY - rect.top) * (canvasRef.current.height / rect.height);
    return { cx, cy };
  };

  const toWorld = (clientX, clientY) => {
    const { cx, cy } = toCanvas(clientX, clientY);
    return { x: (cx - pan.x) / zoom, y: (cy - pan.y) / zoom };
  };

  const getGeometryBounds = useCallback(() => {
    if(!geometry) return null;
    if(geometry.type === "circle") {
      return {
        minX: geometry.center.x - geometry.radius,
        maxX: geometry.center.x + geometry.radius,
        minY: geometry.center.y - geometry.radius,
        maxY: geometry.center.y + geometry.radius,
      };
    }
    if(geometry.type === "ellipse") {
      return {
        minX: geometry.center.x - geometry.rx,
        maxX: geometry.center.x + geometry.rx,
        minY: geometry.center.y - geometry.ry,
        maxY: geometry.center.y + geometry.ry,
      };
    }
    if(geometry.points?.length) {
      const xs = geometry.points.map(p=>p.x);
      const ys = geometry.points.map(p=>p.y);
      return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      };
    }
    return null;
  }, [geometry]);

  const resetView = useCallback(() => {
    setZoom(30);
    setPan({ x:60, y:60 });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (["input","textarea","select"].includes(tag)) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault(); handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault(); handleRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo]);

  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    if(!canvas) return;
    const bounds = getGeometryBounds();
    if(!bounds) {
      resetView();
      return;
    }

    const padding = 80;
    const bw = Math.max(1, bounds.maxX - bounds.minX);
    const bh = Math.max(1, bounds.maxY - bounds.minY);
    const nextZoom = Math.max(10, Math.min(140, Math.min((canvas.width - padding*2) / bw, (canvas.height - padding*2) / bh)));
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;

    setZoom(nextZoom);
    setPan({
      x: canvas.width / 2 - cx * nextZoom,
      y: canvas.height / 2 - cy * nextZoom,
    });
  }, [getGeometryBounds, resetView]);

  // CAD-style keyboard navigation
    useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if(["input","textarea","select"].includes(tag)) return;

      if(e.code === "Space") {
        e.preventDefault();
        setIsSpaceDown(true);
      }
      if(e.key?.toLowerCase() === "f") fitView();
      if(e.key?.toLowerCase() === "h") resetView();
      if(e.key === "Delete" || e.key === "Backspace") {
  e.preventDefault();

  if (selectedNode) {
    removeNode(selectedNode.pipeId, selectedNode.nodeIndex);
    return;
  }

  if (selectedSegment) {
    deleteSelectedSegment();
    return;
  }

  if (selectedPipeId) {
    deleteSelectedPipe();
    return;
  }
}

if(e.key === "Escape") {
  setTool("select");
  setMeasureStart(null);
  setIsPanning(false);
  setDrawStart(null);
  setDrawPreview(null);
  setPolylinePoints([]);
  cancelPipeDrawing();

setSelectedPipeId(null);
setSelectedNode(null);
setSelectedSegment(null);
}
    };

    const onKeyUp = (e) => {
      if(e.code === "Space") {
        e.preventDefault();
        setIsSpaceDown(false);
        setIsPanning(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
  fitView,
  resetView,
  selectedNode,
  selectedSegment,
  selectedPipeId,
  removeNode,
  deleteSelectedSegment,
  deleteSelectedPipe,
  cancelPipeDrawing,
  setSelectedPipeId,
  setSelectedNode,
  setSelectedSegment
]);

  const snapPoint = (pt) => {
    if(!snapToGrid) return pt;
    const step = Number(gridStep || 0.5);
    return {
      x: Math.round(pt.x / step) * step,
      y: Math.round(pt.y / step) * step,
    };
  };

  const getGripHit = (pt) => {
    if(!geometry?.points?.length) return null;
    const threshold = Math.max(0.15, 8 / zoom);
    for(let i=0; i<geometry.points.length; i++) {
      const p = geometry.points[i];
      const d = Math.sqrt((p.x-pt.x)**2 + (p.y-pt.y)**2);
      if(d <= threshold) return { type:"vertex", index:i };
    }
    return null;
  };

  const updateRectangleFromGrip = (grip, pt) => {
    if(!geometry?.points?.length || grip?.type !== "vertex") return;
    const snapped = snapPoint(pt);
    const pts = geometry.points;
    const oppositeIndex = (grip.index + 2) % 4;
    const opposite = pts[oppositeIndex];

    const minX = Math.min(opposite.x, snapped.x);
    const maxX = Math.max(opposite.x, snapped.x);
    const minY = Math.min(opposite.y, snapped.y);
    const maxY = Math.max(opposite.y, snapped.y);

    const nextPoints = [
      {x:minX, y:minY},
      {x:maxX, y:minY},
      {x:maxX, y:maxY},
      {x:minX, y:maxY},
    ];

    setGeometry(prev => ({ ...prev, points:nextPoints }));
    setParams(p => ({
      ...p,
      width: Number(Math.max(1, maxX-minX).toFixed(3)),
      length: Number(Math.max(1, maxY-minY).toFixed(3)),
    }));
  };

  const isPointInsideGeometry = (pt) => {
    if(!geometry) return false;

    if(geometry.type === "circle") {
      const dx = pt.x - geometry.center.x;
      const dy = pt.y - geometry.center.y;
      return Math.sqrt(dx*dx + dy*dy) <= geometry.radius;
    }

    if(geometry.type === "ellipse") {
      const dx = (pt.x - geometry.center.x) / geometry.rx;
      const dy = (pt.y - geometry.center.y) / geometry.ry;
      return (dx*dx + dy*dy) <= 1;
    }

    if(geometry.points?.length) {
      let inside = false;
      const pts = geometry.points;
      for(let i=0, j=pts.length-1; i<pts.length; j=i++) {
        const xi = pts[i].x, yi = pts[i].y;
        const xj = pts[j].x, yj = pts[j].y;
        const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
          (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 0.000001) + xi);
        if(intersect) inside = !inside;
      }
      return inside;
    }

    return false;
  };

  const moveGeometryBy = (dx, dy) => {
    setGeometry(prev => {
      if(!prev) return prev;
      if(prev.type === "circle" || prev.type === "ellipse") {
        return { ...prev, center:{ x:prev.center.x + dx, y:prev.center.y + dy } };
      }
      if(prev.points?.length) {
        return { ...prev, points:prev.points.map(p => ({ x:p.x + dx, y:p.y + dy })) };
      }
      return prev;
    });

    setFixtures(prev => prev.map(f => ({ ...f, x:f.x + dx, y:f.y + dy })));
  };

const onCanvasContextMenu = (e) => {
  e.preventDefault();

  const rawWorld = toWorld(e.clientX, e.clientY);

  const node = selectNodeAtPoint(rawWorld);
  if (node) {
    setSelectedObject("pipe_node");
    setPipeContextMenu({
      x: e.clientX,
      y: e.clientY,
      world: rawWorld,
      type: "node"
    });
    return;
  }

  const pipeHit = selectPipeAtPoint(rawWorld);
  if (pipeHit) {
    setSelectedObject("pipe");
    setPipeContextMenu({
      x: e.clientX,
      y: e.clientY,
      world: rawWorld,
      type: "pipe"
    });
    return;
  }

  setPipeContextMenu(null);
};
  const onCanvasMouseDown = (e) => {
    const rawWorld = toWorld(e.clientX, e.clientY);
    let world = snapPoint(rawWorld);
if (tool === "select") {
  const node = selectNodeAtPoint(rawWorld);
  if (node) { setSelectedObject("pipe_node"); setSelectedFixture(null); return; }
  const pipeHit = selectPipeAtPoint(rawWorld);
  if (pipeHit) { setSelectedObject("pipe"); setSelectedFixture(null); return; }
}
    if(e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || isSpaceDown))) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }
if (tool === "pipe") { onPipeClick(world); return; }
    if(tool === "rectangle") {
      if(isLayerLocked("pool_outline")) return;
      if(!drawStart) {
        setDrawStart(world);
        setDrawPreview(world);
      } else {
        const width = Math.abs(world.x - drawStart.x);
        const length = Math.abs(world.y - drawStart.y);

        setPoolType("rectangular");
        setParams(p=>({
          ...p,
          width: Math.max(1, Number(width.toFixed(3))),
          length: Math.max(1, Number(length.toFixed(3)))
        }));

        setGeometry({
          type:"rectangle",
          points:[
            {x:Math.min(drawStart.x, world.x), y:Math.min(drawStart.y, world.y)},
            {x:Math.max(drawStart.x, world.x), y:Math.min(drawStart.y, world.y)},
            {x:Math.max(drawStart.x, world.x), y:Math.max(drawStart.y, world.y)},
            {x:Math.min(drawStart.x, world.x), y:Math.max(drawStart.y, world.y)}
          ],
          closed:true,
        });

        setDrawStart(null);
        setDrawPreview(null);
      }
      return;
    }

    if(tool === "circle") {
      if(isLayerLocked("pool_outline")) return;
      if(!drawStart) {
        setDrawStart(world);
        setDrawPreview(world);
      } else {
        const radius = Math.sqrt((world.x-drawStart.x)**2 + (world.y-drawStart.y)**2);
        setPoolType("circular");
        setParams(p=>({ ...p, radius: Math.max(1, Number(radius.toFixed(3))) }));
        setGeometry({ type:"circle", center:drawStart, radius:Math.max(1, Number(radius.toFixed(3))) });
        setDrawStart(null);
        setDrawPreview(null);
      }
      return;
    }

    if(tool === "polyline") {
      if(isLayerLocked("pool_outline")) return;
      setPolylinePoints(prev => [...prev, world]);
      setDrawPreview(world);
      return;
    }

    if(tool === "select") {
      // Fixture selection must happen before pool selection.
      // Use rawWorld, not snapped world, otherwise small fixtures become hard to select.
      const fixtureHitRadius = Math.max(0.35, 12 / zoom);
      const hit = fixtures.findIndex(f => Math.sqrt((f.x-rawWorld.x)**2+(f.y-rawWorld.y)**2) <= fixtureHitRadius);

      if(hit >= 0) {
        setSelectedFixture(hit);
        setSelectedObject("fixture");
        setActiveGrip(null);
        setIsDraggingGeometry(false);
        setLastDragWorld(null);
        return;
      }

      const grip = getGripHit(world);
      if(grip) {
        setActiveGrip(grip);
        setSelectedFixture(null);
        setSelectedObject("pool");
        return;
      }

      if(isLayerLocked("pool_outline") && isPointInsideGeometry(world)) return;

      setSelectedFixture(null);
      setSelectedObject(null);

      // If no fixture is selected, allow dragging the full pool geometry
      if(isPointInsideGeometry(world)) {
        setSelectedObject("pool");
        setIsDraggingGeometry(true);
        setLastDragWorld(world);
      }
    } else if(
  tool === "nozzle" ||
  tool === "light" ||
  tool === "equipment"
) {
      if(
  (tool === "nozzle" && isLayerLocked("nozzles")) ||
  (tool === "light" && isLayerLocked("lights")) ||
  (tool === "equipment" && isLayerLocked("equipment"))
)
  return;
      pushUndo();
      const ft = FIXTURE_TYPES.find(t => t.key === fixtureType) || {
  key: fixtureType,
  label: fixtureType || "Equipment",
  color: "#22c55e",
  icon: "⚙"
};
      const getDefaultGroupId = (type) => {
  const t = String(type || "").toLowerCase();

  if (t.includes("ring") || t.includes("running")) return "outer_ring_jets";
  if (t.includes("arch") || t.includes("2d")) return "arch_jets";
  if (t.includes("1d") || t.includes("3d") || t.includes("geyser") || t.includes("jet")) return "center_jets";
  if (t.includes("light") || t.includes("rgb")) return "rgb_lights";
  if (t.includes("fire") || t.includes("flame")) return "flame_units";
  if (t.includes("air") || t.includes("burst") || t.includes("fog") || t.includes("mist")) return "fog_machines";
  if (t.includes("laser")) return "laser_units";

  return "engineering_equipment";
};

setFixtures(prev => [...prev, {
  id: Date.now(),
  x: Math.round(world.x * 10) / 10,
  y: Math.round(world.y * 10) / 10,
  type: fixtureType,
  groupId: getDefaultGroupId(fixtureType),
  label: `${ft.label} ${fixtures.filter(f=>f.type===fixtureType).length+1}`,
  zone: depthZone,
  rotation: 0,
  engineering: getDefaultEngineering(fixtureType),
}]);
    } else if(tool === "rectangle" || tool === "polyline" && poolType === "freeform") {
      setDrawingFreeform(true);
      setFreeformPoints(prev => [...prev, world]);
    } else if(tool === "measure") {
      if(!measureStart) {
        setMeasureStart(world);
      } else {
        setMeasurements(prev => [...prev, { x1:measureStart.x, y1:measureStart.y, x2:world.x, y2:world.y }]);
        setMeasureStart(null);
      }
    } else if(tool === "delete") {
      const hit = fixtures.findIndex(f => Math.sqrt((f.x-world.x)**2+(f.y-world.y)**2) < 0.5);
      if(hit >= 0) {
        setFixtures(prev => prev.filter((_,i) => i !== hit));
        setSelectedFixture(null);
      }
    }
  };

  const onCanvasMouseMove = (e) => {
    const rawWorld = toWorld(e.clientX, e.clientY);
    let world = snapPoint(rawWorld);
    setCursorWorld({ x: world.x, y: world.y });

   if (tool === "select" && selectedNode && e.buttons === 1) {
  moveNode(selectedNode.pipeId, selectedNode.nodeIndex, world);
  setSelectedObject("pipe_node");
  return;
}

    if (tool === "pipe") {
  onPipeMouseMove(snapPoint(rawWorld));

  if (!isPanning) {
    return;
  }
}
    if(isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    if((tool === "rectangle" || tool === "circle") && drawStart) {
      setDrawPreview(world);
    }
    if(tool === "polyline") {
      if(isLayerLocked("pool_outline")) return;
      setDrawPreview(world);
    }

    if(activeGrip) {
      updateRectangleFromGrip(activeGrip, world);
      return;
    }

    if(isDraggingGeometry && lastDragWorld) {
      const dx = world.x - lastDragWorld.x;
      const dy = world.y - lastDragWorld.y;
      moveGeometryBy(dx, dy);
      setLastDragWorld(world);
      return;
    }

    if(tool === "select" && e.buttons === 1 && selectedFixture !== null) {
      setFixtures(prev => prev.map((f,i) => i===selectedFixture ? {...f, x:Math.round(world.x*10)/10, y:Math.round(world.y*10)/10} : f));
    }
  };

  const onCanvasMouseUp = () => {
    setIsPanning(false);
    setIsDraggingGeometry(false);
    setLastDragWorld(null);
    setActiveGrip(null);
  };

  const onCanvasWheel = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if(!canvas) return;

    const { cx, cy } = toCanvas(e.clientX, e.clientY);
    const worldBefore = {
      x: (cx - pan.x) / zoom,
      y: (cy - pan.y) / zoom,
    };

    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const nextZoom = Math.max(10, Math.min(140, zoom * factor));

    setZoom(nextZoom);
    setPan({
      x: cx - worldBefore.x * nextZoom,
      y: cy - worldBefore.y * nextZoom,
    });
  };

  const finishFreeform = () => {
    if(freeformPoints.length >= 3) {
      setGeometry({ points: freeformPoints, closed:true });
      setDrawingFreeform(false);
    }
  };

  const finishPolyline = () => {
    if(polylinePoints.length >= 3) {
      setGeometry({ points: polylinePoints, closed:true });
      setPoolType("freeform");
      setFreeformPoints([]);
    }
    setPolylinePoints([]);
    setDrawStart(null);
    setDrawPreview(null);
  };

  const cancelDrawing = () => {
    setDrawStart(null);
    setDrawPreview(null);
    setPolylinePoints([]);
    setMeasureStart(null);
  };

  const clearMeasurements = () => setMeasurements([]);


  const buildProjectPayload = () => ({
    format:"AquaFlowPoolGeometry",
    version:"0.11A",
    name: projectName,
    pool_type: poolType,
    params,
    geometry,
   fixtures,
   manualPipes,
   measurements,
   layers,
    array_settings:{ arrayMode, arrayCount, arrayRows, arrayCols, arrayInset },
    engineering_summary:{
  flow:{
    nozzleFlowLpm: hydraulicSummary.totalNozzleFlowLpm,
    processFlowLpm: hydraulicSummary.totalProcessFlowLpm,
    totalFlowLpm: hydraulicSummary.totalFlowLpm,
    totalFlowM3Hr: hydraulicSummary.totalFlowM3Hr,
  },
  pump:{
    requiredPumpKw: hydraulicSummary.recommendedPumpKw,
    installedPumpKw: hydraulicSummary.totalPumpPowerKw,
    installedPumpCapacityM3Hr: hydraulicSummary.totalPumpCapacityM3Hr,
    capacityStatus: hydraulicSummary.pumpCapacityStatus,
    powerStatus: hydraulicSummary.pumpPowerStatus,
  },
  pipe:{
    recommendedPipeMm: hydraulicSummary.recommendedPipeMm,
    totalDynamicHeadM: hydraulicSummary.totalDynamicHeadM,
    hydraulicPowerKw: hydraulicSummary.hydraulicPowerKw,
    totalBranchLengthM: pipework?.totalBranchLengthM || 0,
    mainHeaderLengthM: pipework?.mainHeaderLengthM || 0,
    headerDN: pipework?.headerDN || 0,
    topology: pipework?.topology || "tree",
  },
  electrical:{
    totalWatts: hydraulicSummary.totalWatts,
  },
  air:{
    totalAirFlowLpm: hydraulicSummary.totalAirFlowLpm,
  },
  flame:{
    totalFuelFlow: hydraulicSummary.totalFuelFlow,
  },
  control:{
    totalDmxChannels: hydraulicSummary.totalDmxChannels,
    digitalInputs: hydraulicSummary.totalDigitalInputs,
    digitalOutputs: hydraulicSummary.totalDigitalOutputs,
    analogInputs: hydraulicSummary.totalAnalogInputs,
    analogOutputs: hydraulicSummary.totalAnalogOutputs,
  },
  raw: hydraulicSummary,
},
  bom: [
    ...baseBomItems,
    ...(pipework?.bom || []),
  ],
    exported_at: new Date().toISOString(),
  });

  const downloadTextFile = (filename, content, mime="text/plain") => {
    const blob = new Blob([content], { type:mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExportStatus(`Exported ${filename}`);
    setTimeout(() => setExportStatus(""), 2500);
  };

  const safeFileName = (name) => String(name || "aquaflow_project")
    .trim()
    .replace(/[^a-z0-9_\-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    || "aquaflow_project";

  const exportProjectJSON = () => {
    const payload = buildProjectPayload();
    downloadTextFile(`${safeFileName(projectName)}.aquaflow.json`, JSON.stringify(payload, null, 2), "application/json");
  };
const exportBOMCSV = () => {
  const rows = [
    ["No", "Category", "Item", "Unit", "Quantity", "Flow LPM", "Flow m³/hr", "Wattage W", "Power kW", "Air LPM", "Fuel", "DMX", "DI", "DO", "AI", "AO"]
  ];

  bomItems.forEach((item, index) => {
    rows.push([
      index + 1,
      item.category || "",
      item.label || item.key,
      item.unit || "pcs",
      item.quantity || 0,
      item.totalFlowLpm || 0,
      item.totalFlowM3Hr || 0,
      item.totalWattage || 0,
      item.totalPowerKw || 0,
      item.totalAirFlowLpm || 0,
      item.totalFuelFlow || 0,
      item.totalDmxChannels || 0,
      item.totalDigitalInputs || 0,
      item.totalDigitalOutputs || 0,
      item.totalAnalogInputs || 0,
      item.totalAnalogOutputs || 0
    ]);
  });

rows.push(["", "", "", "", "", "", ""]);
 rows.push(["", "ENGINEERING SUMMARY", "", "", "", "", ""]);
rows.push(["", "Nozzle Flow", "L/min", "", hydraulicSummary.totalNozzleFlowLpm.toFixed(1), "", ""]);
rows.push(["", "Process Flow", "L/min", "", hydraulicSummary.totalProcessFlowLpm.toFixed(1), "", ""]);
rows.push(["", "Total Flow", "m³/hr", "", hydraulicSummary.totalFlowM3Hr.toFixed(2), "", ""]);
rows.push(["", "Recommended Pipe", "DN", "", hydraulicSummary.recommendedPipeMm, "", ""]);
rows.push(["", "Total Dynamic Head", "m", "", hydraulicSummary.totalDynamicHeadM.toFixed(1), "", ""]);
rows.push(["", "Required Pump", "kW", "", hydraulicSummary.recommendedPumpKw.toFixed(2), "", ""]);
rows.push(["", "Installed Pump Power", "kW", "", hydraulicSummary.totalPumpPowerKw.toFixed(2), "", ""]);
rows.push(["", "Installed Pump Capacity", "m³/hr", "", hydraulicSummary.totalPumpCapacityM3Hr.toFixed(1), "", ""]);
rows.push(["", "Pump Status", "", "", `${hydraulicSummary.pumpCapacityStatus} / ${hydraulicSummary.pumpPowerStatus}`, "", ""]);
rows.push(["", "Electrical Load", "W", "", hydraulicSummary.totalWatts.toFixed(0), "", ""]);
rows.push(["", "Air Demand", "L/min", "", hydraulicSummary.totalAirFlowLpm.toFixed(0), "", ""]);
rows.push(["", "Fuel Demand", "", "", hydraulicSummary.totalFuelFlow.toFixed(2), "", ""]);
rows.push(["", "DMX Channels", "channels", "", hydraulicSummary.totalDmxChannels, "", ""]);
rows.push(["", "Digital I/O", "", "", `${hydraulicSummary.totalDigitalInputs} IN / ${hydraulicSummary.totalDigitalOutputs} OUT`, "", ""]);
rows.push(["", "Analog I/O", "", "", `${hydraulicSummary.totalAnalogInputs} IN / ${hydraulicSummary.totalAnalogOutputs} OUT`, "", ""]);

  const csv = rows
    .map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");

  downloadTextFile(
    `${safeFileName(projectName)}_BOM.csv`,
    csv,
    "text/csv"
  );
};
  const dxfHeader = () => [
    "0","SECTION","2","HEADER",
    "9","$INSUNITS","70","6",
    "0","ENDSEC",
    "0","SECTION","2","TABLES",
    "0","TABLE","2","LAYER","70","8",
    "0","LAYER","2","POOL_OUTLINE","70","0","62","4","6","CONTINUOUS",
    "0","LAYER","2","NOZZLES","70","0","62","3","6","CONTINUOUS",
    "0","LAYER","2","LIGHTS","70","0","62","2","6","CONTINUOUS",
"0","LAYER","2","EQUIPMENT","70","0","62","3","6","CONTINUOUS",
    "0","LAYER","2","ANNOTATIONS","70","0","62","6","6","CONTINUOUS",
    "0","ENDTAB",
    "0","ENDSEC",
    "0","SECTION","2","ENTITIES"
  ];

  const dxfFooter = () => ["0","ENDSEC","0","EOF"];

  const dxfLine = (x1,y1,x2,y2,layer="POOL_OUTLINE") => [
    "0","LINE","8",layer,
    "10",String(x1),"20",String(y1),"30","0",
    "11",String(x2),"21",String(y2),"31","0"
  ];

  const dxfCircle = (x,y,r,layer="NOZZLES") => [
    "0","CIRCLE","8",layer,
    "10",String(x),"20",String(y),"30","0",
    "40",String(r)
  ];

  const dxfText = (x,y,size,value,layer="ANNOTATIONS") => [
    "0","TEXT","8",layer,
    "10",String(x),"20",String(y),"30","0",
    "40",String(size),
    "1",String(value),
    "50","0"
  ];

  const exportProjectDXF = () => {
    const out = [...dxfHeader()];

    if(geometry) {
      if(geometry.type === "circle") {
        out.push(...dxfCircle(geometry.center.x, -geometry.center.y, geometry.radius, "POOL_OUTLINE"));
      } else if(geometry.type === "ellipse") {
        const steps = 72;
        for(let i=0;i<steps;i++) {
          const a1 = (i/steps)*Math.PI*2;
          const a2 = ((i+1)/steps)*Math.PI*2;
          const x1 = geometry.center.x + Math.cos(a1)*geometry.rx;
          const y1 = -(geometry.center.y + Math.sin(a1)*geometry.ry);
          const x2 = geometry.center.x + Math.cos(a2)*geometry.rx;
          const y2 = -(geometry.center.y + Math.sin(a2)*geometry.ry);
          out.push(...dxfLine(x1,y1,x2,y2,"POOL_OUTLINE"));
        }
      } else if(geometry.points?.length) {
        for(let i=0;i<geometry.points.length;i++) {
          const p1 = geometry.points[i];
          const p2 = geometry.points[(i+1) % geometry.points.length];
          if(i === geometry.points.length-1 && !geometry.closed) break;
          out.push(...dxfLine(p1.x, -p1.y, p2.x, -p2.y, "POOL_OUTLINE"));
        }
      }
    }

    fixtures.forEach((f, idx) => {
  const layer =
    f.type?.startsWith("light") || f.type?.startsWith("laser")
      ? "LIGHTS"
      : f.type?.startsWith("nozzle")
      ? "NOZZLES"
      : "EQUIPMENT";
      out.push(...dxfCircle(f.x, -f.y, 0.12, layer));
      out.push(...dxfText(f.x + 0.18, -f.y + 0.18, 0.18, f.label || `${f.type}-${idx+1}`, layer));
    });

    measurements.forEach((m) => {
      out.push(...dxfLine(m.x1, -m.y1, m.x2, -m.y2, "ANNOTATIONS"));
      const dist = Math.sqrt((m.x2-m.x1)**2 + (m.y2-m.y1)**2);
      out.push(...dxfText((m.x1+m.x2)/2, -((m.y1+m.y2)/2), 0.2, `${dist.toFixed(2)}m`, "ANNOTATIONS"));
    });

    const meta = getGeometryMeta();
    if(meta) {
      out.push(...dxfText(meta.x, -(meta.y + meta.length + 0.6), 0.25, `${projectName}`, "ANNOTATIONS"));
    }

    out.push(...dxfFooter());
    downloadTextFile(`${safeFileName(projectName)}.dxf`, out.join("\n"), "application/dxf");
  };

  const saveProject = async () => {
    const project = buildProjectPayload();
    try {
      await fetch(`${API}/diagnostics/record`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          level:"info", category:"system", source:"geometry_designer",
          message:`Pool geometry saved: ${projectName} — ${fixtures.length} fixtures`,
          data: project,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
  };

  const getArrayBounds = () => {
    if(!geometry) return null;
    if(geometry.type === "circle") {
      return {
        kind:"circle",
        cx: geometry.center.x,
        cy: geometry.center.y,
        radius: geometry.radius,
        minX: geometry.center.x - geometry.radius,
        maxX: geometry.center.x + geometry.radius,
        minY: geometry.center.y - geometry.radius,
        maxY: geometry.center.y + geometry.radius,
      };
    }
    if(geometry.type === "ellipse") {
      return {
        kind:"ellipse",
        cx: geometry.center.x,
        cy: geometry.center.y,
        rx: geometry.rx,
        ry: geometry.ry,
        minX: geometry.center.x - geometry.rx,
        maxX: geometry.center.x + geometry.rx,
        minY: geometry.center.y - geometry.ry,
        maxY: geometry.center.y + geometry.ry,
      };
    }
    if(geometry.points?.length) {
      const xs = geometry.points.map(p=>p.x);
      const ys = geometry.points.map(p=>p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      return {
        kind:"polygon",
        cx:(minX+maxX)/2,
        cy:(minY+maxY)/2,
        minX, maxX, minY, maxY,
        width:maxX-minX,
        length:maxY-minY,
      };
    }
    return null;
  };

  const applyFixtureArray = () => {
    if(!geometry) return;
    if(fixtureType?.startsWith("nozzle") && isLayerLocked("nozzles")) return;
    if(fixtureType?.startsWith("light") && isLayerLocked("lights")) return;

    const b = getArrayBounds();
    if(!b) return;

    const ft = FIXTURE_TYPES.find(t => t.key === fixtureType) || FIXTURE_TYPES[0];
    const count = Math.max(1, Number(arrayCount || 1));
    const rows = Math.max(1, Number(arrayRows || 1));
    const cols = Math.max(1, Number(arrayCols || 1));
    const inset = Math.max(0, Number(arrayInset || 0));
    const baseId = Date.now();
    const made = [];

    if(arrayMode === "centerline") {
      const y = b.cy;
      const x1 = b.minX + inset;
      const x2 = b.maxX - inset;
      const span = Math.max(0.1, x2-x1);
      for(let i=0;i<count;i++) {
        const t = count === 1 ? 0.5 : i/(count-1);
        made.push({
          id:baseId+i,
          x:Number((x1 + span*t).toFixed(3)),
          y:Number(y.toFixed(3)),
          type:fixtureType,
          label:`${ft.label} ${fixtures.filter(f=>f.type===fixtureType).length+i+1}`,
          zone:depthZone,
          rotation:0,
          engineering: getDefaultEngineering(fixtureType),
                       groupId: getDefaultGroupId(fixtureType),
        });
      }
    }

    if(arrayMode === "ring") {
      const radius = b.kind === "circle" ? Math.max(0.1, b.radius - inset) : Math.max(0.1, Math.min((b.maxX-b.minX), (b.maxY-b.minY))/2 - inset);
      for(let i=0;i<count;i++) {
        const a = (i/count)*Math.PI*2;
        made.push({
          id:baseId+i,
          x:Number((b.cx + Math.cos(a)*radius).toFixed(3)),
          y:Number((b.cy + Math.sin(a)*radius).toFixed(3)),
          type:fixtureType,
          label:`${ft.label} ${fixtures.filter(f=>f.type===fixtureType).length+i+1}`,
          zone:depthZone,
          rotation:Number((a*180/Math.PI).toFixed(1)),
          engineering: getDefaultEngineering(fixtureType),
                       groupId: getDefaultGroupId(fixtureType),
        });
      }
    }

    if(arrayMode === "grid") {
      const x1 = b.minX + inset;
      const x2 = b.maxX - inset;
      const y1 = b.minY + inset;
      const y2 = b.maxY - inset;
      let n = 0;
      for(let r=0;r<rows;r++) {
        for(let c=0;c<cols;c++) {
          const tx = cols === 1 ? 0.5 : c/(cols-1);
          const ty = rows === 1 ? 0.5 : r/(rows-1);
          made.push({
  id:baseId+n,
  x:Number((x1 + (x2-x1)*tx).toFixed(3)),
  y:Number((y1 + (y2-y1)*ty).toFixed(3)),
  type:fixtureType,
  label:`${ft.label} ${fixtures.filter(f=>f.type===fixtureType).length+n+1}`,
  zone:depthZone,
  rotation:0,
  engineering:getDefaultEngineering(fixtureType),
  groupId: getDefaultGroupId(fixtureType),
});
          n++;
        }
      }
    }

    pushUndo();
    setFixtures(prev => [...prev, ...made]);
  };

  const autoPlaceNozzles = () => {
    if(!geometry) return;
    pushUndo();
    const newFixtures = [];
    if(geometry.type === "circle") {
      // Center geyser + ring
      newFixtures.push({ id:Date.now(), x:0, y:0, type:"nozzle_geyser", label:"Center Geyser", zone:"deep", rotation:0 });
      for(let i=0;i<6;i++) {
        const a=(i/6)*Math.PI*2;
        newFixtures.push({ id:Date.now()+i, x:Math.cos(a)*geometry.radius*0.5, y:Math.sin(a)*geometry.radius*0.5, type:"nozzle_arch", label:`Arch ${i+1}`, zone:"medium", rotation:0 });
      }
      for(let i=0;i<8;i++) {
        const a=(i/8)*Math.PI*2;
        newFixtures.push({ id:Date.now()+10+i, x:Math.cos(a)*geometry.radius*0.8, y:Math.sin(a)*geometry.radius*0.8, type:"nozzle_fan", label:`Fan ${i+1}`, zone:"shallow", rotation:0 });
      }
    } else if(geometry.points) {
      const xs = geometry.points.map(p=>p.x), ys = geometry.points.map(p=>p.y);
      const cx = (Math.min(...xs)+Math.max(...xs))/2;
      const cy = (Math.min(...ys)+Math.max(...ys))/2;
      newFixtures.push({ id:Date.now(), x:cx, y:cy, type:"nozzle_geyser", label:"Center Geyser", zone:"deep", rotation:0 });
      for(let i=0;i<6;i++) {
        const a=(i/6)*Math.PI*2;
        const r=Math.min(params.width,params.length)*0.25;
        newFixtures.push({ id:Date.now()+i, x:cx+Math.cos(a)*r, y:cy+Math.sin(a)*r, type:"nozzle_arch", label:`Arch ${i+1}`, zone:"medium", rotation:0 });
      }
    }
    const engineered = newFixtures.map(f => ({ ...f, engineering:getDefaultEngineering(f.type), groupId: getDefaultGroupId(f.type) }));
    setFixtures(prev => [...prev, ...engineered]);
  };

  const isLayerVisible = (key) => layers.find(l => l.key === key)?.visible !== false;
  const isLayerLocked = (key) => layers.find(l => l.key === key)?.locked === true;

  const toggleLayerVisible = (key) => {
    setLayers(prev => prev.map(l => l.key === key ? { ...l, visible:!l.visible } : l));
  };

  const toggleLayerLocked = (key) => {
    setLayers(prev => prev.map(l => l.key === key ? { ...l, locked:!l.locked } : l));
  };

  const getGeometryMeta = () => {
    if(!geometry) return null;

    if(geometry.type === "circle") {
      return {
        kind:"circle",
        x: geometry.center.x,
        y: geometry.center.y,
        radius: geometry.radius,
        width: geometry.radius * 2,
        length: geometry.radius * 2,
      };
    }

    if(geometry.type === "ellipse") {
      return {
        kind:"ellipse",
        x: geometry.center.x,
        y: geometry.center.y,
        width: geometry.rx * 2,
        length: geometry.ry * 2,
      };
    }

    if(geometry.points?.length) {
      const xs = geometry.points.map(p=>p.x);
      const ys = geometry.points.map(p=>p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      return {
        kind: geometry.type || "polygon",
        x: minX,
        y: minY,
        width: maxX - minX,
        length: maxY - minY,
      };
    }

    return null;
  };

  const setGeometryProperty = (key, rawValue) => {
    const value = Number(rawValue);
    if(Number.isNaN(value) || !geometry) return;

    const meta = getGeometryMeta();
    if(!meta) return;

    if(geometry.type === "circle") {
      if(key === "x" || key === "y") {
        setGeometry(prev => ({ ...prev, center:{ ...prev.center, [key]:value } }));
      }
      if(key === "radius") {
        const r = Math.max(0.1, value);
        setGeometry(prev => ({ ...prev, radius:r }));
        setParams(p => ({ ...p, radius:Number(r.toFixed(3)) }));
      }
      if(key === "depth") {
        setParams(p => ({ ...p, depth:Math.max(0.1, Math.min(20, value)) }));
      }
      return;
    }

    if(geometry.type === "ellipse") {
      if(key === "x" || key === "y") {
        setGeometry(prev => ({ ...prev, center:{ ...prev.center, [key]:value } }));
      }
      if(key === "width") {
        const w = Math.max(0.1, value);
        setGeometry(prev => ({ ...prev, rx:w/2 }));
        setParams(p => ({ ...p, width:Number(w.toFixed(3)) }));
      }
      if(key === "length") {
        const l = Math.max(0.1, value);
        setGeometry(prev => ({ ...prev, ry:l/2 }));
        setParams(p => ({ ...p, length:Number(l.toFixed(3)) }));
      }
      if(key === "depth") {
        setParams(p => ({ ...p, depth:Math.max(0.1, Math.min(20, value)) }));
      }
      return;
    }

    if(geometry.points?.length) {
      const oldX = meta.x;
      const oldY = meta.y;
      const oldW = Math.max(0.001, meta.width);
      const oldL = Math.max(0.001, meta.length);

      let nextX = oldX;
      let nextY = oldY;
      let nextW = oldW;
      let nextL = oldL;

      if(key === "x") nextX = value;
      if(key === "y") nextY = value;
      if(key === "width") nextW = Math.max(0.1, value);
      if(key === "length") nextL = Math.max(0.1, value);

      if(key === "depth") {
        setParams(p => ({ ...p, depth:Math.max(0.1, Math.min(20, value)) }));
        return;
      }

      const scaled = geometry.points.map(p => ({
        x: nextX + ((p.x - oldX) / oldW) * nextW,
        y: nextY + ((p.y - oldY) / oldL) * nextL,
      }));

      setGeometry(prev => ({ ...prev, points:scaled }));
      setParams(p => ({
        ...p,
        width:Number(nextW.toFixed(3)),
        length:Number(nextL.toFixed(3)),
      }));
    }
  };

  const updateFixtureEngineering = (key, value) => {
    if(selectedFixture === null) return;
    setFixtures(prev => prev.map((f,i) => {
      if(i !== selectedFixture) return f;
      const currentEngineering = f.engineering || getDefaultEngineering(f.type);
      return {
        ...f,
        engineering:{
          ...currentEngineering,
          [key]: value,
        }
      };
    }));
  };

  const sf = selectedFixture !== null ? fixtures[selectedFixture] : null;
  const ft = sf ? FIXTURE_TYPES.find(t => t.key === sf.type) : null;
  const sfEngineering = sf ? { ...getDefaultEngineering(sf.type), ...(sf.engineering || {}) } : null;
  const geometryMeta = getGeometryMeta();
  const totalNozzleFlow = fixtures.reduce((sum,f)=> f.type?.startsWith("nozzle") ? sum + Number((f.engineering || getDefaultEngineering(f.type)).flowLpm || 0) : sum, 0);
  const totalLightWattage = fixtures.reduce((sum,f)=> f.type?.startsWith("light") ? sum + Number((f.engineering || getDefaultEngineering(f.type)).wattage || 0) : sum, 0);

  const setNumericParam = (key, value, min, max) => {
    const n = Number(value);
    if(Number.isNaN(n)) return;
    setParams(p => ({ ...p, [key]: Math.max(min, Math.min(max, n)) }));
  };

  const safePoolTypes = Array.isArray(typeof POOL_TYPES !== "undefined" ? POOL_TYPES : null)
    ? POOL_TYPES
    : [
        { key:"rectangular", label:"Rectangular", icon:"▭" },
        { key:"circular", label:"Circular", icon:"○" },
        { key:"elliptical", label:"Elliptical", icon:"⬭" },
        { key:"lshape", label:"L-Shape", icon:"⌐" },
        { key:"freeform", label:"Freeform", icon:"~" },
        { key:"false_lake", label:"False Lake", icon:"≈" },
        { key:"false_river", label:"False River", icon:"~≈" },
      ];

  const safeDepthZones = Array.isArray(DEPTH_ZONES)
    ? DEPTH_ZONES
    : [
        { key:"shallow",  label:"Shallow",  depth:0.3, color:"#7ec8e3" },
        { key:"medium",   label:"Medium",   depth:0.8, color:"#0077b6" },
        { key:"deep",     label:"Deep",     depth:1.5, color:"#03045e" },
        { key:"display",  label:"Display",  depth:0.2, color:"#90e0ef" },
      ];

  return (
    <div style={{ display:"flex", height:"100%", background:"#040810", color:"#cce8ff", fontFamily:"monospace", fontSize:"11px", overflow:"hidden" }}>

      {/* Left toolbar */}
      <div style={{ width:220, flexShrink:0, borderRight:"1px solid #0a2030", display:"flex", flexDirection:"column", overflow:"auto" }}>

        {/* Header */}
        <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030", background:"#030608" }}>
          <div style={{ color:"#00ccaa", fontWeight:"bold", fontSize:12, marginBottom:4 }}>⬡ POOL GEOMETRY</div>
          <input value={projectName} onChange={e=>setProjectName(e.target.value)}
            style={{ width:"100%", padding:"3px 6px", background:"#0a1825", color:"#cce8ff", border:"1px solid #0a2535", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
        </div>

        {/* Pool type */}
        <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030" }}>
          <div style={{ color:"#556677", fontSize:9, marginBottom:5 }}>POOL TYPE</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:3 }}>
            {safePoolTypes.map(t => (
              <button key={t.key} onClick={()=>setPoolType(t.key)} style={{
                padding:"5px 6px",
                background: poolType===t.key
                  ? "linear-gradient(135deg,#00402a,#002818)"
                  : "#0a1825",
                color: poolType===t.key ? "#7fffd4" : "#556677",
                border:`1px solid ${poolType===t.key ? "#00ffcc" : "#0a2030"}`,
                borderRadius:4,
                cursor:"pointer",
                fontFamily:"monospace",
                fontSize:9,
                textAlign:"left",
                fontWeight: poolType===t.key ? 800 : 400,
                boxShadow: poolType===t.key
                  ? "0 0 0 1px rgba(0,255,204,0.35), 0 0 14px rgba(0,255,204,0.18)"
                  : "none",
              }}>{poolType===t.key ? "●" : t.icon} {t.label}</button>
            ))}
          </div>
        </div>

        {/* Dimensions */}
        <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030" }}>
          <div style={{ color:"#556677", fontSize:9, marginBottom:5 }}>DIMENSIONS</div>
          {poolType !== "circular" && (
            <>
              {[["Width (m)","width",1,100],["Length (m)","length",1,200]].map(([label,key,min,max]) => (
                <div key={key} style={{ marginBottom:6 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                    <span style={{ color:"#7ab", fontSize:9 }}>{label}</span>
                    <span style={{ color:"#00ccaa", fontSize:9 }}>{params[key]}m</span>
                  </div>
                  <input type="range" min={min} max={max} step="0.5" value={params[key]}
                    onChange={e=>setParams(p=>({...p,[key]:parseFloat(e.target.value)}))}
                    style={{ width:"100%" }} />
                  <input type="number" min={min} max={max} step="0.001" value={params[key]}
                    onChange={e=>setNumericParam(key, e.target.value, min, max)}
                    style={{ width:"100%", marginTop:3, padding:"3px 5px", background:"#06121c", color:"#00ccaa", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
                </div>
              ))}
            </>
          )}
          {(poolType === "circular" || poolType === "false_lake") && (
            <div style={{ marginBottom:6 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                <span style={{ color:"#7ab", fontSize:9 }}>Radius (m)</span>
                <span style={{ color:"#00ccaa", fontSize:9 }}>{params.radius}m</span>
              </div>
              <input type="range" min="1" max="50" step="0.5" value={params.radius}
                onChange={e=>setParams(p=>({...p,radius:parseFloat(e.target.value)}))}
                style={{ width:"100%" }} />
              <input type="number" min="1" max="50" step="0.001" value={params.radius}
                onChange={e=>setNumericParam("radius", e.target.value, 1, 50)}
                style={{ width:"100%", marginTop:3, padding:"3px 5px", background:"#06121c", color:"#00ccaa", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
            </div>
          )}
          <div style={{ marginBottom:4 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
              <span style={{ color:"#7ab", fontSize:9 }}>Design depth (m)</span>
              <span style={{ color:"#00ccaa", fontSize:9 }}>{params.depth}m</span>
            </div>
            <input type="range" min="0.1" max="3" step="0.05" value={params.depth}
              onChange={e=>setParams(p=>({...p,depth:parseFloat(e.target.value)}))}
              style={{ width:"100%" }} />
            <input type="number" min="0.1" max="3" step="0.001" value={params.depth}
              onChange={e=>setNumericParam("depth", e.target.value, 0.1, 3)}
              style={{ width:"100%", marginTop:3, padding:"3px 5px", background:"#06121c", color:"#00ccaa", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
          </div>
          <div style={{ marginTop:6, padding:"4px 5px", background:"#06121c", border:"1px solid #0a3040", borderRadius:3, color:"#ffcc00", fontSize:9 }}>
            Drawing annotations: {showDimensions ? "ON" : "OFF"} · Toggle with DIM
          </div>

          {/* Computed stats */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:3, marginTop:6 }}>
            {[
              ["Surface area", poolType==="circular" ? `${(Math.PI*params.radius**2).toFixed(1)}m²` : `${(params.width*params.length).toFixed(1)}m²`],
              ["Volume", poolType==="circular" ? `${(Math.PI*params.radius**2*params.depth).toFixed(1)}m³` : `${(params.width*params.length*params.depth).toFixed(1)}m³`],
              ["Perimeter", poolType==="circular" ? `${(2*Math.PI*params.radius).toFixed(1)}m` : `${(2*(params.width+params.length)).toFixed(1)}m`],
              ["Capacity", poolType==="circular" ? `${(Math.PI*params.radius**2*params.depth*1000).toFixed(0)}L` : `${(params.width*params.length*params.depth*1000).toFixed(0)}L`],
            ].map(([k,v]) => (
              <div key={k} style={{ padding:"3px 5px", background:"#0a1520", borderRadius:3 }}>
                <div style={{ fontSize:8, color:"#334455" }}>{k}</div>
                <div style={{ fontSize:10, color:"#00ccaa", fontWeight:"bold" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tool selection */}
        <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030" }}>
          <div style={{ color:"#556677", fontSize:9, marginBottom:5 }}>TOOLS</div>
          <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
            {TOOLS.map(t => (
              <button key={t.key} onClick={()=>{ setTool(t.key); cancelDrawing(); }} style={{
                padding:"4px 7px", background: tool===t.key?"#003020":"#0a1825",
                color: tool===t.key?"#00ccaa":"#556677",
                border:`1px solid ${tool===t.key?"#00aa4444":"#0a2030"}`,
                borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:9,
                textTransform:"none",
              }}>{t.icon} {t.label}</button>
            ))}
          </div>
          {tool==="pipe" && (
          <div style={{ marginTop:6, padding:"6px", background:"#050d14", border:"1px solid #0a3040", borderRadius:4 }}>
            <div style={{ color:"#8b5cf6", fontSize:9, fontWeight:"bold", marginBottom:5 }}>PIPE SETTINGS</div>
            <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Diameter (DN)</div>
            <select value={pipeDiameter} onChange={e=>setPipeDiameter(parseInt(e.target.value))}
              style={{ width:"100%", padding:"3px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:9, fontFamily:"monospace", marginBottom:5 }}>
              {[20,25,32,40,50,65,80,100,125,150].map(dn=>(
                <option key={dn} value={dn}>DN{dn}</option>
              ))}
            </select>
            <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Pipe Type</div>
            <select value={pipeType} onChange={e=>setPipeType(e.target.value)}
              style={{ width:"100%", padding:"3px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:9, fontFamily:"monospace", marginBottom:5 }}>
              <option value="supply">Supply</option>
              <option value="return_">Return/Overflow</option>
              <option value="drain">Drain</option>
              <option value="chemical">Chemical</option>
              <option value="air">Compressed Air</option>
            </select>
<div style={{ marginTop: 6 }}>
  <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>
    Draw Mode
  </div>

  <div style={{
    display:"grid",
    gridTemplateColumns:"1fr 1fr",
    gap:3,
    marginBottom:5
  }}>
    {["straight","polyline","curve","arc"].map(mode => (
      <button
        key={mode}
        onClick={()=>setPipeDrawMode(mode)}
        style={{
          padding:"3px",
          background: pipeDrawMode===mode ? "#006644" : "#0a1825",
          color: pipeDrawMode===mode ? "#00ffaa" : "#556677",
          border:"1px solid #0a3040",
          borderRadius:3,
          cursor:"pointer",
          fontSize:8,
          fontFamily:"monospace"
        }}
      >
        {mode}
      </button>
    ))}
  </div>
</div>
            <button onClick={()=>setOrthogonalMode(v=>!v)} style={{ width:"100%", padding:"4px", background:orthogonalMode?"#002030":"#0a1825", color:orthogonalMode?"#00ccaa":"#556677", border:`1px solid ${orthogonalMode?"#00aa4444":"#0a2030"}`, borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"monospace", marginBottom:5 }}>
              {orthogonalMode ? "⊢ ORTHO ON" : "⊢ ORTHO OFF"}
            </button>
            <div style={{ color:"#556677", fontSize:8, lineHeight:1.5 }}>Click to add points · Double-click to finish · ESC to cancel</div>
            {pipeSystem.drawing && (
              <button onClick={cancelPipeDrawing} style={{ width:"100%", marginTop:4, padding:"3px", background:"#1a0808", color:"#ff8888", border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontSize:9 }}>
                Cancel Drawing ({pipeSystem.drawing.points.length} pts)
              </button>
            )}
          </div>
        )}
        {tool==="polyline" && (
            <div style={{ marginTop:6 }}>
              <button onClick={finishPolyline} disabled={polylinePoints.length < 3} style={{ width:"100%", padding:"4px", background:polylinePoints.length>=3?"#002030":"#081018", color:polylinePoints.length>=3?"#00ccaa":"#334455", border:"1px solid #00aa4444", borderRadius:3, cursor:"pointer", fontSize:9 }}>
                ✓ Close Polyline ({polylinePoints.length} pts)
              </button>
              <button onClick={cancelDrawing} style={{ width:"100%", marginTop:4, padding:"3px", background:"#1a0808", color:"#ff8888", border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontSize:9 }}>
                Cancel Drawing
              </button>
            </div>
          )}
          {(tool==="rectangle" || tool==="circle") && drawStart && (
            <button onClick={cancelDrawing} style={{ width:"100%", marginTop:6, padding:"3px", background:"#1a0808", color:"#ff8888", border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontSize:9 }}>
              Cancel Drawing
            </button>
          )}
          {tool==="measure" && measureStart && (
            <div style={{ color:"#ffcc00", fontSize:9, marginTop:4 }}>Click to set end point</div>
          )}
          {measurements.length > 0 && (
            <button onClick={clearMeasurements} style={{ width:"100%", marginTop:4, padding:"3px", background:"#1a0808", color:"#ff4444", border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontSize:9 }}>
              ✕ Clear measurements
            </button>
          )}
        </div>

        {/* Fixture type picker */}
        <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030" }}>
          <div style={{ color:"#556677", fontSize:9, marginBottom:5 }}>FIXTURE TYPE</div>
          {getToolFixtureTypes(tool).map(ft => (
  <button
    key={ft.key}
    onClick={() => {
      setFixtureType(ft.key);
    }}
    style={{
      display:"flex",
      alignItems:"center",
      gap:6,
      width:"100%",
      padding:"4px 6px",
      marginBottom:2,
      background: fixtureType===ft.key ? "#002030" : "#0a1825",
      color: fixtureType===ft.key ? ft.color : "#556677",
      border:`1px solid ${fixtureType===ft.key ? ft.color+"44" : "#0a2030"}`,
      borderRadius:3,
      cursor:"pointer",
      fontFamily:"monospace",
      fontSize:10,
      textAlign:"left",
    }}
  >
    <span style={{ color:ft.color }}>{ft.icon}</span>
    {ft.label}
  </button>
))}
          <button onClick={autoPlaceNozzles} style={{ width:"100%", marginTop:6, padding:"5px", background:"#001530", color:"#00aaff", border:"1px solid #00aaff44", borderRadius:3, cursor:"pointer", fontSize:9 }}>
            ⬡ AUTO-PLACE NOZZLES
          </button>

          <div style={{ marginTop:8, padding:"6px", background:"#050d14", border:"1px solid #0a3040", borderRadius:4 }}>
            <div style={{ color:"#ffcc00", fontSize:9, fontWeight:"bold", marginBottom:5 }}>ARRAY PLACEMENT</div>

            <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Array Type</div>
            <select value={arrayMode} onChange={e=>setArrayMode(e.target.value)}
              style={{ width:"100%", padding:"3px", background:"#06121c", color:"#cce8ff", border:"1px solid #0a3040", borderRadius:3, fontSize:9, fontFamily:"monospace", marginBottom:5 }}>
              <option value="centerline">Centerline</option>
              <option value="ring">Ring</option>
              <option value="grid">Grid</option>
            </select>

            {arrayMode !== "grid" && (
              <div style={{ marginBottom:5 }}>
                <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Count</div>
                <input type="number" min="1" max="200" step="1" value={arrayCount}
                  onChange={e=>setArrayCount(parseInt(e.target.value || 1))}
                  style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
              </div>
            )}

            {arrayMode === "grid" && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:5 }}>
                <div>
                  <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Rows</div>
                  <input type="number" min="1" max="50" step="1" value={arrayRows}
                    onChange={e=>setArrayRows(parseInt(e.target.value || 1))}
                    style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
                </div>
                <div>
                  <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Columns</div>
                  <input type="number" min="1" max="50" step="1" value={arrayCols}
                    onChange={e=>setArrayCols(parseInt(e.target.value || 1))}
                    style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
                </div>
              </div>
            )}

            <div style={{ marginBottom:6 }}>
              <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Inset from Edge (m)</div>
              <input type="number" min="0" max="50" step="0.1" value={arrayInset}
                onChange={e=>setArrayInset(parseFloat(e.target.value || 0))}
                style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
            </div>

            <button onClick={applyFixtureArray}
              style={{ width:"100%", padding:"5px", background:"#002030", color:"#00ccaa", border:"1px solid #00aa8844", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>
              APPLY ARRAY
            </button>
          </div>
        </div>

        {/* Selected pool properties */}
        {selectedObject === "pool" && geometryMeta && (
          <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030", background:"#050d14" }}>
            <div style={{ color:"#ffcc00", fontSize:9, marginBottom:6, fontWeight:"bold" }}>
              ▭ SELECTED POOL PROPERTIES
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:6 }}>
              <div>
                <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>X Origin (m)</div>
                <input type="number" step="0.001" value={geometryMeta.x.toFixed(3)}
                  onChange={e=>setGeometryProperty("x", e.target.value)}
                  style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
              </div>
              <div>
                <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Y Origin (m)</div>
                <input type="number" step="0.001" value={geometryMeta.y.toFixed(3)}
                  onChange={e=>setGeometryProperty("y", e.target.value)}
                  style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
              </div>
            </div>

            {geometryMeta.kind === "circle" ? (
              <div style={{ marginBottom:6 }}>
                <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Radius (m)</div>
                <input type="number" step="0.001" value={geometryMeta.radius.toFixed(3)}
                  onChange={e=>setGeometryProperty("radius", e.target.value)}
                  style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:6 }}>
                <div>
                  <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Width (m)</div>
                  <input type="number" step="0.001" value={geometryMeta.width.toFixed(3)}
                    onChange={e=>setGeometryProperty("width", e.target.value)}
                    style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
                </div>
                <div>
                  <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Length (m)</div>
                  <input type="number" step="0.001" value={geometryMeta.length.toFixed(3)}
                    onChange={e=>setGeometryProperty("length", e.target.value)}
                    style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
                </div>
              </div>
            )}

            <div style={{ marginBottom:6 }}>
              <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Design Depth (m)</div>
              <input type="number" step="0.001" value={Number(params.depth || 0).toFixed(3)}
                onChange={e=>setGeometryProperty("depth", e.target.value)}
                style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
            </div>
          </div>
        )}

        {/* Selected fixture properties */}
        {sf && ft && (
          <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030" }}>
            <div style={{ color:ft.color, fontSize:9, marginBottom:5, fontWeight:"bold" }}>
              {ft.icon} {sf.label}
            </div>
            {[["X pos (m)","x"],["Y pos (m)","y"],["Rotation (°)","rotation"]].map(([label,key]) => (
              <div key={key} style={{ marginBottom:5 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                  <span style={{ color:"#7ab", fontSize:9 }}>{label}</span>
                  <span style={{ color:ft.color, fontSize:9 }}>{(sf[key]||0).toFixed(1)}</span>
                </div>
                <input type="range"
                  min={key==="rotation"?0:-(Math.max(params.width,params.length,params.radius||0)+2)}
                  max={key==="rotation"?360:(Math.max(params.width,params.length,params.radius||0)+2)}
                  step={key==="rotation"?5:0.1} value={sf[key]||0}
                  onChange={e=>setFixtures(prev=>prev.map((f,i)=>i===selectedFixture?{...f,[key]:parseFloat(e.target.value)}:f))}
                  style={{ width:"100%" }} />
              </div>
            ))}
            {sfEngineering && (
              <div style={{ margin:"8px 0", padding:"7px", background:"#050d14", border:"1px solid #0a3040", borderRadius:4 }}>
                <div style={{ color:"#ffcc00", fontSize:9, fontWeight:"bold", marginBottom:6 }}>
                  ⚙ ENGINEERING DATA
                </div>

                {sf.type?.startsWith("nozzle") && (
                  <>
                    {[
                      ["Flow (LPM)", "flowLpm", 0, 5000, 1],
                      ["Pressure (bar)", "pressureBar", 0, 30, 0.1],
                      ["Jet Height (m)", "jetHeightM", 0, 100, 0.1],
                      ["Nozzle Dia. (mm)", "nozzleDiaMm", 1, 500, 1],
                      ["Spray Angle (°)", "sprayAngleDeg", 0, 180, 1],
                    ].map(([label,key,min,max,step]) => (
                      <div key={key} style={{ marginBottom:5 }}>
                        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>{label}</div>
                        <input type="number" min={min} max={max} step={step} value={sfEngineering[key] ?? 0}
                          onChange={e=>updateFixtureEngineering(key, parseFloat(e.target.value || 0))}
                          style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
                      </div>
                    ))}

                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
                      <div>
                        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>PLC Channel</div>
                        <input value={sfEngineering.plcChannel || ""}
                          onChange={e=>updateFixtureEngineering("plcChannel", e.target.value)}
                          style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
                      </div>
                      <div>
                        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Group</div>
                        <input value={sfEngineering.group || ""}
                          onChange={e=>updateFixtureEngineering("group", e.target.value)}
                          style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
                      </div>
                    </div>
                  </>
                )}

                {sf.type?.startsWith("light") && (
                  <>
                    {[
                      ["Wattage (W)", "wattage", 0, 5000, 1],
                      ["Voltage (V)", "voltage", 0, 1000, 1],
                      ["Current (A)", "currentA", 0, 100, 0.1],
                      ["Beam Angle (°)", "beamAngleDeg", 0, 180, 1],
                      ["DMX Universe", "dmxUniverse", 1, 32, 1],
                      ["DMX Address", "dmxAddress", 1, 512, 1],
                    ].map(([label,key,min,max,step]) => (
                      <div key={key} style={{ marginBottom:5 }}>
                        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>{label}</div>
                        <input type="number" min={min} max={max} step={step} value={sfEngineering[key] ?? 0}
                          onChange={e=>updateFixtureEngineering(key, parseFloat(e.target.value || 0))}
                          style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
                      </div>
                    ))}

                    <div>
                      <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Group</div>
                      <input value={sfEngineering.group || ""}
                        onChange={e=>updateFixtureEngineering("group", e.target.value)}
                        style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
                    </div>
                  </>
                )}
{sf.type?.startsWith("pump") && (
  <>
    {[
      ["Flow (m³/hr)", "flowM3Hr", 0, 5000, 1],
      ["Head (m)", "headM", 0, 200, 0.1],
      ["Power (kW)", "powerKw", 0, 1000, 0.1],
      ["Voltage (V)", "voltage", 0, 1000, 1],
      ["Efficiency (%)", "efficiency", 0, 100, 1],
    ].map(([label,key,min,max,step]) => (
      <div key={key} style={{ marginBottom:5 }}>
        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>{label}</div>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={sfEngineering[key] ?? 0}
          onChange={e=>updateFixtureEngineering(key, parseFloat(e.target.value || 0))}
          style={{
            width:"100%",
            padding:"3px 5px",
            background:"#06121c",
            color:"#00ffaa",
            border:"1px solid #0a3040",
            borderRadius:3,
            fontSize:10,
            fontFamily:"monospace"
          }}
        />
      </div>
    ))}
  </>
)}
{(sf.type?.startsWith("valve") || sf.type?.startsWith("solenoid")) && (
  <>
    {[
      ["Diameter (DN)", "diameterMm", 0, 1000, 1],
      ["Flow Capacity (m³/hr)", "flowM3Hr", 0, 5000, 1],
      ["Pressure Rating (bar)", "pressureBar", 0, 100, 0.1],
      ["Voltage (V)", "voltage", 0, 1000, 1],
      ["Power (W)", "wattage", 0, 5000, 1],
      ["Response Time (ms)", "responseMs", 0, 10000, 10],
    ].map(([label,key,min,max,step]) => (
      <div key={key} style={{ marginBottom:5 }}>
        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>{label}</div>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={sfEngineering[key] ?? 0}
          onChange={e=>updateFixtureEngineering(key, parseFloat(e.target.value || 0))}
          style={{
            width:"100%",
            padding:"3px 5px",
            background:"#06121c",
            color:"#00ffaa",
            border:"1px solid #0a3040",
            borderRadius:3,
            fontSize:10,
            fontFamily:"monospace"
          }}
        />
      </div>
    ))}

    <div>
      <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Control Channel</div>
      <input
        value={sfEngineering.controlChannel || ""}
        onChange={e=>updateFixtureEngineering("controlChannel", e.target.value)}
        style={{
          width:"100%",
          padding:"3px 5px",
          background:"#06121c",
          color:"#ffcc00",
          border:"1px solid #0a3040",
          borderRadius:3,
          fontSize:10,
          fontFamily:"monospace"
        }}
      />
    </div>
  </>
)}
{(sf.type?.startsWith("air") || sf.type?.includes("compressor")) && (
  <>
    {[
      ["Air Flow (L/min)", "airFlowLpm", 0, 50000, 1],
      ["Pressure (bar)", "pressureBar", 0, 50, 0.1],
      ["Tank Volume (L)", "tankVolumeL", 0, 10000, 1],
      ["Power (kW)", "powerKw", 0, 1000, 0.1],
      ["Voltage (V)", "voltage", 0, 1000, 1],
      ["Noise Level (dB)", "noiseDb", 0, 150, 1],
    ].map(([label,key,min,max,step]) => (
      <div key={key} style={{ marginBottom:5 }}>
        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>{label}</div>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={sfEngineering[key] ?? 0}
          onChange={e=>updateFixtureEngineering(key, parseFloat(e.target.value || 0))}
          style={{
            width:"100%",
            padding:"3px 5px",
            background:"#06121c",
            color:"#00ffaa",
            border:"1px solid #0a3040",
            borderRadius:3,
            fontSize:10,
            fontFamily:"monospace"
          }}
        />
      </div>
    ))}

    <div>
      <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Air Line / Zone</div>
      <input
        value={sfEngineering.airZone || ""}
        onChange={e=>updateFixtureEngineering("airZone", e.target.value)}
        style={{
          width:"100%",
          padding:"3px 5px",
          background:"#06121c",
          color:"#ffcc00",
          border:"1px solid #0a3040",
          borderRadius:3,
          fontSize:10,
          fontFamily:"monospace"
        }}
      />
    </div>
  </>
)}
{(sf.type?.startsWith("fuel") || sf.type?.startsWith("flame") || sf.type?.includes("fire")) && (
  <>
    {[
      ["Fuel Flow", "gasFlow", 0, 10000, 0.1],
      ["Tank Capacity (L)", "tankVolumeL", 0, 50000, 1],
      ["Operating Pressure (bar)", "pressureBar", 0, 50, 0.1],
      ["Ignition Power (W)", "wattage", 0, 5000, 1],
      ["Voltage (V)", "voltage", 0, 1000, 1],
      ["Flame Height (m)", "flameHeightM", 0, 30, 0.1],
    ].map(([label,key,min,max,step]) => (
      <div key={key} style={{ marginBottom:5 }}>
        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>{label}</div>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={sfEngineering[key] ?? 0}
          onChange={e=>updateFixtureEngineering(key, parseFloat(e.target.value || 0))}
          style={{
            width:"100%",
            padding:"3px 5px",
            background:"#06121c",
            color:"#ff8844",
            border:"1px solid #0a3040",
            borderRadius:3,
            fontSize:10,
            fontFamily:"monospace"
          }}
        />
      </div>
    ))}

    <div>
      <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Safety Interlock / Zone</div>
      <input
        value={sfEngineering.safetyZone || ""}
        onChange={e=>updateFixtureEngineering("safetyZone", e.target.value)}
        style={{
          width:"100%",
          padding:"3px 5px",
          background:"#06121c",
          color:"#ffcc00",
          border:"1px solid #0a3040",
          borderRadius:3,
          fontSize:10,
          fontFamily:"monospace"
        }}
      />
    </div>
  </>
)}
{(sf.type?.startsWith("motion") || sf.type?.includes("1d") || sf.type?.includes("2d") || sf.type?.includes("3d")) && (
  <>
    {[
      ["Axis Count", "axisCount", 0, 3, 1],
      ["Pan Range (°)", "panRangeDeg", 0, 360, 1],
      ["Tilt Range (°)", "tiltRangeDeg", 0, 180, 1],
      ["Speed (°/s)", "speedDegPerSec", 0, 1000, 1],
      ["Torque (Nm)", "torqueNm", 0, 10000, 0.1],
      ["Power (W)", "wattage", 0, 5000, 1],
      ["Voltage (V)", "voltage", 0, 1000, 1],
    ].map(([label,key,min,max,step]) => (
      <div key={key} style={{ marginBottom:5 }}>
        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>{label}</div>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={sfEngineering[key] ?? 0}
          onChange={e=>updateFixtureEngineering(key, parseFloat(e.target.value || 0))}
          style={{
            width:"100%",
            padding:"3px 5px",
            background:"#06121c",
            color:"#00ffaa",
            border:"1px solid #0a3040",
            borderRadius:3,
            fontSize:10,
            fontFamily:"monospace"
          }}
        />
      </div>
    ))}

    <div>
      <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Motion Control Channel</div>
      <input
        value={sfEngineering.motionChannel || ""}
        onChange={e=>updateFixtureEngineering("motionChannel", e.target.value)}
        style={{
          width:"100%",
          padding:"3px 5px",
          background:"#06121c",
          color:"#ffcc00",
          border:"1px solid #0a3040",
          borderRadius:3,
          fontSize:10,
          fontFamily:"monospace"
        }}
      />
    </div>
  </>
)}
{(sf.type?.startsWith("sensor") || sf.type?.startsWith("safety")) && (
  <>
    {[
      ["Digital Inputs", "digitalInputs", 0, 64, 1],
      ["Digital Outputs", "digitalOutputs", 0, 64, 1],
      ["Analog Inputs", "analogInputs", 0, 64, 1],
      ["Analog Outputs", "analogOutputs", 0, 64, 1],
      ["Voltage (V)", "voltage", 0, 1000, 1],
      ["Current (A)", "currentA", 0, 100, 0.1],
    ].map(([label,key,min,max,step]) => (
      <div key={key} style={{ marginBottom:5 }}>
        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>{label}</div>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={sfEngineering[key] ?? 0}
          onChange={e=>updateFixtureEngineering(key, parseFloat(e.target.value || 0))}
          style={{
            width:"100%",
            padding:"3px 5px",
            background:"#06121c",
            color:"#00ffaa",
            border:"1px solid #0a3040",
            borderRadius:3,
            fontSize:10,
            fontFamily:"monospace"
          }}
        />
      </div>
    ))}

    <div>
      <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Signal Type</div>
      <input
        value={sfEngineering.signalType || ""}
        onChange={e=>updateFixtureEngineering("signalType", e.target.value)}
        placeholder="Digital Input / 4-20mA / Analog"
        style={{
          width:"100%",
          padding:"3px 5px",
          background:"#06121c",
          color:"#ffcc00",
          border:"1px solid #0a3040",
          borderRadius:3,
          fontSize:10,
          fontFamily:"monospace"
        }}
      />
    </div>
  </>
)}
{(
  sf.type?.startsWith("control") ||
  sf.type?.startsWith("power") ||
  sf.type?.startsWith("vfd") ||
  sf.type?.includes("plc") ||
  sf.type?.includes("dmx")
) && (
  <>
    {[
      ["Rated Power (W)", "wattage", 0, 100000, 1],
      ["Output Power (W)", "outputPowerW", 0, 100000, 1],
      ["Voltage (V)", "voltage", 0, 1000, 1],
      ["Current (A)", "currentA", 0, 1000, 0.1],
      ["DMX Channels", "dmxChannels", 0, 512, 1],
      ["Digital Inputs", "digitalInputs", 0, 256, 1],
      ["Digital Outputs", "digitalOutputs", 0, 256, 1],
      ["Analog Inputs", "analogInputs", 0, 256, 1],
      ["Analog Outputs", "analogOutputs", 0, 256, 1],
    ].map(([label,key,min,max,step]) => (
      <div key={key} style={{ marginBottom:5 }}>
        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>{label}</div>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={sfEngineering[key] ?? 0}
          onChange={e=>updateFixtureEngineering(key, parseFloat(e.target.value || 0))}
          style={{
            width:"100%",
            padding:"3px 5px",
            background:"#06121c",
            color:"#00ffaa",
            border:"1px solid #0a3040",
            borderRadius:3,
            fontSize:10,
            fontFamily:"monospace"
          }}
        />
      </div>
    ))}

    <div>
      <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Protocol / Cabinet Reference</div>
      <input
        value={sfEngineering.protocol || sfEngineering.cabinetRef || ""}
        onChange={e=>updateFixtureEngineering("protocol", e.target.value)}
        placeholder="DMX / Modbus / PLC / VFD Panel"
        style={{
          width:"100%",
          padding:"3px 5px",
          background:"#06121c",
          color:"#ffcc00",
          border:"1px solid #0a3040",
          borderRadius:3,
          fontSize:10,
          fontFamily:"monospace"
        }}
      />
    </div>
  </>
)}
{(
  sf.type?.startsWith("filter") ||
  sf.type?.startsWith("uv") ||
  sf.type?.startsWith("dosing")
) && (
  <>
    {[
      ["Flow Capacity (m³/hr)", "flowM3Hr", 0, 5000, 1],
      ["Pressure Rating (bar)", "pressureBar", 0, 100, 0.1],
      ["Power (W)", "wattage", 0, 50000, 1],
      ["Voltage (V)", "voltage", 0, 1000, 1],
      ["Dosing Rate (L/hr)", "dosingRateLHr", 0, 10000, 0.1],
      ["UV Dose", "uvDose", 0, 10000, 1],
    ].map(([label,key,min,max,step]) => (
      <div key={key} style={{ marginBottom:5 }}>
        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>{label}</div>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={sfEngineering[key] ?? 0}
          onChange={e=>updateFixtureEngineering(key, parseFloat(e.target.value || 0))}
          style={{
            width:"100%",
            padding:"3px 5px",
            background:"#06121c",
            color:"#00ffaa",
            border:"1px solid #0a3040",
            borderRadius:3,
            fontSize:10,
            fontFamily:"monospace"
          }}
        />
      </div>
    ))}

    <div>
      <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Media / Chemical / Lamp Type</div>
      <input
        value={sfEngineering.mediaType || sfEngineering.chemicalType || sfEngineering.lampType || ""}
        onChange={e=>updateFixtureEngineering("mediaType", e.target.value)}
        placeholder="Sand / Cartridge / Chlorine / UV-C"
        style={{
          width:"100%",
          padding:"3px 5px",
          background:"#06121c",
          color:"#ffcc00",
          border:"1px solid #0a3040",
          borderRadius:3,
          fontSize:10,
          fontFamily:"monospace"
        }}
      />
    </div>
  </>
)}
{!(
  sf.type?.startsWith("nozzle") ||
  sf.type?.startsWith("light") ||
  sf.type?.startsWith("pump") ||
  sf.type?.startsWith("valve") ||
  sf.type?.startsWith("solenoid") ||
  sf.type?.startsWith("air") ||
  sf.type?.startsWith("fuel") ||
  sf.type?.startsWith("flame") ||
  sf.type?.startsWith("motion") ||
  sf.type?.startsWith("sensor") ||
  sf.type?.startsWith("safety") ||
  sf.type?.startsWith("control") ||
  sf.type?.startsWith("power") ||
  sf.type?.startsWith("vfd") ||
  sf.type?.startsWith("filter") ||
  sf.type?.startsWith("uv") ||
  sf.type?.startsWith("dosing") ||
  sf.type?.includes("compressor") ||
  sf.type?.includes("fire") ||
  sf.type?.includes("1d") ||
  sf.type?.includes("2d") ||
  sf.type?.includes("3d") ||
  sf.type?.includes("plc") ||
  sf.type?.includes("dmx")
) && (
  <>
    <div style={{ color:"#7ab", fontSize:8, marginBottom:4 }}>
      Generic Equipment Properties
    </div>

    {[
      ["Flow (L/min)", "flowLpm", 0, 50000, 1],
      ["Flow (m³/hr)", "flowM3Hr", 0, 5000, 1],
      ["Power (W)", "wattage", 0, 100000, 1],
      ["Power (kW)", "powerKw", 0, 1000, 0.1],
      ["Voltage (V)", "voltage", 0, 1000, 1],
      ["Pressure (bar)", "pressureBar", 0, 100, 0.1],
    ].map(([label,key,min,max,step]) => (
      <div key={key} style={{ marginBottom:5 }}>
        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>{label}</div>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={sfEngineering[key] ?? 0}
          onChange={e=>updateFixtureEngineering(key, parseFloat(e.target.value || 0))}
          style={{
            width:"100%",
            padding:"3px 5px",
            background:"#06121c",
            color:"#00ffaa",
            border:"1px solid #0a3040",
            borderRadius:3,
            fontSize:10,
            fontFamily:"monospace"
          }}
        />
      </div>
    ))}
  </>
)}
              </div>
            )}

            <div style={{ marginBottom:5 }}>
              <div style={{ color:"#7ab", fontSize:9, marginBottom:2 }}>Depth zone</div>
              <select value={sf.zone||"medium"} onChange={e=>setFixtures(prev=>prev.map((f,i)=>i===selectedFixture?{...f,zone:e.target.value}:f))}
                style={{ width:"100%", padding:"3px", background:"#0a1825", color:"#cce8ff", border:"1px solid #0a2535", borderRadius:3, fontSize:9, fontFamily:"monospace" }}>
                 {safeDepthZones.map(z=><option key={z.key} value={z.key}>{z.label} ({z.depth}m)</option>)}
              </select>
            </div>
            <button onClick={()=>{ setFixtures(prev=>prev.filter((_,i)=>i!==selectedFixture)); setSelectedFixture(null); }}
              style={{ width:"100%", padding:"4px", background:"#1a0808", color:"#ff4444", border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontSize:9 }}>
              ✕ Delete fixture
            </button>
          </div>
        )}

        {activePipeForPanel && (
  <PipePropertiesPanel
    pipe={activePipeForPanel}
    selectedNode={selectedNode}
    selectedSegment={selectedSegment}
    onUpdatePipe={updatePipeProperties}
    onUpdateDiameter={updatePipeDiameter}
    onUpdateType={updatePipeType}
    onDeletePipe={deleteSelectedPipe}
    onDeleteSegment={deleteSelectedSegment}
onInsertNodeAtPoint={insertNodeAtPoint}
onRemoveNode={removeNode}
  />
)}
        {/* Layers */}
        <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
            <div style={{ color:"#556677", fontSize:9 }}>LAYERS</div>
            <button onClick={()=>setShowLayerPanel(v=>!v)} style={{ background:"none", border:"none", color:"#7ab", cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>
              {showLayerPanel ? "HIDE" : "SHOW"}
            </button>
          </div>

          {showLayerPanel && layers.map(layer => (
            <div key={layer.key} style={{ display:"grid", gridTemplateColumns:"18px 18px 12px 1fr", gap:4, alignItems:"center", padding:"3px 0", borderBottom:"1px solid rgba(10,32,48,0.35)" }}>
              <button onClick={()=>toggleLayerVisible(layer.key)} title="Show/Hide Layer" style={{ background:"#06121c", border:"1px solid #0a3040", borderRadius:3, color:layer.visible?"#00ccaa":"#334455", cursor:"pointer", fontSize:9 }}>
                {layer.visible ? "👁" : "–"}
              </button>
              <button onClick={()=>toggleLayerLocked(layer.key)} title="Lock/Unlock Layer" style={{ background:"#06121c", border:"1px solid #0a3040", borderRadius:3, color:layer.locked?"#ff4444":"#556677", cursor:"pointer", fontSize:9 }}>
                {layer.locked ? "🔒" : "○"}
              </button>
              <span style={{ width:10, height:10, borderRadius:2, background:layer.color, display:"inline-block" }} />
              <span style={{ color:layer.visible?"#7ab":"#334455", fontSize:9, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {layer.label}
              </span>
            </div>
          ))}
        </div>

        {/* Save */}
        <div style={{ padding:"8px 10px", marginTop:"auto" }}>
          <div style={{ fontSize:9, color:"#334455", marginBottom:4 }}>
            {fixtures.length} fixtures placed
<div style={{
  padding:"4px",
  background:"#06121c",
  border:"1px solid #0a3040",
  borderRadius:3,
  color:"#00ccaa",
  fontSize:9,
  marginBottom:6,
  fontFamily:"monospace",
  fontWeight:"bold"
}}>
  BOM ITEMS: {bomItems.length}
</div>
          </div>
{bomItems.length > 0 && (
  <div style={{
    background:"#041018",
    border:"1px solid #0a3040",
    borderRadius:3,
    marginBottom:6,
    padding:"4px",
    fontSize:8,
    fontFamily:"monospace"
  }}>
    {bomItems.map(item => (
      <div key={item.key} style={{
        display:"grid",
        gridTemplateColumns:"1fr 28px",
        gap:4,
        color:"#9bd",
        borderBottom:"1px solid #0a304044",
        padding:"2px 0"
      }}>
        <span>{item.label}</span>
        <span style={{ color:"#00ccaa", textAlign:"right" }}>{item.quantity}</span>
      </div>
    ))}
  </div>
)}
          <div style={{ padding:"6px", background:"#041018", border:"1px solid #0a3040", borderRadius:4, marginBottom:6 }}>
  <div style={{ color:"#ffcc00", fontSize:9, fontWeight:"bold", marginBottom:6 }}>
    ENGINEERING SUMMARY
  </div>

  {[
    ["Nozzle Flow", `${hydraulicSummary.totalNozzleFlowLpm.toFixed(1)} L/min`],
    ["Process Flow", `${hydraulicSummary.totalProcessFlowLpm.toFixed(1)} L/min`],
    ["Total Flow", `${hydraulicSummary.totalFlowM3Hr.toFixed(2)} m³/hr`],
    ["Recommended Pipe", `DN${hydraulicSummary.recommendedPipeMm}`],
    ["TDH", `${hydraulicSummary.totalDynamicHeadM.toFixed(1)} m`],
    ["Required Pump", `${hydraulicSummary.recommendedPumpKw.toFixed(2)} kW`],
    ["Installed Pump", `${hydraulicSummary.totalPumpPowerKw.toFixed(2)} kW`],
    ["Pump Capacity", `${hydraulicSummary.totalPumpCapacityM3Hr.toFixed(1)} m³/hr`],
    ["Pump Status", `${hydraulicSummary.pumpCapacityStatus} / ${hydraulicSummary.pumpPowerStatus}`],
    ["Electrical Load", `${hydraulicSummary.totalWatts.toFixed(0)} W`],
    ["Air Demand", `${hydraulicSummary.totalAirFlowLpm.toFixed(0)} L/min`],
    ["Fuel Demand", `${hydraulicSummary.totalFuelFlow.toFixed(2)}`],
    ["DMX Channels", `${hydraulicSummary.totalDmxChannels}`],
    ["Digital I/O", `${hydraulicSummary.totalDigitalInputs} IN / ${hydraulicSummary.totalDigitalOutputs} OUT`],
    ["Analog I/O", `${hydraulicSummary.totalAnalogInputs} IN / ${hydraulicSummary.totalAnalogOutputs} OUT`],
    ["Pipe Length", `${((pipework?.totalBranchLengthM || 0) + (pipework?.mainHeaderLengthM || 0)).toFixed(1)} m`],
  ].map(([k,v]) => (
    <div key={k} style={{
      display:"grid",
      gridTemplateColumns:"1fr 1fr",
      gap:4,
      padding:"3px 0",
      borderBottom:"1px solid #0a304044"
    }}>
      <span style={{ color:"#556677", fontSize:8 }}>{k}</span>
      <span style={{ color:"#00ccaa", fontSize:9, fontWeight:"bold", textAlign:"right" }}>{v}</span>
    </div>
  ))}
</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:5, marginBottom:6 }}>
            <button onClick={exportProjectJSON}
              style={{ padding:"5px", background:"#001a16", color:"#00ccaa", border:"1px solid #00aa8844", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>
              EXPORT JSON
            </button>
<button
  onClick={exportBOMCSV}
  style={{
    padding:"5px",
    background:"#102000",
    color:"#88ff88",
    border:"1px solid #44aa44",
    borderRadius:3,
    cursor:"pointer",
    fontSize:9,
    fontFamily:"monospace"
  }}
>
  EXPORT BOM
</button>
            <button onClick={exportProjectDXF}
              style={{ padding:"5px", background:"#001530", color:"#00aaff", border:"1px solid #00aaff44", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>
              EXPORT DXF
            </button>
          </div>
          {exportStatus && (
            <div style={{ color:"#00ccaa", fontSize:9, marginBottom:5 }}>{exportStatus}</div>
          )}

          <button onClick={saveProject} style={{ width:"100%", padding:"6px", background:"#003520", color:"#00ff88", border:"1px solid #00aa4444", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"monospace" }}>
            {saved ? "✓ SAVED" : "SAVE PROJECT"}
          </button>
        </div>
      </div>

      {/* Main canvas */}
      <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
            <div
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                zIndex: 20,
                display: "flex",
                gap: 8,
                alignItems: "center",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  background: "rgba(2,8,16,0.88)",
                  border: "1px solid rgba(0,255,204,0.45)",
                  color: "#7fffd4",
                  fontSize: 10,
                  fontFamily: "monospace",
                  fontWeight: 800,
                  boxShadow: "0 0 12px rgba(0,255,204,0.16)",
                }}
              >
                TOOL: {tool.toUpperCase()}
              </div>

              <div
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  background:
                    drawStart || polylinePoints.length > 0 || pipeSystem.drawing
                      ? "rgba(113,63,18,0.92)"
                      : "rgba(2,8,16,0.88)",
                  border:
                    drawStart || polylinePoints.length > 0 || pipeSystem.drawing
                      ? "1px solid rgba(245,158,11,0.75)"
                      : "1px solid rgba(148,163,184,0.28)",
                  color:
                    drawStart || polylinePoints.length > 0 || pipeSystem.drawing
                      ? "#fbbf24"
                      : "#94a3b8",
                  fontSize: 10,
                  fontFamily: "monospace",
                  fontWeight: 800,
                  boxShadow:
                    drawStart || polylinePoints.length > 0 || pipeSystem.drawing
                      ? "0 0 12px rgba(245,158,11,0.22)"
                      : "none",
                }}
              >
                DRAW: {drawStart || polylinePoints.length > 0 || pipeSystem.drawing ? "ACTIVE" : "IDLE"}
              </div>
            </div>
        <canvas
          ref={canvasRef}
          width={900} 
height={600} 
onContextMenu={onCanvasContextMenu}
          style={{
            width:"100%",
            height:"100%",
            cursor: isPanning || isDraggingGeometry ? "grabbing" : isSpaceDown ? "grab" : tool==="select" ? "default" : "crosshair",
            display:"block"
          }}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={onCanvasMouseUp}
          onWheel={onCanvasWheel}
          
          onDoubleClick={(e) => {
  const w = snapPoint(toWorld(e.clientX, e.clientY));

  if (tool === "pipe") {
    onPipeDoubleClick(w);
    return;
  }

  if (tool === "select" && selectedObject === "pipe") {
    insertNodeAtPoint(w);
    return;
  }

  fitView();
}}
        />
{pipeContextMenu && (
  <div
    style={{
      position:"fixed",
      left:pipeContextMenu.x,
      top:pipeContextMenu.y,
      background:"#050d14",
      border:"1px solid #0a3040",
      borderRadius:4,
      padding:4,
      zIndex:9999,
      minWidth:150,
      boxShadow:"0 4px 12px rgba(0,0,0,0.45)"
    }}
  >
    <button
      onClick={() => {
        insertNodeAtPoint(pipeContextMenu.world);
        setPipeContextMenu(null);
      }}
      style={{ width:"100%", padding:"5px", background:"#06121c", color:"#00ccaa", border:"1px solid #00ccaa44", cursor:"pointer", fontSize:9, marginBottom:3 }}
    >
      ＋ Insert Node
    </button>

    {selectedSegment && (
  <button
    onClick={() => {
      deleteSelectedSegment();
      setPipeContextMenu(null);
    }}
    style={{
      width:"100%",
      padding:"5px",
      background:"#1a0808",
      color:"#ff8888",
      border:"1px solid #ff444422",
      cursor:"pointer",
      fontSize:9,
      marginBottom:3
    }}
  >
    ✕ Delete Segment
  </button>
)}

    <button
      onClick={() => {
        deleteSelectedPipe();
        setPipeContextMenu(null);
      }}
      style={{ width:"100%", padding:"5px", background:"#1a0808", color:"#ff4444", border:"1px solid #ff444422", cursor:"pointer", fontSize:9, marginBottom:3 }}
    >
      ✕ Delete Pipe
    </button>

    <button
      onClick={() => {
        setSelectedPipeId(null);
        setSelectedNode(null);
        setSelectedSegment(null);
        setPipeContextMenu(null);
      }}
      style={{ width:"100%", padding:"5px", background:"#06121c", color:"#7ab", border:"1px solid #0a3040", cursor:"pointer", fontSize:9 }}
    >
      Clear Selection
    </button>
  </div>
)}

        {/* Top overlay toolbar */}
        <div style={{ position:"absolute", top:8, left:8, display:"flex", gap:5, background:"rgba(0,0,0,0.7)", border:"1px solid #0a2030", borderRadius:5, padding:"4px 8px", alignItems:"center" }}>
          <button onClick={()=>setZoom(z=>Math.min(100,z*1.2))} style={{ background:"none", border:"none", color:"#7ab", cursor:"pointer", fontSize:14, padding:"0 3px" }}>+</button>
          <span style={{ color:"#334455", fontSize:10, minWidth:40, textAlign:"center" }}>{Math.round(zoom)}px/m</span>
          <button onClick={()=>setZoom(z=>Math.max(10,z/1.2))} style={{ background:"none", border:"none", color:"#7ab", cursor:"pointer", fontSize:14, padding:"0 3px" }}>−</button>
          <div style={{ width:1, height:14, background:"#0a2030" }}/>
          <button onClick={resetView} style={{ background:"none", border:"none", color:"#7ab", cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>⌂ HOME</button>
          <button onClick={fitView} style={{ background:"none", border:"none", color:"#7ab", cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>FIT</button>
          <div style={{ width:1, height:14, background:"#0a2030" }}/>
          <button onClick={handleUndo} disabled={!undoStackRef.current.length} style={{ background:"none", border:"none", color: undoStackRef.current.length?"#00ccaa":"#334455", cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>↶ UNDO</button>
          <button onClick={handleRedo} disabled={!redoStackRef.current.length} style={{ background:"none", border:"none", color: redoStackRef.current.length?"#00ccaa":"#334455", cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>↷ REDO</button>
          <div style={{ width:1, height:14, background:"#0a2030" }}/>
          <button onClick={pushFixturesToDevices} disabled={!fixtures.length} style={{ background:"none", border:"none", color: fixtures.length?"#ffcc00":"#334455", cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>⇒ PUSH TO DEVICES</button>
          <div style={{ width:1, height:14, background:"#0a2030" }}/>
          <button onClick={()=>setShowGrid(g=>!g)} style={{ background:"none", border:"none", color: showGrid?"#00ccaa":"#334455", cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>GRID</button>
          <button onClick={()=>setSnapToGrid(s=>!s)} style={{ background:snapToGrid?"rgba(255,204,0,0.12)":"none", border:`1px solid ${snapToGrid ? "rgba(255,204,0,0.55)" : "transparent"}`, borderRadius:3, padding:"2px 6px", color: snapToGrid?"#ffcc00":"#334455", cursor:"pointer", fontSize:9, fontFamily:"monospace", fontWeight:snapToGrid?800:400 }}>SNAP {snapToGrid ? `${gridStep}m` : "OFF"}</button>
          <select value={gridStep} onChange={e=>setGridStep(parseFloat(e.target.value))} style={{ background:"#06121c", color:"#7ab", border:"1px solid #0a3040", borderRadius:3, fontSize:9, fontFamily:"monospace", height:18 }}>
            <option value={0.1}>0.10m</option>
            <option value={0.25}>0.25m</option>
            <option value={0.5}>0.50m</option>
            <option value={1}>1.00m</option>
          </select>
          <button onClick={()=>setShowDepth(d=>!d)} style={{ background:"none", border:"none", color: showDepth?"#00ccaa":"#334455", cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>DEPTH</button>
          <button onClick={()=>setShowDimensions(d=>!d)} style={{ background:"none", border:"none", color: showDimensions?"#ffcc00":"#334455", cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>DIM</button>
        </div>

        {/* Info overlay */}
        <div style={{ position:"absolute", bottom:8, left:8, background:"rgba(0,0,0,0.7)", border:"1px solid #0a2030", borderRadius:4, padding:"4px 8px", fontSize:9, color:"#334455" }}>
          {tool==="select" && "Drag blue corner grips to stretch · Drag pool body to move · SNAP controls precision · Wheel zoom · Space/Middle/Right drag pans"}
          {tool==="nozzle" && "Click on pool to place nozzle"}
          {tool==="light"  && "Click on pool to place light fixture"}
          {tool==="rectangle" && !drawStart && "Rectangle: click first corner"}
          {tool==="rectangle" && drawStart && "Rectangle: click opposite corner to finish"}
          {tool==="circle" && !drawStart && "Circle: click center point"}
          {tool==="circle" && drawStart && "Circle: click radius point to finish"}
          {tool==="polyline" && "Polyline: click points · Close Polyline to finish"}
          {tool==="measure"&& "Click two points to measure distance"}
          {tool==="delete" && "Click a fixture to delete it"}
          {tool==="depth"  && "Click to set depth zone"}
        </div>

        {drawPreview && (drawStart || polylinePoints.length > 0) && (
          <div style={{ position:"absolute", top:40, right:8, background:"rgba(0,0,0,0.75)", border:"1px solid #0a3040", borderRadius:4, padding:"6px 8px", fontSize:10, color:"#00ccaa", fontFamily:"monospace" }}>
            {tool==="rectangle" && drawStart && <>
              W {Math.abs(drawPreview.x-drawStart.x).toFixed(3)} m<br/>
              L {Math.abs(drawPreview.y-drawStart.y).toFixed(3)} m
            </>}
            {tool==="circle" && drawStart && <>
              R {Math.sqrt((drawPreview.x-drawStart.x)**2 + (drawPreview.y-drawStart.y)**2).toFixed(3)} m<br/>
              Ø {(Math.sqrt((drawPreview.x-drawStart.x)**2 + (drawPreview.y-drawStart.y)**2)*2).toFixed(3)} m
            </>}
            {tool==="polyline" && <>
              POINTS {polylinePoints.length}<br/>
              X {drawPreview.x.toFixed(3)} · Y {drawPreview.y.toFixed(3)}
            </>}
          </div>
        )}

        {/* CAD coordinate readout */}
        <div style={{ position:"absolute", bottom:8, right:8, background:"rgba(0,0,0,0.72)", border:"1px solid #0a2030", borderRadius:4, padding:"4px 8px", fontSize:9, color:"#7ab", fontFamily:"monospace" }}>
          TOOL {tool.toUpperCase()}&nbsp;&nbsp; X {cursorWorld.x.toFixed(3)} m&nbsp;&nbsp; Y {cursorWorld.y.toFixed(3)} m&nbsp;&nbsp; ZOOM {Math.round(zoom)} px/m&nbsp;&nbsp; SNAP {snapToGrid ? gridStep + "m" : "OFF"}&nbsp;&nbsp; DRAW {drawStart || polylinePoints.length > 0 || pipeSystem.drawing ? "ACTIVE" : "IDLE"}&nbsp;&nbsp; LAYERS {layers.filter(l=>l.visible).length}/{layers.length}&nbsp;&nbsp; SELECTED {selectedObject === "fixture" && sf ? sf.label : selectedObject === "pool" ? "POOL" : "NONE"}
        </div>
      </div>
    </div>
  );
}

