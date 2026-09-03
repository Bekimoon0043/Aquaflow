# AquaFlow Studio — Current Status

> **AUTHORITATIVE (2026-09-03, AF-IO-003):** backend pytest **632 passed, 21 skipped,
> 0 failures, 0 errors (653 collected)** · frontend vitest **391 passed (29 files)** ·
> `npm run build` green · desktop **1.1.5**. Single source of truth:
> `AQUAFLOW_STATUS_CANONICAL.md`. Test/task numbers in the dated entries below are
> point-in-time snapshots — the line above is current.

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
