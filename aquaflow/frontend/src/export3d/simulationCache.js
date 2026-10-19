/**
 * simulationCache.js — the fountain show as a per-frame simulation cache for VFX tools:
 * an OpenVDB volume sequence (density = water volume fraction, optional velocity) and/or
 * a PLY particle sequence, plus a JSON manifest.
 *
 * The particles come from the 3D preview's own emitters (nozzleEmitters.js) and flight
 * physics (designTrajectory RENDER_PHYSICS), driven by the same show frame
 * (evaluateFullShowPreview), so the cache matches what the preview draws. It is
 * deterministic: a seeded generator replaces Math.random.
 *
 * Positions use the 3D export's frame (engineering x, plan y → depth, metres, Y-up),
 * so the volumes line up with the FBX / glTF / USD exports; AXIS_PRESETS re-map them
 * for Z-up and centimetre tools.
 */
import { describeNozzleEmitters, sampleEmitterParticle, EMIT_CLASS } from "../components/preview/nozzleEmitters.js";
import { RENDER_PHYSICS, SOLVER_DT } from "../components/preview/designTrajectory.js";
import { launchSpeed as jetLaunchSpeed, normalizePhysics } from "../components/preview/jetPhysics.js";
import { fixturesToNozzleConfigs } from "../hooks/fixtureTypeMap.js";
import { evaluateFullShowPreview } from "../utils/fullShowPreview.js";
import { createGrid, encodeVDB } from "./openvdb.js";

export const AXIS_PRESETS = Object.freeze({
  yup_m: { label: "Houdini / Maya / Nuke — Y-up, metres", scale: 1, map: (x, y, z) => [x, y, z] },
  zup_m: { label: "Blender / 3ds Max — Z-up, metres", scale: 1, map: (x, y, z) => [x, -z, y] },
  unreal: { label: "Unreal Engine — Z-up, centimetres", scale: 100, map: (x, y, z) => [x, z, y] },
});

export const SIM_DEFAULTS = Object.freeze({
  fps: 30, start: 0, end: null, voxelSize: 0.05, particleRate: 4,
  axes: "yup_m", vdb: true, velocity: false, ply: false, staticSeconds: 5, seed: 1,
});

const DEFAULT_FLOW_LPM = 100;
const MAX_PARTICLES = 1_000_000;

/** mulberry32 — small, fast, seedable. */
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Frame file names: Houdini / Blender / Unreal all detect `name.0001.vdb` sequences. */
export function frameName(base, frame, ext) {
  return `${base}.${String(frame).padStart(4, "0")}.${ext}`;
}

export function safeBaseName(name) {
  const s = String(name || "aquaflow_sim").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return /^[A-Za-z0-9]/.test(s) ? s : `aquaflow_${s || "sim"}`;
}

/**
 * Nozzle configs + intensity/motion source for the simulation.
 * @param {object} p { fixtures, plan? (ICAN preview plan), nozzlePhysics? ({id: solver record}) }
 */
export function prepareSimulation({ fixtures = [], plan = null, nozzlePhysics = null } = {}) {
  const { nozzleConfigs } = fixturesToNozzleConfigs(fixtures);
  const configs = nozzleConfigs
    .filter((c) => c.type !== "flame" && c.type !== "laser")
    .map((c) => ({ ...c, physics: normalizePhysics(nozzlePhysics?.[c.id]) }));
  const duration = plan ? Number(plan.duration) || 0 : null;
  const stateAt = plan
    ? (t) => {
      const s = evaluateFullShowPreview(plan, t, fixtures);
      return { level: (id) => Number(s.fixtureIntensities?.[id]) || 0, motion: (id) => s.fixtureMotion?.[id] || null };
    }
    : () => ({ level: () => 1, motion: () => null });
  return { configs, duration, stateAt };
}

/** Particle store: struct-of-arrays, compacted in place. */
function particleStore(capacity) {
  return {
    n: 0,
    pos: new Float32Array(capacity * 3), vel: new Float32Array(capacity * 3),
    age: new Float32Array(capacity), life: new Float32Array(capacity),
    vol: new Float32Array(capacity), cls: new Uint8Array(capacity),
  };
}

/**
 * Run the show and yield one particle snapshot per output frame.
 * @yields {{ index:number, frame:number, time:number, particles }}
 */
