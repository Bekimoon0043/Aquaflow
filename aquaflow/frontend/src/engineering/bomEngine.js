export function generateBOM(fixtures = []) {
  const items = {};

  fixtures.forEach((f) => {
    const key = f.type || "unknown";
    const label = f.label || key;
    const eng = f.engineering || {};

    let category = "Equipment";

    if (key.startsWith("nozzle")) {
      category = "Nozzles";
    } else if (
      key.startsWith("light") ||
      key.startsWith("laser")
    ) {
      category = "Lighting";
    } else if (
      key.startsWith("pump")
    ) {
      category = "Pumps";
    } else if (
      key.startsWith("valve") ||
      key.startsWith("solenoid")
    ) {
      category = "Valves";
    } else if (
      key.startsWith("air") ||
      key.includes("compressor")
    ) {
      category = "Air Systems";
    } else if (
      key.startsWith("fuel") ||
      key.startsWith("flame") ||
      key.includes("fire")
    ) {
      category = "Flame Systems";
    } else if (
      key.startsWith("motion") ||
      key.includes("1d") ||
      key.includes("2d") ||
      key.includes("3d")
    ) {
      category = "Motion Systems";
    } else if (
      key.startsWith("sensor") ||
      key.startsWith("safety")
    ) {
      category = "Sensors & Safety";
    } else if (
      key.startsWith("control") ||
      key.startsWith("power") ||
      key.startsWith("vfd") ||
      key.includes("plc") ||
      key.includes("dmx")
    ) {
      category = "Control Systems";
    } else if (
      key.startsWith("filter") ||
      key.startsWith("uv") ||
      key.startsWith("dosing")
    ) {
      category = "Water Treatment";
    }

    if (!items[key]) {
      items[key] = {
        key,
        label,
        category,

        quantity: 0,

        totalFlowLpm: 0,
        totalFlowM3Hr: 0,

        totalWattage: 0,
        totalPowerKw: 0,

        totalAirFlowLpm: 0,
        totalFuelFlow: 0,

        totalDmxChannels: 0,

        totalDigitalInputs: 0,
        totalDigitalOutputs: 0,

        totalAnalogInputs: 0,
        totalAnalogOutputs: 0,

        unit: "pcs"
      };
    }

    items[key].quantity += 1;

    items[key].totalFlowLpm += Number(eng.flowLpm || 0);
    items[key].totalFlowM3Hr += Number(eng.flowM3Hr || 0);

    items[key].totalWattage += Number(eng.wattage || 0);
    items[key].totalPowerKw += Number(eng.powerKw || 0);

    items[key].totalAirFlowLpm += Number(eng.airFlowLpm || 0);

    items[key].totalFuelFlow += Number(eng.gasFlow || 0);

    items[key].totalDmxChannels += Number(eng.dmxChannels || 0);

    items[key].totalDigitalInputs += Number(eng.digitalInputs || 0);
    items[key].totalDigitalOutputs += Number(eng.digitalOutputs || 0);

    items[key].totalAnalogInputs += Number(eng.analogInputs || 0);
    items[key].totalAnalogOutputs += Number(eng.analogOutputs || 0);
  });

  return Object.values(items);
}