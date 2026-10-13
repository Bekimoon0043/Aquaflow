# AF-3D Realism Plan — Making the AquaFlow Preview Look Like Depence

**Date:** 2026-09-05
**Goal:** Evolve the AquaFlow 3D preview (`frontend/src/components/preview/FountainScene_v6.js`) from its current stylized look to Depence-class photorealism, in phases that each ship a visible improvement without breaking the existing show-driven pipeline.

---

## 1. Where we are today (code audit)

The preview is raw three.js `^0.165.0` in a single 3,450-line module, `src/components/preview/FountainScene_v6.js` — the only file importing `three`. It already has a surprisingly strong foundation:

| Subsystem | Today | Location |
|---|---|---|
| Particles | CPU-simulated `THREE.Points`: 60k water / 22k spray / 6k foam / 3k flame / 2k fog; Euler integration, quadratic drag, per-system gravity; per-frame `copyWithin` compaction + full attribute re-upload | `GPUParticleSystem` (misnomer), `FountainScene_v6.js:624-789` |
| Sprites | Procedural round point-sprites, analytic droplet shading (edge/core/refract/spec), premultiplied "scatter" blending; velocity stretch is only a point-size boost | `SPRITE_FRAG` :205-280, `SPRITE_VERT` :175 |
| Jet structure | 4-layer per nozzle: core column mesh (Bernoulli decay + KH turbulence), breakup droplets, apex mist, impact foam + additive glow billboard | `NozzleV2` :792-1490 |
| Nozzle types | 17 (jet_1d/2d/3d, geyser, arch, ring, laminar, mist, cascade, pirouette, fan_jet, flame, laser, motion_1d/2d/3d, screen) via switch in `NozzleV2.update()` | :965-1420 |
| Lighting | 16-light spatial RGB "light field" uniform block consumed by all shaders; DMX color via `setSignals()`; ambient+moon directional (2048² PCF shadows); RoomEnvironment IBL | :1616-1624, :2779, :2533 |
| Water surface | 4-wave Gerstner + GGX specular + Schlick fresnel (F0 0.02) + Beer-Lambert + procedural caustics; **real planar reflection probe** with oblique clipping | `WATER_VERT/FRAG_V2` :413-568, `preview/waterReflection.js` |
| Splash/wetness | 128² wetness + containment DataTexture deck overlay | `preview/splashMap.js` |
| Post | RenderPass → [GTAO] → Output → UnrealBloom → cinematic shader (vignette/CA/grain) → [SMAA]; ACES, exposure 2.1× | `_buildPostFX()` :2069 |
| Physics link | `jetPhysics.js`: launch speed from hydraulic exit velocity × √demand; wind drift in `src/weather/windDrift.js` | `setNozzlePhysics()` :2200 |

**The gaps that make it read "game-like" instead of "real":**

1. **Zero textures** — no droplet/mist/splash atlases, no normal/roughness maps; everything is analytic and reads as flat plastic.
2. **Round point sprites** — real jets need velocity-stretched camera-facing quads; points also pop at close range (driver `POINT_SIZE_RANGE` cap).
3. **No soft particles** — hard sprite cuts against pool rim/deck (`depthWrite:false` with no depth fade).
4. **No volumetric light beams** — the submersible-beam-through-spray look is *the* Depence signature; we have only a color-tint loop + one additive billboard.
5. **No refraction / scene-depth murk** in the water surface; caustics are a 2D sin/cos pattern on the surface, never projected onto the basin floor.
6. **Flat color background** — no HDRI night sky, no starfield (`sceneModes.js` declares `starfield: true` but nothing consumes it); RoomEnvironment IBL fights the night mood.
7. **CPU particle loop** caps us at ~90k particles; Depence-class jets need ~10×.
8. **No instancing, no real fixture models** — each nozzle is 3 meshes/draw-calls; nozzles are stub cylinders, lights are circle markers.
9. **Coarse shadows** — one 2048² directional map over an 80 m deck.

## 2. How Depence does it (research summary)

Syncronorm Depence (current release **R4**, April 2025; proprietary **V:3D** engine, NVIDIA gaming-GPU-only) markets "Real-Time Fluid Physics … with the precision of individual droplets", "True Lighting" (full interaction between every lighting fixture/laser/projector and water particles), splash analysis, and wet surfaces that dry over time. The evidence (feature set, screenshots, hardware profile) says it is **not** a Navier–Stokes fluid solver — it is a high-end game-VFX pipeline:

