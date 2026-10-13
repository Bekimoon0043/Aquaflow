# AquaFlow codebase audit: engineering design, 3D rendering and CAD exchange (as of 2026-10-13, HEAD d92c329)

Sources are local files in `C:/Users/user/Documents/aquaflow`. Paths below are repo-relative; `FE` = `aquaflow/frontend/src`, `BE` = `aquaflow/backend`, `DESK` = `aquaflow/desktop`. Line numbers were read at HEAD d92c329, with uncommitted working-tree changes present (git status shows many modified files).

## Architecture: frontend, 3D stack, Electron, backend, entry points

### Takeaway
AquaFlow is React 18 + Vite 5 + Zustand. The 3D view uses raw three.js r165 with no react-three-fiber, no `postprocessing` library and no WebGPU. The backend is FastAPI/uvicorn. An Electron 33 shell packages the app and runs native AutoCAD/ODA DWG conversion. The two main editors are large monoliths: the 2D engineering designer has 4,345 lines and the 3D scene has 4,387.

### Cited Findings
- Frontend dependencies are `react ^18.3.0`, `three ^0.165.0`, `zustand ^4.5.0`, `immer`, `dxf-parser 1.1.2` and `mediabunny 1.61.0`. Dev dependencies are `vite ^5.4.0` and `vitest ^2.1.9`. There is no `@react-three/fiber`, `postprocessing` or `three-gpu-pathtracer`. — [aquaflow/frontend/package.json](aquaflow/frontend/package.json)
- Post-processing uses three.js's own `examples/jsm` passes: `EffectComposer`, `UnrealBloomPass` and `RoomEnvironment`. — [FE/components/preview/FountainScene_v6.js:69-82](aquaflow/frontend/src/components/preview/FountainScene_v6.js)
- The renderer is `THREE.WebGLRenderer` with sRGB output, `PCFSoftShadowMap` and ACES Filmic tone mapping at exposure 2.1 × tier exposure. There is no WebGPU renderer. — [FountainScene_v6.js:1735-1746](aquaflow/frontend/src/components/preview/FountainScene_v6.js)
- The desktop shell is `aquaflow-studio-desktop` v1.2.31, with `electron ^33.2.0`, `electron-builder ^25.1.8` and `electron-updater`. Its entry file is `main.js`, with `preload.js`, `cad-native.js` and `ui-server.js` alongside. — [DESK/package.json](aquaflow/desktop/package.json)
- The backend runs FastAPI (`app = FastAPI(` at line 404), uvicorn, pydantic 2 and numpy. **ezdxf is not a runtime dependency**, and no backend Python file imports ezdxf. — [BE/main.py:404](aquaflow/backend/main.py); [BE/requirements.txt](aquaflow/backend/requirements.txt)
- `App.jsx` lazy-loads 34 panels, including `EngineeringToolsPanel` (line 28) and `PoolGeometryDesigner` (line 44). — [FE/App.jsx:28,44](aquaflow/frontend/src/App.jsx)
- These are the largest frontend files:

  | File | Lines |
  |---|---|
  | `FountainScene_v6.js` | 4,387 |
  | `PoolGeometryDesigner.jsx` | 4,345 |
  | `ShowProgrammerPanel.jsx` | 4,061 |
  | `PreviewPanel_v5.jsx` | 1,166 |
  | `usePipeDrawing.js` | 842 |
  | `sceneEditor.js` | 655 |
  | `cadExchange.js` | 414 |

  Source: `wc -l` over FE.
- Key directories:
  - `FE/engineering/` holds `cadExchange.js`, `cadDxfTemplate.js`, `poolGeometry.js`, `siteSurfaces.js`, `pipeworkEngine.js`, `hydraulicEngine.js`, `hydraulicAdapter.js`, `bomEngine.js`, `engineeringHistory.js`, `engineeringProject.js`, `fixtureSymbols.js`, `geometryContract.js` and `usePipeDrawing.js`.
  - `FE/components/preview/` holds the renderer modules plus `editor/`, which contains `sceneEditor.js`, `sceneGraph.js`, `sceneHistory.js`, `transformGizmo.js`, `editorSnapping.js`, `fixtureBridge.js` and `ui/workspaceUI.jsx`.
  - `FE/export3d/` holds the glTF, OBJ, USD, FBX and LuxExchange exporters.
  - `FE/rendering/` holds `index.js`, `reflections.js`, `sceneModes.js` and `waterPhysics.js`.
  - `FE/environment/` holds materials and environments.
  - `BE/services/` holds about 60 services.
  - `BE/api/routes/` holds the routes.

  Source: directory listings.
- The canonical status file reports Tier 4 "Design Studio" at 78% complete and overall maturity at 7.7/10. The active roadmap is the AF-HUB Tier A hardening series. — [AQUAFLOW_STATUS_CANONICAL.md §1-2](AQUAFLOW_STATUS_CANONICAL.md)

