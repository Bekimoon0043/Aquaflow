# CAD import contract (AF-CAD series)

Shared JSON contract between the backend ezdxf import service and the frontend
import/underlay/review UI. Source plan: `AF-CAD-DESIGN-RENDER-PLAN.md`.

All coordinates are **metres in CAD WCS, +Y up** (the raw drawing frame after unit
conversion and full block-transform composition). The frontend owns the single
CAD → plan → three.js transform (`frontend/src/engineering/geometryContract.js`,
AF-CAD-001): it applies the user's origin / rotation / invert choices and the
`centeredPoolPoints()` centring. The backend never centres or flips.

## `POST /api/cad/import` (AF-CAD-010)

Multipart: `file` (DXF ASCII or binary). Query/form options:
`units` (override: `mm|cm|m|in|ft`), `max_mb` (default 100),
`flatten_tol` (metres, default 0.01), `recognize` (bool, default true),
`template` (JSON string of a mapping template, optional).

Response:

```json
{
  "version": 1,
  "filename": "site.dxf",
  "dxf_version": "AC1032",
  "units": {"insunits": 6, "name": "m", "to_m": 1.0, "unitless": false, "suggested": null},
  "extents": {"min": [x, y], "max": [x, y]},
  "layers": [{"name": "NOZZLES", "color": 1, "entity_count": 120, "off": false, "frozen": false}],
  "entities": [
    {"handle": "2F1", "layer": "POOL", "kind": "polyline", "points": [[x, y], ...],
     "closed": true, "z": 0.0, "color": 7, "source": "LWPOLYLINE", "block_path": []},
    {"handle": "2F2", "layer": "NOZZLES", "kind": "circle", "center": [x, y], "radius": 0.05, "z": 0.0, "color": 1},
    {"handle": "2F3", "layer": "TEXT", "kind": "text", "position": [x, y], "text": "N-01", "height": 0.2, "rotation_deg": 0},
    {"handle": "2F4", "layer": "LAND", "kind": "hatch", "pattern": "GRASS", "loops": [[[x, y], ...]], "color": 3},
    {"handle": "2F5", "layer": "0", "kind": "point", "position": [x, y], "z": 0.0}
  ],
  "inserts": [
    {"handle": "3A0", "block": "*U12", "effective_name": "NOZZLE_JET_2M", "layer": "NOZZLES",
     "position": [x, y, z], "rotation_deg": 0.0, "scale": [1, 1, 1],
     "attribs": {"ID": "N-01", "MODEL": "JET-25"}, "xdata": {"AQUAFLOW": {"id": "noz_1", "type": "nozzle"}},
     "depth": 0, "parent_handle": null}
  ],
  "closed_outlines": [{"handle": "2F1", "layer": "POOL", "points": [[x, y], ...], "area_m2": 120.5, "holes": []}],
  "tables": [{"handle": "4B0", "layer": "SCHED", "source": "acad_table|text_grid", "rows": [["TAG", "MODEL", "FLOW"], ["N-01", "JET-25", "40"]]}],
  "xrefs": ["SURVEY"],
  "warnings": ["..."],
  "stats": {"entities": 1234, "inserts": 300, "skipped": {"DIMENSION": 4}, "parse_ms": 120},
  "recognition": { "...see below, present when recognize=true..." }
}
```

`entities[].kind` is one of `polyline | circle | text | hatch | point`. Arcs,
ellipses, splines and bulges are flattened to `polyline`. Entities produced from
block expansion carry the chain of INSERT handles in `block_path`.

Backend clarifications (AF-CAD-010 implementation, `services/cad_import.py`):

- **Units.** When `$INSUNITS` is 0 and no `units` override is given, the backend applies
  the *suggested* unit (so coordinates are still metres), sets `unitless: true`,
  `suggested: "<unit>"` and adds a warning asking the user to confirm; re-import with
  `units=` to change it. `units.override` is present when an override was used.
