/**
 * fixtureTypeResolver.js — AquaFlow Single Fixture Type Resolver (EXPANDED v2.0)
 *
 * Single source of truth for:
 * Engineering fixture type → runtime type / category / device type / group / channels / metadata
 *
 * EXPANDED: 102 fixture types with realistic engineering metadata
 * 
 * IMPORTANT:
 * Frontend-only. No fetch. No WebSocket. No DMX. No Art-Net. No Modbus. No relay. No hardware activation.
 */

// ============================================================
// ENGINEERING METADATA CONSTANTS
// ============================================================

export const PUMP_CLASSES = Object.freeze({
  class_1:  { minFlow: 0,    maxFlow: 50,    minPressure: 0,  maxPressure: 2,   powerRange: "0.5-2 kW",   description: "Small decorative nozzles" },
  class_2:  { minFlow: 50,   maxFlow: 200,   minPressure: 2,  maxPressure: 5,   powerRange: "2-7.5 kW",   description: "Medium display nozzles" },
  class_3:  { minFlow: 200,  maxFlow: 500,   minPressure: 5,  maxPressure: 10,  powerRange: "7.5-15 kW",  description: "Large effect nozzles" },
  class_4:  { minFlow: 500,  maxFlow: 1500,  minPressure: 10, maxPressure: 25,  powerRange: "15-45 kW",  description: "High-throw jets" },
  class_5:  { minFlow: 1500, maxFlow: 5000,  minPressure: 25, maxPressure: 50,  powerRange: "45-110 kW", description: "Extreme height jets" },
  class_6:  { minFlow: 5000, maxFlow: 10000, minPressure: 50, maxPressure: 100, powerRange: "110-400 kW", description: "Monumental jets" },
});

