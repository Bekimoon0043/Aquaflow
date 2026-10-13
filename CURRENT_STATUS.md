# AquaFlow Studio — Current Status

**2026-10-13: AutoCAD import + rendering programme (AF-CAD / AF-3D) — source only, not yet packaged**

Plan: `AF-CAD-DESIGN-RENDER-PLAN.md` (research report + 45-task phased plan). API
contract: `docs/CAD-IMPORT-CONTRACT.md`.

- **AutoCAD import (backend, ezdxf 1.4, MIT).** `POST /api/cad/import` reads ASCII/binary
  DXF up to 100 MB: units ($INSUNITS, unitless → suggested unit + warning), nested /
  mirrored / dynamic blocks (effective names), ATTRIBs, AQUAFLOW XDATA, curves flattened,
  hatches, text, closed outlines with islands, ACAD_TABLE + text-grid schedules, XREF list
  (`services/cad_import.py`). Recognition with confidence + reasons, multilingual keywords,
  geometry signatures, tag↔schedule join with field provenance, saved mapping templates
  (`services/cad_recognition.py`, AF-CAD-010/012/016). Re-import diff (AF-CAD-017).
  Pipe topology → pump/valve/nozzle groups → hydraulic solver input
  (`services/cad_topology.py`, AF-CAD-015). AutoLISP `AQFEXPORT` plugin for the
  zero-licence DWG path (`aquaflow/tools/autocad/`, AF-CAD-019 — **not yet run inside
  AutoCAD**).
- **One DXF writer** (`services/cad_export.py`, AC1027, blocks `AQF_<TYPE>_<MODEL>` with
  ID/MODEL/HEIGHT/CHANNEL attributes, XDATA). The engineering package, `/api/cad/layout`
  and the designer export now produce the same DXF; legacy R12 is opt-in
  (AF-CAD-003/020). **Behaviour change:** `/api/cad/layout` returns AC1027 by default.
- **Import UI.** `CADImportDialog.jsx` uses the backend (offline fallback to the old
  client parser): review by confidence, apply-to-all-instances, basin/island choice,
  wall height / floor level, land from hatches, diff before apply, optional hydraulic
  network confirmation. Fixture IDs and hardware addresses are preserved; addresses are
  never invented. Whole drawing kept as a locked per-layer underlay in 2D and 3D
  (AF-CAD-011). One CAD → plan → 3D frame in `geometryContract.js` (AF-CAD-001). SNAP-off
  drag keeps full precision (AF-CAD-002). ODA converter gated for commercial editions
  (AF-CAD-018). d92c329 is in installer 1.2.31.
- **Rendering.** Freeform/L-shaped basins and islands now use a polygon mask for
  particles, splash and ripples instead of a rectangle (AF-3D-017; circle/rect pools
  unchanged). Tone mapping ACES/AgX/Neutral (AF-3D-024). Up to 1024 fixture lights via a
  light texture with HG scattering (AF-3D-022). Half-res spray pass (AF-3D-008).
  Instanced light bodies — 300 lights: high 1994 → 503 draw calls, medium 854 → 258
  (AF-3D-019). `FountainScene_v6.js` 4387 → 3173 lines, split into scenePost / sceneLighting /
  sceneBasin / sceneShaders / sceneQuality, with a line-count guard test (AF-3D-021/018).
- **AF-3D-020 benchmark (software renderer, fps not meaningful):** 64 valves, 7 pumps,
  300 fixtures — low 703 draw calls / 251k tris, medium 844 / 956k, high 1562 / 3.31M.
  Real-GPU fps still to be measured.
- **Tests:** frontend 812 passed, 2 failed (`referenceFountainShow.test.js`: missing
  `outputs/Reference_Keyhole_Crown_Fountain.aqua`, pre-existing); `vite build` OK.
  Backend 1137 passed, 21 skipped, 1 failed (`test_loopback_output_timing_within_spec`,
  also fails on clean HEAD).
- **Open:** AF-CAD-013 multi-basin data model; Phase 2 CAD designer tools (AF-CAD-030…041);
  AF-3D-023 three.js/WebGPU spike; dense all-on lighting washes the pool near-white under
  ACES (needs real-GPU tuning); test against a real customer fountain DXF.

**2026-10-09 (later): Siemens device model + setup wizard — installed as 1.2.21**

- **New screens.** Devices → PLC opens on **Siemens Setup**, a 7-step wizard: Design →
  Hardware → Wiring → Export to TIA → Connect → Test → Run show. Siemens terms such as
  PUT/GET, DB, rack/slot and watchdog show a plain-language explanation.
  - **I/O Map** tab: device → PLC tag → address → module/channel → live value, a Test
    button per device, a printable wiring sheet, and TIA tag-table export/import.
  - The old long page is still available as **Advanced Site**.
  - The Engineering inspector shows each item's real Siemens tags. The free-text field is
    renamed "PLC note".
- **Device model** (`backend/engine/siemens_devices.py`): the site is built from the
  Engineering design, without replacing the layout.
  - A nozzle uses its linked valve, else the nearest placed valve, else gets its own valve.
  - Each valve is fed by its nearest pump unless the operator chooses another.
  - Unsupported items (fog, flame, etc.) are listed with a reason.
  - Tag convention: `P01_Speed`, `P01_Run`, `V03_Open`, `L02_Red`, `SAFE_EStopOK`.
  - `sync-design` keeps existing wiring and reports any change to the program signature.
- **Hardware catalog.** Classic S7-1200 G1 CPUs, signal boards and signal modules, with order
  numbers and the TIA default addresses.
  - Addresses are assigned automatically.
  - When something doesn't fit, AquaFlow names the part to add (e.g. 1212C → SB 1232 AQ1)
    and produces a parts list.
  - G2 / V1.x firmware is refused.
- **TIA tag tables.** Export as .xlsx for TIA import; the TIA package now also contains the
  tag table and `WIRING-SCHEDULE.csv`.
  - Import reads a TIA tag export and recognises roles from the naming convention or from
    names/comments (pump speed/run/fault, valve, light, safety).
  - Each guess shows a confidence and a reason. Nothing is applied until the operator
    confirms it.
- **Show translation.** Compile now accepts Show Programmer clips on nozzles:
  - nozzle clips become valve windows, with minimum on/off times enforced;
  - a pump without its own clips follows its outlets at its show speed;
  - a plain-language report says what changed.
- **Acceptance runner.** One button runs: verify → pulse each valve (with its pump) and each
  light → 1.6 s communication silence (PLC must trip with watchdog fault 2, then recover
  on a fresh OFF) → all OFF.
  - Results are stored per site in `siemens_acceptance.json`.
  - A PLCSIM pass proves the program, mapping and communication, not the wiring.
- **Quick fixes:**
  - S7 tag-profile polling no longer crashes (`PLCTag` had no `access` / `profile_id`
    fields).
  - Generic tag writes are refused for read-only tags or without the safety permit.
    Writing 0 is always allowed.
  - Monitor shows no fake demo values.
  - Tag Browser asks for confirmation before a write.
  - Garbled characters in SiemensSitePanel fixed.
- **Engine switch.** The installer now ships `resources/engine-1.2.21`, replacing the pinned
  pre-1.2.16 engine, which stays in `resources/` for rollback. Checked first:
  - every saved site keeps its signature (`0x6A3198F3` and `0x4794E8BA` unchanged);
  - the packaged Siemens smoke test passes;
  - the packaged engine passes the acceptance run over real S7comm.
- **Validation:**
  - Backend: Siemens/PLC suite **175 passed**, including 13 new device-model tests and an
    acceptance test against a Python twin of the generated PLC function block.
  - Frontend: **644 passed (63 files)**; production build green.
  - Browser e2e through the wizard against a stand-in PLCSIM passed with zero page errors.
  - Not yet tested: real PLCSIM / TIA, and a real S7-1200.
- **Also fixed in 1.2.20:** a Show Programming black screen caused by `e.currentTarget`
  being read inside a setState updater. A `PanelErrorBoundary` now wraps the workspace.
- **1.2.22 follow-up (operator report: "PLCSIM doesn't connect; preview asks to compile").**
  - **Diagnosis:** NetToPLCsim (listening on 192.168.43.41:102) answers the network handshake
    (COTP connect confirm) but closes as soon as the S7 setup is forwarded. AquaFlow's own
    client and an independent snap7 client fail the same way, so the NetToPLCsim → PLCSIM link
    is down; AquaFlow's S7 client code has not changed since the working version. The training
    site had also been saved with DB102; its proven signature 0x4794E8BA requires DB100.
  - **Compiled shows.** Saving any setting still clears the compiled show (deliberate safety
    rule), but the clips are kept as `previous_show_clips` and there is a one-click
    "Recompile previous show".
  - **Connect step:** offers "Use this PC's address" from the network adapters, warns when the
    saved IP is not on this PC and when the DB is not 100, and explains raw S7 errors in plain
    language (`explainS7Error`).
  - **Validation:** 647 frontend tests; Siemens backend suites green; packaged 1.2.22 smoke
    PASS; acceptance PASS over S7 at 192.168.43.41.
- **1.2.23 (operator: "playback says AquaFlow-only, DB100 will not change").**
  - **Cause:** the start happened while the site was still in internal-preview mode, where
    Verify always passes. Meanwhile the real PLCSIM Verify was failing on the NetToPLCsim
    hang-up. After NetToPLCsim was restarted, a read-only check shows DB100 = `AF03 0002`.
  - **PLCSIM is now the default test PLC.** The Connect step preselects it with this PC's
    address. Internal preview is renamed "AquaFlow animation only (no PLC; TIA does not
    change)", and the Run step offers a "Switch to the PLCSIM test PLC" button.
  - **Live PLC monitor:** `GET /{sid}/plc-live` → `SiemensRuntime.peek()`. A read-only DB read
    when idle; while a show runs it returns the play loop's last frame. The UI watch table shows
    heartbeat, Ready/Running, watchdog, permits, command/ack and per-device command vs PLC
    feedback.
  - **Validation:** browser e2e against the stand-in PLCSIM showed "PLCSIM playback started" and
    the monitor reading "Main pump RUNNING 30% / Centre valve OPEN". Frontend 648 passed;
    Siemens backend suites green; packaged smoke PASS.
- **1.2.24: Show Programming → PLC in one click.** The operator confirmed AquaFlow now drives
  real PLCSIM (TIA shows DB100 changing).
  - **Play on PLC:** the Show Studio Compile tab has a "Play on Siemens PLC" section
    (`studio/StudioPlcPanel.jsx`). It uses the project's site and a confirmation tick, and
    "▶ Play this show on PLCSIM" runs compile (with translation) → verify → master safety
    arm → site arm → start, stopping at the first failure with a plain explanation. It also
    has "■ Stop PLC".
  - **Follow mode:** while the PLC plays, the playhead, 2D plan and 3D preview follow the PLC's
    show time. The transport bar shows "PLC ▶ n.ns". The live DB monitor sits in the same tab.
  - **Clearer compile error:** compiling a timeline from a different design now says so
    plainly instead of "Provide between 1 and 20000 clips".
  - **Validation:**
    - browser e2e: 3 timeline clips → "Compiled 4 PLC commands; 2 nozzle clips became valve
      commands; Main pump runs at 30%". The monitor showed Centre valve OPEN and Ring valve
      CLOSED at 2 s (its jet starts at 3 s), and Stop acknowledged OFF;
    - frontend 651 passed; Siemens backend suites green; packaged smoke PASS; installed 1.2.24.
- **Training show:** wrote `Desktop/AquaFlow-PLCSIM-Training-Fountain-60s-Show.aqua`, 96 clips
  in 7 sections at 120 BPM.
  - It respects pump ≤ 40 % and valve 500 ms on/off, and a jet is always open while the pump
    runs.
  - Compiled against the real site; played on the stand-in PLCSIM; the operator confirmed it on
    real PLCSIM.
