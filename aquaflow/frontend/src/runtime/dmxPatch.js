/**
 * dmxPatch.js — AF-HUB-004B canonical DMX patch system.
 *
 * A fixture's DMX "patch" is where it lives on the wire: a universe, a start channel
 * (aka DMX start address), and a channel footprint (how many consecutive channels it
 * occupies). Before this module, every consumer read the patch with its own ad-hoc list
 * of field aliases and its own range constants, so they could — and did — disagree:
 *
 *   liveValidation.js      channel|dmxChannel|dmxAddress · universe|dmxUniverse
 *                          DMX_MAX_CHANNEL = 512 · DMX_MAX_UNIVERSE = 32767
 *   dependencyGraph.js     +engineering.dmxChannel / engineering.dmxUniverse, default 1
 *   showProgrammerCompiler dmxChannel|1 · dmxUniverse|1 · MAX_DMX_UNIVERSE = 512 (!)
 *   export3d/sceneGraph    dmx.{universe,channel,channels} + engineering.{…}
 *
 * Note the collision: `DMX_MAX_UNIVERSE` (32767, the max Art-Net/sACN universe number)
 * and `MAX_DMX_UNIVERSE` (512, actually the channels-per-universe frame size) are the
 * same name for opposite concepts. This module is the single source of truth for both
 * the field normalization and the range constants; consumers delegate here so a patch
 * reads identically everywhere and can never drift again.
 *
 * Pure + deterministic: same fixture in → same patch out. No store reads, no side effects.
 */

// ── Canonical constants ──────────────────────────────────────────────────────
// DMX512 carries exactly 512 slots (channels) per universe.
export const DMX_CHANNELS_PER_UNIVERSE = 512;
export const DMX_MIN_CHANNEL = 1;
export const DMX_MAX_CHANNEL = DMX_CHANNELS_PER_UNIVERSE; // 512 — highest valid start channel
// Universe numbering: Art-Net / sACN address space (0–32767).
export const DMX_MIN_UNIVERSE = 0;
export const DMX_MAX_UNIVERSE = 32767;

/** First value that parses to a finite number; null if none do. */
function firstNum(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

/**
 * readPatch(fixture) — normalize any legacy patch shape into one canonical record.
 *
 * Reads the union of every alias historically used across the codebase (flat fields,
 * a nested `dmx` object, and a nested `engineering` object), so all consumers resolve
 * the same universe/start-channel/footprint regardless of which shape a fixture uses.
 *
 * @returns {{ universe:number|null, startChannel:number|null,
 *             channelCount:number|null, endChannel:number|null }}
 *          Fields are null when the fixture carries no patch for them — callers apply
 *          their own defaults so this stays behavior-preserving.
 */
export function readPatch(fixture) {
  const f = fixture || {};
  const dmx = f.dmx || {};
  const eng = f.engineering || {};

  const universe = firstNum(f.universe, f.dmxUniverse, dmx.universe, eng.dmxUniverse, eng.universe);
  const startChannel = firstNum(
    f.channel, f.dmxChannel, f.dmxAddress, dmx.channel, eng.dmxChannel, eng.channel
  );
  const channelCount = firstNum(
    f.dmxChannels, f.channelCount, dmx.channels, eng.dmxChannels, eng.channels
  );

  const endChannel =
    startChannel !== null && channelCount !== null && channelCount > 0
      ? startChannel + channelCount - 1
      : startChannel; // single-slot footprint when count is unknown

  return { universe, startChannel, channelCount, endChannel };
}

export function isUniverseInRange(universe) {
  return universe === null || (universe >= DMX_MIN_UNIVERSE && universe <= DMX_MAX_UNIVERSE);
}

export function isChannelInRange(channel) {
  return channel === null || (channel >= DMX_MIN_CHANNEL && channel <= DMX_MAX_CHANNEL);
}

/**
 * patchAddressKey(patch) — the "universe|startChannel" key used to detect exact address
 * collisions. Universe defaults to 1 (the historical dependency-graph default) so
 * unpatched-universe fixtures still collide predictably; returns null when there is no
 * start channel to key on.
 */
export function patchAddressKey(patch) {
  if (!patch || patch.startChannel === null || patch.startChannel === undefined) return null;
  const uni = patch.universe ?? 1;
  return `${uni}|${patch.startChannel}`;
}

/**
 * findAddressConflicts(fixtures) — fixtures sharing the same universe + start channel.
 * Mirrors the exact-address collision the dependency graph reports, but computed from the
 * one canonical patch reader. Deterministic; conflicts are returned in first-seen order.
 *
 * @returns {Array<{ universe:number, channel:number, ids:string[] }>}
 */
export function findAddressConflicts(fixtures = []) {
  const byKey = new Map(); // key -> { universe, channel, ids }
  for (const fx of Array.isArray(fixtures) ? fixtures : []) {
    if (!fx || typeof fx !== "object") continue;
    const id = fx.id ?? fx.fixtureId;
    if (id === undefined || id === null) continue;
    const patch = readPatch(fx);
    const key = patchAddressKey(patch);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, { universe: patch.universe ?? 1, channel: patch.startChannel, ids: [] });
    byKey.get(key).ids.push(String(id));
  }
  const conflicts = [];
  for (const entry of byKey.values()) {
    if (entry.ids.length > 1) conflicts.push(entry);
  }
  return conflicts;
}
