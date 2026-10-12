import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(here, "..", "..", "outputs", "Reference_Keyhole_Crown_Fountain.aqua");
const round = (value) => Number(value.toFixed(3));

const basinPoints = [
  [-3.0, -15.0], [-3.0, -10.0], [-6.2, -8.0], [-8.7, -5.5],
  [-10.0, -2.0], [-9.7, 2.5], [-8.0, 6.0], [-4.5, 9.0],
  [0.0, 10.0], [4.5, 9.0], [8.0, 6.0], [9.7, 2.5],
  [10.0, -2.0], [8.7, -5.5], [6.2, -8.0], [3.0, -10.0],
  [3.0, -15.0],
].map(([x, y]) => ({ x, y }));

const crowns = [
  { id: "crown-nw", label: "North-west crown", x: -4.4, y: 3.2, groupId: "outer_ring_jets", phase: 0.0 },
  { id: "crown-n", label: "North crown", x: 0.0, y: 4.8, groupId: "arch_jets", phase: 0.7 },
  { id: "crown-ne", label: "North-east crown", x: 4.4, y: 3.2, groupId: "cascade_jets", phase: 1.4 },
  { id: "crown-sw", label: "South-west crown", x: -3.6, y: -3.4, groupId: "motion_1d_jets", phase: 2.1 },
  { id: "crown-se", label: "South-east crown", x: 3.6, y: -3.4, groupId: "motion_2d_jets", phase: 2.8 },
];

const fixtures = [];
for (const crown of crowns) {
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const wave = 0.5 + 0.5 * Math.sin(angle + crown.phase);
    fixtures.push({
      id: `${crown.id}-${String(index + 1).padStart(2, "0")}`,
      type: "nozzle_straight_dn15",
      label: `${crown.label} ${String(index + 1).padStart(2, "0")}`,
      x: round(crown.x + Math.cos(angle) * 1.35),
      y: round(crown.y + Math.sin(angle) * 1.35),
      z: 0,
      rotation: round(angle * 180 / Math.PI),
      zone: crown.id,
      groupId: crown.groupId,
      engineering: {
        flowLpm: 34,
        pressureBar: 2.6,
        jetHeightM: round(3.4 + wave * 2.8),
        boreMm: 15,
        designBasis: "Estimated from supplied reference frames",
      },
    });
  }
}

fixtures.push({
  id: "hero-center-jet",
  type: "nozzle_straight_dn40",
  label: "Hero center jet",
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  zone: "center",
  groupId: "center_jets",
  engineering: {
    flowLpm: 180,
    pressureBar: 5.2,
    jetHeightM: 14,
    boreMm: 40,
    designBasis: "Estimated from supplied reference frames",
  },
});

// Five lights per crown plus a brighter center light reproduce the white/cool glow.
for (const crown of crowns) {
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2 + Math.PI / 5;
    fixtures.push({
      id: `light-${crown.id}-${index + 1}`,
      type: "light_uw_rgb_18w",
      label: `${crown.label} light ${index + 1}`,
      x: round(crown.x + Math.cos(angle) * 1.05),
      y: round(crown.y + Math.sin(angle) * 1.05),
      z: -0.15,
      rotation: round(angle * 180 / Math.PI),
      zone: crown.id,
      groupId: "rgb_lights",
      color: "#dff8ff",
      engineering: { wattage: 18, beamRadiusM: 3.5, color: "#dff8ff" },
    });
  }
}
fixtures.push({
  id: "light-center",
  type: "light_uw_rgb_54w",
  label: "Hero center light",
  x: 0,
  y: 0,
  z: -0.2,
  rotation: 0,
  zone: "center",
  groupId: "rgb_lights",
  color: "#ffffff",
  engineering: { wattage: 54, beamRadiusM: 6, color: "#ffffff" },
});

for (let index = 0; index < 3; index += 1) {
  fixtures.push({
    id: `design-pump-${index + 1}`,
    type: "pump_end_suction_pump_18_5kw",
    label: `Design pump ${index + 1}`,
    x: -13 + index * 2,
    y: 8.5,
    z: 0,
    rotation: 0,
    zone: "plant-room",
    groupId: null,
    engineering: {
      powerKw: 18.5,
      ratedFlowM3Hr: 50,
      ratedHeadM: 28,
      designOnly: true,
    },
  });
}

const model = (id, name, assetId, x, z, rotationY = 0, scale = 1) => ({
  id, name, type: "model", visible: true,
  transform: { position: { x, y: 0, z }, rotation: { x: 0, y: rotationY, z: 0 }, scale },
  props: { assetId },
});

const siteModels = [
  model("audience-1", "Audience · reading", "venue:person-reading", -12, -5, 70),
  model("audience-2", "Audience · walking", "venue:person-walking", 12, -6, -65),
  model("audience-3", "Audience · standing", "venue:woman-standing", -11, 5, 110),
  model("audience-4", "Audience · standing", "venue:man-standing", 11, 5, -110),
  model("audience-5", "Audience · waving", "venue:man-waving", 0, 12, 180),
  model("audience-6", "Audience · walking", "venue:woman-walking", 8, -11, -35),
  ...Array.from({ length: 8 }, (_, index) => {
    const x = -15.5 + index * 4.4;
    return model(`background-tree-${index + 1}`, `Background tree ${index + 1}`,
      `venue:tree-common-${(index % 3) + 1}`, x, 16.5 + (index % 2) * 1.2, index * 31, 0.9 + (index % 3) * 0.08);
  }),
  ...Array.from({ length: 6 }, (_, index) => {
    const x = -18 + index * 7.2;
    return model(`background-building-${index + 1}`, `Background building ${index + 1}`,
      `venue:building-${["medium", "large", "small"][index % 3]}`, x, 25 + (index % 2) * 2.5, 180, 1.15);
  }),
];

