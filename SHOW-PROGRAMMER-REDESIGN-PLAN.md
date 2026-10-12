# AquaFlow Show Programmer — Full-Screen, Group-First Redesign Plan

Date: 2026-10-09  
Status: Core full-screen implementation completed 2026-10-09. See `aquaflow/docs/SHOW-STUDIO-GUIDE.md` for implemented features, verification, and remaining advanced roadmap phases. This document retains the original wider design specification.

## 1. Outcome

Turn Show Programming into AquaFlow's main creative workspace: a full-screen environment where every programmable item created in Engineering is immediately available, designers can build fountain patterns manually or with AI, and projects with 300–1,000 fixtures remain understandable and fast.

The central design decision is **group-first authoring with fixture-level detail on demand**. A 300-fixture project must not begin as 900 permanently visible channel rows. Designers first work with spatial groups, zones, fixture types, and reusable patterns, then expand only the items or parameters they need.

## 2. Research findings and what AquaFlow should adopt

### Depence: groups feed a show sequencer

Depence treats selection groups as ordered fixture lists and calls them essential for show programming. Its sequencer uses a tree of tracks and folders, and folder state is inherited by children. Dragging a fixture group into the timeline creates a group track. AquaFlow should adopt ordered groups, group-to-timeline drag/drop, nested folders, and inherited mute/solo/lock.

