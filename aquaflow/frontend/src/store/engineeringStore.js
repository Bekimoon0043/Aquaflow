/**
 * engineeringStore.js — AquaFlow Engineering ↔ 3D Bridge
 *
 * This is the SINGLE source of truth for all engineering project data.
 *
 * Architecture rule (from spec):
 *   Engineering Design = Master Data Source
 *   3D Preview         = Visualization Layer only
 *
 * The Engineering Designer writes here.
 * The 3D Preview reads from here.
 * Neither owns the other's data.
 */

import { create } from "zustand";

const useEngineeringStore = create((set, get) => ({
  // ─── Project metadata ────────────────────────────────────────────────────────
  projectName: "New Pool Project",
  projectId:   null,
  lastUpdated:  null,

  // ─── Pool geometry ───────────────────────────────────────────────────────────
  // geometry: { type, points?, center?, radius?, rx?, ry?, closed? }
  geometry: null,

  // poolType: "rectangular" | "circular" | "elliptical" | "lshape" |
  //           "freeform" | "false_lake" | "false_river"
  poolType: "rectangular",

  // params: { width, length, radius, depth }
  params: { width: 12, length: 8, radius: 6, depth: 0.8 },

  // ─── Depth zones ─────────────────────────────────────────────────────────────
  depthZones: [
    { zone: "shallow", depth: 0.3 },
    { zone: "medium",  depth: 0.8 },
    { zone: "deep",    depth: 1.5 },
    { zone: "display", depth: 0.2 },
  ],

  // ─── Fixtures ────────────────────────────────────────────────────────────────
  // Each fixture: { id, type, label, x, y, z, rotation, zone, engineering:{}, symbol:{} }
  // Symbol metadata automatically derived from type via getEngineeringSymbol()
  fixtures: [],

  // ─── Layers ──────────────────────────────────────────────────────────────────
  // Each layer: { key, label, visible, locked, color }
  layers: [
    { key: "pool_outline",  label: "Pool Outline",   visible: true,  locked: false, color: "#00aaff" },
    { key: "water_surface", label: "Water Surface",  visible: true,  locked: false, color: "#0044aa" },
    { key: "nozzles",       label: "Nozzles",        visible: true,  locked: false, color: "#00ccaa" },
    { key: "lights",        label: "Lights",         visible: true,  locked: false, color: "#ffcc00" },
    { key: "measurements",  label: "Measurements",   visible: true,  locked: false, color: "#ffcc00" },
    { key: "annotations",   label: "Annotations",    visible: true,  locked: false, color: "#ffcc00" },
        { key: "pipework",      label: "Pipework",       visible: true,  locked: false, color: "#ff8800" },
    { key: "equipment",     label: "Equipment",      visible: true,  locked: false, color: "#888888" },
  ],

  // ─── Hydraulic results (from hydraulic engine) ───────────────────────────────
  hydraulicSummary: {
    totalFlowM3Hr:       0,
    recommendedPipeMm:   50,
    totalDynamicHeadM:   0,
    recommendedPumpKw:   0,
    totalWatts:          0,
  },

  // ─── BOM (from BOM engine) ───────────────────────────────────────────────────
    bomItems: [],

  // Manual pipe drawings (from usePipeDrawing)
manualPipes: [],
pipes: [],

  // ─── Measurements ────────────────────────────────────────────────────────────
  measurements: [],

  // ─── Actions ─────────────────────────────────────────────────────────────────

  /**
   * Called by Engineering Designer whenever ANYTHING changes.
   * Accepts a partial update — only provided keys are merged.
   */
  updateEngineering: (patch) => {
    set(state => ({
      ...state,
      ...patch,
      lastUpdated: Date.now(),
    }));
  },

  /**
   * Full project load — replaces entire state.
   */
    loadProject: (project) => {
    set({
      projectName:       project.name        || "Untitled",
      projectId:         project.id          || null,
      geometry:          project.geometry    || null,
      poolType:          project.pool_type   || "rectangular",
      params:            project.params      || { width:12, length:8, radius:6, depth:0.8 },
      fixtures:          project.fixtures    || [],
      layers:            project.layers      || get().layers,
      measurements:      project.measurements|| [],
      hydraulicSummary:  project.hydraulics  || get().hydraulicSummary,
      bomItems:          project.bom         || [],
      manualPipes:       project.manualPipes || project.pipes || [],
      pipes:             project.manualPipes || project.pipes || [],
      lastUpdated:       Date.now(),
    });
  },

  /**
   * Returns the full project payload — used for export/save.
   */
    getProjectPayload: () => {
    const s = get();
    return {
      format:      "AquaFlowPoolGeometry",
      version:     "0.11A",
      name:        s.projectName,
      id:          s.projectId,
      pool_type:   s.poolType,
      params:      s.params,
      geometry:    s.geometry,
      fixtures:    s.fixtures,
      layers:      s.layers,
      measurements:s.measurements,
      hydraulics:  s.hydraulicSummary,
      bom:         s.bomItems,
      pipes:       s.pipes,
      exported_at: new Date().toISOString(),
    };
  },

  /**
   * Returns fixtures filtered by layer visibility.
   */
  getVisibleFixtures: () => {
    const { fixtures, layers } = get();
    const layerVisible = (key) => layers.find(l => l.key === key)?.visible !== false;
    return fixtures.filter(f => {
      if (f.type?.startsWith("light"))  return layerVisible("lights");
      if (f.type?.startsWith("nozzle")) return layerVisible("nozzles");
      return true;
    });
  },

  /**
   * Returns pool bounds in world coordinates.
   */
  getPoolBounds: () => {
    const { geometry, params } = get();
    if (!geometry) return null;
    if (geometry.type === "circle") {
      const r = geometry.radius || params.radius || 6;
      const cx = geometry.center?.x || 0;
      const cy = geometry.center?.y || 0;
      return { minX:cx-r, maxX:cx+r, minY:cy-r, maxY:cy+r, cx, cy, radius:r };
    }
    if (geometry.type === "ellipse") {
      const cx = geometry.center?.x || 0;
      const cy = geometry.center?.y || 0;
      return { minX:cx-geometry.rx, maxX:cx+geometry.rx, minY:cy-geometry.ry, maxY:cy+geometry.ry, cx, cy };
    }
    if (geometry.points?.length) {
      const xs = geometry.points.map(p=>p.x);
      const ys = geometry.points.map(p=>p.y);
      const minX=Math.min(...xs), maxX=Math.max(...xs);
      const minY=Math.min(...ys), maxY=Math.max(...ys);
      return { minX, maxX, minY, maxY, cx:(minX+maxX)/2, cy:(minY+maxY)/2 };
    }
    const w=params.width||12, l=params.length||8;
    return { minX:0, maxX:w, minY:0, maxY:l, cx:w/2, cy:l/2 };
  },
}));

export default useEngineeringStore;
