# Show Programming workspace

Implemented 2026-10-09. This workspace replaces the old embedded Show Programming panel in the frontend. The desktop installer has not been rebuilt for this change.

## Create a show

1. Open your `.aqua` project and go to **Show Programming**. Engineering fixtures appear automatically in the Explorer. Site models appear as scenery; the pool and land remain spatial context.
2. Choose an Engineering group, or select fixtures in **2D Plan**, **Matrix**, or **3D Water**. Shift adds to selection. Drag a rectangle in Plan to select several fixtures. Use the Explorer search for fixture names, IDs, zones, types, or addresses.
3. Enter a group name and click **Group selected items**, or press **Ctrl+G**. Engineering groups follow membership changes automatically; saved selection groups keep explicit fixture IDs.
4. Click **+ Pattern**, or drag a group from the Explorer into the timeline. Choose Wave, Chase, Ripple, Pulse, Static, Staircase, Sparkle, Color, or Curve.
5. In the Pattern inspector set timing, cycles, level, selection order, phase spread, and color. The primary parameter uses each fixture's compatible level channel. Other channel parameters can be selected explicitly.
6. Click **Play preview** or press **Space**. Music is optional. Use 3D Water to see the existing AquaFlow water renderer inside the workspace.
7. Move a pattern by dragging it. Drag its right edge to change duration. Ctrl/Shift-click to select several clips, or drag a rectangle from empty timeline space. Move the selection together, duplicate with **Ctrl+D**, or copy/paste with **Ctrl+C / Ctrl+V**. Paste starts at the playhead. Delete and Undo/Redo work on the selection as one operation. The group row's M/S/L buttons mute, solo, and lock; parent folder states are inherited.
8. Click **Save .aqua**. The project includes Engineering, groups, recipes, presets, curve points, tempo changes, markers, workspace layout, and the resolved fixture clips. Audio is stored as a file reference and must be relinked after reopening.

## Detailed fixture edits

For individual timing or channel overrides, select a pattern and choose **Convert to editable fixture clips**. This resolves the pattern into fixture clips; the conversion is undoable. Turn on **Fixture details** in the timeline to reveal channel rows, then select a clip to edit its value, timing, fades, and color.

Existing shows retain their original clips and appear under **Existing fixture clips**. They do not need to be recreated as recipes.

Choose **Curve** to draw a custom level envelope. Drag its points, double-click to add points, or enter numeric point time/level values. The envelope repeats per cycle and phase-spreads across the group. It is sampled into runtime clips (up to 400 samples per fixture). Compilation reports an error if the show exceeds 50,000 resolved clips; reduce complexity before export.

## Groups and large projects

Explorer views include Engineering groups, Show groups, All items, Zones, Fixture types, Systems/pumps, and Needs mapping. Groups can be nested using Parent folder. Ordering supports engineering order, left/right, front/back, clockwise/counter-clockwise, and center-out.

Use **Freeze group membership** for a pattern that should keep the current members when Engineering changes. Missing fixtures and missing groups appear in Compile diagnostics. A recipe with a missing group can be repaired by selecting another Target group.

To replace a saved group's members, first select the new fixtures, open the Group inspector, and choose the destination under **Replace an existing group's members**. This converts linked membership to an explicit saved selection and can be undone.

The Explorer and timeline render visible rows only. A background worker resolves recipes to runtime clips. Compose, Spatial, Timing, and AI layouts, panel resizing, and Explorer/Inspector visibility are saved in the project.

## AI and music

Select a group and open **AI compose**. Enter a prompt and duration. The existing AquaFlow `/api/ai/generate` service proposes sections that become the same editable recipes used by manual editing. Choose individual proposed patterns, preview them, then apply. Applying is a single undo operation. Engineering changes invalidate an old proposal.

The current engine is AquaFlow's existing choreography engine; this update does not introduce a new external language-model provider. The live backend must be available for generation. The Music tab retains the existing mapped-site music choreography and detailed array builder. Choose audio there to see its waveform in the arrangement.

The Music tab also holds a tempo map. Add BPM changes at the playhead; **Beat snap** aligns clip moves, resizing, and group drops to sixteenth notes in the active tempo section. Tempo changes affect editing snap positions, not audio time-stretching or existing clip positions.

## Preview, export, and compilation

The preview transport is a design simulation. **Compile / Siemens** passes the resolved fixture clips into the existing Siemens controls. Those controls retain the current site's mapping and verification workflow. A recipe that includes incompatible channels must be corrected before compilation.

**Open full 3D / video render** sends the resolved show to the existing full preview and video-export workspace. Some control-only channels have no 3D representation; the embedded renderer reports their count and leaves them available in the timeline and compiler.

## Verification and remaining roadmap

- Automated coverage includes 320-fixture recipes, 1,000-fixture deterministic resolution, Engineering membership changes, missing items, folder states, legacy migration, and project round trips.
- Browser acceptance covers selection/search, visible-row rendering, playback, save/download, reopen, undo/redo, AI preview/apply using a mock server, curve editing, marquee selection, batch move/copy/paste, and embedded 3D water rendering.
- This iteration does not claim measured 60-fps rendering on every GPU. Large-scene water performance depends on the existing renderer and target PC.
- Floating/multi-monitor docking, editable group query expressions, cubic/tangent automation curves, and phase-preserving splitting of procedural recipes remain follow-up phases from the larger redesign plan. Current custom envelopes use linear keyframes, and detailed per-fixture edits use resolved clips.
