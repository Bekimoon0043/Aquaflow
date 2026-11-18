# AquaFlow Water Renderer

A separate, read-only presentation renderer for AquaFlow `.aqua` and `.aquapkg` projects. It never writes back to the imported project.

## Run

Open `AquaFlow Water Renderer.html` in Microsoft Edge or Google Chrome, then choose an AquaFlow file. No installation or internet connection is required.

## Controls

- Drag to orbit, mouse wheel to zoom, right-drag to pan.
- Play/pause or scrub the 30-second timeline.
- Choose Eco, Balanced, or Cinematic quality.
- Capture PNG saves the current frame.
- Record show captures one complete timeline pass as a WebM video.

## Rendering model

The renderer uses a fountain-specific hybrid inspired by Blender/Houdini/Unreal: ballistic nozzle streams and droplets, a shallow-water basin surface, secondary foam/ripples, and a physically inspired shader for Fresnel reflection, absorption, caustics, and specular highlights. See `RESEARCH.md` for the design rationale and sources.

## Compatibility

The app is self-contained and runs locally. `.aquapkg` embedded GLB models are restored in memory for rendering only. Projects remain unchanged on disk.