export function* simulateFrames(prepared, options = {}) {
  const o = { ...SIM_DEFAULTS, ...options };
  const fps = Math.max(1, Number(o.fps) || 30);
  const start = Math.max(0, Number(o.start) || 0);
  const end = Number.isFinite(Number(o.end)) && o.end != null ? Number(o.end) : (prepared.duration ?? o.staticSeconds);
  if (!(end > start)) throw new Error("The simulation range is empty — set an end time after the start.");
  // The preview's launch speeds are solved for ITS integrator step, so the cache must
  // step at exactly that rate to reach the same apex; frames are placed in between.
  const dt = SOLVER_DT;
  const rand = seededRandom(o.seed);
  const rate = Math.max(0.25, Number(o.particleRate) || 4);
  const store = particleStore(MAX_PARTICLES);
  const sample = {};

  // Warm up from up to 4 s before the first frame so jets in flight are already there.
  const warm = Math.min(start, 4);
  let t = start - warm;
  const frames = Math.floor((end - start) * fps + 1e-6) + 1;
  let nextFrame = 0;

  const step = () => {
    const state = prepared.stateAt(t);
    for (const base of prepared.configs) {
      const ix = Math.max(0, Math.min(1, state.level(base.id)));
      if (ix <= 0.001) continue;
      const cfg = { ...base, motionOverride: state.motion(base.id) };
      const launch = (demand, fallback) => jetLaunchSpeed(base.physics, demand, fallback, null, cfg);
      const descs = describeNozzleEmitters(cfg, ix, t, null, null, launch);
      if (!descs.length) continue;
      const totalW = descs.reduce((s, e) => s + e.weight * e.density, 0) || 1;
      const q = (Number(base.engineering?.flowLpm) || DEFAULT_FLOW_LPM) / 60000 * Math.sqrt(ix);
      for (const e of descs) {
        const expected = dt * e.weight * e.density * rate;
        const count = Math.floor(expected + rand());
        if (!count) continue;
        const volEach = q * (e.weight * e.density / totalW) * dt / Math.max(expected, 1e-9);
        const spray = e.cls === EMIT_CLASS.SPRAY;
        for (let k = 0; k < count && store.n < MAX_PARTICLES; k++) {
          sampleEmitterParticle(e, rand, null, sample);
          const i = store.n++, i3 = i * 3;
          // Spread births across the step so a stream is continuous, not banded.
          const lead = rand() * dt;
          store.pos[i3] = sample.x + sample.vx * lead;
          store.pos[i3 + 1] = sample.y + sample.vy * lead;
          store.pos[i3 + 2] = sample.z + sample.vz * lead;
          store.vel[i3] = sample.vx; store.vel[i3 + 1] = sample.vy; store.vel[i3 + 2] = sample.vz;
          store.age[i] = lead; store.life[i] = sample.life; store.vol[i] = volEach; store.cls[i] = spray ? 1 : 0;
        }
      }
    }
    // Advance with the renderer's semi-implicit Euler + quadratic drag; drop the
    // particles that expire or fall back through the water surface.
    let w = 0;
    for (let i = 0; i < store.n; i++) {
      const i3 = i * 3;
      const phys = store.cls[i] ? RENDER_PHYSICS.spray : RENDER_PHYSICS.water;
      let vx = store.vel[i3], vy = store.vel[i3 + 1], vz = store.vel[i3 + 2];
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      vx += -vx * phys.drag * sp * dt;
      vy += (-phys.gravity - vy * phys.drag * sp) * dt;
      vz += -vz * phys.drag * sp * dt;
      const x = store.pos[i3] + vx * dt, y = store.pos[i3 + 1] + vy * dt, z = store.pos[i3 + 2] + vz * dt;
      const age = store.age[i] + dt;
      if (age >= store.life[i] || (y < 0 && vy < 0)) continue;
      const o3 = w * 3;
      store.pos[o3] = x; store.pos[o3 + 1] = y; store.pos[o3 + 2] = z;
      store.vel[o3] = vx; store.vel[o3 + 1] = vy; store.vel[o3 + 2] = vz;
      store.age[w] = age; store.life[w] = store.life[i]; store.vol[w] = store.vol[i]; store.cls[w] = store.cls[i];
      w++;
    }
    store.n = w;
    t += dt;
  };

  while (nextFrame < frames) {
    const frameTime = start + nextFrame / fps;
    while (t < frameTime - 1e-9) step();
    // Back-date the snapshot from the step time t (≥ frameTime) to the frame time.
    const lag = t - frameTime;
    let pos = store.pos.subarray(0, store.n * 3);
    if (lag > 1e-9) {
      pos = new Float32Array(pos);
      for (let i = 0; i < pos.length; i++) pos[i] -= store.vel[i] * lag;
    }
    yield {
      index: nextFrame, frame: nextFrame + 1, time: frameTime,
      particles: {
        count: store.n, pos, vel: store.vel.subarray(0, store.n * 3),
        vol: store.vol.subarray(0, store.n), cls: store.cls.subarray(0, store.n),
      },
    };
    nextFrame++;
  }
}

