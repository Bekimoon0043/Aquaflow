# Fixture data provenance (AF-NEXT-012)

Every value AquaFlow uses for equipment (nozzles, pumps, valves, lights, and the fixture library) carries a provenance block. Every engineering result and BOM line cites the block it depends on. The aim is to keep a generic estimate from being read as a manufacturer specification.

Implementations:

- Backend: `aquaflow/backend/services/equipment_provenance.py`
- Frontend mirror: `aquaflow/frontend/src/data/fixtureProvenance.js`

The rules in both files are the same.

## Schema

```json
{
  "source": "manufacturer_datasheet | user_measured | generic_estimate",
  "manufacturer": "Acme",
  "model": "J-25",
  "document": { "title": "J-25 datasheet", "url": "https://…", "file": "datasheets/j25.pdf" },
  "revision": "C",
  "date": "2026-03-01",
  "units": { "pressure": "bar", "flow": "L/min", "jet_height": "m" },
  "confidence": "high | medium | low",
  "licence": "Used with written permission from Acme, ref 2026-114",
  "notes": "free text"
}
```

Field notes:

- `revision` is the datasheet revision, or a measurement-run ID.
- `date` is the datasheet issue date, or the measurement date.
- `licence` records the licence or permission to use and redistribute the data.

The backend adds `schema: "aquaflow.provenance/1"` and a display `label`. If a claim is downgraded, it also adds `downgraded_from` and `downgrade_reason`. The frontend uses `downgradedFrom` and `downgradeReason`.

### Default units per kind

| kind | units |
| --- | --- |
| nozzle | pressure bar, flow L/min, jet_height m, k_factor L/min/sqrt(bar), orifice mm |
| pump | flow m3/s, head m, efficiency 0..1, power W |
| valve | kv m3/h/sqrt(bar), flow m3/h, pressure_drop bar |
| light | power W, voltage V, dmx_channels, beam_angle deg, luminous_flux lm |
| pipe | diameter m, flow m3/s, velocity m/s, length m |

## Trust rules (enforced, not advisory)

1. Missing provenance means `generic_estimate` with confidence `low`.
2. A `generic_estimate` is always confidence `low`. It always displays as **"Generic estimate — verify with supplier datasheet"**.
3. A `manufacturer_datasheet` record needs all of the following: `manufacturer`, `model`, a document (title, URL or file), `revision` and `licence`.
4. A `user_measured` record needs `model` and `date`.
5. A record that claims rule 3 or rule 4 but is incomplete is **downgraded** to `generic_estimate`. The reason is kept with it. A record is never upgraded by default.
6. Manufacturer and model alone do not make a record a datasheet. The legacy library rule that marked such items `source:"datasheet"` has been removed.

`validate_provenance` and `validateProvenance` return the list of problems. The verified-model API and UI use them to **refuse** a submission. They do not store it as something it is not.

## Citation (attached to results and BOM lines)

```json
{ "equipment_model": "AF-GEYSER-25", "manufacturer": "…", "data_source": "generic_estimate",
  "source_label": "Generic estimate — verify with supplier datasheet", "confidence": "low",
  "units": { "…": "…" }, "revision": "aquaflow-generic-2026.10", "document": "AquaFlow generic template" }
```

Responses that combine several items include `data_provenance`:

```json
{ "items": 0, "by_source": {}, "generic_items": 0, "all_verified": false, "warning": "" }
```

Where citations appear:

| Result | Where the citation is |
| --- | --- |
| `POST /api/hydraulics/solve` | `nodes[].equipment` (nozzle emitters, and pump/fixed-head nodes that name a model); `pipes[].equipment`; `data_provenance` |
| `POST /api/hydraulics/preview-physics` | `nozzle_physics[id].equipment`, from the design nozzle's `type` and `provenance`; `data_provenance` |
| `POST /api/hydraulics/size`, `/size-network` | `pipes[].equipment`; `summary.data_provenance` |
| `POST /api/pumps/operating-point` | `operating_point.equipment`; `pump.provenance`; `data_provenance` |
| `POST /api/valves/authority` | `equipment` and `data_provenance`. `valve_model` selects a verified valve and its Kv. |
| `POST /api/nozzles/query`, `GET /api/nozzles/models` | `citation`, `provenance` and `verified` per model |
| BOM (`/api/bom/generate`, `/from-network`, JSON/CSV/XLSX, engineering package XLSX) | per line: `equipment_model`, `data_source`, `confidence`, `units_basis`, `data_revision`, `source_document`. CSV/XLSX columns are appended after `Notes`: Equipment Model, Data Source, Confidence, Units Basis, Data Revision, Source Document. The engineering-package cover PDF prints the datasheet / measured / generic counts. |
| Designer BOM CSV (`PoolGeometryDesigner` → EXPORT BOM) | the same six columns, via `bomProvenanceCells()` |

