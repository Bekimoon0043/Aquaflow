# Fountain CAD Design Practice and How Fountain-Show Software Consumes Designs

Research date: 2026-10-13. Scope: real-world fountain engineering CAD workflow (what a fountain DWG contains, how components are drawn and annotated) and how fountain-show and previsualization tools import or model layouts. Aimed at informing an AquaFlow DWG/DXF importer that recognises fountain components.

Overall caveat: public, primary documentation on fountain *CAD conventions* (layer/block/attribute names) is very sparse. Vendors (WET, Crystal, OASE, Lumiartecnia) do not publish their internal CAD standards. Much of what follows about layers/blocks is therefore in Inferences or Gaps, not Cited Findings.

## 1. What fountain design drawings contain (plans, schedules, layers, blocks, attributes)

### Takeaway
A fountain construction set is organised around **equipment ID tags** that link plan symbols to schedules (pumps, filters, lights, controllers, a "miscellaneous" table for nozzles) plus a hydraulic P&ID-style schematic with pipe sizes, piping layout, equipment-room plans, hardware details, and electrical plans/schematics. No published industry-wide fountain layer or block-naming standard was found; NCS-style discipline prefixes (L- landscape, P- plumbing, E- electrical) are the nearest convention.

### Cited Findings
- Watershapes (fountain design trade magazine) describes using equipment ID tags so that drawings, plans and specs all reference schedule entries; schedules are typically kept for pumps, filters, heaters/chillers, lighting, controllers, plus a "Miscellaneous" table for items like nozzles; on large jobs the schedules occupy a full Arch-D (24x36 in) sheet and act as a "shopping list" for contractors bidding the work — [Watershapes, "Keys to Consistency"](https://watershapes.com/keys-to-consistency/) (summarised via search result; direct fetch failed with connection refused).
- Waterline Studios (fountain design consultancy) lists its construction-document deliverables: final piping layout coordinated with civil/MEP/landscape/architectural plans with utility connection points; scaled plans of equipment spaces showing structure affecting pipe routing; details for pool hardware and fittings (installation and fabrication); details for controls such as wind sensors and water-level sensors; a hydraulic (P&ID) diagram specifying pipe dimensions and instruments; electrical schematics and electrical plans for lighting, equipment and controls; project specifications — [Waterline Studios, Construction Documentation](https://waterline.com/qualifications/design-services/construction-documentation/).
- Delta Fountains describes the four main parts of construction documentation as specifications, drawings, cost estimation and engineering, and stresses final drawings with enhanced details ("There cannot be too much information provided") — [Delta Fountains](https://www.deltafountains.com/?p=6568).
- A freely downloadable GHESA fountain hydraulic DWG (labelled WF02-A) contains a plan view and a section view at 1:20 (metric), an "elements table" listing nozzles with LED lights, pumps, globe valves and stainless-steel hardware, a unions table, and construction notes; preview shows nozzles and pipes in plan and section — [DesignsCAD, GHESA Fountain Hydraulic Plan & Section](https://designscad.com/downloads/ghesa-fountain-hydraulic-plan-section-cad-dwg/).
- University of Houston master spec Section 13 12 13 (fountains) covers water pumps and filters, sensors and controllers, valves, nozzles, drains, piping, valve and junction boxes, electrical power and lighting — the categories a drawing set must depict — [UH Master Spec 131213](https://www.uh.edu/facilities-planning-construction/vendor-resources/owners-design-criteria/master-specs/jan-2016/13/131213.pdf) (via search summary). CSI section for fountains is 13 12 00 — [ARCAT Fountains 131200](https://www.arcat.com/content-type/bim/special-construction-13/fountains-131200).
- A Chinese musical-fountain supplier states the buyer usually supplies the size/shape of the water area, usually as AutoCAD drawings; the supplier returns a design package of AutoCAD drawings, perspective renderings and a bill of quotation — [b2usa musical fountain supplier page](https://b2usa.com/hotsite/wwwchuinamusicfoun/musical-fountain-dancing-water-fountain-) (vendor marketing, low authority).
- A University POLITEHNICA of Bucharest paper on dry (deck) fountains modelled fountain operation using GNU Octave and AutoCAD to mimic dancing jets, and identifies the key design challenge as the pump scheduling algorithm (start/stop and variable-speed time pattern of each pump) — [UPB Scientific Bulletin](https://scientificbulletin.upb.ro/static/pdfs/rez5e3_690095.pdf) (via search summary).
- NCS-based layer standards use discipline designator "L" for Landscape (e.g. L-PLNT, L-SITE-FNCE) and "P-DOMW" for plumbing domestic water; none of the surveyed university/agency NCS adaptations defines a fountain-specific layer — [USF AutoCAD Layer Guide](https://WWW.USF.EDU/administrative-services/documents/design-construction/guide-autocad-layers.pdf); [U Calgary Layer Naming Convention](https://live-ucalgary.ucalgary.ca/sites/default/files/teams/223/Design%20Standards/8.4.2%20Layer%20Naming%20Convention.pdf).
- Crystal Fountains nozzle product listings (via Pool360 distributor) give model codes and key parameters but list documents/schematics/CAD as unavailable: e.g. WMF-076 30° Crown Jet (1" inlet, 15° or 30°), WMD-100 25 mm Deck Level Stream Jet (10 mm orifice, adjustable to 25° from vertical), WMT-110A501 20° Firefly Jet (8 streams, cast bronze, requires 2 mm pump inlet strainer), WDK-100 Deckjet kit (1" NPT inlet) — [Pool360 CFT-27-203](https://www.pool360.com/Product/pool-cft-27-203); [CFT-27-207](https://www.pool360.com/Product/pool-cft-27-207); [CFT-27-219](https://www.pool360.com/Product/pool-cft-27-219); [CFT-27-304](https://www.pool360.com/Product/pool-cft-27-304).
- A fountain is described as three subsystems on one basin: hydraulics (centrifugal pumps, typically 0.5–75 kW per zone), optics (RGB LEDs driven over DMX) and control — [FIRGELLI, Luminous Fountain Mechanism](https://www.firgelliauto.com/blogs/mechanisms/luminous-fountain) (secondary/blog source).

### Inferences
- The **tag** (e.g. a schedule ID referenced next to a plan symbol) is the strongest, most portable link between geometry and engineering data in real fountain drawings. An importer should look first for (a) block INSERTs with attributes, (b) TEXT/MTEXT/MLEADER tags placed near symbols, and (c) schedule TABLE entities or text grids, then join them on tag IDs.
- Because schedules are often drawn as TABLE objects or exploded text grids (and the GHESA example uses an "elements table"), a robust importer needs to parse ACAD_TABLE entities and also reconstruct tables from aligned TEXT entities.
- Since no fountain layer standard exists, layer-name recognition should be heuristic and user-configurable: match keywords in multiple languages (NOZZLE/JET/BOQUILLA/DUESE, PUMP/BOMBA/PUMPE, LED/LIGHT/LUZ, VALVE/VALV, PIPE/TUB) plus NCS discipline prefixes (L-, P-, E-, M-), with a mapping UI to confirm.
- Typical sheet categories to expect in a full musical-fountain set: basin/site plan; nozzle layout plan (often ring/line arrays); piping plan with manifolds/headers; equipment room plan; hydraulic P&ID; sections/elevations through basin and nozzle niches; electrical single-line and power/control plans; lighting layout; schedules sheet. (Composite of the cited deliverable lists.)
- Musical-fountain DWGs from Chinese/Middle-East suppliers are largely 2D plan symbols plus a quotation list; 3D geometry is rare, so the importer should treat 2D symbol positions + attributes as the primary data and generate 3D from a component library.

### Gaps
- No primary source found for a vendor's internal layer naming or block naming conventions (WET, Crystal, OASE, Fontana, Safe Rain, Aquatique Show, Lumiartecnia). No published attribute schema (e.g. NOZZLE_TYPE, FLOW, HEIGHT, DMX_ADDR, PUMP_ID) was found.
- Could not retrieve actual block-library DWGs (CADdetails / BIMobject fountain blocks) to inspect their attribute definitions; Crystal Fountains CAD was listed as unavailable on the distributor site.
- No published sample of a fountain electrical single-line diagram or cable schedule format.

## 2. Hydraulic design calculations accompanying CAD and tools used

### Takeaway
Fountain hydraulics are done with Bernoulli energy balance from pump outlet to each nozzle base, with friction losses via Darcy-Weisbach or Hazen-Williams and fitting K-factors; practitioners commonly use Excel workbooks and EPANET, and select pumps from flow-head curves at the calculated total dynamic head. Jet height depends on nozzle type, flow and base pressure.

### Cited Findings
- Safe Rain (Spanish fountain manufacturer): jet height depends on nozzle type (lance, cascade, geyser, foam jet), flow rate and pressure at the nozzle base; Bernoulli's equation is applied between pump outflow (point 1) and nozzle base (point 2) including losses; straight-pipe losses via Darcy-Weisbach (friction factor f, length L, inside diameter D, velocity V), with Hazen-Williams, Chezy and Manning as alternatives; fitting losses via K coefficients, or equivalent length L_eq = K·D/f; unit conversions 1 kPa ≈ 0.102 m.w.c., 1 kg/cm² ≈ 10 m.w.c. — [Safe Rain, Hydraulic calculations for architectural fountains](https://saferain.com/en/blog/hydraulic-calculations-for-architectural-fountains/).
- Safe Rain's main tool is Excel (a free downloadable calculation workbook with linked sheets such as "Water properties" and "Calculating hf"); it recommends free EPANET for more complex networks; author's book: *Hydraulics of architectural water features and hydraulic installations* — [Safe Rain](https://saferain.com/en/blog/hydraulic-calculations-for-architectural-fountains/).
- Ideal (lossless) vertical jet: v = √(2gh); a 20 m jet requires ≈20 m/s exit velocity; real pumps need more head because of losses — [CollegeDunia worked problem](https://questions.collegedunia.com/exams/questions/a-fountain-has-to-be-designed-to-raise-water-to-a-682f0d41dbf8c33dab3904ec) (educational, low authority).
- Hazen-Williams C values ≈145 PVC, 130 new galvanized steel, 100 old galvanized steel; worked example sizing a pipe for two 0.2 L/s fountains — [Pratiques/Interaide Bernoulli & Hazen-Williams note](https://reseau-pratiques.org/wp-content/uploads/2023/07/145-bernouillli-English.pdf).
- US-units Hazen-Williams head loss as used in water-feature calculators: hf = 10.67·L·Q^1.852/(C^1.852·d^4.87) (as quoted; note the 10.67 constant is the SI form with L, hf in m, Q in m³/s, d in m — the calculator's claim of feet/GPM/inches is inconsistent), and TDH = lift + hf — [Water Feature Flow Calculator](https://codingace.net/gardening/water_feature_flow.php) (low authority; units contradictory).
- Pump head must match nozzle pressure plus pipe losses; an undersized pump gives a short jet while an oversized one breaks a laminar stream into spray — [FIRGELLI](https://www.firgelliauto.com/blogs/mechanisms/luminous-fountain).
- Musical-fountain design centres on pump scheduling (start/stop and VFD speed time-patterns per pump) — [UPB Scientific Bulletin](https://scientificbulletin.upb.ro/static/pdfs/rez5e3_690095.pdf).

### Inferences
- For an importer, the useful hydraulic data to capture per nozzle is: nozzle type/model, orifice or nominal size, design flow, design height, and design base pressure; per pump: ID, rated flow/head, power, VFD yes/no; per pipe: nominal diameter and material (for C value). These allow AquaFlow to compute jet height vs VFD speed (affinity laws: flow ∝ speed, head ∝ speed²) and validate the show against hydraulic limits.
- Topology (which nozzles are fed by which header/manifold/valve/pump) is the critical link for show software (see Depence's nozzle→valve→pump dependencies below). In DWGs this topology is usually implicit in pipe polylines connecting symbols, so the importer should attempt polyline-endpoint connectivity analysis with tolerance, then let the user confirm groups.

### Gaps
- No primary source confirmed use of AutoCAD MEP, Revit MEP, AutoCAD Plant 3D, or Pipe Flow Expert specifically by fountain vendors; only Excel, EPANET, AutoCAD (2D) and GNU Octave were evidenced.
- No vendor-published nozzle flow-vs-height curves were retrieved (OASE/Crystal publish these in catalogs, but not fetched).
- No authoritative source on pipe velocity limits for fountain headers was found in this pass.

## 3. Vendor practices and fountain-show software (OASE, Crystal, WET, Safe Rain, Lumiartecnia, Syncronorm Depence, etc.)

### Takeaway
Fountain-show software models fountains as linked device objects (nozzle → valve → pump, plus lights) rather than importing engineering DWGs semantically. Depence (Syncronorm, sold by Pangolin) is the dominant high-end previs with a real-time hydrodynamics engine; OASE WEPS is a free block-visualisation programmer for WECS III controllers. None of the surveyed tools advertises recognising fountain components from DWG.

### Cited Findings
- Depence fountain module: physics engine computes fountain hydrodynamics in real time (water collisions, splashes); nozzles are linked to valves and valves to pumps via "Dependencies", which feed hydrodynamic and lighting calculations, analogous to real pipes and cabling; nozzles can be combined with moving fixtures and lights and fixtures "snapped" onto other fixtures (modular devices) — [Syncronorm Depence fountains](https://syncronorm.com/products/depence2/visualization/fountains); [Pangolin Depence Fountain Module](https://pangolin.com/products/depence-fountain-module).
- Depence R4 Fountain Module price listed at US$11,400 — [Pangolin](https://pangolin.com/products/depence-fountain-module).
- Syncronorm markets its visualizer for multimedia fountains as able to pre-program a complete show while rendering fountains, lighting, lasers, flames and video in real time — [Syncronorm Depence visualization](https://www.syncronorm.com/products/depence/visualization).
- OASE WEPS (Water Entertainment Programming Software): free; graphical overview of the system configuration for building water pictures and scenes; live control of a connected WECS III; show start from hardware or scheduler; up to 1,024 DMX channels; aimed at small/mid systems; uses "simple display in block visualisation" — [OASE WEPS](https://www.oase.com/en-US/fountain-technology/weps-software).
- OASE WECS III controllers: stand-alone DMX/RDM fountain controllers, 64 to 1,024 channels, bidirectional RDM status feedback, built-in web server — [OASE WECS III 1024 DMX02](https://www.oase.com/en-US/water-technology/wecs-iii-1024-dmx02).
- Lumiartecnia: American/Spanish engineering firm for water fountains, aquatic ballet and musical fountains; known for the Digital Water Curtain, a computer-controlled "water plotter" that switches fast-acting valves to display graphics/text — [Lumiartecnia "How we work" (ArchiExpo)](https://pdf.archiexpo.com/pdf/lumiartecnia-internacional/how-we-work/80362-316693.html). Its programming/simulation software was not identified.
- Capture (visualiser) removed the limit on the number of Water Jets per edition in its 2021 release, indicating native water-jet fixtures — [Capture News in 2021](https://www.capture.se/Products/News-in-2021).
- A patent family "Pixelated water display and design tools therefor" covers tools to design, simulate and control water-curtain displays — [USPTO 11938502](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11938502).

### Inferences
- The competitive pattern is: geometry comes from CAD/3D as dumb scenery; fountain devices are placed natively from the show tool's own library and wired logically (nozzle/valve/pump/light). An importer that turns DWG symbols + schedule attributes directly into linked AquaFlow devices (with pump groups and DMX patch) would be a genuine differentiator.
- Depence's nozzle→valve→pump dependency graph is a good target data model for AquaFlow's import output.

### Gaps
- No public information found on WET Design, Crystal Fountains (beyond nozzle specs), Fontana Fountains, Aquatique Show internal tools, or "SHOW-MAX" / "Aquatic Show Programmer" software capabilities or import formats.
- No primary source on vendor CAD block libraries on CADdetails/BIMobject (ARCAT has a 13 12 00 Fountains BIM/CAD category but contents were not inspected).
- A Danish consultancy PDF ("Show programmering DMX", Vandarkitekterne) that likely documents a real fountain DMX channel plan could not be fetched (HTTP 429) — [link](https://vandarkitekterne.eistrupweb.dk/wp-content/uploads/2025/05/Show-programmering-DMX.pdf).

## 4. How previsualization tools import CAD and map fixtures to patch addresses

### Takeaway
Previs tools import CAD primarily as scenery (meshes), and carry fixture identity, position and DMX patch via **MVR** (DIN SPEC 15801) with GDTF fixture types. Depence imports DXF only as 2D and does not list DWG; Capture imports DWG with layers and de-duplicates identical blocks; Vectorworks → visualiser round-trips go through MVR. Fixture types usually must be re-matched manually after import.

### Cited Findings
- Depence supported 3D import formats: Collada .dae (recommended), 3DS, SketchUp .skp (recommended), OBJ (recommended), AutoCAD DXF (**"Only 2D"**), LightWave, DirectX .x, STL, AC3D, ASE, FBX (recommended; animations, max 96 bones). DWG is not listed. 3DS limits texture names to 8 chars and stores no normals — [Depence Supported 3D-Model Import Formats](https://help.depence.com/depence-program-overview/depence-supported-file-formats/depence-supported-3d-model-import-formats.md).
- Depence modelling tips: keep scenes under ~3–4 million polygons; remove small invisible parts (holes, screws); merge/optimise; fix normals/winding; correct UVs; textures 1024² or 2048², power-of-two — [Depence Tips & Tricks for 3D modeling](https://help.depence.com/depence-construction/depence-import-3d-models/depence-tips-and-tricks-for-3d-modeling.md).
- Depence MVR import transfers fixtures, patch (DMX addresses), positions, fixture IDs and 3D models; because Depence does not use GDTF, each imported fixture type must be manually matched to a Depence library fixture (choose DMX mode, then drag library fixture); "Remove none exist" only affects objects from a previous MVR import. MVR export only carries dummy fixtures and no 3D models — [Depence MVR](https://help.depence.com/depence-construction/mvr.md).
- Depence supports fixtures with multiple DMX addresses (sub-parts such as main fixture + pixel engine each with own modes); patching the parent auto-patches sub-parts in their first mode; Fixture Manager sorts/filters, selection order sets patch order — [Depence Patching and Multiple DMX Address](https://help.depence.com/depence-construction/fixtures/patching-and-multiple-dmx-address.md). Depence also documents a Fixture Hang Tool, Spline Arrange (array along a spline), Modular Fixtures and a Channel Patch — [Depence docs index](https://help.depence.com/llms.txt).
- Capture: imports 3D venue models with materials and layers from formats including DWG; 2021 added shared geometry in DWG import ("preventing duplication during import of multiple identical block references") and MVR import/export including fixture and patch info; fixture modes can be imported from CSV — [Capture News in 2021](https://www.capture.se/Products/News-in-2021); [Capture Solo product page](https://www.elationlighting.com/capture-solo).
- Capture user workflow: export fixtures as MVR and other geometry as 3DS from Vectorworks, because MVR alone did not export all objects; patch transfers via MVR but fixture modes may need manual correction; textures do not always transfer — [Capture forum](https://www.capture.se/Support/Forum/aft/9394) (single-user reports, may be dated).
- Vectorworks → visualiser workflow: assign a GDTF fixture mode to each lighting device, Export MVR, import into console/visualiser, program and adjust DMX addresses, unit numbers, locations and geometry, export MVR back, re-import into Vectorworks choosing data, geometry or both — [Vectorworks 2018 Visualizer Data Exchange](https://app-help.vectorworks.net/2018/eng/VW2018_Guide/LightingDesign1/Workflow_Visualizer_Data_Exchange.htm). Depence has a "How to export MVR to grandMA3" guide — [Depence docs index](https://help.depence.com/llms.txt).
- MVR is a zip containing GeneralSceneDescription.xml plus GDTF files and 3D assets; standardised as DIN SPEC 15801, current MVR 1.6; GDTF 1.2 schema; fixture nodes carry position reference, UnitNumber, GDTFMode (must match a DMXMode name in the GDTF) and a container of DMX addresses — [MVR spec 1.6](https://github.com/mvrdevelopment/spec/blob/main/mvr-spec.md); [GDTF spec](https://github.com/mvrdevelopment/spec/blob/main/gdtf-spec.md); [Unreal UDMXMVRFixtureNode](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/DMXRuntime/UDMXMVRFixtureNode); [python-mvr](https://github.com/open-stage/python-mvr/blob/master/README.md).

### Inferences
- The industry-standard bridge from CAD to patched fixtures is MVR, not DWG. AquaFlow should (a) import DWG/DXF for geometry + component recognition, and (b) import/export MVR (via python-mvr) for fixture/patch interchange with grandMA3, Capture, Vectorworks and Depence.
- Because MVR/GDTF have no native fountain device classes (nozzle/valve/pump), fountain devices exported via MVR will appear as generic/dummy fixtures in other tools; AquaFlow should carry fountain semantics in its own data and use MVR only for positions and DMX addresses.
- Capture's de-duplication of identical block references suggests that DWG block INSERTs are a natural "instance" unit — the same unit an importer should use to recognise repeated nozzles/lights.
- Depence's DXF "2D only" limitation means fountain engineers handing DWGs to Depence must convert to FBX/OBJ/SKP; a native DWG/DXF path with 2D-to-3D extrusion is an opportunity.

### Gaps
- WYSIWYG, Vectorworks Vision, L8 and grandMA3 3D CAD-import specifics (supported formats, layer handling, auto-patch from CAD attributes) were not found in this pass.
- No evidence found of any previs tool auto-patching DMX from DWG block attributes.

## 5. Pain points moving designs between CAD and show software

### Takeaway
Documented pain points are mostly from lighting previs (applies directly to fountains): format limitations (DXF 2D-only, no DWG in Depence), fixture-type re-matching after MVR import, lost fixture modes, missing objects and textures, and heavy CAD geometry needing optimisation. Fountain-specific pain (no semantic component recognition, topology re-entry) is inferred rather than documented.

### Cited Findings
- Depence requires manual fixture matching on MVR import (no GDTF) and exports only dummy fixtures with no 3D models — [Depence MVR](https://help.depence.com/depence-construction/mvr.md).
- Depence accepts DXF only as 2D and no DWG — [Depence supported formats](https://help.depence.com/depence-program-overview/depence-supported-file-formats/depence-supported-3d-model-import-formats.md).
- CAD scenes must be cleaned (remove screws/holes, merge, fix normals, cap at 3–4 M polygons) before use in Depence — [Depence tips](https://help.depence.com/depence-construction/depence-import-3d-models/depence-tips-and-tricks-for-3d-modeling.md).
- Capture users report MVR from Vectorworks not exporting all objects (workaround: separate 3DS), fixture modes needing manual correction, and textures not always transferring — [Capture forum](https://www.capture.se/Support/Forum/aft/9394).
- Fountain coordination depends on consistent equipment tags between drawings, schedules and specs — implying inconsistency is a known risk — [Watershapes](https://watershapes.com/keys-to-consistency/).

### Inferences
- For fountains, the biggest unaddressed gap is that the nozzle/valve/pump/light topology and per-device engineering data in the DWG (tags, schedules) must be re-entered by hand in show software. An importer that extracts block attributes + tag text + schedule tables and builds the dependency graph addresses this directly.
- Other likely friction points to design for: unit ambiguity (mm vs m vs inches; check $INSUNITS), nested/dynamic blocks, exploded blocks (no attributes, just lines/circles), annotation in non-English languages, and symbols drawn as plain circles rather than blocks.

### Gaps
- No fountain-engineer forum threads or trade articles specifically describing CAD-to-fountain-show-software pain points were found.
