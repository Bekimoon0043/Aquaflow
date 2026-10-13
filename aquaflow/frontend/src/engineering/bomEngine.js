import { getFixtureProvenance, getFixtureRatings } from "../data/fixtureLibrary.js";
import { citeProvenance, equipmentKind, genericProvenance, unitsText } from "../data/fixtureProvenance.js";

// AF-NEXT-012 — the units every BOM total is expressed in, cited on each line.
export const BOM_UNITS = {
  quantity: "pcs", flow: "L/min and m3/h", power: "W and kW", air: "L/min",
  dmx: "channels", io: "points",
};

/** Flat provenance columns for a BOM item (BOM view + CSV export). */
export function bomCitation(item = {}) {
  const c = item.citation || citeProvenance(
    genericProvenance({ kind: equipmentKind(item), model: item.label || item.key }),
    { equipmentModel: item.key || item.label, kind: equipmentKind(item),
      units: item.unit === "m" ? { length: "m", nominal_size: "DN (mm)" } : { quantity: item.unit || "pcs" } },
  );
  return {
    equipmentModel: c.equipmentModel,
    dataSource: c.dataSource,
    sourceLabel: c.sourceLabel,
    confidence: c.confidence,
    unitsBasis: unitsText(c.units),
    revision: c.revision,
    sourceDocument: c.document,
  };
}

/** CSV header + cells for the provenance columns (appended to existing exports). */
export const BOM_PROVENANCE_HEADERS = ["Equipment Model", "Data Source", "Confidence", "Units Basis", "Data Revision", "Source Document"];
export function bomProvenanceCells(item) {
  const c = bomCitation(item);
  return [c.equipmentModel, c.sourceLabel, c.confidence, c.unitsBasis, c.revision, c.sourceDocument];
}

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

    // Instances of one type with different provenance (e.g. one linked to a
    // measured model) are never merged into one line.
    const provenance = getFixtureProvenance(f);
    const groupKey = provenance.source === "generic_estimate" ? key : `${key}@${provenance.source}:${provenance.revision}`;

    if (!items[groupKey]) {
      const citation = citeProvenance(provenance, { equipmentModel: key, units: { ...provenance.units, ...BOM_UNITS } });
      items[groupKey] = {
        key: groupKey,
        type: key,
        label,
        category,

        // AF-NEXT-012 citation: equipment model, data source, units, revision.
        citation,
        equipmentModel: citation.equipmentModel,
        manufacturer: citation.manufacturer,
        dataSource: citation.dataSource,
        sourceLabel: citation.sourceLabel,
        confidence: citation.confidence,
        revision: citation.revision,
        sourceDocument: citation.document,

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

    items[groupKey].quantity += 1;

    items[groupKey].totalFlowLpm += ratings.flowLpm;
    items[groupKey].totalFlowM3Hr += ratings.flowM3Hr;

    // Same load in two units (W and kW columns) — not two loads.
    items[groupKey].totalWattage += ratings.powerW;
    items[groupKey].totalPowerKw += ratings.powerKw;

    items[groupKey].totalAirFlowLpm += Number(eng.airFlowLpm || 0);

    items[groupKey].totalFuelFlow += Number(eng.gasFlow || 0);

    items[groupKey].totalDmxChannels += ratings.dmxChannels;

    items[groupKey].totalDigitalInputs += Number(eng.digitalInputs || 0);
    items[groupKey].totalDigitalOutputs += Number(eng.digitalOutputs || 0);

    items[groupKey].totalAnalogInputs += Number(eng.analogInputs || 0);
    items[groupKey].totalAnalogOutputs += Number(eng.analogOutputs || 0);
  });

  return Object.values(items);
}