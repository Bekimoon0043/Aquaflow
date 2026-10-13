# AF-NEXT-012 — Fixture data trust: evidence

Date: 2026-10-13
Scope: provenance and confidence metadata for nozzle, pump, valve and light data, and for the fixture library. A mechanism for a verified set (manufacturer datasheet or user measured). Citations on every engineering result and BOM line. Fixture-type replacement with recompute and control-footprint flagging.
Hardware: none. Nothing here connects to, arms or drives physical equipment.
Contract: `docs/FIXTURE-DATA-PROVENANCE.md`.

## Behavior before this ticket

- `frontend/src/data/fixtureLibrary.js` set `source:"generic"`, `generic:true` and a `GENERIC_DATA_SOURCE` string on every item. No UI read these fields. The code would also have labelled any item with manufacturer and model as `"datasheet"`, without a document.
- `bom_generator.BOMLine` had manufacturer and part_number fields, but no source, confidence, units origin or revision. The CSV/XLSX exports had the same gap.
- The `nozzle_database` catalogs ("AquaFlow Standard", "OASE") had no provenance. The OASE entry's note said "Tabulated manufacturer pressure-flow-height curve", but the values were illustrative.
- The `pump_curve` comment described its built-in curves as "Realistic manufacturer-style" points, with no provenance. `valve_authority` had no provenance either.
- There was no way to change a placed fixture's type, and no control-footprint check.

## What changed

**Backend**

- `services/equipment_provenance.py` (new): the schema, the trust rules (downgrade or refuse), the citations and the summary.
- `services/equipment_registry.py` (new) and `api/routes/equipment_routes.py` (new, mounted at `/api/equipment` in `main.py`): the verified-model store.
  - Bundled models are read from `data/equipment_models`. These files are empty, plus a `.example.json` that is never loaded.
  - User models are saved to `$AQUAFLOW_DATA_DIR/equipment_models`.
  - New records are validated, and the file is written atomically.
- `nozzle_database.py`:
  - `NozzleModel.provenance` and its citation.
  - Catalog-level provenance.
  - Verified nozzles are loaded from the registry.
  - `query` returns units and a citation.
  - `reload_nozzle_database()`.
- `data/nozzle_catalogs.json` and `data/parts_catalog.json`: both are labelled `generic_estimate`, with placeholder notes.
- `pump_curve.py`:
  - Curve-set provenance.
  - Built-in curves are labelled generic.
  - Verified pumps are loaded by ID.
  - `operating_point.equipment` and `data_provenance`.
  - `pump_routes` lists verified pumps.
- `valve_authority.py`: an `equipment` citation. `valve_model` takes Kv and provenance from the registry.
- `hydraulic_solver.solve_network`: citations per nozzle and pump node and per pipe, plus `data_provenance`.
- `pipe_sizing`: a citation per pipe and a summary roll-up.
- `api/routes/hydraulics_routes.py` `preview-physics`: a citation per `nozzle_physics` entry. It is computed in the route, so `geometry_service.py`, which another ticket owns, was not touched.
- `bom_generator.py`:
  - `BOMLine.citation` and `BOMLine.from_dict`.
  - Six provenance columns, appended after `Notes`, so the existing column indexes do not change.
  - `summary.data_provenance`.
  - Items can carry `provenance` or `equipment_model_id`.
- `bom_routes`: the from-network export keeps the citations.
- `engineering_package.py`:
  - Fixture provenance is passed into the BOM.
  - The cover PDF prints the datasheet / measured / generic counts and the "verify" line.

**Frontend**

- `data/fixtureProvenance.js` (new): mirrors the backend rules.
- `data/fixtureLibrary.js`:
  - Every item has a normalised `provenance`.
  - A bare manufacturer/model pair is no longer a "datasheet".
  - New `getFixtureProvenance(fixture)`.
- `components/panels/ProvenanceBadge.jsx` (new): the badge and the citation line.
- `FixtureLibraryBrowser.jsx`: a badge per item, the full label on the selected item, and the "All items: Generic estimate — verify with supplier datasheet" note.
- `FixtureTrustPanel.jsx` (new), in the designer's selected-fixture inspector, shows:
  - the source badge, model, units, revision and document;
  - the solved nozzle result with its citation;
  - "Replace fixture type": preview the change, apply it, re-run the hydraulic solver, and review and acknowledge the control footprint.
- `engineering/fixtureTypeReplacement.js` (new):
  - `controlFootprint`, `diffControlFootprint`, `replaceFixtureType` and `acknowledgeControlReview`.
  - Addresses are preserved, and the new type's default addresses are never applied.
  - Reports DMX overlap and unassigned addresses, and lists Siemens I/O points.
- `engineering/bomEngine.js`:
  - Citation fields on each BOM item. Fixtures with different provenance are never merged into one line.
  - `bomCitation`, `BOM_PROVENANCE_HEADERS` and `bomProvenanceCells`.
- `engineering/hydraulicAdapter.js`: sends `type` and `provenance` per nozzle, and keeps `dataProvenance`.
- `EngineeringToolsPanel.jsx`:
  - A provenance summary on every engine result.
  - The Nozzles tab shows a badge per model, plus "(generic estimate)" in the model list.
  - The BOM tab is a table with model, source, units and revision, plus CSV/XLSX downloads.
  - New **Verified Models** tab (`VerifiedModelsTool.jsx` and `engineering/verifiedModelForm.js`).
