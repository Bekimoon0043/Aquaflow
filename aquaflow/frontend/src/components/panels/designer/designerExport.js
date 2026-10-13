/**
 * designerExport.js — AF-CAD-030: project payload and BOM CSV builders moved out of
 * PoolGeometryDesigner.jsx (pure; the component supplies its state).
 */
import { BOM_PROVENANCE_HEADERS, bomProvenanceCells } from "../../../engineering/bomEngine"; // AF-NEXT-012
import { HYD_NOT_CALCULATED, hydFmt } from "./DesignerSidebar";

export const buildProjectPayload = ({
  projectId, projectName, primaryBasin, basins, fixtures, siteModels, siteSurfaces, cadUnderlay, manualPipes,
  measurements, layers, depthZones, solvedHydraulics, poolMetrics, arraySettings, hydraulicSummary, pipework,
  baseBomItems, groups,
}) => ({
    id: projectId,
    format:"AquaFlowPoolGeometry",
    version:"0.11A",
    name: projectName,
    pool_type: primaryBasin.poolType,
    params: primaryBasin.params,
    geometry: primaryBasin.geometry,
    basins,
   fixtures,
   site_models: siteModels || [],
   site_surfaces: siteSurfaces,
   cad_underlay: cadUnderlay || null,
   manualPipes,
   measurements,
   layers,
   depth_zones: depthZones,
   solved_hydraulics: solvedHydraulics,
   metrics: poolMetrics,
    // AF-CAD-034: groups are ID lists of member entities.
    groups: groups || [],
    array_settings: arraySettings,
    engineering_summary:{
  flow:{
    nozzleFlowLpm: hydraulicSummary.totalNozzleFlowLpm,
    processFlowLpm: hydraulicSummary.totalProcessFlowLpm,
    totalFlowLpm: hydraulicSummary.totalFlowLpm,
    totalFlowM3Hr: hydraulicSummary.totalFlowM3Hr,
  },
  pump:{
    requiredPumpKw: hydraulicSummary.recommendedPumpKw,
    installedPumpKw: hydraulicSummary.totalPumpPowerKw,
    installedPumpCapacityM3Hr: hydraulicSummary.totalPumpCapacityM3Hr,
    capacityStatus: hydraulicSummary.pumpCapacityStatus,
    powerStatus: hydraulicSummary.pumpPowerStatus,
  },
  // AQ-S2-002 — flow figures here are SPEC SUMS (installed capacity), and the
  // pump/pipe hydraulics are null because client-side hydraulics were retired:
  // the backend solver (POST /api/hydraulics) is the single source of truth.
  // Null is deliberate — better an honest gap than a plausible wrong number.
  hydraulicsBasis: hydraulicSummary.hydraulicsBasis,
  hydraulicsSource: hydraulicSummary.hydraulicsSource,
  pipe:{
    recommendedPipeMm: hydraulicSummary.recommendedPipeMm,
    totalDynamicHeadM: hydraulicSummary.totalDynamicHeadM,
    hydraulicPowerKw: hydraulicSummary.hydraulicPowerKw,
    totalBranchLengthM: pipework?.totalBranchLengthM || 0,
    mainHeaderLengthM: pipework?.mainHeaderLengthM || 0,
    headerDN: pipework?.headerDN || 0,
    topology: pipework?.topology || "tree",
  },
  electrical:{
    totalWatts: hydraulicSummary.totalWatts,
  },
  air:{
    totalAirFlowLpm: hydraulicSummary.totalAirFlowLpm,
  },
  flame:{
    totalFuelFlow: hydraulicSummary.totalFuelFlow,
  },
  control:{
    totalDmxChannels: hydraulicSummary.totalDmxChannels,
    digitalInputs: hydraulicSummary.totalDigitalInputs,
    digitalOutputs: hydraulicSummary.totalDigitalOutputs,
    analogInputs: hydraulicSummary.totalAnalogInputs,
    analogOutputs: hydraulicSummary.totalAnalogOutputs,
  },
  raw: hydraulicSummary,
},
  bom: [
    ...baseBomItems,
    ...(pipework?.bom || []),
  ],
    exported_at: new Date().toISOString(),
  });

