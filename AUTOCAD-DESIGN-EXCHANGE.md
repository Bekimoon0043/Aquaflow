# AquaFlow Engineering Designer: AutoCAD exchange

## Export your design

1. Open **Engineering Design** and open the saved site project you want to edit.
2. Save your project and optionally export its JSON as a backup.
3. Scroll down the left panel and click **EXPORT AUTOCAD DWG**, then choose where to save the file.
4. Open the saved `.dwg` in AutoCAD 2022. This is a genuine AutoCAD 2018-format DWG, the native format used by AutoCAD 2022. The drawing uses meters, CAD +Y up (north), and 2D model space. **EXPORT DXF** is also available.
5. Edit the boundary and move the fixture markers. Keep the exported fixture entities and their AquaFlow XDATA when you want their existing control settings to stay associated on import. Fixture names are editable TEXT annotations.
6. Save the edited drawing as DWG or DXF, then import it into AquaFlow.

Native DWG export uses the same CAD engines and licence rules as DWG import (see [DWG engines and licensing](#dwg-engines-and-licensing)). It performs local conversion with no fountain-controller commands. If no permitted engine is installed, it reports that DWG conversion is unavailable; it never renames a DXF into a DWG. DXF exchange works without a CAD engine.

The export includes the basin outline, islands, nozzle/light/equipment markers, names, manual pipework, drawn depth zones and measurement lines. Fixture circles are position markers, not dimensioned equipment drawings. CAD export does not include PLC/I-CAN control commands, wiring schematics, show programming or a 3D AutoCAD model.

## Import a drawing

1. In Engineering Design, click **IMPORT AUTOCAD DWG / DXF** in the left panel.
2. Choose one of:
   - a **`.dxf`** file — ASCII or binary, up to **100 MB**;
   - a **`.dwg`** file — converted locally to DXF by your CAD engine, then read the same way;
   - a **`.json`** file written by the AquaFlow AutoLISP export (see [AutoLISP export](#autolisp-export-zero-licence-dwg-route)).
3. AquaFlow's CAD service (the AquaFlow engine, `POST /api/cad/import`) reads the **whole drawing**: every layer, nested and dynamic blocks, attributes, hatches and AquaFlow XDATA. If the engine is not running, AquaFlow falls back to its basic built-in reader (ASCII DXF up to 10 MB, mapped layers only) and says so.
4. Review the result. The defaults are chosen for you; usually you only press **Import**:
   - **Preview** — the full drawing is shown as a grey reference; the basin is blue, islands orange, and recognised components are coloured by confidence (green high, amber medium, red low).
   - **Basin and islands** — every closed outline is listed. Choose which one is the **Basin**, which are **Islands** (holes such as planters or sculpture plinths), and which are **Reference only**.
   - **Recognised fountain components** — grouped by block name (or by layer). Change a group's type once to **apply it to all instances** of that block, or expand the group to override a single instance. Each item shows **why** it was recognised and **where each field came from** (for example `model — from attribute MODEL`, `flow — from schedule row N-01`). DMX/valve addresses read from a drawing are shown for reference only; import never assigns hardware addresses.
   - **Walls, floor and land** — wall height and floor level come from the basin's Z, from block attributes such as `FFL`, `LEVEL`, `ELEV`, `WALL_HEIGHT`, or from defaults; the source is shown and you can type over it. Hatched areas (grass, paving, soil, gravel/rock, sand) become land surfaces.
   - **Unitless drawings** — if the drawing does not declare its units you must choose them (AquaFlow suggests one from the drawing size). A 36,000 mm basin should preview as 36 meters.
5. **Advanced options** (collapsed by default):
   - **Pick origin** — click a point (snaps to drawing vertices) to make it AquaFlow's 0,0. Site plans in survey coordinates are moved to a local origin automatically.
   - **Align to edge** — click an edge to make it run along AquaFlow's X axis.
   - **CAD north at the top** — keep this on (default, and always for AquaFlow exports).
   - **Units override**, **Import method** (update current design / create a new design), **Pool depth**, **Design name**.
   - **Mapping templates** — save the block/layer type choices as a named template for a client's CAD standard, and load it next time (`GET/POST /api/cad/templates`).
6. When updating a design, AquaFlow shows **Changes since the current design** before you import: added, moved, not-in-drawing and unchanged fixtures (matched by AquaFlow XDATA ID, then CAD handle, then nearest same-type within 5 cm).
7. Click **Import**. The engineering view fits the imported basin. Check the result before clicking **SAVE PROJECT**. **Undo** restores the previous design and project identity.
8. Recalculate hydraulics after a layout change. CAD import replaces manual pipes, drawn depth zones and measurements with those present in the selected drawing, and replaces CAD-derived land surfaces (hand-drawn ones are kept). Review and commission any new fixtures before using them in a live show.

### Safety rules (unchanged)

- CAD import changes design data only. It **never sends hardware commands**.
- **Update current design** keeps existing control settings and hardware addresses for matched fixtures. Omitted current fixtures remain in the design. New fixtures are added with **no** PLC/I-CAN/DMX address and need commissioning.
- **Duplicate fixture IDs are refused** (for example copied blocks that carry the same AquaFlow XDATA) instead of guessing hardware associations.

## The CAD reference underlay

The whole drawing — including layers that are not fountain objects — is kept as a **locked reference underlay** behind the design. It is saved in the project (`.aqua`) and:

- appears behind the design in Engineering Design, with a per-layer visibility list under **LAYERS → CAD**, and a button to remove it;
- is never selectable or editable; with **SNAP** on, the cursor snaps to underlay vertices and circle centres (10 px aperture) before the grid;
- is available to the 3D view as lines on the ground plane (one batch per layer/colour).

## Coordinate frame

One transform chain is used everywhere (`frontend/src/engineering/geometryContract.js`): CAD WCS (+Y up, meters) → picked origin and rotation → AquaFlow plan (+y down on screen, so CAD north stays at the top) → 3D (pool centred on the world origin, CAD north = −Z). Exporting and re-importing a design returns the same points to within 1 mm.

## DWG engines and licensing

AquaFlow does **not** contain or bundle any DWG reader.

| Route | Licence position | Behaviour |
| --- | --- | --- |
| **DXF** (ASCII or binary) | No DWG licence involved | Default. Read by the AquaFlow CAD service. |
| **Your own AutoCAD 2018+** (`accoreconsole.exe`) | Uses your licensed AutoCAD | **Default for DWG.** Always tried first when installed. |
| **AutoLISP export** (`tools/autocad/aquaflow_export.lsp`) | Runs inside your AutoCAD; no converter | Zero-licence DWG route with exact block/attribute capture. |
| **ODA File Converter** (installed separately by you) | **Free for non-commercial use only** | Shows the licence notice. **Disabled for commercial AquaFlow licences (STUDIO, PLAYER)** until an administrator records a written ODA decision by setting `odaCommercialApproved`. For other/unknown licences you must confirm non-commercial use once per app session. |
| LibreDWG | GPLv3 | Not linked, bundled or invoked. |

Administrators can set `AQUAFLOW_ACCORECONSOLE` or `AQUAFLOW_ODA_CONVERTER` to the full converter executable path. ODA commercial approval is set with `"odaCommercialApproved": true` in the bundled `resources/app-config.json`, or the environment variable `AQUAFLOW_ODA_COMMERCIAL_APPROVED=1` — only after ODA has confirmed the terms in writing. The DWG size cap is 100 MB, matching the CAD service.

## AutoLISP export (zero-licence DWG route)

For DWG files without an ODA licence, export directly from AutoCAD:

1. In AutoCAD, run `APPLOAD` and load `tools/autocad/aquaflow_export.lsp` from the AquaFlow installation/repository.
2. Run the export command it defines. It writes a `.json` file with every block reference (effective name, attributes, world transform, layer) next to the drawing.
3. In AquaFlow, click **IMPORT AUTOCAD DWG / DXF** and choose that `.json` file. It is read by the AquaFlow CAD service (the engine must be running) and reviewed exactly like a DXF.

## Drawing conventions

Recognition works on any reasonable drawing (block names, attributes such as `TYPE`/`MODEL`, multilingual layer keywords such as NOZZLE, JET, BOQUILLA, DUESE, PUMP, BOMBA, LED, LUZ, VALVE, and geometry). These layer names are recognised directly and are what AquaFlow exports:

| CAD layer | Import purpose | Geometry |
| --- | --- | --- |
| `POOL_OUTLINE` | Pool boundary (islands tagged with AquaFlow XDATA) | Closed polyline, circle, ellipse or closed connected line/arc loop |
| `POOL_ISLANDS` / `ISLANDS` | Islands (holes in the basin) | Closed outlines |
| `NOZZLES` | Nozzle positions | Circle centers, POINT entities or block insertion points |
| `LIGHTS` | Light positions | Circle centers, POINT entities or block insertion points |
| `EQUIPMENT` | Equipment positions | Circle centers, POINT entities or block insertion points |
| `PIPEWORK` | Pipe routes | Lines and polylines |
| `DEPTH_ZONES` | Depth-zone outlines | Closed outlines; AquaFlow exports retain depth metadata |
| `MEASUREMENTS` | Measurement lines | LINE entities |
| `ANNOTATIONS` | Names and annotations | TEXT/MTEXT; exported names remain associated with fixture IDs |

On fixture layers, a block represents one fixture at its insertion point, rather than importing every circle inside it. Curves are flattened to short straight segments within a set tolerance. Paper space is not imported; unresolved external references (XREFs) are listed as warnings.

For a round trip of an existing commissioned site, prefer moving the original exported markers. Exploding, replacing or copying entities can remove or duplicate their identity metadata. AquaFlow rejects duplicate fixture IDs instead of guessing their hardware associations.