- **Handles of block content.** `handle` of an entity or nested INSERT expanded from a
  block is the handle *inside the block definition* (shared by every instance). Every
  insert also has `instance_id` = `block_path` + `handle` joined with `/` (e.g. `"47/3E"`),
  unique per drawing and stable across re-imports; recognition uses it as
  `source_handle` for nested inserts. Top-level inserts: `instance_id == handle`.
- **Inserts** also carry `mirrored` (bool), `color`, `block_path` and `xref: true` for XREF
  blocks. `rotation_deg`/`scale` decompose the world matrix as R(rotation)·S(sx, sy):
  a mirrored block reports `scale[0] < 0`.
- **Extra entity fields:** `color` on every entity, `source` (`LWPOLYLINE`, `ARC`, `TEXT`,
  `MTEXT`, `ATTRIB`, `MLEADER`, `ACAD_TABLE` …), `solid` on hatches, `xdata` (decoded
  AQUAFLOW XDATA) when present. Visible ATTRIBs are also emitted as `text` entities with
  `source: "ATTRIB"`, `tag` and `owner_handle`.
- **closed_outlines.** `holes` is a list of point arrays; `hole_handles` lists their
  handles; `parent_handle` is the smallest containing outline. `excluded` is `null` or a
  reason string: outlines on depth-zone / dimension / measurement / annotation layers, or
  with AQUAFLOW XDATA `kind` other than `pool|island|basin`, are listed but never become
  holes, containers, basins or islands. Block-expanded outlines under 1 m² and outlines
  under 0.25 m² are never holes.
- **tables** also carry `position`; text-grid tables carry `bbox` `[minx, miny, maxx, maxy]`
  (tag texts inside a table bbox are never joined to symbols).
- **stats** also has `truncated` (entity cap reached, default 500 000).
- **Errors:** 400 unreadable/invalid, 404 unknown template name, 413 above `max_mb`,
  415 DWG (convert to DXF first).

## Recognition (AF-CAD-012 / 016)

`POST /api/cad/recognize` with body `{"import": <import response>, "template": {...}|"saved name"|null, "tag_radius_m"?: 1.5}`
returns the same object that is embedded as `import.recognition`:

```json
{
  "candidates": [
    {"id": "cand_0", "source_handle": "3A0", "type": "nozzle|light|pump|valve|equipment|laser|fire|mist",
     "confidence": 0.92, "reasons": ["block name matches NOZZLE", "attribute MODEL=JET-25"],
     "position": [x, y], "z": 0.0, "rotation_deg": 0, "block": "NOZZLE_JET_2M", "layer": "NOZZLES",
     "attribs": {}, "tag": "N-01",
     "fields": {"model": "JET-25", "flow_lpm": 40, "height_m": 2.0, "dmx_address": null, "pump_id": null},
     "field_provenance": {"model": "attribute MODEL", "flow_lpm": "schedule row N-01"},
     "aquaflow_id": "noz_1"}
  ],
  "basins":  [{"source_handle": "2F1", "role": "basin|island", "points": [[x, y], ...], "holes": [], "area_m2": 120.5, "confidence": 0.8, "reasons": []}],
  "pipes":   [{"source_handle": "2F9", "points": [[x, y], ...], "dn": 50, "material": "PVC", "layer": "PIPE"}],
  "land":    [{"source_handle": "2F4", "material": "grass|paving|soil|rock|sand", "loops": [...]}],
  "groups":  [{"key": "block:NOZZLE_JET_2M", "type": "nozzle", "count": 48, "mean_confidence": 0.9}],
  "template_used": "name or null"
}
```

Candidates also carry `group` (the key in `groups`); `fields` may hold extra keys
(`head_m`, `power_kw`, `dn`, `channel`, `color`, `radius_m`, `aquaflow_type`) besides the
five base keys, which are always present. Basins/islands carry `hole_handles` and `layer`;
pipes carry `closed` and `provenance`; land carries `layer`, `pattern` and `reason`.

