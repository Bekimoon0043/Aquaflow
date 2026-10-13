# AquaFlow Studio 1.2.33

Release date: 2026-10-13

## Highlights

- Added the guided Design, Program, Commission and Operate workspaces, with project-aware next steps and warnings that open the responsible tool or object.
- Bundled the Lebu Fountain pilot project and verified it opens in the packaged desktop application.
- Unified show-frame evaluation between programming, the simulation timeline, 3D preview and compilation; documented the shared colour pipeline.
- Added multi-basin/island CAD round-trip, drafting history, common snapping, typed dimensions, selection/groups and stable engineering IDs.
- Added equipment provenance/confidence, verified-model workflows, hydraulics/splash diagnostics and a fail-closed preflight gate.
- Added project ZIP persistence, asset manifests, atomic save, snapshots and crash recovery.
- Calibrated the 3D preview on the NVIDIA GeForce GT 730. Adaptive rendering now caps entry GPUs at Low/Eco even when an older project saved High quality; a deliberate High override requires Adaptive to be off.
- Added independent controller support and commissioning-evidence badges. Each catalog class is now labeled `simulated`, `bench verified`, `site commissioned`, or `unsupported` with its evidence boundary.
- Removed the Google Fonts runtime request so desktop startup uses only bundled/local resources and Windows fonts.

## Safety and commissioning

- Hardware remains globally **not commissioned** and output is labeled **SIMULATED**.
- The specific `192.168.5.2` I-CAN integration path is labeled **bench verified**, not site commissioned, because its exact per-outlet mapping and signed full-site checklist are incomplete.
- Siemens, Modbus, Art-Net/sACN, Allen-Bradley simulator and OPC UA simulator evidence remains labeled **simulated**.
- No physical controller was contacted or actuated while producing this release.

## Verification summary

- Backend: **1,248 passed, 21 skipped** (1,269 collected).
- Frontend: **1,102 passed** across 104 files.
- Protocol loopback harness: **5/5 passed**, explicitly `SIMULATED`.
- Focused PLC/protocol simulator set: **223/223 passed**.
- Packaged engine: health, valid STUDIO license, controller catalog and isolated Siemens simulation passed.
- Unpacked desktop: version 1.2.33, bundled Lebu pilot, controller evidence labels and loopback-only startup resources passed.

This Tier A build is intentionally **not Authenticode-signed**. Verify the SHA-256 checksum in `SHA256SUMS.txt` before installation.

