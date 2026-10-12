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
// AF-HUB-003 — pool bounds/center come from the single canonical geometry contract,
// so the 3D-centering shift here and the conversion in useEngineeringSync can't drift.
import { poolBounds as canonicalPoolBounds } from "../engineering/geometryContract";
import {
  DEFAULT_DEPTH_ZONES,
  createDefaultEngineeringProject,
  normalizeEngineeringProject,
  selectEngineeringPipes,
} from "../engineering/engineeringProject";

const DEFAULT_ENGINEERING_LAYERS = [
  { key: "pool_outline", label: "Pool Outline", visible: true, locked: false, color: "#00aaff" },
  { key: "water_surface", label: "Water Surface", visible: true, locked: false, color: "#0044aa" },
  { key: "landscape", label: "Landscape / Land", visible: true, locked: false, color: "#65a30d" },
  { key: "nozzles", label: "Nozzles", visible: true, locked: false, color: "#00ccaa" },
  { key: "lights", label: "Lights", visible: true, locked: false, color: "#ffcc00" },
  { key: "measurements", label: "Measurements", visible: true, locked: false, color: "#ffcc00" },
  { key: "annotations", label: "Annotations", visible: true, locked: false, color: "#ffcc00" },
  { key: "pipework", label: "Pipework", visible: true, locked: false, color: "#ff8800" },
  { key: "equipment", label: "Equipment", visible: true, locked: false, color: "#888888" },
];

const mergeEngineeringLayers = (layers = []) => DEFAULT_ENGINEERING_LAYERS.map((fallback) => ({
  ...fallback,
  ...(layers.find((layer) => layer.key === fallback.key) || {}),
}));

const useEngineeringStore = create((set, get) => ({
  // ─── Project metadata ────────────────────────────────────────────────────────
  projectName: "New Pool Project",
  projectId:   null,
  lastUpdated:  null,
  loadRevision: 0,

  // ─── Pool geometry ───────────────────────────────────────────────────────────
  // geometry: { type, points?, center?, radius?, rx?, ry?, closed? }
  geometry: null,

  // poolType: "rectangular" | "circular" | "elliptical" | "lshape" |
  //           "freeform" | "false_lake" | "false_river"
  poolType: "rectangular",

  // params: { width, length, radius, depth }
  params: { width: 12, length: 8, radius: 6, depth: 0.8 },

  // ─── Depth zones ─────────────────────────────────────────────────────────────
  depthZones: DEFAULT_DEPTH_ZONES.map((zone) => ({ ...zone, points: [] })),

  // ─── Fixtures ────────────────────────────────────────────────────────────────
  // Each fixture: { id, type, label, x, y, z, rotation, zone, engineering:{}, symbol:{} }
  // Symbol metadata automatically derived from type via getEngineeringSymbol()
  fixtures: [],

  // Editable venue content placed in the 3D workspace (people, trees, buildings, GLB).
  siteModels: [],

  // Editable site-plan polygons (grass, paving, soil, rock and sand).
  siteSurfaces: [],

  // ─── Layers ──────────────────────────────────────────────────────────────────
  // Each layer: { key, label, visible, locked, color }
  layers: DEFAULT_ENGINEERING_LAYERS.map((layer) => ({ ...layer })),

  // ─── Hydraulic results (from hydraulic engine) ───────────────────────────────
  hydraulicSummary: {
    totalFlowM3Hr:       0,
    recommendedPipeMm:   50,
    totalDynamicHeadM:   0,
    recommendedPumpKw:   0,
    totalWatts:          0,
  },
  solvedHydraulics: null,

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
    const normalized = normalizeEngineeringProject(project);
    const projectPipes = selectEngineeringPipes(normalized);
    set({
      projectName:       normalized.name,
      projectId:         normalized.id,
      geometry:          normalized.geometry || null,
      poolType:          normalized.pool_type,
      params:            normalized.params,
      fixtures:          normalized.fixtures,
      siteModels:        normalized.site_models,
      siteSurfaces:      normalized.site_surfaces,
      layers:            mergeEngineeringLayers(normalized.layers),
      measurements:      normalized.measurements,
      depthZones:        normalized.depth_zones,
      hydraulicSummary:  normalized.hydraulics || get().hydraulicSummary,
      solvedHydraulics:   normalized.solved_hydraulics,
      bomItems:          normalized.bom,
      manualPipes:       projectPipes,
      pipes:             projectPipes,
      lastUpdated:       Date.now(),
      loadRevision:      get().loadRevision + 1,
    });
  },

  resetProject: () => {
    const project = createDefaultEngineeringProject();
    get().loadProject(project);
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
      site_models: s.siteModels,
      site_surfaces: s.siteSurfaces,
      layers:      s.layers,
      measurements:s.measurements,
      depth_zones: s.depthZones,
      hydraulics:  s.hydraulicSummary,
      solved_hydraulics: s.solvedHydraulics,
      bom:         s.bomItems,
      manualPipes: s.manualPipes,
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
    // AF-HUB-003 — delegate to the single canonical geometry contract. Returns null
    // only when there is no geometry AND no usable params (preserves prior callers
    // that treat null as "no pool yet").
    const { geometry, params, poolType } = get();
    if (!geometry) return null;  // no pool drawn yet — preserve prior "no bounds" contract
    return canonicalPoolBounds(geometry, params, poolType);
  },
}));

export default useEngineeringStore;
