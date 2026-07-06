// src/utils/showProgrammerCompiler.js
/**
 * ShowProgrammerCompiler — Standalone show compilation engine
 * Converts timeline clips + effects into DMX/PLC-ready command sequences
 * No dependencies on App.jsx, showStore, or any global state
 */

// AF-HUB-004B — canonical DMX patch reader + frame size (single source of truth).
import { readPatch, DMX_CHANNELS_PER_UNIVERSE } from "../runtime/dmxPatch";

// ─── Types ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CompiledShow
 * @property {string} id
 * @property {number} duration
 * @property {number} fps
 * @property {Frame[]} frames
 * @property {FixtureCommand[]} fixtureCommands
 * @property {CuePoint[]} cuePoints
 */

/**
 * @typedef {Object} Frame
 * @property {number} time
 * @property {Object.<string, FixtureState>} states  // fixtureId -> state
 */

/**
 * @typedef {Object} FixtureState
 * @property {number} intensity 0-1
 * @property {number} tiltX degrees
 * @property {number} tiltZ degrees
 * @property {string} color hex
 * @property {number} heightScale 0-3
 * @property {boolean} on
 */

/**
 * @typedef {Object} FixtureCommand
 * @property {number} time
 * @property {string} fixtureId
 * @property {string} type 'dmx' | 'plc' | 'relay'
 * @property {Object} params
 */

/**
 * @typedef {Object} CuePoint
 * @property {number} time
 * @property {string} label
 * @property {string} type 'beat' | 'marker' | 'effect_start' | 'effect_end'
 */

// ─── Constants ─────────────────────────────────────────────────────────

export const DEFAULT_FPS = 30;
export const DMX_CHANNELS_PER_FIXTURE = 8;
// Channels per DMX512 universe (this is the per-universe frame size, NOT a universe
// count — the misleading name is kept for back-compat but now sourced canonically).
export const MAX_DMX_UNIVERSE = DMX_CHANNELS_PER_UNIVERSE;

export const EFFECT_TEMPLATES = {
  jet_burst: {
    duration: 0.5,
    rampUp: 0.1,
    rampDown: 0.3,
    peakIntensity: 1.0,
  },
  fade_in: {
    duration: 2.0,
    rampUp: 2.0,
    rampDown: 0.0,
    peakIntensity: 1.0,
  },
  fade_out: {
    duration: 2.0,
    rampUp: 0.0,
    rampDown: 2.0,
    peakIntensity: 1.0,
  },
  pulse: {
    duration: 1.0,
    rampUp: 0.2,
    rampDown: 0.2,
    peakIntensity: 1.0,
    sustain: 0.6,
  },
  wave: {
    duration: 3.0,
    rampUp: 0.5,
    rampDown: 0.5,
    peakIntensity: 1.0,
    phaseShift: 0.3,
  },
  strobe: {
    duration: 1.0,
    frequency: 10, // Hz
    dutyCycle: 0.5,
    peakIntensity: 1.0,
  },
  chase: {
    duration: 2.0,
    stepDuration: 0.2,
    direction: 'left', // 'left' | 'right'
  },
  color_fade: {
    duration: 3.0,
    colors: ['#ff0000', '#00ff00', '#0000ff'],
  },
};

// ─── Main Compiler ─────────────────────────────────────────────────────

/**
 * Compile a complete show from timeline clips
 * @param {Object} params
 * @param {Array} params.clips — Timeline clips with effects
 * @param {Array} params.fixtures — Available fixtures with DMX/PLC addresses
 * @param {number} params.duration — Total show duration (seconds)
 * @param {number} params.fps — Frame rate (default 30)
 * @param {Object} params.audioFeatures — Optional audio analysis data
 * @returns {CompiledShow}
 */