1. **Massive GPU particle sim** — ballistic droplets (gravity + drag + turbulence) parameterized by nozzle type and simulated pump/valve pressure; "surface tension/viscosity/density" are per-nozzle cohesion/breakup tuning knobs.
2. **Per-particle colored lighting** — every droplet accumulates light from every fixture cone hitting it; additive light on white spray over a dark scene is the signature night look.
3. **Stream-stage rendering** — glassy coherent column at the nozzle → droplet breakup mid-flight → soft mist at apex/fall → foam at impact.
4. **Collision-driven secondaries** — splashes, ripples, wet decals.
5. **Cinematic HDR post** — bloom/glare, volumetric haze, ACEScg, motion blur, reflective pool.

Estimated contribution to the realism impression: **~40% particle count/motion, ~40% lit-particles + HDR post, ~20% environment** (reflective pool, architecture, night sky). AquaFlow already has the reflective pool, ACES+bloom, and a light field — the recipe is achievable.

Key applicable references: GPU Gems 3 ch. 23 (half-res soft particles), three.js `GPUComputationRenderer` / WebGL2 transform feedback (1M+ particles proven in browser), Evan Wallace webgl-water heightfield + caustics (three.js ports: martinRenou, jeantimex), three.js Water2 (Reflector+Refractor + dual scrolling normal maps), Niagara fountain emitter patterns (stream ribbon + burst splash + cone mist + pool foam).

## 3. The plan — six phases

Each phase is independently shippable and gated behind the existing `RENDER_QUALITY` tiers (add an `ultra` tier; keep `low` exactly as today for weak GPUs). New code goes in **new modules** under `src/components/preview/` — `FountainScene_v6.js` is already 3,450 lines and must not grow; it becomes the orchestrator.

### Phase R1 — "Night look" quick wins (highest impact ÷ cost)

*Target: the preview at night with colored lights becomes dramatically more convincing without touching the simulation.*

1. **Soft particles.** Render scene depth to a target; in `SPRITE_FRAG`, fade fragment alpha by `saturate((sceneDepth - fragDepth) / softDistance)`. Kills the hard cuts against rim/deck/floor. (~1 day)
2. **Velocity-stretched instanced billboards.** Replace `THREE.Points` for water+spray with `InstancedBufferGeometry` quads oriented in the vertex shader: camera-facing, stretched along projected velocity (2–6× at high speed), round when slow. Keep the existing attribute layout; same CPU sim initially. Fixes anisotropy AND the point-size clamp. (~2–3 days)
3. **Texture atlases.** One 4×4 atlas: droplet highlight, mist puff (3 variants), foam clump, splash flipbook frames. Blend procedural shading × texture — keeps the current look's cohesion, adds micro-detail. (~1–2 days incl. authoring)
4. **HDRI night sky + starfield.** Replace flat `THREE.Color` background with a dark HDRI (or procedural gradient dome + star points — `sceneModes.js` already declares it); generate IBL from the *same* sky via PMREM instead of RoomEnvironment so ambient matches the mood. Day/dusk get matching skies. (~1–2 days)
5. **Volumetric light cones.** For each of the ≤16 field lights: an analytic cone mesh (additive, radial+axial falloff, depth-faded, subtle noise scroll) representing the beam through haze/spray. This is the single most "Depence" visual. Modulate cone intensity by local spray density (approximate: nozzle intensity). (~2–3 days)
6. **Bloom retune for HDR.** With real light cones and stretched sprites, retune `UnrealBloomPass` threshold/strength per environment; consider moving bloom before tone mapping now that the scatter-blending keeps whites in range (revisit the deliberate ordering at :2105-2111).

**Exit criteria:** side-by-side screenshot vs current build shows: no hard sprite intersections, visible light beams, anisotropic droplets, starry sky. ≥45 fps on the dev GPU at `high` with a 20-nozzle show.

### Phase R2 — GPU particle simulation (unlock density)

*Target: 500k–1M particles, the #1 driver of realism ("40% particle count").*

