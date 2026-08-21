/**
 * hydraulicEngine.js — equipment aggregation for the pool geometry designer.
 *
 * AQ-S2-002 — SCOPE CHANGE. This module used to compute hydraulics client-side.
 * It no longer does, because that maths contradicted the real solver:
 *
 *   staticHeadM   = 3                      // hardcoded, ignored the geometry
 *   frictionHeadM = totalFlowM3Hr * 0.05   // LINEAR in Q
 *
 * Friction head is not linear in flow. Hazen-Williams gives h ∝ Q^1.852 (Darcy
 * gives Q²), so the linear form under-predicts badly at high flow and over-
 * predicts at low flow. Pipe sizing, dynamic head, hydraulic power, required
 * pump kW and the pump status flags were all derived from those two numbers, so
 * all of them were unreliable.
 *
 * THE SINGLE SOURCE OF HYDRAULIC TRUTH is now the backend solver
 * (backend/services/hydraulic_solver.py) — a Global Gradient Algorithm
 * (Todini & Pilati 1988) network solve, the method EPANET uses, with
 * pressure-dependent nozzle emitters (q = k·√p), Torricelli exit velocity and
 * engineering validation. Reach it via POST /api/hydraulics.
 *
 * What remains here is pure aggregation of authored nameplate specs — counting
 * up what the designer placed. That is legitimately a frontend concern and has
 * no physics in it.
 */

/**
 * Sum the nameplate specs of the placed fixtures. NON-HYDRAULIC: this counts
 * installed capacity and control I/O, it does not solve anything.
 */
export function calculateEquipmentTotals(fixtures = []) {
  let totalNozzleFlowLpm = 0;
  let totalProcessFlowLpm = 0;
  let totalPumpCapacityM3Hr = 0;
  let totalPumpPowerKw = 0;
  let totalWatts = 0;
  let totalAirFlowLpm = 0;
  let totalFuelFlow = 0;
  let totalDmxChannels = 0;
  let totalDigitalInputs = 0;
  let totalDigitalOutputs = 0;
  let totalAnalogInputs = 0;
  let totalAnalogOutputs = 0;

  fixtures.forEach(f => {
    const eng = f.engineering || {};
    const type = f.type || "";

    if (type.startsWith("nozzle")) {
      totalNozzleFlowLpm += Number(eng.flowLpm || 0);
    }

    if (
      type.startsWith("filter") ||
      type.startsWith("uv") ||
      type.startsWith("dosing") ||
      type.startsWith("nozzle_fog") ||
      type.startsWith("nozzle_mist")
    ) {
      totalProcessFlowLpm += Number(eng.flowLpm || 0);
      totalProcessFlowLpm += Number(eng.flowM3Hr || 0) * 1000 / 60;
    }

    if (type.startsWith("pump")) {
      totalPumpCapacityM3Hr += Number(eng.flowM3Hr || 0);
      totalPumpPowerKw += Number(eng.powerKw || 0);
    }

    totalWatts += Number(eng.wattage || 0);
    totalWatts += Number(eng.powerKw || 0) * 1000;
    totalWatts += Number(eng.outputPowerW || 0);

    totalAirFlowLpm += Number(eng.airFlowLpm || 0);
    totalFuelFlow += Number(eng.gasFlow || 0);

    totalDmxChannels += Number(eng.dmxChannels || 0);

    totalDigitalInputs += Number(eng.digitalInputs || 0);
    totalDigitalOutputs += Number(eng.digitalOutputs || 0);
    totalAnalogInputs += Number(eng.analogInputs || 0);
    totalAnalogOutputs += Number(eng.analogOutputs || 0);

    if (String(eng.signalType || "").includes("Digital Input")) {
      totalDigitalInputs += 1;
    }

    if (String(eng.signalType || "").includes("Digital Output")) {
      totalDigitalOutputs += 1;
    }

    if (
      String(eng.signalType || "").includes("4-20mA") ||
      String(eng.signalType || "").includes("Analog")
    ) {
      totalAnalogInputs += 1;
    }
  });

  const totalFlowLpm = totalNozzleFlowLpm + totalProcessFlowLpm;
  const totalFlowM3Hr = totalFlowLpm * 0.06;

  return {
    // Installed capacity — sums of what the designer placed (nameplate specs).
    totalFlowLpm,
    totalNozzleFlowLpm,
    totalProcessFlowLpm,
    totalFlowM3Hr,
    totalPumpCapacityM3Hr,
    totalPumpPowerKw,

    // Electrical / media / control I/O — never were hydraulics.
    totalWatts,
    totalAirFlowLpm,
    totalFuelFlow,
    totalDmxChannels,
    totalDigitalInputs,
    totalDigitalOutputs,
    totalAnalogInputs,
    totalAnalogOutputs,

    // These are SUMS OF AUTHORED SPECS, not a solved duty point.
    flowBasis: "SPEC_SUM",
  };
}

/**
 * @deprecated Client-side hydraulics have been retired (AQ-S2-002).
 *
 * Returns the equipment totals plus the former hydraulic fields pinned to null,
 * so any consumer that still reads them gets an explicit "not calculated here"
 * rather than a plausible-looking wrong number. Fetch the real values from the
 * backend solver (POST /api/hydraulics) — see the module header.
 */
export function calculateHydraulics(fixtures = []) {
  return {
    ...calculateEquipmentTotals(fixtures),

    // Retired: these were derived from a hardcoded static head and a linear
    // friction approximation. The backend solver computes them properly.
    recommendedPipeMm: null,
    staticHeadM: null,
    frictionHeadM: null,
    totalDynamicHeadM: null,
    hydraulicPowerKw: null,
    recommendedPumpKw: null,
    pumpCapacityStatus: null,
    pumpPowerStatus: null,

    hydraulicsBasis: "BACKEND_SOLVER_REQUIRED",
    hydraulicsSource: "POST /api/hydraulics (services/hydraulic_solver.py)",
  };
}
