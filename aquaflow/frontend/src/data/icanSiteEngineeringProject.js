/**
 * Engineering model of the commissioned 4KILO I-CAN fountain site.
 *
 * Counts and functional grouping come from the operator's site drawing and the
 * recovered legacy controller database. Coordinates and hydraulic sizes remain
 * provisional until a measured survey and pump/nozzle nameplates are recorded.
 */

export const ICAN_SITE_PROJECT_NAME = "4KILO Site Fountain - Survey Pending";

export const ICAN_SITE_LAYOUT_SUMMARY = Object.freeze({
  runningNozzles: 76,
  runningSections: 19,
  nozzlesPerRunningSection: 4,
  foamLeftNozzles: 8,
  foamRightNozzles: 8,
  peacockNozzles: 8,
  totalWaterNozzles: 100,
  runningPumps: 4,
  foamPumps: 2,
  peacockPumps: 1,
  totalPumps: 7,
  dimensionStatus: "provisional",
});

const round = value => Number(value.toFixed(3));

function runningPosition(index) {
  const t = index / (ICAN_SITE_LAYOUT_SUMMARY.runningNozzles - 1);
  return {
    x: round(2 + (32 * t)),
    y: round(5 + (6 * Math.sin(Math.PI * t))),
  };
}

function capturedValveAddress(valveIndex) {
  if (valveIndex <= 32) return { group: 1, channel: valveIndex + 8 };
  if (valveIndex <= 64) return { group: 9, channel: valveIndex - 24 };
  return null;
}

function makeRunningNozzles() {
  return Array.from({ length: ICAN_SITE_LAYOUT_SUMMARY.runningNozzles }, (_, offset) => {
    const valveIndex = offset + 1;
    const sectionIndex = Math.floor(offset / 4) + 1;
    const memberIndex = (offset % 4) + 1;
    const address = capturedValveAddress(valveIndex);
    const position = runningPosition(offset);
    return {
      id: `rf-${String(valveIndex).padStart(2, "0")}`,
      type: "nozzle_running",
      label: `Running ${String(sectionIndex).padStart(2, "0")}.${memberIndex}`,
      x: position.x,
      y: position.y,
      z: 0,
      rotation: 0,
      zone: `rf-section-${String(sectionIndex).padStart(2, "0")}`,
      groupId: "running_fountain_jets",
      engineering: {
        siteFunction: "running-fountain",
        sectionIndex,
        memberIndex,
        legacyValveIndex: valveIndex,
        icanGroup: address?.group ?? null,
        icanChannel: address?.channel ?? null,
        mappingStatus: address ? "capture-derived" : "commissioning-required",
        pumpCircuit: "running-fountain-pump-bank",
        physicalPumpCount: 4,
        independentlyValved: true,
        jetHeightM: 3,
        flowLpm: null,
        pressureBar: null,
        connectionSize: "TBC",
        designBasis: "layout-confirmed; dimensions and hydraulics provisional",
      },
    };
  });
}

function arcBank({ prefix, label, count, cx, cy, radius, start, end, zone, groupId, type, engineering }) {
  return Array.from({ length: count }, (_, offset) => {
    const t = count === 1 ? 0.5 : offset / (count - 1);
    const angle = start + ((end - start) * t);
    return {
      id: `${prefix}-${String(offset + 1).padStart(2, "0")}`,
      type,
      label: `${label} ${offset + 1}`,
      x: round(cx + (Math.cos(angle) * radius)),
      y: round(cy + (Math.sin(angle) * radius)),
      z: 0,
      rotation: round(angle - (Math.PI / 2)),
      zone,
      groupId,
      engineering: {
        ...engineering,
        outletIndex: offset + 1,
        mappingStatus: "logical-function-confirmed; individual-address-not-present",
        independentlyValved: false,
        designBasis: "layout-confirmed; dimensions and hydraulics provisional",
      },
    };
  });
}

function makeWaterNozzles() {
  const foamCommon = {
    siteFunction: "foam",
    pumpCircuit: "foam-pump",
    physicalPumpCount: 1,
    jetHeightM: 2.5,
    flowLpm: null,
    pressureBar: null,
    connectionSize: "TBC",
  };
  const leftFoam = arcBank({
    prefix: "foam-left", label: "Foam Left", count: 8,
    cx: 7.2, cy: 4.7, radius: 3.2, start: Math.PI * 1.05, end: Math.PI * 1.82,
    zone: "foam-left", groupId: "foam_jets", type: "nozzle_foam_dn40",
    engineering: { ...foamCommon, side: "left" },
  });
  const rightFoam = arcBank({
    prefix: "foam-right", label: "Foam Right", count: 8,
    cx: 28.8, cy: 4.7, radius: 3.2, start: Math.PI * 1.18, end: Math.PI * 1.95,
    zone: "foam-right", groupId: "foam_jets", type: "nozzle_foam_dn40",
    engineering: { ...foamCommon, side: "right" },
  });
  const peacock = Array.from({ length: 8 }, (_, offset) => ({
    id: `peacock-${String(offset + 1).padStart(2, "0")}`,
    type: "nozzle_fan_medium",
    label: `Peacock ${offset + 1}`,
    x: round(14.5 + (offset * 1.0)),
    y: 2.65,
    z: 0,
    rotation: 0,
    zone: "peacock-center",
    groupId: "peacock_jets",
    engineering: {
      siteFunction: "peacock",
      outletIndex: offset + 1,
      pumpCircuit: "peacock-vfd-pump",
      physicalPumpCount: 1,
      mappingStatus: "frequency-function-confirmed; setpoints-commissioning-locked",
      independentlyValved: false,
      variableFrequency: true,
      jetHeightM: 4,
      flowLpm: null,
      pressureBar: null,
      connectionSize: "TBC",
      designBasis: "layout-confirmed; dimensions and hydraulics provisional",
    },
  }));
  return [...makeRunningNozzles(), ...leftFoam, ...rightFoam, ...peacock];
}

