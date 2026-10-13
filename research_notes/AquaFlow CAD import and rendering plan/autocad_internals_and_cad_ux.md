# AutoCAD Internals and CAD Drafting UX: Lessons for an AquaFlow Engineering Design Editor

Scope: AutoCAD's database/DXF data model, AutoCAD drafting UX, how SketchUp/Fusion/Revit/Onshape/BIM make design approachable, and implementation techniques/libraries for a web/Electron (three.js + React + Python backend) CAD-like editor. Researched 2026-10-13. Sources are mostly Autodesk help pages and ezdxf documentation (ezdxf is the reference Python DXF library and a likely backend dependency for AquaFlow). Recommendations for AquaFlow appear only under "Inferences".

---

## 1. AutoCAD's database model: entities, symbol tables, blocks, attributes, dynamic blocks, XDATA/XRECORDs, units, model/paper space, UCS/WCS

### Takeaway
An AutoCAD drawing is a handle-addressed object database. Graphical **entities** are owned by **BLOCK_RECORDs**, and model space and paper space are themselves blocks. Non-graphical **objects** (DICTIONARY, XRECORD, LAYOUT, GROUP) live in an OBJECTS section. Layers, linetypes and blocks are named **symbol table** records that entities refer to by name or handle. Reuse comes from block definitions instanced by INSERT. ATTRIB carries per-instance data, and application metadata attaches through XDATA or through extension dictionaries holding XRECORDs. This maps closely onto a "fixture type library + placed instances + metadata" model for AquaFlow.