### Inferences
- With raw three.js and no React renderer, any CAD-like 3D editing has to extend the imperative `SceneEditor`/`SceneGraph` classes. A move to r3f would mean a rewrite.
- three.js r165 is old for October 2026. WebGPURenderer and TSL compute, the natural route to 1M particles, need a three.js upgrade. That upgrade carries regression risk across the many shader modules.
- Both editors exceed 4,000 lines. Any CAD-tool work should first extract a 2D drafting kernel (entities, snapping, commands, selection) out of `PoolGeometryDesigner.jsx`. This mirrors Phase 0 of `SHOW-PROGRAMMER-REDESIGN-PLAN.md`, which splits the 4,061-line programmer.

### Gaps
- I did not read `DESK/main.js` or `ui-server.js` in detail, so the window/IPC setup beyond the CAD handlers is unverified.
- I did not open `vite.config.js` to check chunking.

## Engineering design module: files, tools, and the gap to AutoCAD-style editing

### Takeaway
The engineering designer is a single 2D HTML-canvas React component, `PoolGeometryDesigner.jsx`. It covers a lot of ground:
- pool shapes, freeform polylines, land surfaces, depth zones, nozzle/light/equipment placement and arrays
- manual pipes with orthogonal mode and fixture snapping
- measure, fixed layers, auto dimensions, and undo/redo using snapshot history

A separate 3D scene editor provides move/rotate/scale gizmos with grid and angle snapping. Engineering calculations live in solid backend services: a GGA network solver, pipe sizing, pump curves, a nozzle database, BOM, P&ID and engineering-package ZIP export.

Against AutoCAD the designer lacks:
- object snaps, polar tracking and typed or relative coordinate input
- multi-select, window or crossing selection, and grouping
- move/copy/rotate/mirror/scale/offset/trim/extend/fillet commands
- user-defined layers, blocks, hatches, associative dimensions, and a command line