## Current data status

- **Fixture library**: 596 items (curated plus the 524-item expanded JSON). All are `generic_estimate`, confidence `low`.
- **`backend/data/nozzle_catalogs.json`**: catalog-level `provenance: generic_estimate`. The "AquaFlow Standard" and "OASE" catalog names are placeholders, and the numbers are illustrative. They were not taken from a datasheet.
- **`backend/data/parts_catalog.json`**: supplier names, part numbers and prices are placeholders. Every BOM line built from them cites `generic_estimate`.
- **Built-in pump curve sets** (`fountain-small`, `fountain-medium`, `fountain-large`): `generic_estimate`.
- **Verified set**: ships **empty**.

## Adding verified models

There are two JSON locations, both in the format `{"schema": "aquaflow.equipment-models/1", "kind": …, "models": [...]}`:

- `aquaflow/backend/data/equipment_models/{nozzle,pump,valve,light}.json`: bundled with the app and read-only in the packaged build. Add a datasheet here only if you hold a licence or permission note for it.
- `$AQUAFLOW_DATA_DIR/equipment_models/{kind}.json` (default `~/.aquaflow`): models entered in the UI are saved here.

Files ending in `.example.json` are never loaded. `nozzle.example.json` shows the shape using clearly illustrative values.

Record format: `{ id, kind, label, fixture_key?, provenance, data }`, where `data` is:

- nozzle: `{ nozzle_type, orifice_mm?, k_factor?, pressure_flow_points: [{ pressure, flow, jet_height? }] }`. Needs a K factor or at least 2 points.
- pump: `{ flows: [m3/s], heads: [m], efficiency?: { flows, values } }`. Needs at least 3 points.
- valve: `{ kv, size?, characteristic? }`. `kv` must be greater than 0.
- light: `{ power_w, dmx_channels, voltage_v?, beam_angle_deg? }`

API endpoints:

- `GET /api/equipment/schema`
- `GET /api/equipment/models?kind=`
- `POST /api/equipment/models`: validated. Add `?replace=true` to update an existing model.
- `DELETE /api/equipment/models/{kind}/{id}`: user models only.
- `POST /api/equipment/provenance/validate`

UI: **Engineering Tools → Verified Models**. You can enter measured jet height against pressure, pump curve points, valve Kv, or light power and DMX channels. Two sources are accepted: user measurement (needs model and date) or manufacturer datasheet (needs document, revision and licence).

How verified models are used:

- Verified nozzles join the nozzle database and can be queried by ID.
- Verified pumps can be used as `pump.model` in the operating-point calculation.
- Verified valves can be used as `valve_model` in the authority calculation.
- A design item with `equipment_model_id` gets its BOM citation from the registry.

## Fixture-type replacement

This is the "Replace fixture type" control in the designer's selected-fixture inspector (`FixtureTrustPanel`). The logic is in `aquaflow/frontend/src/engineering/fixtureTypeReplacement.js`.

**Recompute**

- The new type's engineering defaults replace the old values. The report lists the changed values.
- The BOM, equipment totals, electrical load and pipework are recomputed from the fixtures.
- If a hydraulic solve exists, it is cleared and re-run on the new fixture set.

**Control footprint**

The footprint covers:

- protocol
- DMX channel count
- whether DMX, a valve output or PLC I/O is needed
- DI/DO/AI/AO counts

Any change is flagged on the fixture as `controlReview: { required: true, changes, affectedItems }`. A visible warning lists the affected items:

- DMX patch, including overlap with neighbouring fixtures
- PLC, Modbus and valve addresses
- Siemens I/O-map points
- group membership
- hydraulics

The warning stays until the user marks the mapping reviewed.

**Addresses**

- Existing DMX, PLC, Modbus and valve addresses are kept exactly as they were.
- The new type's library default addresses (for example, the curated UW lights' `dmxUniverse`/`dmxAddress`) are **not** applied.
- If the new type needs an address it does not have, it is reported as `unassigned`.

**Linked model**

A provenance link at instance level described the old equipment, so it is dropped and reported.
