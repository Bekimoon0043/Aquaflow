import { createSceneContract } from "./sceneContract";
import { FX_CAPABILITIES, usableCapabilities } from "./capabilities";

const WATER_STYLES = {
  clear: { type: "nozzle_straight_dn25", height: 2.2, flow: 80, diameter: 16 },
  aerated: { type: "nozzle_foam_jet_dn25", height: 1.8, flow: 70, diameter: 18 },
  laminar: { type: "nozzle_laminar_jet_dn15", height: 2.4, flow: 65, diameter: 14 },
  fan: { type: "nozzle_fan_jet", height: 1.9, flow: 70, diameter: 16 },
  crown: { type: "nozzle_crown", height: 2.0, flow: 75, diameter: 16 },
  mist: { type: "nozzle_mist", height: 0.8, flow: 25, diameter: 10 },
  rotating: { type: "rotating_jet", height: 2.4, flow: 80, diameter: 16 },
};

function fixture(id, type, label, x, y, groupId, engineering = {}, extra = {}) {
  return { id, type, label, x, y, z: 0, rotation: 0, groupId, visible: true, engineering, ...extra };
}

function lightClip(id, fixtureId, type, duration, value, color) {
  return { id, fixtureId, type, startTime: 0, duration, value, color, start: 0, end: duration, intensity: value };
}

