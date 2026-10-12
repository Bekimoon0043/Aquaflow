import { getFixtureLibraryEntry } from "../data/fixtureLibrary.js";

const BAR_TO_METRES_WATER = 10.19716213;

const DEFAULT_PIPE_DIAMETER_M = 0.05;

/**
 * Branch PIPE diameter for the solver. This is the fixture's connection size
 * (DN25 → 0.025 m), never its orifice: `nozzleDiaMm` is the outlet bore (a
 * 7 mm jet on a DN15 branch), and feeding it in as the pipe made the solver
 * see absurd friction losses.
 */
function connectionDiameterM(engineering = {}) {
  if (Number(engineering.pipeDiameterM) > 0) return Number(engineering.pipeDiameterM);
  const match = String(engineering.connectionSize || "").match(/^\s*(?:DN)?\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*$/i);
  return match ? Math.max(0.01, Number(match[1]) / 1000) : DEFAULT_PIPE_DIAMETER_M;
}

const LEGACY_WATER_TYPE = /nozzle|jet|geyser|spray|fan|arch|laminar|foam|cascade|water_screen/i;
const NOT_WATER_JET = /flame|fire|burner|fog|mist|haze|laser|light|pump|compressor/i;

/**
 * Only display-water nozzles belong in the low-pressure water network solve.
 * Library fixtures are classified by category (Nozzles), excluding the mist /
 * fog families that run on their own 6–70 bar circuit; flame burners, fog
 * units and the high-pressure mist pump are never sent. Types not in the
 * library fall back to the legacy name match minus those families.
 */
export function isWaterNozzleFixture(fixture = {}) {
  const type = String(fixture.type || "");
  const entry = getFixtureLibraryEntry(type);
  if (entry) {
    if (entry.category !== "Nozzles") return false;
    const fam = `${entry.family || ""} ${entry.engineering?.group || ""}`;
    return !/mist|fog/i.test(fam);
  }
  return LEGACY_WATER_TYPE.test(type) && !NOT_WATER_JET.test(type);
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
    .filter(isWaterNozzleFixture)
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
