const TAU = Math.PI * 2;

export const DEFAULT_GRAVITY_MS2 = 9.81;

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const positive = (v, fallback) => Math.max(1e-6, finite(v, fallback));
const smoothstep = (a, b, v) => {
  if (b <= a) return v >= b ? 1 : 0;
  const x = clamp((v - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
const unit = (v, fallback = [0, 1, 0]) => {
  const a = Array.isArray(v) && v.length >= 3 ? v.map((n) => finite(n)) : fallback;
  const length = Math.hypot(...a);
  return length > 1e-9 ? scale(a, 1 / length) : [...fallback];
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function basisAround(axis) {
  const reference = Math.abs(axis[1]) < 0.999 ? [0, 1, 0] : [0, 0, 1];
  const first = unit(cross(axis, reference), [1, 0, 0]);
  return [first, unit(cross(first, axis), [0, 0, 1])];
}

function freezeProfiles(profiles) {
  for (const profile of Object.values(profiles)) {
    for (const value of Object.values(profile)) {
      if (value && typeof value === "object" && !Array.isArray(value)) Object.freeze(value);
    }
    Object.freeze(profile);
  }
  return Object.freeze(profiles);
}

export const RADIAL_FILM_PROFILES = freezeProfiles({
  bell: {
    trajectory: { radialSpeedMs: 1.45, verticalSpeedMs: 3.1, lipRadiusM: 0.07 },
    width: { mode: "arc", coverageRad: TAU, minM: 0.01 },
    thickness: { startM: 0.012, minM: 0.0008, referenceRadiusM: 0.07 },
    breakup: { startS: 0.5, fullS: 1.3, rimBoost: 0.25 },
    rimInstability: { amplitudeM: 0.026, lobes: 11, frequencyHz: 1.8, growthS: 0.35, verticalRatio: 0.45 },
  },
  dome: {
    trajectory: { radialSpeedMs: 0.85, verticalSpeedMs: 3.55, lipRadiusM: 0.06 },
    width: { mode: "arc", coverageRad: TAU, minM: 0.01 },
    thickness: { startM: 0.014, minM: 0.0009, referenceRadiusM: 0.06 },
    breakup: { startS: 0.62, fullS: 1.45, rimBoost: 0.2 },
    rimInstability: { amplitudeM: 0.018, lobes: 9, frequencyHz: 1.5, growthS: 0.45, verticalRatio: 0.35 },
  },
  mushroom: {
    trajectory: { radialSpeedMs: 2.45, verticalSpeedMs: 1.55, lipRadiusM: 0.09 },
    width: { mode: "arc", coverageRad: TAU, minM: 0.01 },
    thickness: { startM: 0.018, minM: 0.001, referenceRadiusM: 0.09 },
    breakup: { startS: 0.34, fullS: 0.95, rimBoost: 0.35 },
    rimInstability: { amplitudeM: 0.035, lobes: 15, frequencyHz: 2.3, growthS: 0.25, verticalRatio: 0.25 },
  },
  tulip: {
    trajectory: { radialSpeedMs: 0.62, verticalSpeedMs: 3.9, lipRadiusM: 0.055 },
    width: { mode: "arc", coverageRad: TAU * 0.96, minM: 0.01 },
    thickness: { startM: 0.011, minM: 0.0007, referenceRadiusM: 0.055 },
    breakup: { startS: 0.7, fullS: 1.55, rimBoost: 0.3 },
    rimInstability: { amplitudeM: 0.032, lobes: 7, frequencyHz: 1.25, growthS: 0.5, verticalRatio: 0.7 },
  },
  umbrella: {
    trajectory: { radialSpeedMs: 2.9, verticalSpeedMs: 2.05, lipRadiusM: 0.08 },
    width: { mode: "arc", coverageRad: TAU, minM: 0.01 },
    thickness: { startM: 0.013, minM: 0.0008, referenceRadiusM: 0.08 },
    breakup: { startS: 0.4, fullS: 1.1, rimBoost: 0.35 },
    rimInstability: { amplitudeM: 0.04, lobes: 17, frequencyHz: 2, growthS: 0.3, verticalRatio: 0.3 },
  },
  sphere: {
    trajectory: { kind: "spherical", speedMs: 4.6, minPolarDeg: 0, maxPolarDeg: 180 },
    width: { mode: "stream", startM: 0.009, endM: 0.018, minM: 0.002 },
    thickness: { startM: 0.005, minM: 0.0015, referenceRadiusM: 0.02 },
    breakup: { startS: 0.18, fullS: 0.65, rimBoost: 0.15 },
    rimInstability: { amplitudeM: 0.006, lobes: 13, frequencyHz: 2.6, growthS: 0.12, verticalRatio: 0 },
  },
  dandelion: {
    trajectory: { kind: "spherical", speedMs: 3.8, minPolarDeg: 0, maxPolarDeg: 150 },
    width: { mode: "stream", startM: 0.007, endM: 0.016, minM: 0.0015 },
    thickness: { startM: 0.004, minM: 0.0012, referenceRadiusM: 0.02 },
    breakup: { startS: 0.2, fullS: 0.72, rimBoost: 0.2 },
    rimInstability: { amplitudeM: 0.008, lobes: 19, frequencyHz: 2.1, growthS: 0.15, verticalRatio: 0 },
  },
});

export const DEFAULT_WATERWALL_ADHESION = Object.freeze({
  enabled: true,
  strength: 0.88,
  normalDampingPerSecond: 5.5,
  wettingFriction: 0.08,
  gravityScale: 1,
  detachmentOffsetM: 0.028,
  detachmentBreakup: 0.72,
});

export const FALLING_WATER_PROFILES = freezeProfiles({
  cascade: {
    widthM: 2,
    trajectory: { horizontalSpeedMs: 0.18, verticalSpeedMs: -0.45 },
    thickness: { startM: 0.018, minM: 0.002, thinningPerSecond: 0.3 },
    breakup: { startS: 0.75, fullS: 2.6 },
    edgeInstability: { amplitudeM: 0.018, waves: 8, frequencyHz: 1.6, growthS: 0.4 },
  },
  weir: {
    widthM: 3,
    trajectory: { horizontalSpeedMs: 0.8, verticalSpeedMs: -0.05 },
    thickness: { startM: 0.032, minM: 0.003, thinningPerSecond: 0.22 },
    breakup: { startS: 1.05, fullS: 3.2 },
    edgeInstability: { amplitudeM: 0.012, waves: 11, frequencyHz: 1.1, growthS: 0.55 },
  },
  stepped_fall: {
    widthM: 2,
    trajectory: { horizontalSpeedMs: 0.7, verticalSpeedMs: -0.1 },
    thickness: { startM: 0.026, minM: 0.003, thinningPerSecond: 0.18 },
    breakup: { startS: 1.2, fullS: 3.6, perStepBoost: 0.12 },
    edgeInstability: { amplitudeM: 0.015, waves: 9, frequencyHz: 1.4, growthS: 0.45 },
    steps: { count: 3, dropM: 0.35, runM: 0.48, horizontalRestitution: 0.82, verticalRestitution: 0.18 },
  },
  waterwall: {
    widthM: 2,
    trajectory: { horizontalSpeedMs: 0.16, verticalSpeedMs: -0.08 },
    thickness: { startM: 0.014, minM: 0.0015, thinningPerSecond: 0.14 },
    breakup: { startS: 1.35, fullS: 4.2 },
    edgeInstability: { amplitudeM: 0.009, waves: 14, frequencyHz: 0.9, growthS: 0.7 },
    adhesion: DEFAULT_WATERWALL_ADHESION,
  },
});

const RADIAL_ALIASES = Object.freeze({
  water_bell: "bell", water_dome: "dome", water_mushroom: "mushroom",
  water_tulip: "tulip", water_umbrella: "umbrella", crystal_ball: "sphere",
  water_sphere: "sphere", dandelion_sphere: "dandelion",
});
const FALLING_ALIASES = Object.freeze({
  waterfall: "cascade", falling_water: "cascade", stepped: "stepped_fall",
  step_fall: "stepped_fall", stepped_weir: "stepped_fall", water_wall: "waterwall",
  wall: "waterwall", rain_wall: "waterwall",
});
const canonical = (kind, aliases) => {
  const key = String(kind || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return aliases[key] || key;
};
const originOf = (options) => Array.isArray(options.origin)
  ? unitLengthVector(options.origin)
  : [finite(options.x), finite(options.y, 0.08), finite(options.z)];
function unitLengthVector(value) {
  return [finite(value[0]), finite(value[1]), finite(value[2])];
}

/**
 * Build a complete thin radial sheet/filament descriptor. Presets can be replaced
 * field-by-field through trajectory, width, thickness, breakup and rimInstability.
 */
export function describeRadialFilm(kind = "bell", options = {}) {
  if (kind && typeof kind === "object") {
    options = kind;
    kind = options.type || options.kind || "bell";
  }
  const type = canonical(kind, RADIAL_ALIASES);
  const profile = RADIAL_FILM_PROFILES[type];
  if (!profile) throw new RangeError(`Unknown radial film type: ${kind}`);
  const level = clamp(finite(options.intensity, 1));
  const speedScale = Math.sqrt(level);
  const axis = unit(options.axis);
  const trajectory = { gravityMs2: DEFAULT_GRAVITY_MS2, kind: "ballistic", ...profile.trajectory, ...options.trajectory };
  if (trajectory.kind === "spherical") trajectory.speedMs = positive(trajectory.speedMs, 4) * speedScale;
  else {
    trajectory.radialSpeedMs = positive(trajectory.radialSpeedMs, 1) * speedScale;
    trajectory.verticalSpeedMs = finite(trajectory.verticalSpeedMs, 2) * speedScale;
  }
  trajectory.gravityMs2 = Math.max(0, finite(trajectory.gravityMs2, DEFAULT_GRAVITY_MS2));
  trajectory.lipRadiusM = Math.max(0, finite(trajectory.lipRadiusM));
  const thickness = { ...profile.thickness, ...options.thickness };
  thickness.startM = positive(thickness.startM, 0.01) * Math.max(0.05, level);
  thickness.minM = positive(thickness.minM, 0.001);
  return {
    model: "thin-radial-film",
    type,
    active: level > 0,
    intensity: level,
    origin: originOf(options),
    axis,
    basis: basisAround(axis),
    rotationRad: finite(options.rotationRad, finite(options.rotationDeg) * Math.PI / 180),
    trajectory,
    width: { ...profile.width, ...options.width },
    thickness,
    breakup: { ...profile.breakup, ...options.breakup },
    rimInstability: { phaseRad: 0, ...profile.rimInstability, ...options.rimInstability },
  };
}

/** Sample by seconds, azimuth in [0,1], and polar position in [0,1] for spheres. */
export function sampleRadialFilm(descriptor, timeS, azimuthU = 0, polarU = 0.5) {
  const d = descriptor;
  if (!d || d.model !== "thin-radial-film") throw new TypeError("A thin-radial-film descriptor is required");
  const t = Math.max(0, finite(timeS));
  const u = finite(azimuthU) - Math.floor(finite(azimuthU));
  const angle = finite(d.rotationRad) + u * TAU;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const radialDirection = add(scale(d.basis[0], ca), scale(d.basis[1], sa));
  const rim = d.rimInstability;
  const rimWave = finite(rim.amplitudeM) * smoothstep(0, positive(rim.growthS, 0.3), t)
    * Math.sin(u * TAU * Math.max(1, Math.round(finite(rim.lobes, 1)))
      + finite(rim.phaseRad) + t * TAU * finite(rim.frequencyHz));
  const trajectory = d.trajectory;
  let direction = radialDirection;
  let distance;
  let velocity;
  let radius;
  if (trajectory.kind === "spherical") {
    const polar = (finite(trajectory.minPolarDeg) + clamp(finite(polarU))
      * (finite(trajectory.maxPolarDeg, 180) - finite(trajectory.minPolarDeg))) * Math.PI / 180;
    direction = add(scale(d.axis, Math.cos(polar)), scale(radialDirection, Math.sin(polar)));
    distance = positive(trajectory.speedMs, 4) * t + rimWave;
    radius = Math.max(0, distance);
    velocity = add(scale(direction, positive(trajectory.speedMs, 4)), [0, -trajectory.gravityMs2 * t, 0]);
  } else {
    const radialSpeed = positive(trajectory.radialSpeedMs, 1);
    radius = Math.max(0, finite(trajectory.lipRadiusM) + radialSpeed * t + rimWave);
    distance = radius;
    velocity = add(add(scale(radialDirection, radialSpeed), scale(d.axis, finite(trajectory.verticalSpeedMs))),
      [0, -trajectory.gravityMs2 * t, 0]);
  }
  let position = add(add(d.origin, scale(direction, distance)), [0, -0.5 * trajectory.gravityMs2 * t * t, 0]);
  if (trajectory.kind !== "spherical") {
    position = add(position, scale(d.axis, finite(trajectory.verticalSpeedMs) * t + finite(rim.verticalRatio) * rimWave));
  }
  const baseBreakup = smoothstep(finite(d.breakup.startS, 0.5), finite(d.breakup.fullS, 1.5), t);
  const rimShare = Math.abs(finite(rim.amplitudeM)) > 1e-9 ? Math.abs(rimWave / rim.amplitudeM) : 0;
  const breakup = clamp(baseBreakup + finite(d.breakup.rimBoost) * rimShare * baseBreakup);
  let widthM;
  if (d.width.mode === "arc") widthM = Math.max(finite(d.width.minM), radius * positive(d.width.coverageRad, TAU));
  else {
    const spread = smoothstep(0, positive(d.breakup.fullS, 1), t);
    widthM = Math.max(finite(d.width.minM), finite(d.width.startM, 0.008)
      + (finite(d.width.endM, 0.016) - finite(d.width.startM, 0.008)) * spread);
  }
  const speed = Math.max(0.1, Math.hypot(...velocity));
  const launchSpeed = trajectory.kind === "spherical" ? positive(trajectory.speedMs, 4)
    : Math.hypot(positive(trajectory.radialSpeedMs, 1), finite(trajectory.verticalSpeedMs));
  const referenceRadius = positive(d.thickness.referenceRadiusM, 0.05);
  const flowRatio = d.width.mode === "arc" ? referenceRadius / Math.max(referenceRadius, radius) : 1 / Math.sqrt(1 + t);
  const thicknessM = Math.max(positive(d.thickness.minM, 0.001), positive(d.thickness.startM, 0.01)
    * flowRatio * Math.max(0.25, launchSpeed) / speed);
  return {
    position, velocity, widthM, thicknessM, breakup, coherence: 1 - breakup,
    rimOffsetM: rimWave, radiusM: radius, timeS: t,
  };
}

function stepsOf(profile, options) {
  const source = options.steps ?? profile.steps;
  if (!source) return [];
  const raw = Array.isArray(source) ? source : Array.from({ length: Math.max(1, Math.round(finite(source.count, 3))) }, () => source);
  return raw.map((step) => ({
    dropM: positive(step.dropM, 0.35),
    runM: positive(step.runM, 0.48),
    horizontalRestitution: clamp(finite(step.horizontalRestitution, 0.82)),
    verticalRestitution: clamp(finite(step.verticalRestitution, 0.18)),
  }));
}

/** Build a line-source cascade, weir, stepped fall or adhered waterwall descriptor. */
export function describeFallingWater(kind = "cascade", options = {}) {
  if (kind && typeof kind === "object") {
    options = kind;
    kind = options.type || options.kind || "cascade";
  }
  const type = canonical(kind, FALLING_ALIASES);
  const profile = FALLING_WATER_PROFILES[type];
  if (!profile) throw new RangeError(`Unknown falling-water type: ${kind}`);
  const level = clamp(finite(options.intensity, 1));
  const speedScale = Math.sqrt(level);
  const surfaceNormal = unit(options.surfaceNormal, [0, 0, -1]);
  const launchDirection = unit(options.launchDirection, scale(surfaceNormal, -1));
  const trajectory = { gravityMs2: DEFAULT_GRAVITY_MS2, ...profile.trajectory, ...options.trajectory };
  trajectory.horizontalSpeedMs = Math.max(0, finite(trajectory.horizontalSpeedMs)) * speedScale;
  trajectory.verticalSpeedMs = finite(trajectory.verticalSpeedMs) * speedScale;
  trajectory.gravityMs2 = Math.max(0, finite(trajectory.gravityMs2, DEFAULT_GRAVITY_MS2));
  const thickness = { ...profile.thickness, ...options.thickness };
  thickness.startM = positive(thickness.startM, 0.02) * Math.max(0.05, level);
  return {
    model: "line-source-falling-water",
    type,
    active: level > 0,
    intensity: level,
    origin: originOf(options),
    lineAxis: unit(options.lineAxis, [1, 0, 0]),
    launchDirection,
    surfaceNormal,
    widthM: positive(options.widthM, profile.widthM),
    trajectory,
    thickness,
    breakup: { ...profile.breakup, ...options.breakup },
    edgeInstability: { phaseRad: 0, ...profile.edgeInstability, ...options.edgeInstability },
    adhesion: type === "waterwall" ? { ...DEFAULT_WATERWALL_ADHESION, ...options.adhesion } : null,
    steps: stepsOf(profile, options),
  };
}

function fallingValues(d, t, lineU) {
  const edge = d.edgeInstability;
  const wave = finite(edge.amplitudeM) * smoothstep(0, positive(edge.growthS, 0.4), t)
    * Math.sin(lineU * TAU * Math.max(1, Math.round(finite(edge.waves, 1)))
      + finite(edge.phaseRad) + t * TAU * finite(edge.frequencyHz));
  const breakup = smoothstep(finite(d.breakup.startS, 1), finite(d.breakup.fullS, 3), t);
  const thicknessM = Math.max(positive(d.thickness.minM, 0.002), positive(d.thickness.startM, 0.02)
    / (1 + Math.max(0, finite(d.thickness.thinningPerSecond)) * t));
  return { wave, breakup, thicknessM };
}

function sampleAdheredWall(d, t, base, values) {
  const adhesion = d.adhesion;
  const trajectory = d.trajectory;
  const damping = positive(adhesion.normalDampingPerSecond, 5.5) * Math.max(0.05, finite(adhesion.strength, 0.88));
  const launchSpeed = Math.max(0, finite(trajectory.horizontalSpeedMs));
  const asymptote = launchSpeed / damping;
  const cap = Math.max(0, finite(adhesion.detachmentOffsetM, 0.028));
  const offsetDetach = cap > 0 && cap < asymptote ? -Math.log(1 - cap / asymptote) / damping : Infinity;
  const breakupDetach = finite(d.breakup.startS, 1)
    + clamp(finite(adhesion.detachmentBreakup, 0.72))
      * Math.max(0, finite(d.breakup.fullS, 3) - finite(d.breakup.startS, 1));
  const detachmentTimeS = Math.max(0, Math.min(offsetDetach, breakupDetach));
  const attachedGravity = trajectory.gravityMs2 * Math.max(0, finite(adhesion.gravityScale, 1))
    * Math.max(0.05, 1 - clamp(finite(adhesion.wettingFriction)) * clamp(finite(adhesion.strength)));
  const stateAt = (time, adhered) => {
    const local = adhered ? time : detachmentTimeS;
    const offset = asymptote * (1 - Math.exp(-damping * local));
    const gravity = adhered ? attachedGravity : attachedGravity;
    let position = add(base, scale(d.launchDirection, offset + values.wave));
    position = add(position, [0, trajectory.verticalSpeedMs * local - 0.5 * gravity * local * local, 0]);
    let velocity = add(scale(d.launchDirection, launchSpeed * Math.exp(-damping * local)),
      [0, trajectory.verticalSpeedMs - gravity * local, 0]);
    if (!adhered && time > detachmentTimeS) {
      const dt = time - detachmentTimeS;
      position = add(add(position, scale(velocity, dt)), [0, -0.5 * trajectory.gravityMs2 * dt * dt, 0]);
      velocity = add(velocity, [0, -trajectory.gravityMs2 * dt, 0]);
    }
    return { position, velocity, surfaceOffsetM: offset };
  };
  const attached = adhesion.enabled !== false && t <= detachmentTimeS;
  const state = adhesion.enabled === false ? null : stateAt(t, attached);
  if (state) return { ...state, attached, detachmentTimeS };
  return null;
}

/** Sample a line-source at normalized position lineU across its lip. */
export function sampleFallingWater(descriptor, timeS, lineU = 0.5) {
  const d = descriptor;
  if (!d || d.model !== "line-source-falling-water") throw new TypeError("A line-source-falling-water descriptor is required");
  const t = Math.max(0, finite(timeS));
  const u = clamp(finite(lineU, 0.5));
  const values = fallingValues(d, t, u);
  const base = add(d.origin, scale(d.lineAxis, (u - 0.5) * d.widthM));
  let state;
  let stepIndex = 0;
  if (d.steps.length) {
    let elapsed = 0;
    let stepBase = base;
    let horizontalSpeed = Math.max(1e-6, finite(d.trajectory.horizontalSpeedMs, 0.7));
    let incomingVertical = finite(d.trajectory.verticalSpeedMs);
    const gravity = d.trajectory.gravityMs2;
    let sampled = false;
    for (let i = 0; i < d.steps.length; i++) {
      const step = d.steps[i];
      const duration = step.runM / horizontalSpeed;
      const launchVertical = (0.5 * gravity * duration * duration - step.dropM) / duration;
      const local = t - elapsed;
      if (local <= duration) {
        state = {
          position: add(add(stepBase, scale(d.launchDirection, horizontalSpeed * local + values.wave)),
            [0, launchVertical * local - 0.5 * gravity * local * local, 0]),
          velocity: add(scale(d.launchDirection, horizontalSpeed), [0, launchVertical - gravity * local, 0]),
        };
        sampled = true;
        stepIndex = i;
        break;
      }
      stepBase = add(add(stepBase, scale(d.launchDirection, step.runM)), [0, -step.dropM, 0]);
      incomingVertical = (launchVertical - gravity * duration) * step.verticalRestitution;
      horizontalSpeed = Math.max(1e-6, horizontalSpeed * step.horizontalRestitution);
      elapsed += duration;
      stepIndex = i + 1;
    }
    if (!sampled) {
      const local = t - elapsed;
      state = {
        position: add(add(stepBase, scale(d.launchDirection, horizontalSpeed * local + values.wave)),
          [0, incomingVertical * local - 0.5 * gravity * local * local, 0]),
        velocity: add(scale(d.launchDirection, horizontalSpeed), [0, incomingVertical - gravity * local, 0]),
      };
    }
    values.breakup = clamp(values.breakup + stepIndex * finite(d.breakup.perStepBoost, 0.12));
  } else if (d.type === "waterwall" && d.adhesion?.enabled !== false) {
    state = sampleAdheredWall(d, t, base, values);
  }
  if (!state) {
    const horizontalSpeed = Math.max(0, finite(d.trajectory.horizontalSpeedMs));
    state = {
      position: add(add(base, scale(d.launchDirection, horizontalSpeed * t + values.wave)),
        [0, d.trajectory.verticalSpeedMs * t - 0.5 * d.trajectory.gravityMs2 * t * t, 0]),
      velocity: add(scale(d.launchDirection, horizontalSpeed),
        [0, d.trajectory.verticalSpeedMs - d.trajectory.gravityMs2 * t, 0]),
      attached: false,
    };
  }
  return {
    ...state,
    widthM: d.widthM,
    thicknessM: values.thicknessM,
    breakup: values.breakup,
    coherence: 1 - values.breakup,
    edgeOffsetM: values.wave,
    lineU: u,
    timeS: t,
    stepIndex,
  };
}

export function describeWaterwall(options = {}) {
  return describeFallingWater("waterwall", options);
}

export function sampleWaterwall(descriptor, timeS, lineU = 0.5) {
  return sampleFallingWater(descriptor, timeS, lineU);
}

export const describeThinRadialFilm = describeRadialFilm;
export const sampleThinRadialFilm = sampleRadialFilm;
