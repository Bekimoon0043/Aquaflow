# DWG/DXF (and adjacent formats) import pipeline for AquaFlow (FastAPI + three.js, commercial Windows desktop)

Research date: 2026-10-13. Every claim below has a cited source. Claims I could not verify from a fetched source are in Inferences or Gaps.

## 1. DXF parsing: ezdxf (Python) in depth, and JS parsers/viewers

### Takeaway
ezdxf should be the canonical backend parser. It covers blocks, INSERT, ATTRIB/ATTDEF, units, virtual entities, bounding boxes, a 2D renderer to SVG/PDF/JSON, and a polyhedral-only ACIS reader. It cannot evaluate true curved 3D solids, and it does not resolve dynamic block names for you. dxf-viewer (MPL-2.0) is a capable 2D WebGL/three.js viewer for underlays, but it is 2D only.

### Cited Findings
**ezdxf blocks, INSERT and attributes**
- Each block definition is a `BlockLayout` in `doc.blocks`. References are created with `add_blockref(name, point, dxfattribs)` and carry `xscale`, `yscale` and `rotation`. Unit differences between a layout and a block must be applied as an explicit scale. — [ezdxf blocks tutorial](https://ezdxf.readthedocs.io/en/stable/tutorials/blocks.html)
- You can query references by block name with `msp.query('INSERT[name=="FLAG"]')`. — [ezdxf blocks tutorial](https://ezdxf.readthedocs.io/en/stable/tutorials/blocks.html)
- Attributes:
  - `block.add_attdef(tag, ...)` defines attribute templates.
  - `Insert.add_auto_attribs({tag: value})` fills them in.
  - `get_attrib_text(tag)` and `has_attrib(tag)` read them back.
  - `add_auto_blockref()` wraps a reference in an anonymous `*U` block. You then have to resolve that block with `doc.blocks.get()`.

  — [ezdxf blocks tutorial](https://ezdxf.readthedocs.io/en/stable/tutorials/blocks.html)
- `Insert.virtual_entities()` yields the transformed block content without changing the drawing. `explode()` changes the drawing, and non-uniform scale can break text and hatches. — [ezdxf blocks tutorial](https://ezdxf.readthedocs.io/en/stable/tutorials/blocks.html)

**Dynamic blocks**
- A dynamic block reference points to an anonymous `*U...` block whose name changes once a dynamic property is modified. The user-facing name is the "EffectiveName". — [Autodesk forum](https://forums.autodesk.com/t5/ObjectARX/the-EffectiveName-of-a-Dynamic-Block/m-p/4720785); [Bricsys EffectiveName](https://developer.bricsys.com/bricscad/help/en_US/V24/DevRef/source/Properties_EffectiveName.htm)
- In raw DXF you recover the original block by following this chain:
  1. the INSERT's `ACAD_XDICTIONARY`
  2. the `AcDbBlockRepresentation` dictionary
  3. the `AcDbRepData` record, whose 340 handle points to the original BLOCK_RECORD

  — [Autodesk blog: dynamic block from anonymous block](https://blog.autodesk.io/how-to-get-dynamic-block-from-anonymous-block/)
- I found no ezdxf documentation for a built-in "effective name" helper. See Gaps.

**Units**
- Modelspace units come from `$INSUNITS` via `doc.units`. 0 means unitless, 1 inch, 4 mm and 6 m.
- Do not read modelspace units from the modelspace layout's `units` property, because it is always 0. Block layouts carry their own `units`.
- `ezdxf.units.conversion_factor(src, dst)` converts between units.
- `$MEASUREMENT` (imperial/metric linetypes and hatches) is independent of `$INSUNITS`. `$LUNITS` only affects display.
- Neither CAD apps nor ezdxf convert units implicitly.

— [ezdxf units concept](https://ezdxf.readthedocs.io/en/stable/concepts/units.html)

**Bounding boxes**
- `ezdxf.bbox.extents()`, `multi_flat()` and `multi_recursive()` compute bounding boxes, with an optional `Cache`. Curves are flattened at a default 0.01.
- Text boxes are inaccurate.
- ACIS entities (BODY, 3DSOLID, REGION), XREF/UNDERLAY and infinite lines are silently ignored.

— [ezdxf bbox](https://ezdxf.readthedocs.io/en/stable/bbox.html)

**ACIS / 3DSOLID**
- `ezdxf.acis.api.load_dxf(entity)` loads ACIS bodies. ezdxf has no ACIS kernel, so it can only extract polyhedra (flat polygon faces). Faces without straight-line boundaries are lost.
- Unsupported ACIS entities load as NONE_ENTITY. ezdxf reads SAT and SAB but writes only SAT.

— [ezdxf ACIS tools](https://ezdxf.readthedocs.io/en/stable/tools/acis.html); [acis.rst on GitHub](https://github.com/mozman/ezdxf/blob/stable/docs/source/acis.rst)

**Drawing add-on (`ezdxf.addons.drawing`)**
- Backends: Matplotlib (PDF, SVG, PNG), PyQt (interactive), SVGBackend, PyMuPdf (PDF/PNG), Plotter (HPGL/2), DXFBackend, and GeoJSON and CustomJSON backends added in 1.3.0. A Recorder/Player pair supports bounding-box and transform measurement.
- Limits: there is no 3D engine. 3D is projected onto XY, top view only, and ACIS is not rendered. MTEXT is close to AutoCAD but not pixel-perfect.

— [ezdxf drawing add-on](https://ezdxf.readthedocs.io/en/stable/addons/drawing.html)

**odafc add-on**
- `odafc.readfile()` converts DWG/DXB/DXF to a temporary DXF and loads it. `export_dwg(doc, ...)` writes DWG, and `convert(src, dest, version)` converts between formats. `is_installed()` checks for the converter.
- It needs ODA File Converter installed separately. The default Windows path is `C:\Program Files\ODA\ODAFileConverter\ODAFileConverter.exe`, and the GUI is suppressed on Windows. Versions R12 to R2018 are listed.
- The docs warn that running an external executable is a security risk.

— [ezdxf odafc](https://ezdxf.readthedocs.io/en/stable/addons/odafc.html)

**dxf-viewer (JS)**
- 2D DXF viewer on three.js/WebGL, licensed MPL-2.0. It can parse in a web worker and uses batching and instanced rendering for block instances. It supports TTF fonts and layer visibility.
- Not supported: paper space, layouts and viewports, line patterns, wide polylines, most hatch variants and leaders. Extrusion only works along ±Z, and there is no stream parsing (JS string limits apply around 1 GB).

— [vagran/dxf-viewer](https://github.com/vagran/dxf-viewer)

### Inferences
- Parse on the backend with ezdxf and send the frontend a normalised JSON scene, not raw DXF.
- Use dxf-viewer, or an ezdxf SVG/CustomJSON render, only as an optional 2D "underlay" layer in three.js. Its MPL-2.0 license is file-level copyleft, so it is fine in a commercial app if changes to its own files are published.
- Fountain DWGs usually show nozzles and lights as 2D plan symbols. 3DSOLID content is a secondary path, and ezdxf's polyhedral-only ACIS support is acceptable for faceted pool and basin solids but not for curved pipework.
- Always transform with the INSERT's full matrix (`Insert.matrix44()` / `ucs()`), not just insert point plus rotation. This handles OCS extrusion (mirrored blocks have extrusion (0,0,-1)). This is standard ezdxf API, but I did not fetch its page in this session.

### Gaps
- I did not find documentation of an ezdxf-native "effective name" helper for dynamic blocks. Implement the XDICTIONARY → AcDbBlockRepresentation chain manually, and test it against real AutoCAD files.
- three-dxf and dxf-parser (JS): I did not verify their current maintenance status or licenses in this session. Both are older MIT projects per general knowledge, so verify before adopting. dxf-viewer looks like the stronger JS option.
- The ezdxf XDATA/AppData API was not fetched in this session. It is a well-known capability (`entity.get_xdata(appid)` / `set_xdata`), but confirm it against the docs.

## 2. DWG reading: which routes are legally and practically viable for a commercial desktop product?

### Takeaway
There is no free, permissive, redistributable DWG reader. The clean options are:
- **Option A (ships now):** DXF-first import. The user exports DXF from AutoCAD, or the app calls an ODA File Converter that the user installed themselves, if the license allows that. It does not, for non-members commercially (see below).
- **Option B:** ODA membership (Drawings SDK, paid annual subscription with distribution rights).
- **Option C:** APS Model Derivative cloud conversion (tokens; online only).

LibreDWG is GPLv3+, so it cannot be linked into a closed product. Running it as a separate process is a legal grey area.

### Cited Findings
**ODA File Converter**
- It is a free download but an "example project". The ODA states: "If you are not an ODA member, you can use them for non-commercial applications only," and "We do not distribute ODA File Converter; we distribute our SDKs." Older builds are members-only. — [ODA: What are ODA Viewer and ODA File Converter?](https://www.opendesign.com/node/3218)
- Platforms: Windows 10+ x64 (MSI), Linux (RPM/DEB/AppImage) and macOS 13+.
- The CLI takes: source dir, target dir, input filter (default `*.dwg;*.dxf`), output version/type, recursive flag and audit flag.

  — [ODA File Converter page](https://www.opendesign.com/guestfiles/oda_file_converter)

**ODA membership (from search summaries of opendesign.com)**
- Any distribution, whether free or paid, needs Commercial membership or higher. Commercial membership is limited to 100 distributed seats, and larger distribution needs Sustaining membership.
- The SDK is an annual subscription. If it lapses, you lose the right to distribute the ODA-based product.

— [ODA business FAQ](https://www.opendesign.com/faq/business-questions); [ODA pricing](https://www.opendesign.com/pricing/individual). I could not fetch these pages directly (they returned 406 or empty), so treat them as unverified and confirm with ODA (admin@opendesign.com).

**LibreDWG**
- Licensed GPLv3+. The 0.13.x manual reports about 99% read coverage of DWG r1.2 to r2018.
- Writing is by default r2000 or older. Writing r2004+ needs code patches.

  — [GNU LibreDWG manual](https://www.gnu.org/software/libredwg/manual/LibreDWG.html); [Wikipedia](https://en.wikipedia.org/wiki/LibreDWG)
- A 0.14 series exists according to a release tracker, but I did not confirm its status. — [releasealert](https://releasealert.dev/github/LibreDWG/libredwg)
- One forum opinion is informal and not legal advice. It says invoking a separately installed LibreDWG as a converter is not restricted, but linking it as a library would require GPL-ing the app. — [OSArch community](https://community.osarch.org/discussion/comment/19805/)

**APS (Autodesk Platform Services) Model Derivative API**
- Published rates: 0.5 Flex tokens per "complex" job and 0.1 per "simple" job. Flex tokens expire 12 months after purchase. — [APS token estimator blog](https://aps.autodesk.com/node/2846); [APS bundles](https://aps.autodesk.com/node/3572)
- A September 2025 announcement introduced Free and Paid tiers. Under Free, Model Derivative is "rated", meaning it has monthly limits. Paid offers Prepay-with-Flex or Pay-as-you-go. — [APS 15 Sep 2025](https://aps.autodesk.com/node/3776)
- Sources disagree on when the new model took effect: September versus December 2025. The current pricing page redirected and then returned 403. — [APS pricing](https://aps.autodesk.com/pricing)

**Teigha**
- Teigha is the former name of the ODA SDKs. I found no separate current source in this session.

### Inferences
- **Recommended for v1:** accept DXF natively with ezdxf. For DWG:
  1. Tell users to SAVEAS/DXFOUT from AutoCAD. This is the zero-licensing path and the AutoCAD plugin in §5 makes it easy.
  2. If the user has installed ODA File Converter themselves, ezdxf `odafc` can call it. ODA's terms say non-members may only use it non-commercially, so a commercial fountain-design firm using it through AquaFlow is probably outside the terms. Do not bundle it, and get a written answer from ODA before enabling this path.
  3. For first-class DWG support, budget for ODA Commercial membership, noting the 100-seat cap, and use the Drawings SDK (C++/.NET) in a small sidecar converter.
- Treat APS Model Derivative as an optional cloud feature only. It needs internet, uploads client IP to Autodesk, and its output (SVF2/OBJ/etc.) loses the block and attribute semantics you need for recognition. It suits a 3D visual reference mesh, not component recognition.
- LibreDWG as a separate, user-installed subprocess is legally arguable but risky for a commercial product, and its write support is weak. I do not recommend it as the default.

### Gaps
- Current ODA membership prices and the exact File Converter EULA text could not be fetched.
- Current APS free-tier monthly caps and the USD price per Flex token were not found.
- APS Model Derivative output-format matrix for DWG input (for example, whether glTF/OBJ is offered directly) was not verified in this session.

## 3. 3D formats: IFC, glTF, FBX, OBJ, STEP, and getting 3D out of AutoCAD

### Takeaway
For 3D, prefer glTF/GLB, which three.js loads natively. Add web-ifc (MPL-2.0) for IFC and occt-import-js (LGPL-2.1, WASM) for STEP/IGES/BREP. Both are viable commercially under their weak-copyleft terms.

### Cited Findings
- **web-ifc:** reads and writes IFC in JS with a C++ core compiled to WASM (browser, multithreaded and Node builds). Licensed MPL-2.0, roughly 1.1k stars, with a regression test suite. — [ThatOpen/engine_web-ifc](https://github.com/ThatOpen/engine_web-ifc)
- **occt-import-js:**
  - Reads STEP, IGES and BREP via OpenCascade compiled to WASM, licensed LGPL-2.1.
  - Output is JSON with a node hierarchy and three.js-compatible mesh attributes (position, normal, index, colour, brep_faces).
  - Tessellation parameters: `linearUnit`, `linearDeflection` and `angularDeflection`.

  — [kovacsv/occt-import-js](https://github.com/kovacsv/occt-import-js)
- ezdxf can read 3DSOLID only as polyhedra (see §1). — [ezdxf ACIS tools](https://ezdxf.readthedocs.io/en/stable/tools/acis.html)

### Inferences
- Ways to get 3D out of AutoCAD:
  - From inside AutoCAD (a plugin or the user), export FBX (FBXEXPORT) or STL/OBJ, then convert to GLB in the pipeline.
  - Use the APS Model Derivative cloud.
  - Use a Drawings SDK sidecar (ODA licensing).
- IfcOpenShell (Python, LGPL per general knowledge, not verified this session) is a backend alternative to web-ifc.
- For Revit, the usual path is IFC export from Revit followed by web-ifc or IfcOpenShell.
- Load FBX with three.js FBXLoader, or convert it to GLB offline. Prefer GLB as the internal 3D asset format.
- Ship LGPL WASM (occt-import-js) as a separate, unmodified, replaceable module to stay LGPL-compliant.

### Gaps
- I did not verify the 3D DWF route, FBXEXPORT behaviour in AutoCAD 2026, IfcOpenShell's license, or Autodesk's FBX SDK license in this session.

## 4. Recognition heuristics, units, origin, XREFs, and lessons from previs tools

### Takeaway
Even mature lighting previs tools do not auto-detect fixtures from arbitrary DWGs. They rely on block instances and on user mapping of block or "drawing name" to library fixture, often driven by a data CSV. AquaFlow should do the same: deterministic rules plus a user-review UI, with saved mapping templates.

### Cited Findings
- **Capture (lighting previs):**
  - Capture "is not able to do that automatically". Users drag a library fixture onto a DWG block to replace it, and this only works if the DWG uses blocks. — [Capture forum](https://www.capture.se/Support/Forum/aft/8825)
  - Capture's data import uses a "drawing name" concept to replace imported blocks with library fixtures. When importing from MagicVis, grandMA2 or Vectorworks, "the only manual step necessary is identifying the fixture types referenced". The Vectorworks workflow is a DWG plus an "Instrument data" CSV. — [Capture Data Import](https://www.capture.se/Products/News-in-Nexum/Data-Import); [Capture DWG/DXF import](https://www.capture.se/Products/News-in-Nexum/DWG-DXF)
  - Unit mismatches (mm versus m) cause misplacement. Users also export the DWG with the fixture layer off so library fixtures replace the original symbols. — [Capture forum](https://www.capture.se/Support/Forum/aft/2214); [Capture manual: model import](https://capture.se/Manual/2019/model-import.html)
- Modelspace units must come from `$INSUNITS`. 0 means unitless and must be asked of the user. — [ezdxf units](https://ezdxf.readthedocs.io/en/stable/concepts/units.html)
- Dynamic blocks show up as `*U` anonymous names and must be resolved to their effective name before name-based matching. — [Autodesk blog](https://blog.autodesk.io/how-to-get-dynamic-block-from-anonymous-block/)

### Inferences (proposed pipeline design)
1. **Ingest.** Accept DXF directly. For DWG, use DXF from a plugin or user export, or an optional licensed converter. Use APS for a visual-only cloud mesh. Accept GLB, IFC and STEP as separate 3D layers.
2. **Normalise (backend, ezdxf):**
   - Resolve units: `$INSUNITS`, otherwise ask the user, and suggest a unit by comparing extents with typical pool sizes.
   - Convert everything to metres.
   - Walk modelspace recursively. For every INSERT, compute the world matrix through nested blocks, record the block path, effective name, layer (resolving layer "0" inheritance), ATTRIB tag/value dict, XDATA/AppData, and the bbox from `ezdxf.bbox`.
   - Flatten loose geometry into polylines and circles per layer.
   - XREFs: list unresolved XREF blocks and ask the user to supply the files. Alternatively, ask them to BIND/eTransmit in AutoCAD. ezdxf bbox ignores XREFs.
3. **Recognise:** use a scored rule engine with these signals, strongest first:
   1. AquaFlow-authored XDATA or attributes (for example an `AQF_TYPE` tag) from round-trip or plugin exports. These are exact.
   2. User or saved template rules, as regex on effective block name or layer.
   3. Attribute tags such as MODEL, TYPE or NOZZLE.
   4. Layer-name keywords (NOZZLE, JET, LED, PUMP, VALVE, in several languages).
   5. Geometry signature: a small circle of a given diameter, repeated N times on a ring or line, gives a candidate nozzle array.
   6. Block instance counts and symmetry.

   Each match produces `{source_entity, candidate_type, confidence, reasons[]}`.
4. **Map:**
   - Each AquaFlow object (nozzle, light, pump, valve, basin outline, pipe run) is placed at the transformed insertion point.
   - Rotation comes from the matrix. Height comes from Z, an attribute, or a default.
   - Model and parameters come from attributes, looked up in AquaFlow's library.
   - Keep a stable `source_handle` for re-import and diffing.
5. **Review UI (three.js):**
   - Show the 2D underlay with recognised objects coloured by confidence.
   - Group by block name and layer, with "apply to all instances of block X".
   - Let the user set the origin by picking a point, set rotation by aligning an edge, and override units.
   - Save the mapping as a reusable template for each client or consultant CAD standard.
6. **Re-import:** match on handle or AQF id, and show a diff (added, moved, removed).

### Gaps
- I did not fetch primary documentation on how Revit's DWG import, Vectorworks, Depence or WYSIWYG map symbols. Only Capture's workflow is sourced here.

## 5. Round-trip export (DXF from AquaFlow) and AutoCAD plugin options

### Takeaway
ezdxf can write DXF with block definitions, ATTDEF/ATTRIB and XDATA, so AquaFlow layouts can go back to AutoCAD with structured attributes. If ODA is licensed, odafc or the SDK can also write DWG. For structured export from AutoCAD itself, a .NET plugin (or AutoLISP) that writes JSON is cheapest. APS Design Automation for AutoCAD runs the same logic headless in the cloud.

### Cited Findings
- ezdxf creates block definitions with `doc.blocks.new()` and references with `add_blockref()`, and attaches attributes with `add_attdef` / `add_auto_attribs`. — [ezdxf blocks tutorial](https://ezdxf.readthedocs.io/en/stable/tutorials/blocks.html)
- `odafc.export_dwg(doc, filename, version)` writes DWG through ODA File Converter. — [ezdxf odafc](https://ezdxf.readthedocs.io/en/stable/addons/odafc.html)
- ezdxf writes ACIS as SAT only, for polyhedral bodies. — [ezdxf ACIS tools](https://ezdxf.readthedocs.io/en/stable/tools/acis.html)
- Design Automation for AutoCAD runs on `accoreconsole.exe`, the console AutoCAD shipped since 2013.
  - OPEN and NEW are unsupported, and so is `Database.ReadDwgFile` in that context.
  - Locally you load drawings with `/i`, and PackageContents.xml autoload is unsupported.

  — [Autodesk dev blog (JP) notes on DA4A](https://blog.autodesk.io/notes-on-using-da4a/)
- A third-party review says Design Automation consumes APS tokens, has cold-start latency of seconds per job and per-engine concurrency limits, and that token pricing is hard to forecast. — [supergood.ai API report card](https://supergood.ai/api-report-card/autodesk-autocad). This is a secondary source.

### Inferences
- **Export spec:**
  - One block per AquaFlow component type, named for example `AQF_NOZZLE_<model>`.
  - ATTDEFs for ID, MODEL, HEIGHT, CHANNEL and DMX/PLC address.
  - XDATA under a registered appid `AQUAFLOW` carrying the internal UUID.
  - Layers per system (AQF-NOZZLES, AQF-LIGHTS, AQF-PIPING).
  - `$INSUNITS` set to mm or m.

  This makes round-trip re-import exact (signal 1 in §4).
- **AutoCAD-side export plugin, in order of preference:**
  1. A .NET (C#) plugin: a NETLOAD/bundle that iterates block references, reads EffectiveName and attributes, and writes JSON. It runs locally with no licensing cost to AquaFlow beyond the user's AutoCAD.
  2. An AutoLISP script, the simplest option to distribute.
  3. The same .NET code under Design Automation, for batch or cloud use.

  The plugin removes the need for any DWG parser, because AutoCAD itself is the reader.

### Gaps
- Current Design Automation token rates were not found.
- I did not verify ezdxf XDATA write API details or AutoCAD Web API scripting capabilities in this session.
