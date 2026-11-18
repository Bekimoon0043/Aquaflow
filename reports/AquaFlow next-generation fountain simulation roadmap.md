# AquaFlow next-generation fountain simulation roadmap

**Research date:** 2026-11-05  
**Goal:** make AquaFlow a fountain-specific design, simulation, visualization and commissioning platform that is demonstrably stronger than general-purpose tools—not merely a renderer with more effects.

## 1. Executive decision

AquaFlow should use **one authoritative show/engineering document and four outputs**:

1. A responsive whole-site preview for layout, choreography and operation.
2. Deterministic droplet/secondary-effect simulation for most nozzles.
3. Local true-fluid domains for hero water shots.
4. Offline path-traced final renders and controller/engineering exports.

The differentiator is not “more particles.” It is the combination of:

- Fountain-specific hydraulics and component behavior.
- Photometrically meaningful light and environment interaction.
- Deterministic replay of the same show in AquaFlow and Blender.
- Hardware-safe commissioning, measured calibration and honest provenance.
- Open project/interchange formats and a path from design to validated delivery.

Do not attempt a single full-CFD site or a single “realistic” switch. Both are inefficient and misleading. Use simulation tiers with explicit labels.

## 2. Evidence boundary and current starting point

### 2.1 What is already present

The current project already has useful foundations:

- Deterministic fixed-step evaluation and seeded random streams.
- `engine/show_frame.py` and `frontend/src/show/evaluateShowFrame.js` for shared show behavior.
- Pump curves, affinity behavior, valve strokes, pipe filling and hydraulic diagnostics in `backend/services/show_hydraulics.py`.
- Nozzle model registry, thin-film models, droplet drag and collision recommendations.
- Luminaire registry, RGBW, IES/LDT parsing, photometric helpers and cinematic output.
- Special air-shooter and digital-curtain state machines.
- A realism capture corpus with multiple nozzle/light cases.
- A Blender addon with `.aqua`, `.aquashow` and `.aquapkg` import, native Mantaflow domains, component assets, external water effects, original procedural water, RGB animation and rotating basket outlets.
- Hardware safety/commissioning infrastructure and fail-closed output behavior.

### 2.2 Main gaps

- Incomplete fixture coverage, especially motion variants, lasers and fire/special effects.
- No unified capability contract shared by preview, hydraulics, exporter and hardware.
- Limited environment interaction and volumetric rendering.
- No full GDTF/MVR exchange, Lux heatmap, mirror-bounce lighting or complete photometric UI.
- Coarse whole-site fluid resolution can be mistaken for resolved water.
- Inconsistent offline/online fixture models and validation coverage.
- Missing laser/fire safety envelopes, detailed wind response and scene-wide secondary effects.
- No formal calibration loop from measured site behavior back to equipment models.

### 2.3 Proprietary-engine boundary

Public Depence material documents features, not every internal algorithm. This plan does not claim access to Depence code or proprietary simulation methods. Where internal behavior is not public, use physically defensible models and measured comparisons instead of claiming parity.

## 3. Nozzle taxonomy and environmental response

### 3.1 Important naming rule

“1D,” “2D” and “3D” are not universal nozzle standards. Some vendors mean motion axes; users may also mean one, two or three outlets. AquaFlow should store these independently:

- `outletTopology`: single, multi, ring, fan, sheet, radial, volume.
- `motionAxes`: 0, 1, 2, 3+.
- `motionRange`: per-axis range, speed, acceleration, home position and limits.
- `flowModel`: pressure/orifice, thin-film, aerated, mist, air-shot or solenoid-grid.
- `controlModel`: continuous intensity, binary, sequenced, motorized or pressure-tank.

### 3.2 Static and motion nozzles

