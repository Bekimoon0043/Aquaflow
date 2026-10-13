import { normalizeCadUnderlay } from "./cadUnderlay";
import { reconcileBasins, legacyFromBasins, flattenBasinDepthZones, scopeDepthZones } from "./basins";

export const DEFAULT_DEPTH_ZONES = [
  { id: "shallow", zone: "shallow", label: "Shallow", depth: 0.3, color: "#7ec8e3", points: [] },
  { id: "medium", zone: "medium", label: "Medium", depth: 0.8, color: "#0077b6", points: [] },
  { id: "deep", zone: "deep", label: "Deep", depth: 1.5, color: "#03045e", points: [] },
  { id: "display", zone: "display", label: "Display", depth: 0.2, color: "#90e0ef", points: [] },
];

export function createDefaultEngineeringProject() {
  return {
    format: "AquaFlowPoolGeometry",
    version: "1.0",
    name: "New Pool Project",
    id: null,
    pool_type: "rectangular",
    params: { width: 12, length: 8, radius: 6, depth: 0.8 },
    geometry: null,
    // AF-CAD-013 / AF-NEXT-010: every basin (engineering/basins.js). `geometry` is always
    // basins[0] in the legacy single-basin shape, kept for consumers not yet migrated.
    basins: [],
    fixtures: [],
    groups: [],
    site_models: [],
    site_surfaces: [],
    // AF-CAD-011: locked whole-drawing CAD reference (engineering/cadUnderlay.js).
    cad_underlay: null,
    layers: [],
    measurements: [],
    depth_zones: DEFAULT_DEPTH_ZONES.map((zone) => ({ ...zone, points: [] })),
    manualPipes: [],
    pipes: [],
    hydraulics: null,
    solved_hydraulics: null,
    bom: [],
  };
}

export function normalizeEngineeringProject(project = {}) {
  const base = createDefaultEngineeringProject();
  const manual = project.manualPipes || project.manual_pipes;
  const pipes = Array.isArray(manual) && manual.length
    ? manual
    : (Array.isArray(project.pipes) ? project.pipes : []);
  // AF-NEXT-010 lossless migration: legacy `geometry` (+holes/levels) ⇄ `basins[]`.
  const poolType = project.pool_type || project.poolType || base.pool_type;
  const rawZones = project.depth_zones || project.depthZones;
  const hasGeometry = project.geometry && typeof project.geometry === "object";
  let basins = reconcileBasins({ basins: project.basins, geometry: hasGeometry ? project.geometry : null,
    poolType: hasGeometry ? poolType : undefined,
    params: hasGeometry ? { ...base.params, ...(project.params || {}) } : undefined });
  const zones = Array.isArray(rawZones)
    ? rawZones
    : (basins.some((b) => b.depthZones?.length) ? flattenBasinDepthZones(basins, base.depth_zones) : base.depth_zones);
  const scoped = scopeDepthZones(basins, zones);
  basins = scoped.basins;
  const legacy = hasGeometry ? { geometry: project.geometry } : legacyFromBasins(basins);
  return {
    ...base,
    ...project,
    geometry: legacy.geometry || null,
    basins,
    name: project.name || project.projectName || base.name,
    id: project.id || project.projectId || null,
    pool_type: hasGeometry ? poolType : (legacy.poolType || poolType),
    params: { ...base.params, ...(hasGeometry ? {} : (legacy.params || {})), ...(project.params || {}) },
    fixtures: Array.isArray(project.fixtures) ? project.fixtures : [],
    groups: Array.isArray(project.groups) ? project.groups : [],
    site_models: Array.isArray(project.site_models || project.siteModels)
      ? (project.site_models || project.siteModels)
      : [],
    site_surfaces: Array.isArray(project.site_surfaces || project.siteSurfaces)
      ? (project.site_surfaces || project.siteSurfaces)
      : [],
    cad_underlay: normalizeCadUnderlay(project.cad_underlay || project.cadUnderlay),
    layers: Array.isArray(project.layers) ? project.layers : [],
    measurements: Array.isArray(project.measurements) ? project.measurements : [],
    depth_zones: scoped.depthZones,
    manualPipes: pipes,
    pipes,
    hydraulics: project.hydraulics || project.hydraulicSummary || null,
    solved_hydraulics: project.solved_hydraulics || project.solvedHydraulics || null,
    bom: project.bom || project.bomItems || [],
  };
}

/**
 * Parse an engineering project chosen from the operating-system file picker.
 * Accepts both a direct *.aquaflow.json export and the engineering section of
 * a full *.aqua show, while rejecting unrelated JSON before it can replace the
 * current design.
 */
export function parseEngineeringProjectFile(raw) {
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The selected file does not contain an AquaFlow project.");
  }

  const project = data.engineering || data.engineeringProject || data.engineering_project || data;
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new Error("The selected file does not contain an engineering design.");
  }

  const recognizable = project.format === "AquaFlowPoolGeometry"
    || "pool_type" in project
    || "poolType" in project
    || "geometry" in project
    || Array.isArray(project.basins)
    || Array.isArray(project.fixtures)
    || Array.isArray(project.site_models)
    || Array.isArray(project.siteModels);
  if (!recognizable) {
    throw new Error("This JSON file is not an AquaFlow engineering project.");
  }

  return normalizeEngineeringProject(project);
}

export function selectEngineeringPipes(project = {}) {
  const manual = project.manualPipes;
  return Array.isArray(manual) && manual.length ? manual : (Array.isArray(project.pipes) ? project.pipes : []);
}