function makeEquipment() {
  const pumps = [
    ...Array.from({ length: 4 }, (_, offset) => ({
      id: `pump-running-${offset + 1}`,
      type: "pump",
      label: `Running Pump ${offset + 1}`,
      x: 12.5 + (offset * 1.5), y: 15.2, z: 0, rotation: 0,
      zone: "plant-room", groupId: null,
      engineering: {
        siteFunction: "running-fountain", logicalCommand: "I-CAN G17 C29",
        mappingStatus: "legacy-config-confirmed; physical-commissioning-required",
        powerKw: null, capacityM3Hr: null, headM: null,
      },
    })),
    ...Array.from({ length: 2 }, (_, offset) => ({
      id: `pump-foam-${offset + 1}`, type: "pump", label: `Foam Pump ${offset + 1}`,
      x: 19 + (offset * 1.5), y: 15.2, z: 0, rotation: 0, zone: "plant-room", groupId: null,
      engineering: {
        siteFunction: "foam", logicalCommand: "I-CAN G17 C30",
        mappingStatus: "two-physical-motors-confirmed; shared-logical-command-requires-commissioning",
        physicalPumpIndex: offset + 1,
        powerKw: null, capacityM3Hr: null, headM: null,
      },
    })),
    {
      id: "pump-peacock-1", type: "pump", label: "Peacock Pump",
      x: 22, y: 15.2, z: 0, rotation: 0, zone: "plant-room", groupId: null,
      engineering: {
        siteFunction: "peacock", logicalCommand: "I-CAN Group 2 frequency controller",
        mappingStatus: "legacy-config-confirmed; frequency-setpoints-commissioning-locked",
        variableFrequency: true, powerKw: null, capacityM3Hr: null, headM: null,
      },
    },
  ];
  const vfd = {
    id: "vfd-peacock-1", type: "vfd", label: "Peacock VFD",
    x: 23.5, y: 15.2, z: 0, rotation: 0, zone: "plant-room", groupId: null,
    engineering: {
      siteFunction: "peacock", protocolFunction: "I-CAN Group 2",
      mappingStatus: "protected-until-frequency-commissioning",
      powerKw: null, frequencyHz: null,
    },
  };
  return [...pumps, vfd];
}

const POOL_POINTS = [
  { x: 0.5, y: 1.0 }, { x: 35.5, y: 1.0 }, { x: 36.0, y: 5.5 },
  { x: 33.0, y: 10.0 }, { x: 25.0, y: 13.0 }, { x: 18.0, y: 14.0 },
  { x: 11.0, y: 13.0 }, { x: 3.0, y: 10.0 }, { x: 0.0, y: 5.5 },
];

export function createICANSiteEngineeringProject() {
  const waterFixtures = makeWaterNozzles();
  const equipment = makeEquipment();
  return {
    format: "AquaFlowPoolGeometry",
    version: "1.0",
    name: ICAN_SITE_PROJECT_NAME,
    id: "ican-4kilo-site-v1",
    pool_type: "freeform",
    params: {
      width: 36,
      length: 13,
      depth: 0.8,
      radius: 8,
      dimensionStatus: "provisional-pending-site-survey",
    },
    geometry: { type: "freeform", points: POOL_POINTS.map(point => ({ ...point })), closed: true },
    fixtures: [...waterFixtures, ...equipment],
    layers: [],
    measurements: [
      { id: "provisional-length", x1: 0, y1: 0.35, x2: 36, y2: 0.35, status: "provisional" },
      { id: "provisional-width", x1: 36.6, y1: 1, x2: 36.6, y2: 14, status: "provisional" },
    ],
    depth_zones: [{
      id: "site-basin", zone: "site-basin", label: "Existing basin - depth TBC",
      depth: 0.8, color: "#0878a8", points: POOL_POINTS.map(point => ({ ...point })),
      status: "provisional",
    }],
    manualPipes: [],
    pipes: [],
    hydraulics: null,
    solved_hydraulics: null,
    bom: [],
    site_model: {
      layoutSource: "operator site drawing 2026-09-15",
      legacyController: "I-CAN NETCAN / 4KILO Music Fountain Control System",
      counts: { ...ICAN_SITE_LAYOUT_SUMMARY },
      confirmed: [
        "76 running nozzles arranged as 19 consecutive sections of four",
        "8 left foam and 8 right foam wide-water outlets on one foam function",
        "8 center-front peacock outlets on one variable-frequency function",
        "four running pumps, two foam pumps and one peacock pump",
      ],
      pending: [
        "surveyed basin and fixture coordinates",
        "pump nameplate power, capacity and head",
        "nozzle sizes, design flow and pressure",
        "pipe routes and diameters",
        "I-CAN mapping for running valves 65-76",
        "whether the two physical foam pumps have separate I-CAN commands or share G17 C30",
        "safe peacock frequency limits",
      ],
    },
  };
}

export function getICANSiteWaterFixtures(project = createICANSiteEngineeringProject()) {
  return project.fixtures.filter(fixture => String(fixture.type).startsWith("nozzle_"));
}
