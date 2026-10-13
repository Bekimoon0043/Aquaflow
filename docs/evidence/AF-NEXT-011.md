# AF-NEXT-011 — Essential drafting tools (AF-CAD-030 … 034)

Date: 2026-10-13 · Scope: `aquaflow/frontend/src` · No hardware touched · Not committed (coordinator owns git).

## Acceptance

> A novice can draw and connect a 12.5 m pipe to a nozzle port, undo it as one action, and
> repeat the operation in 2D/3D with the same geometry.

`src/components/panels/__tests__/AF-NEXT-011.acceptance.test.js` (jsdom + real components):

| Step | 2D designer (`PoolGeometryDesigner`) | 3D editor (`SceneEditor`, real three.js) |
|---|---|---|
| Start | Pipe tool, click 0.1 m from nozzle A → **Port** snap (2, 2) | `draftClick` on the ground plane at the same plan point |
| Direction | move cursor to ~0° (polar tracking / ORTHO) | `draftPointer` at ~0° (15° polar tracking) |
| Length | type `1 2 . 5`, Enter, Enter (no menu) | `draftKey` `1 2 . 5 Enter Enter` |
| Result | `[(2,2), (14.5,2)]`, `connections.start/end` = nozzle A / B inlet ports | **identical** points and connections |
| Undo | Ctrl+Z removes the pipe only (one transaction); Ctrl+Y restores it | `editor.undo()` / `redo()` through the same shared history |
| Cross-editor | a pipe drawn in 2D is undone from the 3D editor; the designer follows | |

## What was built

| Ticket | Delivered | Files |
|---|---|---|
| AF-CAD-030 | Characterisation tests written **first** (13 tests, passed on the pre-split code and unchanged after). Drafting kernel extracted; designer **4,425 → 1,565 lines**. Stable `uuid` + `owner` (`basin:<id>` / `model` / `site`) on fixtures, pipes, surfaces, groups; lazy migration on load keeps every existing `id`. | `engineering/drafting/{entities,selection,commands,viewport,snap,geometryEdit,arrays,designerCatalog,designerRenderer,overlays}.js`, `components/panels/designer/{DesignerSidebar.jsx,FixturePropertiesPanel.jsx,designerExport.js}` |
| AF-CAD-031 | Command-pattern history with JSON deltas (`insert/delete/patch/order/set`, patch = changed fields only), capped at 100, `toJSON/fromJSON`. A gesture (click-place, array, drag, multi-move, gizmo drag) is one transaction (explicit gesture brackets + 220 ms settle; 3D publishes coalesce per gesture). **One shared history** for 2D and 3D (`sharedDraftingHistory`); 3D uses `SharedSceneHistory` injected into `SceneEditor`. | `drafting/commands.js`, `drafting/useDraftingHistory.js`, `preview/editor/sharedSceneHistory.js`, `preview/editor/engineeringDraftingBridge.js`, `preview/PreviewPanel_v5.jsx`, `preview/editor/sceneEditor.js` |
| AF-CAD-032 | One snap engine: Endpoint, Port, Intersection, Midpoint, Center, Insertion, Perpendicular, Nearest, grid last; 10 px screen aperture (zoom-independent); priority Endpoint=Port > Intersection > Midpoint > Center(=Insertion) > Perpendicular > Nearest > grid; distinct glyph + tooltip per mode; uniform-grid `SnapIndex` (RBush-like, no new dependency) for live entities, the existing `cadUnderlay` grid index for the underlay. Ports defined per fixture family (nozzle inlet under outlet, pump suction/discharge, valve in/out; DN from engineering data). Used by the designer (draw tools, grips, fixture drag), `usePipeDrawing`, and the 3D gizmo (`editorSnapping.resolveDrag`, Shift = 10 cm grid and Alt = no snap kept). OSNAP toggle in the toolbar. | `drafting/snap.js`, `drafting/session.js`, `engineering/usePipeDrawing.js`, `preview/editor/{editorSnapping,transformGizmo,sceneEditor}.js` |
| AF-CAD-033 | Polar tracking (15°, always on, Shift locks the direction), dynamic input at the cursor (number → length, Tab → angle, `@dx,dy`, `x,y`, `L<A`; Enter commits, Enter on empty finishes, Esc clears/cancels), typed points magnet onto a coincident port (≤ 1 mm) and record the connection. Ctrl+K palette lists every designer command (tools, edit, select, group, view, snap, pipe modes, design, project, export, devices). | `drafting/dynamicInput.js`, `drafting/DynamicInputOverlay.jsx`, `drafting/commandPalette.jsx` |
| AF-CAD-034 | Shift-click add/toggle, left→right WINDOW / right→left CROSSING box (on empty space, or Ctrl-drag anywhere), Ctrl+A, select-similar (type or CAD block), groups as ID lists (`project.groups`, Ctrl+G / Ctrl+Shift+G, clicking a member selects the group), multi-move as one undo step, properties panel edits shared fields (rotation, zone, group label, common engineering fields; "mixed" placeholders). | `drafting/selection.js`, `designer/FixturePropertiesPanel.jsx`, store/project `groups` |