Sources: [Depence Selection Groups](https://help.depence.com/depence-show-and-animation/depence-selection-groups), [Show Sequencer](https://help3.depence.com/depence-show-and-animation/depence-show-sequencer), [Fixture Group Tracks](https://help.depence.com/depence-show-and-animation/depence-show-sequencer/depence-track-types/depence-fixture-group-tracks)

### grandMA3: selection order and spatial grids drive patterns

grandMA3 groups preserve fixture selection order and grid positions, which lets effects travel left-to-right, radially, or in other spatial orders. Its Phaser Editor offers multiple representations of the same effect, hides unused rows, and separates steps from attribute layers. Its Recipes combine a group, a preset/value, timing, phase, and grid behavior; recipes can be recalculated when the group changes. AquaFlow should use the same underlying idea: a pattern is a non-destructive recipe applied to a group, not thousands of baked per-fixture values.

Sources: [grandMA3 Groups](https://help.malighting.com/grandMA3/2.3/HTML/group.html), [Phaser Editor](https://help.malighting.com/grandMA3/2.2/HTML/phaser_editor.html), [Recipes](https://help.malighting.com/grandMA3/2.2/HTML/recipes.html), [Recipe Editor](https://help.malighting.com/grandMA3/2.4/HTML/recipe-sheet.html)

### ETC Eos: spatial control surfaces improve selection

ETC Magic Sheets are user-created interactive layouts connected to show data. Objects can directly select channels, groups, presets, palettes, macros, and faders. AquaFlow already knows every fixture's engineering position, so it can provide a spatial 2D plan alongside the 3D preview and timeline instead of forcing all selection through a long text list.

Sources: [ETC Magic Sheets](https://www.etcconnect.com/webdocs/Controls/EosFamilyOnlineHelp/en/Content/18_Magic_Sheets/About_Magic_Sheets.htm), [Magic Sheet Object Library](https://www.etcconnect.com/webdocs/Controls/EosFamilyOnlineHelp/en/Content/18_Magic_Sheets/Magic_Sheet_Editor/Magic_Sheet_Object_Library.htm)

### Ableton Live and Blender: scalable time editing

Ableton uses folded group tracks, overview clips, additional automation lanes, and a timeline overview for navigating long arrangements. Blender's Dope Sheet stacks animatable channels against a shared time axis. AquaFlow should use clips for high-level patterns and reveal parameter automation only when requested.

Sources: [Ableton Arrangement View](https://www.ableton.com/en/manual/arrangement-view/), [Automation](https://www.ableton.com/en/live-manual/12/automation/), [Group Tracks](https://www.ableton.com/en/manual/mixing/), [Blender Dope Sheet](https://docs.blender.org/manual/en/latest/editors/dope_sheet/introduction.html)

## 3. Current AquaFlow foundation

AquaFlow already has several pieces worth retaining:

- Engineering fixtures are held in `engineeringStore` and include stable IDs, type, position, rotation, zone, engineering metadata, and `groupId`.
- `runtimeDeviceGraph` derives type, zone, custom group, preview capabilities, and track capabilities from those fixtures.
- `autoTrackGenerator` can create folder and channel-track structures from engineering fixtures.
- Show Programmer already provides pattern blocks, individual clips, waveform/beat markers, an array-pattern builder, AI choreography, validation, preview, save/load, keyboard shortcuts, and undo/redo.
- The app already keeps visited workspaces mounted, so switching pages need not destroy Show Programmer state.

The main constraints are architectural: `ShowProgrammerPanel.jsx` is currently about 4,061 lines, the layout is embedded in one component, and large designs still resolve primarily into category-grouped per-fixture channel rows. The redesign should be incremental, not a rewrite that discards working compile, PLC, preview, or save/load paths.

## 4. Proposed full-screen workspace

“Full screen” means an immersive AquaFlow workspace that hides the normal left device browser, global inspector, and duplicate global timeline while retaining the top application menu, safety state, and an obvious **Exit Show Workspace** control. Optional OS full screen can be added later.

```text
┌ Project / Show | Sync | Undo Redo | Transport | Timecode | Preview | Compile ┐
├────────────────┬─────────────────────────────────────────┬───────────────────┤
│ SHOW EXPLORER  │     3D PREVIEW / 2D PLAN / MATRIX      │ CONTEXT INSPECTOR │
│ Search/filter  │                                         │ Pattern / Group   │
│ All items      │   select, box-select, lasso, identify   │ Fixture / AI      │
│ Groups         │   direction/order overlays              │                   │
│ Zones          │                                         │                   │
│ Types          │                                         │                   │
│ Unassigned     │                                         │                   │
├────────────────┴─────────────────────────────────────────┴───────────────────┤
│ TIMELINE OVERVIEW / SECTIONS / MARKERS / AUDIO                              │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ Folder/track  │ Pattern clips; expand selected clip into parameter lanes     │
│ tree          │ playhead, snapping, fades, repetitions, automation           │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

All panel boundaries are resizable. The preview can maximize, the timeline can maximize, and the inspector/explorer can collapse. Named layouts—**Compose**, **Spatial**, **Timing**, **AI**, and **Commissioning**—are saved per user.

## 5. Information model

### 5.1 One engineering source of truth

Show Programmer reads the canonical Engineering fixture registry; it does not maintain a second editable copy. Every fixture receives a programming status:

- **Ready** — has programmable capabilities and valid runtime mapping.
- **Control-only** — pump, valve, controller, or other non-visual programmable item.
- **Non-programmable** — scenery/site model, shown in the scene but excluded from control tracks.
- **Needs mapping** — programmable fixture with incomplete channel/runtime metadata.
- **Orphaned** — referenced by a show but removed from Engineering.

The header shows `Engineering sync: 326 items · 312 programmable · 8 control-only · 6 need mapping`. Selecting a warning opens the exact affected items.

### 5.2 Persistent ordered groups

Add a first-class `showGroups` collection with stable IDs:

```text
id, name, parentId, color, memberFixtureIds, orderMode,
orderedFixtureIds, spatialGrid, linkedQuery, tags, locked
```

Groups may be:

- Manual selections.
- Auto groups linked to Engineering type, zone, `groupId`, circuit, manifold, or controller.
- Nested folders such as `North Basin > Outer Ring > RGB`.
- Dynamic query groups such as `type:nozzle_geyser zone:north`.

Selection order is editable by spatial rules: engineering order, left-to-right, right-to-left, front-to-back, radial clockwise/counter-clockwise, distance from a chosen origin, snake, or custom. This order is what wave, chase, fan, and ripple patterns use.

### 5.3 Pattern recipes instead of exploded clips

Introduce a versioned `PatternRecipe`:

```text
id, name, targetGroupId, start, duration, effectType,
attributes, phase, spread, direction, repetitions, easing,
seed, colorPalette, safetyLimits, overrides
```

The timeline stores one recipe clip for a group. The preview and compiler resolve it to fixture/channel values. A designer can “open details” to see generated lanes and add fixture-specific overrides without destroying the recipe. If group membership changes, linked recipes recalculate; an optional **Freeze membership** command stores a snapshot.

Core manual effects for the first release:

- Static level/state.
- Chase and step chase.
- Wave/sine, pulse, ripple, fan, staircase, random sparkle.
- Height/intensity envelope.
- Color chase, gradient, color pulse.
- Pan/tilt/angle sweep for moving nozzles.
- Pump/valve enable and ramp with safety-aware limits.

## 6. Primary workflows

### Manual pattern workflow

1. Select fixtures in the Explorer, 2D plan, 3D preview, or matrix; selection stays synchronized everywhere.
2. Press **Create Group** or use an existing group.
3. Drag the group to the timeline, or click **Add Pattern**.
4. Pick an effect and compatible attributes. Unsupported controls are hidden.
5. Set direction/order, phase/spread, height/intensity, timing, color, and easing while the preview updates live.
6. Resize, repeat, split, duplicate, layer, or crossfade the pattern clip.
7. Expand only the selected recipe into parameter lanes for detailed keyframe editing.
8. Validate, preview, compile, and save through the existing runtime/PLC paths.

### AI pattern workflow

AI is an assistant inside the same workspace, not a separate destructive generator:

1. Designer chooses scope: selected group(s), section, duration, music range, and allowed fixture capabilities.
2. Prompt describes intent, for example: “Build a calm blue radial opening for 12 seconds, then a fast center-out water chase.”
3. AI returns a structured proposal made from the same `PatternRecipe` objects as manual editing.
4. AquaFlow shows a ghost preview, timeline diff, affected groups, safety warnings, and estimated fixture/channel load.
5. Designer can apply all, apply selected recipes, regenerate one section, or cancel.
6. The entire apply action is one undoable transaction. Store prompt, model/version, seed, and proposal metadata for reproducibility.

AI must never silently alter Engineering geometry, fixture addressing, PLC mapping, safety limits, or already approved sections.

## 7. Handling 300+ items

### Explorer

- Virtualized tree rows; render only visible rows.
- Default collapsed group/zone/type hierarchy, not 300 expanded fixtures.
- Instant search by label, ID, type, zone, group, tag, PLC/DMX address, or warning state.
- Filter chips and saved filters.
- Shift/Ctrl selection, box/lasso selection in spatial views, range selection in matrix view.
- Batch rename/tag/group/map operations.
- Counts and mixed-state indicators on every parent.

### Timeline

- Virtualized vertical track tree and a canvas/WebGL clip surface rather than hundreds of React DOM rows.
- Group summary rows remain visible when children are folded.
- Only selected or explicitly expanded parameter lanes render.
- Timeline overview/minimap for long shows.
- Sections, locators, markers, tempo map, beat/grid snapping, and loop range.
- Parent folders inherit mute/solo/lock/visibility.

### Preview

- Level-of-detail and instancing for repeated fixtures.
- Throttle expensive water rendering during scrubbing; restore final quality after the playhead settles.
- “Solo selection” and “dim unselected” modes.
- 2D plan/matrix fallback for very large designs or lower-end GPUs.

Performance targets for a 320-fixture acceptance project:

- Workspace opens in under 2 seconds after data is available.
- Search/filter response under 100 ms.
- Selection feedback under 50 ms.
- Smooth timeline scroll and scrub near 60 fps on the target PC.
- No more than roughly 50–80 tree/track row components mounted at once.
- Compile and AI work run asynchronously and never freeze editing.

## 8. Interaction and shortcuts

- `Space`: play/pause; `Shift+Space`: play selection/loop.
- `Ctrl+Z` / `Ctrl+Y`: undo/redo.
- `Delete`: delete selection with safety-aware confirmation only where needed.
- `Ctrl+G` / `Ctrl+Shift+G`: group/ungroup.
- `Ctrl+F`: focus Explorer search; `Ctrl+K`: command palette.
- `F`: frame selected in preview and timeline.
- `A`: select all in current scope, not globally unless scope is All Items.
- `M`, `S`, `L`: mute, solo, lock selected tracks/groups.
- `+` / `-`: expand/collapse selected group.
- Arrow keys: move playhead or selection; modifiers change step size.
- Drag from Explorer to timeline creates a group/fixture track; drag a preset onto a target creates a recipe clip.

Every shortcut appears in tooltips and the command palette. All drag actions must have a menu/keyboard equivalent.

## 9. Implementation phases

### Phase 0 — stabilize contracts and split the component

Deliverables:

- Characterization tests for current save/load, manual clips, pattern blocks, AI apply, preview, compile, and Siemens-site behavior.
- Extract full-screen shell, Explorer, Preview Area, Timeline, Inspector, and dialogs from the 4,061-line component without changing behavior.
- Define versioned `ShowDocument`, `ShowGroup`, `PatternRecipe`, selection, and workspace-layout schemas.
- Add migration for existing clip-only programs.

Acceptance: existing saved shows load, preview, and compile identically before any new UX is enabled.

### Phase 1 — full-screen shell and Engineering inventory

Deliverables:

- Immersive Show workspace route/state in `App.jsx`.
- Hide duplicate global Device/Inspector/Timeline panels in this workspace.
- Virtualized Explorer with All, Groups, Zones, Types, Systems, Unassigned, and Warnings.
- Live Engineering sync summary and orphan/mapping diagnostics.
- Persist panel sizes, collapsed nodes, filters, and workspace preset.

Acceptance: a 320-item Engineering project appears completely and remains responsive; switching pages preserves state.

### Phase 2 — group system and spatial selection

Deliverables:

- Persistent nested ordered groups.
- Auto groups from Engineering `groupId`, type, zone, circuit/manifold, and controller.
- Linked selection across Explorer, 2D plan, 3D preview, matrix, timeline, and inspector.
- Spatial order tools and visible order numbers/arrows.
- Drag group to timeline.

Acceptance: a designer can create a clockwise outer-ring group from the plan and use it without touching 80 individual rows.

### Phase 3 — recipe-based manual pattern composer

Deliverables:

- `PatternRecipe` engine and compatibility-aware pattern browser.
- Live recipe inspector with effect, timing, phase/spread, direction, color, and safety limits.
- Group summary clips and on-demand parameter lanes.
- Recalculate versus Freeze Membership behavior.
- Preset library and reusable project/user patterns.

Acceptance: create a wave across 100 jets as one editable clip; adding a jet to the linked group updates the preview and compiled result.

### Phase 4 — scalable professional timeline

Deliverables:

- Windowed/virtualized tree and clip canvas.
- Nested folders with inherited mute/solo/lock.
- Timeline overview, sections, locators, tempo map, loop range, snapping, automation lanes, and bulk editing.
- Clipboard and multi-selection behavior across recipe clips.

Acceptance: a five-minute, 300-fixture show with hundreds of recipe clips scrolls and scrubs smoothly.

### Phase 5 — integrated AI co-designer

Deliverables:

- Scope-first prompt composer.
- Structured recipe proposal, ghost preview, timeline diff, validation, partial apply, and one-step undo.
- Regenerate selected section/pattern only.
- Deterministic metadata and audit history.

Acceptance: AI can create a section without modifying fixtures or unrelated timeline ranges, and the user can compare/cancel before commit.

### Phase 6 — performance, accessibility, and production QA

Deliverables:

- 320-, 1,000-, and worst-case fixture benchmark projects.
- Keyboard-only workflow and command palette coverage.
- Screen-reader labels, focus order, contrast, reduced-motion option.
- Autosave/crash recovery, corrupted-reference repair, migration tests.
- End-to-end tests through preview, compile, save/reopen, Siemens-site export, and PLCSIM-compatible runtime output.

## 10. Recommended first build slice

Build Phases 0–2 first, then one vertical pattern slice before expanding effects:

1. Full-screen shell.
2. Virtualized Engineering Explorer.
3. Persistent ordered groups with 2D/3D linked selection.
4. Drag a group to the timeline.
5. One recipe effect—**Wave**—with height/intensity, direction, phase, duration, and live preview.
6. Save/reopen and compile that recipe through the current runtime.

This slice proves the new architecture with real water behavior and 300+ fixtures before investing in a large effect library or advanced AI.

## 11. Release acceptance scenario

Use a reference project with at least 320 engineering items: 160 water outlets, 96 RGB lights, 32 moving nozzles, 16 valves, 8 pumps, and 8 control/safety items.

The redesign is ready when:

- Every item is visible in the correct status/category and searchable.
- The default view is usable without expanding individual fixtures.
- Selection is synchronized across all views.
- A designer can create, order, save, and reuse nested groups.
- Manual Wave, Chase, Ripple, Static, and Color patterns can be authored as group recipe clips.
- AI proposals use the same editable recipes and require preview/approval.
- Undo/redo covers group, recipe, AI apply, and bulk actions.
- Save/reopen preserves groups, recipes, layout, and selections that are part of the document.
- Deleted or changed Engineering fixtures never fail silently; AquaFlow reports and repairs references.
- Preview and compiled PLC/DMX outputs remain consistent with the timeline.
- The UI meets the stated responsiveness targets on the intended AquaFlow PC.

## 12. Key risks and controls

- **Risk: duplicate source-of-truth data.** Control: Engineering owns fixtures; Show owns groups and programming references only.
- **Risk: recipe output differs from compiled output.** Control: preview and compiler consume the same resolved recipe event stream.
- **Risk: AI creates unsafe or unreviewable output.** Control: capability/safety constraints, diff preview, explicit apply, single-step undo, audit metadata.
- **Risk: full screen hides navigation.** Control: persistent workspace title, visible Exit control, `Esc` behavior, and command palette.
- **Risk: large projects overload the DOM/GPU.** Control: virtualization, instancing, folded groups, on-demand lanes, and benchmark gates in every phase.