- **1.2.25: easier timeline editing** (frontend only; engine unchanged).
  - **Rows:** fixture clips show one row per device channel by default ("Main Pump · Speed",
    "Center Jet A Valve · Open", …) in Engineering order.
  - **Live limit check:** `studio/plcLimits.js` checks every resolved clip against the selected
    site, mirroring backend translate + compile:
    - errors: overlapping light clips, more than 30 min;
    - warnings: valve shorter than min-on, gap shorter than min-off, pump above its ceiling,
      pump commanded while all its jets are closed;
    - info: clips the PLC skips.
  - **Display:** clips get amber/red edges with tooltips, the inspector shows the explanation,
    and the arrangement strip has a "⚠ N PLC warnings / ✓ PLC limits OK" button whose list jumps
    to the clip.
  - **Bug fixed while testing:** older sites have no `nozzle_ids`, so nozzle clips (e.g. a
    pattern on the Training Fountain's "center jets" group) were silently skipped by Play on
    PLC. Engineering `linkedValveId` now maps them onto their valve (`clipsForPlc`).
  - **Validation:** 657 frontend tests and production build green. Browser e2e with the 60 s show
    gave "✓ PLC limits OK"; shortening Jet A to 0.2 s gave "⚠ 3 PLC warnings" (min-on, plus the
    pump running dry for 3.5 s and 4 s).
- **1.2.26: groups by tick box** (frontend only). Show Explorer items have tick boxes (no
  Ctrl/Shift needed), and group rows have a tick-all box. A "N ticked · Clear" bar and the
  footer "Create group from N ticked" make the group, which gets its own timeline row at once.
  Group rows have a ＋ button (pattern at the playhead), double-click adds a pattern at that
  time, and an empty group row shows a hint. Browser e2e on the 60 s Training show: tick 2
  nozzles → "Both jets" → ＋ → Traveling wave → PLC limits OK → Play on PLCSIM compiled 91
  commands. 657 frontend tests, build green.
- **1.2.27: audit fixes (plan items 1, 2, 3, 4 and 6)**, installed.
  - **Safety:** Calibration "START SIM" used to POST all-OK safety inputs every second, and
    "CLEAR ALL FAULTS" forced every input including `estop_chain_closed` to true.
    - The simulation is now display-only, which a test checks.
    - Clearing restores only the inputs the panel itself injected, after a confirmation.
    - The panel lists the open design's nozzles.
    - Browser check: 0 POSTs during simulation.
  - **Edit commands:** the Engineering Designer and global Timeline acted on Edit → Delete while
    hidden; they are now gated to their own active panel.
  - **G2 protection:** `siemens_hardware.classify_s7_1200`. G1 is `-x40`, G2 is `-x50` (its
    FW V4.1 looks like G1), F is `-1xF40`. Identify CPU reports the generation. The hardware
    picker and glossary give a "no G2 substitution" warning and the G1 end-of-sale dates
    (announced 1 Nov 2026, orderable until 1 Oct 2027).
  - **Fixed gate bug:** the G1 CPU 1214C (`214-1AG40`) was rejected.
  - **Equipment library (596 items):**
    - all flagged `generic` with a "verify with supplier datasheet" note;
    - physics consistent: jet height ≤ 0.9·head with η per type, orifice flow, pumps 50–65 %
      wire-to-water;
    - duplicate labels fixed; `plcChannel` defaults removed;
    - realistic DMX footprints; currents include motor efficiency;
    - totals, BOM and DMX patch now count generated pumps and lights;
    - unknown types no longer silently copy Straight Jet DN15;
    - Show Programming resolves library categories (RGB lights get R/G/B; the dosing pump is
      not a pump);
    - the hydraulic solve uses connection DN, not the orifice, as pipe size and only takes
      water nozzles;
    - validator: 28/28.
  - **Menus:** Cut/Copy/Paste/Select All via edit-command with a "not available in X" notice.
    New Preferences modal (grid, snap, timeline zoom, analytics) and About modal (versions,
    backend, license). Import/Export Show use real .aqua files. AI menu gains "AI Assistant
    (learned patterns)". The AI/Music Show Builder opens the AI tab. The dead Dry-Run Preview
    toggle is replaced with a hint.
  - **Validation:** frontend 713 tests in 70 files; Siemens backend suites green; full UI crawl
    (61 menu entries, 416 tabs) with no crashes, exceptions or failed API calls; targeted
    browser checks all pass; engine 1.2.27 smoke PASS.
  - **Open:**
    - item 5, real supplier catalogs, needs the brand list;
    - item 7, S7-1500/ET 200SP on S7comm;
    - item 8, OPC UA transport for G2/S7-1500;
    - LOGO! via Modbus (optional).
- **2026-10-10: 1.2.28 S7-1500 / ET 200SP and 1.2.29 stable license fingerprint**, both
  installed.
- **S7-1500 / ET 200SP (plan item 7)** run on the unchanged DB100 v2 contract (PUT/GET,
  non-optimized DB, rack 0 / slot 1, OB200 cyclic, all valid on S7-1500).
  - **Catalog:** the order numbers below were checked against Siemens Mall and distributor
    listings on 2026-10-10.
    - CPUs: 1511-1 PN `6ES7 511-1AL03-0AB0`, 1513-1 PN `513-1AM03`, 1511C-1 PN `511-1CL03`
      (16 DI / 16 DQ / 5 AI / 2 AQ), 1512C-1 PN `512-1CM03`, ET 200SP 1510SP-1 PN `510-1DK03`.
    - S7-1500 modules: DI16 `521-1BH10`, DQ16 `522-1BH10`, AI8 `531-7KF00`, AQ4 `532-5HD00`.
    - ET 200SP modules: DI8/16 `131-6BF01/6BH01`, DQ8/16 `132-6BF01/6BH01`, AQ2 HS `135-6HB00`.
    - Not added, numbers unverified: 1512SP and 1515-2.
  - **Addressing:** TIA sequential addressing from 0 in slot order. Compact CPUs keep their
    built-in analog at 0 and digital at bytes 10 (in) / 4 (out).
  - **Rules:** firmware V2.8–V4.x; the family must match between CPU and modules; no signal
    boards.
  - **Recognition:** `classify_s7_1200` recognises S7-1500, ET 200SP CPU, F/TF and R/H;
    `supported_s7_identifier` is used by readiness.
  - **Picker:** CPUs grouped by family, family-specific modules and firmware, an "Add all
    suggested parts" button, and an automatic preview refresh.
  - **Validation:** tests include a full acceptance run against the FB twin with a 1511C
    configuration. **Not yet proven on PLCSIM Advanced or a real S7-1500.**
- **License fingerprint bug (found while testing):** the installed app reported `INVALID_HW` on
  the licensed PC.
  - **Cause:** v1 fingerprint = sha256(uuid.getnode() MAC | CPU | board | host), and getnode
    picks whichever adapter comes first. A USB adapter present on 10/09 gave 142ca354; the
    Wi-Fi adapter gives c3c9454f.
  - **Fix:** new `license/fingerprint.py`, with a PowerShell CIM fallback for wmic.
    - **v2** stable ID = sha256("aquaflow-fp-v2|CPU|board|host"), no MAC. This is what
      `/api/license/fingerprint`, `get_fingerprint.py` and the License Manager now issue.
    - **`validate_for_this_machine`** also accepts legacy v1 licenses for any present adapter
      MAC. Explicit remote validation with a fingerprint still uses only that fingerprint.
    - **License Manager** (rebuilt) treats every fingerprint of this PC as "this PC".
  - **Tests:** `test_license_fingerprint_stability.py`; existing license/installer suites green.
  - **Real-machine check:** packaged engine v2 id `e5631edf…`; current license VALID.
  - **Doc:** LICENSE-ADMIN.md has a note on the change.
- Guide: `aquaflow/docs/SIEMENS-SETUP-WIZARD.md`. The License Manager desktop tool was built
  outside this repo on purpose.

**2026-10-09: Show Programming full-screen workspace — implemented in frontend**

- Added the dedicated Show Studio shell with Engineering inventory, searchable and
  virtualized groups/items, 2D plan, matrix, embedded 3D water preview, and timeline.
  The standard Device/Inspector panels no longer constrain this workspace.
- Added persistent ordered/nested groups, Engineering-linked membership, frozen
  selections, reusable presets, recipe pattern editing, mute/solo/lock inheritance,
  background resolution to existing runtime clips, and missing-item/group diagnostics.
- Added custom level envelopes, tempo-map beat snapping, timeline marquee/multiple
  selection, batch movement, copy/paste, duplicate and delete as undoable transactions.
- Preview works without music. Music can be relinked with an arrangement waveform.
  Existing array/music tools, full video-render handoff, and Siemens controls remain
  accessible. AI proposals are scoped to a group and applied as one undo transaction.
- Existing clip-only programs migrate without changing clip values. Save/Open retains
  groups, recipes, presets, markers, layout, and resolved clips in the `.aqua` document.
- Validation: full frontend suite **629 passed (61 files)**, including 17 new
  recipe/group/curve/tempo/batch-edit tests. Production Vite build passed.
  Final browser acceptance passed with zero page errors (selection, playback, save,
  reopen, undo/redo, scoped AI approval, curves, batch timeline edits, and embedded 3D).
  Browser checks use 320 synthetic fixtures and a mock AI response; no PLC was run.
- Guide: `aquaflow/docs/SHOW-STUDIO-GUIDE.md`. Remaining advanced roadmap features are
  identified there. This update is built locally, not yet packaged or installed.

**2026-10-09: Engineering Designer ↔ editable 3D viewport synchronization — implemented**

- The existing 3D scene graph now follows live Engineering changes without recreating
  the viewport. Switching workspaces or editing the pool, fixtures, or venue content
  preserves the camera, valid selections, hierarchy/inspector subscriptions, and gizmos.
- Added the inverse world-to-engineering coordinate contract. Moving a fixture in the
  centered 3D pool now saves the correct plan coordinate instead of accumulating the
  pool-center offset on repeated saves.
- Persisted group IDs remain stable, explicit ungrouping remains ungrouped, and textured
  site-model hierarchy, visibility, and lock state round-trip in the unified project.
- Engineering refreshes are applied as one atomic scene-graph transaction, preventing
  intermediate partial graphs from being published back to Engineering. Renderer cache
  invalidation now includes fixture height, visibility, tilt, rotation, color, intensity,
  radius, zone, and grouping.
- Validation: frontend **603 passed (59 files)**; focused sync suite **80 passed**;
  production Vite build green. Existing Three.js/mediabunny chunk-size warnings remain
  advisory. This increment is built in the workspace and is not yet packaged/installed.

**2026-10-08: Unified AquaFlow project core + Water Realism V2 — implemented**

- Desktop update packaged and installed as **1.2.18**. Fixed a packaged-Electron
  startup crash where debug logging to a closed parent console raised `EPIPE` in the
  main process. Normal Desktop-shortcut launch stays running and `/api/health` reports
  API/runtime healthy. The installer deliberately pins the known-working pre-1.2.16
  Siemens/PLCSIM engine (SHA-256 `F234DC567927EE47E63BA13DDC7060E752AEB9FDBE0CA836E02B4E5B15B1F682`).
- Migrated the 20-second Siemens training fountain into one AquaFlow 1.1 `.aqua`
  project: 6 fixtures, 14 clips, 7 generated tracks, 4 cues, DB100, site revision 2
  and signature `0x4794E8BA`. A verified byte-identical copy is on the Desktop.
- Added one versioned `.aqua` project document for engineering geometry, show data,
  programmer/timeline state, 3D render settings and Siemens-site selection. Opening,
  saving and autosaving now restore those workspaces as one project instead of relying
  on panel-local browser state. Legacy `.aqua` files remain importable.
- The Programmer workspace now restores clips, cues, beat markers, timeline position,
  zoom and selection. Audio binary data is intentionally excluded; a safe file
  reference is retained in the project document.
- Added a coupled, damped height-field simulation to the 3D water surface. Real jet
  impacts feed the wave solver; basin masks, boundary reflection, damping and impact
  response are available in the Render sidebar and persist with the project.
- Water height and finite-difference normals are sampled in the existing shader so
  disturbances affect surface shape, foam, reflections and refraction rather than
  appearing as an isolated overlay.
- Validation: frontend **597 passed (59 files)**; production Vite build green. Existing
  chunk-size warnings for Three.js and mediabunny remain advisory.

**2026-09-24 (later): PLC integration libraries bundled — snap7, asyncua, pycomm3 (1.2.5)**

- The PLC panel's "Required Libraries" block used to tell the operator to
  `pip install python-snap7 / asyncua / pycomm3`. All three now ship inside the
  PyInstaller engine (`requirements.txt`, `aquaflow-engine.spec` hidden imports +
  asyncua's address-space pickle). python-snap7 3.x is pure Python — no snap7.dll.
- `plc/plc_engine.py`:
  - **Siemens** `SiemensS7Driver`: snap7 is the preferred transport again and now
    honours `config.port` (NetToPLCsim), reads `DBB`, and writes by tag type/area
    (REAL→`set_real`, DWORD, BOOL as read-modify-write of the byte). Fixed a
    pre-existing bug where every snap7 bit read (`DB1.DBX8.3`) raised IndexError.
  - **OPC UA** `OPCUADriver` → **REAL**: typed reads (bool stays bool, numerics
    scaled), writes typed from the node's own DataType (Boolean/IntN/Float/Double/
    String) instead of always Double; the IP field may hold a full `opc.tcp://…/path`.
  - **Allen-Bradley** `AllenBradleyDriver` → **REAL** (new): pycomm3 LogixDriver,
    address = Logix tag name, path `ip[:port][/slot]`, one tag per request behind a
    lock in the executor, controller tag list when served else the operator's
    declared type injected as pycomm3's definition (BOOL/INT/DINT/REAL).
  - `PLC_SUPPORT`: opc_ua and allen_bradley REAL; `_create_driver` routes them.
- Discovery: an identified Logix (ListIdentity) is now configurable ("Configure PLC →",
  prefill allen_bradley/44818/slot 0); catalog entries gained default_config/configure_in.
  `/api/plc/types`, the frontend type list and the bundled-libraries block updated.
- Evidence (honest): snap7 path vs `FakeS7Server` (INT/REAL/BOOL round trip); OPC UA vs
  an in-process asyncua Server (Double/Boolean/Int32/Float typed writes); Allen-Bradley
  vs the **cpppo** Logix simulator (connect, identity, typed reads) — the simulator
  rejects pycomm3's connected Write Tag, so **AB writes are unit-tested with a stub only**.
  No physical Logix, OPC UA server or S7-1200 has been driven. `docs/PLC_LIBRARIES.md`.
- Validation: frontend **532 passed (43 files)**; backend **905 passed, 50 skipped, 0 failed**; web build
  green (zero circular chunks); engine rebuilt (py -3.12) with the three libraries;
  installer **AquaFlowSetup-1.2.5.exe**; release folder
  `release/AquaFlow-1.2.5-PLC-Libraries/`. Installed on this PC via silent NSIS upgrade: version 1.2.5.0, engine boots, `/api/plc/types` lists siemens_s7, modbus_tcp, opc_ua, allen_bradley as usable. Packaged-engine smoke: snap7 → FakeS7Server (read 4321, write 777 read back), asyncua → OPC UA server (read 12.5, write 31.5 read back), pycomm3 → cpppo Logix sim (connect + reads; write refused by the simulator as documented).

**2026-09-24: First PLCSIM contact — S7 identity read fixed, diagnostics surfaced (1.2.4)**

- The operator ran the generated TIA project in PLCSIM successfully. Device Discovery →
  Controllers → DETECT found the endpoint and confirmed S7comm, but showed no CPU identity.
  Root-caused in `engine/s7_identify.py` (verified against snap7's client):
  1. **Multi-part SZL replies were rejected.** A CPU whose list does not fit one PDU answers
     with "last data unit = 1" and a sequence number; the client must send the SZL-NEXT
     telegram (12-byte param, `0a 00 00 00` data) until the flag clears. A real S7-1200
     negotiates PDU 240 and ALWAYS splits its 0x001C component list. We read only the first
     part and refused it as "record length × count != bytes". Continuation is now
     implemented (bounded at 16 parts) and pinned by test.
  2. **Firmware version decoded from the wrong bytes.** Index 7 carries Ausbg1 = 'V'<<8|major,
     Ausbe = minor<<8|patch; the parser printed "V86.4.2" for V4.5.2. Fixed; `FakeS7Server`
     now encodes the wire format so the tests cannot mask it again.
  3. **The reason was invisible.** SZL failures were logged as a bare warning with no bytes.
     Every SZL reply frame is now kept (`szl_frames`), the warning carries the reason plus
     a hex excerpt, and discovery adds a plain-language note that identity is optional:
     Verify checks the AquaFlow DB contract directly. Siemens site → Identify CPU reports
     stage, PDU and reasons instead of only "identity unavailable".
- Discovery now lists a host that speaks ISO-on-TCP on 102 but refuses S7 setup as
  "not an S7 CPU (setup refused)" with the NetToPLCsim / PLCSIM Advanced hint (a TIA
  Portal PC's S7ONLINE service is the usual cause). Junk/silence on 102 stays unlisted.
- Docs: `SIEMENS-RUNTIME-COMMISSIONING.md` §6a — simulator reachability table (standard
  S7-PLCSIM is unreachable without NetToPLCsim; PLCSIM Advanced is S7-1500 only), what each
  discovery label means, and `Test-NetConnection <ip> -Port 102` as the first check.
- Validation: backend **897 passed, 50 skipped**; frontend **531 passed (43 files)**; web
  build green with zero circular-chunk warnings; PyInstaller engine rebuilt (py -3.12);
  installer **AquaFlowSetup-1.2.4.exe** built. End-to-end through the packaged engine
  against a fake PLC serving SZL in 60-byte parts: `identity_confirmed`, 0x0011 in 2 parts,
  0x001C in 4 parts, order number and `V4.5.2` decoded, zero warnings.
- Release folder: `release/AquaFlow-1.2.4-Siemens-PLCSIM-Identity/` (installer, SHA256SUMS,
  INSTALL-README, Siemens docs, PLCSIM test guide PDF).
- Still unverified: PLCSIM and physical S7-1200 rows stay UNVERIFIED until the operator
  re-runs DETECT with 1.2.4 and reports the warning text; identity may legitimately be
  absent on a simulator, in which case Verify is the path forward.

**2026-09-17 → 09-24 (catch-up, previously undocumented here):** AutoCAD DXF/DWG design
exchange (`AUTOCAD-DESIGN-EXCHANGE.md`, `desktop/cad-native.js`, `CADImportDialog`);
Siemens investigation (TIA Openness bridge — never compiled; independent-programming
feasibility audit — not viable without Siemens tooling; SIMATIC AX gate plan; TIA project
file dossier); pivot to **TIA Portal engineers once, AquaFlow operates the runtime**
(`SIEMENS-RUNTIME-AUDIT/ARCHITECTURE/COMMISSIONING.md`, contract v2 in
`engine/siemens_contract.py`, `siemens_runtime.py`, `SiemensSitePanel`); Electron
will-download handler fixing every export button; releases 1.2.3 and 1.2.3-fixed.

**2026-09-16: Unified AI/music block authoring in Show Programmer**

- Replaced the unconnected Show Programmer AI tab with an offline supported-style
  prompt/music builder using existing read-only choreography APIs. Generate a proposal,
  preview it in local 3D, then explicitly append prompt blocks or replace the timeline
  with a music dance. Applying participates in undo/redo; no automatic save or run.
- WAV analysis uses the configured local backend URL, real analysis jobs and measured
  beat objects. Metadata-only estimates are rejected for music choreography. Duration
  selects an excerpt from the start of the track at timeline 0. Valve changes, OFF
  gaps, phrase lead-ins and terminal OFF remain, with a minimum 100-ms physical state.
  Sustained ON runs coalesce within editable phrases. Beats use measured timestamps.
- Proposal/settings/music survive in-session 3D navigation. File changes invalidate
  analysis/proposal, engineering mapping/track changes require regeneration, and
  pending request cancellation cannot apply late results to the timeline. Music
  decoding now handles errors/stale selection and releases audio objects/contexts.
  The local timeline uses detected tempo and labels source music vs water-dance length.
- JSON/local saves retain clip blocks, beat markers and source provenance. WAV files
  require separate transfer/reselection. Generated phrases have explicit clips rather
  than array recipes; individual editing/duplication works, and movement regeneration
  uses the existing Arrays editor. Libraries and layering use the same block format.
- Validation: **506 frontend tests passed (41 files)**; production desktop web build
  passed. Native desktop checks cover prompt append/undo, measured PCM WAV analysis,
  music replacement, proposal and applied-show 3D round trips, beat retention and
  terminal OFF. Additional native checks reject a late response after cancellation,
  round-trip the one-minute music-6 example through JSON import/export, show its
  detected BPM and verify OFF at 59.95 seconds. Observed zero hardware requests,
  global playback frames or renderer exceptions; original saved show and reusable
  section library preserved and restored in the current session.
- Added `C:/Users/buroo/Downloads/4KILO-60-second-AI-music-6.json` using the site's
  existing measured music-6 analysis: seven blocks/788 clips, 194 beat markers and
  51 exact states over 60 seconds. Existing backend normalization accepts it; groups
  2, 17 and 25 remain empty and the final state is all OFF. No physical outputs ran.
- Installed web backup:
  `C:/Users/buroo/AppData/Local/Temp/aquaflow-web-before-ai-blocks-20260916-085652`.
  All 47 installed web files match the build; all six protected I-CAN control file
  hashes match the pre-change values. Gateway/runner remain idle and disarmed with
  zero streamed frames and an empty audit.
  Remaining work includes calibrated 3D/hydraulic response, additional physical
  commissioning and site rehearsal. This phase does not add unrestricted AI reasoning
  or independent pump/frequency choreography; protected Fountain Control is preserved.

**2026-09-16: Layered reusable show sections**

- Added Show Sections and block-selection checkboxes. Sequence selected blocks with
  a gap, align their starts for simultaneous zone patterns, or move the selection
  while preserving internal offsets. Each operation participates in undo/redo.
- Save selected combinations to a persistent named library, export/import individual
  sections or the library, and insert repeated sections with independent editable
  blocks. Relative timings, OFF intervals, recipes and individual clip edits remain.
  Insertion verifies outlet identities and matching tracks in the current engineering
  project. Missing outlets are rejected rather than remapped. Existing saved section
  names are not automatically overwritten; invalid imports preserve stored data.
- Fixed generated block clip identity collisions when a plan is reused rapidly.
  New blocks receive independent IDs, and copying large sections avoids counting
  temporary template clips against the destination show's 20,000-clip limit.
- Validation: **497 frontend tests passed (40 files)**; desktop production web build
  passed. Desktop checks cover checkbox selection, sequence/layer/move, persistent
  library save/remount, repeated insertion, undo/redo, 3D preview/Stop, draft settings,
  site handoff and section export/import. Network monitoring observed 45 requests in
  the main workflow and 30 in the examples/import workflow, with zero hardware
  requests, global playback frames or renderer exceptions. Gateway idle/disarmed,
  zero streamed frames and empty audit; original I-CAN control hashes unchanged.
- Added two section-library examples: **4KILO 60-second three-block section** and
  **4KILO 20-second valve duet**. Preserved the operator's existing local show.
  Download exports: `C:/Users/buroo/Downloads/4KILO-show-section-library.json` and
  `C:/Users/buroo/Downloads/4KILO-60-second-layered-valve-duet.json`. The latter has
  six blocks/1,920 clips and converts to 240 exact states over 60 seconds, accepted
  by the existing backend normalizer. Support defaults OFF; protected frequency/fire
  groups and final state remain OFF. No physical outputs activated.
- Installed web backup:
  `C:/Users/buroo/AppData/Local/Temp/aquaflow-web-before-show-sections-20260916-083131`.
  All 47 installed web files match the build. Final desktop checks verify keyboard
  undo/redo retains the block selection, both library examples survive reload, and
  the original saved show/library data stays unchanged during verification.
  Remaining phases: unified AI/music block authoring, calibrated 3D response and
  remaining physical commissioning/rehearsals. Section libraries are local exports;
  they do not bundle WAV files or automatically adapt to a different fountain.

**2026-09-16: Whole pattern-block editing in Show Programmer**

- Generated arrays now appear as named pattern blocks containing their outlet clips.
  Move, proportionally stretch, rename, change array cycles, duplicate, delete or
  regenerate the selected block's movement/outlet selection. Detailed clips remain
  available for individual changes; these changes disable cycle regeneration so
  it cannot silently replace them. Duplication preserves individual edits.
- Blocks, recipes and programmed trailing OFF intervals persist within the existing
  local/backend save and JSON import/export format. Existing exported arrays group
  by generation stamp without altering their timing. Partial target replacement
  preserves remaining clips and marks their block as individually edited.
- Added Fit show, adaptive ruler/measure labels and collapsible 3D/site controls
  to keep block timing controls accessible. In-session preview navigation preserves
  unsaved edits even when a different local show was previously saved.
- Validation: frontend **484 passed (39 files)**, desktop production web build
  passed. Installed-desktop checks cover native pointer move/resize, cycles,
  duplication, undo/redo, selected-block regeneration, detailed view, JSON round
  trip, exact 3D preview and site handoff. Zero hardware requests, global playback
  frames or renderer exceptions. The original I-CAN control file hashes match.
- Installed all 47 generated web files and verified matching hashes. Backup:
  `C:/Users/buroo/AppData/Local/Temp/aquaflow-web-before-pattern-blocks-20260916-080159`.
  Saved a new 60-second, three-block example locally because no operator local show
  existed: Traveling blocks (0-20s), Mirrored blocks (20-40s), Return blocks (40-60s).
  It contains 1,280 outlet clips and converts to 240 exact valve states, accepted
  by the existing backend normalizer. Support defaults OFF; groups 2 and 25 remain
  empty and the final state is all OFF. No physical outputs activated.
- Remaining boss-request phases include reusable layered show sections, a unified
  AI/music block workflow, calibrated 3D response and remaining site commissioning.

**2026-09-16: Visual Show Programmer arrays and Site I-CAN handoff**

- Added clickable engineering-plan outlet selection, keyboard selection, odd/even,
  half-array and invert tools, named persistent zones, array ordering and a stage
  scrubber with physical outlet names. The library now includes 16 movements,
  including mirrored blocks, traveling windows and fill/drain. Custom stages
  preserve OFF intervals and report invalid selectors. Reusable presets include
  selection and mode; generated arrays are limited to 20,000 clips per action.
- Site water tracks now distinguish mapped Valve ON/OFF from uncommissioned design
  intensity, and separate physical pump equipment. A compact toolbar with expandable
  additional tools and the program's own timeline keeps the array editor visible.
  Preview navigation preserves
  timeline, local WAV, builder settings and site conversion options in-session.
- Added all-outlet local design simulation and exact mapped-valve timeline
  conversion to the existing Site I-CAN editor. Unsupported or unresolved tracks,
  fades/analogue values, effects and incompatible timing block real-run conversion.
  Overlapping ON clips combine, gaps stay OFF, trailing programmed OFF stages remain,
  and every converted pattern ends OFF. Captured support is optional, defaults OFF
  and stays steady through valve gaps; no independent pump/frequency commands added.
- Validation: frontend **472 passed (38 files)**; desktop production web build
  passed. Existing backend normalization accepts the 60-second, 240-state,
  960-clip demo. Installed-desktop UI checks passed for keyboard/visual selection,
  saved zones/presets, settings and timeline preservation, both 3D preview modes,
  editor handoff and blocked unresolved foam conversion, with zero hardware requests,
  global playback WebSocket frames or renderer exceptions.
  Protected transport, mapping, routes and Fountain Control panel
  hashes still match their pre-task values. No physical outputs activated.
- Updated installed desktop web assets with a backup at
  `C:/Users/buroo/AppData/Local/Temp/aquaflow-web-before-array-tools-20260916-042244`.
  Step-by-step instructions and 60-second settings are in
  `SITE-ICAN-DESIGN-TEST-GUIDE.md`.

**2026-09-16: Site I-CAN pattern simulation**

- Added **PREVIEW THIS PATTERN IN 3D** to the site step editor. A separate local playback
  clock supports play, pause, replay, seek, repeat, stop and selected-WAV playback.
- Preview animates the 64 capture-mapped running valves by engineering fixture ID and
  explicit address metadata. Corrected positions and basin geometry remain unchanged.
  Unmapped outlets remain off; water heights and pump/frequency behavior are not calibrated.
- Saved/manual/AI/music/imported patterns use the same preview path. Drafts survive editor
  and preview navigation. Main toolbar and ruler seeking stay local while simulation is active.
- Renderer OFF states suppress decorative idle water. Engineering layout sync now recognizes
  a recreated renderer when quality changes.
- Proven I-CAN control transport, mapping, backend routes and Fountain Control panel were
  left unchanged during this task. No physical outputs were activated.
- Validation: frontend suite **457 passed (37 files)**; focused mapping, timing, isolation
  and renderer tests passed; desktop production web build passed. Installed-desktop UI
  check passed for play/pause/seek/replay/stop, main toolbar, draft preservation, and CPU
  render quality changes, with zero renderer exceptions, hardware requests, or global
  playback WebSocket frames. Control-file hashes match their pre-task values; gateway
  remains idle/disarmed with zero streamed frames and zero audit actions.


> **AUTHORITATIVE (2026-09-08, manual I-CAN patterns):** backend pytest
> **831 passed, 21 skipped**; frontend vitest **440 passed (34 files)**;
> `npm run build` green; desktop **1.2.1**. Single source of truth:
> `AQUAFLOW_STATUS_CANONICAL.md`. Test/task numbers in the dated entries below are
> point-in-time snapshots; the line above is current.

**Date:** 2026-09-08 (operator-authored manual patterns for the site fountain)
**Summary:** Fountain Control now includes a persistent, server-timed manual pattern
editor for the proven I-CAN output path. It records the photographed physical layout as
9 front outputs on one pump, two rear high sides on one pump, and 64 middle nozzles on
four pumps. Patterns can be built, saved, repeated, started, monitored and stopped.

- **Pattern controls:** an operator can create absolute-state steps, set each duration,
  select any channel 1-40 in captured groups 1, 2, 9, 17 and 25, copy/off/remove steps,
  repeat a pattern and save it as this site's hardware-profile pattern data.
- **Photo/capture presets:** the exact opening state from the hardware-proven capture is
  marked proven. Groups 1 and 9 each expose 32 channels and are offered as four
  provisional 16-nozzle middle banks. Group 2 channels 1-8 are provisional front
  candidates; group 25 channels 33-34 are provisional rear-high candidates.
- **Cabinet evidence:** the blue I-CAN NETCAN converter feeds the black Music Fountain
  Control System, which drives rows of JGX4080 solid-state relays and separate CHINT
  multi-pole power circuits. The labels still do not reveal the I-CAN address translation.
- **Unknown wiring stays explicit:** the ninth front address, all six pump addresses,
  pump start/stop order and group 17 functions remain unassigned. The editor labels all
  inferred physical presets provisional; photographs cannot reveal electrical addresses.
  Until commissioning, group 17 is restricted to all-off or its exact captured support
  state so it cannot be arbitrarily rapid-pulsed as a possible pump/contactor circuit.
- **Output safeguards:** every step is normalized to a complete state for all five site
  groups. Playback clears all five before step 1 and blackouts on completion, Stop,
  safety loss, disarm, disconnect, shutdown or error. Individual channel controls are
  rejected while automated playback runs. Hardware Run requires connection, safety
  permit, output arm and the separate phrase `RUN MANUAL PATTERN`.
- **Commissioning boundary:** no inferred manual pattern was actuated during development.
  The proven one-minute demo remains available. Physical one-channel-at-a-time
  commissioning is still required before treating the front/rear/middle presets as the
  final hardware map or adding pump sequencing.

**Date:** 2026-09-08 (I-CAN hardware-proven one-minute site demo)
**Summary:** Fountain Control can now start and stop a server-side one-minute replay of
the real fountain choreography. The embedded 2,503-event segment is byte-derived from
the site `changes.txt` capture and spans groups 1, 2, 9, 17 and 25. Its source and event
hashes are asserted by test.

- **Operator controls:** `START 1-MINUTE DEMO`, live countdown/progress and `STOP DEMO`
  are in Fountain Control. The demo needs a connected gateway, safety permit and the
  existing typed `ARM OUTPUT` gate; channel mapping/attachment is not required.
- **Backend authority:** playback timing stays in the backend if the panel is closed.
  Start/status/stop APIs expose progress, outcome, frames sent and the last event.
- **Stop contract:** normal completion, manual stop, safety-permit loss, disarm,
  disconnect, application shutdown and playback errors all issue per-group all-off.
- **Hardware evidence:** the source capture was shortened and replayed from this PC on
  2026-09-08; the physical fountain ran correctly. The one-minute embedded segment
  begins at capture time 17.45 s and contains the same proven choreography. Packaged
  AquaFlow 1.1.9 then completed all 2,503 events through the verified site gateway and
  the manual Stop path interrupted a second run after five seconds before blackout.

**Date:** 2026-09-07 (AF-DISC — evidence-based PLC/controller discovery, read-only)
**Summary:** Device Discovery → Controllers now identifies real hardware by protocol
exchange, on a selected adapter/subnet, as a cancellable job with progress — and never
claims more than the evidence supports. The Fountain Control I-CAN implementation
(`ican_reference_client.py`, `ican_connection.py`, `ican_routes.py`,
`FountainControlPanel.jsx`, the `ican-music-fountain` catalog profile) is **unchanged**.

- **I-CAN aggregation bug fixed.** `controller_identify.py` listed every probe candidate
  (it checked a `protocol_valid` field that never existed) — 253 timeouts became 253
  "probable" DRIVABLE gateways. Now only `accepted == true` candidates are controllers;
  timeouts/junk stay in diagnostics; duplicates collapse. Regression tests:
  253 timeouts + 1 valid reply → exactly one; all timeouts → zero.
- **I-CAN discovery socket coordination** (`engine/ican_discovery.py`, discovery-only):
  ONE shared UDP socket per run instead of 16 SO_REUSEADDR sockets on 2002 (which could
  steal the control client's datagrams); a busy 2002 is reported, never squatted; an
  active Fountain Control connection is detected via its read-only status and the scan
  does not bind or send at all. Probe bytes (`03 00 00 00 01 …`) and the 0x07 validation
  rule are untouched; opcode 0x08 is not referenced by any discovery module (tokenised
  source check in `test_ican_discovery_readonly.py`).
- **Adapters + subnet selection** (`engine/net_adapters.py`): real IPv4 adapters with
  real masks (ipconfig / ip / ifconfig parsing, no psutil), kind classification
  (physical/virtual/vpn/loopback/link-local), explicit adapter or CIDR (scans ONLY that
  range), ranges > /22 refused, bounded concurrency + time budget, cancel + progress via
  `/api/controllers/discover/start|jobs/{id}|cancel`.
- **Siemens**: `engine/s7_identify.py` strict COTP/S7 setup validation (every field), SZL
  0x0011/0x001C identity (order number, module, firmware) — a bare handshake never claims
  a CPU model; rack/slot profiles 0/1 then 0/2. `engine/profinet_dcp.py` sends one
  read-only DCP Identify-All on Windows through an operator-installed Npcap runtime,
  bound to the selected adapter. It finds devices with no IP or a foreign IP; without
  Npcap it fails closed with an installation hint. A Siemens DCP identity alone stays
  identify-only because it may be remote I/O; only a validated S7comm handshake promotes
  it to a configurable S7 PLC. Stages: tcp_open → cotp_connected → s7_confirmed →
  identity_confirmed.
- **Modbus**: FC43/14 fully validated (MEI echo, conformity, more-follows +
  continuation, object lengths, trailing bytes) via
  `ModbusTCPClient.read_device_identification_full`; configurable unit-id list (default 1);
  a well-formed exception = generic Modbus, vendor NOT identified.
- **EtherNet/IP**: `engine/enip_identify.py` strict ListIdentity (encap status, lengths,
  item count/type/bounds, name bounds); Allen-Bradley remains identify-only; an open 44818
  with junk behind it is not a PLC.
- **S7 profile conflict fixed**: versioned `plc/s7_profiles.py` `aquaflow-s7-1215c-v1`
  matching `docs/S7_DB_CONTRACT.md` (asserted by test against the doc table); the old
  Siemens default tags (pump speed at DB1.DBW0 = HEARTBEAT) are gone; a profile must be
  selected AND confirmed (`profile_id` + `confirm_profile`) — never assigned silently.
- **Read-only verification** (`engine/plc_verify.py`, `POST /api/plc/verify`,
  `/verify-modbus`): reads only declared input fields, classifies unreachable /
  wrong rack-slot / not-S7 / access denied / missing DB / optimized-or-short DB /
  timeout / malformed separately, and calls the PLC verified ONLY when HEARTBEAT changes
  across samples. Modbus reads only operator-listed points. Zero writes (asserted).
- **UI**: Controllers tab shows adapter/subnet, progress + cancel, evidence, stage,
  confidence, warnings; "Configure PLC →" pre-fills the PLC panel (IP/port/rack/slot/
  unit id/vendor/model) without connecting; I-CAN rows show the validated reply and link
  to Fountain Control (navigation only). Network Scan adds hosts as **unverified** with
  no health value. Non-2xx responses surface as text.
- Also fixed in passing: `S7Client.read_bit` checked reply length before the return code,
  so a real ACCESS_DENIED on a BOOL read as a frame error and marked the link down.

**Physical commissioning still required:** DCP on the plant Ethernet, S7 SZL on the real
1215C, the I-CAN gateway on 192.168.5.2 and Modbus units have only been exercised
against the fake servers (`fake_s7_server.py`, `ScriptedModbusServer`,
`FakeICANGateway`, constructed ENIP/DCP frames).

---

**Date:** 2026-09-07 (AF-3D R3 + HUD — refraction, ripples, and the striped water solved)
**Summary:** Phase R3 of the realism plan, plus the performance HUD, plus three real
bugs found along the way.

- **AF-3D-013 performance HUD.** The tiers are a frame-budget trade and the budget
  was invisible — including to the user I had asked for a frame rate. `getPerfStats()`
  reports FPS (averaged over a second), worst frame, particles by backend, draw calls,
  triangles and which features the tier enabled; a toggleable HUD sits top-right of
  the preview. Fixed the counter too: three.js clears `renderer.info` on every
  `render()` and a frame runs several passes, so it first reported only the last pass
  (one draw). `autoReset` off with one reset per frame gives honest totals
  (medium 343 draws / 814k tris, high 528, low 199).
- **AF-3D-009 refraction.** The basin is a known flat plane, so the refracted view ray
  is intersected with it analytically and the lining sampled directly — no second
  scene pass, and the wobble is the physically right shape rather than a scrolling
  normal-map trick. Beer-Lambert extinction along the true path length (red stripped
  ~8x faster than blue) is why depth now reads blue-green instead of merely darker.
- **AF-3D-010 caustics + impact ripples.** Caustics moved to where they physically
  belong — focused on the floor, sampled through the refracted ray — instead of being
  painted on the surface. Ripple rings are seeded from the SAME impact events the
  splash map records, rate-limited to ~9/s (a ring per droplet would boil the surface
  rather than read as rings) into an 8-slot buffer, with the slope differentiated
  analytically so the normal stays exact.

**Three bugs fixed, all pre-existing:**
1. **The striped water — root cause found.** Wall maps were cloned at repeat
   `16 x 0.4`. A rectangular pool's "wall" is a solid Box whose top face sits at
   y=0.445, ABOVE the water at y=0.02, and box-face UVs are 0..1 regardless of size —
   so that anisotropic tiling smeared into parallel bands across the pool interior.
   It survived every earlier attempt to blame the water, the basin floor, shadows or
   post-processing because it was none of them. Wall tiling is now per shape and
   near-isotropic (cylinder 18x1, box 5x5).
2. **Gerstner waves were one-dimensional.** A PlaneGeometry's local position lies in
   XY with z identically zero, so `position.xz` fed every wave `(x, 0)` and each
   reduced to `dir.x * x` — varying along X, constant along Z. Now driven by world XZ.
3. **The water normal was in the wrong space.** It was pushed through `normalMatrix`
   (object -> VIEW space) then dotted against world-space view and light vectors,
   quietly corrupting every fresnel, specular and refraction term. Now world-space.

Circular pools also gain a real water surface: they were drawn with `CircleGeometry`,
a fan with vertices only on its rim and no interior to displace, so waves and ripples
were invisible on them by construction. Both shapes now use a tessellated plane, cut
to a circle in the fragment stage.

Frontend **418 passed (33 files)**, build green, verified live on both pool shapes
with zero GL errors.

**Date:** 2026-09-07 (AF-3D R2 — GPU particle simulation, ~200k droplets)
**Summary:** Phase R2 of the realism plan. Particle state moved into floating-point
textures and is advanced by shaders, lifting the count from the CPU field's ~82k
ceiling to **131k water + 66k spray on `medium`** and 262k + 131k on `high`.

- `particlesGPU.js` (AF-3D-007) — ping-ponged RGBA32F state (posLife / velLife),
  a static per-particle meta texture (emitter index + seed), and a 6-row emitter
  parameter texture re-uploaded each frame (~5 KB). Two passes advance it, one
  writing velocity and one position; both recompute the FULL step from the same
  previous state through a shared `simulate()`, so they cannot disagree about a
  death, respawn or bounce. MRT would save the duplicated arithmetic but costs a
  GLSL3 path — a second fullscreen pass over a 363-square texture is far cheaper.
  No append: the pool is fixed, each particle belongs permanently to one emitter,
  and dead particles respawn gated by that emitter's `density`, so live density
  tracks show intensity while the allocation stays stable.
- `nozzleEmitters.js` (AF-3D-006) — the insight that made this tractable: the
  seventeen tuned nozzle behaviours are only FIVE emission primitives (CONE, RING,
  FAN, CASCADE, MIST) with different parameters. Per-type knowledge stays in plain,
  unit-tested JavaScript instead of being re-encoded — and almost certainly
  regressed — in GLSL. Solved hydraulic launch speed, wind and animated aiming all
  stay on the CPU. 18 new tests; one caught a real bug pre-merge (`fan_jet` passed
  `dy: 0`, and the shader reads `dir.y` as fan compression — the sweep would have
  collapsed to a vertical line).
- Droplet opacity and size dropped hard (alpha 0.9 -> 0.17, size 0.55 -> 0.30):
  optical depth is count x alpha x area, and at the old values an order of
  magnitude more droplets integrated to solid white and lost the jet's shape.
- **The splash/containment analysis is preserved.** It converts impacts into
  calibrated litres/minute of spill — commissioning output, not decoration. Rather
  than drop it, the CPU field keeps running as an INVISIBLE statistical sample at
  1/16 (`CPU_SAMPLE_FRACTION`), sampled inside `spawn()` so it stays unbiased across
  nozzles. Calibration divides solved flow by the spawn rate it actually measures,
  so thinning the sample changes the per-impact volume and leaves reported litres
  unchanged. Verified live: 39% outside, wetness field active.
- `low` tier is untouched and keeps the CPU path; the GPU path also self-disables
  without WebGL2 + `EXT_color_buffer_float`.

Verified in the running app: backend reports WebGL2 + float RTs, 131406/65536
particles live, 19 water + 23 spray emitters, zero GL errors. Frontend **418 passed
(33 files)**, build green. Remaining from R2: AF-3D-008 (half-res particle pass).

**Date:** 2026-09-07 (AF-3D-012 — stone/tile PBR surfaces, and the vertical pool rim)
**Summary:** Pulled `AF-3D-012` forward from Phase R4 after on-hardware review: with
R1's lighting in place the untextured ground was the loudest remaining CGI cue.
New `groundTextures.js` generates complete PBR sets (albedo + normal + roughness,
all derived from one seeded height field so they agree by construction) into
canvases at startup — no binary assets, deterministic, analytic fallback when
headless. Applied to deck and pool wall (dark granite pavers), coping (polished
stone — its 0.7 metalness had to drop to 0.22 or a real albedo read as smoked
mirror), basin floor (mosaic tiles, coarsened to 12/edge at repeat 2 because a
fine mosaic seen through the animated surface is sub-pixel and moirés), and the
venue stage. Clones share canvases, so the wall reuses the deck stone at wall
scale for three texture objects rather than a regeneration.

Also fixed a **pre-existing bug** the user's circular-pool screenshot exposed:
`_buildPool` built the circular coping as a `TorusGeometry` without rotating it.
Three.js generates a torus standing in the XY plane, so the pool rim was installed
VERTICALLY — a large translucent archway hooping over the water, its lower half
buried under the deck. Only circular pools build a torus coping (rectangular ones
use box copings), which is why it had never surfaced. Diagnosed by bisection with
a new dev-only `window.__aquaflowScene` handle: with particles, glows, cones and
core columns all hidden the arch survived, proving solid geometry.

Frontend **400 passed (32 files)**, build green. Verified on the user's GPU at
60 fps. Next: AF-3D-006/007 (GPU particle sim, 500k particles) per the plan.

**Date:** 2026-09-05 (AF-3D R1 — the Depence night look: soft particles, billboard droplets, sky, beam cones)
**Summary:** First phase of the 3D-preview realism programme (`AF-3D-REALISM-PLAN.md`,
new at repo root — the full Depence-benchmarked 5-phase plan). Phase R1 lands the
five "night look" upgrades in four new modules plus integration, keeping
`FountainScene_v6.js` as orchestrator:

- **AF-3D-001 soft particles** — `sceneDepth.js` renders an opaque-scene depth
  probe (half-res, override material, shadow-frozen — WaterReflectionProbe
  pattern); particle and cone fragments fade as they approach scene depth, killing
  the hard sprite cuts at the pool rim. Disabled during reflection/quad/VR passes
  where gl_FragCoord no longer maps to the probe.
- **AF-3D-002 billboard droplets** — `particlesBillboard.js` replaces gl_Points
  with instanced camera-facing quads, velocity-aligned and speed-stretched (width
  narrows to conserve volume); no driver point-size clamp. Simulation untouched.
  Plus a sub-frame spawn advance in `GPUParticleSystem.spawn` — a fast jet no
  longer renders as a chain of pearls one frame-step apart.
- **AF-3D-003 sprite textures** — `particleTextures.js` draws droplet/mist/foam/
  flame sprites into canvases at startup (deterministic, no assets to ship);
  headless/jsdom gets the analytic fallback automatically.
- **AF-3D-004 sky dome + starfield + matched IBL** — `skyDome.js`: per-environment
  gradient dome (night/dusk/day/arena) with a twinkling 1100-star field at night
  (`sceneModes.js`'s `starfield: true` finally consumed), and the *same dome*
  PMREM-filtered as the environment map, replacing the bright RoomEnvironment
  studio probe that fought the night mood (kept only as fallback).
- **AF-3D-005 volumetric beam cones** — `lightCones.js`: analytic light shafts for
  up to 16 RGB fixtures (optical-depth shading, axial falloff, scrolling haze,
  soft-depth fade), intensity scaled by live spray activity so light and water
  cues visibly interact; synthesized at the default underwater ring when no
  engineering lights are placed.

Quality gating: new `softDepth/softScale/cones/stars` flags in `QUALITY_CONFIG`;
`low` unchanged by design. Verified end-to-end in the running app (vite dev +
backend on :8010, headless Chrome via playwright-core): night/dusk screenshots,
zero shader/GL console errors. Frontend **400 passed (32 files)**, build green.
Next: AF-3D-006/007 (GPU particle sim, 500k particles) per the plan.

**Date:** 2026-09-04 (AF-CAT-001 — plug in the cable and AquaFlow tells you what's there)
**Summary:** The controller catalog + auto-detection. `engine/controller_catalog.py`
ships 18 entries covering the fountain-control ecosystem (researched 2026-09:
Siemens/AB PLC plants, the OASE/Safe-Rain DMX show layer, the Chinese
music-fountain controller class, ADAM/Moxa remote I/O, fountain VFDs) — each with
vendor/model, category, detection method, config prefill, and an **honest
drivability tier** that a test asserts equal to the runtime support matrices: the
catalog can never advertise a driver the runtime lacks. Detectable ≠ drivable, and
the UI shows the difference (DRIVABLE / GATED / IDENTIFY-ONLY badges).

The reverse-engineered I-CAN site profile is now a first-class catalog entry, not
commit-message folklore: gateway 192.168.5.2:200, mandatory local port 2002,
group 0, channels 1-32, 10 Hz refresh — with the capture-derived protocol facts
(fire-and-forget, BE-uint32 group, stream-don't-silence, the SO_REUSEADDR trap)
preserved in its notes and pinned by test.

`engine/controller_identify.py` does the auto-detection, **read-only by
construction** (the AF-ICAN-005 lesson kept): subnet sweep of the catalog ports,
then protocol-level identification — a full COTP+S7 handshake for Siemens; Modbus
FC43/14 device identification (new, read-only, in modbus_client) with vendor-string
mapping to specific entries, and a well-formed ILLEGAL_FUNCTION counting as
confirmed *generic* Modbus; EtherNet/IP ListIdentity naming AB gear it cannot
drive; the existing safe I-CAN probe folded in. Port-only matches report
"port match only", never confirmation. New `/api/controllers/{catalog,discover}`
routes and a Controllers tab in the Device Discovery panel (detect + browsable
catalog with config templates).

12 backend + 2 frontend tests. Backend **685 passed / 21 skipped / 0 failures
(706)**; frontend **396 passed (31 files)**. Next up when authorised: AF-S7OUT
(the S7 channel-mask output path to replace/parallel NETCAN).

---

**Date:** 2026-09-03 (AF-IO-009 — the write path, and the one command that is never refused)
**Summary:** The final AF-IO package. `engine/vfd_command.py` — `VFDCommander`, the
one writer to the PLC command area (`DB1.DBW12` speed reference 0..27648 +
`DB1.DBX14.0` enable, per the contract). The gate in one sentence: **a speed
command needs the safety kernel's permit AND pump_enable at call time; a STOP
needs nothing.** No kernel, no permit, half-declared config, kernel unreadable —
`stop()` still zeroes the reference and clears the enable bit, because refusing to
stop is exactly backwards. The lifespan also hooks the kernel's state changes:
FAULT or EMERGENCY_STOP drives an automatic VFD stop. Command points are ordinary
FieldPoints with reserved ids (`cmd_pump_speed`/`cmd_enable`, added to the DB
contract), so one JSON file describes the whole rack, and both transports write
correctly (S7 DB address / Modbus FC06+FC05 — pinned by test, including "a refused
command leaves ZERO frames on the wire"). Every command and refusal is audited;
`/api/field-io/vfd/{status,audit,speed,stop}` expose it. The 0-20 mA AO vs 0-10 V
ZONCEN reference caveat stays flagged in the contract for the electrician.

7 new tests. Backend **673 passed / 21 skipped / 0 failures (694)**; frontend
**394 passed**.

**AF-IO series complete — all nine packages (001-009) landed 2026-09-03.** AquaFlow
now has a real input side for the purchased S7-1215C rack: a validated Modbus
client, quality-tagged field points, a reader loop whose staleness needs no
observer, a safety kernel that withdraws the permit when a required sensor goes
blind, a corrected S7 driver with a published DB contract, an honest PLC matrix,
live Field I/O telemetry, and a safety-gated VFD write path — all proven against
the bench harness (fake S7 PLC + pymodbus cross-validation). **Not yet verified on
the physical rack**: the decisive step is the commissioning checklist at the end of
`docs/S7_DB_CONTRACT.md`, whose acceptance test is "pull a sensor plug → the
permit drops".

---

**Date:** 2026-09-03 (AF-IO-007 — day one on site is always "is this number real")
**Summary:** The input side becomes visible. A `field_io` websocket message rides
the existing telemetry loop's 2 s cadence (broadcast only when points are declared,
so a stock install sends nothing new), carrying `points_payload()` — every declared
point with `{value, quality, raw, age_s, required, binds_to}` — plus the manager
status. New `/api/field-io` routes: `GET status`/`points` for the panel, `POST
points` / `DELETE points/{id}` for the operator's inventory edits, persisting to
`data/field_points.json` and hot-reloading the poll loop; malformed definitions are
a 400 at the form.

The AF-ICAN-006 lesson carried over: both clients (`modbus_client`, `s7_client`) now
record the **last raw TX/RX frame as hex**, surfaced per source — "what did you
send" stays readable at the cabinet without a packet capture. `PLCPanel` gains a
**Field I/O** tab: per-point quality badge (only GOOD looks calm — STALE amber,
FAULT red, UNKNOWN purple; pinned by test), scaled value + unit, raw counts, age,
a `●req` marker on permit-gating points, the `binds_to` target, the per-source
frame hex, and the heartbeat verdict spelled out ("counter frozen — halted CPU?").
Null values render as "—", never as zero — the honesty rule reaches the pixels.

2 backend tests (payload + frame hex against the scripted server; route
upsert/reload/delete with a monkeypatched manager) and 3 frontend helper tests in
the FixtureLibraryBrowser pattern. Backend **666 passed / 21 skipped / 0 failures
(687)**; frontend **394 passed (30 files)**. Next: AF-IO-009 (VFD write-back), the
final package.

---

**Date:** 2026-09-03 (AF-IO-006 — the PLC subsystem stops advertising what it doesn't have)
**Summary:** AF-HUB-014 gave the protocol bus a four-tier honesty matrix; the PLC
subsystem never got the same treatment. `/api/plc/types` advertised Allen Bradley,
OPC UA, Mitsubishi, Delta, Omron and Beckhoff — and `_create_driver`'s fallback
handed a **Modbus TCP driver to anything it didn't recognise**, so "Beckhoff
TwinCAT" quietly opened Modbus to port 4840 and reported whatever came back.

Now `PLC_SUPPORT` classifies every `PLCType` member (nothing falls through to a
default — pinned by test): `siemens_s7` and `modbus_tcp` **REAL** (AF-IO-005/001
drivers), `opc_ua` **GATED** (driver code exists but asyncua is undeclared and it
is untested), `delta`/`mitsubishi`/`omron` **GATED** with the refusal message
pointing at the honest route — "if this unit speaks Modbus TCP, add it explicitly
as modbus_tcp" — and `allen_bradley`/`beckhoff` **UNSUPPORTED**. `_create_driver`
raises instead of substituting; `add_plc` refuses BEFORE storing anything (no
connection entry, no driver, no socket) and the route turns that into a 400.
`/api/plc/types` offers only the usable two and carries the full matrix;
`PLCPanel`'s type picker is trimmed to match.

6 new tests. Backend **664 passed / 21 skipped / 0 failures (685)**; frontend
**391 passed** (PLCPanel touched, suite re-run). Next: AF-IO-007 (field-I/O
telemetry + panel).

---

**Date:** 2026-09-03 (AF-IO-005 — an S7 client that addresses what it names)
**Summary:** The old raw S7comm path encoded the DB address as
`(offset>>5, (offset&0x1f)<<3)` — S7 addresses in BITS (`byte_offset*8 + bit`), so
the two encodings coincide ONLY at offset 0. Every read past `DB1.DBW0` silently
returned the wrong location, and offset 0 is exactly what everyone smoke-tests
with. The regression test reads DBW34, where the old math lands 18 bytes away.

New `engine/s7_client.py`, built to the modbus_client standard: exact TPKT-framed
reads, pdu_ref echo + header error-class + per-item return-code validation,
`S7ItemError` (device up, item refused — connection STAYS up) vs `S7FrameError`
(marks down), one request in flight, `ensure_connected()` backoff. Typed
DBX/DBB/DBW/DBD reads AND writes incl. INT/DINT/REAL, and the
`DB<n>.DB[XBWD]<offset>[.<bit>]` dialect used by field points — parser refuses
malformed addresses instead of stripping digits and hoping. All proven against
AF-IO-008's fake PLC, including the halted-CPU heartbeat via a FieldIOManager
poll of an `s7:` source (now a real transport, not UNKNOWN).

`SiemensS7Driver`: the raw fallback delegates to the client — and can finally
WRITE without snap7 (the old raw path returned False for every write, so BOOL
tags like `DB1.DBX2.0` were silently unwritable); the snap7 path's DBD read now
returns a REAL as a float instead of its raw dword bit pattern. snap7 stays the
preferred transport (optional in requirements, with the snap7.dll bundling note).

Deliverable for the site: **`docs/S7_DB_CONTRACT.md`** — the non-optimized DB1
layout (heartbeat counter word, E-stop/VFD/thermal bits, raw AI words, the
AF-IO-009 command area), the three settings that break everything (non-optimized
block, PUT/GET permit, counter-not-constant heartbeat), the 0-10 V vs 4-20 mA
honesty note, matching field-point JSON, and the TIA commissioning checklist whose
acceptance step is "pull a sensor plug → the permit drops".

11 new tests. Backend **658 passed / 21 skipped / 0 failures (679)**; frontend
untouched. Next: AF-IO-006 (honest PLC support matrix).

---

**Date:** 2026-09-03 (AF-IO-004 — the safety kernel gets eyes, and the bypass loses its cloak)
**Summary:** The package the whole series exists for. Until today every safety input
(`water_level_ok`, `pressure_ok`, `estop_chain_closed`, ...) defaulted `True` and
nothing ever wrote them — the interlocks guarded a board nobody was reading.
`_ingest_field_io()` now runs at the top of the kernel's 50 Hz tick, pulling from
FieldIOManager's sync accessors (dict lookups — the tick still never awaits):

- A **GOOD boolean reading drives the real interlock**: a bound E-stop DI reading
  `False` takes the kernel through its genuine `EMERGENCY_STOP` transition (pinned
  by test, not assumed).
- A **REQUIRED point that is not GOOD** — UNKNOWN, STALE, FAULT, or a dead required
  heartbeat — joins `blind_required`, raises the new `SENSOR_FAULT` (edge-detected,
  once, not at 50 Hz), and **withdraws the master permit** in `_build_outputs()`.
  Non-latched by design: the state machine is untouched and the permit returns BY
  ITSELF the moment the sensor reads GOOD again. Non-required points never touch
  the permit — they are listed `unmonitored` in the status so a green board can't
  be mistaken for a guarded one.
- **PLC liveness is the heartbeat counter CHANGING** (`heartbeat_alive()`), feeding
  the previously-faked `update_plc_heartbeat()` path with something real.
- `get_status()` now carries `safety_bypass` and a `field_io` block
  (monitored / unmonitored / blind_required / heartbeat_alive) — the dev bypass can
  no longer scrub faults invisibly.

Migration stays per-point: nothing attached or nothing `required` is bit-identical
to the old kernel (pinned by test). The end-to-end test runs the real FieldIOManager
against the scripted Modbus server: rack live → permit holds; rack goes dark →
nothing notices explicitly, aging demotes to STALE, next tick withdraws the permit —
`blind_required: ["pressure(STALE)"]`. 9 new tests. Backend **647 passed / 21
skipped / 0 failures (668)**; frontend untouched. Next: AF-IO-005 (the S7 driver,
against AF-IO-008's fake PLC).

---

**Date:** 2026-09-03 (AF-IO-008 — a test double that is not ours, and a PLC that lies usefully)
**Summary:** The bench harness, landed deliberately BEFORE the safety wiring so
AF-IO-004 can be proven against faults instead of assumed. Two halves.

**Cross-validation.** `tests/bench_harness.py` runs pymodbus's OWN TCP server (now an
explicitly TEST-ONLY dependency — moved in requirements.txt; nothing shipped imports
it) against `engine/modbus_client.py` on all five function codes. The point of a
second implementation that shares no code with ours is that it cannot share our
misreading of the spec — and it earned its keep immediately: **pymodbus 3.13's
deprecated `ModbusDeviceContext` shim serves the `hr=` block for FC04 and `ir=` for
FC03 — swapped.** Our client sends the spec-correct codes; the harness uses the new
SimData/SimDevice API (block order co/di/hr/ir), which maps correctly. The comment in
the harness warns the next person off "simplifying" back to the deprecated context.

**The fake PLC.** `engine/fake_s7_server.py` (the fake_ican_gateway pattern) speaks
enough S7comm for the real work: COTP + setup handshake, Read/Write Var against
non-optimized DBs with **correct BIT addressing** (address = byte_offset*8 + bit — the
encoding the current raw driver gets wrong at every offset except 0), WORD and BIT
transports. Halted-CPU is modelled by NOT ticking the heartbeat counter — the server
answers every read forever, because that is exactly what a halted CPU does, and the
test pins that reads keep SUCCEEDING while the value freezes. Fault modes (error
item / short frame / dropped connection) trigger only in the data phase; the
handshake always succeeds, the way a PLC that fails mid-session behaves. The tests
carry a byte-exact reference request encoder — AF-IO-005's fixed driver must produce
identical frames.

6 new tests. Backend **638 passed / 21 skipped / 0 failures (659)**; frontend
untouched. Next: AF-IO-004 — wiring FieldIOManager into the safety kernel.

---

**Date:** 2026-09-03 (AF-IO-003 — the reader loop, and staleness that needs no observer)
**Summary:** `engine/field_io.py` — `FieldIOManager` owns one Modbus client per
declared source, polls every AI/DI point at the scan rate (FC03 holding by default,
FC04 for classic `3xxxx` addresses, FC02 for DIs), and keeps the latest
quality-tagged `Reading` per point in plain memory. Consumers PULL: `snapshot()` /
`bound_snapshot()` / `heartbeat_alive()` are sync, await-free dict work, so the
safety kernel's 50 Hz tick (AF-IO-004) can never block on a network call.

The design point: **staleness is applied at read time**, via `Reading.aged()` against
3× the scan period. When a device dies, nothing has to notice — the passage of time
demotes its readings to STALE on the next look. A source with no available transport
(`s7:` until AF-IO-005, or a typo) reads UNKNOWN loudly rather than crashing or
silently skipping; a device answering "illegal address" is config trouble → UNKNOWN;
a transport drop leaves the last reading to age. `bound_snapshot()` reports the
WORST reading per bound safety input — two sensors on one interlock, and the
unhealthy one speaks for the pair. PLC liveness is judged on the heartbeat counter
CHANGING, not on reads succeeding — a halted CPU serves static reads forever
(`test_heartbeat_judged_on_change_not_on_read_success` pins exactly that).

Wired as the module singleton `field_io_manager` (imported in `app_state`, started/
stopped in the lifespan). With an empty inventory it starts zero poll tasks, so a
checkout without `field_points.json` behaves exactly as before. 9 new tests
(`tests/test_field_io.py`) reusing AF-IO-001's fault-injecting server. Backend
**632 passed / 21 skipped / 0 failures (653)**; frontend untouched. Next: AF-IO-008
(bench harness) before the safety wiring.

---

**Date:** 2026-09-03 (AF-IO-002 — a reading you don't have is not a permit)
**Summary:** The input-side data model. `engine/field_points.py` declares the physical
points on the field rack (`FieldPoint`: source driver, address, AI/DI/AO/DO, raw type,
scaling, `required`, `binds_to` a named safety-kernel input) with a persisted JSON
inventory (`FieldPointStore`, same load/save shape as the I-CAN channel map). Every
observation is a `Reading {value, quality, ts, raw}` — the quality is part of the
datum: **GOOD / STALE** (device stopped answering; last value kept but demoted) /
**FAULT** / **UNKNOWN** (never read — and never a zero).

The safety-relevant physics is in the model, not bolted on later: a 4-20 mA sample
below **3.5 mA** is `FAULT` with `value None` — a cut wire reads ~0 mA while a genuine
zero reads 4 mA, and reporting 0.0 would tell the safety kernel "tank empty" when the
truth is "blind". A 0-10 V point performs NO such detection, because the physics
doesn't provide one — 0 V is a legitimate zero; the model refuses to fake a diagnostic
(this is exactly why the SM 1231 4-20 mA module is specified over the 1215C's two
onboard 0-10 V inputs). Malformed definitions (unknown signal type, unknown
`binds_to`, inverted span) are rejected at the form; a corrupt persisted entry is
dropped LOUDLY on load without taking the inventory down. `required` defaults False —
day-one behaviour is identical to today, and each sensor flips it on as it is
physically commissioned (AF-IO-004 consumes it).

12 new tests (`tests/test_field_points.py`). Backend **623 passed / 21 skipped /
0 failures (644)**; frontend untouched. Next: AF-IO-003 (FieldIOManager poll loop).

---

**Date:** 2026-09-03 (AF-IO-001 — one Modbus TCP client that can actually read)
**Summary:** Start of the AF-IO series (plan: `AF-IO-PLAN.md`, driven by the `/af-io`
loop): give AquaFlow a real INPUT side for the purchased S7-1215C field-I/O rack. The
platform's safety kernel models every sensor it needs — and nothing has ever written
those inputs; they default to `True` and stay there. Before wiring anything to them,
the transport had to stop lying.

The codebase carried **two** hand-rolled Modbus implementations
(`engine/protocol_bus.ModbusTCPDriver`, `plc/plc_engine.ModbusTCPPLCDriver`), both
with the same read defect: `read(256)` and unpack at byte 9 with no check of
transaction id, protocol id, declared length, function code or the exception bit — a
short frame, an exception response or an out-of-order reply was parsed as register
data. Also FC03/FC06 only (the ADAM/Moxa remote-I/O class needs FC02/FC04/FC05),
and `_parse_modbus_address` turned a bare `"45"` into register **-39956** via
`startswith("4")`.

New `engine/modbus_client.py` is the ONE Modbus TCP client: FC02/03/04/05/06; exact
framed reads (`readexactly` the MBAP header, then exactly the declared remainder);
txid/protocol-id/unit-id/byte-count validation; exception replies decoded to named
errors — and NOT treated as a dead link (the device answering "illegal address" is a
healthy conversation); an `asyncio.Lock` so one request is in flight per connection;
`ensure_connected()` reconnect with capped exponential backoff (the old drivers
stayed down forever after one error); address parsing that raises on anything
malformed so callers refuse instead of silently touching register 0. Both drivers now
delegate with their public interfaces unchanged.

18 new tests (`tests/test_modbus_client.py`) cover each validation path with a
scripted fault-injecting server — exception reply, short frame, txid mismatch, bad
protocol id, byte-count lie, silent timeout, mid-session death + recovery — plus the
"45" regression and both drivers end-to-end. (One test initially deadlocked in
teardown: Python 3.12+ `Server.wait_closed()` also waits for live handler tasks; the
scripted server now tracks and drops connections.) Backend **611 passed / 21 skipped /
0 failures (632)**; frontend untouched.

---

**Date:** 2026-09-01 (AF-ICAN-008 — stream the output state, the way the vendor software does)
**Summary:** The 1.1.4 site screenshot closed out most of the remaining possibilities and
pointed at the one thing left undone. It showed **`gateway replied`** (the relaxed
source-port filter from AF-ICAN-006 fixed the false `unverified` — the link is two-way),
**`sending from local port 2002`** (so `SO_REUSEADDR` was not the cause after all), and a
successful capture import listing ~30 channels, **all on group 0**. The capture tool decodes
the group from `payload[4]`, which is the correct byte, so group 0 is real. Correct frames,
leaving the machine, to a gateway that answers — and still nothing moving.

**The remaining difference: the vendor software STREAMS.** The site capture holds **19,152
OUTPUT frames**, roughly 250 ms apart, each carrying the full absolute channel state.
AquaFlow sent exactly one frame per command and then went silent. A relay controller with an
output watchdog drops its relays when that stream stops, which is indistinguishable from
"the command was sent and nothing happened". `protocols/artnet_driver.py:231` already
re-sends on a keepalive for precisely this reason; I-CAN never did.

`ICANConnection` now streams the current state of every driven group at **10 Hz** the whole
time output is armed (`refresh_interval`, replacing the dead `keepalive_interval`), through
the reference client's `set_channels()`. Blackout streams **off** rather than going quiet —
silence is not an off command if the controller latches. Refresh frames are not audited (10 Hz
would bury the operator's real commands); `status()` exposes `streaming` / `refresh_hz` /
`frames_streamed`, and the panel shows a live counter next to OUTPUT ARMED so a stalled
stream is visible rather than assumed.

Two end-to-end tests asserted an exact frame count per batch and were rewritten to compare
**state transitions** with streamed repeats collapsed — the invariant they actually protect
(a group's channels never accumulate `[1] → [1,2] → [1,2,3]`) is unchanged and still enforced.

Backend **593 passed / 21 skipped / 0 failures (614)**; frontend **391 passed**; build green;
packaged **1.1.5**. **Still not confirmed on hardware.** The decisive site test is now single-
shot vs streaming replay from `ican_client.py` — if the replay drives the fountain and a single
`--on` does not, the watchdog theory is confirmed and this build is the fix.

---

**Date:** 2026-09-01 (AF-ICAN-007 — build the channel map from the original software's capture)
**Summary:** Follow-on to AF-ICAN-006. The remaining unknown was never the protocol, it was
channel identity: `group 1 / channel 9` came from the test instructions, not from anything
confirmed to be wired to equipment, and a channel connected to nothing looks exactly like a
broken control path — every step green, nothing moves. The capture of the ORIGINAL fountain
software already answers it: every (group, channel) it drove is wired to something.

New `engine/ican_capture_import.py` parses both artifacts from `tools/ican_capture.py` —
`changes.txt` (using the SAME `LINE_RE` the reference client uses for `--replay`, so there is
no second dialect to keep in sync) and `capture.jsonl` — into `[{group, channels}]`, taking the
union per group and ignoring GW→PC replies. New `POST /api/ican/map/import-capture` accepts the
raw text; the panel reads the file with `FileReader` and posts it, so it works the same in the
packaged app as in a browser.

**The bug that would have made the feature useless:** `import_detections()` created assignments
with an empty label, and `to_device_registry()` skips unlabelled ones — so importing a capture
produced a screen full of correct channel numbers that Attach silently ignored. Imported
channels now carry a placeholder label (`G1 C9`), and out-of-range channels are dropped rather
than mapped. `test_registry_bridge_only_labelled` asserted the old behaviour and was rewritten:
identification is not what makes a channel safe — arming, the typed confirmation and a
deliberate press of that channel's button are. The registry is what can be ADDRESSED, not what
will fire; an explicitly cleared label is still excluded.

Backend **591 passed / 21 skipped / 0 failures (612)**; frontend **391 passed**; build green;
packaged **1.1.4**. **Still not confirmed on hardware.**

---

**Date:** 2026-09-01 (AF-ICAN-006 — the proven client becomes the live transport)
**Summary:** 1.1.2 went to the site. It connected to `192.168.5.2:200`, armed, and logged
every frame as sent — and the fountain did not move. The screenshots showed `connected ·
unverified · OUTPUT ARMED`, safety permit granted, and a clean activity log. Ruled out from
the evidence: the `HARDWARE NOT COMMISSIONED — SIMULATED OUTPUT ONLY` banner is **not** in
this path (`is_hardware_commissioned()` is consulted only by `show_engine.play()` and
`bench_safety`, never by `_safety_gate` or the I-CAN branch), and the channel map resolved
correctly (`ican-1-9` → group 1 / channel 9 → the right frame).

**AquaFlow no longer reimplements the protocol.** `ican_client.py` — the script that ran the
real fountain — is now `engine/ican_reference_client.py` and is the LIVE TRANSPORT.
`ICANConnection` instantiates its `ICANClient` and calls `set_channels()` / `all_off()` /
`poll()`. A test fails the build if a hand-rolled socket reappears beside it.

**The likely root cause, found by diffing the two socket setups:** AquaFlow set
`SO_REUSEADDR`; the client does not. On Windows that let AquaFlow **bind port 2002 while the
vendor I-CAN software still owned it** — the bind succeeded, so the silent ephemeral-port
fallback never fired and no warning was shown, yet the frames had no effect. The client
refuses to start in that case. Now so does AquaFlow, with the port named in the error.

Also: dropped rate-limiting and duplicate suppression (the reference has neither, and the
vendor software repeats identical frames back to back); relaxed the reply filter to validate
the source **address** only — requiring source port 200 discarded valid replies from a device
answering on an ephemeral port and reported a reachable gateway as `unverified`; the panel now
prints the exact frame hex per command and the actually-bound local port, so "what did you
send" is readable at the cabinet without a packet capture.

**Still open — the channel identity question.** `group 1 / channel 9` was an example from the
test instructions, not a channel confirmed to be wired to equipment. The site's `changes.txt`
holds the real ones; `/api/ican/map/import` already accepts decoded detections and should be
wired to it. Backend **586 passed / 21 skipped / 0 failures (607)**; frontend **391 passed**;
build green; packaged **1.1.3**. **Still not confirmed on hardware.**

---

**Date:** 2026-08-31 (AF-ICAN-005 — protocol parity with the hardware-proven client)
**Summary:** The fountain ran from a 40-line standalone script (`ican_client.py`) against the
site gateway (192.168.5.2:200 from 192.168.5.200:2002) and would not run from AquaFlow. This
closes that gap. **Root cause: `ICANConnection.connect()` demanded a reply.** It sent a `0x08`
probe and dropped to `ERROR` with the socket closed unless the gateway answered — but the
gateway does **not** acknowledge `0x08` output frames. I-CAN control is fire-and-forget UDP,
which is exactly why the script works: it never reads anything back. AquaFlow could never open
that gate, so every `send_output` was refused with `REFUSED: state error`. Discovery had the
same flaw, and worse — it probed with the *output* opcode, spraying the relay-driving command
across every host on the subnet during a scan.

Fixed, with the working client as the authority:
- **Group is a big-endian uint32 at bytes[1..4]**, not `group & 0xFF` in byte[4]. Identical for
  groups 0–255 (which is why the old reading survived), but group 256 silently drove group 0.
- **Probe is now `0x03` channel-address**, the only exchange the gateway answers (`0x07` back,
  idle payload `AA AA AA AA 00`). Safer *and* it actually gets a reply.
- **A silent gateway connects UNVERIFIED, not ERROR.** Reachability is a quality signal, not a
  precondition for control. `verified` is surfaced in `/api/ican/status` and in the panel.
- **Blackout covers every group driven**, not just group 0 — the previous behaviour was an
  E-stop that left jets on groups 1 and 9 running.
- **A suppressed duplicate reports success.** Reporting failure kept the group dirty so the bus
  re-sent the identical frame every flush, where the same rate window suppressed it again.
- **Out-of-range channels are refused** at map time (400) instead of silently dropped, which
  had meant a mapped jet that never fires and never errors.
- The fake gateway now models the real one — answers `0x03`, stays silent on `0x08`. A fake that
  politely acked everything is why the broken connect path passed every test.
- "Confirmed" language corrected throughout: a lit button means the frame was **sent**, not that
  the relay closed. The gateway does not ack.

**Verification:** byte-for-byte parity tests against the working client and the captured wire
vectors (`08 00 00 00 09 00 02 00 00 40 00 00 00`; `--group 1 --on 9,13` →
`08 00 00 00 01 00 11 00 00 00 00 00 00`), plus a regression test that drives output through a
*silent* gateway and asserts the exact bytes reach the wire. Backend **581 passed / 21 skipped /
0 failures**; frontend **391 passed (29 files)**; `npm run build` green. Packaged as **1.1.2**.
**Not yet run against the real gateway — hardware validation is pending on the site PC.**

---

**Date:** 2026-08-21 (3D preview review upgrade)
**Summary:** Improved the 3D Preview after reviewing current Three.js/WebGL preview practices
and the runtime screenshot showing a WebGL shader compile failure. Fixed the glow billboard
shader by removing duplicate built-in `position`/`uv` declarations, added sRGB renderer output
color handling, made quality presets affect pixel ratio/shadows/exposure, stabilized the venue
background with deterministic seeded placement, softened the floor/grid treatment, added a
review overlay layer for pool bounds plus fixture reach/safety rings, added a fit-to-design
camera helper, and exposed Review UI / Scale Overlays controls with a client-facing 3D Review
HUD in the preview panel. Verification: `npm run build` green; frontend `npm test` green
with **231 passed (20 files)**. Packaged a slim local install ZIP at
`release/AquaFlow-3DPreview-ReviewUpgrade-SLIM-20260821-053944.zip`.

---

**Date:** 2026-07-07 (later — branding, update server, license clarification)
**Summary:** Closed out the CEO's "logo / update-server / license" follow-up. **(1) Branding:**
new `aquaflow/desktop/scripts/generate_brand_assets.py` (Pillow) builds the real app identity
from the LuxuryCon shield + an AquaFlow water droplet (blue `#1E88E5`) — `AquaFlow.ico`
(6 sizes), `aquashow.ico`, `icon.png`, `shield.png`, `splash.png`, and NSIS installer
sidebar/header BMPs; all generated + committed and wired into `electron-builder.yml`, `main.js`,
`menu.js`, `splash.html`; `BRAND.md` documents the shield-constant + element + accent system.
Also **fixed the `files[]` globs** that had omitted `menu.js`/`launcher.js`/`app-config.js`/
`updater.js`/`splash.html`/`assets` (the packaged app would have failed to load them).
**(2) Update server:** feed now `https://luxuryconworld.com/updates/aquaflow/` (hardcoded,
admin-overridable), installer renamed `AquaFlowSetup-<version>.exe`; hub task **LP-UPDATE-001**
added for the shared LuxuryCon update-server hosting. **(3) License:** confirmed the engine is
**HMAC-SHA256** (not Ed25519); corrected the hub's 3 Ed25519 claims and the AF-HUB-012 note;
added a **one-command** non-interactive generator CLI (local — the minting tool is intentionally
`.gitignore`d) and wrote `LICENSE-ADMIN.md` (CEO self-service issuance) — engine round-trip
verified (VALID/INVALID_HW/INVALID_SIG), license tests 22/22. **(4) Code signing:** SKIPPED for
Tier A (CEO decision) — documented SmartScreen "Run anyway" + checksum-only integrity.
**(5)** `FIRST-BUILD-GUIDE.md` — a zero-experience, copy-paste CEO build guide. Commits
`765d7e8 → 9541472` (aquaflow) + `f272f4d` (hub). Backend unchanged (532); GUI/installer/
clean-machine still build-machine-pending.

---

**Date:** 2026-07-07
**Summary (latest — AF-PKG standalone packaging):** AquaFlow now has a full **desktop-app
packaging layer** in `aquaflow/desktop/` (delivery track, separate from AF-HUB product
hardening). **All 10 AF-PKG tasks are CODE-COMPLETE and pushed** — 001 scaffolding · 002
PyInstaller engine bundle (`aquaflow-engine.spec` + frozen `engine_entry.py`) · 003 Vite web
build (`--base=./`) · 004 startup orchestration (free-port → spawn engine → health-poll →
window; env scrubbing; graceful shutdown) · 005 branding (placeholder icon/splash/menu/About)
· 006 `.aquashow` file association · 007 auto-update (electron-updater, admin-only feed URL =
MITM guard) · 008 NSIS installer config (per-user default, data-preserving upgrade) · 009
`AF-PKG-VERIFICATION-REPORT.md` · 010 `BUILD.md` + `RELEASE.md`. The existing frontend/backend
were **wrapped, not modified** (backend still **532 passed**). **Environment ceiling (honest):**
this sandbox cannot download the Electron binary (an in-sandbox `npm install` failed on exactly
that), run a PyInstaller `.exe` (PyInstaller needs a 3.10–3.12 build venv, not the repo's 3.14),
build/run NSIS, or test on a clean machine — so **every GUI/build/installer/clean-machine
acceptance item is written+wired but marked PENDING for a human on a Windows build machine; none
self-marked done.** CEO assets still needed: real logo/icon, installer graphics, per-user vs
per-machine decision, internal HTTPS update-server URL, code-signing cert. Commits `c82b28b →
b6f629c`; hub `aq-doc-5` updated (migration v28).

---

**Date:** 2026-07-05
**Summary:** AQ-X-016 — AquaFlow 3D Export Bridge implemented (the last open AQ-X recovery task).
The live 3D preview scene (pool + water + fixtures + lights) now exports to **glTF/GLB, OBJ+MTL,
USD (USDA), FBX**, and a **LUXEXCHANGE v1** envelope for import into LuxuryForm/LuxuryScape —
fixture positions + basic PBR materials preserved in every format. Dependency-free serializers
(no three.js/exporter libs), new `Export3DPanel` (Design → 3D Export). Nodes also carry
Y-rotation + scale and a rich engineering-identity extras record (DMX patch, protocol,
flow/pressure/power, group) with NaN/Inf coordinate hardening — folded in from a duplicate
backend attempt that was then removed. Frontend vitest **190 passing** (+25),
`validate_export3d.mjs` **56/56**, `npm run build` warning-clean (main chunk 181 kB; export
panel is its own 29 kB lazy chunk). Backend pytest unchanged at **437**.

## Completed
- **AQ-X-016 AquaFlow 3D Export Bridge — DONE on `main`.**
  - New `src/export3d/` module — a serializer-agnostic scene-graph builder plus five dependency-free
    writers, all runnable headlessly (vitest env = node):
    - [sceneGraph.js](aquaflow/frontend/src/export3d/sceneGraph.js) — `buildSceneGraph(design)` reuses
      the app's canonical transforms ([fixtureTypeMap.js](aquaflow/frontend/src/hooks/fixtureTypeMap.js):
      `fixturePlanCoords`, `classifyFixtureType`, `resolveFixtureType`, `geometryToPoolConfig`) so an
      export matches the live preview exactly. Emits an IR of nodes (pool basin + water surface +
      per-fixture glyphs) each carrying translation, mesh, PBR material and (for lights) a punctual
      light record. **Fixture positions preserved** (plan x → world x, plan y → world z); fixtures
      classified by their **original** type (fixed the lossy `type`→`jet_3d` overwrite so pumps/valves
      export as equipment, not nozzles).
    - [primitives.js](aquaflow/frontend/src/export3d/primitives.js) — box/cylinder/cone/disc/plane/
      prism/sphere triangle-mesh generators with flat normals (no three.js).
    - [gltf.js](aquaflow/frontend/src/export3d/gltf.js) — **glTF 2.0** (`toGLTF`, self-contained JSON
      with a base64-embedded buffer) and **GLB** (`toGLB`, binary container: 12-byte header + 4-aligned
      JSON + BIN chunks). PBR metallic-roughness materials, sRGB→linear conversion, punctual lights via
      **KHR_lights_punctual**. Pure base64 encoder (node + browser).
    - [obj.js](aquaflow/frontend/src/export3d/obj.js) — **Wavefront OBJ + MTL** (world-space verts,
      per-node `o`/`usemtl`, material library).
    - [usd.js](aquaflow/frontend/src/export3d/usd.js) — **USD (USDA ASCII)** with `def Mesh` prims
      (points/faceVertexIndices/normals) + `UsdPreviewSurface` materials + translate xformOps.
    - [fbx.js](aquaflow/frontend/src/export3d/fbx.js) — **ASCII FBX 7.3** (Geometry/Model/Material
      objects + Connections; polygon-boundary bit-inversion; Lcl Translation).
    - [luxexchange.js](aquaflow/frontend/src/export3d/luxexchange.js) — **LUXEXCHANGE v1** envelope
      `{platform, version, payload_type, payload}` embedding the glTF **and** a design-level fixture
      manifest (positions + materials + lights) — the verified import path into LuxuryForm/LuxuryScape.
    - [index.js](aquaflow/frontend/src/export3d/index.js) — `exportScene(design, format)` →
      `{filename, mimeType, data, companions}` (OBJ ships its MTL companion); `EXPORT_FORMATS` list.
  - New [Export3DPanel.jsx](aquaflow/frontend/src/components/panels/Export3DPanel.jsx) — reads the live
    engineering design (engineeringStore, falling back to showStore), shows scene stats
    (nodes/fixtures/lights/triangles), format picker and one-click download; wired into `App.jsx` +
    the TopBar (Design → 3D Export). AquaFlow stays control software — this is presentation export only.
  - **Folded in from a duplicate backend attempt (then removed):** every node also carries a
    Y-rotation + per-axis scale and a rich `extras` engineering record (fixture id, DMX universe/
    channel/count, protocol, flow/pressure/power, group id) that rides on glTF `node.extras.aquaflow`,
    USD custom attrs, FBX Lcl Rotation/Scaling, and the LUXEXCHANGE fixture manifest — the round-trip
    identity LuxuryForm/LuxuryScape match on. Coordinates are hardened (`safeNum`) so a stray NaN/Inf
    can't corrupt a file. An unintegrated parallel `backend/services/export_3d_service.py` (no route/
    UI/tests, and it stubbed FBX+USD) was deleted after its good ideas were ported here.
  - **Verification:** [export3d.test.js](aquaflow/frontend/src/export3d/__tests__/export3d.test.js) **25
    cases** → frontend vitest **190 passing** (was 165); [validate_export3d.mjs](aquaflow/frontend/validate_export3d.mjs)
    **56/56** (parses every format back — GLB magic/version/chunk alignment, glTF accessors + rotation
    quaternion + extras, OBJ↔MTL material closure, USDA prims + xformOps, FBX blocks, NaN hardening,
    LUXEXCHANGE round-trip of fixture positions + transforms + materials + lights + engineering identity);
    `npm run build` warning-clean (main chunk 181 kB, Export3DPanel a 29 kB lazy chunk). Frontend-only
    change; backend pytest unaffected at **437**.

- **EVAL-AQ-003 Implement Fixes — DONE on `main`.** Worked the prioritised queue in
  [fix_strategy_report.md](fix_strategy_report.md):
  - **AQ-FIX-002 (bundle, P2) — DONE.** Route-level code-split: every conditionally-rendered panel is
    now a `lazy()` chunk behind one `<Suspense>` in [App.jsx](aquaflow/frontend/src/App.jsx); three.js /
    react are isolated vendor chunks ([vite.config.js](aquaflow/frontend/vite.config.js) `manualChunks`).
    Main app chunk **1.87 MB → 181 kB**; `npm run build` is **warning-clean**.
  - **AQ-FIX-007 + AQ-FIX-006 (integration seams, P2) — DONE.** New
    [tests/test_journeys_e2e.py](aquaflow/backend/tests/test_journeys_e2e.py) — 5 cross-feature journeys
    driving the real FastAPI stack (brief→engineering+construction packages; fleet register→E-stop→
    dashboard→alert→ack; twin ingest→forecast; cloud backup→restore→remote diagnostics; cross-tenant
    isolation). Frontend component-DOM testing needs jsdom (not installed) — recorded as a follow-up in
    the coverage map; the seams are covered via the journey suite instead.
  - **AQ-FIX-004 + AQ-FIX-005 (VR / 4K caveats, P2) — DONE.** New
    [caveatFallbacks.test.js](aquaflow/frontend/src/__tests__/caveatFallbacks.test.js) pins graceful
    degradation with no WebXR headset and no `MediaRecorder` (7 cases).
  - **AQ-FIX-009 (time-based timers, P3) — DONE.** New
    [tests/test_time_based_metrics.py](aquaflow/backend/tests/test_time_based_metrics.py) makes the
    "time advances → state changes" contract explicit (fault escalation tiers, fleet heartbeat timeout,
    cloud reachability window) via injected clocks.
  - **AQ-FIX-008 (duplicate files, P3) — DONE.** The dead second preview panel
    (`components/panels/PreviewPanel.jsx`, actually a v4 copy) is archived to `frontend/_archive/`; the
    mounted source of truth is `preview/PreviewPanel_v5`; grep + build clean.
  - **AQ-FIX-003 (service/test naming, P2) — DONE.** New
    [docs/TEST_COVERAGE_MAP.md](aquaflow/docs/TEST_COVERAGE_MAP.md) maps every "orphan" service to its
    real covering suite and honestly lists the 2–3 genuine gaps; recommends `pytest --cov`.
  - **AQ-FIX-001 (physical-hardware verification, P0) — CODE/DOC PORTION DONE; physical bring-up
    pending.** New [docs/commissioning_checklist.md](aquaflow/docs/commissioning_checklist.md) turns the
    first real-fixture bring-up into a formal test (levels, 15-bit universes, ≤44 Hz, safety-gate
    no-permit=all-zero incl. colour channels, flame-duration). The physical session requires real
    hardware and an authorised on-site operator — it cannot run in CI, so the honest status remains
    **loopback-verified, physical-pending**; the loopback + safety suites stay green
    (`validate_hardware_output.py` 20/20, `validate_safety_output_limits.py` 15/15).
  - **Verification:** backend pytest **437 passing** (+10: journeys + time-based), frontend vitest
    **165 passing** (+7: caveat fallbacks); `npm run build` warning-clean (main chunk 181 kB). No
    safety limit weakened; all changes additive/config-only.


- **EVAL-AQ-002 Fix Strategy — DONE on `main` (Stage 8 evaluation track).**
  - New [services/fix_strategy_engine.py](aquaflow/backend/services/fix_strategy_engine.py) — a
    deterministic rule-based + heuristic engine that turns [EVALUATION_REPORT.md](EVALUATION_REPORT.md)
    into an implementation-ready fix plan (issue → diagnosis → fix approach → criticality → effort →
    dependency → owner → acceptance test). No ML: triage/safety/priority must be explainable.
  - Extracts + de-duplicates 9 issues (merging the physical-hardware item that appears in §3/§4/§5),
    scores a weighted priority with mandatory safety/blocker overrides, estimates effort (bands +
    person-hours), and generates acceptance criteria, test plan, rollback plan and a safety gate for
    hardware/safety issues. One P0 (physical-hardware commissioning) → BLOCK-release verdict.
  - Emits [fix_strategy_report.md](fix_strategy_report.md), [fix_strategy_queue.json](fix_strategy_queue.json)
    and [fix_strategy_acceptance_matrix.csv](fix_strategy_acceptance_matrix.csv).
  - Verified: [validate_fix_strategy.py](aquaflow/backend/validate_fix_strategy.py) 88/88 +
    [tests/test_fix_strategy_engine.py](aquaflow/backend/tests/test_fix_strategy_engine.py) 25/25;
    full backend suite **428 passed** (403 baseline + 25 new, no regressions).

- **AQ-S5-006 Generative Fountain Designer — DONE on `main` (Stage 5).**
  - New backend [services/generative_designer.py](aquaflow/backend/services/generative_designer.py) —
    turns a short brief (venue, area, budget, style, theme) into complete fountain concepts and the two
    downstream deliverable packages.
  - **Generates fountain concepts** — `generate_concepts` synthesises distinct, reproducible concepts
    across three spatial archetypes (radial rotunda / grand canal / clustered cascade), each with a
    laid-out fixture set from a costed component catalog, a sized pool, a written narrative, signature
    elements, and a budget-aware estimate (trims the priciest fixtures to stay under budget).
  - **Produces an engineering package** — `build_engineering_package` projects a concept to the canonical
    design and reuses the existing engineering packager (CAD DXF, BOM XLSX, P&ID SVG, cover PDF,
    dependency graph, manifest with checksums).
  - **Produces a construction package** — `build_construction_package` emits a construction ZIP: civil
    works (excavation/concrete/waterproofing/rebar quantities), structural spec, equipment room,
    electrical connected-load, plumbing schedule, a phased install programme (CSV), a safety plan, a
    cover PDF and a checksummed manifest.
  - New [GenerativeDesignerPanel.jsx](aquaflow/frontend/src/components/panels/GenerativeDesignerPanel.jsx) —
    brief form → concept cards (palette, narrative, cost) → download engineering/construction ZIPs;
    wired into `App.jsx` + the TopBar (AI → Generative Designer).
  - API: `POST /api/generative/concepts|engineering-package|construction-package`
    ([generative_routes.py](aquaflow/backend/api/routes/generative_routes.py)), wired in main.py.
  - **Verification: 22/22** ([validate_generative_designer.py](aquaflow/backend/validate_generative_designer.py))
    + **10 pytest cases** ([test_generative_designer.py](aquaflow/backend/tests/test_generative_designer.py)) →
    backend pytest **403 passing** (was 393); frontend **158 vitest passing**; **`npm run build` succeeds**.


- **AQ-S5-005 Global Asset Cloud — DONE on `main` (Stage 5).**
  - New backend [services/asset_cloud.py](aquaflow/backend/services/asset_cloud.py) — a multi-tenant
    cloud store: companies own assets, whose backups are versioned + SHA-256 checksummed; sites report
    diagnostics that support can pull remotely.
  - **Cloud backups work** — `create_backup` stores a versioned, checksummed snapshot; `restore_backup`
    / `latest_backup` return it and verify the checksum (corruption is caught); retention prunes to the
    newest 10 versions per asset.
  - **Multi-company support exists** — every company is an isolated tenant namespace; assets, backups
    and diagnostics are scoped per company and never leak across tenants (a backup id can't be restored
    under another company).
  - **Remote diagnostics supported** — a site reports its operator status (condensed via the mobile
    monitor); `run_remote_diagnostic` collects a full bundle (health, severity-ranked alerts,
    reachability with a 300 s timeout, backup freshness, and actionable recommendations).
  - New [CloudPanel.jsx](aquaflow/frontend/src/components/panels/CloudPanel.jsx) — a tenant console:
    pick a company, browse/restore its cloud backups, and run remote diagnostics on its sites; wired
    into `App.jsx` + the TopBar (Runtime → Global Asset Cloud).
  - API: `/api/cloud/companies[...]/backups`, `/diagnostics` ([cloud_routes.py](aquaflow/backend/api/routes/cloud_routes.py)),
    wired in main.py.
  - **Verification: 25/25** ([validate_asset_cloud.py](aquaflow/backend/validate_asset_cloud.py))
    + **10 pytest cases** ([test_asset_cloud.py](aquaflow/backend/tests/test_asset_cloud.py)) →
    backend pytest **393 passing** (was 383); frontend **158 vitest passing**; **`npm run build` succeeds**.


- **AQ-S5-004 Fleet Management System — DONE on `main` (Stage 5).**
  - New backend [services/fleet_manager.py](aquaflow/backend/services/fleet_manager.py) — persists one
    JSON per site and mirrors each site's health by reusing the AQ-X-020 `mobile_monitor`
    (`build_snapshot`/`evaluate_alerts`), so fleet health matches the single-site monitor.
  - **Multiple sites monitored** — `register_site` + `report_status` ingest each site's operator status;
    a clock-injected 120 s heartbeat timeout marks silent (or never-reporting) sites offline.
  - **Central dashboard works** — `dashboard()` rolls up site count, online/offline split, a
    live/warning/critical/estop/idle/offline health breakdown, the critical-alert count, and per-site rows.
  - **Alerts centralised** — `central_alerts()` merges every online site's alerts (attributed to
    `site_id`/`site_name`), injects a synthetic `SITE_OFFLINE` alert for stale sites, sorts critical-first,
    and supports acknowledge (persisted, and pruned automatically when the underlying alert clears).
  - New [FleetPanel.jsx](aquaflow/frontend/src/components/panels/FleetPanel.jsx) — a live (5 s poll)
    central dashboard: stat tiles, per-site health cards, and the centralised alert feed with Ack; wired
    into `App.jsx` + the TopBar (Runtime → Fleet Management).
  - API: `POST /api/fleet/sites`, `POST /api/fleet/sites/{id}/status`, `GET /api/fleet/sites/{id}`,
    `GET /api/fleet/dashboard`, `GET /api/fleet/alerts`, `POST /api/fleet/alerts/ack`
    ([fleet_routes.py](aquaflow/backend/api/routes/fleet_routes.py)), wired in main.py.
  - **Verification: 19/19** ([validate_fleet_manager.py](aquaflow/backend/validate_fleet_manager.py))
    + **9 pytest cases** ([test_fleet_manager.py](aquaflow/backend/tests/test_fleet_manager.py)) →
    backend pytest **383 passing** (was 374); frontend **158 vitest passing**; **`npm run build` succeeds**.


- **AQ-S5-003 Autonomous Show Adaptation — DONE on `main` (Stage 5).**
  - New backend [services/show_adaptation.py](aquaflow/backend/services/show_adaptation.py) — from live
    context it produces an adaptation plan that re-scales the running show (intensity, jet height, tempo,
    enabled/disabled effects), reusing the AQ-X-012 wind thresholds.
  - **Weather adaptation** — high wind (≥12 m/s) cuts jet height to 0.4 and disables mist/laminar/fine
    jets + flame; moderate wind trims height to 0.7; rain reduces intensity and drops fog; storm/dense-fog
    is flagged unsafe with a near-shutdown; night (low ambient lux) boosts lighting.
  - **Crowd adaptation** — scales intensity with crowd density (eco 0.5× when empty → boost 1.2× when
    packed); density derived from level, or count/capacity.
  - **Event adaptation** — profiles per event (quiet-hours dims + disables flame/laser; celebration/VIP
    boost; finale boosts + enables flame/laser/fog; countdown speeds tempo).
  - **Safety precedence** — weather caps are applied last, so a finale can never raise jets or ignite
    flame in high wind, and intensity is capped at 1.5×.
  - New [AdaptationPanel.jsx](aquaflow/frontend/src/components/panels/AdaptationPanel.jsx) — live
    wind/crowd/condition/event controls that recompute the plan (scale bars, effect toggles, triggers,
    safety badge); wired into `App.jsx` + the TopBar (Runtime → Autonomous Adaptation).
  - API: `POST /api/adaptation/plan` ([adaptation_routes.py](aquaflow/backend/api/routes/adaptation_routes.py)),
    wired in main.py.
  - **Verification: 25/25** ([validate_show_adaptation.py](aquaflow/backend/validate_show_adaptation.py))
    + **15 pytest cases** ([test_show_adaptation.py](aquaflow/backend/tests/test_show_adaptation.py)) →
    backend pytest **374 passing** (was 359); **`npm run build` succeeds**.


- **AQ-S5-002 AI Optimization Engine — DONE on `main` (Stage 5).**
  - New backend [services/optimization_engine.py](aquaflow/backend/services/optimization_engine.py) —
    analyses a design/show and recommends changes, each grounded in real physics so the savings are
    concrete.
  - **Energy optimised** — pump power follows the affinity laws (P∝N³), so trimming a pump's speed to the
    flow actually needed yields large savings (4 kW @ 80% flow → 48.8% less); incandescent→LED (~80%) and
    off-peak scheduling add more; reports baseline/optimized kWh + cost saving.
  - **Water optimised** — an open (non-recirculating) design wastes all pumped water, so recirculation
    cuts makeup to just evaporation + drift (>90% saving); a recirculating design trims wind-driven drift
    (lower tall jets) and evaporation (timing).
  - **Performance optimised** — trims low impact-per-flow jets to raise the show's visual efficiency
    (impact per flow) while keeping most of the impact, and caps output to the 44 Hz Art-Net ceiling.
  - New [OptimizationPanel.jsx](aquaflow/frontend/src/components/panels/OptimizationPanel.jsx) — edit a
    design and see the three savings cards + recommendations; wired into `App.jsx` + the TopBar
    (AI → AI Optimization).
  - API: `POST /api/optimize/analyze|energy|water|performance`
    ([optimize_routes.py](aquaflow/backend/api/routes/optimize_routes.py)), wired in main.py.
  - **Verification: 20/20** ([validate_optimization_engine.py](aquaflow/backend/validate_optimization_engine.py),
    every saving cross-checked against physics) + **10 pytest cases**
    ([test_optimization_engine.py](aquaflow/backend/tests/test_optimization_engine.py)) → backend pytest
    **359 passing** (was 349); **`npm run build` succeeds**.


- **AQ-S5-001 Digital Twin Engine — DONE on `main` (Stage 5).**
  - New backend [services/digital_twin.py](aquaflow/backend/services/digital_twin.py) — a live mirror of
    the physical assets fed by telemetry.
  - **Real assets mirrored** — `register_asset()` + `ingest()` keep a live mirrored state (running,
    runtime hours, temperature, pressure, cycles) for every asset; `mirror()` gives the fleet view. New
    [DigitalTwinPanel.jsx](aquaflow/frontend/src/components/panels/DigitalTwinPanel.jsx) shows the live
    mirror + fleet summary (polling), wired into `App.jsx` + the TopBar (Runtime → Digital Twin).
  - **Historical replay supported** — every telemetry sample is appended to a time-series history;
    `replay_at(ts)` returns the state as-of any past moment (last sample ≤ target) and `replay_range()`
    returns a window.
  - **Predictive maintenance supported** — `maintenance_forecast()` computes hours-remaining vs the
    service interval and extrapolates the runtime-accrual rate into a days-to-service / estimated service
    date (ok / due-soon / overdue; `mark_serviced()` resets the countdown); `predict_anomalies()` fits the
    temperature trend and flags an asset projected to reach its limit within the horizon (no false alert
    when stable).
  - API: `POST /api/twin/assets|ingest|assets/{id}/service`, `GET /api/twin/mirror|assets/{id}|assets/{id}/replay|assets/{id}/forecast|summary`
    ([twin_routes.py](aquaflow/backend/api/routes/twin_routes.py)), wired in main.py.
  - **Verification: 22/22** ([validate_digital_twin.py](aquaflow/backend/validate_digital_twin.py))
    + **10 pytest cases** ([test_digital_twin.py](aquaflow/backend/tests/test_digital_twin.py)) →
    backend pytest **349 passing** (was 339); the API was exercised end-to-end via TestClient (register →
    ingest 31 days → mirror → replay@day10 → forecast with a temperature-trend alert → summary);
    **`npm run build` succeeds**.


- **AQ-S4-006 Documentation Center — DONE on `main` (Stage 4).**
  - New `src/docs/` module ([articles.js](aquaflow/frontend/src/docs/articles.js),
    [search.js](aquaflow/frontend/src/docs/search.js)) — the help content ships **bundled with the app**
    (16 articles across Basics/Design/Programming/Hardware/Engineering/Safety/Runtime/Account) so the
    center works with **no network**.
  - **Search supported** — a pure, dependency-free ranked full-text search (title/tag weighted over body,
    substring boost, snippets); empty/stopword queries return nothing.
  - **Offline mode supported** — search + article retrieval are entirely client-side over the bundled
    docs (`OFFLINE_AVAILABLE`, verified to work with no `fetch`); the panel shows an "Offline ready" badge.
  - **Context-sensitive help supported** — each article maps to the UI panels it explains; `contextHelp()`
    returns the relevant articles for a panel key, and [helpContext.js](aquaflow/frontend/src/docs/helpContext.js)
    records the last panel the user was on (set in `TopBar`) so opening the docs shows help for that area.
  - New [DocumentationPanel.jsx](aquaflow/frontend/src/components/panels/DocumentationPanel.jsx) — search
    box, category browse, context-help section, and an article viewer; wired into `App.jsx` + the TopBar
    (Help → Documentation Center).
  - **Verification: 10 vitest cases** ([docs.test.js](aquaflow/frontend/src/docs/__tests__/docs.test.js)) →
    frontend vitest **158 passing** (was 148); **`npm run build` succeeds**. Frontend-only change (backend
    unaffected at 339).


- **AQ-S4-005 Training Academy — DONE on `main` (Stage 4).**
  - New backend [services/training_academy.py](aquaflow/backend/services/training_academy.py) — a built-in
    curriculum of 4 courses (Fundamentals, Show Programming, Hardware & Safety, Hydraulic Design), each a
    set of lessons with an interactive quiz.
  - **Interactive lessons available** — `get_lesson()` serves lesson content + quiz **without the answer
    key**; `submit_lesson()` grades the answers server-side and returns per-question feedback (best score
    kept). New [TrainingAcademyPanel.jsx](aquaflow/frontend/src/components/panels/TrainingAcademyPanel.jsx)
    renders the courses/lessons, lets the learner answer the quiz and see feedback, and shows progress +
    the earned certificate; wired into `App.jsx` + the TopBar (Help → Training Academy).
  - **Progress tracking supported** — `progress()` reports per-course completion %, lesson scores, and an
    overall percentage; progress persists per learner.
  - **Certification supported** — `issue_certificate()` awards a certificate only when every lesson is
    completed and the average meets the course pass threshold (the safety course requires a stricter 80%);
    certificates are idempotent and **verifiable by code** (`verify_certificate`).
  - API: `GET /api/academy/courses|courses/{id}|courses/{id}/lessons/{lid}|progress/{learner}|verify/{code}`,
    `POST /api/academy/submit|certificate`
    ([academy_routes.py](aquaflow/backend/api/routes/academy_routes.py)), wired in main.py.
  - **Verification: 21/21** ([validate_training_academy.py](aquaflow/backend/validate_training_academy.py))
    + **10 pytest cases** ([test_training_academy.py](aquaflow/backend/tests/test_training_academy.py)) →
    backend pytest **339 passing** (was 329); the API was exercised end-to-end via TestClient (courses →
    lesson with answers hidden → submit → progress → certificate → verify valid); **`npm run build` succeeds**.


- **AQ-S4-004 Online License Portal — DONE on `main` (Stage 4).**
  - New backend [services/license_portal.py](aquaflow/backend/services/license_portal.py) — server-side
    multi-seat license accounts on top of the existing license engine.
  - **Online activation supported** — `activate(key, fingerprint)` binds a machine to a free seat and
    issues a **signed, fingerprint-bound license** (via `create_license`) that validates on that machine
    and is rejected elsewhere; re-activating the same machine is idempotent; activation is rejected once
    all seats are used.
  - **License transfer supported** — `transfer(key, from_fp, to_fp)` frees the source machine's seat,
    binds the destination, issues it a fresh license, and records the transfer history; transfer from an
    inactive or identical machine is rejected.
  - **Seat management supported** — `seats()` lists usage + active machines; `deactivate()` frees a seat;
    `add_seats()`/`set_seats()` grow/shrink the pool (never below the active-seat count). Accounts persist
    as one JSON file each.
  - API: `POST /api/portal/accounts|activate|deactivate|transfer|seats`, `GET /api/portal/accounts/{key}|seats/{key}`
    ([portal_routes.py](aquaflow/backend/api/routes/portal_routes.py)), wired in main.py.
  - **Verification: 21/21** ([validate_license_portal.py](aquaflow/backend/validate_license_portal.py))
    + **13 pytest cases** ([test_license_portal.py](aquaflow/backend/tests/test_license_portal.py)) →
    backend pytest **329 passing** (was 316); the API was exercised end-to-end via TestClient (activate,
    seat-limit 409, transfer, seat management). Backend-only change; `npm run build` not applicable.


- **AQ-S4-003 Usage Analytics Engine — DONE on `main` (Stage 4).**
  - New backend [services/analytics_engine.py](aquaflow/backend/services/analytics_engine.py).
  - **Anonymous usage collected** — `track()` one-way hashes the session id and sanitises properties
    (email/name/ip/path/license/… dropped; identifier values hashed) before appending an event;
    collection is **consent-gated** (persisted) and a no-op when disabled. The frontend
    [utils/analytics.js](aquaflow/frontend/src/utils/analytics.js) generates a random, non-identity
    session id and posts feature usage to `/api/analytics/track` (fire-and-forget, consent-aware),
    wired to record `app_open` (`main.jsx`) and panel opens (`TopBar`).
  - **Feature statistics collected** — `feature_stats()` gives per-feature count, unique sessions, and
    first/last seen, sorted by usage.
  - **Adoption metrics available** — `adoption_metrics()` gives total + active sessions (DAU/WAU/MAU
    windows measured back from the latest event), per-feature adoption rate (unique sessions using it /
    total), and the top features.
  - API: `POST /api/analytics/track|consent`, `GET /api/analytics/feature-stats|adoption|summary`
    ([analytics_routes.py](aquaflow/backend/api/routes/analytics_routes.py)), wired in main.py.
  - **Verification: 20/20** ([validate_analytics_engine.py](aquaflow/backend/validate_analytics_engine.py))
    + **8 pytest cases** ([test_analytics_engine.py](aquaflow/backend/tests/test_analytics_engine.py)) →
    backend pytest **316 passing** (was 308); **6 vitest cases**
    ([analytics.test.js](aquaflow/frontend/src/utils/__tests__/analytics.test.js)) → frontend vitest
    **148 passing** (was 142); **`npm run build` succeeds**.


- **AQ-S4-002 Crash Reporting System — DONE on `main` (Stage 4).**
  - New backend [services/crash_reporter.py](aquaflow/backend/services/crash_reporter.py).
  - **Automatic logs uploaded** — `CrashReporter.report()` builds a structured crash report with the
    recent log lines auto-attached, spools it, and uploads it via a pluggable transport (local sink by
    default); a failed upload stays in an **offline outbox** and `flush()` retries it. New frontend
    [utils/crashReporter.js](aquaflow/frontend/src/utils/crashReporter.js) installs global
    `window.onerror` / `unhandledrejection` handlers (wired in `main.jsx`) so uncaught UI errors are
    captured and POSTed to `/api/crash/report` automatically (with client-side dedupe).
  - **Crash fingerprints generated** — `crash_fingerprint()` hashes the exception type + the normalised
    traceback frames (paths → basenames, line numbers/addresses stripped), so the same bug shares one id
    across machines and minor code drift; `summary()` groups reports by fingerprint (recurring-crash view).
  - **Support reports generated** — `generate_support_report()` produces a readable report (system info,
    app version, fingerprint, traceback, recent logs, how-to-send instructions).
  - API: `POST /api/crash/report|flush`, `GET /api/crash/reports|summary|support/{id}`
    ([crash_routes.py](aquaflow/backend/api/routes/crash_routes.py)), wired in main.py.
  - **Verification: 19/19** ([validate_crash_reporter.py](aquaflow/backend/validate_crash_reporter.py)) +
    **11 pytest cases** ([test_crash_reporter.py](aquaflow/backend/tests/test_crash_reporter.py)) →
    backend pytest **308 passing** (was 297); **5 vitest cases**
    ([crashReporter.test.js](aquaflow/frontend/src/utils/__tests__/crashReporter.test.js)) → frontend
    vitest **142 passing** (was 137); **`npm run build` succeeds**.


- **AQ-S4-001 Installer Framework — DONE on `main` (Stage 4).**
  - New [services/installer.py](aquaflow/backend/services/installer.py) — the machine-facing lifecycle.
  - **One-click installation** — `InstallManager.install(root)` idempotently provisions the directory
    layout (config/data/logs/compiled/cache), writes a default config + an install manifest (install id,
    version, edition, timestamp), and verifies the result in a single call. A cross-platform
    [install.py](install.py) one-click installer runs provisioning → pip deps → frontend build.
  - **Auto updates supported** — semantic-version parse/compare, `check_for_update` against an update
    manifest (with mandatory-when-below-min-supported), and `apply_update` / `rollback` that record an
    update history and keep the app config version in sync.
  - **License activation supported** — `activate_license` wraps the existing license engine
    (hardware-fingerprint validation + cache); a signed key activates on the matching machine and is
    rejected (INVALID_HW) on another.
  - API: `GET /api/installer/version|activation`, `POST /api/installer/install|check-update|apply-update|activate`
    ([installer_routes.py](aquaflow/backend/api/routes/installer_routes.py)), wired in main.py.
  - **Verification: 28/28** ([validate_installer.py](aquaflow/backend/validate_installer.py)) + **15
    pytest cases** ([test_installer.py](aquaflow/backend/tests/test_installer.py)) → backend pytest now
    **297 passing** (was 282); the `install.py` one-click flow provisions a full install into a temp dir.
    Backend + install script; no frontend source changed, so `npm run build` not applicable.


- **AQ-S3-008 Environment and Material Library — DONE on `main` (Stage 3).**
  - New `src/environment/` library module ([index.js](aquaflow/frontend/src/environment/index.js)).
  - **20 environments included** — [environments.js](aquaflow/frontend/src/environment/environments.js)
    ships ENV001–ENV020 (urban plaza, hotel courtyard, public square, mall atrium, resort lagoon,
    desert, mountain, tropical, waterfront, civic plaza, studio black) each with the spec parameters
    (ambient lux, sun elevation/azimuth, sky turbidity, fog density, wind, temperature, humidity), all
    within the research ranges.
  - **20 materials included** — [materials.js](aquaflow/frontend/src/environment/materials.js) ships
    MAT001–MAT020 (stainless variants, powder-coated steel, aluminium, brass, bronze, granite, marble,
    concrete incl. wet, glass clear/frosted, water surface, pool tile) with the Three.js
    MeshPhysicalMaterial constants (roughness/metalness/ior/transmission/clearcoat/reflectivity);
    polished-stainless and water-surface match the spec exactly. `buildThreeMaterial` emits a renderer
    config.
  - **User customization supported** — [customLibrary.js](aquaflow/frontend/src/environment/customLibrary.js)
    saves/edits/deletes custom presets (localStorage with in-memory fallback), clamps values to the
    ranges, and enforces the **50 custom environment / 100 custom material** slot limits. New
    [EnvironmentMaterialPanel.jsx](aquaflow/frontend/src/components/panels/EnvironmentMaterialPanel.jsx)
    browses/edits/saves presets with a live PBR swatch, wired into `App.jsx` + the TopBar
    (Design → Environments & Materials).
  - Physics formulas ([formulas.js](aquaflow/frontend/src/environment/formulas.js)) — Fresnel/water
    reflection, wind-ripple amplitude, mist visibility, inverse-square attenuation, and the hard limits
    (wind 25 m/s cutoff, 8-surface reflection budget, HDR/texture resolutions, FPS targets).
  - **Verification: 18 vitest cases**
    ([materialLibrary.test.js](aquaflow/frontend/src/environment/__tests__/materialLibrary.test.js)) →
    frontend vitest now **137 passing** (was 119); **`npm run build` succeeds**. Frontend-only change.


- **AQ-X-015 Replace Old Hydraulic Engine — DONE on `main`.**
  - **geometry_service.py uses the new solver** — the old inline linear approximation
    (`turnover_rate_hint_hours = volume·1000 / (nozzles·5)`) is removed and replaced by a real
    hydraulic solve: `_solve_pool_hydraulics` builds a supply network (pump → manifold → per-nozzle
    demand branches) and solves it with [hydraulic_solver.solve_network](aquaflow/backend/services/hydraulic_solver.py),
    returning the real total design flow, a physically-correct pool turnover time, and the full solution
    (per-node pressure, per-pipe flow/velocity/head loss).
  - **phase9_routes.py uses the new solver** — the `/geometry/projects/{id}/export` endpoint now returns
    the real-solver hydraulics (via geometry_service), and a new `POST /geometry/hydraulics/solve`
    endpoint calls `solve_network` directly.
  - **Old incorrect hydraulic code removed** — the linear `len(nozzles)·5` turnover approximation is
    gone (only a docstring notes what it replaced).
  - **All existing tests still pass** — full backend pytest **282 passing** (unchanged; the acceptance's
    "108" baseline has since grown), no regressions from the replacement.
  - **New `validate_hydraulic` harness** — [validate_hydraulic.py](aquaflow/backend/validate_hydraulic.py)
    **18/18** cross-checks the solver's head loss against the **Hazen-Williams** (1.9017 m) and
    **Darcy-Weisbach** (1.6525 m) equations computed by hand, confirms geometry_service now returns a
    converged solver solution, and asserts the old approximation is gone. `validate_hydraulic_solver.py`
    still 26/26. Backend-only change; `npm run build` not applicable.


- **AQ-X-014 Backend API Frontend Integration — DONE on `main`.**
  - New shared [utils/apiClient.js](aquaflow/frontend/src/utils/apiClient.js) (`apiGet`/`apiPost`/
    `apiPostText`, error surfacing) behind three new panels wiring the built-but-unconnected engines to
    the UI.
  - **Engineering Tools** ([EngineeringToolsPanel.jsx](aquaflow/frontend/src/components/panels/EngineeringToolsPanel.jsx))
    — tabbed access to the hydraulic solver (`POST /api/hydraulics/solve`), pipe sizing
    (`/api/hydraulics/size` — the actual pipe-sizing endpoint), nozzle database (`GET /api/nozzles/models`
    + `POST /api/nozzles/query`), BOM generator (`POST /api/bom/generate` from the design fixtures),
    P&ID generator (`POST /api/pid/generate?format=svg`, rendered inline), energy model
    (`POST /api/energy/model`) and weather simulation (`POST /api/weather/simulate`).
  - **Mobile Monitoring** ([MobileMonitorPanel.jsx](aquaflow/frontend/src/components/panels/MobileMonitorPanel.jsx))
    — live snapshot + alerts with acknowledge (`GET /api/mobile/status|alerts`, `POST /api/mobile/alerts/ack`),
    polling every 4 s.
  - **Cloud Collaboration** ([CollaborationPanel.jsx](aquaflow/frontend/src/components/panels/CollaborationPanel.jsx))
    — open/join a shared document, apply a field edit, and view version/active-users/history
    (`/api/collab/open|join|edit`, `GET /api/collab/doc|users|history`).
  - All three wired into `App.jsx` + the TopBar (Design → Engineering Tools / Collaboration; Runtime →
    Mobile Monitoring).
  - **Verification:** every endpoint hit end-to-end with the exact panel payloads via FastAPI TestClient
    — hydraulics, pipe-sizing, nozzles, BOM, weather, energy, P&ID, mobile status/alerts/ack and collab
    all return 200; **4 vitest cases**
    ([apiClient.test.js](aquaflow/frontend/src/utils/__tests__/apiClient.test.js)) → frontend vitest
    **119 passing** (was 115); **`npm run build` succeeds**. Frontend-only change (backend pytest
    unaffected at 282).


- **AQ-X-013 Beat Detection Engine (recovery) — DONE on `main`.**
  - New [services/beat_detection.py](aquaflow/backend/services/beat_detection.py): a dependency-free
    (numpy-only) tempo/beat engine, independent of the heavy offline-only librosa path in the audio
    route.
  - **BPM detection works correctly** — an energy-flux onset envelope + weighted autocorrelation
    (octave-corrected toward the musical range via a log-tempo preference) estimates the tempo; verified
    against synthesised click tracks from 90–140 BPM (within ±2 BPM), with correct beat count/spacing and
    noise tolerance. A `generate_click_track` helper provides ground truth.
  - **Beat detection latency under 50 ms** — the streaming `LiveBeatDetector` processes one hop per call
    (default hop 512 @ 44.1 kHz ≈ 11.6 ms algorithmic latency) and reports each call's wall-clock time;
    steady-state per-frame processing is ~0.1 ms (median/p95 asserted < 50 ms).
  - **Works with live and recorded audio** — `detect_beats(samples, sr)` analyses a whole buffer;
    `LiveBeatDetector.push(frame)` handles a real-time stream frame by frame and locks onto the tempo
    (verified at 100 and 120 BPM).
  - API: `POST /api/beat/detect` (recorded buffer) and `GET /api/beat/demo` (self-test on a click track)
    ([beat_routes.py](aquaflow/backend/api/routes/beat_routes.py)), wired in main.py.
  - **Verification: 19/19** ([validate_beat_detection.py](aquaflow/backend/validate_beat_detection.py));
    **16 pytest cases** ([test_beat_detection.py](aquaflow/backend/tests/test_beat_detection.py)) →
    backend pytest now **282 passing** (was 266). Backend-only change; `npm run build` not applicable.


- **AQ-X-012 Wind Drift Calculation Engine (recovery) — DONE on `main`.**
  - New backend [services/wind_drift.py](aquaflow/backend/services/wind_drift.py) + mirrored frontend
    [weather/windDrift.js](aquaflow/frontend/src/weather/windDrift.js), building a safety layer on the
    AQ-S3-005 weather wind physics.
  - **Wind drift calculated from weather data** — per jet, drift = coupling · wind · flight-time (with a
    gust case), the downwind unit vector from the meteorological wind direction, and the landing +
    farthest-wet points.
  - **Safety zones updated in real-time** — `compute_safety_zones` recomputes each jet's wet zone
    (circle of splash radius around the drifted landing point) and the aggregate exclusion radius from
    the fountain centre on every weather change (pure O(n)); keep-clear and named-barrier breaches are
    detected with their overshoot.
  - **Operator warnings displayed** — `operator_warnings` emits severity-ranked warnings (keep-clear /
    barrier / gust breach, high & moderate wind); the new
    [WindDriftPanel.jsx](aquaflow/frontend/src/components/panels/WindDriftPanel.jsx) shows them live with
    a top-down exclusion-zone map and wind arrow, driven by live wind/keep-clear sliders, wired into
    `App.jsx` and the TopBar (Runtime → Wind Drift Safety).
  - API: `POST /api/wind/drift` ([wind_routes.py](aquaflow/backend/api/routes/wind_routes.py)), wired in
    main.py.
  - **Verification: backend 22/22** ([validate_wind_drift.py](aquaflow/backend/validate_wind_drift.py),
    every zone/warning cross-checked against hand physics) + **13 pytest cases**
    ([test_wind_drift.py](aquaflow/backend/tests/test_wind_drift.py)) → backend pytest **266 passing**
    (was 253); **13 vitest cases**
    ([windDrift.test.js](aquaflow/frontend/src/weather/__tests__/windDrift.test.js)) → frontend vitest
    **115 passing** (was 102); **`npm run build` succeeds**.


- **AQ-X-011 Real-Time Validation Display (recovery) — DONE on `main`.**
  - New pure engine [validation/liveValidation.js](aquaflow/frontend/src/validation/liveValidation.js):
    `validateSystem(state)` returns a prioritised list of errors/warnings from the current fixtures +
    optional live safety status — fixture identity (duplicate/missing id), value ranges (DMX
    channel 1–512, universe 0–32767, intensity 0–1), placement completeness, dependency-graph
    conflicts (address clash / cycle / SPOF / orphan, reusing AQ-X-008), and safety (E-stop, no-permit,
    hardware conflicts, PLC loss). Every result carries a **target fixture id** and the call measures its
    own `durationMs` / `withinLatencyBudget`.
  - **Real-time validation shown in UI** — new
    [RealtimeValidationPanel.jsx](aquaflow/frontend/src/components/panels/RealtimeValidationPanel.jsx)
    re-validates via `useMemo` on every fixture change (synchronous, no network) and lists results live
    with a status pill and a latency badge; wired into `App.jsx` and the TopBar (Runtime → Live
    Validation).
  - **Errors highlighted immediately** — each error is rendered red with its offending fixture id and is
    clickable to jump/select it; warnings amber. Updates instantly as the design changes.
  - **Performance within 100 ms latency** — validation is O(n) and local; a 500-fixture design validates
    well under budget (measured `durationMs` **and** wall-clock asserted < 100 ms in tests).
  - **Verification: 14 vitest cases**
    ([liveValidation.test.js](aquaflow/frontend/src/validation/__tests__/liveValidation.test.js)) →
    frontend vitest now **102 passing** (was 88); **`npm run build` succeeds**. Frontend-only change.


- **AQ-X-010 Engineering Package Export (recovery) — DONE on `main`.**
  - New [services/engineering_package.py](aquaflow/backend/services/engineering_package.py): the
    capstone that aggregates every engineering generator into one downloadable ZIP.
  - **Full engineering package exported** — `build_package(design)` returns a valid ZIP containing the
    CAD layout (DXF), Bill of Materials (XLSX, via the AQ-S2-009 generator), P&ID drawing (SVG, via the
    AQ-S2-007 generator), equipment dependency graph + hydraulic-solver results (JSON), a README, a
    cover-sheet PDF, and a manifest.
  - **All required documents included** — a fixed `REQUIRED_DOCUMENTS` set is always present; the
    manifest lists every document with its format, byte size and SHA-256, and reports `complete` /
    `missing_documents`. Each generator is wrapped so a bad input degrades gracefully without breaking
    the package.
  - **PDF and DXF formats supported** — a **dependency-free, hand-built PDF writer** (`build_pdf`)
    produces a valid cover sheet (%PDF header, uncompressed content stream, byte-accurate xref, trailer,
    %%EOF) alongside the R12 DXF layout; no reportlab/CAD engine required. Formats: pdf, dxf, xlsx, svg,
    json, txt.
  - API: `POST /api/engineering/package` (manifest JSON) and `POST /api/engineering/package.zip`
    (download) ([engineering_routes.py](aquaflow/backend/api/routes/engineering_routes.py)), wired in
    main.py.
  - **Verification: 26/26** ([validate_engineering_package.py](aquaflow/backend/validate_engineering_package.py));
    **14 pytest cases** ([test_engineering_package.py](aquaflow/backend/tests/test_engineering_package.py)) →
    backend pytest now **253 passing** (was 239). Backend-only change; `npm run build` not applicable.


- **AQ-X-009 CAD Layout Generator (recovery) — DONE on `main`.**
  - New [services/cad_layout.py](aquaflow/backend/services/cad_layout.py): exports a pool design to a
    dependency-free, standards-compliant **AutoCAD R12 (AC1009) ASCII DXF**.
  - **DXF/DWG export supported** — emits valid DXF (HEADER/TABLES/ENTITIES + EOF) with no external CAD
    engine; DXF is the vendor-neutral exchange format every DWG application (AutoCAD/BricsCAD/DraftSight)
    imports, so the payload documents DWG compatibility and serves the file as `.dxf`.
  - **Layout accurate to design** — fixture circles are centred on the exact design coordinates
    (metres), the pool boundary (rectangular/circular/elliptical/freeform) matches the pool parameters,
    pipework connects fixtures, an overall-width dimension is drawn, and `$INSUNITS` = metres.
  - **Layer structure correct** — a proper LAYER table (POOL_OUTLINE, WATER_SURFACE, NOZZLES, LIGHTS,
    PIPEWORK, EQUIPMENT, MEASUREMENTS, ANNOTATIONS) each with its ACI colour, and every entity assigned
    to the right layer by fixture type (nozzles→NOZZLES, lights→LIGHTS, pumps/valves→EQUIPMENT,
    labels→ANNOTATIONS, dimensions→MEASUREMENTS).
  - API: `POST /api/cad/layout` (JSON) and `POST /api/cad/layout.dxf` (file download)
    ([cad_routes.py](aquaflow/backend/api/routes/cad_routes.py)), wired in main.py.
  - **Verification: 26/26** ([validate_cad_layout.py](aquaflow/backend/validate_cad_layout.py) — the DXF
    is parsed back and every coordinate/layer checked); **21 pytest cases**
    ([test_cad_layout.py](aquaflow/backend/tests/test_cad_layout.py)) → backend pytest now
    **239 passing** (was 218). Backend-only change; `npm run build` not applicable.


- **AQ-X-008 Equipment Dependency Graph (recovery) — DONE on `main`.**
  - **Dependency graph generated from system data** — new
    [services/dependency_graph.py](aquaflow/backend/services/dependency_graph.py) and the mirrored
    frontend [dependency/dependencyGraph.js](aquaflow/frontend/src/dependency/dependencyGraph.js) turn
    designed fixtures into a directed graph: fixture / control-group / PLC-host / DMX-universe nodes,
    with `member_of`, `controlled_by` and explicit `depends_on` edges; nodes carry a `layer` for layout.
  - **Visual representation in UI** — new
    [DependencyGraphPanel.jsx](aquaflow/frontend/src/components/panels/DependencyGraphPanel.jsx) renders
    the graph as an SVG (nodes coloured by kind, edges by relationship, conflicts highlighted red) with
    a legend + conflict list, wired into `App.jsx` and the TopBar (Devices → Dependencies).
  - **Dependency conflicts flagged** — duplicate DMX/Modbus addresses (critical), dangling
    dependencies, circular dependencies (DFS, no false positives on a DAG), single points of failure
    (one controller ≥ N devices, warning), and orphaned equipment; a clean design flags nothing.
  - API: `POST /api/dependencies/graph`
    ([dependency_routes.py](aquaflow/backend/api/routes/dependency_routes.py)), wired in main.py.
  - **Verification: backend 17/17** ([validate_dependency_graph.py](aquaflow/backend/validate_dependency_graph.py))
    + **13 pytest cases** ([test_dependency_graph.py](aquaflow/backend/tests/test_dependency_graph.py)) →
    backend pytest **218 passing** (was 205); **14 vitest cases**
    ([dependencyGraph.test.js](aquaflow/frontend/src/dependency/__tests__/dependencyGraph.test.js)) →
    frontend vitest **88 passing** (was 74); **`npm run build` succeeds**.


- **AQ-X-007 Valve Authority Engine (recovery) — DONE on `main`.**
  - New [services/valve_authority.py](aquaflow/backend/services/valve_authority.py): control-valve
    authority for modulating flow control.
  - **Valve authority calculated correctly** — β = ΔP_valve(open)/(ΔP_valve+ΔP_rest) at design flow,
    the Kv relation Q=Kv·√(ΔP/SG) (both directions), authority classification (good ≥0.5 / acceptable
    ≥0.25 / poor), and the standard installed-characteristic distortion
    q(φ)=φ/√(β+(1−β)·φ²) with linear / equal-percentage / quick-opening inherent curves.
  - **Flow control recommendations generated** — `recommend` rates the authority, picks the inherent
    characteristic whose installed curve is closest to linear (equal-% for lower authority), flags an
    oversized valve, and computes the target Kv / valve ΔP to reach good authority.
  - **Integration with hydraulic solver verified** — `kv_to_minor_loss` converts a valve Kv into the
    solver's dimensionless minor-loss K, so a valve drops into a network as a pipe; `authority_from_network`
    runs [hydraulic_solver](aquaflow/backend/services/hydraulic_solver.py) and derives β from the solved
    head losses. Cross-checked: the solver's valve head loss equals the Kv formula at the solved flow
    (10.9383 m both ways), and a larger Kv correctly gives lower authority.
  - API: `POST /api/valves/authority`, `POST /api/valves/authority-network`
    ([valve_routes.py](aquaflow/backend/api/routes/valve_routes.py)), wired in main.py.
  - **Verification: 27/27** ([validate_valve_authority.py](aquaflow/backend/validate_valve_authority.py));
    **19 pytest cases** ([test_valve_authority.py](aquaflow/backend/tests/test_valve_authority.py)) →
    backend pytest now **205 passing** (was 186). Backend-only change; `npm run build` not applicable.


- **AQ-X-006 Pump Curve Engine (recovery) — DONE on `main`.**
  - New [services/pump_curve.py](aquaflow/backend/services/pump_curve.py): proper centrifugal-pump
    hydraulics (SI units) — a real advance over the linear approximations flagged in the known issues.
  - **Pump curve data integrated** — `PumpCurve.from_points` least-squares fits manufacturer H–Q (and
    optional efficiency) points to a quadratic characteristic H(Q)=c0+c1·Q+c2·Q²; a built-in
    `PUMP_CATALOG` (small/medium/large fountain pumps) ships real H–Q data; `flow_at_head` inverts the
    curve; `max_flow`/`shutoff_head` derived.
  - **Operating point calculation correct** — `operating_point` finds the true intersection of the
    pump curve and the system curve (H_sys=static+k·Q²) by a robust bracketed root find, returns the
    duty flow/head with hydraulic + shaft power and efficiency, and reports no-duty when the pump can't
    overcome the static head. Cross-checked against hand-solved algebra (Q=0.1 m³/s, H=40 m).
  - **Multiple pump configurations supported** — `PumpSystem` handles pumps in **parallel** (flows add
    at equal head, split reported per pump) and **series** (heads add at equal flow), and `at_speed`
    scales a curve by the **affinity laws** (Q∝N, H∝N², P∝N³).
  - API: `GET /api/pumps/catalog`, `POST /api/pumps/operating-point`
    ([pump_routes.py](aquaflow/backend/api/routes/pump_routes.py)), wired in main.py.
  - **Verification: 23/23** ([validate_pump_curve.py](aquaflow/backend/validate_pump_curve.py), every
    duty point cross-checked against algebra); **17 pytest cases**
    ([test_pump_curve.py](aquaflow/backend/tests/test_pump_curve.py)) → backend pytest now
    **186 passing** (was 169). Backend-only change; `npm run build` not applicable.


- **AQ-X-005 Fault Alerting and Maintenance Log (recovery) — DONE on `main`.**
  - New [services/fault_alerting.py](aquaflow/backend/services/fault_alerting.py): the authoritative,
    stateful fault-alert engine on top of the mobile monitor's alert *derivation*.
  - **Fault alerts trigger correctly** — `raise_fault`/`clear_fault`/`acknowledge` manage a
    de-duplicated store (re-raises count occurrences and bump severity; a cleared alert reopens), and
    `ingest_status` folds the live safety-kernel conditions (via the shared `evaluate_alerts`) so real
    faults raise alerts and resolved conditions clear.
  - **Maintenance log persists** — a `MaintenanceLog` appends every raise/recur/acknowledge/clear/
    escalation plus explicit maintenance actions (component, performed-by, downtime, notes) to a JSON
    file on disk that reloads on startup, so the history survives a restart.
  - **Alert escalation** — an unacknowledged alert escalates through tiers over time
    (operator → supervisor after 60 s → on-call after 300 s, which forces critical), and a persistently
    recurring fault escalates on occurrence count; acknowledging freezes escalation. Escalation events
    are logged. Clock-injectable (`now` passed in) so escalation is deterministic.
  - API: `GET /api/faults/alerts|summary|maintenance-log`, `POST /api/faults/raise|ingest|
    maintenance-log`, `POST /api/faults/{code}/acknowledge|clear`
    ([fault_routes.py](aquaflow/backend/api/routes/fault_routes.py)), wired in main.py.
  - **Verification: 20/20** ([validate_fault_alerting.py](aquaflow/backend/validate_fault_alerting.py));
    **11 pytest cases** ([test_fault_alerting.py](aquaflow/backend/tests/test_fault_alerting.py)) →
    backend pytest now **169 passing** (was 158). Backend-only change; `npm run build` not applicable.


- **AQ-X-004 Cue Stack and Scene Recall (recovery) — DONE on `main`.**
  - New [services/cue_engine.py](aquaflow/backend/services/cue_engine.py): the theatrical playback
    model on top of the timeline — `Scene` (a named snapshot of per-target levels), `Cue` (a numbered
    step: scene + fade time), `CueStack` (ordered cues + live playhead + crossfade engine), and
    `CueStackManager` (many independent stacks).
  - **Cue stack saves and recalls correctly** — GO / GO-TO / BACK / RELEASE drive the playhead; when a
    fade completes the output equals the target scene exactly (`recalled_values`). Everything
    round-trips through `to_dict`/`from_dict` for persistence (cues, scenes, numbers, fade times).
  - **Scene transitions smooth** — `crossfade` interpolates every target between the current look and
    the cue's scene (targets present on only one side fade to/from 0, so nothing snaps); linear +
    smoothstep/ease-in/ease-out curves, exact endpoints and midpoint, verified monotonic.
  - **Multiple cue stacks supported** — the manager holds any number of named stacks that run
    independently (a GO on one never affects another); the whole manager round-trips too.
  - Clock-injectable (every time-dependent call takes an explicit `now`) so fades are deterministic
    and unit-testable without sleeping. A `scene_values_from_commands` helper captures a live look
    from emitted output.
  - API: `POST/GET /api/cues/stacks`, `POST /api/cues/stacks/{id}/cues|go|go-to|back|release`,
    `GET /api/cues/stacks/{id}/output` ([cue_routes.py](aquaflow/backend/api/routes/cue_routes.py)),
    wired in main.py.
  - **Verification: 20/20** ([validate_cue_engine.py](aquaflow/backend/validate_cue_engine.py));
    **14 pytest cases** ([test_cue_engine.py](aquaflow/backend/tests/test_cue_engine.py)) → backend
    pytest now **158 passing** (was 144). Backend-only change; `npm run build` not applicable.


- **AQ-X-003 Compile and Deploy Bundle (recovery) — DONE on `main`.**
  - **luxshow_compiler produces a valid bundle** — new `load_luxshow`
    ([luxshow_compiler.py](aquaflow/backend/services/luxshow_compiler.py)) opens and VERIFIES a
    `.luxshow`: ZIP integrity, all required members present, and every manifest checksum matching the
    SHA-256 of the member it covers (tampering/corruption is rejected before a show reaches hardware).
    **Bug fixed:** on Windows the packager wrote bundle files with `\n`→`\r\n` translation while the
    checksums were computed on the `\n` strings, so every Windows-compiled bundle failed its own
    checksum. Files are now written with `newline=""` so on-disk bytes match the hashed content.
  - **runtime_exporter works end-to-end** — export → `persist_compiled_artifacts` → reload
    (`load_bundle_manifest`/`load_bundle_artifact`) → verify internal consistency: canonical
    `compile.validated`, the deployment-bundle checksum equals the canonical signature, and the
    persisted `RuntimeSession` revalidates against its contract.
  - **On-site playback verified** — new [services/deploy_verifier.py](aquaflow/backend/services/deploy_verifier.py)
    adapts a compiled bundle (`bundle_to_playable_show`, ms→seconds) and runs it on the real
    `ShowEngine` (load→play→tick→stop): the playhead advances, timeline clips are emitted, and the
    pump clip reaches the output at intensity 0.8.
  - API: `GET /api/deploy/verify` (full compile→export→playback report with `deploy_ready`),
    `POST /api/deploy/verify-bundle` ([deploy_routes.py](aquaflow/backend/api/routes/deploy_routes.py)),
    wired in main.py.
  - **Verification: 17/17** ([validate_deploy_bundle.py](aquaflow/backend/validate_deploy_bundle.py),
    `deploy_ready: True`, incl. a tamper-detection check); **8 pytest cases**
    ([test_deploy_bundle.py](aquaflow/backend/tests/test_deploy_bundle.py)) → backend pytest now
    **144 passing** (was 136). Backend-only change; `npm run build` not applicable.


- **AQ-X-002 Hardware Output Verification (CRITICAL) — DONE on `main`.**
  - New [services/hardware_verifier.py](aquaflow/backend/services/hardware_verifier.py): a
    `VirtualDMXNode` — a real UDP receiver on 127.0.0.1 that stands in for a DMX/Art-Net/sACN
    fixture node — plus a verification engine that drives the production drivers and decodes the
    frames that actually leave the socket.
  - **DMX + Art-Net output verified** — commanded channels arrive intact and decode to spec, incl.
    15-bit universes (> 255) surviving the net/sub/low split. New `parse_artdmx`/`extract_artnet_dmx`
    ([artnet_driver.py](aquaflow/backend/protocols/artnet_driver.py)) round-trip `build_artdmx`.
  - **Art-Net + sACN output verified** — `parse_sacn_packet`
    ([sacn_driver.py](aquaflow/backend/protocols/sacn_driver.py)) round-trips `build_sacn_packet`;
    E1.31 frames verified on the wire via unicast loopback.
  - **Safety gate tested on hardware** — routed a real lighting command through the ProtocolBus
    output-path gate to a loopback node: no permit ⇒ **all** emitted channels are zero, permit ⇒ the
    commanded value reaches the wire. This surfaced and fixed a real safety bug — the gate scaled the
    master/dimmer but not the R/G/B colour channels, so a fixture with no dimmer channel would still
    emit light without a permit. Colour channels are now scaled by the gated intensity
    ([protocol_bus.py](aquaflow/backend/engine/protocol_bus.py)).
  - **Output timing verified within spec** — the transmit cadence stays within the Art-Net 44 Hz
    ceiling and respects the ~22.7 ms DMX512 physical frame floor (`analyze_timing`).
  - API: `GET /api/hardware/verify` (runs the suite, returns a `deployment_ready` report),
    `GET /api/hardware/spec` ([hardware_routes.py](aquaflow/backend/api/routes/hardware_routes.py)),
    wired in main.py.
  - **Verification: 20/20** ([validate_hardware_output.py](aquaflow/backend/validate_hardware_output.py),
    `deployment_ready: True`, 5/5 live loopback checks pass); **19 pytest cases**
    ([test_hardware_output.py](aquaflow/backend/tests/test_hardware_output.py)) → backend pytest now
    **136 passing** (was 117). Backend-only change; `npm run build` not applicable.


- **AQ-X-001 Automatic DMX Address Assignment (recovery) — DONE on `main`.**
  - New [services/dmx_assigner.py](aquaflow/backend/services/dmx_assigner.py): the conflict-free DMX
    allocator that turns a set of fixtures into concrete (universe, channel) addresses.
  - **Auto-assignment for all fixture types** — a profile/type → channel-width map (`channels_for`)
    sizes dimmers, RGB/RGBW/RGBA, moving heads, lasers, fog/haze, pixel bars, etc.; unknown fixtures
    fall back through a type-token guess to a safe default of 1.
  - **Conflict-free allocation** — a channel-occupancy grid reserves every used slot, unlocked
    fixtures are first-fit packed into the free gaps, universes roll at 512, and no two fixtures ever
    share a channel; genuine overlaps are reported rather than silently overwritten.
  - **Manual override** — any fixture with an explicit universe+channel (or `locked`) keeps its
    address; everything else packs *around* it. This closes the prior gap where
    `DeviceRegistry.auto_assign_dmx` packed from channel 1 and could land on top of a manually-pinned
    fixture. `auto_assign_dmx` now reserves already-registered DMX devices before packing, so the
    fixture-bridge path is conflict-free with manual addresses.
  - API: `POST /api/dmx/auto-assign`, `GET /api/dmx/profiles`
    ([dmx_routes.py](aquaflow/backend/api/routes/dmx_routes.py)), wired in main.py.
  - **Verification: 24/24** ([validate_dmx_assigner.py](aquaflow/backend/validate_dmx_assigner.py));
    **9 pytest cases** ([test_dmx_assigner.py](aquaflow/backend/tests/test_dmx_assigner.py)) →
    backend pytest now **117 passing**. Backend-only change; `npm run build` not applicable.


- **AQ-S3-010 Cloud Collaboration System — DONE on `main` (Stage 3).**
  - New [services/collaboration.py](aquaflow/backend/services/collaboration.py): shared show documents
    with optimistic concurrency (`CollabDocument` + `CollaborationHub`).
  - **Multi-user editing** — users join with presence + cursors; each edit is a dot-path field patch
    applied against the base version the user last saw; concurrent edits to different fields merge.
  - **Version history** — every applied change creates an immutable version (author, ts, message,
    snapshot, changed paths); inspect any version and `revert` to it (itself a new version).
  - **Conflict resolution** — three-way, field-level merge: patches to fields nobody else changed
    since base auto-merge; a field changed to a different value returns a conflict (base/mine/theirs);
    same-value edits are idempotent; `resolve_conflicts` force-applies the chosen values. Partial
    merges apply the clean fields and conflict only the rest.
  - API: `POST /api/collab/open|join|leave|cursor|edit|resolve|revert`, `GET /doc|history|users/{id}`
    ([collab_routes.py](aquaflow/backend/api/routes/collab_routes.py)), wired in main.py.
  - **Verification: 18/18** ([validate_collaboration.py](aquaflow/backend/validate_collaboration.py));
    **9 pytest cases** ([test_collaboration.py](aquaflow/backend/tests/test_collaboration.py)) → backend pytest now **108 passing**.

- **AQ-S3-009 Mobile Monitoring App — DONE on `main` (Stage 3).**
  - New [services/mobile_monitor.py](aquaflow/backend/services/mobile_monitor.py): turns the operator
    status into a phone-friendly monitoring feed, raises alerts, and gates remote commands.
  - **Live monitoring** — `build_snapshot(status)` condenses safety/transport/engine into a compact
    payload (health = estop/critical/warning/live/idle, playing, progress %, permit, fault count,
    per-subsystem enables, PLC online).
  - **Alerts** — `evaluate_alerts` derives prioritized alerts (E-stop, critical faults, hardware
    conflicts → critical; PLC comm loss → warning) and an `AlertManager` de-duplicates by code,
    tracks acknowledge, clears resolved conditions, and sorts critical-first.
  - **Remote control** — `validate_remote_command(cmd, status)` only allows commands the safety
    state permits (E-stop/stop always allowed; play blocked on hardware conflict / no permit / E-stop,
    tying into AQ-S1-003 + AQ-S1-007).
  - API: `GET /api/mobile/status|alerts`, `POST /api/mobile/command|alerts/ack`
    ([mobile_routes.py](aquaflow/backend/api/routes/mobile_routes.py)), wired in main.py; commands
    dispatch to the live safety/transport singletons.
  - **Verification: 25/25** ([validate_mobile_monitor.py](aquaflow/backend/validate_mobile_monitor.py));
    **7 pytest cases** ([test_mobile_monitor.py](aquaflow/backend/tests/test_mobile_monitor.py)) → backend pytest now **99 passing**.

- **AQ-S3-007 4K Video Export Engine — DONE on `main` (Stage 3).**
  - New testable engine [frontend/src/video/videoExport.js](aquaflow/frontend/src/video/videoExport.js)
    — pure, framework-agnostic export config + A/V sync:
    - **4K supported** — resolution presets incl. 4K UHD (3840×2160), `is4K`, custom `{w,h}`.
    - **60 FPS supported** — framerate presets (24/30/60), `frameCount`/`frameDurationMs`, and a
      resolution×fps bitrate estimate; `buildExportConfig` carries fps + bitrate + frame count.
    - **Audio synchronized** — `audioVideoSync` (A/V offset, in-tolerance flag, correction, latency)
      and `combineStreams` to mux a canvas video stream with an audio stream; MIME selection.
  - Wired into [FountainScene_v6.js](aquaflow/frontend/src/components/preview/FountainScene_v6.js):
    `startRecording({resolution,fps,audioStream})` renders at the export resolution (true 4K), sets
    fps + bitrate + MIME, and muxes audio; restores the preview size on stop. PreviewPanel adds
    resolution + fps selectors on the record button.
  - **Verification: 15 vitest cases**
    ([videoExport.test.js](aquaflow/frontend/src/video/__tests__/videoExport.test.js)) → frontend
    vitest now **74 passing**; `npm run build` clean.

- **AQ-S3-006 VR Walkthrough Mode — DONE on `main` (Stage 3).**
  - New testable engine [frontend/src/walkthrough/](aquaflow/frontend/src/walkthrough) — pure,
    framework-agnostic:
    - **Navigation supported** — `navigation.js`: first-person movement (`firstPersonStep` with
      heading + bounds clamp), waypoint-path interpolation for tours, look-at yaw, `NAV_MODES`.
    - **VR mode supported** — `vrMode.js`: WebXR capability detection (`isVRSupported`) + immersive-vr
      session options; `FountainScene` gained `renderer.xr.enabled`, `supportsVR()`, `enterVR()`,
      `exitVR()` (real WebXR session, headset-driven camera).
    - **Client presentation mode supported** — `presentationMode.js`: a scripted, auto-advancing,
      captioned cinematic tour (`DEFAULT_TOUR`, `tourStepAt`, looped). `FountainScene.startPresentation`
      cycles cinematic cameras + captions; PreviewPanel adds Present (fullscreen + caption overlay) and
      Enter-VR buttons.
  - Wired into [FountainScene_v6.js](aquaflow/frontend/src/components/preview/FountainScene_v6.js) and
    [PreviewPanel_v5.jsx](aquaflow/frontend/src/components/preview/PreviewPanel_v5.jsx).
  - **Verification: 19 vitest cases**
    ([walkthrough.test.js](aquaflow/frontend/src/walkthrough/__tests__/walkthrough.test.js)) →
    frontend vitest now **59 passing**; `npm run build` clean.

- **AQ-S3-005 Weather Simulation Engine — DONE on `main` (Stage 3).**
  - New [services/weather_engine.py](aquaflow/backend/services/weather_engine.py): computes the three
    weather effects on an outdoor show from ambient conditions.
  - **Wind simulated** — wind vector (from-direction → blows-toward), per-jet horizontal drift over
    flight time (`drift = coupling·wind·2√(2h/g)`), downwind landing offset, growing splash radius,
    gust drift, and a wind advisory.
  - **Evaporation estimated** — standard mass-transfer Θ model `E = (25+19v)·A·(x_s−x_air)` with
    Tetens saturation pressure + humidity ratios; reported as kg/h, L/day, and mm/day (verified
    ~0.3–0.6 kg/m²/h, zero at saturation).
  - **Visibility impact calculated** — Koschmieder visual range `V = 3.912/β` (β from condition +
    humidity + fountain spray) plus a show-clarity score from contrast transmission over the viewing
    distance (excellent on a clear night, poor in fog), and a show-suitability advisory.
  - API: `POST /api/weather/simulate` ([weather_routes.py](aquaflow/backend/api/routes/weather_routes.py)),
    wired in main.py.
  - **Verification: 25/25** ([validate_weather_engine.py](aquaflow/backend/validate_weather_engine.py))
    vs independent hand calcs; **11 pytest cases**
    ([test_weather_engine.py](aquaflow/backend/tests/test_weather_engine.py)) → backend pytest now **92 passing**.

- **AQ-S3-004 Photorealistic Rendering Engine — DONE on `main` (Stage 3).**
  - New testable engine under [frontend/src/rendering/](aquaflow/frontend/src/rendering) — pure,
    framework-agnostic, and the single source of truth for the 3D preview:
    - **Water physics rendered** — `waterPhysics.js`: projectile droplet trajectories (`dropletPosition`,
      `simulateJet`), apex height, time-of-flight, launch velocity from jet height. The scene's
      `GPUParticleSystem` gravity is now sourced from the engine (`RE_GRAVITY`).
    - **Reflections rendered** — `reflections.js`: water-surface mirror matrix + `reflectPoint`, and
      Schlick **Fresnel** reflectance (near-mirror at grazing angles, ~2% looking straight down).
    - **Night scenes supported** — `sceneModes.js`: day/dusk/night/arena presets (dark sky, low
      ambient, starfield, stronger bloom/fixture-glow for night); `FountainScene.ENVIRONMENTS` is now
      sourced from the engine.
    - `index.js`: `buildRenderConfig()` aggregates scene mode + reflection + per-jet water physics
      into one renderer-agnostic config.
  - Wired into [FountainScene_v6.js](aquaflow/frontend/src/components/preview/FountainScene_v6.js)
    (imports `ENVIRONMENTS` + `GRAVITY` from the engine).
  - **Verification: 16 vitest cases**
    ([renderingEngine.test.js](aquaflow/frontend/src/rendering/__tests__/renderingEngine.test.js)) vs
    hand calcs → frontend vitest now **40 passing**; `npm run build` clean (116 modules).

- **AQ-S3-003 AI Choreography Engine — DONE on `main` (Stage 3).**
  - New [services/choreography_engine.py](aquaflow/backend/services/choreography_engine.py): builds a
    full show timeline from a prompt + the *designed fixtures*, and revises an existing show from a
    follow-up prompt.
  - **Full timelines generated** — multi-track (pump/lighting + requested effects) over a mood-shaped
    arc; pump track covers the whole duration; output loads into a real `ShowEngine` and plays.
  - **Fixture constraints respected** — only choreographs track types with fixtures present (a prompt
    asking for fire with no flame fixture is skipped + warned); clip intensity clamped to each
    fixture's `maxIntensity`; flame bursts never exceed the hardware max on-time (`FLAME_MAX_ON_TIME`,
    with cooldown gaps).
  - **Prompt revisions supported** — `revise_show` applies calmer/energetic intensity scaling,
    add/remove effect tracks (honouring fixtures — can't add a laser with no laser fixture), and
    tempo changes, with a revision history.
  - API: `POST /api/choreography/generate` + `/revise`
    ([choreography_routes.py](aquaflow/backend/api/routes/choreography_routes.py)), wired in main.py.
  - **Verification: 22/22** ([validate_choreography_engine.py](aquaflow/backend/validate_choreography_engine.py))
    incl. real ShowEngine playback; **8 pytest cases**
    ([test_choreography_engine.py](aquaflow/backend/tests/test_choreography_engine.py)) → backend pytest now **81 passing**.

- **AQ-S3-001 AI Show Generator — DONE on `main` (Stage 3).**
  - New [services/ai_show_generator.py](aquaflow/backend/services/ai_show_generator.py): interprets a
    natural-language prompt into a `ShowIntent` (mood, energy, tempo, duration, effects, palette,
    name) and generates a timeline over a mood-shaped energy arc.
  - **Supports text prompts** — extracts effects (flame/fog/laser/lighting/water incl. negation like
    "no fire"), explicit BPM/duration, and a show name from free text; deterministic (seeded).
  - **Supports mood descriptions** — a mood lexicon maps phrases ("serene zen" → calm, "high-energy
    party" → energetic, "romantic wedding" → romantic, "epic cinematic" → dramatic, mysterious,
    patriotic); mood sets energy, tempo, palette, and effect emphasis.
  - **Generates playable timelines** — output is the canonical show payload (`{show, timelineTracks}`)
    that **loads into a real `ShowEngine` and drives clips during playback** (proven in the harness).
  - API: `POST /api/ai-show/generate` + `/interpret`, `GET /api/ai-show/moods`
    ([ai_show_routes.py](aquaflow/backend/api/routes/ai_show_routes.py)), wired in main.py.
  - **Verification: 22/22** ([validate_ai_show_generator.py](aquaflow/backend/validate_ai_show_generator.py))
    incl. a real ShowEngine load→play→tick; **7 pytest cases**
    ([test_ai_show_generator.py](aquaflow/backend/tests/test_ai_show_generator.py)) → backend pytest now **73 passing**.

- **AQ-S2-013 Energy Consumption Modelling — DONE on `main` (Stage 2).**
  - New [services/energy_model.py](aquaflow/backend/services/energy_model.py): builds a load model
    (each load has power, schedule/duty or a 24-h profile) and evaluates it against a tariff.
  - **kWh calculated** — per-load and total daily/monthly/annual energy (`E = P·hours·duty`, or
    `P·Σprofile`).
  - **Annual operating cost generated** — energy charge + demand charge (peak·$/kW/mo·12) +
    standing charge, plus annual CO₂.
  - **Peak demand calculated** — maximum *coincident* load across the 24-h day: overlapping loads
    sum, non-coincident profiles take the max (not the sum); optional simultaneity factor. Also
    reports connected load, load factor, diversity factor.
  - Pulls loads straight from fixture `electrical.powerW` (AQ-S2-011) via `model_from_fixtures`.
    API: `POST /api/energy/model` and `/from-fixtures`
    ([energy_routes.py](aquaflow/backend/api/routes/energy_routes.py)), wired in main.py.
  - **Verification: 17/17** ([validate_energy_model.py](aquaflow/backend/validate_energy_model.py))
    against independent hand-calcs; **8 pytest cases**
    ([test_energy_model.py](aquaflow/backend/tests/test_energy_model.py)) → backend pytest now **66 passing**.

- **AQ-S2-011 Fixture Library Expansion — DONE on `main` (Stage 2).**
  - Deterministic generator [tools/generate_fixture_library.py](aquaflow/tools/generate_fixture_library.py)
    emits **524 fixtures** across 16 categories (jets/nozzles, lights, pumps, valves, flame, fog,
    laser, sensors, controls, power, filtration, air, water treatment, effects, motion, safety) to
    [fixture_library_expanded.json](aquaflow/frontend/src/data/fixture_library_expanded.json).
  - **Minimum 500 fixtures** — merged `FIXTURE_LIBRARY` (curated + generated) = **596**
    ([fixtureLibrary.js](aquaflow/frontend/src/data/fixtureLibrary.js) normalizes both sets).
  - **Hydraulic metadata** on every fixture (flow, pressure, jet height, nozzle dia, connection
    size, K factor Q=K√P) and **electrical metadata** on every fixture (voltage, power, computed
    current, phase, control protocol, DMX channels, IP rating).
  - **Verification: 7/7** ([tools/validate_fixture_library.py](aquaflow/tools/validate_fixture_library.py))
    + **7 vitest cases** ([data/__tests__/fixtureLibrary.test.js](aquaflow/frontend/src/data/__tests__/fixtureLibrary.test.js))
    → frontend vitest now **24 passing**; production build clean.

- **AQ-S2-009 Automatic BOM Generator — DONE on `main` (Stage 2).**
  - New [services/bom_generator.py](aquaflow/backend/services/bom_generator.py): rolls a design
    (equipment, pipes, nozzles, valves, fittings, instruments — or a hydraulic network) into a
    costed bill of materials.
  - **Quantities generated automatically** — identical items counted, pipe runs summed by
    diameter/material, nozzles grouped by model.
  - **Supplier references supported** — each line enriched with manufacturer / part number /
    supplier / unit cost from [data/parts_catalog.json](aquaflow/backend/data/parts_catalog.json)
    + the nozzle DB; per-line and category cost roll-ups.
  - **Excel export supported** — a **self-contained minimal XLSX writer** (zip of OOXML, no runtime
    dependency) plus CSV/JSON; the `.xlsx` reads back cleanly in openpyxl (independent verifier).
  - API: `POST /api/bom/generate` and `/from-network` (`?format=json|csv|xlsx`, xlsx downloads)
    ([bom_routes.py](aquaflow/backend/api/routes/bom_routes.py)), wired in main.py.
  - **Verification: 19/19** ([validate_bom_generator.py](aquaflow/backend/validate_bom_generator.py))
    incl. openpyxl read-back and hand-calc totals; **8 pytest cases**
    ([test_bom_generator.py](aquaflow/backend/tests/test_bom_generator.py)) → backend pytest now **58 passing**.

- **AQ-S2-007 Automatic P&ID Generator — DONE on `main` (Stage 2).**
  - New [services/pid_generator.py](aquaflow/backend/services/pid_generator.py): builds a printable
    P&ID from an equipment model or straight from a hydraulic network.
  - **Generates ISA symbols automatically** — each equipment/instrument type maps to a standard
    ISA-5.1 symbol (centrifugal pump, valve bow-tie, vessel/reservoir, nozzle, instrument balloons
    PT/FT/LT/…) with no manual drawing; type aliases normalized automatically.
  - **Produces printable output** — well-formed **SVG** (validated as XML) with drawing border +
    title block, plus a **print-ready HTML** wrapper (`@page` A3, `@media print`, `window.print()`).
  - **Supports revision tracking** — auto-incrementing revisions (0,1,2 or A,B,C), a revision-history
    table, and the current revision stamped into the title block.
  - API: `POST /api/pid/generate` and `/from-network` (`?format=json|svg|html`)
    ([pid_routes.py](aquaflow/backend/api/routes/pid_routes.py)), wired in main.py.
  - **Verification: 25/25** ([validate_pid_generator.py](aquaflow/backend/validate_pid_generator.py))
    (XML-parsed structure checks); **7 pytest cases**
    ([test_pid_generator.py](aquaflow/backend/tests/test_pid_generator.py)) → backend pytest now **50 passing**.

- **AQ-S2-005 Nozzle Performance Database — DONE on `main` (Stage 2).**
  - New [services/nozzle_database.py](aquaflow/backend/services/nozzle_database.py): nozzle models
    keyed by manufacturer catalog, built on the orifice law **Q = K·√P**.
  - **Stores K factors** (explicit, or least-squares-derived from a catalog curve).
  - **Pressure-flow interpolation** across tabulated manufacturer points in the **sqrt(P) domain**
    (exact for an ideal nozzle), with a self-consistent forward/inverse round-trip and jet-height
    interpolation.
  - **Manufacturer catalogs** — multiple catalogs loadable from JSON; seed catalogs in
    [data/nozzle_catalogs.json](aquaflow/backend/data/nozzle_catalogs.json) (AquaFlow Standard + OASE).
  - API: `GET /api/nozzles/manufacturers|models|models/{id}`, `POST /api/nozzles/query|catalog`
    ([nozzles_routes.py](aquaflow/backend/api/routes/nozzles_routes.py)), wired in main.py.
  - **Verification: 18/18** ([validate_nozzle_database.py](aquaflow/backend/validate_nozzle_database.py))
    against independent Q=K√P + interpolation hand-calcs; **9 pytest cases**
    ([test_nozzle_database.py](aquaflow/backend/tests/test_nozzle_database.py)) → backend pytest now **43 passing**.

- **AQ-S2-003 Pipe Sizing Engine — DONE on `main` (Stage 2).**
  - New [services/pipe_sizing.py](aquaflow/backend/services/pipe_sizing.py): velocity-based sizing
    (`v = Q/A`) against a configurable [v_min, v_max, v_target] band and a standard DN catalog.
  - **Suggests optimal diameter** — rounds the target-velocity diameter up to the next standard
    size (velocity lands at/just below v_target, with head-loss margin).
  - **Detects undersized** (v > v_max) and **oversized** (v < v_min) pipes, each with a suggested
    replacement size and a clear message; limits fully configurable.
  - Integrates with the hydraulic solver: `size_network()` solves for flows (AQ-S2-001) then sizes
    every pipe. API: `POST /api/hydraulics/size` and `/size-network`
    ([hydraulics_routes.py](aquaflow/backend/api/routes/hydraulics_routes.py)).
  - **Verification: 18/18** ([validate_pipe_sizing.py](aquaflow/backend/validate_pipe_sizing.py))
    against independent velocity hand-calcs; **8 pytest cases**
    ([test_pipe_sizing.py](aquaflow/backend/tests/test_pipe_sizing.py)) → backend pytest now **34 passing**.

- **AQ-S2-001 Hydraulic Network Solver — DONE on `main` (Stage 2).**
  - New [services/hydraulic_solver.py](aquaflow/backend/services/hydraulic_solver.py): steady-state
    pipe-network solver via the **Global Gradient Algorithm** (Todini-Pilati, the EPANET method) —
    a Newton-Raphson solve of the coupled energy+continuity system on the weighted graph Laplacian,
    so branched (tree), looped, and closed-loop recirculating topologies are handled uniformly.
  - Computes **flow at every pipe/node** (mass conserved at every node) and **head/pressure at every
    node** (reported in m, kPa, bar). Hazen-Williams (default) and Darcy-Weisbach head-loss models,
    optional minor losses; topology auto-classified (independent loops via circuit rank).
  - API: `POST /api/hydraulics/solve` ([hydraulics_routes.py](aquaflow/backend/api/routes/hydraulics_routes.py)),
    wired in [main.py](aquaflow/backend/main.py).
  - **Verification: 26/26** ([validate_hydraulic_solver.py](aquaflow/backend/validate_hydraulic_solver.py)) —
    each scenario checked against an independent hand calc + conservation laws (series, branched tree,
    symmetric loop even-split, asymmetric loop analytic split under Darcy, pump recirculation loop).
    Also **7 pytest cases** ([test_hydraulic_solver.py](aquaflow/backend/tests/test_hydraulic_solver.py))
    folded into the suite → backend pytest now **26 passing**.

## Prior (Stage 1)
- **AQ-S1-009 Automated test harness — DONE on `main`.**
  - **Backend pytest suite** (`backend/tests/`, config [pytest.ini](aquaflow/backend/pytest.ini)) —
    schema/runtime contracts (aqua↔canonical round-trip, `RuntimeSession`/
    `RuntimeCommand`), fixture→registry routing + conflict flagging, output-path safety gate,
    and an **end-to-end playback smoke test** ([test_e2e_playback_smoke.py](aquaflow/backend/tests/test_e2e_playback_smoke.py))
    driving the real `ShowEngine` load→play→tick→stop with a capturing bus.
  - **Frontend vitest suite** (`src/utils/__tests__/`, config [vitest.config.js](aquaflow/frontend/vitest.config.js)) —
    **17 passing**: the fixture-type **resolver** and the runtime-signal **projection**
    (`deriveRuntimeSignals`).
  - Test deps added to [requirements.txt](aquaflow/backend/requirements.txt) (pytest, httpx) and
    `package.json` (vitest); `.venv`/`.pytest_cache`/coverage gitignored; how-to in
    [TESTING.md](aquaflow/TESTING.md).

- **AQ-S1-007 Safety limits in output path — DONE on `main`.**
  - `ProtocolBus._route_command` now routes every command through `_safety_gate()`,
    the single choke point before hardware emit
    ([protocol_bus.py](aquaflow/backend/engine/protocol_bus.py)).
  - **Per-fixture intensity clamped:** per-fixture ceilings (`set_fixture_limit`) plus a
    global cap are applied and clamped to [0,1]; caps are carried from designed fixtures'
    `maxIntensity` in `apply_show_payload` ([app_state.py](aquaflow/backend/app_state.py)).
  - **Flame duration enforced at hardware level:** `_enforce_flame_duration` cuts a flame
    off after `FLAME_MAX_DURATION` (3 s) of continuous on-time and latches it off until the
    show drops it to zero / a command gap ends the burst — independent of the safety kernel.
  - **Safety kernel active during all output:** the bus is wired to the kernel at startup
    ([main.py](aquaflow/backend/main.py)); no master permit → all output zeroed, and each
    per-subsystem enable (pump/valve/flame/laser/fog/lighting) gates its emits.
  - **Validation harness: 15 / 15 PASS** ([validate_safety_output_limits.py](aquaflow/backend/validate_safety_output_limits.py)).

- **AQ-S1-005 Multi-universe + audio end-to-end — DONE on `main`.**
  - Art-Net `ArtNetDriver` no longer wraps universes at `% 4`; buffers are allocated
    on demand across the full 15-bit space (0–32767), with out-of-range frames rejected
    ([protocol_bus.py:37](aquaflow/backend/engine/protocol_bus.py#L37)).
  - Audio route hardened so the **real** librosa/numpy path is actually taken:
    tempo unwrapped for numpy 2.x (`np.atleast_1d(tempo)[0]`), profile normalizers
    guarded against divide-by-zero, and section segmentation isolated so a
    sklearn/segmentation hiccup can no longer discard real BPM/beats
    ([audio.py](aquaflow/backend/api/routes/audio.py)).
  - numpy 2.4.5 / librosa 0.11.0 / soundfile / scikit-learn 1.8.0 all present and exercised.
  - **Validation harness: 18 / 18 PASS** ([validate_multiuniverse_audio.py](aquaflow/backend/validate_multiuniverse_audio.py)) — 8 live universes with no aliasing + a generated 120 BPM click track analysed to real beats (confidence 0.92, BPM ≈ 117).

- **AQ-S1-003 Hardware conflict detection — DONE on `main`.**
  - `ShowEngine.get_hardware_conflicts()` derives duplicate/overflow addresses from the
    DeviceRegistry validation computed at show-apply time
    ([show_engine.py:161](aquaflow/backend/engine/show_engine.py#L161)).
  - `ShowEngine.play()` is now a pre-flight gate: it refuses to start and returns `False`
    when conflicts exist, setting a clear operator error in `last_error`
    ([show_engine.py:181](aquaflow/backend/engine/show_engine.py#L181)).
  - `get_state()` exposes `hardware_conflicts` + `error`; `load_show()` clears the block for a fresh show.
  - `main.py` WS `play` handler and `scheduler_start_show` broadcast the error and abort when blocked.
  - `/operator/status` returns an explicit `hardware_conflicts` list
    ([phase7_routes.py:184](aquaflow/backend/api/routes/phase7_routes.py#L184)).
  - Operator panel shows a red **HARDWARE ADDRESS CONFLICT — SHOW BLOCKED** banner and
    disables PLAY while conflicts exist
    ([OperatorPanel.jsx](aquaflow/frontend/src/components/panels/OperatorPanel.jsx)).
  - **Validation harness: 9 / 9 PASS** ([validate_hardware_conflict.py](aquaflow/backend/validate_hardware_conflict.py)); AQ-S1-001 harness still 21 / 21; frontend build clean.

- **AQ-S1-001 Backend fixture-aware architecture — verified DONE on `main` (commit `118ba6e`).**
  - `show_engine.get_snapshot()` carries `fixtures` + `groups` + `deviceRegistry` summary
    ([show_engine.py:492-494](aquaflow/backend/engine/show_engine.py#L492)).
  - `protocol_bus.configure_from_fixtures()` populates `_fixture_registers` from the designed
    fixtures, and `_route_command` routes Modbus to those first
    ([protocol_bus.py:292](aquaflow/backend/engine/protocol_bus.py#L292),
    [:394](aquaflow/backend/engine/protocol_bus.py#L394)).
  - `apply_show_payload` builds a `DeviceRegistry` via the new
    `services/fixture_registry_bridge.py` and hands it to the bus, so a designed show reaches
    real hardware addresses.
  - **Validation harness: 21 / 21 PASS** ([validate_fixture_aware.py](aquaflow/backend/validate_fixture_aware.py)).

## Prior sessions (recap)
- 2026-07-02: full setup — repo, Claude Code, 3 bug fixes, codebase audit (33%),
  AI Command Hub v2.9 (8 tabs, 129 tasks, DeepSeek Forex math framework, auto-report bridge).
- Detailed engineering audit preserved in [aquaflow/docs/AUDIT_20260702.md](aquaflow/docs/AUDIT_20260702.md).
- Chief Architect roadmap preserved in [aquaflow/docs/MASTER_ROADMAP_ChatGPT_v1.0.txt](aquaflow/docs/MASTER_ROADMAP_ChatGPT_v1.0.txt).

## Next session starts with
**AQ-S3-003 (next Stage 3 item) or AQ-S2-002 — Pump curve import & duty-point (Stage 2).**
AQ-S2-002 depends on AQ-S2-001 (done).
Acceptance: imports manufacturer pump curves · auto-calculates duty point · flags off-curve
operation. The hydraulic solver's system head (from
[hydraulic_solver.py](aquaflow/backend/services/hydraulic_solver.py)) provides the system curve
to intersect with the pump curve for the duty point. The pipe sizing engine (AQ-S2-003) sizes the
network, and the nozzle database (AQ-S2-005) provides nozzle Q=K√P demands feeding the system curve.

Also still open in Stage 1: **AQ-S1-002 — Automatic DMX address assignment** (foundation exists in
`fixture_registry_bridge.build_registry_from_fixtures()`; extends into the UI + WS surface).

## Standing workflow
Defined in [CLAUDE.md](CLAUDE.md): update `CURRENT_STATUS.md`, write
`session-report.json` (in the hub's bridge folder), commit, push — every session end.