### Cited Findings
**2D editor (`FE/components/panels/PoolGeometryDesigner.jsx`)**
- The header says the component handles "Draw any pool shape (circular, rectangular, freeform, multi-basin)", depth zones, walls, and nozzle/light placement. — [PoolGeometryDesigner.jsx:1-9](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- The tool list is select, rectangle, circle, polyline, land, pipe, nozzle, light, equipment, depth, measure and delete. — [PoolGeometryDesigner.jsx:249-262](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- Layers are a **fixed set of 9**: POOL OUTLINE, WATER SURFACE, LANDSCAPE, NOZZLES, LIGHTS, EQUIPMENT, MEASUREMENTS, ANNOTATIONS and PIPEWORK. Each has visible/locked flags. `mergeEngineeringLayers` maps saved layers back onto these defaults, so the user cannot create new layers. — [PoolGeometryDesigner.jsx:264-279](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- Rendering uses a `<canvas>` 2D context. View state is `zoom` (default 30 px/m) and `pan`. — [PoolGeometryDesigner.jsx:404-405,737](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- The minor grid is drawn every 1 m (`gridSpacing = zoom`) and the major grid every 5 m. Grid density does not adapt to zoom. — [PoolGeometryDesigner.jsx:751-775](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- Snapping is **grid-only**: `snapPoint` rounds to `gridStep`, which defaults to 0.5 m. There are no endpoint, midpoint, centre, intersection or perpendicular object snaps; a grep for `endpoint|midpoint|osnap|perpendicular` found nothing. — [PoolGeometryDesigner.jsx:436-437,1583-1590](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- The pipe tool is the exception. It snaps to fixture centres before grid. — [FE/engineering/usePipeDrawing.js:71-82](aquaflow/frontend/src/engineering/usePipeDrawing.js)
- **Single selection only.** `selectedFixture` is one array index (`useState(null)`), and separate single-value states hold the selected surface, vertex, pipe and node. There is no multi-select, window/crossing selection or Shift-add. — [PoolGeometryDesigner.jsx:398-400,1502](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- Dragging a fixture writes `Math.round(world.x*10)/10`. This always quantizes to 0.1 m, even with SNAP off. With SNAP on, the value is snapped to `gridStep` first and then rounded again. — [PoolGeometryDesigner.jsx:2063-2065](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- **Undo/redo** keeps whole-design snapshot history (`engineeringHistory.js`). Commits are debounced by 220 ms and cover geometry, fixtures, surfaces, pipes, layers, measurements, depth zones, hydraulics and array settings. Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z are bound. — [PoolGeometryDesigner.jsx:570-640,1350-1362](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- Ctrl+D duplicates the selected fixture or land surface, and Delete/Backspace deletes it. — [PoolGeometryDesigner.jsx:1403-1446,1495-1501](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- `applyFixtureArray` provides **arrays** in three modes: centerline, ring and grid (rows/cols/inset). Each is a one-shot generator, not an associative array. — [PoolGeometryDesigner.jsx:453-457,2436-2491](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- **Dimensions** are automatic, CAD-style overall width/length/diameter annotations drawn on the canvas. `showDimensions` toggles them. They cannot be placed or edited, and they are not associative entities. The Measure tool stores point-to-point measurement lines. — [PoolGeometryDesigner.jsx:978-1090,1258-1275,410-411](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- Pool shapes are rectangular, circular, elliptical and freeform, among others. Freeform pools come from polyline points (`setGeometry({type:"freeform", points, closed:true})`), and the rectangle has grips. — [PoolGeometryDesigner.jsx:77-82,1978,2098-2108,1592-1660](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- The status bar shows tool, cursor X/Y to mm precision, zoom, snap, draw state, layer count and the selection. — [PoolGeometryDesigner.jsx:4340](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- Land surfaces come in five types: grass, paving, soil, rock/gravel and sand. They support move, vertex edit and duplicate. — [FE/engineering/siteSurfaces.js:1-6](aquaflow/frontend/src/engineering/siteSurfaces.js)
- Pool geometry helpers cover area, perimeter, point-in-geometry, and depth-zone overlap and validation. — [FE/engineering/poolGeometry.js:11-195](aquaflow/frontend/src/engineering/poolGeometry.js)
- The client-side hydraulics were retired under AQ-S2-002. Head and pump figures show as "—" until the backend solver supplies them. — [PoolGeometryDesigner.jsx:15-24](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)
- `pipeworkEngine.js` auto-routes pipework using an MST, ring and tree layouts, orthogonal paths, elbow counting and DN selection by flow. — [FE/engineering/pipeworkEngine.js:28-147](aquaflow/frontend/src/engineering/pipeworkEngine.js)

**3D scene editor (`FE/components/preview/editor/`)**
- `sceneEditor.js` makes the 3D preview editable. It supports pick, highlight, gizmo move/rotate, exact numeric entry, duplicate, delete, and drop from library. Navigation follows Depence: scroll zoom, Alt-orbit and right-drag pan. — [sceneEditor.js:1-19](aquaflow/frontend/src/components/preview/editor/sceneEditor.js)
- Snapping in `editorSnapping.js` is Shift for a 10 cm grid and 5° rotation steps, with Alt to suspend. Tools are SELECT, MOVE, ROTATE and SCALE, and the module also does axis constraint and dominant-axis lock. — [editorSnapping.js:6-35,134-140](aquaflow/frontend/src/components/preview/editor/editorSnapping.js)
- On 2026-10-09 the 3D viewport was synchronized with the Engineering Designer. The work added an inverse world-to-engineering transform, atomic scene-graph transactions and preserved camera/selection. The frontend suite stood at 603 tests passing. — [CURRENT_STATUS.md:238-253](CURRENT_STATUS.md)

**Backend engineering services (`BE/services/`)**
- `hydraulic_solver.py` (511 lines, AQ-S2-001) is a steady-state network solver using the Global Gradient Algorithm (Todini & Pilati, the EPANET method). It handles branched and looped networks. — [BE/services/hydraulic_solver.py:1-12](aquaflow/backend/services/hydraulic_solver.py)
- `pipe_sizing.py` (AQ-S2-003) sizes pipes by a velocity band. — [BE/services/pipe_sizing.py](aquaflow/backend/services/pipe_sizing.py)
- `nozzle_database.py` (AQ-S2-005) models nozzles with Q = K√P. — [BE/services/nozzle_database.py](aquaflow/backend/services/nozzle_database.py)
- `pump_curve.py` (AQ-X-006) fits H–Q curves and finds the duty point. — [BE/services/pump_curve.py](aquaflow/backend/services/pump_curve.py)
- `bom_generator.py` (AQ-S2-009) produces a costed BOM with a self-contained XLSX writer. — [BE/services/bom_generator.py](aquaflow/backend/services/bom_generator.py)
- `pid_generator.py` (AQ-S2-007) draws ISA-5.1 P&ID as SVG. — [BE/services/pid_generator.py](aquaflow/backend/services/pid_generator.py)
- `geometry_service.py` handles pool-geometry persistence. — [BE/services/geometry_service.py](aquaflow/backend/services/geometry_service.py)
- The engineering package (AQ-X-010) is a ZIP containing a cover PDF, DXF, BOM XLSX, P&ID SVG, dependency graph, hydraulics JSON and a manifest. It is served by `POST /api/engineering/package` and `/package.zip`. — [BE/services/engineering_package.py:1-12](aquaflow/backend/services/engineering_package.py); [BE/api/routes/engineering_routes.py](aquaflow/backend/api/routes/engineering_routes.py)
- `bom_routes.py` (64 lines) exposes the BOM generator. — [BE/api/routes/bom_routes.py](aquaflow/backend/api/routes/bom_routes.py)

### Inferences
- **Missing compared with AutoCAD-style editing:**
  - object snaps and snap tracking
  - polar/ortho tracking for general drawing (ortho exists only in the pipe tool)
  - typed absolute, relative and polar coordinates, and a command line
  - multi-selection with window/crossing/lasso, selection filters and quick-select
  - groups and blocks
  - user layers with colour, linetype and lineweight
  - modify commands: move/copy by base point, rotate, scale, mirror, offset, trim/extend, fillet/chamfer, join/explode, stretch and align
  - associative arrays
  - placed and associative dimensions (linear, aligned, radial, angular)
  - text/MTEXT editing, hatches/fills, curve entities (arcs, splines and bulged polylines in the basin outline)
  - properties palette for multiple selections, and paper-space layouts or plot/print with title block
  - xref or underlay of an imported DWG as a locked background
  - zoom-adaptive grid
- The data model holds one `geometry` per project, a single pool outline, which limits true multi-basin, island, cascade or weir layouts. The header claims "multi-basin", but no multi-basin structure was visible in the state.
- Two snapping systems now exist: the 2D designer's 0.5 m `gridStep` and the 3D editor's 10 cm Shift-snap. A CAD plan should unify them in one snapping and command kernel shared by 2D and 3D.

### Gaps
- I did not read `EngineeringToolsPanel.jsx` (226 lines), `PipePropertiesPanel.jsx` or `InspectorPanel.jsx`, so the full properties-panel coverage is unverified.
- "Walls" are claimed in the header but not verified. Wall height and thickness editing may only be the pool depth parameter.
- I did not verify whether the 2D designer supports rotating a fixture's facing direction. A `rotation` field is exported to DXF, but no rotate tool appears in the TOOLS list.

## 3D rendering: water, particles, lights, surface, environment, post-processing, performance, known issues

### Takeaway
The preview has gone through the AF-3D realism programme, phases R1–R3 plus AF-3D-012/013:
- soft particles, billboard droplets and sprite textures
- sky dome, starfield and matched IBL
- volumetric beam cones
- GPU ping-pong particle simulation: 131k water + 66k spray on medium, 262k + 131k on high
- Gerstner waves with planar reflection, analytic refraction, floor caustics, impact ripples, and a coupled heightfield (Water Realism V2)
- procedural PBR stone and tile
- Bloom/GTAO/SMAA post-processing and a performance HUD

The remaining planned items:

| Task | Phase | Item |
|---|---|---|
| AF-3D-008 | R2 | half-resolution particle pass |
| AF-3D-013 (plan numbering) | R4 | instanced glTF fixture models |
| AF-3D-014 | R4 | venue backdrops |
| AF-3D-015 | R4 | shadow fit/CSM |
| AF-3D-016 | R5 | god rays, motion blur, DoF |
|   | (plan) | `ultra` tier |

Known structural issues:
- Particle collision, splash containment and heightfield masks treat every non-circular pool as an axis-aligned rectangle, so freeform basins are wrong in physics.
- Freeform pool meshes were mirrored until the most recent commit.

### Cited Findings
- **Quality tiers** are set in `QUALITY_CONFIG`:

  | Tier | Pixel ratio | Shadows | Post-FX | Bloom | SMAA | AO | Reflection | GPU particles |
  |---|---|---|---|---|---|---|---|---|
  | low | 1.0 | no | none | none | no | no | none | CPU path |
  | medium | 1.5 | yes | yes | 0.20 | no | no | 512 px, every 2nd frame | 131,072 water / 65,536 spray |
  | high | 2.0 | yes | yes | 0.29 | yes | yes (GTAO) | 1024 px | 262,144 water / 131,072 spray |

  Medium and high also enable soft depth, cones and stars. — [FountainScene_v6.js:137-155](aquaflow/frontend/src/components/preview/FountainScene_v6.js)
- **CPU particle caps** are `MAX_WATER 60000`, `MAX_SPRAY 22000`, `MAX_FOAM 6000`, `MAX_FLAME 3000` and `MAX_FOG 2000`. When the GPU field is active, the CPU field runs invisibly at a 1/16 sample (`CPU_SAMPLE_FRACTION`) to keep the splash/spill litres-per-minute calibration. — [FountainScene_v6.js:157-167,713-717](aquaflow/frontend/src/components/preview/FountainScene_v6.js)
- Other limits are `MAX_FIELD_LIGHTS = 16` (the RGB light field consumed by all shaders), `MAX_GPU_EMITTERS = 96` and `MAX_RIPPLES = 8`. — [FountainScene_v6.js:122-128](aquaflow/frontend/src/components/preview/FountainScene_v6.js)
- **GPU simulation** (`particlesGPU.js`, AF-3D-007) uses RGBA32F posLife/velLife ping-pong render targets, a static meta texture and a 6-row emitter DataTexture. It runs two fullscreen passes, velocity then position, both through a shared `simulate()`. It needs WebGL2 and `EXT_color_buffer_float`. — [FE/components/preview/particlesGPU.js:1-35,363-380](aquaflow/frontend/src/components/preview/particlesGPU.js); [CURRENT_STATUS.md:686-724](CURRENT_STATUS.md)
- `nozzleEmitters.js` (AF-3D-006) reduces the 17 nozzle types to 5 emission primitives: CONE, RING, FAN, CASCADE and MIST. — [CURRENT_STATUS.md:701-706](CURRENT_STATUS.md)
- **The GPU collision uniform is circular-or-rectangle only:** `uPool.set(pool.type === "circular" ? 1 : 0, radius, width, length)`. — [particlesGPU.js:546-551](aquaflow/frontend/src/components/preview/particlesGPU.js)
- `_poolBoundsForSplash()` returns `circular` with a radius, or **`rect` with `_poolW/_poolL` for every other type**. The same object feeds GPU `step()` and the CPU `impactSink`/`poolBounds`. — [FountainScene_v6.js:2035-2056,3604-3618](aquaflow/frontend/src/components/preview/FountainScene_v6.js)
- The `WaterHeightField.setPool` mask also tests only circular, else rectangle. It defaults to a 32 m extent, with resolution 96, 72 or 48 by tier. — [FE/components/preview/waterHeightField.js:10-45](aquaflow/frontend/src/components/preview/waterHeightField.js); [FountainScene_v6.js:1933](aquaflow/frontend/src/components/preview/FountainScene_v6.js)
- **Recent fix d92c329** (2026-10-12) addressed freeform water, floor and deck meshes that were mirrored against walls and fixtures. Flat meshes use `rotation.x = -PI/2`, which maps local y to world −z, while walls and fixtures map plan y to world +z. The new `toShapePlane()` negates y before `Shape`/`Path` construction in `poolShapeGeometry`, `polygonWaterGeometry` and `basinOpening`, and a raycast test was added. — `git show d92c329`; [FE/components/preview/basinGeometry.js:39-116](aquaflow/frontend/src/components/preview/basinGeometry.js)
- **Post-processing chain:** RenderPass → [GTAO] → OutputPass (tone mapping and sRGB) → UnrealBloomPass with display-referred threshold 0.82 → cinematic camera-response shader (vignette, chromatic aberration, grain) → [SMAA]. Bloom deliberately runs after tone mapping because pre-tonemap bloom washed out night scenes. IBL is PMREM from `RoomEnvironment`. Quad view bypasses the composer. — [FountainScene_v6.js:2358-2444,2118](aquaflow/frontend/src/components/preview/FountainScene_v6.js); [AF-3D-REALISM-PLAN.md §1](AF-3D-REALISM-PLAN.md)
- **Water surface:**
  - 4-wave Gerstner, GGX specular, Schlick fresnel and Beer-Lambert absorption
  - planar reflection probe with oblique clipping (`waterReflection.js`)
  - AF-3D-009 refraction by analytic ray/basin-plane intersection, with no second scene pass
  - AF-3D-010 caustics projected to the floor, and ripple rings seeded from impact events and rate-limited to about 9/s
  - Water Realism V2 coupled heightfield, damped shallow water fed by real impacts

  — [CURRENT_STATUS.md:651-662,264-281](CURRENT_STATUS.md); [FE/components/preview/waterReflection.js:1-20](aquaflow/frontend/src/components/preview/waterReflection.js); [waterHeightField.js:1-9](aquaflow/frontend/src/components/preview/waterHeightField.js)
- **Environment and materials:**
  - `skyDome.js` provides a sky dome, starfield and matched IBL (AF-3D-004).
  - `lightCones.js` provides volumetric beams (AF-3D-005).
  - `groundTextures.js` generates procedural canvas PBR (albedo, normal, roughness from one seeded height field) with no binary assets (AF-3D-012).
  - `splashMap.js` keeps a 128² wetness/containment overlay.
  - `modelLibrary.js` loads venue glTF/GLB models (people, buildings, trees under `/models/venue/*.glb`) with `GLTFLoader` and allows **user .glb import only** ("Export from Blender as glTF Binary (.glb)").

  — [CURRENT_STATUS.md:751-785,726-749](CURRENT_STATUS.md); [FE/components/preview/modelLibrary.js:1-17,57-80,158](aquaflow/frontend/src/components/preview/modelLibrary.js)
- **Measured performance** (AF-3D-013 HUD, `getPerfStats()`): medium runs 343 draw calls and 814k triangles, high 528 draws, low 199. AF-3D-012 was verified at 60 fps on the user's GPU. — [CURRENT_STATUS.md:643-650,749](CURRENT_STATUS.md)
- **Bugs already fixed in this history**, useful to know as regression areas:
  - "Striped water" was caused by wall box UV tiling at 16 × 0.4.
  - Gerstner waves were one-dimensional because they read local XY with z = 0.
  - The water normal was computed in view space instead of world space.
  - Circular pools used `CircleGeometry`, which has no interior vertices to displace.
  - The circular coping torus stood vertically as an arch.

  — [CURRENT_STATUS.md:663-684,739-746](CURRENT_STATUS.md)
- **Realism plan remaining items.** The plan states that `FountainScene_v6.js` "must not grow" and should become an orchestrator. It proposes an `ultra` tier and 500k–1M particles; R2 currently delivers about 200k. Open items are AF-3D-008, plan AF-3D-013 (instanced glTF fixture models, which replace stub cylinder nozzles and circle-marker lights), AF-3D-014, AF-3D-015 and AF-3D-016. Note the ID collision: the plan's AF-3D-013 is "instanced glTF fixture models", but the shipped AF-3D-013 was the performance HUD. — [AF-3D-REALISM-PLAN.md §3-4](AF-3D-REALISM-PLAN.md); [CURRENT_STATUS.md:643](CURRENT_STATUS.md)
- **Fixtures in 3D.** The plan names "No instancing, no real fixture models — nozzles are stub cylinders, lights are circle markers" as a gap. `fixtureModels.js` (312 lines) now exists. — [AF-3D-REALISM-PLAN.md §1 gap 8](AF-3D-REALISM-PLAN.md)

### Inferences
- **Likely bug: freeform/polygon basins use rectangular physics.** Any non-circular pool is reduced to a width × length rectangle for GPU particle collision, CPU splash containment and the heightfield mask. For L-shaped, kidney or irregular basins imported from CAD, droplets will land on, or bounce off, an invisible rectangle. Spill litres per minute, which the code calls a commissioning figure, will be wrong, and ripples can appear on deck outside the polygon. The likely fix is a rasterized basin mask texture shared by GPU collision, splash map and heightfield.
- Whether the rectangle is centred on the polygon's bounds or its centroid was not checked, so an offset error is also possible after d92c329.
- `FountainScene_v6.js` has grown from 3,450 lines (per the plan) to 4,387 despite the "must not grow" guardrail.
- A three.js upgrade is the gating decision for WebGPU, TSL compute and 1M particles. Staying on WebGL2 FBO ping-pong can reach about 500k at most, which is the plan's own target.

### Gaps
- I did not inspect `fixtureModels.js` to see how much of plan AF-3D-013 (instanced glTF fixtures) is already done.
- I found no recorded FPS figures for high tier with a large show, such as 300 fixtures.
- I did not determine whether shadows are fitted to pool bounds yet (AF-3D-015).

## CAD exchange: what exists for DXF/DWG import and export, and 3D formats

### Takeaway
A substantial AutoCAD round-trip already exists. It was built on 2026-09-17 to 24 and documented in `AUTOCAD-DESIGN-EXCHANGE.md`.
- **Frontend `cadExchange.js`** parses ASCII DXF with `dxf-parser`, maps layers to roles, converts units, handles blocks and INSERTs, and previews and applies the import with fixture-ID matching. It exports an ezdxf-templated AC1015 DXF with AQUAFLOW XDATA.
- **Electron `cad-native.js`** converts DWG↔DXF headlessly through the installed AutoCAD 2018+ `accoreconsole.exe` or the ODA File Converter.
- **Backend `cad_layout.py`** writes a separate, older R12 DXF for the engineering package.

The scope is limited:
- 2D model space only, 10 MB cap, ASCII DXF only
- no SPLINE, HATCH, DIMENSION, 3D solids or meshes, or paper space
- fixtures are point markers only
- site land surfaces and venue models are neither exported nor imported
- no IFC, and no 3D CAD import (OBJ, FBX, STEP)

There are two divergent DXF writers.

### Cited Findings
**User-facing behaviour** (`AUTOCAD-DESIGN-EXCHANGE.md`)
- Export writes "a genuine AutoCAD 2018-format DWG". It contains the basin outline, nozzle/light/equipment markers, names, manual pipework, depth zones and measurements. It excludes control commands, wiring, show data and any "3D AutoCAD model". Fixture circles are position markers. — [AUTOCAD-DESIGN-EXCHANGE.md:3-12](AUTOCAD-DESIGN-EXCHANGE.md)
- Import accepts `.dwg` or `.dxf` up to 10 MB in 2D model space. Binary DXF is not supported. Supported units are m, mm, cm, in and ft, plus explicit units for unitless drawings. The modes are "Update current design" (keeps control settings when fixture IDs match) and "Create a new design". Layers are mapped to purposes, with unknown layers set to Ignore. The user picks a pool boundary from closed outlines and can toggle "Invert CAD Y". The import replaces manual pipes, depth zones and measurements and sends no hardware commands. — [AUTOCAD-DESIGN-EXCHANGE.md:14-29](AUTOCAD-DESIGN-EXCHANGE.md)
- The layer convention is POOL_OUTLINE, NOZZLES, LIGHTS, EQUIPMENT, PIPEWORK, DEPTH_ZONES, MEASUREMENTS and ANNOTATIONS. On fixture layers, each block counts as one fixture at its insertion point. Curves are approximated by straight segments. Paper space, meshes, solids and tilted or reversed-extrusion entities are skipped. The user must convert splines to polylines. Duplicate fixture IDs are rejected. — [AUTOCAD-DESIGN-EXCHANGE.md:31-45](AUTOCAD-DESIGN-EXCHANGE.md)

**Frontend parser and exporter** (`FE/engineering/cadExchange.js`, 414 lines)
- It exports `CAD_MAX_BYTES`, `CAD_UNITS` and `CAD_ROLES` (ignore, pool, nozzle, light, equipment, pipe, depth, measurement), along with `parseCadDxf` (reads `$INSUNITS`), `previewCadImport`, `applyCadImport` and `exportCadDxf`. — [cadExchange.js:8-16,121-139,277,339,374](aquaflow/frontend/src/engineering/cadExchange.js)
- `flatten()` composes INSERT transforms, skipping recursive or deeply nested blocks (more than 8 levels). It skips non-planar entities and approximates bulges, arcs and ellipses. Any other entity types on mapped layers are reported as unsupported. — [cadExchange.js:181-256](aquaflow/frontend/src/engineering/cadExchange.js)
- The supported entity set is LINE, LWPOLYLINE, POLYLINE, VERTEX, SEQEND, CIRCLE, ARC, ELLIPSE, POINT, TEXT, MTEXT, INSERT and ATTRIB. There is no SPLINE, HATCH, DIMENSION, SOLID, 3DFACE, REGION or LEADER. — [cadExchange.js:286-287](aquaflow/frontend/src/engineering/cadExchange.js)
- Fixtures are imported only from CIRCLE, POINT or INSERT anchors. Duplicates at the same layer and position are collapsed. — [cadExchange.js:299-305](aquaflow/frontend/src/engineering/cadExchange.js)
- `exportCadDxf` writes LWPOLYLINE, CIRCLE, ELLIPSE, LINE and TEXT with **y negated** (`20, -p.y`) and XDATA metadata through `encodeMetadata`. Fixture symbols are 0.12 m circles. It writes no land surfaces, walls, deck, dimensions or hatches. — [cadExchange.js:374-414](aquaflow/frontend/src/engineering/cadExchange.js)
- The header and footer come from `cadDxfTemplate.js`: a canned AC1015 (AutoCAD 2000) database "generated with ezdxf 1.4.4" with the 8 AquaFlow layers, the AQUAFLOW APPID and `$INSUNITS 6` (metres). — [FE/engineering/cadDxfTemplate.js:1-3](aquaflow/frontend/src/engineering/cadDxfTemplate.js)
- `cadExchange.test.js` (167 lines) holds the tests. — [FE/engineering/__tests__/cadExchange.test.js](aquaflow/frontend/src/engineering/__tests__/cadExchange.test.js)
- The import UI is `CADImportDialog.jsx` (155 lines). It has an SVG preview of the boundary, pipes and fixtures; unit, flip-Y and mode controls; per-layer role and fixture-type mapping; a depth field; and `accept=".dxf,.dwg"`. — [FE/components/panels/CADImportDialog.jsx:1-40,87](aquaflow/frontend/src/components/panels/CADImportDialog.jsx)
- The designer imports `CADImportDialog` and `exportCadDxf`. — [PoolGeometryDesigner.jsx:33-34](aquaflow/frontend/src/components/panels/PoolGeometryDesigner.jsx)

**Native DWG conversion** (`DESK/cad-native.js`)
- `findCadEngines()` looks for `Autodesk/AutoCAD 20xx/accoreconsole.exe` (2018 or later) and `ODA/*/ODAFileConverter.exe`. `AQUAFLOW_ACCORECONSOLE` and `AQUAFLOW_ODA_CONVERTER` override the paths. — [aquaflow/desktop/cad-native.js:13-40](aquaflow/desktop/cad-native.js)
- The AutoCAD path writes a LISP `.scr` that counts model-space entities, then runs `SAVEAS 2018` or `DXFOUT` (16 decimal places). It fails if zero entities load. The ODA path runs `ACAD2018`. Output is validated: DWG must start with `AC10xx`, and export requires `AC1032`. DXF must be complete ASCII and not binary. — [cad-native.js:46-120](aquaflow/desktop/cad-native.js)
- The conversion limits are 10 MB, a 90 s timeout, and a single-job lock (`conversionBusy`). IPC handlers `cad:capabilities`, `cad:export-dwg` and `cad:import-dwg` use a sender check. — [cad-native.js:9-11,122-150](aquaflow/desktop/cad-native.js)

**Backend legacy DXF** (`BE/services/cad_layout.py`, AQ-X-009)
- It writes a dependency-free R12 (AC1009) ASCII DXF with a LAYER table, circles, lines, text and points. It is served by `POST /api/cad/layout` (JSON) and `/api/cad/layout.dxf`, and the engineering-package ZIP uses it. — [BE/services/cad_layout.py:17-238](aquaflow/backend/services/cad_layout.py); [BE/api/routes/cad_routes.py](aquaflow/backend/api/routes/cad_routes.py); [CURRENT_STATUS.md:1832-1849](CURRENT_STATUS.md)

**3D export** (`FE/export3d/`, AQ-X-016)
- `exportScene(design, formatId)` supports glTF, GLB, OBJ+MTL, USD (USDA), FBX ASCII and the LuxExchange envelope (for LuxuryForm/LuxuryScape). It builds from the engineering design (pool + fixtures), not from the live three.js scene. — [FE/export3d/index.js:1-30](aquaflow/frontend/src/export3d/index.js)
- The UI is `Export3DPanel.jsx` (149 lines). — [FE/components/panels/Export3DPanel.jsx](aquaflow/frontend/src/components/panels/Export3DPanel.jsx)

### Inferences
- **Divergent writers.** The frontend export is AC1015 with XDATA and the layer convention, Y negated. The backend `cad_layout.py` is R12 with its own layers and is used in the engineering-package ZIP. A user can get two different DXFs of the same design. A plan should converge on one writer, likely an ezdxf backend or the frontend writer, and one layer standard.
- **Import gaps worth closing** for real AutoCAD site drawings:
  - SPLINE, which the user must currently convert by hand
  - HATCH boundaries as surfaces (land, paving)
  - DIMENSION ignored
  - Binary DXF
  - xref/underlay display of the full drawing as a locked background, since today only mapped layers survive
  - multiple basins/islands, since there is one boundary candidate
  - walls, steps and levels (Z/elevation)
  - site land surfaces, which neither direction carries
  - more than 10 MB, since real site plans often exceed it
  - DWG import without AutoCAD or ODA installed. There is no pure-JS or WASM DWG reader, such as LibreDWG or the ODA Web SDK, so DWG import fails on PCs without those tools.
- The import parser runs on the main thread with `dxf-parser` 1.1.2 and a hand-written tag scan (`attachRawCadHints`). Large drawings could block the UI. A Web Worker would help.
- 3D formats exist only for **export**. Venue import is GLB-only. There is no IFC, STEP, OBJ or FBX import of architectural or civil 3D context.

### Gaps
- I did not verify whether `applyCadImport` geometry is re-centred to match the 3D `centeredPoolPoints()` convention. Coordinate-frame mismatches (CAD +Y up, plan +Y down, 3D −Z) are a known bug class here, as d92c329 shows.
- I did not run the CAD tests or the app, so all behaviour is from code and docs only.
- I found no recorded field results of importing a third-party (non-AquaFlow) AutoCAD site drawing.

## Roadmap context and task-ID conventions to align with

### Takeaway
Several ID families coexist:
- **AQ-S{stage}-{nnn}**: original stages, e.g. AQ-S2-001 hydraulic solver, AQ-S3-004 rendering engine
- **AQ-X-nnn**: recovery, e.g. AQ-X-009 CAD layout, AQ-X-016 3D export
- **AF-HUB-nnn**: the canonical Tier A hardening plan, 20 of 26 code tasks done
- **AF-3D-nnn**: the realism plan
- **AF-IO-nnn** and **AF-ICAN-nnn**: field I/O and I-CAN work
- **AQ-FIX-nnn**: fixes

There is no existing CAD-editing or CAD-import task series. New work would fit a new prefix, for example AF-CAD-nnn, following the AF-3D and AF-IO pattern. Rendering follow-ups should continue AF-3D-008 and AF-3D-014 to 016, and resolve the AF-3D-013 ID collision.

### Cited Findings
- `CLAUDE.md` says task IDs must match the roadmap exactly, giving `AQ-S1-002` as the example, because the LuxuryCon AI Command Hub reads `session-report.json`. — [CLAUDE.md](CLAUDE.md)
- The canonical status supersedes the old 65-task roadmap with the AF-HUB series. Open items are AF-HUB-017 (in progress), AF-HUB-018 (queued), AF-HUB-009 (independent review), AF-HUB-011 (on-site bench) and AF-HUB-012 (sign-off). Tier A readiness is about 55%, and hardware output remains UNVERIFIED. — [AQUAFLOW_STATUS_CANONICAL.md:1-95](AQUAFLOW_STATUS_CANONICAL.md)
- `AF-3D-REALISM-PLAN.md` (dated 2026-09-05) defines AF-3D-001 through AF-3D-016 across phases R1 to R5, about 6–8 weeks in total. R1, R2 (except AF-3D-008), R3 and AF-3D-012/013 shipped by 2026-09-07. — [AF-3D-REALISM-PLAN.md §4](AF-3D-REALISM-PLAN.md); [CURRENT_STATUS.md:639-785](CURRENT_STATUS.md)
- The most recent status entries (2026-10-08 to 10-09) cover:
  - Siemens setup wizard and device model, release 1.2.21
  - Engineering ↔ 3D viewport sync
  - unified `.aqua` project document (engineering geometry, show, timeline, render settings, Siemens site) and Water Realism V2

  The frontend suite then stood at 644 tests passing across 63 files. — [CURRENT_STATUS.md:1-60,238-281](CURRENT_STATUS.md)
- `SHOW-PROGRAMMER-REDESIGN-PLAN.md` phases:
  - Phase 0 splits the 4,061-line component and adds characterization tests.
  - Phase 1 adds a full-screen shell and Engineering inventory. Acceptance: a 320-item Engineering project stays responsive.
  - Phases 2–6 cover groups, recipes, timeline, AI and QA.

  It insists on "one engineering source of truth" (§5.1). — [SHOW-PROGRAMMER-REDESIGN-PLAN.md:207-232](SHOW-PROGRAMMER-REDESIGN-PLAN.md)
- `SITE-ICAN-DESIGN-TEST-GUIDE.md` describes the 3D preview of Site I-CAN patterns. The site project is "4KILO Site Fountain - 7 Pump Corrected" with 64 mapped valves. Heights are "illustrative, not calibrated", and the preview sends no hardware requests. — [SITE-ICAN-DESIGN-TEST-GUIDE.md:1-7,170-192](SITE-ICAN-DESIGN-TEST-GUIDE.md)

### Inferences
- A CAD/rendering plan must preserve the project's honesty and safety invariants:
  - CAD import sends no hardware commands.
  - Fixture-ID matching keeps hardware addresses, and the importer refuses to guess on duplicate IDs.
  - The splash litres-per-minute engineering figure must not be altered by rendering changes.
- The real site (64 valves, 7 pumps, 300+ item projects in the Show Programmer plan) sets a scale target for both the CAD editor and the renderer.

### Gaps
- I found no roadmap entry or acceptance criteria for "CAD-like editing" or richer AutoCAD import beyond the September exchange work. It appears not to be planned yet.
- `CURRENT_STATUS.md` has no record of whether the d92c329 freeform fix has been packaged or installed.
