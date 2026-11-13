import { describe, expect, it } from "vitest";
import { FixedStepAccumulator, createFixtureRandom } from "../fixedStep";
import {
  GRAVITY,
  dropletAcceleration,
  integrateDroplet,
  terminalVelocity,
} from "../dropletDynamics";

const droplet = (overrides = {}) => ({
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  diameterM: 0.002,
  ...overrides,
});

describe("droplet dynamics", () => {
  it("uses 9.81 m/s² for every droplet with semi-implicit Euler integration", () => {
    let state = droplet({ diameterM: 0.001, dragCoefficient: 0 });
    const original = structuredClone(state);
    const dt = 1 / 60;
    for (let step = 0; step < 60; step += 1) state = integrateDroplet(state, dt, { gravity: 0 });
    expect(GRAVITY).toBe(9.81);
    expect(state.velocity.y).toBeCloseTo(-9.81, 12);
    expect(state.position.y).toBeCloseTo(-9.81 * dt * dt * (60 * 61) / 2, 12);
    expect(original.velocity.y).toBe(0);
    expect(original.position.y).toBe(0);
  });

  it("makes smaller or higher-drag droplets reach a lower terminal speed", () => {
    expect(terminalVelocity(0.001)).toBeLessThan(terminalVelocity(0.005));
    expect(terminalVelocity(0.002, 0.8)).toBeLessThan(terminalVelocity(0.002, 0.3));

    const fall = (diameterM) => {
      let state = droplet({ diameterM });
      for (let step = 0; step < 60 * 12; step += 1) state = integrateDroplet(state, 1 / 60);
      return -state.velocity.y;
    };
    expect(fall(0.001)).toBeCloseTo(terminalVelocity(0.001), 1);
    expect(fall(0.005)).toBeCloseTo(terminalVelocity(0.005), 1);
  });

  it("applies quadratic drag to air-relative velocity", () => {
    const atRest = droplet();
    const movingWithAir = droplet({ velocity: { x: 4, y: 0, z: 0 } });
    expect(dropletAcceleration(atRest, { airVelocity: { x: 4, y: 0, z: 0 } }).x).toBeGreaterThan(0);
    expect(dropletAcceleration(movingWithAir, { airVelocity: { x: 4, y: 0, z: 0 } })).toEqual({ x: 0, y: -9.81, z: 0 });

    const slow = dropletAcceleration(droplet({ velocity: { x: 1, y: 0, z: 0 } }));
    const fast = dropletAcceleration(droplet({ velocity: { x: 4, y: 0, z: 0 } }));
    expect(Math.abs(fast.x)).toBeCloseTo(16 * Math.abs(slow.x), 12);
  });

  it("adds optional turbulence and curl velocity fields", () => {
    let observed;
    const state = droplet();
    const acceleration = dropletAcceleration(state, {
      turbulence: { x: 2, y: 0, z: 0 },
      curl: (position, time, current) => {
        observed = { position, time, current };
        return { x: 3, y: 0, z: 1 };
      },
    }, 1.25);
    expect(acceleration.x).toBeGreaterThan(0);
    expect(acceleration.z).toBeGreaterThan(0);
    expect(acceleration.y).toBe(-9.81);
    expect(observed.position).toEqual(state.position);
    expect(observed.time).toBe(1.25);
    expect(observed.current).toMatchObject({ diameterM: 0.002 });
  });

  it("replays exactly across display rates and after a seek", () => {
    const initial = droplet({ diameterM: 0.001, velocity: { x: 2, y: 8, z: 0 } });
    const step = (state, random) => (dt, time) => integrateDroplet(state, dt, {
      timeSeconds: time,
      turbulence: (position, t) => ({ x: Math.sin(t * 3) * 0.2, y: 0, z: Math.cos(t * 2) * 0.2 }),
      curl: { x: (random() - 0.5) * 0.1, y: 0, z: 0 },
    });

    const run = (deltas) => {
      const clock = new FixedStepAccumulator({ maxCatchUpSteps: 1000 });
      const random = createFixtureRandom("jet-replay", 19);
      let state = initial;
      const update = (dt, time) => { state = step(state, random)(dt, time); };
      for (const delta of deltas) clock.advance(delta, update);
      return state;
    };
    const at30 = run(Array.from({ length: 60 }, () => 1 / 30));
    const at144 = run(Array.from({ length: 288 }, () => 1 / 144));
    expect(at144).toEqual(at30);

    const replayClock = new FixedStepAccumulator({ hz: 60 });
    const replayRandom = createFixtureRandom("jet-replay", 19);
    let replayed = initial;
    replayClock.seek(2, (dt, time) => { replayed = step(replayed, replayRandom)(dt, time); });
    expect(replayed).toEqual(at30);
  });
});
