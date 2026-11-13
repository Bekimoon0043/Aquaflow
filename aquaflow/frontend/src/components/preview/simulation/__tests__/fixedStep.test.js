import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIXED_DT,
  FixedStepAccumulator,
  createFixtureRandom,
  createRandomStream,
  fixtureSeed,
} from "../fixedStep";

const samples = (random, count = 8) => Array.from({ length: count }, () => random());

describe("fixed step accumulator", () => {
  it("defaults to 60 Hz and supports 120 Hz", () => {
    const sixty = new FixedStepAccumulator({ maxCatchUpSteps: 1000 });
    const fast = new FixedStepAccumulator({ hz: 120, maxCatchUpSteps: 1000 });
    expect(sixty.dt).toBe(DEFAULT_FIXED_DT);
    expect(fast.dt).toBe(1 / 120);

    const sixtyTimes = [];
    const fastTimes = [];
    sixty.advance(1, (dt, time) => sixtyTimes.push([dt, time]));
    fast.advance(1, (dt, time) => fastTimes.push([dt, time]));
    expect(sixtyTimes).toHaveLength(60);
    expect(fastTimes).toHaveLength(120);
    expect(sixtyTimes.at(-1)).toEqual([1 / 60, 1]);
    expect(fastTimes.at(-1)).toEqual([1 / 120, 1]);
  });

  it("runs the same steps for different display frame partitions", () => {
    const run = (deltas) => {
      const clock = new FixedStepAccumulator({ maxCatchUpSteps: 1000 });
      const times = [];
      for (const delta of deltas) clock.advance(delta, (dt, time, index) => times.push([dt, time, index]));
      return { times, result: clock.result(0, 0, 0) };
    };
    const at30 = run(Array.from({ length: 60 }, () => 1 / 30));
    const at60 = run(Array.from({ length: 120 }, () => 1 / 60));
    const at144 = run(Array.from({ length: 288 }, () => 1 / 144));
    expect(at30).toEqual(at60);
    expect(at144).toEqual(at60);
    expect(at60.times).toHaveLength(120);
    expect(at60.result.time).toBe(2);
  });

  it("retains a fractional step for interpolation", () => {
    const clock = new FixedStepAccumulator();
    const first = clock.advance(1.5 / 60);
    expect(first.steps).toBe(1);
    expect(first.alpha).toBeCloseTo(0.5, 12);
    const second = clock.advance(0.5 / 60);
    expect(second.steps).toBe(1);
    expect(second.alpha).toBe(0);
  });

  it("bounds catch-up and drops whole backlog steps without skipping integration", () => {
    const clock = new FixedStepAccumulator({ maxCatchUpSteps: 4 });
    const integrated = [];
    const stalled = clock.advance(1, (dt, time, index) => integrated.push([dt, time, index]));
    expect(stalled.steps).toBe(4);
    expect(stalled.time).toBe(4 / 60);
    expect(stalled.droppedSteps).toBe(56);
    expect(stalled.droppedTime).toBeCloseTo(56 / 60, 12);
    expect(integrated.map((step) => step[2])).toEqual([0, 1, 2, 3]);

    const next = clock.advance(1 / 60, (dt, time, index) => integrated.push([dt, time, index]));
    expect(next.steps).toBe(1);
    expect(next.droppedSteps).toBe(0);
    expect(integrated.at(-1)).toEqual([1 / 60, 5 / 60, 4]);
  });

  it("seek replays from the origin with the same step sequence", () => {
    const live = new FixedStepAccumulator({ maxCatchUpSteps: 1000 });
    const replay = new FixedStepAccumulator({ maxCatchUpSteps: 1 });
    const expected = [];
    const actual = [];
    for (let frame = 0; frame < 90; frame += 1) live.advance(1 / 45, (dt, time, index) => expected.push([dt, time, index]));
    replay.advance(10, () => actual.push("discarded"));
    actual.length = 0;
    const result = replay.seek(2, (dt, time, index) => actual.push([dt, time, index]));
    expect(actual).toEqual(expected);
    expect(result.droppedSteps).toBe(0);
    expect(result.totalDroppedSteps).toBe(0);
  });
});

describe("seeded random streams", () => {
  it("is reproducible and independent per fixture and stream", () => {
    const a = createFixtureRandom("jet-a", 41);
    const sameA = createFixtureRandom("jet-a", 41);
    const b = createFixtureRandom("jet-b", 41);
    const mistA = createFixtureRandom("jet-a", 41, "mist");
    const aValues = samples(a);
    expect(aValues).toEqual(samples(sameA));
    expect(samples(b)).not.toEqual(aValues);
    expect(samples(mistA)).not.toEqual(aValues);
    expect(fixtureSeed("jet-a", 41)).not.toBe(fixtureSeed("jet-b", 41));
    expect(fixtureSeed("jet-a", 41)).not.toBe(fixtureSeed("jet-a", 41, "mist"));
  });

  it("resets for replay and restores an exact continuation", () => {
    const random = createRandomStream("show-seed");
    const initial = samples(random);
    random.reset();
    expect(samples(random)).toEqual(initial);

    const saved = random.state;
    const expected = samples(random);
    random.setState(saved);
    expect(samples(random)).toEqual(expected);
    expect(random.next).toBe(random);
  });

  it("produces values in [0, 1)", () => {
    const random = createRandomStream(0);
    for (let i = 0; i < 1000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