/** Water fraction of a voxel crossed by a 10 mm stream — the level that reads as density 1. */
export function densityReference(voxelSize) {
  return Math.min(1, (Math.PI * 0.005 * 0.005) / (voxelSize * voxelSize));
}

/**
 * Voxelise one particle snapshot (trilinear splat).
 * `density` = water volume fraction per voxel ÷ densityReference(voxel), clamped to 0..1, so a
 * jet's core reads ≈ 1 and spray stays faint at any voxel size (a raw fraction peaks near
 * 0.03 in 5 cm voxels and renders invisible). `vel` = mass-weighted velocity.
 */
export function voxelizeFrame(particles, { voxelSize = 0.05, axes = "yup_m", velocity = false } = {}) {
  const preset = AXIS_PRESETS[axes] || AXIS_PRESETS.yup_m;
  const vs = voxelSize * preset.scale;
  const ref = densityReference(voxelSize);
  const voxelVolume = voxelSize ** 3 * ref;                 // metres³ — fraction is unit-free
  const density = createGrid("density", { gridClass: "fog volume",
    metadata: { aquaflow_units: "water volume fraction / aquaflow_reference_fraction (jet core ≈ 1)",
      aquaflow_reference_fraction: ref } });
  const vel = velocity ? createGrid("vel", { type: "vec3s", gridClass: "unknown",
    metadata: { aquaflow_units: preset.scale === 100 ? "cm/s" : "m/s" } }) : null;
  const weight = velocity ? createGrid("w") : null;
  const { pos, vel: pv, vol, count } = particles;
  for (let p = 0; p < count; p++) {
    const [x, y, z] = preset.map(pos[p * 3], pos[p * 3 + 1], pos[p * 3 + 2]);
    const fx = (x * preset.scale) / vs, fy = (y * preset.scale) / vs, fz = (z * preset.scale) / vs;
    const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
    const tx = fx - i0, ty = fy - j0, tz = fz - k0;
    const m = vol[p] / voxelVolume;
    const v = velocity ? preset.map(pv[p * 3], pv[p * 3 + 1], pv[p * 3 + 2]).map((c) => c * preset.scale) : null;
    for (let c = 0; c < 8; c++) {
      const di = c >> 2, dj = (c >> 1) & 1, dk = c & 1;
      const wgt = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz);
      if (wgt <= 0) continue;
      density.add(i0 + di, j0 + dj, k0 + dk, m * wgt);
      if (velocity) {
        weight.add(i0 + di, j0 + dj, k0 + dk, wgt);
        vel.add(i0 + di, j0 + dj, k0 + dk, [v[0] * wgt, v[1] * wgt, v[2] * wgt]);
      }
    }
  }
  density.map((d) => Math.min(1, d));
  if (velocity) {
    for (const [key, leaf] of vel.leaves) {
      const wl = weight.leaves.get(key);
      for (let n = 0; n < 512; n++) {
        if (!leaf.active[n]) continue;
        const wv = wl.values[n] || 1;
        leaf.values[n * 3] /= wv; leaf.values[n * 3 + 1] /= wv; leaf.values[n * 3 + 2] /= wv;
      }
    }
  }
  return { grids: velocity ? [density, vel] : [density], voxelSize: vs };
}

/** Binary little-endian PLY of one snapshot: position, velocity, volume, class (0 water, 1 spray). */
export function encodeParticlePLY(particles, { axes = "yup_m", comment = "AquaFlow simulation cache" } = {}) {
  const preset = AXIS_PRESETS[axes] || AXIS_PRESETS.yup_m;
  const n = particles.count;
  const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, "_");
  const header = [
    "ply", "format binary_little_endian 1.0", `comment ${ascii(comment)}`,
    `comment axes ${axes} units ${preset.scale === 100 ? "cm" : "m"}`,
    `element vertex ${n}`,
    "property float x", "property float y", "property float z",
    "property float vx", "property float vy", "property float vz",
    "property float volume", "property uchar cls", "end_header", "",
  ].join("\n");
  const head = new TextEncoder().encode(header);
  const stride = 7 * 4 + 1;
  const out = new Uint8Array(head.length + n * stride);
  out.set(head, 0);
  const dv = new DataView(out.buffer);
  let o = head.length;
  for (let p = 0; p < n; p++) {
    const xyz = preset.map(particles.pos[p * 3], particles.pos[p * 3 + 1], particles.pos[p * 3 + 2]);
    const v = preset.map(particles.vel[p * 3], particles.vel[p * 3 + 1], particles.vel[p * 3 + 2]);
    for (const c of xyz) { dv.setFloat32(o, c * preset.scale, true); o += 4; }
    for (const c of v) { dv.setFloat32(o, c * preset.scale, true); o += 4; }
    dv.setFloat32(o, particles.vol[p], true); o += 4;
    dv.setUint8(o, particles.cls[p]); o += 1;
  }
  return out;
}

