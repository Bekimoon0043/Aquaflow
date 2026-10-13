# Turn AutoCAD drawings into living fountains

**Bottom line.** AquaFlow already has most of an AutoCAD round-trip, but it delivers less than it could. A frontend DXF parser, a DWG bridge through the user's own AutoCAD or ODA install, and an XDATA-tagged exporter all exist. They only work on clean, AquaFlow-shaped 2D drawings. The real design does not reach the 3D view, because only mapped layers survive import. Freeform basins also run on rectangular physics. The fastest route to "see the real design in 3D" has three parts:

1. **Fix the physics bug.** Particle collision, splash containment and the water heightfield treat every non-circular pool as an axis-aligned rectangle. Fix this first, because every imported CAD basin will hit it.
2. **Move parsing to the backend.** Normalise drawings with ezdxf. Then send the whole drawing as a locked underlay, plus recognised fountain components, to both the 2D designer and the 3D scene.
3. **Generate 3D from a component library.** Fountain DWGs are overwhelmingly 2D plan symbols with tags and schedules, so AquaFlow should build the 3D from its own library rather than wait for 3D CAD.

DWG reading stays licence-bound. No free, permissive, redistributable DWG reader exists, so the plan keeps DXF and the user's own AutoCAD as the default. ODA tooling is gated behind a licensing decision. LibreDWG is ruled out for linking, and Autodesk's cloud service (APS) is an optional route for visual-only meshes. Rendering is already strong after the AF-3D programme. The next step-changes are the half-resolution particle pass, instanced fixture models and splitting up the 4,387-line scene file. After that comes a gated three.js upgrade that unlocks WebGPU, Forward+ lighting and about 1M particles. The 2D designer should borrow AutoCAD's precision tools: object snaps, polar tracking with typed lengths, grips and associative arrays. It should borrow SketchUp's always-on inference so novices never toggle modes. That work starts by pulling a drafting kernel out of the 4,345-line `PoolGeometryDesigner.jsx`. The phased plan below defines 45 tasks: new `AF-CAD-nnn` IDs, plus `AF-3D` IDs that continue the existing series without colliding with shipped ones.

> **Evidence conventions.** Codebase facts come from an audit at HEAD `d92c329` (2026-10-13), with uncommitted working-tree changes present. They are cited by repo-relative path; `FE` = `aquaflow/frontend/src`, `BE` = `aquaflow/backend`, `DESK` = `aquaflow/desktop`. External facts carry web citations. Text marked **[Inference]** is a design judgement, not a sourced fact. Text marked **[Unverified]** is an estimate or a claim that could not be confirmed this session, and should be checked before it is relied on. No task durations in this plan are measured. All effort figures are **[Unverified estimates]**.

## AutoCAD stores a handle-addressed database, not a picture

