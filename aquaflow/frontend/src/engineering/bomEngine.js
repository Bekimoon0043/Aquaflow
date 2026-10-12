import { getFixtureRatings } from "../data/fixtureLibrary.js";

export function generateBOM(fixtures = []) {
  const items = {};

  fixtures.forEach((f) => {
    const key = f.type || "unknown";
    const label = f.label || key;
    const eng = f.engineering || {};
    // Falls back to the normalized `electrical` block and converts flow units,
    // so generated library items no longer count as 0 W / 0 kW / 0 DMX.
    const ratings = getFixtureRatings(f);

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

    items[key].totalFlowLpm += ratings.flowLpm;
    items[key].totalFlowM3Hr += ratings.flowM3Hr;

    // Same load in two units (W and kW columns) — not two loads.
    items[key].totalWattage += ratings.powerW;
    items[key].totalPowerKw += ratings.powerKw;

    items[key].totalAirFlowLpm += Number(eng.airFlowLpm || 0);

    items[key].totalFuelFlow += Number(eng.gasFlow || 0);

    items[key].totalDmxChannels += ratings.dmxChannels;

    items[key].totalDigitalInputs += Number(eng.digitalInputs || 0);
    items[key].totalDigitalOutputs += Number(eng.digitalOutputs || 0);

    items[key].totalAnalogInputs += Number(eng.analogInputs || 0);
    items[key].totalAnalogOutputs += Number(eng.analogOutputs || 0);
  });

  return Object.values(items);
}