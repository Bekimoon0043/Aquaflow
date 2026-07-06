# AquaFlow Studio — Architecture Break Review (Round 1)

Scope of files reviewed: full frontend `src/` tree (from frontend.rar) + backend
`main.py`, `device_manager.py`, `protocol_bus.py`, `runtime_transport.py`,
`network_scanner.py`, `show_engine.py`, `pattern_routes.py`, `runtime.py`.

The platform's logic is mostly sound. The failures are **contract mismatches at the
seams** — each module is internally fine but speaks a slightly different dialect than
the module it hands data to. Below, every claim is tied to a specific line of evidence.

---

## 0. The structural problem behind everything: competing file versions

The repo ships multiple live-looking copies of every integration-critical file:

- 3D scene: `FountainScene.js`, `_v5.js`, `_v6.js`, `_v6_backup.js` (+ `engineering/fountain V7.js`)
- Preview: `PreviewPanel_v1_backup` … `_v5` (+ `preview/PreviewPanel_v2..v5`)
- Geometry designer: `PoolGeometryDesigner.jsx` + 2 backups
- Pipe drawing: `usePipeDrawing.js` + 2 variants
- Pattern designer: `PatternDesignerPanel.jsx` + 1 backup

`App.jsx` currently mounts: `PreviewPanel_v5` → `FountainScene_v6`,
`PoolGeometryDesigner` (main), `PatternDesignerPanel` (main).

**Why it matters:** when you fix a bug you may edit a dead copy, and `grep` results are
polluted so the "source of truth" is ambiguous. **Action: move every non-mounted
variant into an `/_archive` folder outside the build before we start fixing.** This is
prerequisite #0.

---

## 1. CRITICAL — Fixture type vocabulary mismatch ("everything becomes center_jets")

This is the single highest-impact bug and it explains *all four* of your reported
symptoms (arch jets disappear, fire disappears, air burst disappears, categories merge).

**The data:** when a fixture is placed, `PoolGeometryDesigner.jsx:1251` stores
`type: fixtureType`, where `fixtureType` is the **library key** — e.g.
`"nozzle_arch_large"`, `"nozzle_straight_dn25"`, `"effect_flame_single"`,
`"effect_air_burst"`, `"motion_nozzle_3d_robotic_module"` (70 keys total in
`fixtureLibrary.js`).

**The consumers all match against short tokens, not keys:**

| Consumer | File / line | Expects |
|---|---|---|
| Pattern group matcher | `PatternDesignerPanel.jsx:48` `matchProfessionalGroup` | `"arch"`, `"ring"`, `"geyser"`, `"jet_3d"`, `"mist"`, `"cascade"` |
| Scene per-nozzle group | `FountainScene_v6.js:1817` `_groupIntensityForNozzle` | `"jet_3d"`, `"arch"`, `"ring"`, `"cascade"`, `"mist"` |
| Device group selector | `deviceGroupSelector.js` `matchNozzleTypes` | `"jet_1d/2d/3d"`, `"arch"`, `"ring"`, `"cascade"`, `"mist"` |

`"nozzle_arch_large" === "arch"` is never true. Every fixture falls through to the
`return "center_jets"` default at `PatternDesignerPanel.jsx` (and to `fallback` in the
scene). So arch/fire/air-burst nozzles don't *disappear* — they get silently dumped into
the center-jets group and stop responding to their own group's signal.

**Note the partial bridge that already exists but isn't used here:**
`fixtureTypeMap.js` (`resolveFixtureType`) *does* fuzzy-map keys → tokens correctly
(`key.includes("arch")` → arch, etc.) and is used by `useEngineeringSync` for the 3D
geometry push. But `PatternDesignerPanel` and `_groupIntensityForNozzle` **don't call
it** — they re-implement matching with exact-equality and miss.

### Fix
Create one canonical resolver used by *every* consumer:
`fixtureType (library key) → { nozzleType, group, isLight, deviceClass }`.
`fixtureTypeMap.resolveFixtureType` is 80% of it already. Then:
- `PatternDesignerPanel.matchProfessionalGroup` → call the resolver, delete the
  exact-match list.
- `FountainScene_v6._groupIntensityForNozzle` → resolve `nozzle.config.type` to a token
  (or, better, store the resolved `group` on the nozzle at build time in
  `setNozzlesFromEngineering`).
- `deviceGroupSelector.buildDeviceGroups` → match on resolved token, not raw key.
This is a half-day fix and will visibly reconnect the Pattern Designer to engineering.

---

## 2. CRITICAL — Pattern Designer reads a store key that doesn't exist

`PatternDesignerPanel.jsx:120`:
```js
const poolGeometry = useEngineeringStore(s => s.poolGeometry);
```
**`engineeringStore` has no `poolGeometry` key** — its key is `geometry`
(`engineeringStore.js`). The only `poolGeometry` in the codebase lives in the *other*
store (`showStore.js:985`) and in the scene classes. So inside the Pattern Designer,
`poolGeometry` is permanently `undefined`.