/** BOM + engineering-summary CSV text (AF-NEXT-012 provenance columns included). */
export function buildBomCsv(bomItems = [], hydraulicSummary = {}) {
  const rows = [
    ["No", "Category", "Item", "Unit", "Quantity", "Flow LPM", "Flow m³/hr", "Wattage W", "Power kW", "Air LPM", "Fuel", "DMX", "DI", "DO", "AI", "AO", ...BOM_PROVENANCE_HEADERS]
  ];

  bomItems.forEach((item, index) => {
    rows.push([
      index + 1,
      item.category || "",
      item.label || item.key,
      item.unit || "pcs",
      item.quantity || 0,
      item.totalFlowLpm || 0,
      item.totalFlowM3Hr || 0,
      item.totalWattage || 0,
      item.totalPowerKw || 0,
      item.totalAirFlowLpm || 0,
      item.totalFuelFlow || 0,
      item.totalDmxChannels || 0,
      item.totalDigitalInputs || 0,
      item.totalDigitalOutputs || 0,
      item.totalAnalogInputs || 0,
      item.totalAnalogOutputs || 0,
      ...bomProvenanceCells(item)
    ]);
  });

rows.push(["", "", "", "", "", "", ""]);
 rows.push(["", "ENGINEERING SUMMARY", "", "", "", "", ""]);
rows.push(["", "Nozzle Flow", "L/min", "", hydraulicSummary.totalNozzleFlowLpm.toFixed(1), "", ""]);
rows.push(["", "Process Flow", "L/min", "", hydraulicSummary.totalProcessFlowLpm.toFixed(1), "", ""]);
rows.push(["", "Total Flow", "m³/hr", "", hydraulicSummary.totalFlowM3Hr.toFixed(2), "", ""]);
rows.push(["", "Recommended Pipe", "DN", "", hydFmt(hydraulicSummary.recommendedPipeMm, 0), "", ""]);
rows.push(["", "Total Dynamic Head", "m", "", hydFmt(hydraulicSummary.totalDynamicHeadM, 1), "", ""]);
rows.push(["", "Required Pump", "kW", "", hydFmt(hydraulicSummary.recommendedPumpKw, 2), "", ""]);
rows.push(["", "Installed Pump Power", "kW", "", hydraulicSummary.totalPumpPowerKw.toFixed(2), "", ""]);
rows.push(["", "Installed Pump Capacity", "m³/hr", "", hydraulicSummary.totalPumpCapacityM3Hr.toFixed(1), "", ""]);
rows.push(["", "Pump Status", "", "", (hydraulicSummary.pumpCapacityStatus && hydraulicSummary.pumpPowerStatus)
  ? `${hydraulicSummary.pumpCapacityStatus} / ${hydraulicSummary.pumpPowerStatus}` : HYD_NOT_CALCULATED, "", ""]);
rows.push(["", "Electrical Load", "W", "", hydraulicSummary.totalWatts.toFixed(0), "", ""]);
rows.push(["", "Air Demand", "L/min", "", hydraulicSummary.totalAirFlowLpm.toFixed(0), "", ""]);
rows.push(["", "Fuel Demand", "", "", hydraulicSummary.totalFuelFlow.toFixed(2), "", ""]);
rows.push(["", "DMX Channels", "channels", "", hydraulicSummary.totalDmxChannels, "", ""]);
rows.push(["", "Digital I/O", "", "", `${hydraulicSummary.totalDigitalInputs} IN / ${hydraulicSummary.totalDigitalOutputs} OUT`, "", ""]);
rows.push(["", "Analog I/O", "", "", `${hydraulicSummary.totalAnalogInputs} IN / ${hydraulicSummary.totalAnalogOutputs} OUT`, "", ""]);

  const csv = rows
    .map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  return csv;
}

export const safeFileName = (name) => String(name || "aquaflow_project")
  .trim()
  .replace(/[^a-z0-9_\-]+/gi, "_")
  .replace(/^_+|_+$/g, "")
  || "aquaflow_project";

/** Trigger a browser download of `content`. */
export function downloadTextFile(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
