# AquaFlow pattern-design workspace research

**Date:** 2026-11-19  
**Question:** how should AquaFlow make water, 1D, 2D and 3D patterns easy to create without limiting advanced users?

## Research findings

- [Depence keyframe easing](https://help.depence.com/depence-show-and-animation/depence-show-sequencer/depence-keyframe-animations/depence-easing-options) applies easing per keyframe instead of forcing one interpolation rule on a whole animation. [Depence's overview](https://www.syncronorm.com/products/depence2/visualization/overview) combines timeline keyframe animation, show synchronization, procedural arrangement and live pre-visualization.
- [Adobe's interpolation guide](https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/animation-keyframes/keyframe-interpolation.html) separates temporal interpolation (value over time) from spatial interpolation (the path through space). Linear, eased and held segments communicate different artistic intent.
- [Apple Motion's Keyframe Editor](https://support.apple.com/en-mn/guide/motion/motn147486cf/mac) combines parameter curves, sketching, keyframe editing, interpolation and a live playhead. The useful lesson is not to expose every professional control at once: keep a guided path into a real curve editor.
- [OASE's 2D drive](https://www.oase-professional.com/en/family/product/p/34318-multi-directional-drive-l-2d-dmx-02-int.html) demonstrates that moving fountains are real multi-axis mechanisms with published ranges. Pattern software must respect those ranges and drive speeds instead of treating motion as an unconstrained animation.

## Audit of the previous AquaFlow creator

Strengths: the custom water model already separates one jet's temporal shape, the path across a group, timing, height and lights. Patterns remain parametric and editable after placement. The Bellagio asset pack adds 160 reusable starting points.

Gaps:

1. The creator only emitted water/light field recipes; there was no 1D/2D/3D design path.
2. Show motion used hard-coded ±45° keyed conversion, and the Studio show history carried only pan/tilt.
3. Target groups and pattern duration were chosen implicitly.
4. Drawn keys had no per-key interpolation control.
5. Static/curve assets could be edited only after placement; there was no direct route from an asset to a remix in the creator.
6. Motion alone would not guarantee visible water. A usable moving-nozzle pattern needs coordinated water, motion and optional light layers.

## Design adopted

### Four modes, one mental model

- **Water:** temporal shape → group spread → timing → height → lights.
- **1D Swing:** temporal shape → swing amplitude/centre → group phase and mirroring.
- **2D Aim:** parametric or drawn spatial path → pan/tilt amplitude/centre → group phase and timing.
- **3D Head:** the 2D model plus continuous head spin, held angle or oscillation.

Every motion pattern can contain coordinated water, motion and light layers in one timeline block. Users choose the destination groups and duration explicitly. The block remains editable and exportable.

### Guided first, precise when wanted

- Plain-language templates for sweep, circle, figure eight, cross, spiral and free dance.
- A drawn temporal curve for water/1D, with per-key linear, smooth, ease-in, ease-out and hold behavior.
- A draggable spatial path for custom 2D/3D motion.
- Grouping, phase spread, direction, alternating/opposite motion, offset, centre and amplitude controls.
- A live schematic preview and a real compiled-show preview after placement.

### Hardware honesty

- Use each fixture's actual channels and published ranges.
- Estimate peak pan/tilt angular speed and optionally slow the complete group coherently to the slowest drive.
- Preserve continuous 3D roll in degrees rather than truncating it to the legacy ±45° mapping.
- These are design aids, not proof of site commissioning; existing preflight and commissioning gates remain authoritative.

### Asset workflow

The 160 Bellagio assets remain available from the timeline. **Customize** opens an independent remix in the creator; **Add** inserts the unchanged asset. Custom patterns remain saveable in My patterns and portable through the existing type/pattern files.