Effect: the Pattern Designer cannot position/scale anything against the real pool — it
can only place nozzles by raw x/y. Combined with bug #1, this is why the Pattern
Designer "doesn't receive its input from the engineering design."

### Fix
Change to `s => s.geometry`, and standardize the name. Pick **one** key name
(`geometry`) everywhere and grep out the rest.

---

## 3. CRITICAL — Two stores, no bridge for the data the runtime needs

There are two Zustand stores:
- `engineeringStore.js` — geometry, fixtures (with full `engineering:{}` data), layers,
  hydraulics, BOM. Declares itself "single source of truth."
- `showStore.js` — `timelineTracks`, `devices`, `nodes`, `engineeringFixtures: []`
  (line 368), plus its own `poolGeometry`.

`PoolGeometryDesigner` writes to **both**: `useEngineeringPublisher(...)` (→ engineering
store, confirmed wired at `PoolGeometryDesigner.jsx:382`) **and**
`setEngineeringFixtures(fixtures)` (→ show store, line 392). So fixtures are copied into
`showStore.engineeringFixtures`, but:

- The **timeline** (`showStore.timelineTracks`) is **not generated from those
  fixtures.** Tracks are created from `devices` and manual `addTrack` calls
  (`showStore.js:531, 795`). There is no "fixtures → tracks" generator. So the timeline
  doesn't know your real fixtures exist.
- The **backend snapshot** (`show_engine.get_snapshot()` and the WS `save_show` payload)
  carries `nodes / connections / timelineTracks / devices` — **never fixtures or
  groups.** So nothing about the engineering model reaches the backend, the runtime
  transport, the PLC mapper, or Push-To-Devices. This is your "Push To Devices exports
  only some device types": it exports `devices` (the 10 seed devices in
  `device_manager.py SEED_DEVICES`), not your placed fixtures.

