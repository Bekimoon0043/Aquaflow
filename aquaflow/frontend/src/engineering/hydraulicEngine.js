export function calculateHydraulics(fixtures = []) {
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

  let recommendedPipeMm = 50;
  if (totalFlowM3Hr > 20) recommendedPipeMm = 65;
  if (totalFlowM3Hr > 40) recommendedPipeMm = 80;
  if (totalFlowM3Hr > 70) recommendedPipeMm = 100;
  if (totalFlowM3Hr > 120) recommendedPipeMm = 150;

  const staticHeadM = 3;
  const frictionHeadM = totalFlowM3Hr * 0.05;
  const totalDynamicHeadM = staticHeadM + frictionHeadM;

  const hydraulicPowerKw = (totalFlowM3Hr * totalDynamicHeadM) / 367;
  const recommendedPumpKw = hydraulicPowerKw * 1.25;

  const pumpCapacityStatus =
    totalPumpCapacityM3Hr <= 0
      ? "NO_PUMP_SELECTED"
      : totalPumpCapacityM3Hr >= totalFlowM3Hr
      ? "OK"
      : "UNDERSIZED";

  const pumpPowerStatus =
    totalPumpPowerKw <= 0
      ? "NO_PUMP_SELECTED"
      : totalPumpPowerKw >= recommendedPumpKw
      ? "OK"
      : "UNDERSIZED";

  return {
    totalFlowLpm,
    totalNozzleFlowLpm,
    totalProcessFlowLpm,
    totalFlowM3Hr,

    recommendedPipeMm,

    staticHeadM,
    frictionHeadM,
    totalDynamicHeadM,

    hydraulicPowerKw,
    recommendedPumpKw,

    totalPumpCapacityM3Hr,
    totalPumpPowerKw,
    pumpCapacityStatus,
    pumpPowerStatus,

    totalWatts,
    totalAirFlowLpm,
    totalFuelFlow,

    totalDmxChannels,
    totalDigitalInputs,
    totalDigitalOutputs,
    totalAnalogInputs,
    totalAnalogOutputs
  };
}