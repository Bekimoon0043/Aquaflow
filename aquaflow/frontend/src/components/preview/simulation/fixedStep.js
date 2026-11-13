export const DEFAULT_STEP_HZ = 60;
export const DEFAULT_FIXED_DT = 1 / DEFAULT_STEP_HZ;

const STEP_EPSILON = 1e-9;

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function validTime(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite non-negative number`);
  return value;
}

export class FixedStepAccumulator {
  constructor(options = {}) {
    const opts = typeof options === "number" ? { hz: options } : options;
    const hz = opts.hz ?? DEFAULT_STEP_HZ;
    if (!Number.isFinite(hz) || hz <= 0) throw new RangeError("hz must be a finite positive number");
    this.hz = hz;
    this.dt = 1 / hz;
    this.maxCatchUpSteps = positiveInteger(opts.maxCatchUpSteps ?? 8, "maxCatchUpSteps");
    this.reset();
  }

  reset() {
    this.accumulator = 0;
    this.time = 0;
    this.stepCount = 0;
    this.droppedSteps = 0;
    this.droppedTime = 0;
    return this;
  }

  advance(deltaSeconds, onStep) {
    validTime(deltaSeconds, "deltaSeconds");
    this.accumulator += deltaSeconds;
    const available = Math.max(0, Math.floor(this.accumulator / this.dt + STEP_EPSILON));
    const steps = Math.min(available, this.maxCatchUpSteps);
    this.run(steps, onStep);
    const droppedSteps = available - steps;
    const droppedTime = droppedSteps * this.dt;
    if (droppedSteps > 0) {
      this.accumulator = Math.max(0, this.accumulator - droppedTime);
      this.droppedSteps += droppedSteps;
      this.droppedTime += droppedTime;
    }
    if (this.accumulator < this.dt * STEP_EPSILON) this.accumulator = 0;
    return this.result(steps, droppedSteps, droppedTime);
  }

  seek(targetTime, onStep) {
    validTime(targetTime, "targetTime");
    this.reset();
    const steps = Math.max(0, Math.floor(targetTime / this.dt + STEP_EPSILON));
    this.run(steps, onStep);
    this.accumulator = Math.max(0, targetTime - steps * this.dt);
    return this.result(steps, 0, 0);
  }

  run(steps, onStep) {
    if (!Number.isInteger(steps) || steps < 0) throw new RangeError("steps must be a non-negative integer");
    for (let i = 0; i < steps; i += 1) {
      this.stepCount += 1;
      this.time = this.stepCount * this.dt;
      this.accumulator = Math.max(0, this.accumulator - this.dt);
      if (onStep) onStep(this.dt, this.time, this.stepCount - 1);
    }
  }

  result(steps, droppedSteps, droppedTime) {
    return {
      steps,
      alpha: Math.min(1, this.accumulator / this.dt),
      time: this.time,
      stepCount: this.stepCount,
      droppedSteps,
      droppedTime,
      totalDroppedSteps: this.droppedSteps,
      totalDroppedTime: this.droppedTime,
    };
  }
}

export function createFixedStep(options) {
  return new FixedStepAccumulator(options);
}

export function hashSeed(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRandomStream(seed = 1) {
  const initialSeed = typeof seed === "number" && Number.isFinite(seed) ? seed >>> 0 : hashSeed(seed);
  let state = initialSeed;
  function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  random.next = random;
  random.reset = () => {
    state = initialSeed;
    return random;
  };
  random.getState = () => state;
  random.setState = (nextState) => {
    if (!Number.isInteger(nextState) || nextState < 0 || nextState > 0xFFFFFFFF) {
      throw new RangeError("state must be an unsigned 32-bit integer");
    }
    state = nextState;
    return random;
  };
  Object.defineProperties(random, {
    seed: { value: initialSeed, enumerable: true },
    state: { get: () => state, enumerable: true },
  });
  return random;
}

export function fixtureSeed(fixtureId, seed = 0, stream = "droplets") {
  return hashSeed(`${hashSeed(seed)}/${hashSeed(fixtureId)}/${hashSeed(stream)}`);
}

export function createFixtureRandom(fixtureId, seed = 0, stream = "droplets") {
  return createRandomStream(fixtureSeed(fixtureId, seed, stream));
}
