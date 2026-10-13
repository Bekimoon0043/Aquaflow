# AF-NEXT-006 — Project recovery and dependencies: evidence

Date: 2026-10-13
Scope: atomic project save/open (desktop), rolling autosave snapshots, crash-recovery prompt, asset manifest with SHA-256, `.aquapkg` packaging, and a missing/changed-asset report shown on open.
Hardware: none. Nothing here connects to, arms or drives physical equipment.

## Behavior before this ticket

- Save was a browser Blob download (`utils/showFile.js` `downloadShowFile`). The desktop main process had no save handler. File > Save sent `menu-save`, but no renderer code listened for it.
- Autosave kept one localStorage slot (`aquaflow_autosave`). It ran every 30 s and on `beforeunload`, and it silently ignored any error (`showFile.js autoSave`).
- Restore was a manual card in the Show Browser. Nothing detected a crash.
- Audio was saved as name, size, type and lastModified only. Imported GLB site models live only in the local IndexedDB model library, so on a second PC they were missing and nothing said so.

## Data contracts

**Atomic save (desktop, `desktop/project-files.js` `atomicWriteFile`)**

1. Write `<file>.tmp` and `fsync` it.
2. Copy the current `<file>` to `<file>.bak`.
3. Rename `<file>.tmp` over `<file>`. The rename is retried briefly on Windows EPERM/EBUSY.

If any step throws, `<file>` is unchanged and the `.tmp` file is removed.

**Snapshots**

- Desktop: stored as `<userData>/project-recovery/snapshots/snap-<epochms>-<seq>-<projectKey>.json`, containing `{ aquaflowSnapshot: 1, meta: { projectKey, name, originalPath, reason, savedAt }, project: <.aqua object> }`.
- Browser fallback: the same records in IndexedDB `aquaflow-autosave-v1`.
- Rotation keeps the newest 10 per project and 50 overall.
- Snapshots never write to the project file.
- Triggers: 4 s after the last edit (debounced), every 30 s, and on pagehide/unload. A snapshot is skipped when the content signature has not changed.

**Crash detection**

- `<userData>/project-recovery/session.lock` is written at boot and removed in `cleanupAndQuit()`. If the lock already exists at the next boot, the previous run did not quit cleanly.
- `clean-saves.json` records, per project id, the time of the last save or open.
- The prompt appears only when the previous exit was unclean **and** a snapshot is newer than that project's clean save (`findRecoveryCandidate`).
- The browser fallback uses the localStorage key `aquaflow_session_lock`, released on `pagehide`.

**Asset manifest**

- Stored as `assetManifest` in the `.aqua` envelope. The full contract is in the header of `frontend/src/utils/assetManifest.js`.
- Roles covered: `audio` (Show Programmer audio and timeline audio, when it has a name or path), `site_model` (imported `custom:` GLBs; built-in `venue:*` models ship with the app and are not listed), `cad_underlay` (embedded in the project and hashed over a canonical form), and `texture` (any `*texture*` path field in render or engineering params).
- Each entry records `path`, `relativePath` (relative to the project file), `size`, `sha256` (full 64-hex digest) and `source`.
- This reuses the engineering-package / `.luxshow` manifest pattern of a size and SHA-256 per member.

**`.aquapkg`**

- A ZIP using the STORE method. It contains `project.aqua` (with the manifest and `packaged` member names), `manifest.json`, and `assets/<id>--<name>`.
- Each member has a CRC-32, and the SHA-256 is checked again on open.
- Imported GLBs are restored into the model library under their original `custom:` id.

**Open**

- Assets are resolved in this order: packaged bytes, then the path relative to the project, then the recorded absolute path, then the same file name alongside the project (the project folder and its `assets/`, `audio/`, `media/`, `models/` and `textures/` subfolders), then the model library.
- Each asset is classified as `ok`, `changed`, `missing` or `unverified`.
- The report is built **before** the workspace loads. It is shown in a modal that also blocks Space, so playback cannot start underneath it.
- The modal offers Locate/Relink for each problem asset. Verified Show Programmer audio is attached to the Show Programmer automatically.
- Legacy `.aqua` files without `assetManifest` load exactly as before, with no report.

