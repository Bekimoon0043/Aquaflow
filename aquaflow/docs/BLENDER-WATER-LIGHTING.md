# AquaFlow → Blender: real water and lighting research

## Goal and honest boundary

The goal is an editable Blender scene generated from an AquaFlow `.aqua` / `.aquashow` project: basin, fixtures, show animation, cameras, native liquid simulation and Cycles lighting. Blender can provide a real FLIP liquid solver and path-traced illumination, which AquaFlow's WebGL preview cannot match. Conversion alone does not make a shot realistic: the fluid grid must resolve the outlet, the water needs meaningful reflection/transmission lighting, caches must be baked, and Cycles needs enough samples.

This is not a Depence renderer clone and does not use proprietary Depence algorithms.

## 1. The recommended rendering architecture

Use two deliberately separated paths:

1. **Native liquid for a hero shot.** A local Mantaflow liquid domain surrounds one nozzle or a small group. It uses real inflow velocity, basin colliders, initial pool liquid, a meshed surface and optional spray/foam/bubbles. Bake data, mesh and particles before rendering.
2. **Labeled design proxies for the rest of the site.** Animated ballistic tubes, thin bells and curtains provide a fast full-scene layout. They are geometry and volume approximations, not fluid. They must never be presented as a completed physical simulation.

A whole-site native mode is also generated, but it is mainly a starting layout. One domain covering a large pool normally cannot resolve millimetre nozzles at a practical resolution. For production, use local domains and composite them, or divide the site into simulation regions.

Blender's domain documentation makes the resolution constraint explicit: divisions are based on the longest domain dimension, and larger domains therefore need more divisions for the same voxel size ([Domain settings](https://docs.blender.org/manual/en/latest/physics/fluid/type/domain/settings.html)).

## 2. Native water simulation

### Solver and time stepping

The addon selects Mantaflow's **FLIP** liquid method for splashy fountain jets. Blender describes FLIP as the more chaotic/splashy method; APIC is more stable and preserves vortices. FLIP Ratio is 0.82, particle randomness is low for a coherent outlet, adaptive time steps are enabled, and CFL is 2.0. Fast hero jets may need a lower CFL and more time steps ([Domain settings](https://docs.blender.org/manual/en/latest/physics/fluid/type/domain/settings.html)).

Gravity is real metric gravity, 9.80665 m/s². The domain top is open so overshoot can leave the simulation. The floor, walls and site islands are fluid effectors. An initial closed pool volume establishes the water body instead of emitting every frame until the basin overflows.

### Nozzle velocity from AquaFlow engineering

The importer uses SI units and records the source of every estimate:

- With flow `Q` and diameter `d`: `v = Q / (π(d/2)²)`, with `Q = L/min ÷ 60000`.
- Otherwise with pressure: `v = Cd √(2Δp/ρ)`, using water density 1000 kg/m³ and `Cd = 0.93`.
- Otherwise with design height: `v = √(2gh)`.

Flow and nozzle area take priority for the native simulation. A warning is written when the resulting drag-free height differs materially from the stored design height. That warning identifies inconsistent/estimated input; it must not be silently hidden by changing the physics.

Show intensity uses `v ∝ √level`, so an ideal pressure-driven jet's height scales approximately with level. `use_inflow` switches off near zero. This is an idealized hydraulic boundary condition, not a pump/network solver inside Blender. Air entrainment, drag, laminar breakup, wind and product-specific jet behavior still require shot tuning.

Flow objects use a planar emitter, world-space initial velocity and animated `use_inflow`, matching Blender's documented liquid-flow controls ([Flow](https://docs.blender.org/manual/en/latest/physics/fluid/type/flow.html)).

### Resolution is the central production decision

A useful first target is **at least four voxels across the nozzle diameter**:

`recommended divisions ≈ longest domain dimension × 4 ÷ nozzle diameter`.

For a 16 m domain and an 11 mm outlet this is about 5,819 divisions before adding margins—usually impractical for a single site domain. The importer reports this calculation. Native outlets preserve their actual radius; under-resolved nozzles remain labeled design proxies or use a local domain. Artificially enlarging an emitter also enlarges water volume and can flood the basin, so it is not used as a shortcut.