### Fix (the big one — this is the "single source of truth" work)
1. Make `engineeringStore.fixtures` the master.
2. Add a deterministic **`fixtures → timelineTracks` projection** (group by resolved
   group from #1; one track per group; deviceId from the resolved deviceClass).
3. Extend the backend show payload contract to include `fixtures` and `groups`
   (`show_engine.load_show`/`get_snapshot`, and the `sync_show`/`save_show` WS handlers
   in `main.py`). Until the backend stores fixtures, runtime/PLC/push can only ever see
   the seed devices.

---

## 4. CRITICAL — 3D coordinate axis convention is applied inconsistently

`fixtureTypeMap.fixturesToNozzleConfigs` maps engineering `(x, y)` → 3D `(x, z=y)` with
the comment "Engineering uses Y for depth-axis, 3D uses Z." Good.
But `PatternDesignerPanel.buildGroupsFromFixtures` maps
`z: fixture.y ?? fixture.z ?? fixture.position?.y` — a *different* fallback chain — and
`NozzleMap` consumes `position:{x, y:n.z}`. Mixed `y`/`z` conventions across three files
mean the Pattern Designer top-view and the 3D view can place the same nozzle in
different spots. This is part of "2D nozzle positions ≠ 3D nozzle positions."

### Fix
Define the axis contract once (recommend: engineering plan = `(x, y)`, world = `(x, 0,
y)` with height on world-Y). Centralize the conversion in one helper and forbid ad-hoc
`?? z ??` fallbacks.

---

## 5. HIGH — Geometry shape contract mismatch (rectangle becomes circle)

`engineeringStore.getPoolBounds` and the scene read `geometry.type` as `"circle"` /
`"ellipse"` / points. `PoolGeometryDesigner` sets `geometry={type:"circle", ...}` /
`{type:"ellipse"}` (lines 120/128/1186) — consistent for those. But the auto-array
generators (lines 1705–1722) assume `geometry.radius` exists even when the pool is
rectangular, and `geometryToPoolConfig` passes `poolType` separately from
`geometry.type`. When `poolType="rectangular"` but the generator falls back to a
radius-based ring, a rectangular pool's fixtures get laid out on a circle. That matches
your "rectangular fountain became a circle" note.

### Fix
Make `poolType` and `geometry.type` a single enum, and have array/placement helpers
branch on it explicitly (rectangle → perimeter/grid math; circle → radial). The
assessment doc's "Array Placement System" gaps (rectangle/polygon/arc perimeter) belong
here.

---

## 6. HIGH — Backend `pattern_routes.py` imports modules that don't match the runtime

`pattern_routes.py` does:
```python
from backend.engine.protocol_bus import get_protocol_bus      # set_dmx_map
from backend.engine.show_engine   import get_show_engine       # import_timeline_clips
from backend.main import broadcast                              # WS broadcast
```
But: (a) the actual package paths elsewhere are `engine.*` / `app_state` /
`main.py`, **not** `backend.*` — every import here is wrapped in try/except and will
**silently fail**, so DMX maps and recorded clips are written to JSON files but **never
pushed live**; (b) `protocol_bus.py` exposes **no `get_protocol_bus()` and no
`update_dmx_map()`**; (c) `show_engine.py` has **no `get_show_engine()` and no
`inject_manual_clips()`**; (d) `main.py` defines `broadcast_show_snapshot`/
`broadcast_playback_state`, not a bare `broadcast`. So the Recording tab → timeline
injection path is dead at the seam.

### Fix
- Fix import paths to the real package layout (drop `backend.` prefix or make the package
  importable as `backend`).
- Add the missing singletons/methods: `protocol_bus.get_protocol_bus()` +
  `update_dmx_map()`, `show_engine.get_show_engine()` + `inject_manual_clips()`, and a
  real `main.broadcast` (or import `ws_manager.broadcast`).

---

## 7. HIGH — `device_manager` vs `protocol_bus` device identity divergence

`protocol_bus.start()` imports `from engine.device_manager import SEED_DEVICES` and keys
drivers by `device.id`. But the show runtime routes commands by `device_type`
(`protocol_bus._route_command` switches on `cmd["type"]` in pump/valve/flame vs
lighting/fog/laser). The timeline clips produced by `show_engine._evaluate_timeline`
emit `device_id` + `type` from the **track**, which currently come from seed devices —
not from engineering fixtures (see #3). So even when routing works, it routes to seed
hardware, not your designed fixtures.

### Fix
Once #3 lands (fixtures reach the backend), give each fixture a stable `device_id` and a
`protocol/address` block (DMX universe+channel, or Modbus host+register) sourced from the
fixture's `engineering` data, and have `protocol_bus` build its `_device_map` from
fixtures, not just `SEED_DEVICES`.

---

## 8. MEDIUM — Fixture library realism is good but incomplete vs the mappers

`fixtureLibrary.js` engineering blocks are realistic and well-formed: `flowLpm`,
`pressureBar`, `jetHeightM`, `nozzleDiaMm`, `sprayAngleDeg`, `plcChannel`,
`connectionSize`, `material`. `fixturesToNozzleConfigs` already uses `pressureBar`,
`jetHeightM`, `flowLpm` to scale the 3D effect — that's the right idea and means a
DN40 jet *will* throw higher than a DN15 once #1 is fixed.

Gaps to make it behave "as the real equipment does":
- Effects (`effect_flame_*`, `effect_air_burst`, `effect_fog_machine`) and motion
  nozzles (`motion_nozzle_1d/2d/3d`) have **no mapping** in `fixtureTypeMap` or
  `_groupIntensityForNozzle`, so they won't animate or group correctly even after #1.
- No driver-side use of `plcChannel` yet (it's authored in the library but nothing reads
  it). This is the natural hook for real PLC I/O mapping.
- Pumps/VFDs/valves carry kW and DN ratings but there's no pump-curve / duty model, so
  hydraulic results stay "preliminary sizing" (matches your gap doc §A/§B).

---

## 9. The trial-run failure (placeholder — fill in)

> You mentioned a specific error when launching a trial program. Paste the exact console
> output / backend traceback / on-screen message and I'll slot the root cause here. Based
> on the above, the most likely candidates are: (a) `poolGeometry` undefined in Pattern
> Designer (#2) throwing on `.params`/`.type` access; (b) a `pattern_routes` import
> failing if the package *is* importable as `backend` and a missing symbol raises;
> (c) timeline producing no active commands because tracks were never generated from
> fixtures (#3).

---

## Fix sequence (proposed)

**Phase A — stop the bleeding / reconnect design→preview (1–2 days)**
0. Archive all dead file variants. (#0)
1. One canonical `resolveFixtureType` used by Pattern Designer, scene, and group
   selector. (#1)
2. Fix `poolGeometry`→`geometry` and standardize the key. (#2)
3. Centralize the axis-conversion helper. (#4)

**Phase B — single source of truth (3–5 days)**
4. `fixtures → timelineTracks` projection. (#3)
5. Extend backend show payload to carry `fixtures` + `groups`; update `show_engine`
   + WS handlers. (#3)
6. Geometry/poolType enum unification + correct rectangle vs radial placement. (#5)

**Phase C — runtime / hardware truth (1 week+)**
7. Fix `pattern_routes` imports + add the missing backend singletons/methods. (#6)
8. Fixture → device_id + protocol/address derivation; protocol_bus builds map from
   fixtures. (#7)
9. Map effects + motion nozzles; wire `plcChannel` into PLC I/O. (#8)
10. Real hydraulic/pump-curve engine + validation pass (your gap doc §A/B/I).

---

## What I still need from you

1. **The exact trial-run error** (console + backend log).
2. The backend files not yet shared but referenced by what I have:
   `safety/safety_kernel.py`, `scheduler/scheduler_engine.py`, `app_state.py`,
   `services/compiler_bridge.py`, `services/runtime_exporter.py`,
   `contracts/runtime_contract.py`, and `api/routes/{shows,devices,plc,...}.py`.
   These define the *real* runtime/PLC/compile contracts that #3/#6/#7 must match.
3. Confirmation of the backend package layout (is the root importable as `backend`, or
   are `engine/`, `safety/`, `api/` top-level?). This decides the #6 import fix.