export const PREVIEW_CATEGORIES = Object.freeze({
  water_jet:       { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#00d4ff", icon: "💧" },
  water_foam:      { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#a5f3fc", icon: "🫧" },
  water_cascade:   { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#7dd3fc", icon: "🌊" },
  water_mist:      { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: false, color: "#c4b5fd", icon: "🌫️" },
  water_screen:    { hasWaterEffect: true,  hasParticleSystem: false, hasJetAnimation: false, color: "#818cf8", icon: "🖥️" },
  water_burst:     { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#38bdf8", icon: "💥" },
  water_jump:      { hasWaterEffect: true,  hasParticleSystem: false, hasJetAnimation: true,  color: "#22d3ee", icon: "🏃" },
  water_digital:   { hasWaterEffect: true,  hasParticleSystem: false, hasJetAnimation: true,  color: "#06b6d4", icon: "🔢" },
  water_air:       { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#e0f2fe", icon: "💨" },
  water_comet:     { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#67e8f9", icon: "☄️" },
  water_peacock:   { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#2dd4bf", icon: "🦚" },
  water_tulip:     { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#f472b6", icon: "🌷" },
  water_bell:      { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#93c5fd", icon: "🔔" },
  water_spiral:    { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#a78bfa", icon: "🌀" },
  water_dome:      { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#60a5fa", icon: "⛱️" },
  water_finger:    { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#34d399", icon: "👆" },
  water_rocket:    { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#f87171", icon: "🚀" },
  water_sphere:    { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#818cf8", icon: "🔮" },
  water_volcano:   { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#fb923c", icon: "🌋" },
  water_swing:     { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#fbbf24", icon: "🎢" },
  water_pirouette: { hasWaterEffect: true,  hasParticleSystem: true,  hasJetAnimation: true,  color: "#f472b6", icon: "💃" },
  light_emitter:   { hasWaterEffect: false, hasParticleSystem: false, hasJetAnimation: false, color: "#f59e0b", icon: "💡" },
  laser_beam:      { hasWaterEffect: false, hasParticleSystem: false, hasJetAnimation: false, color: "#ec4899", icon: "⚡" },
  fire_effect:     { hasWaterEffect: false, hasParticleSystem: true,  hasJetAnimation: false, color: "#f97316", icon: "🔥" },
  fog_emitter:     { hasWaterEffect: false, hasParticleSystem: true,  hasJetAnimation: false, color: "#6b7280", icon: "🌫️" },
  sensor_point:    { hasWaterEffect: false, hasParticleSystem: false, hasJetAnimation: false, color: "#88ff88", icon: "📊" },
  equipment_box:   { hasWaterEffect: false, hasParticleSystem: false, hasJetAnimation: false, color: "#94a3b8", icon: "⚙️" },
  motion_1d:       { hasWaterEffect: false, hasParticleSystem: false, hasJetAnimation: false, color: "#38bdf8", icon: "↔️" },
  motion_2d:       { hasWaterEffect: false, hasParticleSystem: false, hasJetAnimation: false, color: "#38bdf8", icon: "☖" },
  motion_3d:       { hasWaterEffect: false, hasParticleSystem: false, hasJetAnimation: false, color: "#38bdf8", icon: "⬚" },
  spark_effect:    { hasWaterEffect: false, hasParticleSystem: true,  hasJetAnimation: false, color: "#fef08a", icon: "✨" },
  cryo_effect:     { hasWaterEffect: false, hasParticleSystem: true,  hasJetAnimation: false, color: "#e0f2fe", icon: "❄️" },
  bubble_effect:   { hasWaterEffect: false, hasParticleSystem: true,  hasJetAnimation: false, color: "#a5f3fc", icon: "🫧" },
  snow_effect:     { hasWaterEffect: false, hasParticleSystem: true,  hasJetAnimation: false, color: "#f8fafc", icon: "❄️" },
  confetti_effect: { hasWaterEffect: false, hasParticleSystem: true,  hasJetAnimation: false, color: "#f472b6", icon: "🎊" },
  wind_effect:     { hasWaterEffect: false, hasParticleSystem: true,  hasJetAnimation: false, color: "#cbd5e1", icon: "💨" },
  scent_emitter:   { hasWaterEffect: false, hasParticleSystem: true,  hasJetAnimation: false, color: "#a78bfa", icon: "🌸" },
});

// ============================================================
// DEFAULT ANIMATION PRESETS
// ============================================================

export const DEFAULT_ANIMATION_PRESETS = Object.freeze({
  // Water effect presets
  water_pulse:       { name: "Pulse",          duration: 2000,  easing: "ease_in_out",  keyframes: [{ t: 0, intensity: 0 }, { t: 0.5, intensity: 255 }, { t: 1, intensity: 0 }] },
  water_fade_in:     { name: "Fade In",        duration: 3000,  easing: "ease_out",     keyframes: [{ t: 0, intensity: 0 }, { t: 1, intensity: 255 }] },
  water_fade_out:    { name: "Fade Out",       duration: 3000,  easing: "ease_in",      keyframes: [{ t: 0, intensity: 255 }, { t: 1, intensity: 0 }] },
  water_strobe:      { name: "Strobe",         duration: 1000,  easing: "linear",         keyframes: [{ t: 0, intensity: 255 }, { t: 0.1, intensity: 0 }, { t: 0.2, intensity: 255 }, { t: 0.3, intensity: 0 }, { t: 0.4, intensity: 255 }, { t: 0.5, intensity: 0 }, { t: 0.6, intensity: 255 }, { t: 0.7, intensity: 0 }, { t: 0.8, intensity: 255 }, { t: 0.9, intensity: 0 }, { t: 1, intensity: 255 }] },
  water_sweep_up:    { name: "Sweep Up",       duration: 4000,  easing: "ease_both",    keyframes: [{ t: 0, intensity: 0, height: 0 }, { t: 0.5, intensity: 255, height: 100 }, { t: 1, intensity: 0, height: 0 }] },
  water_burst:       { name: "Burst",          duration: 1500,  easing: "ease_out",       keyframes: [{ t: 0, intensity: 0 }, { t: 0.2, intensity: 255 }, { t: 0.4, intensity: 0 }, { t: 0.6, intensity: 255 }, { t: 0.8, intensity: 0 }, { t: 1, intensity: 255 }] },
  water_cascade:     { name: "Cascade Flow",   duration: 5000,  easing: "ease_in_out",  keyframes: [{ t: 0, intensity: 50 }, { t: 0.3, intensity: 200 }, { t: 0.6, intensity: 100 }, { t: 1, intensity: 50 }] },
  water_ripple:      { name: "Ripple",         duration: 6000,  easing: "sine",           keyframes: [{ t: 0, intensity: 100 }, { t: 0.25, intensity: 200 }, { t: 0.5, intensity: 100 }, { t: 0.75, intensity: 200 }, { t: 1, intensity: 100 }] },
  water_geyser:      { name: "Geyser Erupt",   duration: 2500,  easing: "ease_out",       keyframes: [{ t: 0, intensity: 0, height: 0 }, { t: 0.3, intensity: 255, height: 100 }, { t: 0.7, intensity: 180, height: 80 }, { t: 1, intensity: 0, height: 0 }] },
  water_fountain:    { name: "Fountain Dance", duration: 8000,  easing: "ease_both",    keyframes: [{ t: 0, intensity: 0 }, { t: 0.1, intensity: 80 }, { t: 0.2, intensity: 200 }, { t: 0.3, intensity: 120 }, { t: 0.4, intensity: 255 }, { t: 0.5, intensity: 100 }, { t: 0.6, intensity: 220 }, { t: 0.7, intensity: 60 }, { t: 0.8, intensity: 180 }, { t: 0.9, intensity: 90 }, { t: 1, intensity: 0 }] },

  // Lighting presets
  light_fade_rgb:    { name: "RGB Fade",       duration: 4000,  easing: "linear",         keyframes: [{ t: 0, r: 255, g: 0, b: 0 }, { t: 0.33, r: 0, g: 255, b: 0 }, { t: 0.66, r: 0, g: 0, b: 255 }, { t: 1, r: 255, g: 0, b: 0 }] },
  light_strobe_white:{ name: "White Strobe",   duration: 1000,  easing: "linear",         keyframes: [{ t: 0, intensity: 255 }, { t: 0.05, intensity: 0 }, { t: 0.1, intensity: 255 }, { t: 0.15, intensity: 0 }, { t: 0.2, intensity: 255 }, { t: 0.25, intensity: 0 }, { t: 0.3, intensity: 255 }, { t: 0.35, intensity: 0 }, { t: 0.4, intensity: 255 }, { t: 0.45, intensity: 0 }, { t: 0.5, intensity: 255 }, { t: 0.55, intensity: 0 }, { t: 0.6, intensity: 255 }, { t: 0.65, intensity: 0 }, { t: 0.7, intensity: 255 }, { t: 0.75, intensity: 0 }, { t: 0.8, intensity: 255 }, { t: 0.85, intensity: 0 }, { t: 0.9, intensity: 255 }, { t: 0.95, intensity: 0 }, { t: 1, intensity: 255 }] },
  light_chase:       { name: "Chase",          duration: 3000,  easing: "linear",         keyframes: [{ t: 0, intensity: 255, pan: 0 }, { t: 0.25, intensity: 255, pan: 90 }, { t: 0.5, intensity: 255, pan: 180 }, { t: 0.75, intensity: 255, pan: 270 }, { t: 1, intensity: 255, pan: 360 }] },
  light_breathe:     { name: "Breathe",        duration: 4000,  easing: "sine",           keyframes: [{ t: 0, intensity: 20 }, { t: 0.5, intensity: 255 }, { t: 1, intensity: 20 }] },
  light_sparkle:     { name: "Sparkle",        duration: 2000,  easing: "linear",         keyframes: [{ t: 0, intensity: 50 }, { t: 0.1, intensity: 255 }, { t: 0.2, intensity: 30 }, { t: 0.3, intensity: 255 }, { t: 0.4, intensity: 40 }, { t: 0.5, intensity: 255 }, { t: 0.6, intensity: 20 }, { t: 0.7, intensity: 255 }, { t: 0.8, intensity: 60 }, { t: 0.9, intensity: 255 }, { t: 1, intensity: 50 }] },

  // Fire / Effect presets
  fire_burst:        { name: "Fire Burst",     duration: 2000,  easing: "ease_out",       keyframes: [{ t: 0, intensity: 0 }, { t: 0.2, intensity: 255 }, { t: 0.5, intensity: 180 }, { t: 0.8, intensity: 100 }, { t: 1, intensity: 0 }] },
  fire_pulse:        { name: "Fire Pulse",     duration: 3000,  easing: "ease_in_out",  keyframes: [{ t: 0, intensity: 50 }, { t: 0.3, intensity: 255 }, { t: 0.6, intensity: 80 }, { t: 0.8, intensity: 200 }, { t: 1, intensity: 50 }] },
  fog_roll:          { name: "Fog Roll",       duration: 10000, easing: "ease_in_out",  keyframes: [{ t: 0, intensity: 0 }, { t: 0.2, intensity: 200 }, { t: 0.5, intensity: 255 }, { t: 0.8, intensity: 150 }, { t: 1, intensity: 0 }] },
  laser_sweep:       { name: "Laser Sweep",    duration: 3000,  easing: "linear",         keyframes: [{ t: 0, intensity: 255, rotation: 0 }, { t: 0.5, intensity: 255, rotation: 180 }, { t: 1, intensity: 255, rotation: 360 }] },

  // Motion presets
  motion_pan_sweep:  { name: "Pan Sweep",      duration: 4000,  easing: "ease_both",    keyframes: [{ t: 0, pan: -90 }, { t: 0.5, pan: 90 }, { t: 1, pan: -90 }] },
  motion_tilt_wave:  { name: "Tilt Wave",      duration: 3000,  easing: "sine",           keyframes: [{ t: 0, tilt: 0 }, { t: 0.25, tilt: 45 }, { t: 0.5, tilt: 0 }, { t: 0.75, tilt: 45 }, { t: 1, tilt: 0 }] },
  motion_circle:     { name: "Circle",         duration: 5000,  easing: "linear",         keyframes: [{ t: 0, pan: 0, tilt: 0 }, { t: 0.25, pan: 90, tilt: 45 }, { t: 0.5, pan: 180, tilt: 0 }, { t: 0.75, pan: 270, tilt: 45 }, { t: 1, pan: 360, tilt: 0 }] },
});

// ============================================================
// DEFAULT CLIP TEMPLATES
// ============================================================

export const DEFAULT_CLIP_TEMPLATES = Object.freeze({
  // Water clips
  water_intro:       { name: "Water Intro",       duration: 5000,  tracks: ["pump_speed"],    preset: "water_fade_in",    loop: false, category: "intro" },
  water_main:        { name: "Water Main",        duration: 15000, tracks: ["pump_speed"],    preset: "water_fountain",   loop: true,  category: "main" },
  water_outro:       { name: "Water Outro",       duration: 5000,  tracks: ["pump_speed"],    preset: "water_fade_out",   loop: false, category: "outro" },
  water_strobe_clip: { name: "Water Strobe",      duration: 3000,  tracks: ["pump_speed"],    preset: "water_strobe",     loop: true,  category: "effect" },
  water_burst_clip:  { name: "Water Burst",       duration: 2000,  tracks: ["pump_speed"],    preset: "water_burst",      loop: false, category: "accent" },
  water_cascade_clip:{ name: "Water Cascade",     duration: 8000,  tracks: ["pump_speed"],    preset: "water_cascade",    loop: true,  category: "ambient" },

  // Light clips
  light_intro:       { name: "Light Intro",       duration: 4000,  tracks: ["lighting_master"], preset: "light_breathe",    loop: false, category: "intro" },
  light_main:        { name: "Light Main",        duration: 12000, tracks: ["lighting_master"], preset: "light_fade_rgb",   loop: true,  category: "main" },
  light_outro:       { name: "Light Outro",       duration: 4000,  tracks: ["lighting_master"], preset: "light_breathe",    loop: false, category: "outro" },
  light_strobe_clip: { name: "Light Strobe",      duration: 2000,  tracks: ["lighting_master"], preset: "light_strobe_white", loop: true,  category: "effect" },
  light_chase_clip:  { name: "Light Chase",       duration: 6000,  tracks: ["lighting_master"], preset: "light_chase",      loop: true,  category: "effect" },

  // Fire clips
  fire_intro:        { name: "Fire Intro",        duration: 3000,  tracks: ["fire_intensity"],  preset: "fire_burst",       loop: false, category: "intro" },
  fire_main:         { name: "Fire Main",         duration: 10000, tracks: ["fire_intensity"],  preset: "fire_pulse",       loop: true,  category: "main" },
  fire_outro:        { name: "Fire Outro",        duration: 3000,  tracks: ["fire_intensity"],  preset: "fire_burst",       loop: false, category: "outro" },

  // Fog clips
  fog_intro:         { name: "Fog Intro",       duration: 6000,  tracks: ["fog_density"],     preset: "fog_roll",         loop: false, category: "intro" },
  fog_main:          { name: "Fog Main",          duration: 15000, tracks: ["fog_density"],     preset: "fog_roll",         loop: true,  category: "main" },
  fog_outro:         { name: "Fog Outro",         duration: 6000,  tracks: ["fog_density"],     preset: "fog_roll",         loop: false, category: "outro" },

  // Motion clips
  motion_intro:      { name: "Motion Intro",      duration: 4000,  tracks: ["motion_pan"],      preset: "motion_pan_sweep", loop: false, category: "intro" },
  motion_main:       { name: "Motion Main",       duration: 10000, tracks: ["motion_pan"],      preset: "motion_circle",    loop: true,  category: "main" },
  motion_outro:      { name: "Motion Outro",      duration: 4000,  tracks: ["motion_pan"],      preset: "motion_pan_sweep", loop: false, category: "outro" },

  // Combo clips
  grand_opening:     { name: "Grand Opening",     duration: 8000,  tracks: ["pump_speed", "lighting_master", "fire_intensity"], preset: "water_geyser", loop: false, category: "special" },
  finale:            { name: "Finale",            duration: 12000, tracks: ["pump_speed", "lighting_master", "fire_intensity", "laser_intensity"], preset: "water_fountain", loop: true, category: "special" },
  ambient_day:       { name: "Ambient Day",       duration: 30000, tracks: ["pump_speed", "lighting_master"], preset: "water_ripple", loop: true, category: "ambient" },
  ambient_night:     { name: "Ambient Night",     duration: 30000, tracks: ["pump_speed", "lighting_master", "fog_density"], preset: "water_cascade", loop: true, category: "ambient" },
});

// ============================================================
// TRACK CAPABILITY PRESETS
// ============================================================

export const TRACK_CAPABILITY_PRESETS = Object.freeze({
  pump: {
    primaryTrackType: "pump_speed",
    secondaryTrackTypes: ["pump_pressure", "device_enable"],
    hasIntensity: true, hasEnable: true, hasPressure: true,
    minIntensity: 0, maxIntensity: 255,
    suggestedEasing: "ease_both",
    defaultClipTemplates: ["water_intro", "water_main", "water_outro", "water_burst_clip"],
  },
  lighting: {
    primaryTrackType: "lighting_master",
    secondaryTrackTypes: ["lighting_red", "lighting_green", "lighting_blue", "lighting_white"],
    hasIntensity: true, hasColor: true,
    minIntensity: 0, maxIntensity: 255,
    suggestedEasing: "linear",
    defaultClipTemplates: ["light_intro", "light_main", "light_outro", "light_strobe_clip"],
  },
  laser: {
    primaryTrackType: "laser_intensity",
    secondaryTrackTypes: ["laser_pattern"],
    hasIntensity: true, hasPattern: true,
    minIntensity: 0, maxIntensity: 255,
    suggestedEasing: "step",
    safetyFlags: ["requires_enable"],
    defaultClipTemplates: ["laser_sweep"],
  },
  flame: {
    primaryTrackType: "fire_intensity",
    secondaryTrackTypes: ["fire_trigger"],
    hasIntensity: true, hasTrigger: true,
    minIntensity: 0, maxIntensity: 255,
    suggestedEasing: "step",
    safetyFlags: ["safety_critical", "requires_enable", "max_duration_10s"],
    defaultClipTemplates: ["fire_intro", "fire_main", "fire_outro"],
  },
  fog: {
    primaryTrackType: "fog_density",
    secondaryTrackTypes: [],
    hasIntensity: true,
    minIntensity: 0, maxIntensity: 255,
    suggestedEasing: "linear",
    defaultClipTemplates: ["fog_intro", "fog_main", "fog_outro"],
  },
  sensor: {
    primaryTrackType: null,
    secondaryTrackTypes: [],
    hasIntensity: false, isReadOnly: true,
    suggestedEasing: null,
    defaultClipTemplates: [],
  },
  equipment: {
    primaryTrackType: "device_intensity",
    secondaryTrackTypes: ["device_enable"],
    hasIntensity: true, hasEnable: true,
    minIntensity: 0, maxIntensity: 255,
    suggestedEasing: "linear",
    defaultClipTemplates: [],
  },
  motion_1d: {
    primaryTrackType: "motion_angle",
    secondaryTrackTypes: ["motion_intensity"],
    hasAngle: true, hasSpeed: true,
    minAngle: -180, maxAngle: 180,
    suggestedEasing: "ease_both",
    defaultClipTemplates: ["motion_intro", "motion_main", "motion_outro"],
  },
  motion_2d: {
    primaryTrackType: "motion_pan",
    secondaryTrackTypes: ["motion_tilt", "motion_intensity"],
    hasPan: true, hasTilt: true,
    minPan: -180, maxPan: 180, minTilt: 0, maxTilt: 90,
    suggestedEasing: "ease_both",
    defaultClipTemplates: ["motion_intro", "motion_main", "motion_outro"],
  },
  motion_3d: {
    primaryTrackType: "motion_pan",
    secondaryTrackTypes: ["motion_tilt", "motion_intensity", "motion_angle"],
    hasPan: true, hasTilt: true, hasRoll: true,
    minPan: -180, maxPan: 180, minTilt: 0, maxTilt: 180,
    suggestedEasing: "ease_both",
    defaultClipTemplates: ["motion_intro", "motion_main", "motion_outro"],
  },
});

// ============================================================
// FIXTURE TYPE MAP (102 TYPES)
// ============================================================

export const FIXTURE_TYPE_MAP = {
  // ═══════════════════════════════════════════════════════════
  // WATER / NOZZLES — CENTER JETS
  // ═══════════════════════════════════════════════════════════

  geyser: {
    runtimeType: "pump", category: "pump", deviceType: "geyser",
    group: "center_jets", protocol: "virtual", latencyMs: 15,
    channels: ["intensity", "enable", "pump_speed"],
    engineering: { flowLpm: { min: 50, max: 500, default: 200 }, pressureBar: { min: 2, max: 10, default: 5 }, pumpClass: "class_3", jetHeightM: { min: 2, max: 15, default: 8 } },
    previewCategory: "water_jet",
  },

  nozzle_geyser: {
    runtimeType: "pump", category: "pump", deviceType: "geyser",
    group: "center_jets", protocol: "virtual", latencyMs: 15,
    channels: ["intensity", "enable", "pump_speed"],
    engineering: { flowLpm: { min: 50, max: 500, default: 200 }, pressureBar: { min: 2, max: 10, default: 5 }, pumpClass: "class_3", jetHeightM: { min: 2, max: 15, default: 8 } },
    previewCategory: "water_jet",
  },

  crown_jet: {
    runtimeType: "pump", category: "pump", deviceType: "crown",
    group: "center_jets", protocol: "virtual", latencyMs: 20,
    channels: ["intensity", "enable", "pump_speed", "pattern"],
    engineering: { flowLpm: { min: 100, max: 800, default: 300 }, pressureBar: { min: 3, max: 12, default: 6 }, pumpClass: "class_3", jetHeightM: { min: 1, max: 10, default: 5 } },
    previewCategory: "water_jet",
  },

  nozzle_crown: {
    runtimeType: "pump", category: "pump", deviceType: "crown",
    group: "center_jets", protocol: "virtual", latencyMs: 20,
    channels: ["intensity", "enable", "pump_speed", "pattern"],
    engineering: { flowLpm: { min: 100, max: 800, default: 300 }, pressureBar: { min: 3, max: 12, default: 6 }, pumpClass: "class_3", jetHeightM: { min: 1, max: 10, default: 5 } },
    previewCategory: "water_jet",
  },

  volcano_jet: {
    runtimeType: "pump", category: "pump", deviceType: "volcano",
    group: "center_jets", protocol: "virtual", latencyMs: 25,
    channels: ["intensity", "enable", "pump_speed", "spread"],
    engineering: { flowLpm: { min: 200, max: 1500, default: 600 }, pressureBar: { min: 5, max: 20, default: 10 }, pumpClass: "class_4", jetHeightM: { min: 3, max: 20, default: 10 } },
    previewCategory: "water_volcano",
  },

  nozzle_volcano: {
    runtimeType: "pump", category: "pump", deviceType: "volcano",
    group: "center_jets", protocol: "virtual", latencyMs: 25,
    channels: ["intensity", "enable", "pump_speed", "spread"],
    engineering: { flowLpm: { min: 200, max: 1500, default: 600 }, pressureBar: { min: 5, max: 20, default: 10 }, pumpClass: "class_4", jetHeightM: { min: 3, max: 20, default: 10 } },
    previewCategory: "water_volcano",
  },

  sphere_jet: {
    runtimeType: "pump", category: "pump", deviceType: "sphere",
    group: "center_jets", protocol: "virtual", latencyMs: 18,
    channels: ["intensity", "enable", "pump_speed", "diameter"],
    engineering: { flowLpm: { min: 150, max: 1000, default: 400 }, pressureBar: { min: 3, max: 15, default: 7 }, pumpClass: "class_3", jetHeightM: { min: 2, max: 12, default: 6 } },
    previewCategory: "water_sphere",
  },

  nozzle_sphere: {
    runtimeType: "pump", category: "pump", deviceType: "sphere",
    group: "center_jets", protocol: "virtual", latencyMs: 18,
    channels: ["intensity", "enable", "pump_speed", "diameter"],
    engineering: { flowLpm: { min: 150, max: 1000, default: 400 }, pressureBar: { min: 3, max: 15, default: 7 }, pumpClass: "class_3", jetHeightM: { min: 2, max: 12, default: 6 } },
    previewCategory: "water_sphere",
  },

  rocket_jet: {
    runtimeType: "pump", category: "pump", deviceType: "rocket",
    group: "center_jets", protocol: "virtual", latencyMs: 12,
    channels: ["intensity", "enable", "pump_speed", "burst_duration"],
    engineering: { flowLpm: { min: 300, max: 2000, default: 800 }, pressureBar: { min: 8, max: 30, default: 15 }, pumpClass: "class_4", jetHeightM: { min: 5, max: 50, default: 25 } },
    previewCategory: "water_rocket",
  },

  nozzle_rocket: {
    runtimeType: "pump", category: "pump", deviceType: "rocket",
    group: "center_jets", protocol: "virtual", latencyMs: 12,
    channels: ["intensity", "enable", "pump_speed", "burst_duration"],
    engineering: { flowLpm: { min: 300, max: 2000, default: 800 }, pressureBar: { min: 8, max: 30, default: 15 }, pumpClass: "class_4", jetHeightM: { min: 5, max: 50, default: 25 } },
    previewCategory: "water_rocket",
  },

  // ═══════════════════════════════════════════════════════════
  // WATER / NOZZLES — ARCH JETS
  // ═══════════════════════════════════════════════════════════

  arch: {
    runtimeType: "pump", category: "pump", deviceType: "arch",
    group: "arch_jets", protocol: "virtual", latencyMs: 12,
    channels: ["intensity", "enable"],
    engineering: { flowLpm: { min: 30, max: 300, default: 100 }, pressureBar: { min: 1, max: 6, default: 3 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 8, default: 4 } },
    previewCategory: "water_jet",
  },

  nozzle_arch: {
    runtimeType: "pump", category: "pump", deviceType: "arch",
    group: "arch_jets", protocol: "virtual", latencyMs: 12,
    channels: ["intensity", "enable"],
    engineering: { flowLpm: { min: 30, max: 300, default: 100 }, pressureBar: { min: 1, max: 6, default: 3 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 8, default: 4 } },
    previewCategory: "water_jet",
  },

  laminar: {
    runtimeType: "pump", category: "pump", deviceType: "laminar",
    group: "arch_jets", protocol: "virtual", latencyMs: 10,
    channels: ["intensity", "enable"],
    engineering: { flowLpm: { min: 20, max: 150, default: 60 }, pressureBar: { min: 1, max: 4, default: 2 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 6, default: 3 } },
    previewCategory: "water_jet",
  },

  nozzle_laminar: {
    runtimeType: "pump", category: "pump", deviceType: "laminar",
    group: "arch_jets", protocol: "virtual", latencyMs: 10,
    channels: ["intensity", "enable"],
    engineering: { flowLpm: { min: 20, max: 150, default: 60 }, pressureBar: { min: 1, max: 4, default: 2 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 6, default: 3 } },
    previewCategory: "water_jet",
  },

  jumping_jet: {
    runtimeType: "pump", category: "pump", deviceType: "jumping",
    group: "arch_jets", protocol: "virtual", latencyMs: 30,
    channels: ["intensity", "enable", "jump_length", "jump_timing"],
    engineering: { flowLpm: { min: 10, max: 100, default: 40 }, pressureBar: { min: 1, max: 5, default: 2.5 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_jump",
  },

  nozzle_jumping: {
    runtimeType: "pump", category: "pump", deviceType: "jumping",
    group: "arch_jets", protocol: "virtual", latencyMs: 30,
    channels: ["intensity", "enable", "jump_length", "jump_timing"],
    engineering: { flowLpm: { min: 10, max: 100, default: 40 }, pressureBar: { min: 1, max: 5, default: 2.5 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_jump",
  },

  swing_jet: {
    runtimeType: "pump", category: "pump", deviceType: "swing",
    group: "arch_jets", protocol: "virtual", latencyMs: 22,
    channels: ["intensity", "enable", "swing_angle", "swing_speed"],
    engineering: { flowLpm: { min: 40, max: 250, default: 100 }, pressureBar: { min: 1.5, max: 6, default: 3 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 6, default: 3 } },
    previewCategory: "water_swing",
  },

  nozzle_swing: {
    runtimeType: "pump", category: "pump", deviceType: "swing",
    group: "arch_jets", protocol: "virtual", latencyMs: 22,
    channels: ["intensity", "enable", "swing_angle", "swing_speed"],
    engineering: { flowLpm: { min: 40, max: 250, default: 100 }, pressureBar: { min: 1.5, max: 6, default: 3 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 6, default: 3 } },
    previewCategory: "water_swing",
  },

  pirouette_jet: {
    runtimeType: "pump", category: "pump", deviceType: "pirouette",
    group: "arch_jets", protocol: "virtual", latencyMs: 28,
    channels: ["intensity", "enable", "rotation_speed", "tilt"],
    engineering: { flowLpm: { min: 50, max: 300, default: 120 }, pressureBar: { min: 2, max: 8, default: 4 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 8, default: 4 } },
    previewCategory: "water_pirouette",
  },

  nozzle_pirouette: {
    runtimeType: "pump", category: "pump", deviceType: "pirouette",
    group: "arch_jets", protocol: "virtual", latencyMs: 28,
    channels: ["intensity", "enable", "rotation_speed", "tilt"],
    engineering: { flowLpm: { min: 50, max: 300, default: 120 }, pressureBar: { min: 2, max: 8, default: 4 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 8, default: 4 } },
    previewCategory: "water_pirouette",
  },

  // ═══════════════════════════════════════════════════════════
  // WATER / NOZZLES — OUTER RING JETS
  // ═══════════════════════════════════════════════════════════

  running: {
    runtimeType: "pump", category: "pump", deviceType: "ring",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 15,
    channels: ["intensity", "enable"],
    engineering: { flowLpm: { min: 20, max: 200, default: 80 }, pressureBar: { min: 1, max: 5, default: 2.5 }, pumpClass: "class_2", jetHeightM: { min: 0.5, max: 5, default: 2 } },
    previewCategory: "water_jet",
  },

  nozzle_running: {
    runtimeType: "pump", category: "pump", deviceType: "ring",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 15,
    channels: ["intensity", "enable"],
    engineering: { flowLpm: { min: 20, max: 200, default: 80 }, pressureBar: { min: 1, max: 5, default: 2.5 }, pumpClass: "class_2", jetHeightM: { min: 0.5, max: 5, default: 2 } },
    previewCategory: "water_jet",
  },

  fan_jet: {
    runtimeType: "pump", category: "pump", deviceType: "fan_jet",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 15,
    channels: ["intensity", "enable", "fan_angle"],
    engineering: { flowLpm: { min: 30, max: 250, default: 100 }, pressureBar: { min: 1, max: 5, default: 2.5 }, pumpClass: "class_2", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_jet",
  },

  nozzle_fan: {
    runtimeType: "pump", category: "pump", deviceType: "fan_jet",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 15,
    channels: ["intensity", "enable", "fan_angle"],
    engineering: { flowLpm: { min: 30, max: 250, default: 100 }, pressureBar: { min: 1, max: 5, default: 2.5 }, pumpClass: "class_2", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_jet",
  },

  comet_jet: {
    runtimeType: "pump", category: "pump", deviceType: "comet",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 10,
    channels: ["intensity", "enable", "trail_length"],
    engineering: { flowLpm: { min: 15, max: 120, default: 50 }, pressureBar: { min: 1, max: 4, default: 2 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_comet",
  },

  nozzle_comet: {
    runtimeType: "pump", category: "pump", deviceType: "comet",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 10,
    channels: ["intensity", "enable", "trail_length"],
    engineering: { flowLpm: { min: 15, max: 120, default: 50 }, pressureBar: { min: 1, max: 4, default: 2 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_comet",
  },

  peacock_jet: {
    runtimeType: "pump", category: "pump", deviceType: "peacock",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 18,
    channels: ["intensity", "enable", "spread_angle", "feather_count"],
    engineering: { flowLpm: { min: 80, max: 500, default: 200 }, pressureBar: { min: 2, max: 8, default: 4 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 6, default: 3 } },
    previewCategory: "water_peacock",
  },

  nozzle_peacock: {
    runtimeType: "pump", category: "pump", deviceType: "peacock",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 18,
    channels: ["intensity", "enable", "spread_angle", "feather_count"],
    engineering: { flowLpm: { min: 80, max: 500, default: 200 }, pressureBar: { min: 2, max: 8, default: 4 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 6, default: 3 } },
    previewCategory: "water_peacock",
  },

  tulip_jet: {
    runtimeType: "pump", category: "pump", deviceType: "tulip",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 16,
    channels: ["intensity", "enable", "bloom_size", "petal_count"],
    engineering: { flowLpm: { min: 60, max: 400, default: 150 }, pressureBar: { min: 2, max: 7, default: 3.5 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 5, default: 2.5 } },
    previewCategory: "water_tulip",
  },

  nozzle_tulip: {
    runtimeType: "pump", category: "pump", deviceType: "tulip",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 16,
    channels: ["intensity", "enable", "bloom_size", "petal_count"],
    engineering: { flowLpm: { min: 60, max: 400, default: 150 }, pressureBar: { min: 2, max: 7, default: 3.5 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 5, default: 2.5 } },
    previewCategory: "water_tulip",
  },

  bell_jet: {
    runtimeType: "pump", category: "pump", deviceType: "bell",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 14,
    channels: ["intensity", "enable", "bell_diameter"],
    engineering: { flowLpm: { min: 25, max: 180, default: 70 }, pressureBar: { min: 1, max: 4, default: 2 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 3, default: 1.5 } },
    previewCategory: "water_bell",
  },

  nozzle_bell: {
    runtimeType: "pump", category: "pump", deviceType: "bell",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 14,
    channels: ["intensity", "enable", "bell_diameter"],
    engineering: { flowLpm: { min: 25, max: 180, default: 70 }, pressureBar: { min: 1, max: 4, default: 2 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 3, default: 1.5 } },
    previewCategory: "water_bell",
  },

  finger_jet: {
    runtimeType: "pump", category: "pump", deviceType: "finger",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 12,
    channels: ["intensity", "enable", "finger_count", "finger_angle"],
    engineering: { flowLpm: { min: 30, max: 200, default: 80 }, pressureBar: { min: 1, max: 4, default: 2 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 3, default: 1.5 } },
    previewCategory: "water_finger",
  },

  nozzle_finger: {
    runtimeType: "pump", category: "pump", deviceType: "finger",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 12,
    channels: ["intensity", "enable", "finger_count", "finger_angle"],
    engineering: { flowLpm: { min: 30, max: 200, default: 80 }, pressureBar: { min: 1, max: 4, default: 2 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 3, default: 1.5 } },
    previewCategory: "water_finger",
  },

  // ═══════════════════════════════════════════════════════════
  // WATER / NOZZLES — SPECIAL EFFECTS
  // ═══════════════════════════════════════════════════════════

  foam: {
    runtimeType: "pump", category: "pump", deviceType: "foam",
    group: "center_jets", protocol: "virtual", latencyMs: 25,
    channels: ["intensity", "enable", "foam_density"],
    engineering: { flowLpm: { min: 40, max: 300, default: 120 }, pressureBar: { min: 1, max: 5, default: 2.5 }, pumpClass: "class_2", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_foam",
  },

  nozzle_foam: {
    runtimeType: "pump", category: "pump", deviceType: "foam",
    group: "center_jets", protocol: "virtual", latencyMs: 25,
    channels: ["intensity", "enable", "foam_density"],
    engineering: { flowLpm: { min: 40, max: 300, default: 120 }, pressureBar: { min: 1, max: 5, default: 2.5 }, pumpClass: "class_2", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_foam",
  },

  foam_jet: {
    runtimeType: "pump", category: "pump", deviceType: "foam_jet",
    group: "center_jets", protocol: "virtual", latencyMs: 28,
    channels: ["intensity", "enable", "foam_density", "foam_volume"],
    engineering: { flowLpm: { min: 50, max: 350, default: 150 }, pressureBar: { min: 1.5, max: 6, default: 3 }, pumpClass: "class_2", jetHeightM: { min: 0.5, max: 5, default: 2.5 } },
    previewCategory: "water_foam",
  },

  nozzle_foam_jet: {
    runtimeType: "pump", category: "pump", deviceType: "foam_jet",
    group: "center_jets", protocol: "virtual", latencyMs: 28,
    channels: ["intensity", "enable", "foam_density", "foam_volume"],
    engineering: { flowLpm: { min: 50, max: 350, default: 150 }, pressureBar: { min: 1.5, max: 6, default: 3 }, pumpClass: "class_2", jetHeightM: { min: 0.5, max: 5, default: 2.5 } },
    previewCategory: "water_foam",
  },

  cascade_jet: {
    runtimeType: "pump", category: "pump", deviceType: "cascade",
    group: "center_jets", protocol: "virtual", latencyMs: 22,
    channels: ["intensity", "enable", "cascade_width", "cascade_height"],
    engineering: { flowLpm: { min: 80, max: 600, default: 250 }, pressureBar: { min: 2, max: 8, default: 4 }, pumpClass: "class_3", jetHeightM: { min: 1, max: 8, default: 4 } },
    previewCategory: "water_cascade",
  },

  nozzle_cascade: {
    runtimeType: "pump", category: "pump", deviceType: "cascade",
    group: "center_jets", protocol: "virtual", latencyMs: 22,
    channels: ["intensity", "enable", "cascade_width", "cascade_height"],
    engineering: { flowLpm: { min: 80, max: 600, default: 250 }, pressureBar: { min: 2, max: 8, default: 4 }, pumpClass: "class_3", jetHeightM: { min: 1, max: 8, default: 4 } },
    previewCategory: "water_cascade",
  },

  spiral_jet: {
    runtimeType: "pump", category: "pump", deviceType: "spiral",
    group: "center_jets", protocol: "virtual", latencyMs: 20,
    channels: ["intensity", "enable", "spiral_tightness", "rotation_speed"],
    engineering: { flowLpm: { min: 60, max: 400, default: 150 }, pressureBar: { min: 2, max: 7, default: 3.5 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 6, default: 3 } },
    previewCategory: "water_spiral",
  },

  nozzle_spiral: {
    runtimeType: "pump", category: "pump", deviceType: "spiral",
    group: "center_jets", protocol: "virtual", latencyMs: 20,
    channels: ["intensity", "enable", "spiral_tightness", "rotation_speed"],
    engineering: { flowLpm: { min: 60, max: 400, default: 150 }, pressureBar: { min: 2, max: 7, default: 3.5 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 6, default: 3 } },
    previewCategory: "water_spiral",
  },

  dome_jet: {
    runtimeType: "pump", category: "pump", deviceType: "dome",
    group: "center_jets", protocol: "virtual", latencyMs: 15,
    channels: ["intensity", "enable", "dome_radius"],
    engineering: { flowLpm: { min: 40, max: 300, default: 120 }, pressureBar: { min: 1.5, max: 6, default: 3 }, pumpClass: "class_2", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_dome",
  },

  nozzle_dome: {
    runtimeType: "pump", category: "pump", deviceType: "dome",
    group: "center_jets", protocol: "virtual", latencyMs: 15,
    channels: ["intensity", "enable", "dome_radius"],
    engineering: { flowLpm: { min: 40, max: 300, default: 120 }, pressureBar: { min: 1.5, max: 6, default: 3 }, pumpClass: "class_2", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_dome",
  },

  bursting_jet: {
    runtimeType: "pump", category: "pump", deviceType: "bursting",
    group: "center_jets", protocol: "virtual", latencyMs: 35,
    channels: ["intensity", "enable", "burst_count", "burst_interval"],
    engineering: { flowLpm: { min: 100, max: 800, default: 300 }, pressureBar: { min: 3, max: 15, default: 7 }, pumpClass: "class_3", jetHeightM: { min: 2, max: 12, default: 6 } },
    previewCategory: "water_burst",
  },

  nozzle_bursting: {
    runtimeType: "pump", category: "pump", deviceType: "bursting",
    group: "center_jets", protocol: "virtual", latencyMs: 35,
    channels: ["intensity", "enable", "burst_count", "burst_interval"],
    engineering: { flowLpm: { min: 100, max: 800, default: 300 }, pressureBar: { min: 3, max: 15, default: 7 }, pumpClass: "class_3", jetHeightM: { min: 2, max: 12, default: 6 } },
    previewCategory: "water_burst",
  },

  digital_jet: {
    runtimeType: "pump", category: "pump", deviceType: "digital",
    group: "center_jets", protocol: "virtual", latencyMs: 8,
    channels: ["intensity", "enable", "pattern_index", "pattern_speed"],
    engineering: { flowLpm: { min: 20, max: 150, default: 60 }, pressureBar: { min: 1, max: 5, default: 2.5 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_digital",
  },

  nozzle_digital: {
    runtimeType: "pump", category: "pump", deviceType: "digital",
    group: "center_jets", protocol: "virtual", latencyMs: 8,
    channels: ["intensity", "enable", "pattern_index", "pattern_speed"],
    engineering: { flowLpm: { min: 20, max: 150, default: 60 }, pressureBar: { min: 1, max: 5, default: 2.5 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_digital",
  },

  water_screen: {
    runtimeType: "pump", category: "pump", deviceType: "water_screen",
    group: "center_jets", protocol: "virtual", latencyMs: 50,
    channels: ["intensity", "enable", "screen_width", "screen_height", "projection_mode"],
    engineering: { flowLpm: { min: 500, max: 5000, default: 1500 }, pressureBar: { min: 10, max: 50, default: 25 }, pumpClass: "class_5", jetHeightM: { min: 5, max: 30, default: 15 } },
    previewCategory: "water_screen",
  },

  nozzle_water_screen: {
    runtimeType: "pump", category: "pump", deviceType: "water_screen",
    group: "center_jets", protocol: "virtual", latencyMs: 50,
    channels: ["intensity", "enable", "screen_width", "screen_height", "projection_mode"],
    engineering: { flowLpm: { min: 500, max: 5000, default: 1500 }, pressureBar: { min: 10, max: 50, default: 25 }, pumpClass: "class_5", jetHeightM: { min: 5, max: 30, default: 15 } },
    previewCategory: "water_screen",
  },

  air_shooter: {
    runtimeType: "pump", category: "pump", deviceType: "air_shooter",
    group: "center_jets", protocol: "virtual", latencyMs: 40,
    channels: ["intensity", "enable", "air_pressure", "shoot_duration"],
    engineering: { flowLpm: { min: 200, max: 1500, default: 600 }, pressureBar: { min: 5, max: 25, default: 12 }, pumpClass: "class_4", jetHeightM: { min: 3, max: 20, default: 10 } },
    previewCategory: "water_air",
  },

  nozzle_air_shooter: {
    runtimeType: "pump", category: "pump", deviceType: "air_shooter",
    group: "center_jets", protocol: "virtual", latencyMs: 40,
    channels: ["intensity", "enable", "air_pressure", "shoot_duration"],
    engineering: { flowLpm: { min: 200, max: 1500, default: 600 }, pressureBar: { min: 5, max: 25, default: 12 }, pumpClass: "class_4", jetHeightM: { min: 3, max: 20, default: 10 } },
    previewCategory: "water_air",
  },

  mist: {
    runtimeType: "fog", category: "fog", deviceType: "mist",
    group: "fog_machines", protocol: "virtual", latencyMs: 50,
    channels: ["fog_density", "enable", "mist_fineness"],
    engineering: { flowLpm: { min: 5, max: 50, default: 20 }, pressureBar: { min: 0.5, max: 3, default: 1.5 }, pumpClass: "class_1", jetHeightM: { min: 0.2, max: 2, default: 1 } },
    previewCategory: "water_mist",
  },

  nozzle_mist: {
    runtimeType: "fog", category: "fog", deviceType: "mist",
    group: "fog_machines", protocol: "virtual", latencyMs: 50,
    channels: ["fog_density", "enable", "mist_fineness"],
    engineering: { flowLpm: { min: 5, max: 50, default: 20 }, pressureBar: { min: 0.5, max: 3, default: 1.5 }, pumpClass: "class_1", jetHeightM: { min: 0.2, max: 2, default: 1 } },
    previewCategory: "water_mist",
  },

  mist_curtain: {
    runtimeType: "fog", category: "fog", deviceType: "mist_curtain",
    group: "fog_machines", protocol: "virtual", latencyMs: 60,
    channels: ["fog_density", "enable", "curtain_width", "curtain_density"],
    engineering: { flowLpm: { min: 50, max: 400, default: 150 }, pressureBar: { min: 2, max: 8, default: 4 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 6, default: 3 } },
    previewCategory: "water_mist",
  },

  nozzle_mist_curtain: {
    runtimeType: "fog", category: "fog", deviceType: "mist_curtain",
    group: "fog_machines", protocol: "virtual", latencyMs: 60,
    channels: ["fog_density", "enable", "curtain_width", "curtain_density"],
    engineering: { flowLpm: { min: 50, max: 400, default: 150 }, pressureBar: { min: 2, max: 8, default: 4 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 6, default: 3 } },
    previewCategory: "water_mist",
  },

  // ═══════════════════════════════════════════════════════════
  // WATER / NOZZLES — STAGE 1 EXPANSION
  // ═══════════════════════════════════════════════════════════

  swing_jet: {
    runtimeType: "pump", category: "pump", deviceType: "swing",
    group: "arch_jets", protocol: "virtual", latencyMs: 22,
    channels: ["intensity", "enable", "swing_angle", "swing_speed"],
    engineering: { flowLpm: { min: 40, max: 250, default: 100 }, pressureBar: { min: 1.5, max: 6, default: 3 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 6, default: 3 } },
    previewCategory: "water_swing",
  },

  pirouette_jet: {
    runtimeType: "pump", category: "pump", deviceType: "pirouette",
    group: "arch_jets", protocol: "virtual", latencyMs: 28,
    channels: ["intensity", "enable", "rotation_speed", "tilt"],
    engineering: { flowLpm: { min: 50, max: 300, default: 120 }, pressureBar: { min: 2, max: 8, default: 4 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 8, default: 4 } },
    previewCategory: "water_pirouette",
  },

  comet_jet: {
    runtimeType: "pump", category: "pump", deviceType: "comet",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 10,
    channels: ["intensity", "enable", "trail_length"],
    engineering: { flowLpm: { min: 15, max: 120, default: 50 }, pressureBar: { min: 1, max: 4, default: 2 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_comet",
  },

  peacock_jet: {
    runtimeType: "pump", category: "pump", deviceType: "peacock",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 18,
    channels: ["intensity", "enable", "spread_angle", "feather_count"],
    engineering: { flowLpm: { min: 80, max: 500, default: 200 }, pressureBar: { min: 2, max: 8, default: 4 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 6, default: 3 } },
    previewCategory: "water_peacock",
  },

  tulip_jet: {
    runtimeType: "pump", category: "pump", deviceType: "tulip",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 16,
    channels: ["intensity", "enable", "bloom_size", "petal_count"],
    engineering: { flowLpm: { min: 60, max: 400, default: 150 }, pressureBar: { min: 2, max: 7, default: 3.5 }, pumpClass: "class_2", jetHeightM: { min: 1, max: 5, default: 2.5 } },
    previewCategory: "water_tulip",
  },

  bell_jet: {
    runtimeType: "pump", category: "pump", deviceType: "bell",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 14,
    channels: ["intensity", "enable", "bell_diameter"],
    engineering: { flowLpm: { min: 25, max: 180, default: 70 }, pressureBar: { min: 1, max: 4, default: 2 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 3, default: 1.5 } },
    previewCategory: "water_bell",
  },

  finger_jet: {
    runtimeType: "pump", category: "pump", deviceType: "finger",
    group: "outer_ring_jets", protocol: "virtual", latencyMs: 12,
    channels: ["intensity", "enable", "finger_count", "finger_angle"],
    engineering: { flowLpm: { min: 30, max: 200, default: 80 }, pressureBar: { min: 1, max: 4, default: 2 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 3, default: 1.5 } },
    previewCategory: "water_finger",
  },

  jumping_jet: {
    runtimeType: "pump", category: "pump", deviceType: "jumping",
    group: "arch_jets", protocol: "virtual", latencyMs: 30,
    channels: ["intensity", "enable", "jump_length", "jump_timing"],
    engineering: { flowLpm: { min: 10, max: 100, default: 40 }, pressureBar: { min: 1, max: 5, default: 2.5 }, pumpClass: "class_1", jetHeightM: { min: 0.5, max: 4, default: 2 } },
    previewCategory: "water_jump",
  },

  crown_jet: {
    runtimeType: "pump", category: "pump", deviceType: "crown",
    group: "center_jets", protocol: "virtual", latencyMs: 20,
    channels: ["intensity", "enable", "pump_speed", "pattern"],
    engineering: { flowLpm: { min: 100, max: 800, default: 300 }, pressureBar: { min: 3, max: 12, default: 6 }, pumpClass: "class_3", jetHeightM: { min: 1, max: 10, default: 5 } },
    previewCategory: "water_jet",
  },

  volcano_jet: {
    runtimeType: "pump", category: "pump", deviceType: "volcano",
    group: "center_jets", protocol: "virtual", latencyMs: 25,
    channels: ["intensity", "enable", "pump_speed", "spread"],
    engineering: { flowLpm: { min: 200, max: 1500, default: 600 }, pressureBar: { min: 5, max: 20, default: 10 }, pumpClass: "class_4", jetHeightM: { min: 3, max: 20, default: 10 } },
    previewCategory: "water_volcano",
  },

  sphere_jet: {
    runtimeType: "pump", category: "pump", deviceType: "sphere",
    group: "center_jets", protocol: "virtual", latencyMs: 18,
    channels: ["intensity", "enable", "pump_speed", "diameter"],
    engineering: { flowLpm: { min: 150, max: 1000, default: 400 }, pressureBar: { min: 3, max: 15, default: 7 }, pumpClass: "class_3", jetHeightM: { min: 2, max: 12, default: 6 } },
    previewCategory: "water_sphere",
  },

  rocket_jet: {
    runtimeType: "pump", category: "pump", deviceType: "rocket",
    group: "center_jets", protocol: "virtual", latencyMs: 12,
    channels: ["intensity", "enable", "pump_speed", "burst_duration"],
    engineering: { flowLpm: { min: 300, max: 2000, default: 800 }, pressureBar: { min: 8, max: 30, default: 15 }, pumpClass: "class_4", jetHeightM: { min: 5, max: 50, default: 25 } },
    previewCategory: "water_rocket",
  },

  // ═══════════════════════════════════════════════════════════
  // LIGHTING — STAGE 1 EXPANSION
  // ═══════════════════════════════════════════════════════════

  light_moving_head: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_moving_head_300w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 5,
    channels: ["intensity", "r", "g", "b", "w", "pan", "tilt", "zoom", "gobo", "strobe"],
    engineering: { wattage: 300, voltage: 230, beamAngle: 8, ipRating: "IP65", panRange: 540, tiltRange: 270 },
    previewCategory: "light_emitter",
  },

  light_wash: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_wash_200w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b", "w", "amber", "zoom"],
    engineering: { wattage: 200, voltage: 230, beamAngle: 25, ipRating: "IP65" },
    previewCategory: "light_emitter",
  },

  light_par: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_par_100w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b", "w", "uv"],
    engineering: { wattage: 100, voltage: 230, beamAngle: 25, ipRating: "IP65" },
    previewCategory: "light_emitter",
  },

  light_strobe: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_strobe_1000w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "strobe_rate", "duration", "r", "g", "b"],
    engineering: { wattage: 1000, voltage: 230, beamAngle: 120, ipRating: "IP65", maxStrobeRate: 30 },
    previewCategory: "light_emitter",
  },

  light_uv: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_uv_50w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "uv_level"],
    engineering: { wattage: 50, voltage: 24, beamAngle: 60, ipRating: "IP68", wavelength: 365 },
    previewCategory: "light_emitter",
  },

  light_fiber: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_fiber_20w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b", "twinkle_speed"],
    engineering: { wattage: 20, voltage: 12, beamAngle: 360, ipRating: "IP68", fiberCount: 150 },
    previewCategory: "light_emitter",
  },

  light_fountain: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_fountain_75w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b", "w", "color_temp"],
    engineering: { wattage: 75, voltage: 24, beamAngle: 45, ipRating: "IP68", colorTempRange: [2700, 6500] },
    previewCategory: "light_emitter",
  },

  light_inground: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_inground_30w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b", "w"],
    engineering: { wattage: 30, voltage: 24, beamAngle: 60, ipRating: "IP67", loadRating: "500kg" },
    previewCategory: "light_emitter",
  },

  // ═══════════════════════════════════════════════════════════
  // FIRE — STAGE 1 EXPANSION
  // ═══════════════════════════════════════════════════════════

  flame_burst: {
    runtimeType: "flame", category: "fire", deviceType: "flame_burst",
    group: "flame_units", protocol: "virtual", latencyMs: 60,
    channels: ["flame", "enable", "burst_count", "burst_duration", "safety_lock"],
    engineering: { gasFlowLpm: { min: 10, max: 100, default: 40 }, ignitionType: "electronic", maxHeightM: 10, safetyZoneM: 8, maxBurstDuration: 3 },
    previewCategory: "fire_effect",
  },

  // ═══════════════════════════════════════════════════════════
  // EQUIPMENT — STAGE 1 EXPANSION
  // ═══════════════════════════════════════════════════════════

  heater: {
    runtimeType: "equipment", category: "generic", deviceType: "heater",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "temperature", "power_level"],
    engineering: { maxTempC: 40, powerKw: { min: 3, max: 50, default: 15 }, heatingRateCPerHour: 2 },
    previewCategory: "equipment_box",
  },

  chiller: {
    runtimeType: "equipment", category: "generic", deviceType: "chiller",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "temperature", "power_level"],
    engineering: { minTempC: 5, powerKw: { min: 2, max: 30, default: 10 }, coolingRateCPerHour: 1.5 },
    previewCategory: "equipment_box",
  },

  blower: {
    runtimeType: "equipment", category: "generic", deviceType: "blower",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "speed", "pressure"],
    engineering: { maxFlowM3PerMin: { min: 5, max: 100, default: 30 }, powerKw: { min: 1, max: 15, default: 5 }, pressureMbar: { min: 10, max: 200, default: 50 } },
    previewCategory: "equipment_box",
  },

  compressor: {
    runtimeType: "equipment", category: "generic", deviceType: "compressor",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "pressure", "output_rate"],
    engineering: { maxPressureBar: { min: 5, max: 30, default: 10 }, powerKw: { min: 2, max: 20, default: 7 }, tankVolumeL: { min: 50, max: 500, default: 200 } },
    previewCategory: "equipment_box",
  },

  // ═══════════════════════════════════════════════════════════
  // LIGHTING
  // ═══════════════════════════════════════════════════════════

  light_rgb: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_uw_rgb_36w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b"],
    engineering: { wattage: 36, voltage: 24, beamAngle: 30, ipRating: "IP68" },
    previewCategory: "light_emitter",
  },

  light_underwater: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_uw_rgb_54w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b"],
    engineering: { wattage: 54, voltage: 24, beamAngle: 45, ipRating: "IP68" },
    previewCategory: "light_emitter",
  },

  light_rgbw: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_uw_rgbw_54w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b", "w"],
    engineering: { wattage: 54, voltage: 24, beamAngle: 45, ipRating: "IP68" },
    previewCategory: "light_emitter",
  },

  light_spot: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_spot_150w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "pan", "tilt", "zoom"],
    engineering: { wattage: 150, voltage: 230, beamAngle: 15, ipRating: "IP65" },
    previewCategory: "light_emitter",
  },

  light_ring: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_ring_rgb_24w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b"],
    engineering: { wattage: 24, voltage: 24, beamAngle: 360, ipRating: "IP68" },
    previewCategory: "light_emitter",
  },

  light_moving_head: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_moving_head_300w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 5,
    channels: ["intensity", "r", "g", "b", "w", "pan", "tilt", "zoom", "gobo", "strobe"],
    engineering: { wattage: 300, voltage: 230, beamAngle: 8, ipRating: "IP65", panRange: 540, tiltRange: 270 },
    previewCategory: "light_emitter",
  },

  light_wash: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_wash_200w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b", "w", "amber", "zoom"],
    engineering: { wattage: 200, voltage: 230, beamAngle: 25, ipRating: "IP65" },
    previewCategory: "light_emitter",
  },

  light_par: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_par_100w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b", "w", "uv"],
    engineering: { wattage: 100, voltage: 230, beamAngle: 25, ipRating: "IP65" },
    previewCategory: "light_emitter",
  },

  light_strobe: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_strobe_1000w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "strobe_rate", "duration", "r", "g", "b"],
    engineering: { wattage: 1000, voltage: 230, beamAngle: 120, ipRating: "IP65", maxStrobeRate: 30 },
    previewCategory: "light_emitter",
  },

  light_uv: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_uv_50w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "uv_level"],
    engineering: { wattage: 50, voltage: 24, beamAngle: 60, ipRating: "IP68", wavelength: 365 },
    previewCategory: "light_emitter",
  },

  light_fiber: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_fiber_20w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b", "twinkle_speed"],
    engineering: { wattage: 20, voltage: 12, beamAngle: 360, ipRating: "IP68", fiberCount: 150 },
    previewCategory: "light_emitter",
  },

  light_fountain: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_fountain_75w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b", "w", "color_temp"],
    engineering: { wattage: 75, voltage: 24, beamAngle: 45, ipRating: "IP68", colorTempRange: [2700, 6500] },
    previewCategory: "light_emitter",
  },

  light_inground: {
    runtimeType: "lighting", category: "lighting", deviceType: "light_inground_30w",
    group: "rgb_lights", protocol: "virtual", latencyMs: 0,
    channels: ["intensity", "r", "g", "b", "w"],
    engineering: { wattage: 30, voltage: 24, beamAngle: 60, ipRating: "IP67", loadRating: "500kg" },
    previewCategory: "light_emitter",
  },

  // ═══════════════════════════════════════════════════════════
  // MOTION
  // ═══════════════════════════════════════════════════════════

  motion_1d: {
    runtimeType: "motion_1d", category: "motion_1d", deviceType: "motion_1d",
    group: "center_jets", protocol: "virtual", latencyMs: 20,
    channels: ["angle", "speed", "intensity"],
    engineering: { panRange: 180, speedDegPerSec: 90, resolution: 0.5, ipRating: "IP68" },
    previewCategory: "motion_1d",
  },

  motion_2d: {
    runtimeType: "motion_2d", category: "motion_2d", deviceType: "motion_2d",
    group: "arch_jets", protocol: "virtual", latencyMs: 25,
    channels: ["pan", "tilt", "speed", "intensity"],
    engineering: { panRange: 360, tiltRange: 90, speedDegPerSec: 60, resolution: 0.5, ipRating: "IP68" },
    previewCategory: "motion_2d",
  },

  motion_3d: {
    runtimeType: "motion_3d", category: "motion_3d", deviceType: "motion_3d",
    group: "center_jets", protocol: "virtual", latencyMs: 30,
    channels: ["pan", "tilt", "roll", "speed", "intensity"],
    engineering: { panRange: 360, tiltRange: 180, rollRange: 360, speedDegPerSec: 45, resolution: 0.25, ipRating: "IP68" },
    previewCategory: "motion_3d",
  },

  // ═══════════════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════════════

  flame: {
    runtimeType: "flame", category: "fire", deviceType: "flame",
    group: "flame_units", protocol: "virtual", latencyMs: 50,
    channels: ["flame", "enable", "height", "color_temp"],
    engineering: { gasFlowLpm: { min: 5, max: 50, default: 20 }, ignitionType: "pilot", maxHeightM: 8, safetyZoneM: 5 },
    previewCategory: "fire_effect",
  },

  nozzle_flame: {
    runtimeType: "flame", category: "fire", deviceType: "flame",
    group: "flame_units", protocol: "virtual", latencyMs: 50,
    channels: ["flame", "enable", "height", "color_temp"],
    engineering: { gasFlowLpm: { min: 5, max: 50, default: 20 }, ignitionType: "pilot", maxHeightM: 8, safetyZoneM: 5 },
    previewCategory: "fire_effect",
  },

  flame_effect: {
    runtimeType: "flame", category: "fire", deviceType: "flame",
    group: "flame_units", protocol: "virtual", latencyMs: 50,
    channels: ["flame", "enable", "height", "color_temp"],
    engineering: { gasFlowLpm: { min: 5, max: 50, default: 20 }, ignitionType: "pilot", maxHeightM: 8, safetyZoneM: 5 },
    previewCategory: "fire_effect",
  },

  fire_effect: {
    runtimeType: "flame", category: "fire", deviceType: "flame",
    group: "flame_units", protocol: "virtual", latencyMs: 50,
    channels: ["flame", "enable", "height", "color_temp"],
    engineering: { gasFlowLpm: { min: 5, max: 50, default: 20 }, ignitionType: "pilot", maxHeightM: 8, safetyZoneM: 5 },
    previewCategory: "fire_effect",
  },

  flame_burst: {
    runtimeType: "flame", category: "fire", deviceType: "flame_burst",
    group: "flame_units", protocol: "virtual", latencyMs: 60,
    channels: ["flame", "enable", "burst_count", "burst_duration", "safety_lock"],
    engineering: { gasFlowLpm: { min: 10, max: 100, default: 40 }, ignitionType: "electronic", maxHeightM: 10, safetyZoneM: 8, maxBurstDuration: 3 },
    previewCategory: "fire_effect",
  },

  nozzle_flame_burst: {
    runtimeType: "flame", category: "fire", deviceType: "flame_burst",
    group: "flame_units", protocol: "virtual", latencyMs: 60,
    channels: ["flame", "enable", "burst_count", "burst_duration", "safety_lock"],
    engineering: { gasFlowLpm: { min: 10, max: 100, default: 40 }, ignitionType: "electronic", maxHeightM: 10, safetyZoneM: 8, maxBurstDuration: 3 },
    previewCategory: "fire_effect",
  },

  fog: {
    runtimeType: "fog", category: "fog", deviceType: "fog_machine",
    group: "fog_machines", protocol: "virtual", latencyMs: 100,
    channels: ["fog_density", "enable", "fan_speed", "heater"],
    engineering: { fluidConsumptionMlPerMin: { min: 5, max: 50, default: 20 }, heatUpTimeSec: 120, outputVolumeM3PerMin: { min: 10, max: 100, default: 40 } },
    previewCategory: "fog_emitter",
  },

  laser: {
    runtimeType: "laser", category: "laser", deviceType: "laser",
    group: "laser_units", protocol: "virtual", latencyMs: 5,
    channels: ["laser_beam", "laser_pattern", "enable", "intensity", "rotation"],
    engineering: { powerMw: { min: 100, max: 5000, default: 1000 }, wavelengthNm: { min: 450, max: 650, default: 532 }, scanRateKpps: { min: 10, max: 60, default: 30 }, safetyClass: "3B" },
    previewCategory: "laser_beam",
  },

  sparkler: {
    runtimeType: "equipment", category: "generic", deviceType: "sparkler",
    group: "effects_units", protocol: "virtual", latencyMs: 80,
    channels: ["intensity", "enable", "burst_duration", "height"],
    engineering: { powderLoadG: { min: 50, max: 500, default: 200 }, maxHeightM: 5, safetyZoneM: 3, cooldownSec: 30 },
    previewCategory: "spark_effect",
  },

  cryo: {
    runtimeType: "equipment", category: "generic", deviceType: "cryo",
    group: "effects_units", protocol: "virtual", latencyMs: 70,
    channels: ["intensity", "enable", "burst_duration", "spread"],
    engineering: { co2ConsumptionKgPerMin: { min: 0.5, max: 5, default: 2 }, maxReachM: 8, safetyZoneM: 2, nozzleTempC: -78 },
    previewCategory: "cryo_effect",
  },

  bubble: {
    runtimeType: "equipment", category: "generic", deviceType: "bubble",
    group: "effects_units", protocol: "virtual", latencyMs: 90,
    channels: ["intensity", "enable", "bubble_size", "output_rate"],
    engineering: { fluidConsumptionLPerMin: { min: 0.1, max: 2, default: 0.5 }, maxBubbleSizeMm: 50, outputRateBubblesPerMin: { min: 100, max: 2000, default: 500 } },
    previewCategory: "bubble_effect",
  },

  snow: {
    runtimeType: "equipment", category: "generic", deviceType: "snow",
    group: "effects_units", protocol: "virtual", latencyMs: 85,
    channels: ["intensity", "enable", "flake_size", "output_rate"],
    engineering: { fluidConsumptionLPerMin: { min: 0.2, max: 3, default: 1 }, maxThrowM: 10, outputRateVolumePerMin: { min: 1, max: 20, default: 5 } },
    previewCategory: "snow_effect",
  },

  confetti: {
    runtimeType: "equipment", category: "generic", deviceType: "confetti",
    group: "effects_units", protocol: "virtual", latencyMs: 75,
    channels: ["intensity", "enable", "burst_duration", "spread_angle"],
    engineering: { maxReachM: 15, capacityKg: { min: 1, max: 10, default: 3 }, burstRateKgPerSec: { min: 0.5, max: 3, default: 1 } },
    previewCategory: "confetti_effect",
  },

  wind: {
    runtimeType: "equipment", category: "generic", deviceType: "wind",
    group: "effects_units", protocol: "virtual", latencyMs: 55,
    channels: ["intensity", "enable", "direction", "spread"],
    engineering: { maxSpeedMs: { min: 5, max: 30, default: 15 }, powerKw: { min: 1, max: 15, default: 5 }, noiseLevelDb: { min: 60, max: 95, default: 75 } },
    previewCategory: "wind_effect",
  },

  scent: {
    runtimeType: "equipment", category: "generic", deviceType: "scent",
    group: "effects_units", protocol: "virtual", latencyMs: 100,
    channels: ["intensity", "enable", "scent_type", "diffusion_rate"],
    engineering: { fluidConsumptionMlPerMin: { min: 0.05, max: 1, default: 0.2 }, maxReachM: 10, scentTypes: ["floral", "citrus", "ocean", "forest", "vanilla"] },
    previewCategory: "scent_emitter",
  },

  // ═══════════════════════════════════════════════════════════
  // EQUIPMENT
  // ═══════════════════════════════════════════════════════════

  pump: {
    runtimeType: "pump", category: "pump", deviceType: "geyser",
    group: "center_jets", protocol: "virtual", latencyMs: 200,
    channels: ["pump_speed", "enable", "pressure"],
    engineering: { flowLpm: { min: 500, max: 5000, default: 1500 }, pressureBar: { min: 10, max: 50, default: 25 }, pumpClass: "class_5", powerKw: { min: 15, max: 110, default: 45 } },
    previewCategory: "equipment_box",
  },

  vfd: {
    runtimeType: "pump", category: "pump", deviceType: "geyser",
    group: "center_jets", protocol: "virtual", latencyMs: 200,
    channels: ["pump_speed", "enable", "pressure", "frequency"],
    engineering: { frequencyRange: [0, 60], powerKw: { min: 1, max: 110, default: 15 }, efficiency: 0.95 },
    previewCategory: "equipment_box",
  },

  valve: {
    runtimeType: "equipment", category: "solenoid", deviceType: "jet_1d",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 30,
    channels: ["enable", "open_duration"],
    engineering: { responseTimeMs: 30, pressureRatingBar: 16, material: "brass_stainless" },
    previewCategory: "equipment_box",
  },

  solenoid: {
    runtimeType: "equipment", category: "solenoid", deviceType: "jet_1d",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 30,
    channels: ["enable", "open_duration"],
    engineering: { responseTimeMs: 20, pressureRatingBar: 10, material: "stainless_316l" },
    previewCategory: "equipment_box",
  },

  sensor: {
    runtimeType: "sensor", category: "generic", deviceType: "sensor",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["temperature", "pressure", "flow", "ph", "status"],
    engineering: { tempRange: [-40, 150], pressureRange: [0, 30], phRange: [0, 14], accuracy: 0.1 },
    previewCategory: "sensor_point",
  },

  filter: {
    runtimeType: "equipment", category: "generic", deviceType: "filter",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "flow_rate", "pressure_drop"],
    engineering: { flowRateLpm: { min: 100, max: 2000, default: 500 }, filterType: "sand", maintenanceIntervalDays: 30 },
    previewCategory: "equipment_box",
  },

  uv: {
    runtimeType: "equipment", category: "generic", deviceType: "uv",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "intensity", "lamp_hours"],
    engineering: { wattage: 75, wavelength: 254, lampLifeHours: 9000, flowRateLpm: { min: 50, max: 500, default: 200 } },
    previewCategory: "equipment_box",
  },

  dosing: {
    runtimeType: "equipment", category: "generic", deviceType: "dosing",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "dose_rate", "dose_volume"],
    engineering: { maxDoseMlPerMin: { min: 1, max: 100, default: 20 }, chemicalTypes: ["chlorine", "ph_plus", "ph_minus", "algaecide"] },
    previewCategory: "equipment_box",
  },

  heater: {
    runtimeType: "equipment", category: "generic", deviceType: "heater",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "temperature", "power_level"],
    engineering: { maxTempC: 40, powerKw: { min: 3, max: 50, default: 15 }, heatingRateCPerHour: 2 },
    previewCategory: "equipment_box",
  },

  chiller: {
    runtimeType: "equipment", category: "generic", deviceType: "chiller",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "temperature", "power_level"],
    engineering: { minTempC: 5, powerKw: { min: 2, max: 30, default: 10 }, coolingRateCPerHour: 1.5 },
    previewCategory: "equipment_box",
  },

  blower: {
    runtimeType: "equipment", category: "generic", deviceType: "blower",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "speed", "pressure"],
    engineering: { maxFlowM3PerMin: { min: 5, max: 100, default: 30 }, powerKw: { min: 1, max: 15, default: 5 }, pressureMbar: { min: 10, max: 200, default: 50 } },
    previewCategory: "equipment_box",
  },

  compressor: {
    runtimeType: "equipment", category: "generic", deviceType: "compressor",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "pressure", "output_rate"],
    engineering: { maxPressureBar: { min: 5, max: 30, default: 10 }, powerKw: { min: 2, max: 20, default: 7 }, tankVolumeL: { min: 50, max: 500, default: 200 } },
    previewCategory: "equipment_box",
  },

  inverter: {
    runtimeType: "equipment", category: "generic", deviceType: "inverter",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "frequency", "voltage"],
    engineering: { powerRangeKw: { min: 1, max: 110, default: 15 }, frequencyRange: [0, 60], voltageRange: [200, 480] },
    previewCategory: "equipment_box",
  },

  plc: {
    runtimeType: "equipment", category: "generic", deviceType: "plc",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "program_index", "status"],
    engineering: { ioCount: { min: 16, max: 256, default: 64 }, scanTimeMs: { min: 1, max: 100, default: 10 }, protocol: "ethernet_ip" },
    previewCategory: "equipment_box",
  },

  relay: {
    runtimeType: "equipment", category: "generic", deviceType: "relay",
    group: "engineering_equipment", protocol: "virtual", latencyMs: 0,
    channels: ["enable", "switch_state", "contact_status"],
    engineering: { maxCurrentA: { min: 10, max: 100, default: 30 }, voltageRating: { min: 24, max: 480, default: 230 }, contactCount: { min: 1, max: 8, default: 4 } },
    previewCategory: "equipment_box",
  },
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

