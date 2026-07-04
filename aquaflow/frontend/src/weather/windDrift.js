// windDrift.js — AquaFlow Wind Drift Safety (AQ-X-012)
//
// Pure, framework-agnostic wind-drift safety calculations mirroring the backend
// services/wind_drift.py, so the operator panel can compute drifted safety zones and
// warnings locally in real time (no network round-trip) as the weather changes.
//
//   computeSafetyZones(fountain, weather) → { center, exclusionRadius, breaches, jets }
//   operatorWarnings(zones, weather)      → severity-ranked warning list

export const GRAVITY = 9.81;
export const DEFAULT_SPLASH_RADIUS_M = 0.5;
export const DEFAULT_COUPLING = 0.5;
export const HIGH_WIND_SHUTDOWN_MS = 12.0;
export const MODERATE_WIND_MS = 8.0;
export const DEFAULT_GUST_FACTOR = 1.4;

const SEV_RANK = { critical: 0, warning: 1, caution: 2, info: 3 };

export function jetTimeOfFlight(heightM, g = GRAVITY) {
  return 2.0 * Math.sqrt((2.0 * Math.max(0, heightM)) / g);
}

export function windDrift(heightM, windSpeed, coupling = DEFAULT_COUPLING, g = GRAVITY) {
  return Math.max(0, coupling) * Math.abs(windSpeed) * jetTimeOfFlight(heightM, g);
}

// Wind vector as the direction the wind blows TOWARD (x = East, y = North).
// `fromDeg` is the meteorological direction it comes from (0=N, 90=E).
export function windVector(speed, fromDeg) {
  const toRad = ((fromDeg + 180.0) % 360.0) * (Math.PI / 180.0);
  return {
    east: speed * Math.sin(toRad),
    north: speed * Math.cos(toRad),
    magnitude: Math.abs(speed),
    toBearing: (fromDeg + 180.0) % 360.0,
  };
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function jetDrift(jet, weather, coupling = DEFAULT_COUPLING) {
  const x = Number(jet.x || 0), y = Number(jet.y || 0);
  const height = Number(jet.height ?? jet.jetHeightM ?? 4.0);
  const splash = Number(jet.splashRadius ?? DEFAULT_SPLASH_RADIUS_M);
  const gust = Number(weather.gustFactor ?? DEFAULT_GUST_FACTOR);
  const drift = windDrift(height, weather.windSpeed, coupling);
  const gustDrift = windDrift(height, weather.windSpeed * gust, coupling);
  const v = windVector(weather.windSpeed, weather.windDirection);
  const mag = Math.max(1e-9, v.magnitude);
  const ux = v.east / mag, uy = v.north / mag;
  const landing = [x + drift * ux, y + drift * uy];
  const gustLanding = [x + gustDrift * ux, y + gustDrift * uy];
  return {
    id: jet.id, origin: [x, y], heightM: height, splashRadiusM: splash,
    driftM: drift, gustDriftM: gustDrift, downwindUnit: [ux, uy],
    landing, gustLanding,
    farthestWet: [landing[0] + splash * ux, landing[1] + splash * uy],
  };
}

export function computeSafetyZones(fountain, weather, coupling = DEFAULT_COUPLING) {
  const jets = fountain.jets || [];
  const keepClear = Number(fountain.keepClearM || 0);
  let center;
  if (fountain.center) center = [Number(fountain.center[0]), Number(fountain.center[1])];
  else if (jets.length) {
    center = [jets.reduce((s, j) => s + Number(j.x || 0), 0) / jets.length,
              jets.reduce((s, j) => s + Number(j.y || 0), 0) / jets.length];
  } else center = [0, 0];

  const zones = [];
  let maxReach = 0, maxGustReach = 0;
  for (const j of jets) {
    const d = jetDrift(j, weather, coupling);
    const reach = dist(center, d.landing) + d.splashRadiusM;
    const gustReach = dist(center, d.gustLanding) + d.splashRadiusM;
    d.reachFromCenterM = reach;
    d.gustReachFromCenterM = gustReach;
    d.beyondKeepClear = keepClear > 0 ? reach > keepClear : false;
    zones.push(d);
    maxReach = Math.max(maxReach, reach);
    maxGustReach = Math.max(maxGustReach, gustReach);
  }

  const breaches = [];
  if (keepClear > 0 && maxReach > keepClear) {
    breaches.push({ type: "keep_clear", name: "keep-clear perimeter", limitM: keepClear,
      reachM: maxReach, exceededByM: maxReach - keepClear });
  }
  for (const b of fountain.barriers || []) {
    const limit = Number(b.distanceM || 0);
    if (limit > 0 && maxReach > limit) {
      breaches.push({ type: "barrier", name: b.name || "barrier", limitM: limit,
        reachM: maxReach, exceededByM: maxReach - limit });
    }
  }

  return {
    center, keepClearM: keepClear,
    exclusionRadiusM: maxReach, gustExclusionRadiusM: maxGustReach,
    jets: zones, breaches, wind: windVector(weather.windSpeed, weather.windDirection),
  };
}

export function operatorWarnings(zones, weather) {
  const out = [];
  const add = (severity, code, message) => out.push({ severity, code, message });
  const ws = weather.windSpeed;

  if (ws >= HIGH_WIND_SHUTDOWN_MS)
    add("critical", "high_wind",
      `High wind ${ws.toFixed(1)} m/s — pause tall jets or cut jet heights; heavy overspray/drift.`);
  else if (ws >= MODERATE_WIND_MS)
    add("caution", "moderate_wind",
      `Moderate wind ${ws.toFixed(1)} m/s — expect noticeable drift and overspray at the pool edge.`);

  for (const b of zones.breaches) {
    add(b.type === "keep_clear" ? "critical" : "warning", `${b.type}_breach`,
      `Spray drifts ${b.exceededByM.toFixed(2)} m beyond the ${b.name} ` +
      `(${b.reachM.toFixed(2)} m vs ${b.limitM.toFixed(2)} m limit) — move spectators back ` +
      `or reduce jet heights.`);
  }

  const kc = zones.keepClearM;
  if (kc > 0 && zones.exclusionRadiusM <= kc && zones.gustExclusionRadiusM > kc)
    add("warning", "gust_breach",
      `Gusts reach ${zones.gustExclusionRadiusM.toFixed(2)} m — beyond the ${kc.toFixed(2)} m keep-clear during gusts.`);

  if (out.length === 0)
    add("info", "clear", "Wind drift within safe limits — no operator action required.");

  out.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  return out;
}

export function analyzeWindDrift(fountain, weather, coupling = DEFAULT_COUPLING) {
  const zones = computeSafetyZones(fountain, weather, coupling);
  const warnings = operatorWarnings(zones, weather);
  return {
    zones, warnings,
    summary: {
      windSpeed: weather.windSpeed, windDirection: weather.windDirection,
      exclusionRadiusM: zones.exclusionRadiusM, keepClearM: zones.keepClearM,
      breachCount: zones.breaches.length,
      highestSeverity: warnings[0]?.severity || "info",
      safe: zones.breaches.length === 0 && weather.windSpeed < HIGH_WIND_SHUTDOWN_MS,
    },
  };
}
