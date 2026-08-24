const BAR_TO_METRES_WATER = 10.19716213;

function connectionDiameterM(engineering = {}) {
  if (Number(engineering.pipeDiameterM) > 0) return Number(engineering.pipeDiameterM);
  if (Number(engineering.nozzleDiaMm) > 0) return Math.max(0.01, Number(engineering.nozzleDiaMm) / 1000);
  const match = String(engineering.connectionSize || "").match(/(?:DN)?\s*(\d+(?:\.\d+)?)/i);
  return match ? Math.max(0.01, Number(match[1]) / 1000) : 0.05;
}

export function engineeringFixtureToSolverNozzle(fixture = {}) {
  const engineering = fixture.engineering || {};
  const flowLpm = Math.max(0, Number(engineering.flowLpm || 0));
  const pressureBar = Math.max(0, Number(engineering.pressureBar || 0));
  return {
    id: fixture.id,
    x: Number(fixture.x || 0),
    y: Number(fixture.y || 0),
    engineering: {
      ...engineering,
      design_flow_lps: flowLpm / 60,
      design_pressure_m: pressureBar * BAR_TO_METRES_WATER,
      pipe_diameter_m: connectionDiameterM(engineering),
      elevation_m: Number(engineering.elevationM || engineering.elevation_m || 0),
      discharge_coeff: Number(engineering.dischargeCoeff || engineering.discharge_coeff || 0.97),
    },
  };
}

export function buildHydraulicPreviewPayload({ fixtures = [], params = {}, volumeLitres = 0 } = {}) {
  const nozzles = fixtures
    .filter((fixture) => /nozzle|jet|geyser|spray|fan|arch|laminar|foam|mist|cascade|water_screen/i.test(String(fixture.type || "")))
    .map(engineeringFixtureToSolverNozzle);
  return {
    nozzles,
    params: { ...params, design_head_m: Number(params.design_head_m || params.designHeadM || 40) },
    volume_litres: Math.max(0, Number(volumeLitres || 0)),
  };
}

export function normalizeHydraulicResult(result = {}) {
  return {
    status: result.converged ? "solved" : "warning",
    converged: Boolean(result.converged),
    method: result.method || result.hydraulic_solution?.method || "hazen-williams",
    totalDesignFlowLpm: Number(result.total_design_flow_lpm || 0),
    turnoverTimeHours: result.turnover_time_hours == null ? null : Number(result.turnover_time_hours),
    nozzlePhysics: result.nozzle_physics || {},
    validation: Array.isArray(result.validation) ? result.validation : [],
    hydraulicSolution: result.hydraulic_solution || null,
    solvedAt: new Date().toISOString(),
  };
}

export { BAR_TO_METRES_WATER };