### Cited Findings
**Entities vs objects, handles, owners**
- DXF splits into **graphical entities** (LINE, CIRCLE, TEXT, HATCH, DIMENSION, INSERT, …), which are "visible objects stored in blocks, modelspace- or paperspace layouts", and **non-graphical objects** (DICTIONARY, XRECORD, LAYOUT, GROUP) held in the OBJECTS section — [ezdxf: DXF Entities and Objects](https://ezdxf.readthedocs.io/en/stable/concepts/entities.html)
- "A layer assignment is just an attribute of a DXF entity, it's not an entity container". Layers are defined in the layer table — [ezdxf: Entities](https://ezdxf.readthedocs.io/en/stable/concepts/entities.html)
- A GROUP holds a list of handles that refer to other entities. A DICTIONARY maps names to references to any object — [ezdxf: Entities](https://ezdxf.readthedocs.io/en/stable/concepts/entities.html)
- ezdxf keeps entity types it does not support as `TagStorage` so their data survives round-trip export — [ezdxf: Entities](https://ezdxf.readthedocs.io/en/stable/concepts/entities.html)

**Blocks, BLOCK_RECORD, model and paper space**
- A BLOCK is a layout, like modelspace or a paperspace layout. INSERT entities reference it by name. The block base point (group 10) is the insertion, rotation and stretch origin. Block names are case-insensitive and must be unique — [ezdxf: Block Management Structures](https://ezdxf.readthedocs.io/en/stable/dxfinternals/block_management.html)
- **Modelspace and paperspace are also blocks** (`*Model_Space`, `*Paper_Space`). Their entities are stored in the ENTITIES section, which holds the active paperspace layout, not in the BLOCKS section — [ezdxf: Block Management](https://ezdxf.readthedocs.io/en/stable/dxfinternals/block_management.html)
- The BLOCK_RECORD table "is the real owner of the layout entities". Each record has a handle (group 5) and a pointer to its LAYOUT object (group 340). Entities carry an owner tag (330) that points to their BLOCK_RECORD. In R2007+ the BLOCK_RECORD stores insertion units (70), explodability (280) and scalability (281) — [ezdxf: Block Management](https://ezdxf.readthedocs.io/en/stable/dxfinternals/block_management.html)
- In R13+, a definition is bracketed by BLOCK (AcDbBlockBegin) and ENDBLK (AcDbBlockEnd). Cyclic block nesting (A contains B, B contains A) should be avoided because CAD apps may fail to load the file — [ezdxf: Block Management](https://ezdxf.readthedocs.io/en/stable/dxfinternals/block_management.html)

**Block references (INSERT) and attributes (ATTDEF/ATTRIB)**
- INSERT is a block reference with insertion point, scale factors and rotation, plus optional attached ATTRIB entities — [ezdxf: Insert](https://ezdxf.readthedocs.io/en/stable/blocks/insert.html)
- A block is a collection of entities placed many times. INSERTs can appear in layouts or inside other block definitions (nesting), can be rotated and scaled, are placed in 3D through the OCS, and can be arranged in a grid (MINSERT-style) — [ezdxf: Blocks concept](https://ezdxf.readthedocs.io/en/stable/concepts/blocks.html)
- An ATTRIB is a tagged text annotation on a block reference. "Attributes are often used to add information to block references which can be evaluated and exported by CAD applications" — [ezdxf: Insert](https://ezdxf.readthedocs.io/en/stable/blocks/insert.html)
- Interop caveat: GDAL's DXF driver treats ATTRIB as TEXT and ignores ATTDEF in newer releases, so attribute data is easily lost by third-party readers — [GDAL DXF driver](https://gdal.org/drivers/vector/dxf.html)

**Dynamic blocks**
- Autodesk added dynamic blocks and constraints as **undocumented** DXF entities. Other CAD applications don't fully support them, and ezdxf only preserves them — [ezdxf: Blocks concept](https://ezdxf.readthedocs.io/en/stable/concepts/blocks.html)
- A visibility parameter defines visibility states that control which objects in the block show. In the drawing, a grip on the reference lists the available states — [Autodesk Block Editor help](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-B69D58AD-7920-4198-AB2A-0E24B944F6CD.htm)
- A lookup parameter is a custom property that evaluates to a value from a defined list or table — [Autodesk Block Editor help](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-B69D58AD-7920-4198-AB2A-0E24B944F6CD.htm). Lookup tables drive linear, rotational and visibility parameters from a dropdown and can restrict a block to a manufacturer's catalogue sizes — [Arkance tip, Making AutoCAD Blocks Smarter pt 6](https://emea.support.arkance.world/hc/es/articles/36471115412626-AutoCAD-Tip-Making-AutoCAD-Blocks-Smarter-Part-6)
- Known limitation: one visibility parameter per block. Users chain extra lookup actions and dummy parameters to work around it — [CADTutor forum](https://cadtutor.net/forum/topic/72164-dynamic-block-lookup-table-for-visibility-states-not-working) (forum source)

**XDATA, XRECORDs, extension dictionaries**
- XRECORD objects store application data. They are "similar in concept to XDATA but not limited by size or order". An XRECORD links to an entity by storing its handle in XDATA, in app-defined data, or in the entity's **ExtensionDict** — [ezdxf: XRECORD](https://dokk.org/documentation/ezdxf/v1.1.4/dxfobjects/xrecord/)
- Extension dictionaries are DICTIONARY objects that map a name string to a reference to an object — [ezdxf: Entities](https://ezdxf.readthedocs.io/en/stable/concepts/entities.html)

**Units ($INSUNITS)**
- $INSUNITS codes: 0 unitless, 1 in, 2 ft, 3 mi, 4 mm, 5 cm, 6 m, 7 km, 8 microinch, 9 mil, 10 yd, 11 Å, 12 nm, 13 µm, 14 dm, 15 dam, 16 hm, 17 Gm, 18 AU, 19 ly, 20 pc, 21–24 US survey ft/in/yd/mi — [ezdxf: DXF Units](https://ezdxf.readthedocs.io/en/stable/concepts/units.html)
- $MEASUREMENT (0 imperial, 1 metric) only selects the hatch-pattern and linetype files and is independent of $INSUNITS. $LUNITS is display formatting only (1 sci, 2 decimal, 3 eng, 4 arch, 5 frac) — [ezdxf: DXF Units](https://ezdxf.readthedocs.io/en/stable/concepts/units.html)
- No implicit unit conversion is applied when a block with different units is inserted. The scale must go into the INSERT xscale/yscale/zscale (for example 0.01 for a cm block in m modelspace) — [ezdxf: DXF Units](https://ezdxf.readthedocs.io/en/stable/concepts/units.html)
- Sources disagree on what $INSUNITS means. One reading is that it is a hint for scaling inserted content, not a guarantee about the whole file, and some exporters ignore it — [Onshape forum](https://forum.onshape.com/discussion/comment/70486); [Autodesk forum](https://forums.autodesk.com/t5/autocad-forum/units-settings-within-dxf-files/td-p/7417774) (forum sources)

**WCS / UCS / OCS**
- Planar entities (CIRCLE, ARC, TEXT, LWPOLYLINE, HATCH, SOLID, …) store points in an **Object Coordinate System**, defined only by an extrusion vector (OCS Z) plus elevation. The OCS origin equals the WCS origin. The X and Y axes are derived by AutoCAD's **arbitrary axis algorithm**, so the OCS is always right-handed. ELLIPSE is an exception: its points stay in WCS — [ezdxf: OCS](https://ezdxf.readthedocs.io/en/stable/concepts/ocs.html); [Autodesk DXF Reference: OCS](https://help.autodesk.com/cloudhelp/2021/ENU/AutoCAD-DXF/files/GUID-D99F1509-E4E4-47A3-8691-92EA07DC88F5.htm)
- TEXT rotation is counterclockwise about OCS Z. ezdxf's UCS helper converts angles between UCS/WCS and OCS with `to_ocs_angle_deg()` — [ezdxf OCS/UCS tutorial](https://ezdxf.readthedocs.io/en/stable/tutorials/ocs_usage.html)

### Inferences
- AquaFlow should mirror the AutoCAD split. A **definition library** (fixture/nozzle/pump/light "blocks" holding geometry, ports and default parameters) is kept separate from **placed instances** (transform + definition ID + per-instance attribute values). This is the INSERT/ATTRIB pattern, and it maps directly onto three.js `InstancedMesh` for rendering.
- Every object should get a stable, never-reused handle or UUID with an owner pointer, as the BLOCK_RECORD/330 owner model does. That makes undo, collaboration, DXF round-trip and PLC/DMX channel binding referentially safe.
- Layers should be an *attribute* (a property tag driving visibility, colour and lock), not a scene-graph container, exactly as in DXF. Grouping is a separate concept (GROUP as a list of handles).
- Engineering metadata such as fixture DMX address, flow rate, pipe size or PLC tag should be stored the way XRECORD/extension dictionaries are: a namespaced, schema-versioned key/value bag per object. On DXF export, ezdxf can write it as XDATA (appid "AQUAFLOW") or as an extension-dictionary XRECORD so it survives a round-trip through AutoCAD.
- On import, never trust `$INSUNITS` alone. Show the detected unit, let the user confirm it, and compute the INSERT scale explicitly. Treat dynamic-block data as opaque: render the anonymous-block geometry that AutoCAD wrote and do not try to evaluate parameters.
- Internally use a single right-handed world frame, metres, Z-up or Y-up, chosen once. Apply the OCS-to-WCS transform at import (ezdxf can do this server-side) so the frontend never deals with OCS.

### Gaps
- I did not retrieve the authoritative Autodesk DXF Reference pages for the full entity group-code tables (LWPOLYLINE, SPLINE, MTEXT, DIMENSION, HATCH, 3DSOLID/ACIS SAT payload) or the arbitrary-axis formula. They are known to be in the DXF Reference "Arbitrary Axis Algorithm" section, but are not quoted here.
- No source covered the ATTDEF definition-side fields (prompt, default, invisible/constant/preset flags) in detail.
- 3DSOLID: the general understanding is that DXF embeds the solid as an ACIS (SAT/SAB) payload that open-source readers cannot evaluate, but I found no source in this session.

---

## 2. Drafting UX: command line + ribbon, OSNAP, polar tracking, ortho, grips, dynamic input, constraints, arrays, layers, properties, tool palettes, undo

### Takeaway
AutoCAD's productivity comes from **precise point acquisition**: running object snaps, snap tracking, polar and ortho, and typed values at the cursor through dynamic input. Context-sensitive **grips** handle direct editing. Parametric constraints are optional and inferred, not mandatory. For AquaFlow the core needs are a small snap vocabulary, typed-length entry at the cursor, and multifunction grips. Full parametrics can come later.

### Cited Findings
**Object snaps and tracking**
- Running OSNAP modes (OSMODE): Endpoint, Midpoint, Center, Geometric Center (closed polyline/spline centroid), Node, Quadrant, Intersection (extended intersection only as an override), Extension (temporary extension line past endpoints), Insertion (block/text/attribute insertion point), Perpendicular (with deferred mode), Tangent (deferred), Nearest, Apparent Intersection (visual intersection in the current view), and Parallel — [Autodesk: Object Snap tab](https://help.autodesk.com/cloudhelp/2017/ENU/AutoCAD-LT-MAC/files/GUID-A782462F-F85C-4496-85A5-3D9A54548489.htm)
- **Object snap tracking** (AUTOSNAP) lets the cursor follow alignment paths from acquired snap points and requires running snaps to be on. Parallel snap temporarily disables tracking and polar snap — [Autodesk: Object Snap tab](https://help.autodesk.com/cloudhelp/2017/ENU/AutoCAD-LT-MAC/files/GUID-A782462F-F85C-4496-85A5-3D9A54548489.htm)
- The AutoSnap **aperture** (APERTURE, in device-independent pixels; box shown when APBOX=1) sets how close the cursor must be before the "magnet" locks on. Alignment points are acquired automatically on hover or with Shift-to-acquire — [Autodesk: Drafting tab (Options)](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-LT/files/GUID-33A0F8E8-9981-4111-AD73-128B20D7975C.htm)
- Polar tracking constrains the cursor to increment angles such as 90, 45, 30 and 15 degrees — [Autodesk: Drafting tab](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-LT/files/GUID-33A0F8E8-9981-4111-AD73-128B20D7975C.htm)

**Grips and dynamic input**
- Hovering a grip shows the object's dimensions. Once the grip is hot, the on-screen fields accept values, Tab cycles between them and Enter commits — [engineering.com: Get a Grip](https://www.engineering.com/?p=51657)
- **Multifunctional grips** are object- and grip-specific: a line endpoint offers Stretch and Lengthen, and a polyline vertex offers vertex add/remove. Space or Enter cycles grip modes (stretch/move/rotate/scale/mirror), and right-click lists the commands — [Ascent: Using Grips](https://resources.ascented.com/ascent-blog/using-grips-in-autocad)
- DYNMODE turns Dynamic Input on and off (Autodesk lists four settings) — [Autodesk Dynamic Input Settings](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-RasterDesign/files/GUID-FA3957E7-E5C7-4173-8009-42E4D5160FBC.htm)

**Constraints (parametric drawing)**
- **Geometric** constraints control relationships (horizontal, parallel, tangent, coincident…). **Dimensional** constraints control distance, length, angle and radius values — [Autodesk Parametric Drawing tutorial (2010)](https://gtu.ge/arch/Multimedia/Acad_11/21-10-parametric_drawing/Parametric_Drawing.pdf)
- AUTOCONSTRAIN applies "essential" constraints to a selection, and the user usually adjusts them by hand afterwards. DELCONSTRAINT removes them in bulk — [Autodesk: Applying and Deleting Geometric Constraints](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-LT/files/GUID-54069D14-97BF-42C5-8B42-9087A18C49D8.htm)
- CONSTRAINTINFER infers constraints while drawing (for example, a near-horizontal line gets Horizontal) and is **off by default** — [IMAGINiT](https://resources.imaginit.com/how-tos/how-to-turn-on-off-inferred-geometric-constraints-in-autocad)
- In AutoCAD Mechanical, the AutoConstrain priority order of constraint types sets which ones are applied first — [Autodesk Mechanical help](https://help.autodesk.com/cloudhelp/2022/ENU/AutoCAD-Mechanical/files/GUID-609A037F-CE82-4BF4-861D-6DD2E78BBA18.htm)

### Inferences
- **Minimum viable snap set for AquaFlow**: Endpoint, Midpoint, Center, Intersection, Perpendicular, Nearest, Insertion (fixture origin), and a custom **"Port"** snap (nozzle/pipe connection points). Each snap needs a distinct glyph, as AutoCAD's square, triangle and circle markers do, plus a tooltip label.
- Make the aperture a screen-pixel radius (about 10 px), not a world distance, so snapping feels the same at every zoom.
- Combine polar tracking (15° default) with typed length: "draw pipe, move the mouse to 0°, type 12.5, Enter". This is the single highest-value AutoCAD pattern for laying out nozzle rings and manifolds.
- A command line or palette (Ctrl+K style) plus a ribbon or toolbar gives experts a fast path and novices a discoverable one. AquaFlow can put a command palette in the React layer at low cost.
- Arrays matter a lot for fountains: rectangular grids of jets, polar rings and path arrays along a pool edge. They should be **associative**: one array object holding count, spacing and radius parameters that expands into instances and stays editable, rather than exploding into copies.
- Constraints should be opt-in and inferred, as AutoCAD does (off by default). Fountain layout rarely needs a full sketch solver except for pool-outline sketches.

### Gaps
- Not retrieved from primary sources in this session: ortho (F8) semantics, the Properties palette and Quick Properties, Layer Properties Manager states (on/off, freeze/thaw, lock, plot), tool palettes, associative array (ARRAYRECT/ARRAYPOLAR/ARRAYPATH) parameters, and UNDO grouping (UNDO BEGIN/END). These are standard AutoCAD features but no citation was gathered.
- The full list of DYNMODE values was not shown in the retrieved snippet.

---

## 3. How SketchUp, Fusion 360, Revit and Onshape make design approachable; how BIM attaches engineering metadata

### Takeaway
SketchUp's always-on **inference engine** (point snaps plus dynamic guide lines and axis locking) trades AutoCAD's mode toggles for zero-configuration precision. Revit's **families with type and instance parameters**, mapped to IFC classes and property sets, is the reference model for engineering metadata on placed objects. AquaFlow's fixture catalogue should follow it.

### Cited Findings
**SketchUp inference** (community/forum sources; no official doc retrieved)
- Inference is always on and cannot be toggled. Length snapping is a separate setting in Model Info > Units — [SketchUp forum: Snapping on/off](https://forums.sketchup.com/t/snapping-on-off/239136)
- It is a system of dynamic guidelines plus object snaps. "From Point" inferences appear only after you hover a point to acquire it — [SketchUp forum: Override snapping](https://forums.sketchup.com/t/override-snapping/4974)
- Arrow keys or Shift lock the inference direction (axis or parallel lock) — [SketchUp forum: Weird inference](https://forums.sketchup.com/t/weird-inference/127254)
- Inference is view and zoom dependent. Snap priority is fixed (endpoints beat midpoints), which users complain about — [SketchUp forum: zooming](https://forums.sketchup.com/t/inferencing-does-zooming-in-stop-it-some-other-questions/130085); [SketchUp forum: Tweak inference priority](https://forums.sketchup.com/t/tweak-inference-priority/57854)

**Revit families, parameters, and IFC**
- Best practice is to put attributes shared by many elements in **type parameters** and keep **instance parameters** for values that really vary per placement — [Novedge: Revit IFC export parameter mapping](https://novedge.com/blogs/design-news/revit-tip-revit-ifc-export-parameter-mapping-and-qa-best-practices)
- The `IFCExportAs` and `IFCExportType` parameters on a family type map its elements to a specified IFC class or type on export — [Autodesk: Specify IFC Entities for Families](https://help.autodesk.com/cloudhelp/2022/ENU/RevitLT-DocumentPresent/files/GUID-7119A8C3-A0EE-4568-8C35-750410D867C9.htm)
- Newer exporters require the type class (for example IfcWallType, not just IfcWall) to export type parameters — [BIM Me Up: Export type parameters to IFC](https://bim-me-up.com/en/export-revit-type-parameters-to-ifc/)
- Shared parameters carry a GUID that keeps them consistent between family and project, but IFC mapping does not depend on a parameter being shared. Custom property sets (Psets) are defined in a user-defined property-set file. Revit ships text files of the standard IFC Psets, and populated properties export automatically — [BIM Me Up: IFC shared parameters](https://bim-me-up.com/en/ifc-shared-parameters/); [Autodesk forum: user-defined Psets](https://forums.autodesk.com/t5/revit-architecture-forum/user-defined-property-sets-revit-native-parameters/td-p/11985964)

### Inferences
- **AquaFlow fixture model (Revit-style)**: Family (for example "Nozzle – Vertical Jet") → Type (catalogue SKU: orifice, max height, flow at pressure, connection size, DMX/valve channel count) → Instance (position, rotation, assigned valve/VFD/DMX address, zone, show-group). Type values are edited once in the library. The Properties panel shows instance values with type values read-only and an "Edit Type" button, as Revit does.
- A shared-parameter GUID equivalent (a stable parameter ID, not just a display name) lets the backend, the PLC export, BOM generation and IFC/DXF exports agree on the meaning of each field.
- To make the pool/MEP model exportable to BIM, map fixture families to IFC classes. Nozzles, pumps, valves and pipes plausibly map to IFC MEP distribution classes (for example IfcPump, IfcValve, IfcPipeSegment), with custom `Pset_AquaFlow_*` property sets. This class mapping is my inference and should be checked against the IFC4 schema.
- SketchUp's lesson for AquaFlow: precision should not need mode switching. Always-on snapping with visible guide lines, Shift to lock an axis, and type-to-set-length together give AutoCAD-grade precision with a gentler learning curve.

### Gaps
- No primary sources were gathered in this session on **Fusion 360** (timeline/history-based parametric features, sketch constraint inference) or **Onshape** (FeatureScript, browser-native multi-user CAD with a server-side kernel and solver). These are relevant (Onshape especially, as proof that browser CAD works with server-side geometry), but they are not cited here.
- No official SketchUp documentation on inference colour coding (red/green/blue axis, magenta parallel) was retrieved. The claims above come from forums.
- The IFC4/IFC4.3 entity names for fountain-specific equipment were not verified.

---

## 4. Implementation techniques and open-source libraries for web CAD

### Takeaway
A practical stack for AquaFlow has eight parts:
- **ezdxf** (Python) for DXF read/write and normalisation.
- **dxf-viewer** (three.js, worker parsing, batching) or a custom three.js renderer for display.
- **Flatbush/RBush** spatial indexes for snap and pick queries.
- **planegcs** (FreeCAD's solver in WASM) if 2D constraints are needed.
- **SolveSpace** bindings as a Python-side alternative.
- **replicad/OpenCascade.js** only if true B-rep solids are needed.
- Command-pattern undo modelled on the three.js editor's History/Commands.
- tldraw's history docs as a reference for how a web editor handles undo.

### Cited Findings
**DXF display in the browser**
- `dxf-viewer` (vagran; npm 1.0.49; MPL-2.0) is a 2D DXF viewer that renders with WebGL through three.js. It can parse in a web worker, and it uses geometry batching and instanced rendering for large files. Its limitations are that linetype patterns are not implemented (all lines thin), DXF text styling is ignored, the whole file is buffered (files over 1 GB are unsupported) and non-UTF-8 encodings display incorrectly — [dxf-viewer README (jsdelivr)](https://cdn.jsdelivr.net/npm/dxf-viewer@1.0.49/README.md)
- Alternatives include `three-dxf`, `three-dxf-viewer` and `@mapcatch/three-dxf-viewer` — [three-dxf](https://github.com/gdsestimating/three-dxf); [three-dxf-viewer](https://github.com/elschilling/three-dxf-viewer)

**Spatial indexes for snapping and picking**
- **Flatbush** is a static packed R-tree: no add or remove after indexing. Its maintainer benchmark (Node 10, dated) indexed 1M rectangles in 263 ms vs 1208 ms for RBush, and ran 100k nearest-neighbour searches in 939 ms vs 1548 ms. The index is one ArrayBuffer, so it can be transferred to a worker or saved. `nodeSize` (default 16) trades index speed against query speed — [flatbush (npm)](https://www.npmjs.com/package/flatbush)
- **RBush** is a dynamic R-tree that supports insert and remove, and bulk-loading improves later queries by about 20–30%. **KDBush** indexes static points 5–8x faster than RBush — [rbush (npm)](https://npmjs.com/package/rbush)

**Constraint solvers**
- **@salusoft89/planegcs** (npm, README v1.1.7) is FreeCAD Sketcher's PlaneGCS compiled to WASM for browser and Node. Geometries and constraints are JSON with ids. The workflow is `GcsWrapper.push_primitives_and_params()` → `solve()` → `apply_solution()`. Algorithms are DogLeg (default), Levenberg-Marquardt and BFGS, with SQP used when temporary constraints exist, which is useful for drag-solving. Primitives are point, line, circle, arc, ellipse, elliptical arc, hyperbola and parabola. Constraints may be driving or non-driving. Limits: B-spline support is incomplete, constraints cannot reference constraints, and some non-driving constraints misbehave — [planegcs README](https://cdn.jsdelivr.net/npm/@salusoft89/planegcs@1.1.7/README.md)
- Python bindings exist (`pip install planegcs`), licensed **LGPL-2.1-or-later** like FreeCAD — [planegcs docs](https://planegcs.readthedocs.io/en/stable/)
- **SolveSpace** solver: `python-solvespace` on PyPI (3.0.8 seen) and `py-slvs` (SWIG, v2.3 fork, used by FreeCAD Assembly3). No official Python binding existed per the Assembly3 notes. There is an experimental WASM `slvs` npm package (3.1.0-dev.22, maintenance unverified), and a Rust `slvs` crate (GPL-3.0) — [python-solvespace (PyPI)](https://pypi.org/project/python-solvespace/); [py-slvs](https://pypi.org/project/py-slvs); [Assembly3 build notes](https://github.com/realthunder/FreeCAD_assembly3/wiki/Build-Instruction); [replicad issue #72](https://github.com/sgenoud/replicad/issues/72); [slvs crate](https://lib.rs/crates/slvs)

**Solid modelling kernels in the browser**
- **OpenCascade.js** is the OpenCascade kernel compiled to WASM with Emscripten — [ocjs.org](https://ocjs.org/docs/about)
- **replicad** is a code-first B-rep modelling library over OpenCascade.js. Computation should run in a worker. It exports STL/STEP and meshes for three.js, using `replicad-threejs-helper` to sync BufferGeometries. CascadeStudio is a related project — [replicad (mirror)](https://github.com/remcoder/replicad); [newscrewdriver: Window Shopping replicad](https://newscrewdriver.com/2023/07/22/window-shopping-replicad/)

**Undo / redo**
- The three.js editor uses the **command pattern**. Each command implements `execute`, `undo`, `toJSON` and `fromJSON`, and stores only the changed attribute's old and new values. `editor.execute(cmd)` pushes the command to the history stack. Generic `Set…ValueCommand` classes cover number, string and boolean properties — [three.js editor docs: Implementing commands for undo/redo](https://cdn.jsdelivr.net/npm/three-editor@1.2.14/docs/Implementing%20additional%20commands%20for%20undo-redo.md)
- Keeping undone objects alive in redo history can use a lot of memory — [three.js forum](https://discourse.threejs.org/t/undo-redo-in-three-js-scene/3025)
- tldraw documents a history/undo system for a web canvas editor — [tldraw History](https://tldraw.dev/sdk-features/history)

### Inferences
**Snapping algorithm sketch.** On pointer move:
1. Convert the cursor to world coordinates and the pixel aperture to a world radius r = aperture_px × world_per_px.
2. Query the R-tree for entity bounding boxes intersecting the cursor ± r.
3. For each candidate, generate snap points by enabled mode (endpoints, midpoints, centres, ports) and the intersections among candidate pairs.
4. Score by screen distance with a mode-priority bias (Endpoint/Port > Intersection > Midpoint > Center > Perpendicular > Nearest).
5. If nothing is within r, fall back to polar or tracking lines from up to N acquired points, then grid.
6. Render the glyph and tooltip.

Use RBush for the live editable scene and Flatbush for large, static imported DXF underlays (rebuilt on import, built in a worker).

**Rendering.** Render imported DXF underlays as merged, batched, locked layers, as dxf-viewer does. Use `InstancedMesh` per fixture type for placed fixtures. Use three.js `Line2`/fat lines if lineweights matter, since dxf-viewer renders all lines thin.

**Data flow.** The Python backend (ezdxf) owns import and export and normalisation: OCS→WCS, unit scaling, block flattening or instancing, XDATA. It sends a compact JSON (or binary) scene to the frontend. The frontend owns interaction (snap, grips, commands). Geometry edits are expressed as commands that serialise to JSON, so they can be replayed on the backend, sent to collaborators and persisted as an audit log.

**Command and undo design.** Use transaction-grouped commands so that one user gesture (for example an array creation) is a single undo step. Prefer storing deltas (old/new property values) over snapshots, and cap redo depth. Zustand or Immer patches are a React-friendly way to get deltas.

**Constraint solver choice.** planegcs WASM gives in-browser drag-solving with no server round-trip. Check the LGPL-2.1 obligations first: dynamically load the WASM as a separate replaceable module. SolveSpace is GPL-3.0 (Rust crate, per the source) or comparable copyleft, which is riskier for a commercial product. If AquaFlow only needs simple relations (equal spacing, concentric rings, symmetric about an axis), associative arrays and parameter expressions may remove the need for a general solver.

**3D solids.** OpenCascade.js/replicad is only worth its multi-MB WASM payload if AquaFlow must author or edit real solids (pool shells, STEP export). For fountain layout, extruded profiles plus three.js meshes are likely enough.

### Gaps
- No sources were gathered in this session on Konva, Paper.js, JSXGraph, LibreCAD internals, or the three.js-based CAD editors Chili3D and BitByBit. They are in scope but uncited here. Konva and Paper.js are 2D canvas scene graphs, and JSXGraph is a dynamic-geometry library with built-in constraints, but no citation was collected.
- No independent current benchmark of Flatbush vs RBush was found. The cited numbers are the maintainer's, from Node v10.
- No blog-quality source on CAD snapping algorithms (priority scoring, intersection caching) was retrieved. The algorithm above is my synthesis.
- The license of the @salusoft89/planegcs npm package was not stated in the retrieved README. LGPL-2.1+ is confirmed only for the Python planegcs bindings.
- The current maintenance status of the `slvs` WASM npm package is unverified.
- ODA (Open Design Alliance) documentation and libredwg were not reviewed. Native DWG (as opposed to DXF) import options for a Python backend remain open, with ODA File Converter as a commonly used route, but this is uncited.
