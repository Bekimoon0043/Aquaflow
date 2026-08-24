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
    fixtures: [],
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
  return {
    ...base,
    ...project,
    name: project.name || project.projectName || base.name,
    id: project.id || project.projectId || null,
    pool_type: project.pool_type || project.poolType || base.pool_type,
    params: { ...base.params, ...(project.params || {}) },
    fixtures: Array.isArray(project.fixtures) ? project.fixtures : [],
    layers: Array.isArray(project.layers) ? project.layers : [],
    measurements: Array.isArray(project.measurements) ? project.measurements : [],
    depth_zones: Array.isArray(project.depth_zones || project.depthZones)
      ? (project.depth_zones || project.depthZones)
      : base.depth_zones,
    manualPipes: pipes,
    pipes,
    hydraulics: project.hydraulics || project.hydraulicSummary || null,
    solved_hydraulics: project.solved_hydraulics || project.solvedHydraulics || null,
    bom: project.bom || project.bomItems || [],
  };
}

export function selectEngineeringPipes(project = {}) {
  const manual = project.manualPipes;
  return Array.isArray(manual) && manual.length ? manual : (Array.isArray(project.pipes) ? project.pipes : []);
}
