# AquaFlow Studio 1.2.33 — known limitations

- This is an unsigned Tier A/internal installer. Windows SmartScreen may show **Unknown publisher**. Verify the published SHA-256 first.
- No controller/device is labeled site commissioned. Physical operation requires the exact site's signed checklist, E-stop/interlock controls and approved operator.
- I-CAN bench evidence applies only to the recorded `192.168.5.2` gateway/path. Several electrical/outlet mappings remain provisional.
- Siemens PLCSIM proves the contract and simulated runtime path, not physical CPU, I/O, watchdog or actuator behavior.
- Art-Net and sACN are verified against local UDP loopback receivers, not a signed physical node/fixture run.
- Modbus, Allen-Bradley and OPC UA hardware still require exact-device verification. Native Mitsubishi MC, Omron FINS and Beckhoff ADS are unsupported/gated.
- NVIDIA GeForce GT 730 is an entry-tier target. Adaptive rendering is intentionally capped at Low/Eco. High quality is an explicit non-adaptive override and may not be usable.
- The production build still reports the known large Three.js/media bundle warning; this affects download/initial parse size, not correctness.
- PROFINET DCP discovery on Windows requires a separately licensed/installed Npcap runtime.
- The auto-update feed requires network access, but normal application startup, the bundled engine, UI assets and license validation do not.

Rollback installer: `aquaflow/desktop/dist/AquaFlowSetup-1.2.32.exe`. Reinstalling it does not delete user project data because NSIS `deleteAppDataOnUninstall` is false. Keep independent backups of important `.aqua` files before changing versions.

