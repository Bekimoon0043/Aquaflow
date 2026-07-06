/**
 * dmxPatch.test.js — AF-HUB-004B canonical DMX patch system.
 *
 * Proves the unification: every legacy patch shape resolves to one canonical record,
 * the range constants are single-sourced, and the address-conflict finder matches what
 * the dependency graph reports.
 */
import { describe, it, expect } from "vitest";
import {
  readPatch, patchAddressKey, findAddressConflicts,
  isUniverseInRange, isChannelInRange,
  DMX_CHANNELS_PER_UNIVERSE, DMX_MAX_CHANNEL, DMX_MAX_UNIVERSE,
} from "../dmxPatch.js";
import { buildDependencyGraph } from "../../dependency/dependencyGraph.js";
import {
  DMX_MAX_CHANNEL as LV_MAX_CHANNEL,
  DMX_MAX_UNIVERSE as LV_MAX_UNIVERSE,
} from "../../validation/liveValidation.js";
import { MAX_DMX_UNIVERSE } from "../../utils/showProgrammerCompiler.js";

describe("canonical constants are single-sourced", () => {
  it("512 channels per universe; 32767 max universe number", () => {
    expect(DMX_CHANNELS_PER_UNIVERSE).toBe(512);
    expect(DMX_MAX_CHANNEL).toBe(512);
    expect(DMX_MAX_UNIVERSE).toBe(32767);
  });
  it("consumers re-export the canonical values (no drifting copies)", () => {
    expect(LV_MAX_CHANNEL).toBe(DMX_MAX_CHANNEL);
    expect(LV_MAX_UNIVERSE).toBe(DMX_MAX_UNIVERSE);
    // showProgrammerCompiler's MAX_DMX_UNIVERSE is really the per-universe frame size.
    expect(MAX_DMX_UNIVERSE).toBe(DMX_CHANNELS_PER_UNIVERSE);
  });
});

describe("readPatch normalizes every legacy shape to one record", () => {
  it("flat universe/channel", () => {
    expect(readPatch({ universe: 2, channel: 10 }))
      .toMatchObject({ universe: 2, startChannel: 10, endChannel: 10 });
  });
  it("dmxUniverse/dmxChannel aliases", () => {
    expect(readPatch({ dmxUniverse: 3, dmxChannel: 5 }))
      .toMatchObject({ universe: 3, startChannel: 5 });
  });
  it("dmxAddress alias for start channel", () => {
    expect(readPatch({ dmxAddress: 44 }).startChannel).toBe(44);
  });
  it("nested dmx.{universe,channel,channels}", () => {
    expect(readPatch({ dmx: { universe: 3, channel: 12, channels: 4 } }))
      .toMatchObject({ universe: 3, startChannel: 12, channelCount: 4, endChannel: 15 });
  });
  it("nested engineering.{dmxUniverse,dmxChannel}", () => {
    expect(readPatch({ engineering: { dmxUniverse: 7, dmxChannel: 9 } }))
      .toMatchObject({ universe: 7, startChannel: 9 });
  });
  it("flat fields win over nested when both present", () => {
    const p = readPatch({ universe: 1, channel: 1, dmx: { universe: 9, channel: 9 } });
    expect(p).toMatchObject({ universe: 1, startChannel: 1 });
  });
  it("absent patch yields nulls (callers apply their own defaults)", () => {
    expect(readPatch({ id: "x", type: "light_rgb" }))
      .toEqual({ universe: null, startChannel: null, channelCount: null, endChannel: null });
    expect(readPatch(null))
      .toEqual({ universe: null, startChannel: null, channelCount: null, endChannel: null });
  });
  it("endChannel spans the footprint; single slot when count unknown", () => {
    expect(readPatch({ channel: 1, dmxChannels: 8 }).endChannel).toBe(8);
    expect(readPatch({ channel: 20 }).endChannel).toBe(20);
  });
});

describe("range helpers", () => {
  it("universe range 0..32767", () => {
    expect(isUniverseInRange(0)).toBe(true);
    expect(isUniverseInRange(32767)).toBe(true);
    expect(isUniverseInRange(99999)).toBe(false);
    expect(isUniverseInRange(null)).toBe(true); // absent is not a range error
  });
  it("channel range 1..512", () => {
    expect(isChannelInRange(1)).toBe(true);
    expect(isChannelInRange(512)).toBe(true);
    expect(isChannelInRange(513)).toBe(false);
    expect(isChannelInRange(0)).toBe(false);
  });
});

describe("address conflict detection matches the dependency graph", () => {
  const fixtures = [
    { id: "a", type: "light_rgb", universe: 1, channel: 1 },
    { id: "b", type: "light_rgb", universe: 1, channel: 1 }, // clashes with a
    { id: "c", type: "light_rgb", universe: 1, channel: 5 }, // clear
  ];

  it("patchAddressKey keys on universe|startChannel", () => {
    expect(patchAddressKey(readPatch(fixtures[0]))).toBe("1|1");
    expect(patchAddressKey(readPatch({ channel: 3 }))).toBe("1|3"); // universe defaults to 1
    expect(patchAddressKey(readPatch({}))).toBeNull();
  });

  it("findAddressConflicts reports the shared address once", () => {
    const conflicts = findAddressConflicts(fixtures);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ universe: 1, channel: 1 });
    expect(conflicts[0].ids.sort()).toEqual(["a", "b"]);
  });

  it("agrees with buildDependencyGraph's address_conflict", () => {
    const graph = buildDependencyGraph(fixtures);
    const addrConflicts = graph.conflicts.filter((c) => c.type === "address_conflict");
    expect(addrConflicts).toHaveLength(1);
    expect(addrConflicts[0].nodes.sort()).toEqual(["a", "b"]);
    // Same fixtures → same collision verdict from both code paths.
    expect(addrConflicts.length).toBe(findAddressConflicts(fixtures).length);
  });
});
