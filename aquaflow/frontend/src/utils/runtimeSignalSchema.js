/**
 * runtimeSignalSchema.js — AquaFlow Team D
 * Canonical signal type definitions, priority constants, and address schemas.
 *
 * This file ONLY defines constants and schema shapes.
 * It does NOT compute anything. It does NOT import from showStore or timeline.
 *
 * Used by:
 *   - runtimeSignalCompiler.js (clip → event list)
 *   - runtimeSignalSelector.js (playhead → signals, existing file)
 *   - runtime_bridge.py (via JSON schema reference)
 */

// ─── Signal Priority Stack ───────────────────────────────────────────────────
// Higher number = higher priority. ALWAYS takes precedence over lower.

export const SIGNAL_PRIORITY = Object.freeze({
  IDLE:             0,  // safe minimum idle values
  PATTERN:          1,  // AI / auto-pattern fallback
  TIMELINE:         2,  // compiled show playback
  MANUAL_OVERRIDE:  3,  // operator live control
  DEVICE_LIMIT:     4,  // per-device safety ceiling (firmware-enforced)
  OPERATOR_BLACKOUT:5,  // blackout button from control desk
  SAFETY_KERNEL:    6,  // watchdog, fault detection
  HARDWARE_ESTOP:   7,  // physical relay — cannot be overridden by software
});

// ─── Signal Source Tags ──────────────────────────────────────────────────────

export const SIGNAL_SOURCE = Object.freeze({
  TIMELINE:   "timeline",
  MANUAL:     "manual",
  PATTERN:    "pattern",
  AI:         "ai",
  SAFETY:     "safety",
  IDLE:       "idle",
});

// ─── Signal Flags (bitmask) ──────────────────────────────────────────────────

export const SIGNAL_FLAGS = Object.freeze({
  NONE:               0b00000000,
  LATENCY_COMPENSATED:0b00000001,  // fire time already offset by device latency
  SAFETY_CRITICAL:    0b00000010,  // must not be delayed or dropped
  INTERPOLATED:       0b00000100,  // value computed by easing interpolation
  AUDIO_REACTIVE:     0b00001000,  // value modulated by audio analysis
  LOOPING:            0b00010000,  // clip in loop mode
  FADE_IN:            0b00100000,  // currently in fade-in envelope
  FADE_OUT:           0b01000000,  // currently in fade-out envelope
});

// ─── Easing Types ────────────────────────────────────────────────────────────

export const EASING = Object.freeze({
  STEP:       "step",       // instantaneous change (solenoid on/off)
  LINEAR:     "linear",     // constant rate change
  EASE_IN:    "ease_in",    // slow start, fast finish
  EASE_OUT:   "ease_out",   // fast start, slow finish (VFD ramp-down)
  EASE_BOTH:  "ease_both",  // slow start + finish (smooth lighting)
  SINE:       "sine",       // sinusoidal oscillation within clip
  BEZIER:     "bezier",     // custom curve (params: [cp1x,cp1y,cp2x,cp2y])
});

// ─── Device Channel IDs ──────────────────────────────────────────────────────
// Canonical names for the parameter a device signal controls.
// The same device may have multiple channels (e.g., RGB light has r, g, b, intensity).

export const CHANNEL = Object.freeze({
  // Universal
  INTENSITY:  "intensity",  // 0.0-1.0 master level
  ENABLE:     "enable",     // 0 = off, 1 = on (relay / solenoid)

  // RGB / RGBW lighting
  RED:        "r",
  GREEN:      "g",
  BLUE:       "b",
  WHITE:      "w",

  // Motion nozzles / moving heads
  PAN:        "pan",        // -1.0 to +1.0 (maps to -180° to +180°)
  TILT:       "tilt",       // 0.0 to 1.0 (maps to 0° to 90°)
  ANGLE:      "angle",      // -1.0 to +1.0 (maps to -180° to +180°)
  SPEED:      "speed",      // motion speed (0.0 = stopped, 1.0 = max speed)

  // Pump / VFD
  PUMP_SPEED: "pump_speed", // 0.0-1.0 → 0-100% VFD
  PRESSURE:   "pressure",   // 0.0-1.0 → scaled to fixture max pressure

  // Fire system
  FLAME:      "flame",      // 0 = off, 1 = on (binary for safety)
  GAS_VALVE:  "gas_valve",  // hardware interlock, not controlled by timeline

  // Fog / mist
  FOG_DENSITY:"fog_density",// 0.0-1.0
  FOG_FAN:    "fog_fan",    // 0.0-1.0 fan speed

  // Laser
  LASER_BEAM: "laser_beam", // 0 = off, 1 = on (shutter)
  LASER_PATTERN: "laser_pattern", // 0.0-1.0 mapped to pattern index
});