| Nozzle family | Physical behavior the renderer must capture | Main engineering/control inputs |
| --- | --- | --- |
| Straight / Comet / Lance | Clear coherent core, gravity/drag, breakup, wind deflection, impact droplets | Diameter, pressure, flow, Cd, elevation, spray angle |
| Hollow jet | Ring-shaped stream and lower water demand than a comparable full jet | Ring-slot dimensions, flow, pressure |
| Laminar / jumping laminar | Smooth glass-like arc, low disturbance, deliberate stream cutting | Straightener, arc angle, cut timing, outlet diameter |
| Aerated / foam / geyser / volcano | Air entrainment, white frothy column, wider breakup and water-level/backflow sensitivity | Air/water ratio estimate, waterline, non-return valve, pressure |
| Fan / finger / peacock | Planar sheet and multiple outlets sharing available flow | Outlet count, fan angle, total flow, head geometry |
| Crown / ring / willow | Radial multi-jet pattern with shared pressure and outlet area | Outlet count/diameter, ring radius, elevation, flow |
| Bell / mushroom / tulip / dandelion / sphere | Thin radial film, rim instability, thinning and droplet breakup | Film trajectory/thickness, radial speed, lip radius, instability |
| Cascade / weir / rain curtain | Downward sheet, gravity thinning, wall adhesion and edge droplets | Fall height, width, flow, adhesion, step geometry |
| Waterwall / water screen | Relatively continuous projection surface, wind/ripple sensitivity and illuminated droplets | Width, height, flow, wind, projection geometry |
| Mist / fog | Small droplets, long airtime, strong wind drift and forward light scattering | Droplet-size distribution, pressure, wind, humidity |
| Bubbler / aerator | Low surface plume, pool circulation and oxygenation rather than a high clear jet | Depth, flow, waterline, circulation |
| Recoil rotating nozzle | Rotation driven by reaction torque and jet direction; speed varies with pressure | Outlet angle, torque estimate, pressure, friction |
| Motorized basket / pirouette | Driven rotation with controllable RPM, acceleration, torque and end stops | RPM, acceleration, outlet count, motor limits |
| 1D motion nozzle | One pan/tilt/rotation axis with motion smoothing and end limits | Axis, range, speed, acceleration, home |
| 2D motion nozzle | Two-axis aiming with coordinated trajectories | Pan/tilt ranges, speed, acceleration, motion path |
| 3D / robotic nozzle | Multi-axis orientation and sometimes translation or coordinated robotic motion | Kinematics, axis hierarchy, limits, collision envelope |
| Digital water curtain | Independent binary solenoids, interruptible open/close delays and packet timing | Outlet map, open/close delay, frame timing |
| Compressed-air shooter | Tank pressure state, accepted/rejected shots, valve pulse and recharge | Tank volume, pressures, shot air volume, recharge, burst limit |