A DWG or DXF file is an object database, not a drawing in the visual sense. Graphical **entities** (LINE, CIRCLE, LWPOLYLINE, HATCH, INSERT, DIMENSION) are owned by BLOCK_RECORDs, and model space and paper space are themselves blocks (`*Model_Space`, `*Paper_Space`). The BLOCK_RECORD table is "the real owner of the layout entities", and each entity carries an owner handle in group code 330 ([ezdxf: Block Management](https://ezdxf.readthedocs.io/en/stable/dxfinternals/block_management.html)). Non-graphical objects live in a separate OBJECTS section: DICTIONARY, XRECORD, LAYOUT and GROUP. A layer is only "an attribute of a DXF entity, it's not an entity container" ([ezdxf: Entities](https://ezdxf.readthedocs.io/en/stable/concepts/entities.html)).

Reuse works through **block definitions instanced by INSERT**. An INSERT carries insertion point, scale and rotation, plus attached ATTRIB entities, which are tagged per-instance values that "can be evaluated and exported by CAD applications" ([ezdxf: Insert](https://ezdxf.readthedocs.io/en/stable/blocks/insert.html)). Application metadata rides in XDATA, or in XRECORDs hung off an entity's extension dictionary. XRECORDs are "similar in concept to XDATA but not limited by size or order" ([ezdxf: XRECORD](https://dokk.org/documentation/ezdxf/v1.1.4/dxfobjects/xrecord/)).

Three details of this model break naive importers, and AquaFlow's importer has to handle all of them:

- **Dynamic blocks are anonymous.** Their references point to `*U…` blocks whose name changes as soon as a dynamic property is edited. The original block is recovered through the INSERT's `ACAD_XDICTIONARY` → `AcDbBlockRepresentation` → `AcDbRepData` handle chain ([Autodesk blog](https://blog.autodesk.io/how-to-get-dynamic-block-from-anonymous-block/)). Autodesk added dynamic blocks as *undocumented* DXF entities, which other applications only preserve ([ezdxf: Blocks](https://ezdxf.readthedocs.io/en/stable/concepts/blocks.html)).
- **Planar entities live in their own coordinate system.** CIRCLE, ARC, TEXT, LWPOLYLINE and HATCH store points in an Object Coordinate System derived from an extrusion vector by the arbitrary-axis algorithm ([ezdxf: OCS](https://ezdxf.readthedocs.io/en/stable/concepts/ocs.html)). A mirrored block therefore arrives with extrusion (0,0,−1).
- **Units are a hint, not a guarantee.** `$INSUNITS` uses 0 for unitless, 4 for mm and 6 for m. `$MEASUREMENT` and `$LUNITS` do not change geometry, and no CAD application or ezdxf converts units implicitly ([ezdxf: DXF Units](https://ezdxf.readthedocs.io/en/stable/concepts/units.html)).

### Precision, not drawing tools, makes AutoCAD feel powerful

Most of AutoCAD's productivity comes from **precise point acquisition**, not from the drawing tools themselves:

- **Running object snaps.** Endpoint, Midpoint, Center, Intersection, Perpendicular, Tangent, Nearest, Insertion and more ([Autodesk: Object Snap](https://help.autodesk.com/cloudhelp/2017/ENU/AutoCAD-LT-MAC/files/GUID-A782462F-F85C-4496-85A5-3D9A54548489.htm)).
- **Snap tracking.** Alignment paths run from acquired points.
- **Polar tracking.** The cursor is held to angle increments such as 15°, 30° and 45° ([Autodesk: Drafting tab](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-LT/files/GUID-33A0F8E8-9981-4111-AD73-128B20D7975C.htm)).
- **Dynamic input.** Values are typed at the cursor, with Tab cycling between fields ([engineering.com](https://www.engineering.com/?p=51657)).
- **Multifunction grips.** Each grip offers context commands, for example a line endpoint offers stretch and lengthen ([Ascent](https://resources.ascented.com/ascent-blog/using-grips-in-autocad)).

Parametric constraints exist, but inference is **off by default** ([IMAGINiT](https://resources.imaginit.com/how-tos/how-to-turn-on-off-inferred-geometric-constraints-in-autocad)). They are an expert layer, not the core experience.

SketchUp takes the opposite route. Its inference engine is always on and cannot be toggled. It combines point snaps with dynamic guide lines, and Shift or the arrow keys lock an axis ([SketchUp forum](https://forums.sketchup.com/t/snapping-on-off/239136); [SketchUp forum](https://forums.sketchup.com/t/weird-inference/127254)). These SketchUp sources are forums, not official documentation.

Revit contributes the metadata model. Shared attributes belong in **type parameters** and per-placement values in **instance parameters** ([Novedge](https://novedge.com/blogs/design-news/revit-tip-revit-ifc-export-parameter-mapping-and-qa-best-practices)). Families map to IFC classes through `IFCExportAs` ([Autodesk](https://help.autodesk.com/cloudhelp/2022/ENU/RevitLT-DocumentPresent/files/GUID-7119A8C3-A0EE-4568-8C35-750410D867C9.htm)).

**[Inference]** For AquaFlow this suggests a split. Copy AutoCAD's snap vocabulary and typed entry for precision. Copy SketchUp's no-modes default for approachability. Copy Revit's family, type and instance split for fixture data.

### Fountain drawings are 2D symbols joined to schedules by tags

Fountain construction sets revolve around **equipment ID tags**. Tags link plan symbols to schedules for pumps, filters, lighting and controllers, and nozzles go in a "Miscellaneous" table ([Watershapes](https://watershapes.com/keys-to-consistency/)). Deliverables include several drawing types ([Waterline Studios](https://waterline.com/qualifications/design-services/construction-documentation/)):

- piping layouts coordinated with civil, MEP and landscape plans
- equipment-room plans
- hardware details
- a hydraulic P&ID with pipe dimensions
- electrical plans

A public GHESA fountain DWG shows the typical content: a 1:20 metric plan and section, plus an "elements table" listing nozzles with LEDs, pumps and valves ([DesignsCAD](https://designscad.com/downloads/ghesa-fountain-hydraulic-plan-section-cad-dwg/)). **No published fountain layer or block-naming standard was found.** The nearest convention is the NCS discipline prefix: L- for landscape, P- for plumbing ([USF layer guide](https://WWW.USF.EDU/administrative-services/documents/design-construction/guide-autocad-layers.pdf)).

Hydraulic sizing alongside the CAD is done with Bernoulli plus Darcy-Weisbach or Hazen-Williams and fitting K-factors. The usual tools are Excel workbooks and EPANET ([Safe Rain](https://saferain.com/en/blog/hydraulic-calculations-for-architectural-fountains/)).

Show and previs tools do not recognise fountain components from DWG:

- **Depence** links nozzle → valve → pump as "Dependencies" that drive its real-time hydrodynamics ([Syncronorm](https://syncronorm.com/products/depence2/visualization/fountains)). It imports DXF "Only 2D" and does not list DWG ([Depence formats](https://help.depence.com/depence-program-overview/depence-supported-file-formats/depence-supported-3d-model-import-formats.md)).
- **Capture** says outright it "is not able to do that automatically". Users drag library fixtures onto DWG blocks ([Capture forum](https://www.capture.se/Support/Forum/aft/8825)).
- **MVR.** The industry bridge for fixture identity and DMX patch is MVR (DIN SPEC 15801, current version 1.6), a zip of GeneralSceneDescription.xml plus GDTF fixture types ([MVR spec](https://github.com/mvrdevelopment/spec/blob/main/mvr-spec.md)).

**[Inference]** An importer that turns DWG blocks, attributes, tag text and schedule tables into linked AquaFlow devices would be a real differentiator. Those devices are nozzles, valves, pumps and lights, with pump groups and hardware addresses. Depence's own fountain module costs US$11,400 ([Pangolin](https://pangolin.com/products/depence-fountain-module)) and does not do this.

## Real-time renderers trade physical accuracy for a 16 ms budget

Offline renderers such as V-Ray, Cycles and Arnold path-trace each frame for seconds to minutes. Real-time engines rasterise triangles, shade them with PBR materials and image-based lighting, and then rely on a post-processing stack:

- ambient occlusion
- screen-space reflections
- bloom on HDR highlights
- temporal or morphological anti-aliasing
- a tone-mapping curve that compresses HDR into display range

Deferred shading is cheap with many lights but cannot light transparent surfaces. Forward+ bins lights into screen clusters and keeps transparency. That suits fountains, which are almost entirely translucent water and spray **[Inference, from background reference]** ([LearnOpenGL](https://learnopengl.com/Advanced-Lighting/Deferred-Shading)).

three.js has moved fast through 2026 ([utsubo](https://www.utsubo.com/blog/threejs-2026-what-changed)):

| Release | Date | What it added |
|---|---|---|
| r184 | Apr 2026 | FSR1 and TAAU upscaling nodes |
| r185 | Jun 2026 | Clustered (Forward+) lighting |
| r186 | Sep 2026 | `SunLight` with cascaded shadows |

`WebGPURenderer` falls back to WebGL2 automatically. Users also report scenes where it is *slower* than `WebGLRenderer`, so profiling is mandatory ([utsubo](https://www.utsubo.com/blog/threejs-2026-what-changed)).

Tone mapping is a real choice, not a detail. ACES Filmic can shift hues and wash out textures, while Khronos Neutral preserves hue ([three.js docs](https://threejs.org/docs/pages/global.html); [forum](https://discourse.threejs.org/t/acesfilmictonemapping-leading-to-low-contrast-textures/15484)).

For fountain water, the proven layers are:

- **Soft particles** that depth-fade at geometry intersections ([NVIDIA](https://developer.download.nvidia.com/whitepapers/2007/SDK10/SoftParticles_hi.pdf)).
- **Weighted-blended OIT**, which composites transparency without sorting in one geometry pass ([JCGT](https://www.jcgt.org/published/0002/02/09/paper.pdf)). three.js now ships it as `OITPassNode` ([three.js docs](https://threejs.org/docs/pages/OITPassNode.html)).
- **Screen-space radial "god rays"** ([GPU Gems 3 ch.13](https://developer.nvidia.com/gpugems/gpugems3/part-ii-light-and-shadows/chapter-13-volumetric-light-scattering-post-process)).

Scale numbers frame ambition. Forum GPGPU demos run 1–2M particles on WebGL ping-pong textures ([three.js forum](https://discourse.threejs.org/t/gpgpu-galaxy-particles/88937)). True SPH or FLIP fluid on WebGPU manages tens of thousands of particles at 60 fps ([jeantimex/fluid](https://gitblind.noratr.app/jeantimex/fluid)). **[Inference]** Show previs therefore wants deterministic ballistic particles, not fluid simulation. Depence's realism has been validated against video of a real installation ([Syncronorm](https://www.syncronorm.com/newsitem/van-phuc-city-fountain-created-with-depence-r3)), though its techniques are unpublished. The web's only practical path tracer, three-gpu-pathtracer, is progressive and WebGL2-based ([GitHub](https://github.com/gkjohnson/three-gpu-pathtracer)). **[Inference]** It is only good for paused beauty stills.

## AquaFlow's audit: strong foundations, a rectangle where the basin should be

**Stack.** The frontend is React 18, Vite 5 and Zustand. It uses raw three.js **r165**, with no react-three-fiber, no `postprocessing` library and no WebGPU (`aquaflow/frontend/package.json`). The backend is FastAPI with pydantic 2 and numpy. **ezdxf is not a dependency** (`BE/requirements.txt`). Electron 33 runs native DWG conversion (`DESK/cad-native.js`).

**Engineering designer.** The designer is a single 2D-canvas component, `FE/components/panels/PoolGeometryDesigner.jsx` (4,345 lines). It covers:

- rectangle, circle, polyline, land, pipe, nozzle, light, equipment, depth and measure tools
- snapshot undo/redo with a 220 ms debounce (`FE/engineering/engineeringHistory.js`)
- one-shot centerline, ring and grid arrays (`applyFixtureArray`)
- automatic dimensions

Measured against AutoCAD, it falls short in five places:

- **Snapping is grid-only** (`gridStep` 0.5 m). Only the pipe tool also snaps to fixture centres (`FE/engineering/usePipeDrawing.js:71-82`).
- **Selection is single-object only** (`selectedFixture` is one index).
- **The 9 layers are fixed** (lines 264-279).
- **The grid does not adapt to zoom.**
- **Dragging a fixture always quantises to 0.1 m**, even with SNAP off (`Math.round(world.x*10)/10`, lines 2063-2065).

The data model holds **one `geometry` per project**, so islands, multi-basin layouts and cascades have no home despite the header's "multi-basin" claim. The 3D editor (`FE/components/preview/editor/`) is separate. It has gizmos and its own 10 cm Shift-snap (`editorSnapping.js`), so two snapping systems already disagree.

**Backend engineering services.** These are mature (`BE/services/`):

- a GGA network solver, the EPANET method (`hydraulic_solver.py`)
- pipe sizing (`pipe_sizing.py`), nozzle K-factors (`nozzle_database.py`) and pump curves (`pump_curve.py`)
- a BOM (`bom_generator.py`) and ISA-5.1 P&ID (`pid_generator.py`)
- an engineering-package ZIP (`engineering_package.py`)

**CAD exchange works but is narrow.** `FE/engineering/cadExchange.js` (414 lines) parses ASCII DXF with `dxf-parser` 1.1.2 on the main thread and composes INSERT transforms up to 8 levels. It supports LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, ELLIPSE, POINT, TEXT, MTEXT, INSERT and ATTRIB. It does **not** support SPLINE, HATCH, DIMENSION, SOLID, 3DFACE or REGION. Fixtures come only from CIRCLE, POINT or INSERT anchors. The documented limits are a **10 MB cap**, model space only, no binary DXF, and one boundary candidate (`AUTOCAD-DESIGN-EXCHANGE.md:14-45`). `CADImportDialog.jsx` handles layer-role mapping, units and Invert-Y.

`DESK/cad-native.js` converts DWG↔DXF through an installed AutoCAD 2018+ `accoreconsole.exe` or ODA File Converter, with a 90 s timeout and a single-job lock. **There are two divergent DXF writers:**

| Writer | Format | Notes |
|---|---|---|
| Frontend `exportCadDxf` | AC1015 | XDATA metadata; Y negated |
| Backend `BE/services/cad_layout.py` | R12 | Its own layers; this is the one the engineering-package ZIP ships |

**3D rendering is advanced.** The AF-3D programme delivered (`FE/components/preview/`):

- GPU ping-pong particles: 131k water and 66k spray on medium, 262k and 131k on high (`particlesGPU.js`)
- Gerstner water with planar reflection, analytic refraction, caustics and a coupled heightfield (`waterHeightField.js`, `waterReflection.js`)
- sky dome and IBL (`skyDome.js`), volumetric cones (`lightCones.js`) and procedural PBR (`groundTextures.js`)
- Bloom, GTAO and SMAA, with ACES at exposure 2.1 (`FountainScene_v6.js:1735-1746`)

Medium runs **343 draw calls and 814k triangles** (`CURRENT_STATUS.md:643-650`). The binding limits are `MAX_FIELD_LIGHTS = 16` and `MAX_GPU_EMITTERS = 96`.

**The audit found one significant correctness bug.** Three code paths reduce every non-circular pool to a width × length rectangle:

- the GPU collision uniform: `uPool.set(pool.type === "circular" ? 1 : 0, …)` at `particlesGPU.js:546-551`
- `_poolBoundsForSplash()` at `FountainScene_v6.js:2035-2056`
- the heightfield mask at `waterHeightField.js:10-45`

**[Inference]** For freeform, L-shaped or kidney basins, which are exactly what CAD import produces, droplets bounce off an invisible rectangle and ripples appear on the deck. The spill litres-per-minute figure, which the code treats as a commissioning number, will also be wrong. The recent commit `d92c329` fixed mirrored freeform meshes (`basinGeometry.js:39-116`). Whether the rectangle is centred on the polygon's bounds or its centroid is **[Unverified]**. Whether CAD-imported geometry is re-centred to match `centeredPoolPoints()` is also **[Unverified]**.

**Process debt.** `FountainScene_v6.js` grew from 3,450 to 4,387 lines despite the realism plan's "must not grow" guardrail (`AF-3D-REALISM-PLAN.md §3`). There is also an ID collision: the plan's AF-3D-013 is "instanced glTF fixture models", but the shipped AF-3D-013 was the performance HUD (`CURRENT_STATUS.md:643`). A repo-wide search found **no existing `AF-CAD-` IDs and no `AF-3D-017` or higher**, so both ranges are free.

## DXF-first import keeps AquaFlow on the right side of DWG licensing

No free, redistributable DWG reader exists for commercial use, so the import strategy is built around licences:

| Route | Licence position | Plan role |
|---|---|---|
| **DXF (ASCII or binary) parsed by ezdxf** | ezdxf is open source **[Unverified: MIT per general knowledge; confirm before adding]** | **Default.** Canonical backend parser. |
| **User's own AutoCAD via `accoreconsole.exe`** (already in `DESK/cad-native.js`) | Uses the customer's licensed AutoCAD; no redistribution | **Default for DWG** where AutoCAD is installed. |
| **AutoCAD-side export plugin** (.NET or AutoLISP writing JSON/DXF) | Runs inside the user's AutoCAD; no DWG parser needed ([Autodesk DA4A notes](https://blog.autodesk.io/notes-on-using-da4a/)) | Phase 1 add-on for exact block/attribute capture. |
| **ODA File Converter** (already detected by `cad-native.js`) | ODA: "If you are not an ODA member, you can use them for non-commercial applications only", and ODA does not distribute the converter ([ODA](https://www.opendesign.com/node/3218)) | **Gate it.** Do not bundle. Show a licence notice. Disable for commercial users until ODA confirms the terms in writing. |
| **ODA Drawings SDK** (membership) | Distribution needs Commercial membership, reportedly capped at 100 seats; a lapsed subscription ends the right to distribute ([ODA FAQ](https://www.opendesign.com/faq/business-questions)) **[Unverified: page could not be fetched]** | Business decision; small sidecar converter if purchased. |
| **LibreDWG** | **GPLv3+** ([GNU manual](https://www.gnu.org/software/libredwg/manual/LibreDWG.html)). Linking would force AquaFlow to be GPL. Running it as a separate user-installed process is a grey area per one informal opinion ([OSArch](https://community.osarch.org/discussion/comment/19805/)) | **Excluded** from linking and bundling. Not a default path. |
| **APS Model Derivative** (cloud) | Token-metered: 0.5 Flex tokens per complex job ([APS](https://aps.autodesk.com/node/2846)); Free tier is rate-limited ([APS](https://aps.autodesk.com/node/3776)); uploads client drawings to Autodesk | Optional, opt-in, visual-only reference mesh. Loses block/attribute semantics. |

The ezdxf capabilities AquaFlow needs are documented:

- `Insert.virtual_entities()` for non-destructive block expansion ([ezdxf blocks](https://ezdxf.readthedocs.io/en/stable/tutorials/blocks.html))
- ATTRIB access via `get_attrib_text()`
- `ezdxf.units.conversion_factor()` for unit conversion ([ezdxf units](https://ezdxf.readthedocs.io/en/stable/concepts/units.html))
- bounding boxes via `ezdxf.bbox` ([ezdxf bbox](https://ezdxf.readthedocs.io/en/stable/bbox.html))
- a drawing add-on with SVG and CustomJSON backends ([ezdxf drawing](https://ezdxf.readthedocs.io/en/stable/addons/drawing.html))

Two limits matter. ACIS 3DSOLIDs load **only as polyhedra** ([ezdxf ACIS](https://ezdxf.readthedocs.io/en/stable/tools/acis.html)). No built-in dynamic-block "effective name" helper was found, so that chain has to be written by hand.

For a browser underlay, dxf-viewer (MPL-2.0) renders DXF through three.js with worker parsing and instancing. It does not render paper space, linetypes or most hatches ([dxf-viewer](https://github.com/vagran/dxf-viewer)). For 3D context:

- web-ifc reads IFC (MPL-2.0) ([web-ifc](https://github.com/ThatOpen/engine_web-ifc))
- occt-import-js reads STEP, IGES and BREP (LGPL-2.1, WASM) and must ship as an unmodified, replaceable module ([occt-import-js](https://github.com/kovacsv/occt-import-js))

**[Inference]** The recognition pipeline should copy the previs tools: deterministic, scored rules followed by a human review step, with saved mapping templates. Signals in priority order:

1. AquaFlow XDATA, which is exact on round-trips
2. user template rules on effective block name or layer
3. attribute tags such as MODEL or TYPE
4. multilingual layer keywords: NOZZLE, JET, BOQUILLA, DUESE, PUMP, BOMBA, LED, LUZ, VALVE
5. geometry signatures, for example repeated small circles on a ring
6. instance counts and symmetry

Each match records its source handle, so a re-import can show a diff of added, moved and removed items. Fountain-specific steps join TEXT, MTEXT and MLEADER tags near symbols to schedule tables, using both ACAD_TABLE entities and reconstructed text grids. Pipe-polyline endpoint connectivity then infers the nozzle → valve → pump graph that `hydraulic_solver.py` and the Show Programmer need.

## Phased implementation plan

The plan has five phases. Phase 0 fixes bugs that would corrupt any imported design. Phase 1 makes a real AutoCAD fountain visible and correct in 3D. Phase 2 turns the designer into a CAD-like editor. Phase 3 lifts rendering. Phase 4 adds interchange and polish.

The plan keeps the project's safety invariants:

- **CAD import never sends hardware commands.**
- **Fixture-ID matching preserves hardware addresses, and duplicate IDs are refused.** (`AUTOCAD-DESIGN-EXCHANGE.md`)
- **Rendering changes must not alter the splash litres-per-minute calibration** that the hidden 1/16 CPU sample keeps (`FountainScene_v6.js:713-717`).

Every task inherits a standing acceptance criterion: the existing frontend suite stays green (644 tests across 63 files at last record, `CURRENT_STATUS.md`), with new tests added for new behaviour. Priority is P0 (blocker), P1 (core value), P2 (important) or P3 (opportunistic). Unless marked otherwise, file paths are existing files from the audit; "new" marks proposed files.

### Phase 0 — Correctness fixes (do first)

| ID | Title | Files touched | Acceptance criteria | Pri |
|---|---|---|---|---|
| **AF-3D-017** | Polygon basin mask for particles, splash and heightfield (fixes freeform-as-rectangle bug) | `FE/components/preview/particlesGPU.js` (uPool uniform → mask texture), `FE/components/preview/FountainScene_v6.js` (`_poolBoundsForSplash`, `impactSink`), `FE/components/preview/waterHeightField.js` (`setPool`), `FE/components/preview/splashMap.js`, `FE/components/preview/basinGeometry.js`; new `FE/components/preview/basinMask.js` | (1) One rasterised basin-mask texture (polygon with holes) feeds GPU collision, CPU splash containment and the heightfield. (2) For an L-shaped test basin, zero particles collide outside the polygon, and ripple energy outside the polygon is ~0. (3) For existing circular and rectangular pools, spill L/min stays within ±2% of pre-change values **[tolerance is a proposed figure]**. (4) Mask uses the same centring as `centeredPoolPoints()`; test asserts the offset is 0. | P0 |
| **AF-CAD-001** | Single coordinate-frame contract: CAD → plan → 3D | `FE/engineering/geometryContract.js`, `FE/engineering/cadExchange.js` (`applyCadImport`, `exportCadDxf` y-negation), `FE/components/preview/basinGeometry.js` (`toShapePlane`) | (1) One documented transform chain: CAD +Y-up WCS metres → plan → three.js. (2) Round-trip test: export → re-import of an asymmetric freeform design returns identical points (≤1 mm). (3) A raycast test confirms an imported off-centre nozzle lands inside the imported basin in 3D. (4) Confirms whether `d92c329` is packaged in the installer, and records it in `CURRENT_STATUS.md`. | P0 |
| **AF-CAD-002** | Respect SNAP-off when dragging fixtures | `FE/components/panels/PoolGeometryDesigner.jsx` (lines ~2063-2065) | (1) With SNAP off, the drag position keeps full precision (status bar shows mm). (2) With SNAP on, the value is snapped once to `gridStep` with no second 0.1 m rounding. (3) Unit test on the drag handler. | P1 |
| **AF-CAD-003** | Converge on one DXF writer | `BE/services/cad_layout.py`, `BE/services/engineering_package.py`, `BE/api/routes/cad_routes.py`, `FE/engineering/cadExchange.js`, `FE/engineering/cadDxfTemplate.js` | (1) The engineering-package ZIP and the designer export produce the same DXF (same layers, XDATA and Y convention) for the same design. (2) The R12 writer is retired, or reduced to a thin "legacy R12" option. (3) A golden-file test compares both entry points. (Implementation lands with AF-CAD-020 if the ezdxf writer is chosen.) | P1 |
| **AF-3D-018** | Re-impose the scene-file growth guardrail | `FE/components/preview/FountainScene_v6.js`, `AF-3D-REALISM-PLAN.md` | (1) A CI or lint check fails if `FountainScene_v6.js` exceeds its current line count. (2) The realism plan is updated with the AF-3D-013 ID-collision note and the renumbering in this document. | P2 |

### Phase 1 — See the real AutoCAD design in 3D

| ID | Title | Files touched | Acceptance criteria | Pri |
|---|---|---|---|---|
| **AF-CAD-010** | Backend ezdxf normalisation service | `BE/requirements.txt` (add ezdxf; record licence), new `BE/services/cad_import.py`, `BE/api/routes/cad_routes.py` (new `POST /api/cad/import`) | (1) Reads ASCII **and binary** DXF. (2) Resolves units from `$INSUNITS`; returns `unitless=true` when the value is 0, and suggests a unit by comparing extents with typical pool sizes. (3) Walks nested INSERTs with full matrices, including OCS extrusion and mirrored blocks. (4) Resolves dynamic-block effective names through the XDICTIONARY → AcDbBlockRepresentation chain. (5) Collects ATTRIB dicts, AQUAFLOW XDATA, layer-0 inheritance and source handles. (6) Flattens SPLINE, ARC, ELLIPSE and bulges to polylines with a set tolerance. (7) Extracts HATCH boundaries as polygons. (8) Lists unresolved XREFs. (9) Returns normalised JSON in metres. (10) Configurable size cap, default well above 10 MB **[target, e.g. 100 MB; unverified against real site files]**. (11) Test corpus includes at least one third-party, non-AquaFlow fountain DWG/DXF. | P1 |
| **AF-CAD-011** | Whole-drawing locked underlay in 2D and 3D | new `FE/engineering/cadUnderlay.js`, `FE/components/panels/PoolGeometryDesigner.jsx`, new `FE/components/preview/cadUnderlay3D.js`, `FE/components/preview/FountainScene_v6.js` (wiring only, per AF-3D-018) | (1) The entire model space, including unmapped layers, appears as a locked, per-layer-toggleable reference in the designer and on the 3D ground plane. (2) Geometry is batched (one draw per layer/colour); a 50k-entity drawing keeps the designer interactive **[target figure]**. (3) A Flatbush index of the underlay is built in a worker for snapping and picking. (4) The underlay is persisted in the `.aqua` project as a reference. | P1 |
| **AF-CAD-012** | Fountain component recognition engine + review UI | new `BE/services/cad_recognition.py`, `FE/components/panels/CADImportDialog.jsx`, `FE/engineering/cadExchange.js` | (1) Scored rules in the signal order of the import section; each candidate carries `{source_handle, type, confidence, reasons[]}`. (2) Review UI colours candidates by confidence, groups by block or layer, and supports "apply to all instances of block X". (3) Mapping templates are saved and reloaded per client CAD standard. (4) Pick-point origin and edge-align rotation. (5) Never auto-assigns hardware addresses, and duplicate IDs are refused, as today. | P1 |
| **AF-CAD-013** | Multi-basin, island and cascade data model | `FE/engineering/poolGeometry.js`, `FE/engineering/engineeringProject.js`, `FE/engineering/geometryContract.js`, `FE/components/preview/basinGeometry.js`, `BE/services/geometry_service.py` | (1) `geometry` becomes `basins[]` (outer polygon + holes + floor level + wall height), with migration of existing single-basin projects. (2) Import offers every closed outline as a basin or island candidate. (3) AF-3D-017's mask handles multiple basins and holes. (4) Depth zones are scoped per basin. | P1 |
| **AF-CAD-014** | 2D → 3D extrusion of walls, coping, steps and land surfaces | `FE/components/preview/basinGeometry.js`, `FE/engineering/siteSurfaces.js`, `FE/components/panels/CADImportDialog.jsx` | (1) Wall height and floor level come from Z, from attributes (e.g. `LEVEL`/`ELEV`), or from user defaults. (2) HATCH regions mapped to grass, paving, soil, rock or sand become land surfaces. (3) A third-party site plan renders as a recognisable 3D site with no manual redraw. | P1 |
| **AF-CAD-015** | Pipe topology inference → nozzle/valve/pump graph | new `BE/services/cad_topology.py`, `BE/services/hydraulic_solver.py` (input adapter only), `FE/engineering/pipeworkEngine.js` | (1) Pipe polylines are connected by endpoint tolerance into a network; dangling ends are reported. (2) Nozzles are grouped to valves and pumps, and the user confirms groups. (3) The resulting network runs through the GGA solver with no manual re-entry. (4) Pipe DN and material are read from attributes or text where present. | P2 |
| **AF-CAD-016** | Tag ↔ schedule join | `BE/services/cad_import.py`, `BE/services/cad_recognition.py` | (1) Parses ACAD_TABLE and reconstructs schedules from aligned TEXT grids. (2) Joins nearby tag text to symbols. (3) Fills model, flow and head fields into recognised devices, with each field's provenance shown in review. | P2 |
| **AF-CAD-017** | Re-import with diff | `BE/services/cad_import.py`, `FE/components/panels/CADImportDialog.jsx`, `FE/engineering/cadExchange.js` | (1) Matches on AQUAFLOW XDATA ID, then on source handle. (2) Shows added, moved and removed items before applying. (3) Control settings and hardware addresses survive for matched items. | P2 |
| **AF-CAD-018** | DWG route hardening and licence gating | `DESK/cad-native.js`, `AUTOCAD-DESIGN-EXCHANGE.md`, `INSTALL-AND-LICENSE-GUIDE.md` | (1) The `accoreconsole` path stays the default for DWG. (2) The ODA path shows a licence notice and is disabled for commercial licences until a written ODA decision is recorded. (3) No LibreDWG linking or bundling. (4) DXF is handed to AF-CAD-010 instead of the main-thread parser. (5) The 10 MB cap is aligned with AF-CAD-010. | P1 |
| **AF-CAD-019** | AutoCAD-side export plugin (AutoLISP first, .NET later) | new `tools/autocad/aquaflow_export.lsp` (and later `tools/autocad/AquaFlowExport/`) | (1) Inside AutoCAD, exports block references with EffectiveName, attributes, world transform and layer to JSON or DXF. (2) AF-CAD-010 ingests the output losslessly. (3) Documented as the zero-licence DWG path for users without ODA. | P2 |

### Phase 2 — CAD-like but easy engineering designer

| ID | Title | Files touched | Acceptance criteria | Pri |
|---|---|---|---|---|
| **AF-CAD-030** | Extract a drafting kernel from the designer | `FE/components/panels/PoolGeometryDesigner.jsx`, new `FE/engineering/drafting/{entities,selection,commands,viewport}.js` | (1) Characterisation tests are written **before** the split, mirroring Phase 0 of `SHOW-PROGRAMMER-REDESIGN-PLAN.md`. (2) `PoolGeometryDesigner.jsx` drops below 2,000 lines **[target]** with no behaviour change. (3) Every entity has a stable UUID and owner, per the AutoCAD handle model. | P1 |
| **AF-CAD-031** | Command-pattern undo with deltas | `FE/engineering/engineeringHistory.js`, `FE/components/preview/editor/sceneHistory.js`, new `FE/engineering/drafting/commands.js` | (1) Each gesture (including array creation) is one transaction with Immer-patch deltas, not whole-design snapshots. (2) Commands serialise to JSON, as the three.js editor pattern does ([three.js editor](https://cdn.jsdelivr.net/npm/three-editor@1.2.14/docs/Implementing%20additional%20commands%20for%20undo-redo.md)). (3) 2D and 3D edits share one history. (4) Redo depth is capped. | P1 |
| **AF-CAD-032** | Unified object-snap engine | new `FE/engineering/drafting/snap.js`, `FE/components/preview/editor/editorSnapping.js`, `FE/engineering/usePipeDrawing.js` | (1) Modes: Endpoint, Midpoint, Center, Intersection, Perpendicular, Nearest, Insertion and **Port** (nozzle/pipe connection). (2) Pixel aperture of about 10 px, independent of zoom. (3) Priority Endpoint/Port > Intersection > Midpoint > Center > Perpendicular > Nearest > grid. (4) A distinct glyph and tooltip for each mode. (5) An RBush index for live entities; Flatbush for the underlay. (6) The same engine drives the 2D designer and the 3D editor, replacing the two divergent grid snaps. | P1 |
| **AF-CAD-033** | Polar tracking, typed entry and command palette | new `FE/engineering/drafting/dynamicInput.jsx`, new `FE/engineering/drafting/commandPalette.jsx`, `FE/components/panels/PoolGeometryDesigner.jsx` | (1) Polar tracking at 15° increments by default, always on (SketchUp-style), with Shift to lock an axis. (2) Typing a number while drawing sets the length; Tab moves to the angle field; `@dx,dy` relative input works. (3) Ctrl+K palette lists every command. (4) Usability check: a novice draws a 12.5 m pipe at 0° without opening a menu. | P1 |
| **AF-CAD-034** | Multi-select, window/crossing and groups | `FE/engineering/drafting/selection.js`, `FE/components/panels/PoolGeometryDesigner.jsx`, `FE/components/panels/InspectorPanel.jsx` (unread in audit; verify) | (1) Shift-add, a left-to-right window and a right-to-left crossing. (2) Select-similar (same type or block). (3) Groups stored as a list of IDs. (4) The properties panel edits shared fields across a multi-selection. | P1 |
| **AF-CAD-035** | Modify commands | `FE/engineering/drafting/commands.js` | (1) Move and copy by base point, rotate, scale, mirror, offset, trim and extend, fillet. (2) Each command is one undo step and works with snaps and typed entry. (3) Unit tests per command on polylines and fixtures. | P2 |
| **AF-CAD-036** | User layers as attributes | `FE/components/panels/PoolGeometryDesigner.jsx` (`mergeEngineeringLayers`), `FE/engineering/engineeringProject.js`, `FE/engineering/cadExchange.js` | (1) The 9 default layers stay as a standard set; users can add layers with colour, visibility and lock. (2) Imported CAD layers can be kept as user layers. (3) DXF export writes user layers. | P2 |
| **AF-CAD-037** | Associative arrays | `FE/components/panels/PoolGeometryDesigner.jsx` (`applyFixtureArray`), new `FE/engineering/drafting/arrays.js` | (1) Rectangular, polar and path arrays are single editable objects (count, spacing, radius, path). (2) Editing a parameter re-expands the instances while preserving fixture IDs where possible. (3) An explicit "explode" exists. | P2 |
| **AF-CAD-038** | Placed dimensions and adaptive grid | `FE/components/panels/PoolGeometryDesigner.jsx` (lines ~751-775, 978-1090) | (1) Linear, aligned, radial and angular dimensions are placeable and associative to entity snap points. (2) Grid density adapts to zoom (decade steps). (3) Dimensions are exported to DXF. | P2 |
| **AF-CAD-039** | Fixture family → type → instance library | `FE/engineering/fixtureSymbols.js`, `BE/services/nozzle_database.py`, `FE/components/preview/fixtureModels.js` | (1) Type parameters (orifice, K, max height, connection size, channel count) are edited once; instance parameters (pose, valve/DMX address, zone) are edited per placement, Revit-style. (2) Each parameter has a stable ID shared by BOM, PLC export and DXF/IFC. (3) Recognised CAD blocks map to types. | P1 |
| **AF-CAD-040** | True curves in basin outlines | `FE/engineering/poolGeometry.js`, `FE/components/preview/basinGeometry.js` | (1) Arcs and bulged segments are stored natively and tessellated only for render and physics. (2) Round-trip DXF keeps arcs as arcs. | P3 |
| **AF-CAD-041** | Optional geometric constraints (opt-in) | new `FE/engineering/drafting/constraints.js` | (1) Off by default. (2) Only after a legal check of LGPL-2.1 obligations, load planegcs WASM ([planegcs](https://cdn.jsdelivr.net/npm/@salusoft89/planegcs@1.1.7/README.md)) as a separate, replaceable module. **[Inference: associative arrays may make this unnecessary; decide after AF-CAD-037.]** | P3 |

### Phase 3 — Rendering realism (continues the AF-3D series)

Open plan items AF-3D-008, 014, 015 and 016 keep their IDs. The plan's colliding "AF-3D-013 instanced glTF fixture models" is **renumbered to AF-3D-019**.

| ID | Title | Files touched | Acceptance criteria | Pri |
|---|---|---|---|---|
| **AF-3D-008** | Half-resolution translucent particle pass (existing plan item) | `FE/components/preview/particlesGPU.js`, `FE/components/preview/FountainScene_v6.js` | (1) Spray and mist render to a half-res target with depth-aware upsample. (2) The HUD shows a frame-time reduction on high tier with no visible haloing at basin edges. | P1 |
| **AF-3D-019** | Instanced glTF fixture models (renumbered from plan AF-3D-013) | `FE/components/preview/fixtureModels.js` (audit did not check its progress), `FE/components/preview/modelLibrary.js` | (1) Stub cylinders and circle markers are replaced by one `InstancedMesh` per fixture type (from AF-CAD-039). (2) Draw calls for 300 fixtures stay at or below today's medium-tier count plus the number of fixture types. | P1 |
| **AF-3D-020** | Large-show performance baseline | `FE/components/preview/FountainScene_v6.js` (`getPerfStats`), new `FE/components/preview/__bench__/` | (1) A scripted benchmark records fps, draw calls and triangles for the real site scale (64 valves, 7 pumps, 300 fixtures) on low, medium and high. (2) Results are logged in `CURRENT_STATUS.md` (no such figures exist today). | P1 |
| **AF-3D-021** | Scene orchestrator decomposition | `FE/components/preview/FountainScene_v6.js` → new modules under `FE/components/preview/` (lighting, post, particles, basin, environment) | (1) `FountainScene_v6.js` becomes an orchestrator under 1,500 lines **[target]**. (2) Visual regression snapshots are identical per tier. (3) This is a prerequisite for AF-3D-023. | P1 |
| **AF-3D-022** | Lift the 16-light field cap and add beam-cone phase lighting | `FE/components/preview/FountainScene_v6.js` (`MAX_FIELD_LIGHTS`), particle and water shaders | (1) Per-particle fixture colour uses cone falloff × distance × Henyey-Greenstein forward scattering. (2) More than 16 fixtures contribute, via a light texture or clustering. (3) HDR emissive output drives bloom. **[Inference: recipe from rendering research, not measured.]** | P2 |
| **AF-3D-023** | three.js upgrade spike (r165 → current), WebGPURenderer behind a flag | `aquaflow/frontend/package.json`, renderer setup in `FountainScene_v6.js` | (1) A decision gate: the app runs on WebGPURenderer, with automatic WebGL2 fallback, behind a setting. (2) Side-by-side AF-3D-020 benchmarks. (3) No regression on the WebGL path. (4) Go/no-go is recorded. **[Unverified: the scale of shader-port effort is unknown.]** | P2 |
| **AF-3D-024** | Tone-mapping options: AgX and Neutral | `FE/components/preview/FountainScene_v6.js` (`toneMapping`, exposure), `FE/rendering/sceneModes.js` | (1) A user-selectable ACES (default, unchanged), AgX for night and Neutral for daytime product colour. (2) Exposure is recalibrated per operator so saved shows look unchanged under ACES. | P2 |
| **AF-3D-015** | Shadow frustum fit / CSM (existing plan item) | `FE/components/preview/FountainScene_v6.js` | (1) The shadow camera is fitted to the basin and site bounds, including multi-basin. (2) After AF-3D-023, r186 `SunLight` cascades are evaluated. | P2 |
| **AF-3D-014** | Venue backdrops, now including imported CAD context (existing plan item, widened) | `FE/components/preview/modelLibrary.js`, `FE/environment/` | (1) Three presets as planned. (2) The AF-CAD-011 underlay and AF-CAD-042 3D context sit in the same backdrop system. | P2 |
| **AF-3D-025** | Order-independent transparency for daylight spray | particle render path | (1) After AF-3D-023, `OITPassNode` (WBOIT) is used for daylight white water; night stays additive. (2) No sorting cost on the CPU. | P3 |
| **AF-3D-016** | God rays, motion blur, DoF (existing plan item) | post chain in `FountainScene_v6.js` / post module from AF-3D-021 | (1) As planned. (2) Radial scattering is limited to bright fixtures. (3) Particles are masked from any temporal AA history. | P3 |
| **AF-3D-026** | `ultra` tier with 500k–1M particles | `FE/components/preview/particlesGPU.js` | (1) Only after AF-3D-023 and AF-3D-008. (2) Holds 60 fps at 1080p on the reference GPU in the AF-3D-020 benchmark. **[Unverified target: research suggests 200k–500k is realistic on mid-range GPUs.]** | P3 |
| **AF-3D-027** | Beauty-still path-trace mode | new `FE/components/preview/beautyStill.js` | (1) Pauses the show, freezes particles to instanced geometry and accumulates samples with three-gpu-pathtracer. (2) Exports a PNG. (3) Clearly labelled "still only". | P3 |

### Phase 4 — Interchange and polish

| ID | Title | Files touched | Acceptance criteria | Pri |
|---|---|---|---|---|
| **AF-CAD-020** | ezdxf-based DXF writer with blocks and attributes | `BE/services/cad_layout.py` (replace), new `BE/services/cad_export.py`, `FE/engineering/cadExchange.js` | (1) One block per component type (`AQF_NOZZLE_<model>`). (2) ATTDEFs for ID, MODEL, HEIGHT and CHANNEL. (3) AQUAFLOW XDATA with the internal UUID. (4) Exports land surfaces, walls, dimensions and user layers. (5) Re-import through AF-CAD-017 is exact. | P2 |
| **AF-CAD-042** | 3D context import: IFC, STEP, FBX | `FE/components/preview/modelLibrary.js`, new `FE/engineering/context3dImport.js` | (1) IFC via web-ifc (MPL-2.0). (2) STEP via occt-import-js (LGPL-2.1, shipped unmodified as a separate WASM). (3) FBX via three.js FBXLoader. (4) Everything is converted to GLB internally and placed as locked context. | P3 |
| **AF-CAD-043** | MVR export and import for fixture position and patch | new `BE/services/mvr_exchange.py` | (1) Export positions and DMX addresses of lights as MVR 1.6. (2) Fountain devices go as generic fixtures, while fountain semantics stay in `.aqua`. (3) The python-mvr licence is checked first **[Unverified]**. | P3 |
| **AF-CAD-044** | Plot sheet with title block | new `BE/services/plot_sheet.py`, `BE/services/engineering_package.py` | (1) A PDF sheet of the plan with scale bar, title block and schedule table is added to the engineering package. | P3 |
| **AF-CAD-045** | APS cloud mesh (optional, opt-in) | new `BE/services/aps_client.py` | (1) Off by default, with a clear upload consent. (2) Imports an Autodesk-derived mesh as visual context only. (3) Token use is logged. **[Unverified: current APS free-tier caps.]** | P3 |

**Recommended order.** AF-3D-017 → AF-CAD-001 → AF-CAD-002 → AF-CAD-010 → AF-CAD-018 → AF-CAD-011 → AF-CAD-013 → AF-CAD-012 → AF-CAD-014 → AF-CAD-030 → AF-CAD-031 → AF-CAD-032 → AF-CAD-033, with AF-3D-008 and AF-3D-019 running in parallel on the rendering side.

**[Unverified estimate]** Phases 0–1 are roughly 5–7 developer-weeks, Phase 2 about 6–8 and Phase 3 about 5–7. These figures are judgements, not measurements.

The next recommended task for the Hub is **AF-3D-017**.

## Conclusion

The biggest gain is not a new renderer or a DWG library. It is making AquaFlow trust the user's real geometry end to end: polygon physics, a single coordinate contract, multi-basin data and a whole-drawing underlay. Once an imported basin behaves correctly in 3D, every other improvement compounds on it, including recognition, topology, CAD-grade editing and better water. That ordering also reduces the commissioning risk the project already tracks, because a correct basin mask is what makes the splash L/min figure honest for non-rectangular sites.

Strategically, licensing points AquaFlow toward a niche competitors have left open. Previs leaders such as Depence and Capture treat CAD as dumb scenery, and DWG reading is legally fenced. A tool that reads the customer's own AutoCAD output and rebuilds the tagged nozzle → valve → pump system from symbols and schedules does something those tools do not. It also needs no paid DWG SDK on day one. **[Inference]** The ODA membership decision can therefore wait until field data shows how many customers lack AutoCAD. The plan stays reversible at each gate: the ODA route, the three.js/WebGPU upgrade, and the constraint solver.