// ─── Protocol Types ──────────────────────────────────────────────────────────

export const PROTOCOL = Object.freeze({
  DMX:     "dmx",      // direct DMX512 via USB/RS-485
  ARTNET:  "artnet",   // DMX over UDP (Art-Net)
  SACN:    "sacn",     // DMX over UDP (sACN / E1.31)
  MODBUS:  "modbus",   // Modbus TCP or RTU (PLCs, VFDs)
  RELAY:   "relay",    // simple relay board (solenoids, fire igniters)
  CANBUS:  "canbus",   // future: motion nozzle CAN bus
});

// ─── Fixture Profile Map ─────────────────────────────────────────────────────
// Maps fixture type to its DMX channel layout.
// channel_count: how many consecutive DMX channels this fixture uses
// channel_map:   ordered list of CHANNEL constants mapped to DMX ch+0, ch+1, ...

export const FIXTURE_PROFILES = Object.freeze({
  dimmer_1ch: {
    channel_count: 1,
    channel_map:   [CHANNEL.INTENSITY],
  },
  rgb_3ch: {
    channel_count: 3,
    channel_map:   [CHANNEL.RED, CHANNEL.GREEN, CHANNEL.BLUE],
  },
  rgbw_4ch: {
    channel_count: 4,
    channel_map:   [CHANNEL.RED, CHANNEL.GREEN, CHANNEL.BLUE, CHANNEL.WHITE],
  },
  rgbwi_5ch: {
    channel_count: 5,
    channel_map:   [CHANNEL.RED, CHANNEL.GREEN, CHANNEL.BLUE, CHANNEL.WHITE, CHANNEL.INTENSITY],
  },
  moving_head_8ch: {
    channel_count: 8,
    channel_map:   [CHANNEL.PAN, CHANNEL.TILT, CHANNEL.INTENSITY, CHANNEL.RED,
                    CHANNEL.GREEN, CHANNEL.BLUE, CHANNEL.SPEED, "mode"],
  },
  vfd_pump_2ch: {
    // Standard VFD pump: speed + direction (no pressure feedback)
    channel_count: 2,
    channel_map:   [CHANNEL.PUMP_SPEED, "direction"],
  },
  vfd_pump_pressure_2ch: {
    // VFD pump with pressure channel on ch+1 (B4 fix)
    channel_count: 2,
    channel_map:   [CHANNEL.PUMP_SPEED, CHANNEL.PRESSURE],
  },
  motion_1d_2ch: {
    // 1D swing nozzle: angle on ch+0, speed on ch+1 (B3 fix)
    channel_count: 2,
    channel_map:   [CHANNEL.ANGLE, CHANNEL.SPEED],
  },
  fog_machine_2ch: {
    channel_count: 2,
    channel_map:   [CHANNEL.FOG_DENSITY, CHANNEL.FOG_FAN],
  },
  relay_1ch: {
    channel_count: 1,
    channel_map:   [CHANNEL.ENABLE],
  },
  laser_2ch: {
    channel_count: 2,
    channel_map:   [CHANNEL.LASER_BEAM, CHANNEL.LASER_PATTERN],
  },
});

// ─── Device Type → Fixture Profile Map ───────────────────────────────────────
// Maps the fixture type strings from fixtureTypeMap.js to FIXTURE_PROFILES keys.