## Failure behavior

- A failed save shows a toast saying the previous file is unchanged, and the error is logged. The original and its `.bak` stay intact.
- A failed autosave raises a toast and a log entry once per distinct error, and another when it recovers. `useAutoSave()` now returns `{ lastSaved, error }`. The legacy `autoSave()` returns `{ ok, error }` instead of ignoring errors.
- A damaged package fails with a CRC or missing-`project.aqua` error. A tampered asset is reported as `changed`.
- Untrusted IPC senders are refused. Asset reads are limited to media and CAD extensions and 512 MB; project paths to `.aqua`, `.aquapkg`, `.aquashow` and `.json`.

## Files

New:

- `aquaflow/desktop/project-files.js`
- `aquaflow/desktop/tests/project-files.test.cjs`
- `aquaflow/frontend/src/utils/projectPersistence.js`
- `aquaflow/frontend/src/utils/projectRecovery.js`
- `aquaflow/frontend/src/utils/assetManifest.js`
- `aquaflow/frontend/src/utils/zipStore.js`
- `aquaflow/frontend/src/components/ProjectRecoveryHost.jsx`
- `aquaflow/frontend/src/utils/__tests__/projectRecovery.test.js`

Changed:

- `desktop/main.js`: session lock and IPC registration; `.aqua` and `.aquapkg` accepted on argv.
- `desktop/preload.js`: `window.aquaflow.project.*`, `onSaveAs`, `onPackage`, `getPathForFile`.
- `desktop/menu.js`: Save As and Package Project items; the Open filter now includes `.aqua` and `.aquapkg`.
- `desktop/electron-builder.yml`: packages `project-files.js`.
- `frontend/src/hooks/useAutoSave.js`: snapshots with an edit debounce; errors are surfaced.
- `frontend/src/utils/showFile.js`: the legacy `autoSave` reports errors.
- `frontend/src/store/projectStore.js`: the audio reference records its path, and the live File is registered for hashing.
- `frontend/src/components/preview/modelLibrary.js`: new `getImportedModelRecord` and `restoreImportedModel`.
- `frontend/src/components/programmer/studio/ShowStudio.jsx`: saves through `saveProject` and receives attached audio.
- `frontend/src/components/TopBar.jsx` and `topBarMenu.js`: Save, Save As and Package Project; Import goes through `openProjectFile`.
- `frontend/src/components/ShowBrowser.jsx`: lists snapshots and recent project files; open and Save As go through the new pipeline.
- `frontend/src/App.jsx`: two additive lines that mount `<ProjectRecoveryHost />`.

`desktop/package.json` is unchanged.

## Automated evidence (2026-10-13)

| Command | Result |
| --- | --- |
| `node --test "aquaflow/desktop/tests/*.test.cjs"` | 22/22 pass (10 new) |
| `npx vitest run src/utils/__tests__/projectRecovery.test.js` | 16/16 pass |
| `npx vitest run` (full) | 83/84 files pass. The one failure is `showFileEngineering.test.js` (`depth_zones` round trip). It comes from the concurrent, in-progress edit to `engineering/engineeringProject.js` by the AF-NEXT-010 owner (the file changed at 11:12 today); this ticket did not touch it. |
| `npx vite build` | OK. The only warning is the existing three.js chunk-size warning. |

Note: with Node 24, `node --test aquaflow/desktop/tests` (a directory argument) fails with "Cannot find module". Use the glob form above.

What the tests cover:

- **Atomic write:** a disk-full error after 4 bytes, an fsync failure and a rename failure each leave the original byte-identical with no `.tmp` left behind. A normal save keeps `.bak`.
- **Snapshot rotation:** 13 writes leave 10, newest first, with projects kept separate and a global cap enforced. The original file is untouched. Snapshot ids that try path traversal are rejected. A storage quota error reaches the caller.
- **Crash detection:**
  - A leftover lock is reported as unclean; a released lock is not.
  - The prompt is offered only when a snapshot is newer than the last clean save.
  - A project that was never saved is recoverable.
  - The browser lock behaves the same way.
