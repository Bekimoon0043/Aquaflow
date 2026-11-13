/**
 * drafting/designerCatalog.js — AF-CAD-030: static catalogues of the 2D Engineering
 * Designer, moved verbatim out of PoolGeometryDesigner.jsx (pool types, fixture types,
 * plan symbols and their canvas renderer, the tool list and the standard layer set).
 */
import { FIXTURE_LIBRARY } from "../../data/fixtureLibrary";

export const POOL_TYPES = [
  { key:"rectangular", label:"Rectangular",  icon:"▭" },
  { key:"circular",    label:"Circular",     icon:"○" },
  { key:"elliptical",  label:"Elliptical",   icon:"⬭" },
  { key:"lshape",      label:"L-Shape",      icon:"⌐" },
  { key:"freeform",    label:"Freeform",     icon:"~" },
  { key:"false_lake",  label:"False Lake",   icon:"≈" },
  { key:"false_river", label:"False River",  icon:"~≈" },
];

export const FIXTURE_TYPES = Array.isArray(FIXTURE_LIBRARY)
  ? FIXTURE_LIBRARY.map(f => ({
      key: f.key,
      label: f.label,
      color: f.color,
      icon: f.icon,
      category: f.category || "Other",
      manufacturer: f.manufacturer || "",
      // Searchable in the designer's library browser ("basket" → rotating nozzles).
      family: f.family || "",
      model: f.model || "",
      ...(f.summary ? { summary: f.summary } : {}),
      ...(Array.isArray(f.tags) ? { tags: f.tags } : {}),
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
export const ENGINEERING_SYMBOLS_MAP = {
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
  "laser":           { type: "laser",    shape: "laser",   icon: "◆", color: "#ff2266", size: 0.30 },
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
  "pyro":            { type: "pyro",     shape: "mortar",  icon: "✷", color: "#ff8a3d", size: 0.35 },
  // Special effects listed with the fireworks (sfx_*): DMX machines, drawn as a square base.
  "sfx_spark":       { type: "spark",    shape: "rect",    icon: "⁂", color: "#ffd27a", size: 0.32 },
  "sfx_flame":       { type: "flame",    shape: "rect",    icon: "🔥", color: "#ff5a1f", size: 0.32 },
  "sfx_co2":         { type: "co2",      shape: "rect",    icon: "❄", color: "#cfe8ff", size: 0.32 },
  "sfx_confetti":    { type: "confetti", shape: "rect",    icon: "✦", color: "#ff7ad9", size: 0.32 },
  "sfx_smoke":       { type: "smoke",    shape: "rect",    icon: "≋", color: "#a8b4c0", size: 0.32 },
};

const sfxSymbol = (k) => ENGINEERING_SYMBOLS_MAP[/flame/.test(k) ? "sfx_flame" : /co2|cryo/.test(k) ? "sfx_co2" : /confetti|streamer/.test(k) ? "sfx_confetti"
  : /smoke|haze|fog/.test(k) ? "sfx_smoke" : "sfx_spark"];

export const getEngineeringSymbol = (typeKey) => {
  if (!typeKey) return ENGINEERING_SYMBOLS_MAP["nozzle_geyser"];
  if (ENGINEERING_SYMBOLS_MAP[typeKey]) return ENGINEERING_SYMBOLS_MAP[typeKey];
  if (typeKey.startsWith("pyro_")) return ENGINEERING_SYMBOLS_MAP["pyro"];
  if (typeKey.startsWith("laser_")) return ENGINEERING_SYMBOLS_MAP["laser"];
  if (typeKey.startsWith("sfx_")) return sfxSymbol(typeKey);
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

export const drawEngSymbol = (ctx, cx, cy, rotationDeg, scale, isSelected, symbol) => {
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
    case "laser":
      // Diamond with an aim tick pointing along the projector's facing (rotation 0 = +x).
      ctx.moveTo(0, -size/2);
      ctx.lineTo(size/2, 0);
      ctx.lineTo(0, size/2);
      ctx.lineTo(-size/2, 0);
      ctx.closePath();
      ctx.moveTo(size/2, 0);
      ctx.lineTo(size * 1.15, 0);
      break;
    case "mortar":
      // Firing position: a mortar tube seen from above (circle) with a cross.
      ctx.arc(0, 0, size/2, 0, Math.PI * 2);
      ctx.moveTo(-size/2, 0); ctx.lineTo(size/2, 0);
      ctx.moveTo(0, -size/2); ctx.lineTo(0, size/2);
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
/** Tools that place a product from the fixture library (click, arrays, properties). */
export const PLACEMENT_TOOLS = Object.freeze(["nozzle", "light", "laser", "fireworks", "equipment"]);
/** Products of these tools may stand on land outside every basin (towers, platforms, firing sites). */
export const OUTSIDE_BASIN_TOOLS = Object.freeze(["laser", "fireworks"]);
export const TOOLS = [
  { key:"select", label:"Select", icon:"↖" },
  { key:"rectangle", label:"Rectangle", icon:"▭" },
  { key:"circle", label:"Circle", icon:"○" },
  { key:"polyline", label:"Polyline", icon:"⌁" },
  { key:"land", label:"Land", icon:"▰" },
{ key:"pipe", label:"Pipe", icon:"═" },
  { key:"nozzle", label:"Nozzle", icon:"⬆" },
  { key:"light", label:"Light", icon:"★" },
  { key:"laser", label:"Laser", icon:"◆" },
  { key:"fireworks", label:"Fireworks", icon:"✷" },
{ key:"equipment", label:"Equipment", icon:"⚙" },
  { key:"depth", label:"Depth", icon:"▦" },
  { key:"measure", label:"Measure", icon:"↔" },
  { key:"delete", label:"Delete", icon:"✕" },
];

export const DEFAULT_LAYERS = [
  { key:"pool_outline", label:"POOL OUTLINE", color:"#00aaff", visible:true, locked:false },
  { key:"water_surface", label:"WATER SURFACE", color:"#0077b6", visible:true, locked:false },
  { key:"landscape", label:"LANDSCAPE / LAND", color:"#65a30d", visible:true, locked:false },
  { key:"nozzles", label:"NOZZLES", color:"#00ffcc", visible:true, locked:false },
  { key:"lights", label:"LIGHTS", color:"#ffcc00", visible:true, locked:false },
  { key:"lasers", label:"LASERS", color:"#ff2266", visible:true, locked:false },
  { key:"fireworks", label:"FIREWORKS", color:"#ff8a3d", visible:true, locked:false },
{ key:"equipment", label:"EQUIPMENT", color:"#22c55e", visible:true, locked:false },
  { key:"measurements", label:"MEASUREMENTS", color:"#ffcc00", visible:true, locked:false },
  { key:"annotations", label:"ANNOTATIONS", color:"#ffcc00", visible:true, locked:false },
  { key:"pipework", label:"PIPEWORK", color:"#8b5cf6", visible:true, locked:false },
  { key:"guides", label:"GUIDES", color:"#c084fc", visible:true, locked:false },
];

export const mergeEngineeringLayers = (layers = []) => DEFAULT_LAYERS.map((fallback) => ({
  ...fallback,
  ...(layers.find((layer) => layer.key === fallback.key) || {}),
}));