const states = [
  { label: "Five crowns rise", values: [82, 94, 80, 74, 88] },
  { label: "Rear trio", values: [88, 100, 64, 22, 28] },
  { label: "Sweep to east", values: [34, 62, 100, 48, 94] },
  { label: "Opposing crowns", values: [72, 86, 82, 28, 62] },
  { label: "East-side crescendo", values: [24, 70, 100, 18, 96] },
  { label: "Full crown finale", values: [96, 92, 98, 88, 94] },
];

const makeGroupTrack = (crown, crownIndex) => ({
  id: `track-${crown.groupId}`,
  label: crown.label,
  color: ["#38bdf8", "#818cf8", "#22d3ee", "#a78bfa", "#60a5fa"][crownIndex],
  type: "pump",
  deviceId: `controller-${crown.id}`,
  muted: false,
  solo: false,
  clips: states.map((state, stateIndex) => ({
    id: `cue-${crown.id}-${stateIndex + 1}`,
    start: stateIndex * 6,
    end: (stateIndex + 1) * 6,
    label: state.label,
    intensity: state.values[crownIndex],
    groupId: crown.groupId,
    fadeIn: stateIndex ? 0.35 : 0.7,
    fadeOut: stateIndex === states.length - 1 ? 0.9 : 0.2,
  })),
});

const timelineTracks = [
  {
    id: "track-center-hero", label: "Hero center jet", color: "#e0f2fe", type: "pump",
    deviceId: "controller-center", muted: false, solo: false,
    clips: [{
      id: "cue-center-hero", start: 0, end: 36, label: "Continuous hero column",
      intensity: 100, groupId: "center_jets", fadeIn: 1.1, fadeOut: 1.2,
    }],
  },
  ...crowns.map(makeGroupTrack),
  {
    id: "track-cool-white-light", label: "Cool-white underwater wash", color: "#dff8ff", type: "lighting",
    deviceId: "controller-lighting", muted: false, solo: false,
    clips: [{
      id: "cue-cool-white-light", start: 0, end: 36, label: "Reference white glow",
      intensity: 88, groupId: "rgb_lights", color: "#dff8ff", fadeIn: 1, fadeOut: 1,
    }],
  },
];

const devices = [
  { id: "controller-center", label: "Center jet VFD", type: "pump", protocol: "virtual", status: "offline", health: 0 },
  ...crowns.map(crown => ({
    id: `controller-${crown.id}`, label: `${crown.label} valve bank`, type: "valve",
    protocol: "virtual", status: "offline", health: 0,
  })),
  { id: "controller-lighting", label: "Underwater RGB controller", type: "lighting", protocol: "virtual", status: "offline", health: 0 },
];

const nodes = devices.map((device, index) => ({
  id: `node-${device.id}`,
  type: device.type,
  label: device.label,
  x: 100 + (index % 3) * 230,
  y: 80 + Math.floor(index / 3) * 140,
  width: 180,
  height: 80,
  ports: { in: ["trigger", "intensity"], out: ["feedback"] },
  params: { designOnly: true },
  protocol: "virtual",
  deviceId: device.id,
}));

const engineering = {
  format: "AquaFlowPoolGeometry",
  version: "0.11A",
  id: "reference-keyhole-crown-fountain-v1",
  name: "Reference Keyhole Crown Fountain",
  pool_type: "freeform",
  params: { width: 20, length: 25, radius: 10, depth: 0.65 },
  geometry: { type: "freeform", points: basinPoints, closed: true },
  fixtures,
  site_models: siteModels,
  layers: [],
  measurements: [],
  depth_zones: [],
  manualPipes: [],
  pipes: [],
  hydraulics: {
    totalFlowM3Hr: 133.2,
    recommendedPipeMm: 200,
    totalDynamicHeadM: 28,
    recommendedPumpKw: 48.5,
    totalWatts: 504,
  },
  solved_hydraulics: null,
  bom: [],
  reference_analysis: {
    confidence: "concept reconstruction",
    sourceFrames: 5,
    assumptions: [
      "Dimensions inferred from people and basin proportions; verify before construction.",
      "Five satellite crowns use twelve straight jets each, plus one central hero jet.",
      "Timeline recreates the visible traveling-height choreography, not the unseen original controller program.",
    ],
  },
};

const file = {
  aquaflow: "1.0",
  savedAt: new Date().toISOString(),
  show: {
    id: "show-reference-keyhole-crown-v1",
    name: "Reference Keyhole Crown Fountain",
    bpm: 120,
    duration: 36,
    sampleRate: 48000,
    loop: true,
  },
  nodes,
  connections: [],
  timelineTracks,
  devices,
  engineering,
  ui: { timelineZoom: 8, showGrid: true, snapToGrid: true },
};

if (fixtures.filter(fixture => fixture.type.startsWith("nozzle_")).length !== 61) {
  throw new Error("Expected 61 water outlets");
}
if (timelineTracks.length !== 7 || basinPoints.length < 12) {
  throw new Error("Generated show is incomplete");
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputPath,
  basinPoints: basinPoints.length,
  waterOutlets: 61,
  lights: 26,
  pumps: 3,
  siteModels: siteModels.length,
  timelineTracks: timelineTracks.length,
  cues: timelineTracks.reduce((sum, track) => sum + track.clips.length, 0),
  durationSeconds: file.show.duration,
}, null, 2));
