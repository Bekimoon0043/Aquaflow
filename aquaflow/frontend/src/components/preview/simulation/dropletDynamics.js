export const GRAVITY = 9.81;
export const WATER_DENSITY = 998;
export const AIR_DENSITY = 1.2;
export const DEFAULT_DRAG_COEFFICIENT = 0.47;
export const DEFAULT_DROPLET_DIAMETER = 0.002;

const component = (vector, key, index) => {
  const value = Array.isArray(vector) ? vector[index] : vector?.[key];
  return Number.isFinite(value) ? value : 0;
};

const vector = (value) => ({
  x: component(value, "x", 0),
  y: component(value, "y", 1),
  z: component(value, "z", 2),
});

const positive = (value, fallback, name) => {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) throw new RangeError(`${name} must be a finite positive number`);
  return resolved;
};

const nonNegative = (value, fallback, name) => {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) throw new RangeError(`${name} must be a finite non-negative number`);
  return resolved;
};

function sampleVelocityField(field, droplet, timeSeconds) {
  if (field == null) return { x: 0, y: 0, z: 0 };
  const sampled = typeof field === "function" ? field(droplet.position, timeSeconds, droplet) : field;
  return vector(sampled);
}

export function dropletDragFactor(droplet = {}, environment = {}) {
  const diameterM = positive(droplet.diameterM, DEFAULT_DROPLET_DIAMETER, "diameterM");
  const dragCoefficient = nonNegative(droplet.dragCoefficient, DEFAULT_DRAG_COEFFICIENT, "dragCoefficient");
  const dragScale = nonNegative(droplet.dragScale, 1, "dragScale");
  const waterDensity = positive(environment.waterDensity, WATER_DENSITY, "waterDensity");
  const airDensity = nonNegative(environment.airDensity, AIR_DENSITY, "airDensity");
  return (3 * airDensity * dragCoefficient * dragScale) / (4 * waterDensity * diameterM);
}

export function terminalVelocity(diameterM = DEFAULT_DROPLET_DIAMETER, dragCoefficient = DEFAULT_DRAG_COEFFICIENT, environment = {}) {
  const factor = dropletDragFactor({ diameterM, dragCoefficient }, environment);
  return factor === 0 ? Infinity : Math.sqrt(GRAVITY / factor);
}

export function dropletAcceleration(droplet, environment = {}, timeSeconds = environment.timeSeconds ?? 0) {
  const position = vector(droplet.position);
  const velocity = vector(droplet.velocity);
  const state = { ...droplet, position, velocity };
  const air = vector(environment.airVelocity ?? environment.wind);
  const turbulence = sampleVelocityField(environment.turbulence, state, timeSeconds);
  const curl = sampleVelocityField(environment.curl, state, timeSeconds);
  const relative = {
    x: velocity.x - air.x - turbulence.x - curl.x,
    y: velocity.y - air.y - turbulence.y - curl.y,
    z: velocity.z - air.z - turbulence.z - curl.z,
  };
  const speed = Math.hypot(relative.x, relative.y, relative.z);
  const drag = dropletDragFactor(state, environment) * speed;
  return {
    x: drag === 0 ? 0 : -drag * relative.x,
    y: -GRAVITY - drag * relative.y,
    z: drag === 0 ? 0 : -drag * relative.z,
  };
}

export function integrateDroplet(droplet, dt, environment = {}, timeSeconds = environment.timeSeconds ?? 0) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError("dt must be a finite non-negative number");
  const position = vector(droplet.position);
  const velocity = vector(droplet.velocity);
  const state = { ...droplet, position, velocity };
  const acceleration = dropletAcceleration(state, environment, timeSeconds);
  const nextVelocity = {
    x: velocity.x + acceleration.x * dt,
    y: velocity.y + acceleration.y * dt,
    z: velocity.z + acceleration.z * dt,
  };
  return {
    ...state,
    position: {
      x: position.x + nextVelocity.x * dt,
      y: position.y + nextVelocity.y * dt,
      z: position.z + nextVelocity.z * dt,
    },
    velocity: nextVelocity,
    ...(droplet.age != null ? { age: Number(droplet.age) + dt } : {}),
  };
}
