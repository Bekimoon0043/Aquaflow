# AquaFlow Water Renderer — simulation research

## What leading tools do

### Blender Mantaflow

Blender's liquid workflow places emitters and collision objects inside a voxel domain, advances a hybrid particle/grid liquid solver, reconstructs a surface mesh, and optionally simulates spray, foam, and bubbles as secondary particles. Higher voxel resolution and smaller adaptive time steps improve fast jets, but increase memory and bake time substantially. Blender supports FLIP and APIC behavior; FLIP is livelier and splashier, while APIC is more stable and preserves vortices well.

### Houdini FLIP

Houdini also combines particles with a pressure/velocity grid. Its narrow-band mode keeps particles near the liquid-air interface and represents deeper liquid with fields, reducing memory. Surface tension shapes droplets. Whitewater is a separate layer generated from acceleration, curvature, and vorticity, then classified visually as spray, foam, and bubbles.

### Unreal Niagara fluids

Unreal separates the problem by scale. Its 3D liquid solver is FLIP, but pools with limited splashing use a shallow-water height field. Simulation data can be baked to textures for faster playback. This is the closest match to a real-time fountain presentation tool.

### Real-time GPU water

NVIDIA's published methods combine low-frequency geometric displacement with high-frequency animated surface normals. The small normal detail contributes a large part of perceived realism. Physically plausible Fresnel reflection, absorption, refraction, specular highlights, and caustics are therefore as important as the motion solver.

## Decision for this renderer

A general-purpose 3D FLIP solver would be slow to bake, memory-heavy, and unsuitable for interactive 30-second show editing on an older GPU. Fountain jets are also controlled sources, so their trajectory is known before simulation. This renderer uses a purpose-built hybrid:

1. Ballistic particles and a translucent jet core for each AquaFlow nozzle.
2. A bounded shallow-water/height-field surface for the basin, with traveling waves and jet-driven ripples.
3. Secondary droplets and animated foam rings at impact points.
4. Physically inspired water shading: dielectric Fresnel response, depth absorption, reflection, refraction-like color mixing, specular sun highlights, and procedural caustic detail.
5. AquaFlow timeline evaluation to drive every nozzle, rather than inventing motion unrelated to the programmed show.
6. Quality tiers so the same file can run on a GeForce GT 730-class machine and scale upward on newer hardware.

This is an engineering tradeoff: it reproduces the visual mechanisms that matter for a programmed architectural fountain in real time. It is not a replacement for Blender/Houdini when a shot needs fully coupled 3D fluid collisions, breaking sheets, or large chaotic splashes.

## Primary sources

- Blender Manual, Fluid Domain Settings: https://docs.blender.org/manual/en/latest/physics/fluid/type/domain/settings.html
- Blender Manual, Liquid Secondary Particles: https://docs.blender.org/manual/en/latest/physics/fluid/type/domain/liquid/particles.html
- Blender Developer Notes, Mantaflow: https://developer.blender.org/docs/release_notes/2.82/physics/
- SideFX Houdini FLIP Solver: https://www.sidefx.com/docs/houdini/nodes/dop/flipsolver
- SideFX Houdini Whitewater: https://www.sidefx.com/docs/houdini/fluid/whitewater.html
- Unreal Engine Fluid Simulation Overview: https://dev.epicgames.com/documentation/en-us/unreal-engine/fluid-simulation-in-unreal-engine---overview
- NVIDIA GPU Gems, Effective Water Simulation: https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models

