# AF-NEXT-010 — Multi-basin data model and CAD round trip (AF-CAD-013)

Date: 2026-10-13. Status: **Done** (acceptance tests green). Not committed; the worktree is shared.

## What changed

| Area | Files |
|---|---|
| Data model (frontend) | `aquaflow/frontend/src/engineering/basins.js` (new), `engineeringProject.js`, `store/engineeringStore.js` |
| Data model (backend) | `aquaflow/backend/services/basin_model.py` (new), `services/geometry_service.py` |
| CAD import | `engineering/cadExchange.js` (`previewCadImportResponse`, `previewCadImport`, `applyCadImport`, `defaultCadOutlineRoles`, `resolveCadOutlineRoles`), `components/panels/CADImportDialog.jsx` |
| CAD export | `cadExchange.js` (`exportCadDxf`; `requestCadExportDxf` sends `basins`), `backend/services/cad_export.py` |
| Designer | `engineering/useDesignerBasins.js` (new: state hook + canvas overlay), `components/panels/BasinListPanel.jsx` (new), `PoolGeometryDesigner.jsx` (wiring only, about 40 lines), `hooks/engineeringPublisher.js` |
| 3D | `components/preview/sceneBasin.js` (`multiBasinWorld`, `buildExtraBasin`), `basinGeometry.js` (`basinOpenings`, `basinRings`, `maskedWaterGeometry`), `venueModels.js`, `FountainScene_v6.js` (one line: `extraBasins` to the venue), `hooks/fixtureTypeMap.js`, `hooks/useEngineeringSync.js` |
| Hydraulics | `geometry_service._solve_pool_hydraulics(..., basins=)`, `api/routes/hydraulics_routes.py`, `engineering/hydraulicAdapter.js` |
| Contract | `docs/CAD-IMPORT-CONTRACT.md` (export section, multi-basin) |
| Tests | `backend/tests/test_af_next_010_multibasin_roundtrip.py`, `frontend/src/engineering/__tests__/afNext010MultiBasin.test.js` and 3 generated fixtures (`cad_multibasin_*.json`) |

## Data model and migration

The project now has `basins: [{id, name, outer:[{x,y}], holes:[[{x,y}]], floorLevel?, wallHeight?, depthZones:[], type?, center?/radius?/rx?/ry?, poolType?, params?}]`.

- **The legacy `geometry` field is always `basins[0]`** in the old shape. Consumers that do not know about basins still see the primary basin. The 3D world origin (`poolCenter(geometry)`) and the fixture centring do not move.
- **Migration is lossless.** A legacy `.aqua` with `geometry`, `holes`, `floorLevel` and `wallHeight` becomes `basins:[geometryToBasin(geometry)]`. The `geometry` object itself is untouched, and `basinToGeometry(basins[0])` deep-equals it. Circles and ellipses keep their native shape: `outer` holds a tessellated copy.
- **A file with only `basins`** gets `geometry` derived from `basins[0]`.
- **"Geometry wins":** if a non-migrated writer changes only `geometry`, `reconcileBasins` rebuilds `basins[0]` from it and keeps the other basins. The store's `updateEngineering` and `getProjectPayload` apply this rule, as does the backend's `migrate_project`.
- **Depth zones.** The flat `depth_zones` list is kept exactly as stored, so the legacy round trip is lossless (`showFileEngineering.test.js`). Each `basin.depthZones` is a derived copy: a zone goes to its explicit `basinId`, otherwise to the basin containing it, otherwise to basin 1. The designer stores one polygon per zone type per basin (`upsertBasinDepthZone`). In basin 1 it reuses the preset id; other basins get `<preset>-<basinId>`.
- **Backend.** `geometry_service.save_project` and `load_project` accept both shapes and store both. The old backend `basins:[{points}]` field meant "extra basins". It is still read that way whenever no basin has `outer`.

## Import / export

- Every outline chosen as a basin in the CAD dialog becomes a basin. By default that is every recognised basin. The "only one basin" warning is gone, and choosing a basin no longer resets the other choices.
- Each island attaches to its basin through `parent_handle`. If that is missing, it goes to the smallest chosen basin that contains it.
- Basin ids come from AQUAFLOW XDATA `id` when present, otherwise `basin-<handle>`. On re-import, the name and levels come back from XDATA too.
- Both DXF writers (browser and ezdxf) write every basin with its XDATA (`id`, `name`, `depth`, levels) and every island (`<basin>-island-n`, `basinId`).

## Acceptance evidence

Drawing: two basins (A, 20 × 10 m, with a 4 × 4 m island; B, 10 × 8 m), drawn in millimetres. It holds 5 jets and 2 lights across both basins.

| Criterion | Evidence |
|---|---|
| Import gives two basins, with the island under A | backend `test_import_reports_two_basins…`; frontend "offers both basins by default…", "confirmed project…" |
| Fixtures confirmed; one item edited (N-02 moved 0.5/0.25 m; controller addresses dmxAddress 205, plcChannel 12, iCAN 2/7) | both tests |
| Export DXF, then re-import: basin boundaries within 1 mm, ids stable, island parent kept | backend `test_reimport_keeps_basin_boundaries…`; frontend browser→browser and backend-writer→backend-importer cases |
| Fixture IDs, layers, coordinates (≤ 1 mm) and controller addresses survive; no duplicates | backend `test_reimport_keeps_fixture_ids…`; frontend `assertSurvives` (both writers) |
| No unexplained movement | the diff against the edited design shows 0 moved, added or removed. Against the original it shows exactly N-02, at 0.559 m |
| Unknown units need explicit confirmation | backend `test_unknown_units_require_confirmation`; frontend: the dialog keeps Import disabled, and `previewCadImport` throws until units are chosen |
| Hydraulics per basin | each nozzle goes to the basin that contains it, with one manifold per basin. Per-basin flow, volume and turnover are reported. A nozzle outside every basin goes to the nearest basin with a warning. Single-basin networks are unchanged |
| 3D | `multiBasinWorld`: the shared mask holds water in both basins but not on the island or in the gap. The water mesh covers both basins, and the deck has one opening per basin. Each extra basin gets its own floor, walls, coping and island tops at its own levels |

## Commands and results (2026-10-13)

- `python -m pytest tests -q -o addopts="" -k "cad or geometry or hydraul"` → **219 passed**, including the 10 new tests.
- `npx vitest run src/engineering/__tests__/afNext010MultiBasin.test.js src/utils/__tests__/showFileEngineering.test.js` → **20 passed**.
- `npx vitest run` (full) → 948 passed, 9 failed. All 9 failures are in `src/show/__tests__/evaluateShowFrame.golden.test.js` (AF-NEXT-004, "timeline runtime signals (per clip)"). That test belongs to the show-evaluator work another agent is doing concurrently and imports none of the files changed here.
- `npx vite build` → built (only the existing chunk-size warning).
- `sceneGuard.test.js` passes; `FountainScene_v6.js` grew by one line.

## Limits / follow-ups

- In the designer, multi-basin editing is deliberately minimal. You get a basin list, add, remove, rename, and a choice of which basin is active. The canvas edits the active basin; the other basins are drawn dashed. You can only select a basin from the list, not by clicking on the canvas.
- When basins overlap, the deck and promenade triangulation is undefined. Basins are expected to be separate.
- The hydraulics model a single shared pump with one manifold per basin. Pump-per-basin topology comes from AF-CAD-015 topology groups.