Manufacturer references illustrate the range: Oase describes a multi-jet crown with 24 inclined 6 mm outlets ([Crown Nozzle](https://www.oase.com/en-GB/water-technology/crownnozzle-24-20-e)), a 2D drive with two motion axes ([MDD L 2D](https://www.oase-professional.com/en/family/product/p/34318-multi-directional-drive-l-2d-dmx-02-int.html)), and a larger 3D drive with video/laser projection potential ([MDD XL 3D](https://www.oase-professional.com/en/family/product/p/46982-multi-directional-drive-xl-3d-dmx-02-int.html)). These are examples, not permission to copy product data without provenance.

### 3.3 Physics shared by all water effects

Use SI units and retain the data source for every value:

- Orifice/pressure velocity: `v = Cv √(2Δp/ρ)`.
- Flow/area: `Q = A·v`, with total flow shared across outlets.
- Ideal vertical rise: `h = v²/(2g)`, before drag and breakup losses.
- Pump affinity: `Q ∝ N`, `H ∝ N²`, `P ∝ N³`.
- Pipe loss: Hazen-Williams or Darcy-Weisbach, valve/fitting minor losses and branch continuity.
- Jet breakup: Weber/Ohnesorge/regime information and product-specific turbulence where available.
- Droplet motion: gravity, quadratic/appropriate drag, wind, turbulence and deterministic seeded variation.
- Secondary motion: collision, splash, ripples, wetting, runoff, foam and drying.
- Pool response: water level, recirculation/overflow, containment and evaporation where relevant.

Do not turn every estimate into a “manufacturer” value. Store `measured`, `datasheet`, `calculated`, `estimated`, `assumed` and `art_directed` provenance separately.

## 4. Light, laser and fire behavior in the 3D environment

### 4.1 Luminaires

| Type | Simulation requirements |
| --- | --- |
| Underwater point/spot/ring/linear/wash/flood | Submerged source position, beam distribution, water absorption/scattering, refraction, lens visibility, IP-rated housing |
| Moving-head spot/wash/beam | Pan/tilt/zoom/focus, motor inertia, end limits, real beam shape and target tracking |
| Gobo/framing/profile | Texture/gobo projection, rotation, focus, shutter blades and gobo transmission |
| Video projector | Video texture, aspect ratio, keystone, frame rate, brightness and camera/source selection |
| Area/pixel matrix | Physical emitter dimensions, pixel map, soft shadows, per-pixel color and limits |
| HDRI/venue environment | Reflections, diffuse ambient, correct night/day exposure and environment provenance |
| Laser | Wavelength, optical power, divergence, beam diameter, scanner motion, volume interaction and safety state |

Lighting is not simply RGB tinting. Include:

- Luminous flux (lm), luminous intensity (cd), radiant power (W), CCT, color mode, beam angle, physical source size and photometric profile.
- IES/LDT distributions, inverse-square far-field behavior, cone/solid-angle approximations and near-field limits.
- Absorption, scattering, reflection, refraction, caustics, lens glare and occlusion.
- Haze and underwater medium density, with forward-scattering anisotropy.
- Camera exposure, highlight rolloff, motion blur and color-management consistency.
- DMX mode/channel semantics, RGB/RGBW/CMY/white behavior, dimmer curves and response time.

Blender documents IES as directional intensity distribution ([IES Texture](https://docs.blender.org/manual/en/latest/render/shader_nodes/textures/ies.html)), and explicitly distinguishes radiant light power from consumer electrical wattage ([Light objects](https://docs.blender.org/manual/en/latest/render/lights/light_object.html)). Use those distinctions in the shared contract.

### 4.2 Lasers

A laser model should include:

- RGB diode wavelengths and independent modulation.
- Optical power and beam diameter/divergence, not “light wattage.”
- Galvo target angle, speed, acceleration, inertia and finite scan rate.
- Vector/raster paths, cones, planes, fans, tunnels, text and projection surfaces.
- Volumetric fog dependence, reflection/bounce rules, occlusion and heat-map overlays.
- ILDA/controller input, DMX parameters and safety-shutter/interlock state.
- Audience exclusion zones, aircraft/exclusion warnings and optional MPE review metadata.

Do not enable audience scanning by default and do not claim that a render certifies safety. ILDA provides audience-scanning safety resources ([ILDA safety information](https://www.ilda.com/safety-info.htm) and [audience-scanning overview](https://www.ilda.com/resources/Safety/audience-scanning_overview_latest.pdf)). A competent laser-safety review remains mandatory for any real installation.

### 4.3 Flame, sparks, CO2, confetti and pyrotechnic visualization

| Effect | Environmental response to simulate |
| --- | --- |
| Flame jets / flame bars / flame on water | Emission/blackbody color, heat light, smoke, soot, heat distortion, wind, steam on water contact and reflections |
| Spark fountains / gerbs | Ballistic glowing particles, drag, cooling, smoke trails, ground collision and exclusion zones |
| CO2 jets | Expansion, condensation plume, momentum, buoyancy, ground-hugging flow and lighting |
| Dynamic ground fog | Gravity-driven spreading, turbulence, density decay, surface collision and lighting |
| Confetti | Tumbling paper pieces, drag, wind, rotation, collision, color variation and deterministic seed |
| Fireworks / pyro | Ignition delay, ballistic trajectories, burst timing, smoke, ember cooling, misfire/fallout overlays and wind |

This is a visualization and safety-review feature, not instructions for building or firing pyrotechnic devices. Do not include explosive compositions or operational firing instructions. Real pyro requires licensed specialists and jurisdiction-specific review.

## 5. Environmental interaction checklist

### Water and site

- Gravity, drag, air entrainment, breakup and droplet-size distributions.
- Wind field, gusts, turbulence and local obstruction.
- Pool level, overflow/recirculation, leaks and user-approved runoff zones.
- Basin/floor/wall/island collision and arbitrary mesh collision in the hero tier.
- Splash containment heatmaps and wet/dry surface history.
- Ripples, reflections, refraction, absorption, caustics and foam.
- Surface adhesion, runoff and evaporation.
- Temperature, humidity and visibility only where they affect the requested effect.

### Motion and control

- Pump startup/shutdown ramps, valve strokes and pipe filling/drainage.
- Motor acceleration, torque/end limits, home positions and overshoot.
- DMX/Art-Net/sACN/ILDA/OSC/MIDI/SMPTE timing and transport latency.
- Music onset/beat analysis, clip boundaries, fades and deterministic fixed-step evaluation.
- Hardware interlocks, commissioning state, output inhibit and stop behavior.

### Camera and perception

- Physical source visibility versus illumination on water.
- Exposure, white balance, highlight compression and colored-light clipping.
- Depth of field, shutter angle, long exposure and camera paths.
- Audience viewpoints, reflection angles and light forward scattering.

## 6. What comparable platforms teach us

| Platform | Publicly documented strength | Lesson for AquaFlow |
| --- | --- | --- |
| Depence R4 | Multimedia show visualization, PBR/IES, fountain/splash analysis, wet surfaces, lasers, special FX, drones, Lux heatmap, motion blur, MVR and controller integration | Combine fountain-specific VFX with show control, documentation and analysis—not just water geometry |
| LIGHTCONVERSE | Real-time multi-discipline show visualization including lighting, video, laser, water effects and pyro | Support many effect families in one timeline and scene |
| Capture Visualisation | Lighting, video, laser, moving scenery and water elements | Treat motion and video as first-class show objects |
| WYSIWYG | Lighting design, CAD, plots, data and virtual show control | Engineering plots and patch data matter as much as pretty rendering |
| Realizzer | Photometric lighting, laser visualization and scanner-related behavior | Model laser motion and photometric distribution explicitly |
| Blender / Mantaflow / Cycles | Local FLIP/APIC liquid, liquid mesh/secondary particles, path-traced water and lighting | Excellent hero/offline tier, not a practical whole-site real-time answer |
| Houdini | High-end FLIP/whitewater and procedural VFX workflows | Use for specialist validation/export when required, not as a runtime dependency |
| Unreal / Niagara | Real-time particle and fluid/VFX workflows | Useful model for scalable GPU effects, collision and secondary systems |
| EPANET | Extended-period pressurized pipe-network hydraulic simulation | Validate pressure/flow behavior separately from visual particles |
| OpenFOAM | Open general-purpose CFD | Use only for specialist validation or research—not the default product runtime |

Primary Depence sources: [R4 features](https://www.syncronorm.com/depence-r4), [visualization overview](https://www.syncronorm.com/products/depence2/visualization/overview), [lighting](https://www.syncronorm.com/products/depence2/visualization/lighting), and [special FX](https://www.syncronorm.com/products/depence2/visualization/special-fx).

## 7. Target architecture

### 7.1 One shared scene contract

Create `aquafx-scene` as a versioned neutral contract shared by frontend, backend, exporter and Blender. Include:

- Site geometry, basin holes, site surfaces, arbitrary meshes, materials and cameras.
- Fixture type/family/instance, physical placement and hierarchy.
- Nozzle topology, motion axes, outlet geometry, hydraulics and response parameters.
- Luminaire photometry, distribution, color, physical dimensions and environment medium.
- Laser, flame, fog, confetti and special-effect descriptors.
- Pump/valve/pipe topology and equipment provenance.
- Timeline clips, motion keys, tempo, fades, music and control channels.
- LOD/render tier, simulation backend, cache manifest and deterministic seed.
- Safety envelopes, commissioning state, warnings and output permissions.
- Asset license and texture/cache references.

Use existing `fixtureModelContract.js`, `lux-schema`, `.aqua`, `.aquashow` and `.aquapkg` as migration sources; do not break legacy files.

### 7.2 Simulation tiers

| Tier | Purpose | Technique |
| --- | --- | --- |
| L0 Layout proxy | Thousands of fixtures and fast editing | Instanced models, procedural jets, animated masks, simple light cones |
| L1 Deterministic VFX | Most show previews | GPU droplets, drag, wind, collision, spray/foam/confetti, photometric light field |
| L2 Local true liquid | Hero jets, bells, cascades and pool shots | Tight Mantaflow/FLIP domains, mesh/secondary particles, overflow and collision |
| L3 Specialist validation | Product/CFD checks and calibrated comparison | EPANET for pipes; Houdini/OpenFOAM only when justified |
| L4 Final image | Delivery render | Cycles path tracing, high samples, motion blur, EXR and compositing |

### 7.3 One behavior, multiple renderers

The evaluator—not the renderer—owns show state. WebGL, Blender and hardware compilers consume the same normalized frame, including:

- Water level/flow/pressure and valve/pump state.
- Fixture transform/motion and emission state.
- Light RGB/white/dimmer/beam state.
- Laser scanner/shutter state.
- Flame/fog/confetti emission state.
- Safety state and deterministic seed.

Do not let Blender or WebGL independently invent choreography.

## 8. Build plan

### Phase 0 — Contract, provenance and validation foundation (weeks 1–2)

Deliver:

- `aquafx-scene` schema and migration from current fixture models.
- Capability matrix for every nozzle/light/effect type and current implementation status.
- SI-unit and coordinate contracts, asset-license registry and provenance labels.
- Deterministic golden show with pump/valve/nozzle/RGB/laser/fire examples.
- Simulation-tier selection and explicit proxy/native/estimated labels.
- Expanded realism corpus for all static nozzle families and camera directions.

Acceptance:

- Legacy projects migrate without changing engineering meaning.
- The same fixture produces the same normalized state in frontend and backend within one DMX step.
- No fixture is silently downgraded to an unrelated generic model.

### Phase 1 — Complete static nozzle and hydraulic pack (weeks 3–6)

Deliver:

- Clear, hollow, laminar, aerated, fan, crown, bell, cascade, mist, bubbler and water-screen models.
- True shared-outlet flow, thin-film breakup, water-level dependency and non-return behavior.
- Pump curve/affinity, valve stroke, pipe fill/drain and pressure-aware nozzle response.
- Deterministic GPU droplet backend with collision, impact map and secondary events.
- Original nozzle/material asset library with editable parameters and model provenance.
- Pool overflow and containment heatmaps.

Acceptance:

- Every static registry entry has geometry, behavior and tests; no generic “one jet fits all.”
- Shared-outlet area/flow is conserved within solver tolerance.
- Fixed-seed emission is reproducible and frame-rate independent.
- Test pool does not overfill; no unauthorized runoff in the containment suite.

### Phase 2 — Motion, curtains and cameras (weeks 7–10)

Deliver:

- 1D/2D/3D motion model with speed, acceleration, range, torque and home/end limits.
- Recoil and motorized rotating baskets with shared outlets and RPM control.
- Digital curtains with independent interruptible solenoid timing.
- Compressed-air shooters with tank pressure/recharge state.
- Motion-aware camera targets, shutter angle, motion blur and path constraints.

Acceptance:

- Baskets preserve declared RPM and outlet count without flow multiplication.
- Curtain transitions never occur before their fixed-step delay.
- Motion never exceeds declared mechanical limits unless a diagnostic is emitted.

### Phase 3 — Complete lighting and optical systems (weeks 11–14)

Deliver:

- Underwater point/spot/ring/linear/wash/flood, moving heads, area and pixel fixtures.
- IES/LDT import UI and asset management, near-field limits and physical source sizes.
- Gobo/framing/video projection, texture animation, focus, shutter blades and keystone.
- Underwater/volume scattering, fog/haze, caustics and light linking.
- Lux meter/heatmap, photometric audit and calibration against analytic far-field cases.
- One-bounce spotlight mirror path; multiple-bounce laser path with strict budgets.

Acceptance:

- Flux/candela/lux calculations pass analytical tests within declared tolerance.
- No emissive clear-water shortcut is used to hide missing lighting.
- Source lens, water and fog respond to the same light state and dimmer curve.

### Phase 4 — Lasers, flame and special effects (weeks 15–18)

Deliver:

- RGB wavelength laser model, divergence, optical power, scanner inertia and vector/raster projection.
- ILDA/controller input and safety-shutter/interlock state.
- Flame/heat light, smoke, soot, steam, spark trajectories, CO2 and ground fog.
- Confetti and pyro visualization with wind, cooling, collision and exclusion overlays.
- Audience/aircraft exclusion metadata and safety-review reports.

Acceptance:

- Scanner position follows finite-speed dynamics and never jumps directly to the target.
- Unsafe default audience scanning is disabled and no safety certification is claimed.
- Every special effect responds to light, wind and collision appropriately.

### Phase 5 — True liquid and final-quality rendering (weeks 19–22)

Deliver:

- Tight per-hero domains with automatic bounds and resolution guidance.
- Liquid mesh, spray/foam/bubbles, thin-film preservation and wet/dry history.
- Offline Cycles rendering with transmission, absorption, caustics and high sample counts.
- EXR/HDR output, 4K motion-blur bakes and render/cache manifests.
- Arbitrary mesh collision in the hero tier and offline/online camera consistency.

Acceptance:

- Actual liquid meshes and caches exist for every claimed native-fluid shot.
- No proxy is presented as native fluid and no coarse domain is presented as resolved production water.
- Offline and preview scenes share geometry, timing and exposure within their declared approximation levels.

### Phase 6 — Interchange, operation and release hardening (weeks 23–26)

Deliver:

- GDTF import and MVR scene exchange using the public specification ([GDTF/MVR spec](https://github.com/mvrdevelopment/spec)).
- Art-Net/sACN, ILDA, NDI, OSC, MIDI and SMPTE integration with timestamps and diagnostics.
- Controller exports, safety-gated deployment, engineering plots and PDF page collections.
- Performance tiers, cache relocation, missing-asset diagnostics and packaged-project repair.
- Automated full-suite visual/physics regression and signed-off release candidate.

Acceptance:

- MVR round-trip preserves fixtures, positions, patch and references.
- Controller output is disabled until the relevant commissioning gate passes.
- Every advertised feature has a reproducible example and a passing acceptance test.

## 9. Performance and hardware policy

Use measured budgets rather than promising one frame rate for every scene.

| Tier | Indicative workstation | Intended use |
| --- | --- | --- |
| Entry preview | 6–8 CPU cores, 16 GB RAM, 4–6 GB VRAM, SSD | L0 layouts and reduced L1 droplets |
| Recommended show work | 12–16 CPU cores, 32–64 GB RAM, 8–12 GB VRAM, 1 TB NVMe | Full L1 preview and limited L2 hero shots |
| Hero/final rendering | 16–32 CPU cores, 64–128 GB RAM, 16–24+ GB VRAM, 2 TB NVMe | High-resolution local fluid and Cycles finals |

Guidelines:

- Keep WebGL2 as the compatibility path; evaluate WebGPU compute as an optional accelerator, not a dependency.
- Instance fixture meshes and water sheets; pool emitters by family and state.
- Use half-resolution translucent passes, depth-aware upsampling and light-volume budgets.
- Maintain CPU/design-proxy fallback and deterministic seeds across all tiers.
- Cache only with explicit size/location estimates and never fill a user’s disk silently.
- Record mean, p95 and p99 frame time, VRAM, cache size and bake duration for each release.

## 10. Validation and acceptance strategy

### Physics and timing

- Pressure/flow/head-loss solver tests against analytical and EPANET cases.
- Pump affinity, valve delay, pipe fill and motion-limit tests at fixed steps.
- Nozzle outlet conservation and deterministic replay tests.
- Laser scanner finite-speed and safety-state tests.

### Visual and environmental

- Day/night/audience/side/close/top captures for every nozzle family.
- Water/light interaction, fog, shadow, reflection and exposure comparisons.
- Pool containment, wet/dry history and arbitrary basin tests.
- Blind comparison of proxy/native/offline tiers with labeled approximation levels.

### Delivery

- Legacy `.aqua` compatibility and `.aquapkg` asset integrity.
- GDTF/MVR fixture/scene round trips.
- No hardware output in visual tests; real commissioning is separately signed off.
- No unlicensed third-party assets in the product bundle.

## 11. High-value differentiators after the core plan

These should follow—not replace—the first six phases:

- **Measured calibration loop:** import site pressure/flow/lux/response data and fit nozzle, pump and light models.
- **Physics-aware automatic tier selection:** choose proxy, droplets or local fluid per fixture and camera distance.
- **Shot director:** suggest camera/render tier and local domains from the show’s hero moments.
- **What-if safety analysis:** pump overload, low water, valve closure, wind, splash/fallout and laser/fire exclusion warnings.
- **OpenUSD scene exchange:** share scene structure and simulation caches across Blender/Houdini/Omniverse.
- **Collaborative review:** time-linked comments, approved shots and immutable release manifests.
- **Optional drone-show module:** swarm trajectories, spacing/collision review and show-file export, never unvalidated flight control.
- **AI-assisted authoring with constraints:** pattern suggestions must compile to the same deterministic contract and pass the same safety checks as manual shows.

## 12. Explicit non-goals and risks

- No claim of Depence parity, proprietary algorithms or production realism from a feature checklist.
- No full-site CFD requirement, no unbounded particle counts and no fake native-fluid labels.
- No spectral white-LED guarantee from an RGB-only renderer.
- No laser/pyro safety certification from visualization alone.
- No unlicensed texture/model redistribution.
- No hardware activation from an import, bake, preview or renderer change.

The largest risks are resolution cost, inconsistent manufacturer data, photometric uncertainty, renderer divergence and trying to ship every effect before the shared contract is stable. Phase 0 and the acceptance corpus are therefore mandatory, not optional administration.

## 13. Research sources

### Depence and show visualization

- [Depence R4](https://www.syncronorm.com/depence-r4)
- [Depence visualization overview](https://www.syncronorm.com/products/depence2/visualization/overview)
- [Depence lighting](https://www.syncronorm.com/products/depence2/visualization/lighting)
- [Depence special FX](https://www.syncronorm.com/products/depence2/visualization/special-fx)
- [LIGHTCONVERSE](https://lightconverse.eu/)
- [Capture Solo](https://www.elationlighting.com/products/capture-solo)
- [WYSIWYG overview](https://www.ac-et.com/products/wysiwyg-lighting-design-visualisation-software)
- [Realizzer integration and laser visualization](https://www.showcontroller.com/en/showcontroller-software/support-of-realizzer-3d.html)

### Nozzles, hydraulics and fluid

- [Oase Crown Nozzle](https://www.oase.com/en-GB/water-technology/crownnozzle-24-20-e)
- [Oase Cascade 90 T](https://www.oase.com/cs-CZ/fountain-technology/cascade-90-t-int)
- [Oase MDD L 2D](https://www.oase-professional.com/en/family/product/p/34318-multi-directional-drive-l-2d-dmx-02-int.html)
- [Oase MDD XL 3D](https://www.oase-professional.com/en/family/product/p/46982-multi-directional-drive-xl-3d-dmx-02-int.html)
- [Oase Rotation Module](https://www.oase-professional.com/en/family/f/rotation-module.1001037531.html)
- [EPA EPANET](https://www.epa.gov/water-research/epanet)
- [OpenFOAM](https://openfoam.org/)
- [SideFX FLIP whitewater](https://www.sidefx.com/tutorials/flip-simulation-whitewater-in-houdini-redshift/)
- [Unreal Niagara Fluids](https://dev.epicgames.com/documentation/unreal-engine/niagara-fluids-reference-in-unreal-engine?lang=en-US)

### Rendering, lighting and standards

- [Blender fluid domain settings](https://docs.blender.org/manual/en/latest/physics/fluid/type/domain/settings.html)
- [Blender liquid mesh](https://docs.blender.org/manual/en/latest/physics/fluid/type/domain/liquid/mesh.html)
- [Blender secondary particles](https://docs.blender.org/manual/en/latest/physics/fluid/type/domain/liquid/particles.html)
- [Blender Principled BSDF](https://docs.blender.org/manual/en/latest/render/shader_nodes/shader/principled.html)
- [Blender IES Texture](https://docs.blender.org/manual/en/latest/render/shader_nodes/textures/ies.html)
- [Blender light power](https://docs.blender.org/manual/en/latest/render/lights/light_object.html)
- [Blender caustics](https://docs.blender.org/manual/en/latest/render/cycles/object_settings/object_data.html)
- [Blender sampling](https://docs.blender.org/manual/en/latest/render/cycles/render_settings/sampling.html)
- [GDTF/MVR specification](https://github.com/mvrdevelopment/spec)
- [ILDA safety information](https://www.ilda.com/safety-info.htm)
- [ILDA audience-scanning overview](https://www.ilda.com/resources/Safety/audience-scanning_overview_latest.pdf)
- [ESTA published standards](https://tsp.esta.org/tsp/documents/published_documents.php)
- [Art-Net protocol](https://art-net.org.uk/)