1. Move sim to **WebGL2 transform feedback** (or `GPUComputationRenderer` ping-pong FBO — decide by spike; transform feedback pairs naturally with the instanced quads from R1). Per-particle state (pos, vel, age, type, seed) lives on GPU; CPU only uploads per-nozzle emitter uniforms (origin, direction, spread, rate, launch speed from `jetPhysics.js`, wind from `windDrift.js`).
2. **Sim shader:** `v += g·dt − drag·|v|·v·dt + curlNoise(p, t)·turb·dt; p += v·dt`; respawn dead particles at their emitter with cone-distributed velocity. Curl-noise turbulence replaces the current per-spawn jitter and gives the drifting mist veil.
3. **Life stages in-shader:** age 0–15% = stretched stream segment, 15–70% = droplet, 70–100% = growing soft mist sprite (matches Depence's stream→droplet→mist read).
4. **Impact handling in-shader:** on `y < ε`, respawn as splash/foam class; write impact events to a small feedback buffer (or low-res "impact map" render target) that feeds `splashMap.js` and Phase R3 ripples — replaces the CPU `impactSink`.
5. **Half-res particle pass** with depth-aware upsample (GPU Gems 3 ch. 23) at `high`/`ultra` — 4×+ overdraw headroom.
6. Keep the CPU path as the `low`-tier fallback (WebGL1/weak GPU), behind one `ParticleBackend` interface.

**Exit criteria:** 500k live particles at ≥50 fps (`ultra`, dev GPU); geyser/mist nozzles visibly denser and cloudier; per-nozzle behavior identical in timing to CPU path (playhead-driven regression via existing preview tests).

### Phase R3 — Water surface & collision secondaries

1. **Refraction:** add a refraction render target alongside `WaterReflectionProbe` (same probe pattern, non-mirrored, or adopt three.js Water2's Reflector+Refractor approach); perturb by wave normal; add **scene-depth-based murk** (Beer-Lambert against real depth difference, not a constant).
2. **Interactive ripple heightfield:** 256²–512² GPGPU heightfield (webgl-water style) receiving drops from the R2 impact map; its normals perturb reflection/refraction so jets landing actually disturb the pool. Cheap fallback for `medium`: expanding ripple-ring normal decals.
3. **Projected caustics on the basin floor** from the heightfield (or an animated caustics texture at lower tiers), replacing the surface-only sin/cos pattern.
4. **Wet surfaces v2:** upgrade `splashMap.js` overlay from a tint to a PBR modification — darken albedo + drop roughness (glossy wet stone) — and keep the existing dry-over-time decay. This matches Depence R4's headline "wet surfaces" feature we already half-have.

### Phase R4 — Materials, fixtures, environment

1. **PBR textures** for deck/coping/stone/basin (albedo/normal/roughness, tiling, ~2–4 MB budget) — biggest "flat plastic" fix outside the water.
2. **Real fixture models:** small glTF set (jet nozzle, ring nozzle, moving head, submersible light, flame unit) rendered via `InstancedMesh` per type — replaces stub cylinders/discs and collapses draw calls. Reuse `visual3d` descriptors from `fixtureLibrary.js`; consider sharing geometry with `src/export3d/primitives.js`.
3. **Venue presets:** replace cone-trees/boxes with 2–3 modeled backdrops (plaza, lake shore, arena) with silhouette lighting; architectural context is ~20% of the Depence impression.
4. **Shadow quality:** tighten the directional shadow frustum to the active pool bounds (or 2-cascade CSM); `ultra` gets 4096².
5. **Haze:** height-based fog + per-light haze density tie-in with the R1 cones.

### Phase R5 — Cinematic polish & export

1. **God rays** from the brightest jets/lights (screen-space radial blur pass) at `ultra`.
2. **Motion blur / long-exposure** modes for `startRecording` video + 4K export (Depence R4 parity: shutter-angle simulation).
3. Optional **depth of field** for cinematic camera paths (`aerial|flythrough|dramatic|audience`).
4. ACES exposure/white-point per environment preset; final grade pass in the existing `CINEMATIC_SHADER`.

### Phase R0 (continuous) — Guardrails

- **Refactor as we go:** each new system its own module (`particleGPU.js`, `lightCones.js`, `skyDome.js`, `rippleField.js`, `softDepth.js`); `FountainScene_v6.js` orchestrates only.
- **Perf budget:** every phase lands with before/after FPS at low/medium/high(/ultra) on the dev machine recorded in this file; `low` tier must never regress.
- **Visual regression:** keep a fixed benchmark show + camera; screenshot per phase into `docs/preview-realism/` for side-by-sides.
- **Tests:** preview logic that leaves the GL layer (emitter params, signal mapping, impact accounting) stays in pure modules covered by the existing vitest suite (396 passing — keep it green).

## 4. Suggested task breakdown

| ID | Phase | Task | Est. |
|---|---|---|---|
| AF-3D-001 | R1 | Soft particles (depth-fade) | 1 d |
| AF-3D-002 | R1 | Instanced velocity-stretched billboard quads | 2–3 d |
| AF-3D-003 | R1 | Droplet/mist/splash texture atlas | 1–2 d |
| AF-3D-004 | R1 | HDRI/procedural night sky + matched IBL + starfield | 1–2 d |
| AF-3D-005 | R1 | Volumetric light cones (≤16 field lights) | 2–3 d |
| AF-3D-006 | R2 | GPU sim spike: transform feedback vs GPUComputationRenderer | 2 d |
| AF-3D-007 | R2 | GPU ballistic sim + curl noise + life stages, 500k particles | 4–6 d |
| AF-3D-008 | R2 | GPU impact map → splashMap/foam; half-res particle pass | 2–3 d |
| AF-3D-009 | R3 | Refraction + depth murk | 2 d |
| AF-3D-010 | R3 | GPGPU ripple heightfield + projected caustics | 3–5 d |
| AF-3D-011 | R3 | Wet-surface PBR upgrade | 1 d |
| AF-3D-012 | R4 | PBR ground/basin materials | 1–2 d |
| AF-3D-013 → **AF-3D-019** | R4 | Instanced glTF fixture models (renumbered — see ID note below) | 3–4 d |
| AF-3D-014 | R4 | Venue backdrop presets ×3 | 3–5 d |
| AF-3D-015 | R4 | Shadow frustum fit / CSM | 1 d |
| AF-3D-016 | R5 | God rays, motion blur/long exposure, DoF | 3–4 d |

**~6–8 working weeks total; Phase R1 alone (~1.5 weeks) delivers the bulk of the perceived jump.**

> **ID note (AF-3D-018, 2026-10-13).** This plan's "AF-3D-013 instanced glTF fixture
> models" collided with the shipped **AF-3D-013, the performance HUD** (`getPerfStats`,
> see `CURRENT_STATUS.md`). The fixture-model item is **renumbered AF-3D-019**, as set
> out in `AF-CAD-DESIGN-RENDER-PLAN.md` (Phase 3), which also adds AF-3D-017 (polygon
> basin mask), AF-3D-018 (this growth guardrail), AF-3D-020 (large-show benchmark),
> AF-3D-021 (scene decomposition), AF-3D-022 (light texture / HG beam lighting),
> AF-3D-023 (three.js upgrade spike), AF-3D-024 (AgX/Neutral tone mapping) and later
> items. AF-3D-008, 014, 015 and 016 keep their IDs.
>
> **Growth guardrail (AF-3D-018).** `FountainScene_v6.js` had grown to 4,387 lines
> despite §3's "must not grow" rule. `src/components/preview/__tests__/sceneGuard.test.js`
> now fails if it exceeds 4,387 lines (ceiling to be lowered as it shrinks, never
> raised). AF-3D-021 split shaders, post-processing, lighting, basin and tier config
> into `sceneShaders.js`, `scenePost.js`, `sceneLighting.js`, `sceneBasin.js` and
> `sceneQuality.js`.

## 5. Research sources

- Syncronorm Depence: syncronorm.com/products/depence/visualization, /depence-r4, Fountain brochure PDF, help.depence.com graphics-hardware guide
- GPU Gems 3 ch. 23 — High-Speed, Off-Screen Particles (half-res soft particles)
- Soft particles in WebGL — dev.to/keaukraine/implementing-soft-particles-in-webgl-and-opengl-es-3l6e
- three.js GPGPU: threejs.org/examples/webgpu_compute_particles.html; gpfault.net/posts/webgl2-particles.txt.html; Codrops GPGPU particle tutorials
- Water: three.js Water2 (PR #12341); martinRenou/threejs-water & jeantimex/threejs-water (Evan Wallace heightfield + caustics ports)
- Niagara fountain emitter patterns: realtimevfx.in / cghow.com fountain & waterfall tutorials