Signal priority: AQUAFLOW XDATA > template rules > attribute tags (TYPE/MODEL/…) >
multilingual layer/block keywords > geometry signatures > instance counts.
Recognition **never** assigns hardware addresses (DMX/valve channels) unless the
value is read verbatim from the drawing, and it is shown as provenance.
Templates cannot set `dmx_address`, `channel`, `valve_channel`, `address` or
`dmx_universe` (rejected with 400).

### Mapping templates

`GET /api/cad/templates`, `POST /api/cad/templates` (`{name, rules: [{match: "block|layer|attrib", pattern: "regex", attrib?: "TAG", type: "nozzle", fields?: {...}}]}`),
`DELETE /api/cad/templates/{name}`. Stored as JSON in `$AQUAFLOW_DATA_DIR/cad_templates.json`
(default `~/.aquaflow`). A rule `type` may also be `"ignore"` (drops matching candidates
unless they carry AQUAFLOW XDATA); a template may set `tag_radius_m`. `GET` returns
`{"templates": [...]}`. `POST /api/cad/import` accepts `template` as inline JSON or a saved name.

## Re-import diff (AF-CAD-017)

`POST /api/cad/diff` body `{"previous": [{"id", "type", "position", "aquaflow_id"?, "source_handle"?}], "candidates": [...]}` →
`{"added": [...], "moved": [{"id", "from", "to", "distance_m"}], "removed": [...], "unchanged": [...]}`.
Match order: `aquaflow_id` (XDATA) → `source_handle` → nearest same-type within 0.05 m.
Optional body field `proximity_m`. `moved`/`unchanged` entries also carry `candidate_id`,
`match` (`aquaflow_id|source_handle|proximity`), `source_handle`, `aquaflow_id` and
`type_changed` when the type differs; a move is a displacement > 1 mm. The response also has
`warnings` (duplicate AQUAFLOW ids in the drawing are refused as identity keys).

## Topology (AF-CAD-015)

`POST /api/cad/topology` body `{"pipes": [...], "candidates": [...], "tolerance_m": 0.05, "pump_head_m": null, "solve": false}` →

```json
{
  "tolerance_m": 0.05,
  "nodes": [{"id": "n0", "position": [x, y], "degree": 3, "component": 0,
             "attachments": [{"id": "cand_3", "type": "pump"}], "pump": "cand_3"}],
  "links": [{"id": "l0", "from": "n0", "to": "n1", "length_m": 5.0, "pipe_index": 0,
             "source_handle": "2F9", "dn": 50, "material": "PVC"}],
  "groups": [{"pump": "cand_3", "valves": ["cand_7"], "nozzles": ["cand_0", "cand_1"],
              "valve_nozzles": {"cand_7": ["cand_0"]}, "direct_nozzles": ["cand_1"], "confirmed": false}],
  "dangling": [[x, y]],
  "attached": {"cand_0": "n4"},
  "unattached": [{"id": "cand_9", "type": "nozzle", "position": [x, y], "distance_m": 1.2, "reason": "..."}],
  "pipes": [{"index": 0, "source_handle": "2F9", "dn": 50, "material": "PVC", "provenance": {"dn": "attribute SIZE"}}],
  "stats": {"nodes": 10, "links": 9, "components": 1, "pumps": 1, "valves": 1, "nozzles": 2, "dangling": 1},
  "solver_input": {"method": "hazen-williams", "nodes": [...], "pipes": [...]},
  "unsolved_components": [1],
  "assumptions": ["Valves are modelled as open, lossless junctions.", "..."],
  "warnings": [],
  "solution": {"...": "only when solve=true: solve_network(solver_input)"}
}
```

`pipes[]` items are recognition `pipes` (`points`, optional `dn`, `material`,
`attribs`, `text`/`label`, `layer`); `candidates[]` are recognition candidates
(`id`, `type`, `position`, `z`, `fields.flow_lpm|pressure_bar|height_m|head_m`).
Pipe ends and vertices within `tolerance_m` share a node, and a pipe end on another
segment's interior makes a T-junction. A candidate attaches to the nearest node
within tolerance, or else splits the nearest segment within tolerance. Groups are
proposals (`confirmed: false`) for the user to confirm. `solver_input` is accepted by
`services/hydraulic_solver.py::solve_network` unchanged. Pumps are fixed-head
sources, nozzles are emitters, and only pump-fed components are included.
Interior degree-2 nodes that have no component are collapsed.