Also (coordinator request, AF-NEXT-009): the designer listens for `aquaflow:select-engineering-item`
(`detail.target` or `detail.id`) and reads `takePendingFocus("engineering")` on mount; it selects the
fixture / pipe / basin / land surface and centres the view on it
(`__tests__/PoolGeometryDesigner.preflightFocus.test.js`).

## Data contract and migration

- Fixture/pipe/surface records keep their shape; added `uuid`, `owner`, and on pipes optional
  `connections: { start, end }` (`{ fixtureId, fixtureUuid, port, dn }`). New entities use `id = uuid`.
- Project gains `groups: [{ id, uuid, owner, name, members: [entityKey] }]` (store, `.aqua` payload,
  `normalizeEngineeringProject`, publisher). Older files load with `groups: []`.
- History is session-only (not saved). It is cleared on project load. No snapshot fallback is used:
  the only full document kept is each host's current state (its diff base).
- `InspectorPanel.jsx` is the **show** inspector (nodes/devices/clips), not engineering properties;
  multi-select editing was therefore implemented in the designer's fixture properties panel and
  `InspectorPanel.jsx` was not edited (no conflict with AF-NEXT-012).

## Behaviour changes to note

- Object snaps are on by default (OSNAP button): drawing and fixture dragging now acquire nearby
  ports/endpoints/edges inside 10 px before the grid. With OSNAP off and SNAP off, positions are full precision (AF-CAD-002 kept).
- Clicking empty space outside the pool now starts a selection box (previously did nothing but clear).
- Layer visibility toggles now redraw immediately (the old draw effect missed `layers` in its deps).
- Fixture ids from click placement / arrays / auto-place are UUIDs (were `Date.now()`, which could collide in auto-place).
- `engineeringHistory.js` and `designerSnap.js` are no longer used by the designer (kept, with their tests, for now).

## Evidence

| Command | Result |
|---|---|
| `npx vitest run src/components/panels/__tests__/PoolGeometryDesigner.characterisation.test.js` (before split) | 13/13 pass |
| same, after split | 13/13 pass |
| `npx vitest run src/engineering/drafting src/components/panels/__tests__ src/components/preview/editor` | all pass (kernel 20, acceptance 4, focus 3, 3D 3 new) |
| `npx vitest run` (baseline before work) | 91 files / 984 tests pass |
| `npx vitest run` (after) | **99 files / 1045 tests pass** |
| `npx vite build` | built OK (existing >750 kB three/mediabunny chunk warning) |

Dev dependencies added for DOM tests: `jsdom@25`, `@testing-library/react@16`, `@testing-library/dom@10` (MIT).

## Known limitations / follow-ups

- Typed entry is wired for the pipe command (2D and 3D); pool polyline uses polar tracking but not yet typed lengths.
- Box selection selects fixtures (pipes keep their single-selection model); modify tools are AF-CAD-035.
- The 3D viewport does not yet render drafted pipes or a 3D snap glyph; the 3D drafting path (`SceneEditor.beginPipeDraft`) has no toolbar button yet.
- 3D publishes include float round-trip noise (world ⇄ plan) in the gesture's delta; harmless for undo.