export const DEVICE_TYPE_PROFILE = Object.freeze({
  // Water nozzles — controlled via relay (solenoid) + Modbus (VFD)
  jet_1d:       "relay_1ch",
  jet_2d:       "relay_1ch",
  jet_3d:       "relay_1ch",
  geyser:       "relay_1ch",
  arch:         "relay_1ch",
  cascade:      "relay_1ch",
  ring:         "relay_1ch",
  mist:         "relay_1ch",
  screen:       "relay_1ch",
  laminar:      "relay_1ch",
  pirouette:    "relay_1ch",
  fan_jet:      "relay_1ch",

  // Motion nozzles — controlled via Modbus/CANbus
  motion_1d:    "motion_1d_2ch",    // 1D swing: angle + speed (was vfd_pump_2ch — wrong)
  motion_2d:    "moving_head_8ch",  // pan + tilt + speed
  motion_3d:    "moving_head_8ch",  // full 3-axis

  // Lighting — DMX
  light_uw_rgb_36w:  "rgb_3ch",
  light_uw_rgb_54w:  "rgb_3ch",
  light_uw_rgbw_54w: "rgbw_4ch",
  light_spot_150w:   "dimmer_1ch",
  light_ring_rgb_24w:"rgb_3ch",

  // Effects
  flame:        "relay_1ch",
  fog_machine:  "fog_machine_2ch",
  laser:        "laser_2ch",
});

// ─── Device Signal Schema ─────────────────────────────────────────────────────
// TypeScript-style schema for documentation / runtime validation.
// JavaScript equivalent of a typed interface.

/**
 * @typedef {Object} DeviceSignal
 * @property {string}  deviceId    - unique fixture ID
 * @property {string}  channelId   - from CHANNEL constants
 * @property {number}  value       - normalized 0.0-1.0
 * @property {number}  rawValue    - protocol-native (0-255, 0-100, etc.)
 * @property {number}  timestamp   - seconds from show epoch
 * @property {number}  priority    - from SIGNAL_PRIORITY
 * @property {string}  source      - from SIGNAL_SOURCE
 * @property {number}  flags       - bitmask from SIGNAL_FLAGS
 * @property {string}  protocol    - from PROTOCOL
 */

/**
 * @typedef {Object} CompiledEvent
 * @property {number}   time          - seconds from show start (sorted ascending)
 * @property {string}   deviceId
 * @property {string}   channelId
 * @property {number}   value         - target value at this timestamp
 * @property {string}   easing        - from EASING (how to interpolate TO this value)
 * @property {number[]} easingParams  - for BEZIER only: [cp1x, cp1y, cp2x, cp2y]
 * @property {number}   priority      - from SIGNAL_PRIORITY
 * @property {number}   flags         - bitmask from SIGNAL_FLAGS
 */

/**
 * @typedef {Object} DeviceAddress
 * @property {string} deviceId
 * @property {string} deviceType
 * @property {string} zone
 * @property {string} groupId
 * @property {string} protocol        - from PROTOCOL
 * @property {number} [dmxUniverse]   - 1-indexed
 * @property {number} [dmxChannel]    - 1-indexed
 * @property {number} [dmxChannels]   - count of channels used
 * @property {string} [dmxProfile]    - from FIXTURE_PROFILES
 * @property {string} [plcHost]
 * @property {number} [plcPort]
 * @property {number} [plcUnitId]
 * @property {number} [plcRegister]
 * @property {string} [relayBoardId]
 * @property {number} [relayIndex]
 * @property {number} latencyMs       - hydraulic/mechanical lag compensation
 */

/**
 * @typedef {Object} SafetyLimit
 * @property {string}  deviceId
 * @property {number}  maxIntensity         - 0.0-1.0 hard ceiling
 * @property {number}  maxOnDurationMs      - max continuous on time
 * @property {number}  minOffDurationMs     - required off gap after maxOnDurationMs
 * @property {number}  maxOnPerHour         - max activations per hour
 * @property {boolean} requiresManualEnable - fire: true, water: false
 * @property {string}  interlockChain       - PLC interlock chain ID
 * @property {string}  emergencyState       - "off" | "close" | "hold"
 */

// ─── Default Safety Limits Per Device Type ───────────────────────────────────

