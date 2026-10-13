# AF-NEXT-016 evidence: AquaFlow Studio 1.2.33 release

Date: 2026-10-13. Source commit: `SOURCE_COMMIT_TO_FILL`.

## Release artifacts

| Artifact | Result |
| --- | --- |
| Desktop version | `1.2.33` (`AquaFlow Studio.exe` product version `1.2.33.0`) |
| Installer | `aquaflow/desktop/dist/AquaFlowSetup-1.2.33.exe` |
| Installer bytes | 167,195,074 |
| Installer SHA-256 | `FF9F938CD283060850C0F45DADFB0A16F023F08CDB3FEFFBF7C016FA5019F955` |
| Update metadata | `latest.yml` reports 1.2.33 with SHA-512 and size 167,195,074 |
| Signing | Intentionally unsigned Tier A/internal build; checksum verification required |
| Rollback | `aquaflow/desktop/dist/AquaFlowSetup-1.2.32.exe`, SHA-256 `1DDF4A4B7B3F62A1C71130A080329C79650286959F5EFAB1A49A0D899955AB54` |

The frontend web bundle and PyInstaller engine were rebuilt from the same working tree before electron-builder packaged them. The 1.2.33 engine is staged as `resources/engine-1.2.33`; `electron-builder.yml` selects that exact directory.

## Automated release gates

- Backend full suite: 1,269 collected; **1,248 passed, 21 skipped**.
- Frontend full suite: **104 files, 1,102/1,102 passed**.
- Vite production build passed. The known chunk-size warning remains documented.
- PyInstaller 6.22.3 / Python 3.12.10 produced the one-directory engine successfully. Its pre-existing optional `OpenSSL` hidden-import warnings remain non-fatal; the application uses `cryptography` and passed packaged startup/license/PLC/CAD suites.
- Protocol loopback harness: 5/5 passed, `verification_mode: SIMULATED`, no physical target.
- Focused PLC/protocol simulator suite: 223/223 passed.

## Packaged-engine smoke

The new frozen engine ran from `resources/engine-1.2.33` with isolated data and no unsafe/dev flags:

- localhost health: `ok`;
- current machine license: `VALID`, edition `STUDIO`;
- controller catalog: 20 entries, one `bench_verified`, zero `site_commissioned`;
- I-CAN: `bench_verified`; Siemens S7-1200: `simulated`;
- isolated Siemens internal simulation started, reported running, then stopped with stop confirmation. Readiness correctly remained blocked. This was not PLCSIM and did not contact hardware.

## Desktop GUI smoke

The unpacked `AquaFlow Studio.exe` ran with a fresh isolated user-data profile and DevTools inspection:

- user agent reported `AquaFlowStudio/1.2.33`;
- license was `VALID` / `STUDIO`;
- the bundled `Lebu Fountain · Pilot` opened;
- Commission → Device discovery → Controllers displayed `BENCH VERIFIED`, `SIMULATED`, and `UNSUPPORTED` labels;
- startup resource hosts were only `127.0.0.1` and `localhost`;
- an external Google Fonts dependency discovered by the first smoke was removed and the app rebuilt;
- screenshot: `docs/preview-realism/_local/af-next-live-smoke/release-1233-controller-labels.png` (local evidence, intentionally gitignored).

No UI smoke action armed, started, pulsed or deployed to hardware.

## Migration, recovery and offline behavior

- Prior `.aqua` migration/round-trip, embedded-asset verification and project persistence passed in the frontend suite (`engineeringProject`, `showFile`, `projectPersistence`, `zipStore`, Lebu pilot and CAD round-trip coverage).
- Crash recovery and atomic project save passed in `projectRecovery.test.js` and desktop `project-files.test.cjs`; the desktop UI smoke used an isolated recovery profile.
- The desktop shell, engine, UI assets, sample project and license validation are local. The final resource inventory contained loopback hosts only. Network remains optional for update checks and intentional online services.

## Installer / rollback

- NSIS packaging completed and produced installer, blockmap and `latest.yml`.
- The previous 1.2.32 installer is retained for manual rollback.
- Installer configuration keeps `deleteAppDataOnUninstall: false`, so uninstall/upgrade does not intentionally remove user project data.
- Installation verification is appended after the silent in-place upgrade and installed-app smoke.

## Delivered handover materials

- `release/AquaFlow-1.2.33/CHANGELOG.md`
- `release/AquaFlow-1.2.33/KNOWN-LIMITATIONS.md`
- `release/AquaFlow-1.2.33/SHA256SUMS.txt`
- `aquaflow/samples/lebu-pilot/Lebu_Fountain_Pilot.aqua`
- `HARDWARE_COMMISSIONING_CHECKLIST.md`
- `AF-HUB-011_COMMISSIONING_RECORD.md`
- `docs/evidence/AF-NEXT-015.md`