- `InspectorPanel.jsx`: an "Equipment data" badge for the selected device.
- `PoolGeometryDesigner.jsx` (owned by AF-NEXT-010; small targeted edits only):
  - Two imports.
  - One `<FixtureTrustPanel …/>` line in the selected-fixture block.
  - A badge in the BOM list.
  - Six provenance columns appended to EXPORT BOM CSV.

## Acceptance vs. evidence

| Criterion | Evidence |
| --- | --- |
| Source and confidence metadata on nozzle, pump, valve and light data | `test_default_nozzle_catalogs_are_labelled_generic`, `test_builtin_pump_curve_sets_are_generic`, `test_valve_manual_kv_is_cited_generic`, `test_registry_validates_pump_valve_light_data`; vitest `fixtureProvenance.test.js` (all 596 library items are `generic_estimate`/`low`; lights use the DMX unit set) |
| Generic estimates never presented as manufacturer specs | `test_incomplete_datasheet_claim_is_downgraded_not_trusted`, `test_generic_can_never_claim_medium_or_high_confidence`, `test_registry_refuses_untrustworthy_nozzle_records`; vitest "downgrades an incomplete datasheet claim", "a bare manufacturer/model pair is not a datasheet", "generic badge always reads the generic label" |
| Small verified set, no fabricated data | `test_registry_ships_empty_and_skips_example_files`; `test_registry_add_measured_nozzle_round_trips`; `test_measured_nozzle_is_loaded_and_cited`; `test_measured_pump_curve_drives_operating_point`; `test_valve_model_from_registry_supplies_kv_and_citation`; `test_equipment_routes_add_list_delete_nozzle`; vitest "verified model form" |
| Each engineering calculation cites its model, source, units and revision | `test_hydraulic_solver_results_cite_nozzle_pump_and_pipes`, `test_pipe_sizing_results_cite_basis`, `test_hydraulic_preview_route_cites_each_nozzle`, pump/valve tests above |
| Each BOM line cites model, source, units and revision; exports include them | `test_every_bom_line_cites_model_source_units_revision`, `test_bom_csv_and_xlsx_exports_carry_provenance_columns` (CSV and openpyxl read-back), `test_bom_from_network_export_keeps_citations`, `test_bom_line_uses_verified_registry_model`; vitest "BOM provenance" (designer BOM and CSV cells, including pipework items) |
| Replacing a fixture type recomputes dependent calcs | vitest "same-footprint nozzle swap": new engineering defaults, `recompute` lists bom/hydraulicSummary/solvedHydraulics, the BOM and hydraulic payload read the new type. `FixtureTrustPanel` re-runs `/hydraulics/preview-physics` on apply when a solve existed. |
| Changed control footprints are flagged; addresses never silently reassigned | vitest "RGB → RGBW" (address kept; 3→4 channels flagged; overlap with `l2` reported), "never applies the new type's library default address", "lists Siemens I/O points…", "review can be acknowledged"; the rendered `ReplacementReport` shows the warning and affected items |

## Commands and results (2026-10-13, Windows 11, Python 3 / Node 24)

| Command | Result |
| --- | --- |
| `cd aquaflow/backend && python -m pytest tests/test_fixture_data_trust.py -q -o addopts=""` | 22 passed |
| `python -m pytest tests -q -o addopts="" -k "bom or nozzle or pump or valve or hydraul"` | 126 passed, 1065 deselected |
| `python -m pytest tests -q -o addopts=""` (full backend) | 1170 passed, 21 skipped |
| `python validate_{bom_generator,nozzle_database,pump_curve,valve_authority,pipe_sizing,hydraulic_solver,engineering_package}.py` | all checks passed |
| `cd aquaflow/frontend && npx vitest run` on the three new test files plus fixtureLibraryPhysics, fixtureLibraryTotals and FixtureLibraryBrowser | all passed (22 new tests) |
| `npx vitest run` (full) | 857 passed, 1 failed |
| `npx vite build` | built OK (existing chunk-size warning only) |

**Full vitest failure, not caused by this ticket:** `src/utils/__tests__/showFileEngineering.test.js` fails because round-tripped `depth_zones` now carry `basinId: "basin-1"`. That field comes from the concurrent AF-NEXT-010 multi-basin work (`engineering/basins.js` / `engineeringProject.js`). This ticket did not change any file in that path.

## Known limitations / follow-ups

- **No real manufacturer data ships.** Everything in the app today is a generic estimate. Calculations will show "N generic estimate" warnings until verified models are entered.
- **Linking a placed fixture to a verified model is not in the UI yet.** The data path is in place: `fixture.provenance` and `fixture.equipmentModelId` flow into the BOM, the solver payload and the badges. A designer action that links a model and derives engineering values from its measured points (for example, nozzle K and jet height at the design pressure) is a follow-up. Today a fixture's provenance comes from its library type.
- **`runtime/dmxPatch.readPatch` ignores `engineering.dmxAddress`.** The designer edits that field. The replacement report compensates locally (`patchOf`). The shared reader was left unchanged.
- **Placeholder catalogs keep their brand names.** The nozzle and parts catalogs still use real brand names (OASE, Grundfos, Georg Fischer…) so that existing tests and validators keep passing. They are explicitly labelled `generic_estimate` with "placeholder — not from a datasheet" notes, and every BOM line built from them says so. Renaming them is a product decision.
- Field verification is still needed for any measured model before commissioning use.

## Rollback

- Remove the new files.
- Revert the edits listed above. The BOM columns are append-only, so removing them restores the old exports.
- Nothing migrates saved projects. `controlReview` and `provenance` on fixtures are optional fields that older builds ignore.