export function normalizeFixtureType(type = "") {
  return String(type || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

export function getFixtureInfo(type = "") {
  const key = normalizeFixtureType(type);

  if (FIXTURE_TYPE_MAP[key]) {
    return FIXTURE_TYPE_MAP[key];
  }

  if (key.startsWith("nozzle_")) {
    const withoutPrefix = key.replace("nozzle_", "");
    if (FIXTURE_TYPE_MAP[withoutPrefix]) {
      return FIXTURE_TYPE_MAP[withoutPrefix];
    }
  }

  for (const [mapKey, info] of Object.entries(FIXTURE_TYPE_MAP)) {
    if (key.includes(mapKey) || mapKey.includes(key)) {
      return info;
    }
  }

  return {
    runtimeType: "equipment",
    category: "generic",
    deviceType: "unknown",
    group: "engineering_equipment",
    protocol: "virtual",
    latencyMs: 0,
    channels: ["enable"],
    engineering: {},
    previewCategory: "equipment_box",
  };
}

export function getRuntimeType(type = "") {
  return getFixtureInfo(type).runtimeType;
}

export function getFixtureCategory(type = "") {
  return getFixtureInfo(type).category;
}

export function getFixtureChannels(type = "") {
  return getFixtureInfo(type).channels || ["enable"];
}

export function getFixtureEngineering(type = "") {
  return getFixtureInfo(type).engineering || {};
}

export function getFixturePreviewCategory(type = "") {
  return getFixtureInfo(type).previewCategory || "equipment_box";
}

export function getPumpClass(type = "") {
  const info = getFixtureInfo(type);
  return info.engineering?.pumpClass || null;
}

export function getFlowRange(type = "") {
  const eng = getFixtureEngineering(type);
  return eng.flowLpm || { min: 0, max: 100, default: 50 };
}

export function getPressureRange(type = "") {
  const eng = getFixtureEngineering(type);
  return eng.pressureBar || { min: 0, max: 5, default: 2 };
}

export function getJetHeightRange(type = "") {
  const eng = getFixtureEngineering(type);
  return eng.jetHeightM || { min: 1, max: 5, default: 2 };
}

// ============================================================
// HELPER FUNCTIONS for runtimeDeviceGraph.js
// ============================================================

export function getDefaultGroupId(fixtureType) {
  const info = getFixtureInfo(fixtureType);
  if (info && info.group) return info.group;

  const typeStr = String(fixtureType || "").toLowerCase();

  if (typeStr.includes("ring") || typeStr.includes("running") || typeStr.includes("comet") || typeStr.includes("peacock") || typeStr.includes("tulip") || typeStr.includes("bell") || typeStr.includes("finger")) return "outer_ring_jets";
  if (typeStr.includes("arch") || typeStr.includes("laminar") || typeStr.includes("2d") || typeStr.includes("jumping") || typeStr.includes("swing") || typeStr.includes("pirouette")) return "arch_jets";
  if (typeStr.includes("1d") || typeStr.includes("3d") || typeStr.includes("geyser") || typeStr.includes("crown") || typeStr.includes("volcano") || typeStr.includes("sphere") || typeStr.includes("rocket") || typeStr.includes("foam") || typeStr.includes("cascade") || typeStr.includes("spiral") || typeStr.includes("dome") || typeStr.includes("bursting") || typeStr.includes("digital") || typeStr.includes("water_screen") || typeStr.includes("air_shooter") || typeStr.includes("jet")) return "center_jets";
  if (typeStr.includes("light") || typeStr.includes("rgb")) return "rgb_lights";
  if (typeStr.includes("fire") || typeStr.includes("flame")) return "flame_units";
  if (typeStr.includes("air") || typeStr.includes("burst") || typeStr.includes("fog") || typeStr.includes("mist")) return "fog_machines";
  if (typeStr.includes("laser")) return "laser_units";
  if (typeStr.includes("spark") || typeStr.includes("cryo") || typeStr.includes("bubble") || typeStr.includes("snow") || typeStr.includes("confetti") || typeStr.includes("wind") || typeStr.includes("scent")) return "effects_units";

  return "engineering_equipment";
}

export function getChannelCountForType(fixtureType) {
  const channels = getFixtureChannels(fixtureType);
  return channels ? channels.length : 1;
}

export function getPreviewCapabilities(fixtureType) {
  const runtimeType = getRuntimeType(fixtureType);
  const category = getFixtureCategory(fixtureType);
  const previewCategory = getFixturePreviewCategory(fixtureType);
  const previewInfo = PREVIEW_CATEGORIES[previewCategory] || PREVIEW_CATEGORIES.equipment_box;

  return {
    ...previewInfo,
    previewType: previewCategory,
    animatable: previewInfo.hasJetAnimation || previewInfo.hasParticleSystem,
    parameters: getTrackCapabilities(fixtureType).availableChannels || ["intensity"],
    safetyCritical: previewCategory === "fire_effect",
  };
}

export function getTrackCapabilities(fixtureType) {
  const runtimeType = getRuntimeType(fixtureType);
  const preset = TRACK_CAPABILITY_PRESETS[runtimeType] || TRACK_CAPABILITY_PRESETS.equipment;
  const info = getFixtureInfo(fixtureType);
  const channels = getFixtureChannels(fixtureType);

  return {
    ...preset,
    deviceId: fixtureType,
    deviceLabel: info.deviceType || fixtureType,
    availableChannels: channels,
    protocol: info.protocol || "virtual",
    latencyMs: info.latencyMs || 0,
    channelMap: getChannelMapping(runtimeType, info.engineering || {}),
  };
}

function getChannelMapping(runtimeType, engineering) {
  const mapping = {};
  const channels = getFixtureChannels(runtimeType);
  for (const channel of channels) {
    mapping[channel] = {
      type: "analog",
      range: [0, 255],
      unit: "%",
      currentValue: engineering[channel] ?? 0,
    };
  }
  return mapping;
}

export default {
  PUMP_CLASSES,
  PREVIEW_CATEGORIES,
  DEFAULT_ANIMATION_PRESETS,
  DEFAULT_CLIP_TEMPLATES,
  TRACK_CAPABILITY_PRESETS,
  FIXTURE_TYPE_MAP,
  normalizeFixtureType,
  getFixtureInfo,
  getRuntimeType,
  getFixtureCategory,
  getFixtureChannels,
  getFixtureEngineering,
  getFixturePreviewCategory,
  getPumpClass,
  getFlowRange,
  getPressureRange,
  getJetHeightRange,
  getDefaultGroupId,
  getChannelCountForType,
  getPreviewCapabilities,
  getTrackCapabilities,
};