## Export (AF-CAD-020 / 003)

`POST /api/cad/export.dxf` (query `dimensions=true`) takes the engineering project
design, or `{"design": {...}}`, and returns an ezdxf-written DXF (AC1027,
`application/dxf`). The same writer (`services/cad_export.py`) also produces
`/api/cad/layout(.dxf)` and the engineering-package `layout.dxf`. The legacy R12
writer remains available only through `cad_writer: "r12"`.

- **Blocks:** one block per component type, `AQF_<TYPE>_<MODEL>`. `TYPE` is one of
  `NOZZLE|LIGHT|PUMP|VALVE|LASER|FIRE|MIST|EQUIPMENT`. `MODEL` is the fixture
  model, or the type minus its category (`nozzle_running` → `AQF_NOZZLE_RUNNING`),
  or `GENERIC`.
- **Attributes:** ATTDEFs and ATTRIBs `ID, MODEL, HEIGHT, CHANNEL`.
- **XDATA:** appid `AQUAFLOW` on every AquaFlow entity. The UTF-8 JSON is
  hex-encoded and split into group-1000 strings of at most 240 characters, which is
  the browser `cadExchange.js` format.
  - Fixture: `{"kind": "fixture", "id", "type", "label", "rotation", "model"?}`
  - Other kinds: `pool`, `island`, `pipe`, `depth`, `land`.
- **Layers:**
  - Writer layers: `POOL_OUTLINE, WATER_SURFACE, NOZZLES, LIGHTS, PIPEWORK, EQUIPMENT,
    MEASUREMENTS, ANNOTATIONS, DEPTH_ZONES, POOL_ISLANDS, LANDSCAPE, DIMENSIONS`.
  - User layers: the project's non-built-in `layers[]`, with name, colour, on/off and
    lock.
  - Land surfaces are pattern HATCHes on `LANDSCAPE`. Overall linear DIMENSIONs go on
    `DIMENSIONS`.
- **Frame:** CAD +Y-up metres, so `cad = (plan_x, -plan_y)` and
  `rotation_cad = -rotation_plan`, the same as `exportCadDxf`.

- **Multi-basin (AF-NEXT-010):** when the design carries `basins[]` (each with `outer`),
  every basin is written on `POOL_OUTLINE` with XDATA
  `{"kind": "pool", "id", "name", "depth", "floorLevel"?, "wallHeight"?}` and its islands
  on `POOL_ISLANDS` with `{"kind": "island", "id": "<basin id>-island-<n>", "basinId"}`.
  A legacy single-`geometry` design is written exactly as before. On import every outline
  chosen as `basin` becomes a basin (pool XDATA `id`/`name`/levels are reused); each
  island attaches to `parent_handle`, else to the smallest chosen basin containing it.

Importing the file back, through `/api/cad/import` or the browser importer,
reproduces positions within 1 mm and matches every fixture by XDATA.

## AutoCAD LISP export (AF-CAD-019)

`tools/autocad/aquaflow_export.lsp` (command `AQFEXPORT`) writes
`{"format": "AQFEXPORT", "version": 1, "drawing", "acadver", "insunits", "inserts": [{"handle", "name", "effective_name", "layer", "insertion": [x, y, z] (WCS, drawing units), "rotation_deg", "scale", "extrusion", "attribs": {TAG: value}, "xdata_aquaflow": ["hex", ...]}]}`.

`POST /api/cad/import/aqf-json` (query `units` override) takes that document, or
`{"data": <document>, "filename"}`. `services/cad_lisp_import.py::import_aqf_json`
turns it into the `/api/cad/import` response shape with `source: "autolisp"`:
inserts converted to metres, `xdata.AQUAFLOW` decoded, `entities` empty, and no
`recognition` key. Callers run `/api/cad/recognize` on the result.
