# Frontend archive — inactive / superseded variants

Files here are **out of the active source tree** (outside `src/`), imported by
nothing, and **not bundled** by Vite. They are kept for history, not deleted.
One active code path per mounted panel/scene (AF-HUB-001).

| Archived file | Was | Superseded by | Why archived |
| --- | --- | --- | --- |
| `PreviewPanel_v4.jsx` | Old 3D-preview panel (v4) | `src/components/preview/PreviewPanel_v5.jsx` (mounted in `App.jsx`) | Dead duplicate; earlier archived under AQ-FIX-008. |
| `fountainExport.js` | Old preview show-exporter (Blender `.py` / USD / Alembic-JSON / CSV) | `src/export3d/` (glTF/GLB, OBJ/MTL, USD, FBX, LUXEXCHANGE — the AQ-X-016 3D Export Bridge) | Imported by **no** file in `src`; every export symbol (`exportToBlender`/`exportToUSD`/`exportToCSV`/`exportToAlembicJSON`) existed only in this file. |

## Active paths (single source of truth)
- **3D preview panel:** `src/components/preview/PreviewPanel_v5.jsx`
- **3D renderer/scene:** `src/components/preview/FountainScene_v6.js`
- **3D export:** `src/export3d/` (index + serializers) via `Export3DPanel.jsx`
- **Engineering / pool designer:** `src/components/panels/PoolGeometryDesigner.jsx`

Verified by a bounded orphan scan of `components/preview` + `components/panels`:
`fountainExport.js` was the only component with zero inbound imports.