export function compileShow({
  clips = [],
  fixtures = [],
  duration = 60,
  fps = DEFAULT_FPS,
  audioFeatures = null,
}) {
  const frameCount = Math.ceil(duration * fps);
  const frameInterval = 1 / fps;

  // Initialize all frames with default states
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const time = i * frameInterval;
    const frame = { time, states: {} };
    
    fixtures.forEach(fixture => {
      frame.states[fixture.id] = getDefaultFixtureState(fixture.type);
    });
    
    frames.push(frame);
  }

  // Process each clip and apply effects to frames
  const fixtureCommands = [];
  const cuePoints = [];

  clips.forEach(clip => {
    const clipStart = clip.startTime || 0;
    const clipEnd = clipStart + (clip.duration || 0);
    
    // Add cue point for clip start
    cuePoints.push({
      time: clipStart,
      label: `${clip.name || clip.type} start`,
      type: 'effect_start',
    });

    // Process clip effects
    (clip.effects || []).forEach(effect => {
      const effectStart = clipStart + (effect.startTime || 0);
      const effectDuration = effect.duration || EFFECT_TEMPLATES[effect.type]?.duration || 1.0;
      const effectEnd = effectStart + effectDuration;

      // Add cue point
      cuePoints.push({
        time: effectStart,
        label: `${effect.type} @ ${clip.name}`,
        type: 'effect_start',
      });

      // Apply effect to frames
      const startFrame = Math.floor(effectStart * fps);
      const endFrame = Math.min(Math.ceil(effectEnd * fps), frameCount);

      for (let fi = startFrame; fi < endFrame; fi++) {
        const frameTime = fi * frameInterval;
        const localTime = frameTime - effectStart;
        const progress = localTime / effectDuration;

        // Get target fixtures
        const targetFixtures = clip.fixtures?.length > 0 
          ? clip.fixtures 
          : fixtures.map(f => f.id);

        targetFixtures.forEach(fixtureId => {
          const fixture = fixtures.find(f => f.id === fixtureId);
          if (!fixture) return;

          const envelope = computeEnvelope(effect.type, progress, effect.params || {});
          const state = computeFixtureState(
            fixture,
            effect,
            envelope,
            progress,
            clip.color,
            audioFeatures
          );

          frames[fi].states[fixtureId] = state;

          // Generate DMX/PLC commands on state changes
          if (fi === startFrame || stateChanged(frames[fi].states[fixtureId], frames[fi - 1]?.states[fixtureId])) {
            fixtureCommands.push({
              time: frameTime,
              fixtureId,
              type: getFixtureProtocol(fixture),
              params: stateToProtocolParams(fixture, state),
            });
          }
        });
      }
    });

    // Add clip end cue
    cuePoints.push({
      time: clipEnd,
      label: `${clip.name || clip.type} end`,
      type: 'effect_end',
    });
  });

  // Sort and deduplicate cue points
  cuePoints.sort((a, b) => a.time - b.time);

  return {
    id: generateShowId(),
    duration,
    fps,
    frames,
    fixtureCommands: optimizeCommands(fixtureCommands),
    cuePoints,
    metadata: {
      clipCount: clips.length,
      fixtureCount: fixtures.length,
      frameCount,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ─── Effect Envelope Computation ─────────────────────────────────────

/**
 * Compute effect envelope value (0-1) at given progress
 */
function computeEnvelope(effectType, progress, params = {}) {
  const template = EFFECT_TEMPLATES[effectType] || {};
  
  switch (effectType) {
    case 'jet_burst':
      return burstEnvelope(progress, template, params);
    
    case 'fade_in':
      return Math.min(progress / (params.rampUp || template.rampUp || 1), 1);
    
    case 'fade_out':
      return Math.max(1 - (progress / (params.rampDown || template.rampDown || 1)), 0);
    
    case 'pulse':
      return pulseEnvelope(progress, template, params);
    
    case 'wave':
      return waveEnvelope(progress, template, params);
    
    case 'strobe':
      return strobeEnvelope(progress, template, params);
    
    case 'chase':
      return chaseEnvelope(progress, template, params);
    
    case 'color_fade':
      return 1; // Full intensity, color changes separately
    
    default:
      return params.intensity !== undefined ? params.intensity : 1;
  }
}

function burstEnvelope(progress, template, params) {
  const rampUp = params.rampUp || template.rampUp || 0.1;
  const rampDown = params.rampDown || template.rampDown || 0.3;
  const peak = params.peakIntensity || template.peakIntensity || 1;
  
  if (progress < rampUp) {
    return (progress / rampUp) * peak;
  } else if (progress < rampUp + 0.1) {
    return peak;
  } else {
    const decayProgress = (progress - rampUp - 0.1) / rampDown;
    return Math.max(peak * (1 - decayProgress), 0);
  }
}

function pulseEnvelope(progress, template, params) {
  const rampUp = params.rampUp || template.rampUp || 0.2;
  const sustain = params.sustain || template.sustain || 0.6;
  const rampDown = params.rampDown || template.rampDown || 0.2;
  const peak = params.peakIntensity || template.peakIntensity || 1;
  
  if (progress < rampUp) {
    return (progress / rampUp) * peak;
  } else if (progress < rampUp + sustain) {
    return peak;
  } else {
    const decayProgress = (progress - rampUp - sustain) / rampDown;
    return Math.max(peak * (1 - decayProgress), 0);
  }
}

function waveEnvelope(progress, template, params) {
  const phase = (params.phase || 0) + (progress * Math.PI * 2 * (params.frequency || 1));
  const peak = params.peakIntensity || template.peakIntensity || 1;
  return (Math.sin(phase) + 1) / 2 * peak;
}

function strobeEnvelope(progress, template, params) {
  const freq = params.frequency || template.frequency || 10;
  const duty = params.dutyCycle || template.dutyCycle || 0.5;
  const cycle = (progress * freq) % 1;
  return cycle < duty ? (params.peakIntensity || 1) : 0;
}

function chaseEnvelope(progress, template, params) {
  const stepDuration = params.stepDuration || template.stepDuration || 0.2;
  const step = Math.floor(progress / stepDuration);
  return step % 2 === 0 ? 1 : 0; // Simplified — actual chase needs fixture indexing
}

// ─── Fixture State Computation ───────────────────────────────────────

function computeFixtureState(fixture, effect, envelope, progress, clipColor, audioFeatures) {
  const baseState = getDefaultFixtureState(fixture.type);
  const params = effect.params || {};
  
  // Apply envelope intensity
  baseState.intensity = envelope;
  baseState.on = envelope > 0.01;
  
  // Apply height scale
  if (params.height !== undefined) {
    baseState.heightScale = params.height;
  }
  
  // Apply tilt
  if (params.tiltX !== undefined) baseState.tiltX = params.tiltX;
  if (params.tiltZ !== undefined) baseState.tiltZ = params.tiltZ;
  
  // Apply color
  if (params.color) {
    baseState.color = params.color;
  } else if (clipColor) {
    baseState.color = clipColor;
  } else if (effect.type === 'color_fade') {
    const template = EFFECT_TEMPLATES.color_fade;
    const colors = params.colors || template.colors;
    baseState.color = interpolateColor(colors, progress);
  }
  
  // Audio reactivity
  if (audioFeatures && params.audioReactive) {
    const segment = findAudioSegment(audioFeatures, progress);
    if (segment) {
      baseState.intensity *= segment.loudness || 1;
      baseState.heightScale *= (segment.loudness || 1) * 1.5;
    }
  }
  
  return baseState;
}

function getDefaultFixtureState(type) {
  return {
    intensity: 0,
    tiltX: 0,
    tiltZ: 0,
    color: '#88ccff',
    heightScale: 1,
    on: false,
  };
}

// ─── Protocol / Hardware Output ──────────────────────────────────────

function getFixtureProtocol(fixture) {
  if (fixture.type?.startsWith('light_') || fixture.type?.includes('light')) {
    return 'dmx';
  }
  if (fixture.type?.includes('motion') || fixture.type?.includes('robotic')) {
    return 'plc'; // Programmable Logic Controller for motors
  }
  return 'relay'; // Default: on/off relay control
}

function stateToProtocolParams(fixture, state) {
  const protocol = getFixtureProtocol(fixture);
  
  switch (protocol) {
    case 'dmx': {
      const patch = readPatch(fixture);
      return {
        channel: patch.startChannel || 1,
        universe: patch.universe || 1,
        intensity: Math.round(state.intensity * 255),
        tiltX: Math.round((state.tiltX + 90) / 180 * 255), // Map -90..90 to 0..255
        tiltZ: Math.round((state.tiltZ + 90) / 180 * 255),
        color: hexToDMXColor(state.color),
        strobe: state.on ? 0 : 255,
      };
    }

    case 'plc':
      return {
        motorId: fixture.motorId || fixture.id,
        tiltX: state.tiltX,
        tiltZ: state.tiltZ,
        speed: state.intensity * 100, // Percentage
        enable: state.on,
      };
    
    case 'relay':
    default:
      return {
        relayId: fixture.relayId || fixture.id,
        state: state.on,
        intensity: state.intensity,
      };
  }
}

function hexToDMXColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function interpolateColor(colors, progress) {
  if (!colors || colors.length < 2) return colors?.[0] || '#ffffff';
  const scaled = progress * (colors.length - 1);
  const index = Math.floor(scaled);
  const frac = scaled - index;
  const c1 = hexToRGB(colors[index]);
  const c2 = hexToRGB(colors[Math.min(index + 1, colors.length - 1)]);
  const r = Math.round(c1.r + (c2.r - c1.r) * frac);
  const g = Math.round(c1.g + (c2.g - c1.g) * frac);
  const b = Math.round(c1.b + (c2.b - c1.b) * frac);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function hexToRGB(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// ─── Utilities ───────────────────────────────────────────────────────

function stateChanged(current, previous) {
  if (!previous) return true;
  return (
    current.intensity !== previous.intensity ||
    current.tiltX !== previous.tiltX ||
    current.tiltZ !== previous.tiltZ ||
    current.color !== previous.color ||
    current.on !== previous.on
  );
}

function optimizeCommands(commands) {
  // Remove redundant commands (same state as previous for same fixture)
  const optimized = [];
  const lastState = {};
  
  commands.sort((a, b) => a.time - b.time);
  
  for (const cmd of commands) {
    const key = `${cmd.fixtureId}_${cmd.type}`;
    const prev = lastState[key];
    
    if (!prev || JSON.stringify(cmd.params) !== JSON.stringify(prev.params)) {
      optimized.push(cmd);
      lastState[key] = cmd;
    }
  }
  
  return optimized;
}

function findAudioSegment(audioFeatures, progress) {
  if (!audioFeatures?.segments) return null;
  return audioFeatures.segments.find(
    seg => progress >= seg.start && progress < seg.end
  );
}

function generateShowId() {
  return `show_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ─── Export Utilities ────────────────────────────────────────────────

/**
 * Export compiled show to DMX512 binary format
 */
export function exportToDMX(compiledShow) {
  const dmxData = [];
  const { frames, fps } = compiledShow;
  
  frames.forEach(frame => {
    const universe = new Array(512).fill(0);
    Object.entries(frame.states).forEach(([fixtureId, state]) => {
      // Simplified: assumes sequential channel mapping
      // Real implementation would use fixture.dmxChannel
      const baseChannel = (parseInt(fixtureId) % 64) * 8; // 64 fixtures per universe
      if (baseChannel + 7 < 512) {
        universe[baseChannel] = Math.round(state.intensity * 255);
        universe[baseChannel + 1] = Math.round((state.tiltX + 90) / 180 * 255);
        universe[baseChannel + 2] = Math.round((state.tiltZ + 90) / 180 * 255);
        const color = hexToRGB(state.color);
        universe[baseChannel + 3] = color.r;
        universe[baseChannel + 4] = color.g;
        universe[baseChannel + 5] = color.b;
        universe[baseChannel + 6] = state.on ? 255 : 0;
        universe[baseChannel + 7] = Math.round(state.heightScale * 85); // 0-255 mapped to 0-3x
      }
    });
    dmxData.push(universe);
  });
  
  return {
    format: 'dmx512',
    fps,
    frameCount: dmxData.length,
    universes: dmxData,
  };
}

/**
 * Export compiled show to PLC command sequence
 */
export function exportToPLC(compiledShow) {
  const commands = compiledShow.fixtureCommands
    .filter(cmd => cmd.type === 'plc' || cmd.type === 'relay')
    .map(cmd => ({
      timestamp: Math.round(cmd.time * 1000), // ms
      motorId: cmd.params.motorId || cmd.params.relayId,
      command: cmd.type === 'plc' ? 'MOVE' : 'SET',
      params: cmd.params,
    }));
  
  return {
    format: 'plc',
    commandCount: commands.length,
    commands,
  };
}

/**
 * Export to JSON for playback engine
 */
export function exportToJSON(compiledShow) {
  return JSON.stringify(compiledShow, null, 2);
}

/**
 * Validate a show before compilation
 */
export function validateShow(clips, fixtures) {
  const errors = [];
  
  // Check for overlapping clips on same fixture
  const fixtureTimelines = {};
  clips.forEach(clip => {
    (clip.fixtures || []).forEach(fid => {
      if (!fixtureTimelines[fid]) fixtureTimelines[fid] = [];
      fixtureTimelines[fid].push({
        start: clip.startTime,
        end: clip.startTime + clip.duration,
        clip: clip.name || clip.id,
      });
    });
  });
  
  Object.entries(fixtureTimelines).forEach(([fid, timeline]) => {
    const fixture = fixtures.find(f => f.id === fid);
    timeline.sort((a, b) => a.start - b.start);
    for (let i = 1; i < timeline.length; i++) {
      if (timeline[i].start < timeline[i-1].end) {
        errors.push({
          type: 'overlap',
          fixture: fixture?.label || fid,
          clip1: timeline[i-1].clip,
          clip2: timeline[i].clip,
          time: timeline[i].start,
        });
      }
    }
  });
  
  // Check for unmapped fixtures
  clips.forEach(clip => {
    if (!clip.fixtures || clip.fixtures.length === 0) {
      errors.push({
        type: 'no_fixtures',
        clip: clip.name || clip.id,
        message: 'Clip has no fixtures assigned',
      });
    }
  });
  
  // Check DMX channel limits
  const dmxFixtures = fixtures.filter(f => getFixtureProtocol(f) === 'dmx');
  if (dmxFixtures.length * DMX_CHANNELS_PER_FIXTURE > MAX_DMX_UNIVERSE) {
    errors.push({
      type: 'dmx_overflow',
      message: `DMX channel overflow: ${dmxFixtures.length * DMX_CHANNELS_PER_FIXTURE} > ${MAX_DMX_UNIVERSE}`,
    });
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings: [], // Could add warnings for low intensity, etc.
  };
}