export const DEFAULT_SAFETY_LIMITS = Object.freeze({
  // type → SafetyLimit template (deviceId filled in at registry time)
  flame: {
    maxIntensity:         1.0,
    maxOnDurationMs:      10000,   // 10 seconds max continuous
    minOffDurationMs:     5000,    // 5 second minimum gap
    maxOnPerHour:         120,
    requiresManualEnable: true,
    interlockChain:       "chain_b_fire",
    emergencyState:       "off",
  },
  laser: {
    maxIntensity:         1.0,
    maxOnDurationMs:      3600000, // no practical limit (but audience scan check applies)
    minOffDurationMs:     0,
    maxOnPerHour:         9999,
    requiresManualEnable: false,
    interlockChain:       "chain_c_laser",
    emergencyState:       "off",
  },
  motion_2d: {
    maxIntensity:         1.0,
    maxOnDurationMs:      3600000,
    minOffDurationMs:     0,
    maxOnPerHour:         9999,
    requiresManualEnable: false,
    interlockChain:       "chain_c_motion",
    emergencyState:       "hold",  // hold last position, don't reset
  },
  // All other types: no special limits
  _default: {
    maxIntensity:         1.0,
    maxOnDurationMs:      3600000,
    minOffDurationMs:     0,
    maxOnPerHour:         9999,
    requiresManualEnable: false,
    interlockChain:       null,
    emergencyState:       "off",
  },
});

// ─── Tick Rates ───────────────────────────────────────────────────────────────

export const TICK_RATES = Object.freeze({
  SAFETY:     1000,  // Hz — fire watchdog, E-stop detection
  DMX:          44,  // Hz — DMX/Art-Net refresh
  MOTION:       50,  // Hz — pan/tilt motor updates
  SHOW:        100,  // Hz — playhead advance, event scheduling
  WATER:        10,  // Hz — pump/solenoid/VFD updates
  TELEMETRY:     4,  // Hz — frontend state broadcast
});

// ─── Emergency State Mapping ──────────────────────────────────────────────────

export const DEVICE_EMERGENCY_STATE = Object.freeze({
  // device type → safe output on E-stop
  // All relay-controlled water nozzles: close immediately
  jet_1d:        { [CHANNEL.ENABLE]: 0 },
  jet_2d:        { [CHANNEL.ENABLE]: 0 },
  jet_3d:        { [CHANNEL.ENABLE]: 0 },
  geyser:        { [CHANNEL.ENABLE]: 0 },
  arch:          { [CHANNEL.ENABLE]: 0 },
  mist:          { [CHANNEL.ENABLE]: 0 },
  cascade:       { [CHANNEL.ENABLE]: 0 },
  screen:        { [CHANNEL.ENABLE]: 0 },
  ring:          { [CHANNEL.ENABLE]: 0 },
  laminar:       { [CHANNEL.ENABLE]: 0 },
  pirouette:     { [CHANNEL.ENABLE]: 0 },
  fan_jet:       { [CHANNEL.ENABLE]: 0 },
  // Motion nozzles: stop movement, hold last position
  motion_1d:     { [CHANNEL.SPEED]: 0 },
  motion_2d:     { [CHANNEL.SPEED]: 0 },
  motion_3d:     { [CHANNEL.SPEED]: 0 },
  // Lighting: zero all colour channels
  light_uw_rgb_36w:  { [CHANNEL.RED]: 0, [CHANNEL.GREEN]: 0, [CHANNEL.BLUE]: 0 },
  light_uw_rgb_54w:  { [CHANNEL.RED]: 0, [CHANNEL.GREEN]: 0, [CHANNEL.BLUE]: 0 },
  light_uw_rgbw_54w: { [CHANNEL.RED]: 0, [CHANNEL.GREEN]: 0, [CHANNEL.BLUE]: 0, [CHANNEL.WHITE]: 0 },
  light_spot_150w:   { [CHANNEL.INTENSITY]: 0 },
  light_ring_rgb_24w:{ [CHANNEL.RED]: 0, [CHANNEL.GREEN]: 0, [CHANNEL.BLUE]: 0 },
  // Effects
  flame:         { [CHANNEL.FLAME]: 0 },                          // immediate off
  fog_machine:   { [CHANNEL.FOG_DENSITY]: 0, [CHANNEL.FOG_FAN]: 0.5 }, // fan continues briefly
  laser:         { [CHANNEL.LASER_BEAM]: 0 },                     // shutter closes
});

export default {
  SIGNAL_PRIORITY,
  SIGNAL_SOURCE,
  SIGNAL_FLAGS,
  EASING,
  CHANNEL,
  PROTOCOL,
  FIXTURE_PROFILES,
  DEVICE_TYPE_PROFILE,
  DEFAULT_SAFETY_LIMITS,
  TICK_RATES,
  DEVICE_EMERGENCY_STATE,
};