export function buildEasyFountain(options = {}) {
  const {
    name = "Easy Fountain",
    seconds = 10,
    ringCount = 12,
    radius = 4.2,
    depth = 0.65,
    style = "clear",
    pattern = "traveling-wave",
    includeLaser = false,
    includeFlame = false,
  } = options;
  const spec = WATER_STYLES[style] || WATER_STYLES.clear;
  const duration = Math.max(1, Math.min(160, Number(seconds) || 10));
  const count = Math.max(4, Math.min(24, Math.round(ringCount)));
  const fixtures = [];
  const timelineTracks = [];
  const colors = ["#37bfff", "#6488ff", "#a6f3ff"];

  for (let index = 0; index < count; index += 1) {
    const angle = index * Math.PI * 2 / count;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const group = `wave_${String(index + 1).padStart(2, "0")}`;
    const nozzleId = `wave-nozzle-${index + 1}`;
    const valveId = `wave-valve-${index + 1}`;
    fixtures.push(fixture(nozzleId, spec.type, `Wave Jet ${index + 1}`, x, y, group, {
      jetHeightM: spec.height, flowLpm: spec.flow, nozzleDiaMm: spec.diameter,
      pressureBar: 2.3, pumpId: "main-pump", solenoidValveId: valveId,
      material: "SS316", outletCount: style === "rotating" ? 3 : 1,
      rotationRpm: style === "rotating" ? 30 : undefined,
    }));
    fixtures.push(fixture(valveId, "valve_solenoid_dn25_24v", `Wave Valve ${index + 1}`, x, y, group, {
      responseTimeS: 0.3, pumpId: "main-pump", material: "SS316",
    }));
    fixtures.push(fixture(`wave-light-${index + 1}`, "light_uw_rgb_36w", `Wave Light ${index + 1}`, x, y, group, {
      lumens: 1400, wattage: 36, beamAngleDeg: 70, pairedNozzleId: nozzleId, ipRating: "IP68",
    }, { color: colors[index % colors.length] }));
    const clips = [];
    const steps = Math.max(1, Math.round(duration * 4));
    for (let step = 0; step < steps; step += 1) {
      const start = step / 4;
      const phase = Math.PI * 2 * (start / 2.5 - index / count);
      const intensity = pattern === "all-on" ? 85 : 25 + 75 * (0.5 + 0.5 * Math.sin(phase));
      const value = Math.round(intensity * 100) / 100;
      const clipDuration = Math.min(0.25, duration - start);
      clips.push({ id: `${group}-${step}`, fixtureId: nozzleId, type: "device_intensity",
        startTime: start, duration: clipDuration, value, start, end: start + clipDuration, intensity: value });
    }
    timelineTracks.push({ id: `track-${group}`, fixtureId: nozzleId, label: `Wave sector ${index + 1}`, type: "device_intensity", clips });
  }

  fixtures.push(fixture("main-pump", "pump_inline_vfd_pump_7_5kw", "Main VFD Pump", -1, -1, "hydraulics", {
    rampTimeConstantS: 0.8, powerKw: 7.5,
  }));
  fixtures.push(fixture("center-hero", "rotating_jet", "Center Rotating Basket", 0, 0, "center", {
    jetHeightM: 3, flowLpm: 75, nozzleDiaMm: 8, rotationRpm: 30, outletCount: 3,
    pumpId: "main-pump", material: "SS316",
  }));
  fixtures.push(fixture("center-light", "light_uw_rgb_54w", "Center Light", 0.45, 0, "center", {
    lumens: 2200, wattage: 54, beamAngleDeg: 65, pairedNozzleId: "center-hero",
  }, { color: "#b8f3ff" }));
  timelineTracks.push({ id: "track-center", fixtureId: "center-hero", label: "Center breathing", type: "device_intensity", clips: [
    { id: "center-on", fixtureId: "center-hero", type: "device_intensity", startTime: 0, duration, value: 85,
      start: 0, end: duration, intensity: 85 },
  ] });
  timelineTracks.push({ id: "main-pump-speed", fixtureId: "main-pump", type: "pump_speed", clips: [
    lightClip("main-pump-speed", "main-pump", "pump_speed", duration, 70, "#00a8ff"),
  ] });
  for (let index = 0; index < count; index += 1) {
    timelineTracks.push({ id: `wave-valve-${index + 1}-open`, fixtureId: `wave-valve-${index + 1}`, type: "solenoid_open", clips: [
      lightClip(`wave-valve-${index + 1}-open`, `wave-valve-${index + 1}`, "solenoid_open", duration, 100, "#8b5cf6"),
    ] });
  }
  for (let index = 0; index < count; index += 1) {
    const base = colors[index % colors.length];
    timelineTracks.push({ id: `wave-light-${index + 1}-master`, fixtureId: `wave-light-${index + 1}`, type: "lighting_master", clips: [
      lightClip(`wave-light-${index + 1}-master`, `wave-light-${index + 1}`, "lighting_master", duration, 100, base),
    ] });
  }
  timelineTracks.push({ id: "center-light-master", fixtureId: "center-light", type: "lighting_master", clips: [
    lightClip("center-light-master", "center-light", "lighting_master", duration, 100, "#b8f3ff"),
  ] });

  if (includeLaser) {
    fixtures.push(fixture("show-laser", "laser", "Laser Fan", 0, -5, "laser", {
      opticalPowerW: 5, wavelengthNm: [450, 532, 635], divergenceMrad: 1,
      scanAngleDeg: 30, aimDeg: 25, hazeDensity: 0.03,
    }, { color: "#40a0ff" }));
    timelineTracks.push({ id: "show-laser-intensity", fixtureId: "show-laser", type: "laser_intensity", clips: [
      lightClip("show-laser-intensity", "show-laser", "laser_intensity", duration, 65, "#40a0ff"),
    ] });
  }
  if (includeFlame) {
    fixtures.push(fixture("show-flame", "effect_flame_single", "Flame Feature", 0, -2, "flame", {
      heightM: 1.5, heatLightW: 300, smokeDensity: 0.08,
    }, { color: "#ff7722" }));
    timelineTracks.push({ id: "show-flame-intensity", fixtureId: "show-flame", type: "fire_intensity", clips: [
      lightClip("show-flame-intensity", "show-flame", "fire_intensity", duration, 65, "#ff7722"),
    ] });
  }

  const scene = createSceneContract({
    seed: 1234,
    capabilities: usableCapabilities().map(([id]) => id),
    notes: [
      "Laser and flame entries are visualization proxies, not safety-certified combustion/laser simulations.",
      "Hydraulic and photometric values are generic estimates, not manufacturer data.",
    ],
  });
  const engineering = {
    format: "AquaFlowPoolGeometry", version: "1.0", id: "easy-fountain-site",
    name, pool_type: "circular",
    params: { width: radius * 2.8, length: radius * 2.8, radius: radius * 1.4, depth, units: "m" },
    geometry: { type: "circle", center: { x: 0, y: 0 }, radius: radius * 1.4 },
    fixtures,
    site_models: [], site_surfaces: [], manualPipes: [], pipes: [],
  };
  return {
    aquafx: scene,
    engineering,
    currentShow: { id: "easy-fountain-show", name, bpm: 120, duration, sampleRate: 48000, loop: true },
    timelineTracks,
    nodes: [], connections: [], devices: [],
    render: {
      environment: "night", cameraMode: "named", quality: "high", advancedNozzles: true,
      exportResolution: "1080p", exportFps: 30, bakeStart: 0, bakeDuration: duration,
      activeCameraView: "three-quarter",
      cameraViews: [
        { id: "three-quarter", name: "Three-quarter", position: { x: 8, y: 4.5, z: -10 }, target: { x: 0, y: 1.2, z: 0 } },
        { id: "audience", name: "Audience", position: { x: 0, y: 3, z: -15 }, target: { x: 0, y: 1.4, z: 0 } },
      ],
    },
  };
}

export const EASY_WATER_STYLES = Object.keys(WATER_STYLES);
export const EASY_FX_CAPABILITIES = FX_CAPABILITIES;