const yieldUI = () => new Promise((r) => setTimeout(r, 0));

/**
 * Write the whole cache through `writer.write(name, bytes)`.
 * @param {object} p { fixtures, plan?, nozzlePhysics?, name, options, writer, onProgress?, signal? }
 * @returns {Promise<object>} the manifest
 */
export async function exportSimulationCache({ fixtures, plan = null, nozzlePhysics = null, name, options = {}, writer,
  onProgress = null, signal = null }) {
  const o = { ...SIM_DEFAULTS, ...options };
  if (!o.vdb && !o.ply) throw new Error("Choose OpenVDB volumes and/or a particle cache.");
  const prepared = prepareSimulation({ fixtures, plan, nozzlePhysics });
  if (!prepared.configs.length) throw new Error("The design has no water nozzles to simulate.");
  const base = safeBaseName(name);
  const end = o.end != null && Number.isFinite(Number(o.end)) ? Number(o.end) : (prepared.duration ?? o.staticSeconds);
  const total = Math.floor((end - o.start) * o.fps + 1e-6) + 1;
  const stats = { frames: 0, bytes: 0, maxParticles: 0, maxActiveVoxels: 0 };
  for (const snap of simulateFrames(prepared, { ...o, end })) {
    if (signal?.aborted) throw new Error("Simulation export cancelled.");
    if (o.vdb) {
      const { grids, voxelSize } = voxelizeFrame(snap.particles, o);
      const bytes = encodeVDB(grids, { voxelSize, rand: seededRandom(o.seed + snap.frame) });
      await writer.write(frameName(base, snap.frame, "vdb"), bytes);
      stats.bytes += bytes.byteLength;
      stats.maxActiveVoxels = Math.max(stats.maxActiveVoxels, grids[0].activeVoxelCount);
    }
    if (o.ply) {
      const bytes = encodeParticlePLY(snap.particles, { axes: o.axes, comment: `${name || "AquaFlow"} t=${snap.time.toFixed(3)}s` });
      await writer.write(frameName(`${base}_particles`, snap.frame, "ply"), bytes);
      stats.bytes += bytes.byteLength;
    }
    stats.frames++;
    stats.maxParticles = Math.max(stats.maxParticles, snap.particles.count);
    onProgress?.({ frame: snap.frame, total, time: snap.time, bytes: stats.bytes, particles: snap.particles.count });
    await yieldUI();
  }
  const preset = AXIS_PRESETS[o.axes] || AXIS_PRESETS.yup_m;
  const manifest = {
    generator: "AquaFlow Studio simulation cache",
    show: String(name || ""),
    source: plan ? "show timeline" : `all nozzles at 100 % for ${o.staticSeconds} s (no show loaded)`,
    fps: o.fps, startSeconds: o.start, endSeconds: end, firstFrame: 1, frames: stats.frames,
    axes: o.axes, axesLabel: preset.label, units: preset.scale === 100 ? "centimetres" : "metres",
    voxelSize: o.vdb ? o.voxelSize * preset.scale : null,
    files: {
      ...(o.vdb ? { vdb: `${base}.####.vdb`, grids: ["density", ...(o.velocity ? ["vel"] : [])] } : {}),
      ...(o.ply ? { ply: `${base}_particles.####.ply` } : {}),
    },
    density: `water volume fraction ÷ ${o.vdb ? densityReference(o.voxelSize).toFixed(4) : "-"} (a 10 mm jet's core ≈ 1), clamped 0..1`,
    blender: "Material: Principled Volume, Density 20–50. Frame 1 is empty when the show starts with the jets off.",
    hydraulics: nozzlePhysics ? "jet heights capped by the design's hydraulic solve (pumps included)" : "design jet heights",
    stats,
    notes: [
      "Houdini: File SOP / Volume sequence, `$F4` in the name.",
      "Blender: Add > Volume > Import OpenVDB, select the first file, enable Sequence.",
      "Unreal 5.3+: import the folder as a Sparse Volume Texture (Heterogeneous Volumes); keep velocity off.",
    ],
  };
  await writer.write(`${base}_manifest.json`, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  return manifest;
}
