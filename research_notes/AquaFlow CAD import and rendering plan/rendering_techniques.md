# Real-Time Rendering Techniques for Realistic Fountain Previsualization (three.js / WebGL2 / WebGPU, 2026)

Scope note: about 15 searches and fetches were made. Items marked "(background reference, not fetched this session)" link to well-known, stable primary references and come from the researcher's prior knowledge, not from pages retrieved in this pass. The report writer should treat them as lower-confidence than items from fetched or searched sources.

---

## 1. Rendering fundamentals (rasterization, forward/deferred, PBR, shadows, tone mapping, HDR/bloom, AO, SSR, AA, post stacks)

### Takeaway
three.js in 2026 offers a modern real-time stack through `WebGPURenderer` and TSL. It has clustered Forward+ lighting (r185), cascaded-shadow `SunLight` (r186), node-based post-processing (`RenderPipeline`: bloom, SSR, SSGI, AO, TRAA, FSR1/TAAU upscaling), and built-in ACES / AgX / Khronos Neutral tone mapping. A fountain previs app can use forward(+) rendering with HDR, bloom, TRAA and AgX or Neutral tone mapping, and has no need for a deferred renderer.

### Cited Findings
- Release timeline: r182 (Dec 10 2025) added official manual pages for WebGPURenderer and its post-processing. r183 (Feb 18 2026) renamed `PostProcessing` to `RenderPipeline` and added read-write storage textures in TSL. r184 (Apr 16 2026) made `compileAsync()` non-blocking and added **FSR 1 and TAAU upscaling nodes**. r185 (Jun 25 2026) added **clustered (Forward+) lighting** and WebXR on WebGPURenderer. r186 (Sep 8 2026, latest) added **`SunLight` with cascaded shadows**, `compileComputeAsync()` and a Gaussian-splatting addon. — [utsubo: What's New in Three.js (2026)](https://www.utsubo.com/blog/threejs-2026-what-changed)
- `WebGPURenderer` (import from `three/webgpu`, TSL from `three/tsl`, since r171) **falls back to WebGL 2 automatically** when WebGPU is unavailable. Some forum users report scenes where WebGPURenderer is *slower* than WebGLRenderer, so profiling is advised. — [utsubo 2026](https://www.utsubo.com/blog/threejs-2026-what-changed)
- WebGPU browser support: Chrome/Edge since v113 (Win/macOS/ChromeOS), Linux since v144 (Intel) and v147 (NVIDIA on Wayland). Chrome Android since v121. Firefox since v141 (Windows) and v145/147 (macOS Apple Silicon). Safari since v26 (Sep 2025). — [utsubo 2026](https://www.utsubo.com/blog/threejs-2026-what-changed). Electron bundles Chromium, so it inherits Chrome's WebGPU support (inference).
- The WebGPU post-processing nodes are `bloom()`, `ssr()`, `ssgi()`, `ao()`, `traa()` and `renderOutput()`. They are node/TSL graphs that work only with WebGPURenderer and its WebGL2 fallback backend, not with the legacy `EffectComposer`. — [three.js skill summary (secondary)](https://playbooks.com/skills/jjuidev/jss/threejs); [secondary: threejs-impl-post-processing](https://skillselion.com/skills/openaec-foundation/three.js-claude-skill-package/threejs-impl-post-processing)
- TRAA in the official manual: `traa` node from `three/addons/tsl/display/TRAANode.js`, fed by the scene pass's MRT outputs (color, depth, velocity). — search snippet of [three.js manual: Post-Processing with WebGPURenderer](https://threejs.org/manual/en/webgpu-postprocessing) (direct fetch returned 404 this session; the URL may have moved).
- Tone mapping options in three.js: NoToneMapping, Linear, Reinhard, Cineon, **ACESFilmic**, **AgX**, **Neutral** and Custom. ACESFilmic is a modified version of Stephen Hill's fit with a subjective 1/0.6 exposure scale. Users report hue shifts and washed-out textures with it. Neutral follows the **Khronos 3D Commerce** standard and is hue-preserving, compressing only highlights. A third-party description warns that very dark scenes look darker with Neutral. — [three.js docs constants](https://threejs.org/docs/pages/global.html); [ACES forum thread](https://discourse.threejs.org/t/acesfilmictonemapping-leading-to-low-contrast-textures/15484); [ToneMappingFunctions.js r170 source](https://app.unpkg.com/three@0.170.0/files/src/nodes/display/ToneMappingFunctions.js)
- The pmndrs `postprocessing` library (WebGL `EffectComposer` replacement that merges effects into few passes) is the standard post stack for the legacy WebGLRenderer path — (background reference, not fetched this session) [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing)
- Forward vs deferred, in general: deferred shading writes a G-buffer, then lights per pixel. It is cheap for many lights but struggles with transparency and MSAA. Forward+ (tiled/clustered) bins lights into screen tiles or clusters and shades in the forward pass, so it keeps transparency and MSAA. — (background reference, not fetched this session) [LearnOpenGL: Deferred Shading](https://learnopengl.com/Advanced-Lighting/Deferred-Shading)

### Inferences
- **Forward+ (r185 clustered lighting) is the right model for fountains.** Water and spray are almost entirely transparent, and deferred shading cannot light transparent particles. Forward+ lets dozens to hundreds of underwater LED point/spot lights affect opaque basin geometry cheaply.
- Recommended stack: scene pass with MRT (color + depth + velocity + emissive) → GTAO/`ao()` on opaque only (half-res) → SSR only for the basin water plane → **bloom** (threshold on HDR emissive) → TRAA (or SMAA/FXAA on low tier) → tone mapping (**AgX** for saturated night LED colors without the ACES hue skew; Neutral for product-accurate daytime color) → output. Use FSR1/TAAU to render at 0.67–0.75 scale on weak GPUs.
- Day scenes: PBR (metal/roughness, `MeshPhysicalMaterial` with transmission/IOR 1.33 for water) plus an HDRI environment map (PMREM-filtered) for IBL and reflections. Night scenes: dim, nearly black HDRI or low env intensity, with most light from emissive particles and LED lights. Use r186 `SunLight` cascaded shadows for daytime site context.
- TAA/TRAA smears fast, thin, transparent particles that have no velocity vectors. Either write per-particle motion vectors or mask the spray out of TAA history (reactive mask). Otherwise use SMAA.

### Gaps
- No fetched benchmark of the per-effect cost of three.js TSL post nodes (bloom/SSR/GTAO/TRAA) on mid-range GPUs.
- Could not confirm whether three.js's `ao()` node is GTAO or SSAO by name (the official manual fetch 404'd).
- No fetched source on the pmndrs `postprocessing` library's WebGPU compatibility status in 2026.

---

## 2. Offline vs real-time vs web engines; path tracing on the web

### Takeaway
Offline renderers (V-Ray, Corona, Cycles, Arnold) path-trace for physical accuracy at seconds to minutes per frame. Archviz real-time tools (Lumion, Twinmotion, Enscape) and Unreal 5 (Lumen GI, Nanite, Niagara) use hybrid raster plus ray tracing. On the web, the only practical path tracer is **three-gpu-pathtracer** (WebGL2, progressive). It suits still "beauty shots" but not animated water shows.

### Cited Findings
- three-gpu-pathtracer: a path tracer built on **three-mesh-bvh + WebGL2** with GGX surfaces, textures, normal maps, emission, environment maps and tiled rendering. `WebGLPathTracer` wraps an existing `WebGLRenderer`, and `renderSample()` adds one sample per call (progressive). — [GitHub gkjohnson/three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer); [README @0.0.24](https://cdn.jsdelivr.net/npm/three-gpu-pathtracer@0.0.24/README.md)
- Secondary index lists PhysicalCamera (DoF), PhysicalSpotLight with **IES profiles**, **FogVolumeMaterial** and DenoiseMaterial. — [awesome.ecosyste.ms index (secondary)](https://awesome.ecosyste.ms/projects/github.com%2Fgkjohnson%2Fthree-gpu-pathtracer)
- The Threepipe wrapper renders samples only while the camera is still, giving progressive refinement. The package is marked WIP. — [Threepipe path-tracing plugin](https://threepipe.org/package/plugin-path-tracing.html)
- A forum user reported a demo "running very hot" on a MacBook Pro (early v0.0.23). — [three.js forum thread](https://discourse.threejs.org/t/three-gpu-pathtracer-a-modular-shader-based-path-tracing-extension-for-three-js/36903?page=3)
- Unreal Niagara: Epic's light-emitting particles tutorial starts from the **Fountain template** (spawn rate 500) and adds a light renderer, so particles cast real light. — [Epic docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/how-to-create-particle-effects-that-emit-light-in-niagara-for-unreal-engine)
- Commercial Niagara fountain packs exist (MassiveFx Water Splash pack: 4 splash + 4 fountain systems, lighting-aware water materials), aimed at games and cinematics, not show control. — [Unreal forum](https://forums.unrealengine.com/t/massivefx-game-ready-water-splash-fx-pack/2737812)
- three.js npm adoption: about 12.18M weekly downloads (Sep 2026), about 39x `@babylonjs/core` and 215x `playcanvas`. 600+ official examples, 230 of them WebGPU. — [utsubo 2026](https://www.utsubo.com/blog/threejs-2026-what-changed)
- Babylon.js `GPUParticleSystem` is supported when the engine has transform feedback (WebGL2) **or** compute shaders (WebGPU), so one class covers both. — [Babylon core source](https://app.unpkg.com/@babylonjs/core@9.18.0/files/Particles/gpuParticleSystem.pure.js). Forum users say GPU particles lack features that CPU particles have, such as mesh emitters falling back to a box on WebGPU (may be outdated). — [Babylon forum](https://forum.babylonjs.com/t/how-to-get-gpu-or-cpu-particles-when-using-particlehelper-parsefromfileasync/35261)

### Inferences
- Path tracing on the web is viable only as an optional "render still" mode: pause the show, freeze particles into instanced geometry, and accumulate samples. It cannot run in real time for thousands of moving transparent particles. Thin, volumetric water spray is also the worst case for a path tracer, needing high sample counts and heavy noise.
- Engine choice: staying on three.js (already used by AquaFlow, per the coordinator brief) is justified by its ecosystem size and the 2026 WebGPU and TSL maturity. Babylon has a more turnkey GPU particle class and Node Material, but switching engines is not warranted.
- Unreal and Depence-class quality comes mainly from (a) many particles with good per-particle shading, (b) particles that emit and receive light, and (c) strong HDR bloom and tone mapping. All three are achievable in three.js.

### Gaps
- No fetched primary docs this session for V-Ray, Corona, Cycles/EEVEE, Arnold, Lumion, Twinmotion, Enscape, Lumen, Nanite, Unity HDRP/VFX Graph or Godot. Comparisons above are general knowledge and should be confirmed if the report needs specifics.
- No source found on any shipping Unreal-based *fountain show* previs product (DMX or timecode-driven water).

---

## 3. Water and fountain rendering techniques

### Takeaway
A fountain previs needs a layered approach. Use GPU ballistic particles (or ribbons/streaks) for jets, soft depth-faded billboards for spray and mist, weighted-blended OIT or additive blending to avoid sorting, cheap volumetric or radial-blur light shafts, a planar-reflection or SSR water surface with Gerstner ripples, and emissive coloring from LED fixture positions plus HDR bloom at night. Full SPH/FLIP is feasible on WebGPU only for tens to low hundreds of thousands of particles and is not needed for show previs.

### Cited Findings
- **Depence (Syncronorm), the market reference:** uses "an advanced physics engine that calculates the hydrodynamic behavior of fountains in real-time". Nozzles, valves, pumps, moving fixtures and lights are linked as dependencies (nozzle→valve→pump) that drive hydrodynamics and lighting. Its simulation is realistic enough to sync a show with water collisions and splashes, and "True Lighting" projects lasers, video and lighting. It publishes no rendering-technique details. — [Syncronorm fountains page](https://syncronorm.com/products/depence2/visualization/fountains)
- Depence models air-shooter and zooming-fountain timing from the *differential pressure of two pumps*, supports video projection onto water screens, and its V:3D visualizer exports client videos. The R4 Fountain Module costs about €9,500 excl. VAT and needs a USB dongle. — [Pangolin Depence Fountain Module](https://pangolin.com/products/depence-fountain-module); [Syncronorm shop](https://shop.syncronorm.com/software/5-depence-fountain-module.html)
- Van Phuc City fountain: heights and motor speeds in the Depence sim were matched to video of the real installation. — [Syncronorm news](https://www.syncronorm.com/newsitem/van-phuc-city-fountain-created-with-depence-r3)
- **Soft particles** (NVIDIA 2007): read the scene depth buffer in the particle pixel shader and fade the sprite where it nears opaque geometry. This removes the hard intersection lines of large fog sprites. A multisampled depth buffer cannot be bound directly in DX10. — [NVIDIA SoftParticles whitepaper](https://developer.download.nvidia.com/whitepapers/2007/SDK10/SoftParticles_hi.pdf)
- **Volumetric light scattering as a post-process** (GPU Gems 3 ch.13, Mitchell/EA): screen-space radial sampling from each pixel toward the light's screen position, attenuated by occluders, gives "god rays". — [GPU Gems 3 ch.13](https://developer.nvidia.com/gpugems/gpugems3/part-ii-light-and-shadows/chapter-13-volumetric-light-scattering-post-process)
- **Weighted Blended OIT** (McGuire and Bavoil, JCGT 2013): an order-independent compositing operator. Accumulate weighted premultiplied color plus revealage in two render targets with additive blending, with weight falling off with depth. Needs only MRT plus float render targets and a single geometry pass. It is approximate ("not visually correct" but good and very fast). — [JCGT paper](https://www.jcgt.org/published/0002/02/09/paper.pdf); [Cesium blog](https://cesium.com/blog/2014/03/14/weighted-blended-order-independent-transparency/); [LearnOpenGL WBOIT](https://learnopengl.com/Guest-Articles/2020/OIT/Weighted-Blended); [MeVisLab description](https://mevislabdownloads.mevis.de/docs/current/MeVisLab/Standard/Documentation/Publish/ModuleReference/SoWeightedBlendedOIT.html)
- **three.js ships an `OITPassNode`** (WebGPU/TSL) based on this technique. — [three.js docs OITPassNode](https://threejs.org/docs/pages/OITPassNode.html)
- Layered/improved WBOIT (Friederichs et al., GI 2021) reports more than an order-of-magnitude error reduction versus WBOIT. Moment-based OIT (Münstermann et al. 2018) is another alternative. — [GI 2021 paper](https://graphicsinterface.org/wp-content/uploads/gi2021-22.pdf); [MBOIT paper](https://cg.ivd.kit.edu/publications/2018/mboit/Muenstermann2018-MBOIT.pdf)
- **Web fluid sims:** jeantimex/fluid runs SPH plus 3D PIC/FLIP fully in WebGPU compute (prefix-sum and linear-grid neighbor search), with "tens of thousands of particles at 60 FPS". It is ported from Sebastian Lague's Fluid-Sim and David Li's WebGL Fluid Particles. A WebGL hybrid FLIP is reported at up to 150k particles at 60 FPS. Codrops covers WebGPU-Ocean and WaterBall. — [jeantimex/fluid (mirror)](https://gitblind.noratr.app/jeantimex/fluid); [DEV: Accelerate](https://dev.to/aditya_singh_d0a79b30a56b/accelerate-fluid-simulator-b63); [Codrops WebGPU fluids 2025](https://tympanus.net/codrops/2025/02/26/webgpu-fluid-simulations-high-performance-real-time-rendering/); [indiana-dev WebGPU-Fluid-Simulation](https://github.com/indiana-dev/WebGPU-Fluid-Simulation)
- A WebGPU SPH demo claims 100k particles at 60 fps with 8 substeps (480 Hz). — [webgpu-particles page (unverified host)](https://irc.pcper.com/webgpu-particles.html)
- Water surface waves: Gerstner waves (GPU Gems 1 ch.1) and FFT/Tessendorf ocean spectra are the standard real-time surface models — (background reference, not fetched this session) [GPU Gems ch.1 Effective Water Simulation](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models); [Tessendorf, Simulating Ocean Water](https://people.computing.clemson.edu/~jtessen/reports/papers_files/coursenotes2004.pdf)
- three.js ships `Water`/`Water2` (planar reflection plus normal-map flow) and `Reflector`/`Refractor` addons, and the TSL `ssr()` node — (background reference, not fetched this session) [three.js examples](https://threejs.org/examples/)

### Inferences (concrete recipe for AquaFlow)
1. **Jets: deterministic ballistic GPU particles, not fluid sim.** Each nozzle emits particles with `p(t) = p0 + v0·t + ½g·t²`, with a drag term. v0 comes from the nozzle's height command (v0 = sqrt(2·g·h), corrected for drag), so the show is reproducible and scrubbable on a timeline. Particle state can be computed **analytically from spawn time** in the vertex shader, so it needs no ping-pong and works identically on WebGL2 and WebGPU. Use compute only for collisions and splash spawning.
2. **Jet core:** render the dense jet as **stretched or velocity-aligned billboards** (or a tapered ribbon/tube mesh along the analytic trajectory) with a refractive, glossy look, plus a second population of smaller breakup droplets that grow along the arc. Tall jets break up into spray near the apex, so increase size and opacity variance and decrease density with time-of-flight.
3. **Spray and mist:** large, low-opacity, soft (depth-faded) billboards with noise textures. Render at **half resolution** into a separate target and upsample bilaterally with depth. This is the single biggest fill-rate saver.
4. **Transparency:** at night, use **additive blending** for lit spray (order-independent, physically like scattered emissive light). In daylight, use `OITPassNode` (WBOIT) for the white, foamy water so no CPU or GPU sort is needed. Reserve a bitonic GPU sort for a hero close-up mode only.
5. **Underwater LEDs lighting jets:** do not rely on real dynamic lights per particle. Compute per-particle color in the shader from the nearest fixture(s): fixture RGBW/DMX color × beam cone falloff (angle between particle-to-fixture vector and fixture axis) × distance falloff × a forward-scattering phase term (Henyey-Greenstein, g ≈ 0.6–0.8, toward the camera). Output HDR emissive greater than 1 so **bloom** produces the glowing column look. Add a few real Forward+ spot lights per fixture group to light the basin, walls and surrounding geometry.
6. **Light shafts through mist:** the cheapest option is screen-space radial blur (GPU Gems 3 ch.13) per bright fixture. A better option is a ray-marched froxel/volume pass at 1/4 resolution, limited to fixture cones. Optionally add analytic cone "beam" meshes with additive, soft-edged shading.
7. **Basin water surface:** a plane with Gerstner (a few octaves) or a scrolling normal map, ripple impulses where jets land, planar reflection (one extra scene render at half res) or the `ssr()` node, Fresnel (Schlick, F0 ≈ 0.02), and underwater fixtures visible as refracted bright spots. Fake caustics with a projected animated caustic texture on the basin floor, tinted by fixture color.
8. **Night look:** dark environment, AgX tone mapping, bloom with a low threshold on emissive, slight exposure boost, and TRAA disabled or masked for particles.

### Gaps
- Depence's actual rendering method (particle counts, shading, refraction) is not publicly documented. Its help site (help.depence.com) was not fetched.
- No source found describing how Unreal-based fountain previs tools (if any exist commercially) render water.
- No fetched benchmark of WBOIT cost versus additive blending in three.js specifically.

---

## 4. Performance techniques and particle-count benchmarks (WebGL2 vs WebGPU)

### Takeaway
Rough ceilings for 60 fps on a mid-range GPU: about 1M simple GPU particles on both WebGL2 (GPGPU textures) and WebGPU (compute). The real limit for fountains is **overdraw/fill rate** of large translucent sprites, not simulation. No controlled WebGL2-vs-WebGPU benchmark was found.

### Cited Findings
- A three.js forum GPGPU galaxy simulates **2 million particles** on GPU via ping-pong render targets (WebGL). A Dec 2025 project shows **1M animated GPGPU particles**. — [three.js forum: GPGPU galaxy](https://discourse.threejs.org/t/gpgpu-galaxy-particles/88937)
- The utsubo Expo 2025 Osaka "Hokusai" installation simulated about **1 million particles in real time with WebGPU + three.js** on a 98" 4K display for 7 days. No fps figures were published. — [utsubo 2026](https://www.utsubo.com/blog/threejs-2026-what-changed)
- Blog claims of 10–100x (or 2–10x) WebGPU speedups for particles are **unverified marketing-grade numbers**. The same sources say it is "not universally faster; profile". — [utsubo 100 tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips); [utsubo migration guide](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- In three.js TSL, `instancedArray` creates persistent GPU storage buffers across frames, avoiding CPU-to-GPU transfers. Call `await renderer.init()` before first render. — [utsubo migration guide](https://www.utsubo.com/blog/webgpu-threejs-migration-guide); [svilenkovic webgpu compute shaders](https://svilenkovic.com/3d/webgpu-compute-shaders)
- Fluid sims (with neighbor search) are far more expensive: tens of thousands (WebGPU FLIP/SPH) to about 100–150k particles at 60 fps. — see §3 citations ([jeantimex/fluid](https://gitblind.noratr.app/jeantimex/fluid), [DEV Accelerate](https://dev.to/aditya_singh_d0a79b30a56b/accelerate-fluid-simulator-b63))
- Babylon GPU particles: transform feedback on WebGL2, compute on WebGPU. Compute storage buffers can be bound as vertex buffers with no readback (Boids example). — [Babylon source](https://app.unpkg.com/@babylonjs/core@8.12.1/files/Particles/gpuParticleSystem.js); [Babylon forum](https://forum.babylonjs.com/t/data-transfer-from-compute-shader-to-renderer/45576)
- three.js r184 added FSR1 and TAAU upscaling nodes, and r186 added `compileComputeAsync()` (no shader-compile hitches for compute). — [utsubo 2026](https://www.utsubo.com/blog/threejs-2026-what-changed)

### Inferences
- **Budget for a mid-range GPU (e.g. GTX 1660 / RTX 3050 / Apple M1), 1080p at 60 fps:** about 200k–500k jet/droplet particles plus about 5k–20k large mist sprites at half resolution is a realistic target. The mist count is limited by overdraw, so keep sprite screen area small and cap layers.
- Techniques, in priority order: (1) one instanced draw per particle population (`InstancedMesh`/`instancedArray`, or `BatchedParticleRenderer`). (2) Analytic, stateless particles so the CPU does nothing per frame. (3) Half or quarter-resolution translucent pass with depth-aware upsample. (4) Per-nozzle LOD that reduces particle count and switches to ribbon/tube meshes at distance. (5) Frustum culling per nozzle group via bounding boxes of the analytic arc (GPU-driven culling via compute and indirect draw is possible on WebGPU but rarely needed). (6) Dynamic resolution with FSR1/TAAU. (7) Avoid real dynamic lights per particle and use shader-evaluated fixture lighting.
- Keep a WebGL2 code path that delivers the same look (analytic particles need no compute), and use WebGPU compute only for optional extras (splash collisions, FLIP hero shots).

### Gaps
- **No controlled benchmark** comparing WebGL2 vs WebGPU particle throughput on identical hardware in 2025–2026 was found.
- No measured fill-rate numbers for translucent sprite overdraw in three.js.

---

## 5. Libraries and examples

### Takeaway
three.quarks is the most capable three.js VFX particle library (batched rendering, stretched billboards, trails, visual editor), but it is CPU-simulated. For hundreds of thousands of fountain particles, a custom TSL instanced/compute system is preferable. Use three.quarks or Babylon for authoring smaller splash and effect FX.

### Cited Findings
- **three.quarks:** TypeScript, high-performance VFX library for three.js. It has `BatchedParticleRenderer` (batches many systems), billboard, **stretched billboard**, mesh and **trail** renderers, Bézier-curve behaviors, a visual editor (three.quarks-editor), a JSON `QuarksLoader`, and an R3F wrapper (quarks.r3f). About 799 stars, last push Feb 5 2026. — [npm three.quarks](https://npmjs.com/package/three.quarks); [libraries.io](https://libraries.io/npm/three.quarks); [gittrend](https://gittrend.io/repo/Alchemist0823/three.quarks); [quarks.r3f README](https://raw.githubusercontent.com/Alchemist0823/three.quarks/master/packages/quarks.r3f/README.md)
- Other three.js particle libs: @newkrok/three-particles, three-particle. — [yarn @newkrok/three-particles](https://classic.yarnpkg.com/en/package/@newkrok/three-particles)
- three.js `OITPassNode` (WBOIT), TRAA node, and bloom/ssr/ssgi/ao nodes — see §1 and §3 citations.
- Babylon `GPUParticleSystem` (WebGL2 transform feedback / WebGPU compute) and the babylon.quarks editor port. — [Babylon source](https://app.unpkg.com/@babylonjs/core@9.18.0/files/Particles/gpuParticleSystem.pure.d.ts); [babylon.quarks-editor](https://libraries.io/npm/babylon.quarks-editor)
- WebGPU fluid references: jeantimex/fluid (SPH plus PIC/FLIP), indiana-dev WebGPU-Fluid-Simulation, Codrops WebGPU-Ocean/WaterBall, David Li Fluid Particles (WebGL FLIP). — see §3 citations; [haxiomic GPU-Fluid-Experiments](https://best-of-web.builder.io/library/haxiomic/GPU-Fluid-Experiments)
- three-gpu-pathtracer for progressive stills — see §2.

### Inferences
- Suggested AquaFlow library map: **core jets and spray** use a custom TSL `instancedArray` system (analytic ballistic plus optional compute) with `OITPassNode` or additive blending. **Splash and FX accents** use three.quarks (stretched billboards for splash, trails for streaks). **Post** uses the three.js `RenderPipeline` (bloom, TRAA, ao, ssr, AgX tone mapping, FSR1). **Beauty stills** use three-gpu-pathtracer (WebGL path) in an optional mode. **Research or hero shots** port the jeantimex/fluid FLIP approach.
- three-nebula appears dormant and was not found in 2026 search results. Prefer three.quarks.

### Gaps
- three-nebula's 2026 maintenance status was not verified (not searched).
- No confirmed three.quarks GPU-compute or WebGPU backend was found. Its simulation is presumed CPU-side (verify in repo).
- The official three.js WebGPU particle example names (e.g. `webgpu_compute_particles*`) were not verified this session because the manual fetch failed.
