# AquaFlow AutoCAD export (AF-CAD-019)

`aquaflow_export.lsp` adds the **AQFEXPORT** command to AutoCAD. It writes every
model-space block reference in the open drawing to a small JSON file that AquaFlow
imports like a DXF.

## Why this exists: the zero-licence DWG path

No free, redistributable DWG reader exists, so AquaFlow does not open `.dwg` files
itself. If you already have AutoCAD, it reads the DWG for you. AQFEXPORT runs inside
your licensed AutoCAD and hands AquaFlow only the data it needs. You don't need ODA
tools, a DWG library or a cloud service.

The DXF route (`SAVEAS` → DXF) still works and also carries loose geometry such as
basin outlines and pipes. AQFEXPORT is for block-heavy drawings where the blocks
carry the information: fixture symbols, dynamic blocks and attributes.

## Loading

1. In AutoCAD, run `APPLOAD`.
2. Browse to `aquaflow/tools/autocad/aquaflow_export.lsp` and click **Load**.
   To load it in every session, add it to the **Startup Suite** in the same dialog.
3. The command line confirms:
   `AquaFlow export loaded. Type AQFEXPORT to write model-space blocks to JSON.`

You can also load it from the command line or a script:
`(load "C:/path/to/aquaflow_export.lsp")`.

If AutoCAD shows a *Secure Load* warning, add the folder to the trusted locations
(`TRUSTEDPATHS`) or choose **Load once**.

## Usage

1. Open the drawing and run `AQFEXPORT`.
2. Choose where to save the file. The default is `<drawing>.aqf.json` next to the DWG.
3. AutoCAD reports how many block references it wrote.

For batch jobs, call `(aqf:export "C:/out/site.aqf.json")`. It returns the number of
blocks written, or `nil` if the file could not be opened.

Then import the JSON into AquaFlow. The backend function
`services/cad_lisp_import.py::import_aqf_json` converts it into the standard CAD import
response (`docs/CAD-IMPORT-CONTRACT.md`): CAD WCS metres, +Y up. Recognition and the
re-import diff then treat it exactly like a DXF import.

## What is exported

| Field | Source |
|---|---|
| `handle` | entity handle (group 5) — stable across saves, used by the re-import diff |
| `name` | block name (group 2), e.g. `*U12` for a dynamic block |
| `effective_name` | `vla-get-EffectiveName` — the real name behind anonymous dynamic blocks |
| `layer` | layer (group 8) |
| `insertion` | insertion point converted OCS → WCS with `trans` |
| `rotation_deg` | rotation (group 50) in degrees |
| `scale` | X/Y/Z scale (groups 41–43) |
| `extrusion` | normal (group 210); a value other than `[0,0,1]` means mirrored or tilted |
| `attribs` | every attached ATTRIB, `TAG → value` |
| `xdata_aquaflow` | the raw `AQUAFLOW` XDATA strings, so fixtures that AquaFlow exported match back by internal ID |

The file header also carries `insunits` (`$INSUNITS`), `drawing` (`DWGNAME`) and
`acadver`. AquaFlow converts positions to metres from `insunits`. A unitless drawing
(`0`) is imported as metres, with a warning to choose the real units.

## Limits

- Only top-level model-space block references are exported. Nested blocks, loose
  geometry and paper space are not. Use DXF when you need those.
- Constant attributes, which are defined in the block and not stored on the
  reference, are not exported.
- `effective_name` needs AutoCAD's COM layer (`vl-load-com`). In the
  AutoCAD Core Console it falls back to the raw block name.
- All non-ASCII text is written as `\uXXXX`. On AutoCAD 2021 and later the escapes
  are exact Unicode. On older, code-page builds, characters outside ASCII may come
  through as their code-page values.
- A .NET plug-in (`tools/autocad/AquaFlowExport/`) is planned for exports that need
  nested blocks and full transforms.