The liquid surface uses mesh upres 2, speed vectors for motion blur, mesh particle radius 1.3, and modest positive/negative smoothing. Blender notes that mesh shape depends on the combination of mesh and particle parameters, and excessive smoothing can remove small drops ([Liquid mesh](https://docs.blender.org/manual/en/latest/physics/fluid/type/domain/liquid/mesh.html)).

Spray, foam and bubbles are secondary simulations and need their own bake. They also need renderable instance geometry; the addon creates small water/foam instances rather than assuming particles render automatically ([Secondary particles](https://docs.blender.org/manual/en/latest/physics/fluid/type/domain/liquid/particles.html)).

## 3. Physically based water appearance

### Clear water

The Cycles material uses:

- IOR **1.333** for water.
- Transmission weight 1.0.
- Low roughness, initially 0.018.
- A nearly colorless surface and weak blue-green volume absorption.
- Smooth normals and real thickness/closed proxy meshes where appropriate.

Transmission is the liquid layer in Blender's Principled BSDF; roughness controls reflection and transmission blur ([Principled BSDF](https://docs.blender.org/manual/en/latest/render/shader_nodes/shader/principled.html)).

**Do not make clear water emissive to make it visible.** Clear jets become readable through reflected environment light, refracted background, illuminated droplets and localized scattering from entrained air. A black environment produces poor water even with a correct shader.

### Aerated water, spray and mist

Foam uses a separate rough dielectric material with limited transmission and a little subsurface scattering. Proxy spray uses a closed volume around the core; native spray uses secondary particles. Mist uses volume scattering with forward anisotropy. These are approximations of air/water mixtures, not white glowing plastic.

### Caustics

The generated scene enables Cycles reflective/refractive caustics and marks water casters, basin receivers and caustic-capable lights. MNEE shadow caustics can accelerate suitable cases, but Blender documents important limitations: only refractive caustics in shadow, approximate brightness, smooth-normal requirements, and no volumetric materials or bump/normal maps in that computation ([Object caustics](https://docs.blender.org/manual/en/latest/render/cycles/object_settings/object_data.html)). Expect to tune or disable MNEE for complex fountain shots.

## 4. Real lighting in Cycles

### Radiant watts are not electrical watts

AquaFlow fixture wattage is electrical input. Blender point/spot/area light power is radiant visible power, and Blender explicitly warns that these are not the same unit ([Light objects and power](https://docs.blender.org/manual/en/latest/render/lights/light_object.html)).

The importer therefore uses:

- Manufacturer luminous flux when present: `radiant W ≈ lumens ÷ 300 lm/W`.
- Otherwise an explicitly labeled estimate: 30% of electrical watts.
- Otherwise a legacy-intensity estimate.

The 300 lm/W value is a practical scene-conversion approximation, not a spectral measurement. Blender's examples range from 800 lm at 2.1 W to 5000 lm at 22 W. For production, replace estimates with measured luminous flux and, where necessary, spectral/color data. The multiplier in the addon is an art-direction control and is not calibration evidence.

### Fixture geometry and photometry

Underwater lights use physical source radii, real spot cone angles and upward aiming. A paired nozzle provides an aim target when available. Area lights retain width and length, giving real sampled soft shadows. Referenced IES files use Blender's **IES Texture**, which stores directional intensity distribution ([IES Texture](https://docs.blender.org/manual/en/latest/render/shader_nodes/textures/ies.html)).

RGB and independent white-channel show controls are keyframed. The white channel changes color/energy in Cycles' RGB lighting model; it is not a spectral white-LED simulation. Gobo/video textures, LDT conversion, moving-head scan paths and laser-specific rendering remain extension work.

### Environment and reflection lighting

Night scenes receive a dim world plus a named, optional architectural reflection rig. These area sources are **art-directed environment light**, not fake additions to the fixture's measured photometry. They can be disabled in the panel. Day scenes use a Nishita sky where available. For a customer-faithful result, replace this rig with a calibrated HDRI or modeled venue lighting.

## 5. Sampling, color and motion

The generated scene uses Cycles CPU by default for compatibility, denoising, adaptive sampling, a light tree for many fixtures, 12 total/transmission bounces, and controlled fog glow. CPU is a compatibility default, not a claim that the current GPU is unsupported; select a working Cycles GPU in Blender preferences when available.

Denoising cannot recover detail that was never sampled. Start at 64–128 samples for previews and increase for final refractive water, small droplets and caustics. Adaptive sampling stops regions that are already clean, while the light tree improves many-light sampling ([Cycles sampling](https://docs.blender.org/manual/en/latest/render/cycles/render_settings/sampling.html)).

AgX is selected when available; Blender 3.3 falls back to Filmic. AgX provides highlight desaturation and wide dynamic range, while exposure remains a separate artistic/technical choice ([Displays and views](https://docs.blender.org/manual/en/latest/render/color_management/displays_views.html)). The importer does not use heavy bloom to conceal bad exposure.

Native liquid mesh speed vectors support motion blur. Camera shutter starts at 0.35 frames. Very fast digital curtains may need a shorter shutter and higher show/sample rates.

## 6. AquaFlow conversion contract

- `.aqua` and `.aquashow` are read as JSON; both `engineering` and `engineeringProject` envelopes are accepted.
- Engineering `(x, y)` becomes centered Blender `(x - cx, -(y - cy))`; elevation becomes Blender Z. This preserves the preview's proper axis rotation and pool centering.
- Polygon bounding-box center matches AquaFlow's `poolCenter()` contract. Circle/ellipse geometry uses its stored center.
- Legacy `timelineTracks` and flat fixture clips use half-open activity windows, HTP intensity, fades and keyed values.
- Saved named cameras are imported; a CLI camera override is available for proof renders.
- Source JSON and an import report are embedded as Blender text blocks. The report distinguishes native nozzles from proxies and records warnings.

## 7. Current limits and the correct production workflow

The current addon creates simplified fixture bodies and supports the main basin plus site surfaces. Multi-basin/hole topology, custom venue meshes, detailed manufacturer nozzle outlets, moving machinery, special air-shooter/curtain state machines, LDT profiles and gobo/video projection need further mapping. Proxy fans/crowns are multiple jets; native mode currently uses a representative inflow per fixture, not every physical outlet.

Recommended workflow:

1. Import the full project in **Design proxies** mode. Check geometry, cameras, show timing and exposure.
2. Choose a hero nozzle and use **Hero nozzle · native liquid**. Start with 32–64 divisions and a few frames only to verify the setup.
3. Increase resolution toward four or more voxels across the actual outlet. Tighten the domain before increasing divisions.
4. Bake data, mesh and secondary particles. Inspect the mesh before rendering an animation.
5. Replace estimated photometry with measured lumens/IES and use a real venue HDRI/model where possible.
6. Render Cycles previews, then raise samples and mesh quality for the final shot. Cache externally with sufficient disk space.

The full-scene proxy render and a small native bake are smoke tests, not proof that every fountain is production-ready.
