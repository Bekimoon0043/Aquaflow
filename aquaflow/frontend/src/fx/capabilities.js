export const FX_CAPABILITY_STATUS = Object.freeze({
  WORKING: "working",
  PROXY: "proxy",
  ENGINE: "engine",
  PLANNED: "planned",
});

export const FX_CAPABILITIES = Object.freeze({
  clear_jet: { label: "Clear and straight jets", status: "working", tier: "L1" },
  aerated_jet: { label: "Aerated and foam jets", status: "working", tier: "L1" },
  laminar_jet: { label: "Laminar and arch jets", status: "working", tier: "L1" },
  fan_crown: { label: "Fan, crown and multi-outlet jets", status: "working", tier: "L1" },
  bell_cascade: { label: "Bells, cascades and water screens", status: "proxy", tier: "L1" },
  mist_fog: { label: "Mist and fog", status: "proxy", tier: "L1" },
  rotating_basket: { label: "Rotating basket / pirouette", status: "working", tier: "L1" },
  digital_curtain: { label: "Digital water curtain", status: "engine", tier: "L1" },
  air_shooter: { label: "Compressed-air shooter", status: "engine", tier: "L1" },
  underwater_light: { label: "Underwater RGB/RGBW lights", status: "working", tier: "L1" },
  moving_light: { label: "Moving-head and gobo lights", status: "working", tier: "L1" },
  laser: { label: "Laser visualization", status: "proxy", tier: "L1" },
  flame: { label: "Flame and heat-light visualization", status: "proxy", tier: "L1" },
  co2_confetti: { label: "CO2 and confetti", status: "planned", tier: "L2" },
  fireworks: { label: "Pyrotechnic visualization", status: "planned", tier: "L2" },
  true_fluid: { label: "Native Mantaflow hero liquid", status: "working", tier: "L2" },
  drone_show: { label: "Drone show simulation", status: "planned", tier: "L2" },
});

export function usableCapabilities() {
  return Object.entries(FX_CAPABILITIES).filter(([, value]) => value.status !== "planned");
}