- **Manifest:**
  - The collected references are audio, an imported model (deduplicated) and the underlay; built-in models are skipped.
  - Relative paths are computed correctly across folders and drives.
  - SHA-256 values match Node `crypto`.
  - On a simulated second PC the report lists a re-encoded audio file as CHANGED and an absent GLB as MISSING.
  - An edited embedded underlay is detected as changed.
- **Package:**
  - The ZIP round-trips, with the CRC-32 check vector `0xCBF43926`.
  - A flipped byte is rejected.
  - Packaged audio verifies via `package`, and a tampered member is reported as CHANGED.
- **Open:** a legacy `.aqua` loads unchanged with no report. A manifest project is fully verified before `loadProjectData` returns.

## Manual procedure: kill the app during an edit (cannot be fully automated)

Run this on the packaged desktop app or `npm start` in `aquaflow/desktop`. No hardware is connected.

1. Open or create a project. Use File > Save As to save it as `C:\AF006\pilot.aqua`. Note the file's size and hash: `certutil -hashfile C:\AF006\pilot.aqua SHA256`.
2. Add Show Programmer audio from `C:\AF006\audio\song.mp3`. Save again with Ctrl+S; no dialog should appear. Confirm that `pilot.aqua.bak` exists and that `pilot.aqua` contains `"assetManifest"`, with the audio entry showing `"relativePath": "audio/song.mp3"` and a 64-hex `sha256`. Record the new hash of `pilot.aqua`.
3. Make a visible edit, for example rename a group or move a fixture. Wait at least 5 s for the debounced snapshot. Check that a new `snap-*.json` exists in `%APPDATA%\AquaFlow Studio\project-recovery\snapshots` (the folder name follows Electron's userData path).
4. While the app is still running, kill it: `taskkill /F /IM "AquaFlow Studio.exe"` (or end the process tree in Task Manager). Do not use File > Exit.
5. Confirm that `project-recovery\session.lock` still exists, and that the hash of `pilot.aqua` equals the hash from step 2.
6. Relaunch. Expect the dialog **"AquaFlow did not close normally"** naming the project, the snapshot time, the last clean save time and the original path, with Restore autosave / Open original file / Discard.
   - **Restore autosave:** the edit from step 3 is present and the project is marked unsaved. `pilot.aqua` is still unchanged until you press Ctrl+S.
   - **Open original file:** the state from step 2 loads, followed by the asset report (all OK).
   - **Discard:** no dialog appears on the next unclean start for this snapshot. The snapshot is still listed under Show Browser > Open > Autosave Snapshots.
7. Quit normally with File > Exit, then relaunch. No recovery dialog should appear, and `session.lock` should be absent after the exit.
8. **Second-PC check:** copy only `pilot.aqua` to another folder or PC, without `audio\`, and open it. Before you can play, the asset report lists `song.mp3` as MISSING; Space does nothing while the report is open. Use **Locate…** to pick the file; the status becomes RELINKED, or RELINKED (different file) if the hash differs. Then use File > Package Project to create `pilot.aquapkg`, copy that file alone to another folder and open it. All assets should show OK via `package`.

Record the hashes from steps 1, 2 and 5, plus screenshots from steps 6 and 8, in this note when you run it.

## Known limitations / field verification

- The browser build cannot see file paths. Audio is hashed from the live File when one is available, and packages embed it. Reopening a plain `.aqua` in a browser reports disk assets as missing until they are relinked. This is honest reporting, by design.
- Restoring a snapshot does not re-verify assets, because snapshots carry no manifest. The Show Programmer audio "relink" hint still applies.
- The browser session lock is per-origin, so several open tabs can produce a false "unclean" signal. The prompt still requires a snapshot newer than the clean save.
- The desktop `recovery-info` call parses snapshot files to read their metadata (at most 50).
- Opening a project counts as a clean point for that project on this PC. A crash right after opening, with no edits, does not prompt.
- The manual kill procedure above has not yet been executed on the packaged installer. The 1.2.32 installer does not contain this code; packaging is a separate step.

## Rollback

- Delete the new files listed above.
- Revert the small edits listed above (each one is commented `AF-NEXT-006`).
- Existing `.aqua` files stay compatible either way, because the `assetManifest` field is ignored by older builds.
