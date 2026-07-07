# AquaFlow Studio — Packaging Verification Report (AF-PKG-009)

**Product:** AquaFlow Studio desktop (Electron shell + PyInstaller engine + NSIS installer)
**Scope:** AF-PKG-001 … AF-PKG-010 standalone packaging
**Author:** AquaFlow packaging pass
**Date:** 2026-07-07
**Status:** Code complete — **build-machine verification PENDING**

---

## 0. How to read this report

Packaging was authored in a headless Linux/CI-style sandbox that **cannot** download the
Electron runtime binary, run PyInstaller against Python 3.14, execute NSIS, or open a GUI
window. Every item below is therefore marked as one of:

- **[VERIFIED-HERE]** — checked in this environment (syntax, unit logic, real sub-builds,
  file/asset validity). Trustworthy now.
- **[PENDING-BUILD]** — requires a Windows build machine with the full toolchain. Written
  and wired, but **not** yet exercised. An engineer must run these and tick them.

Nothing GUI-, installer-, or clean-machine-related is claimed as passing. This document is
the checklist that engineer follows.

---

## 1. Build-machine prerequisites (one-time)

| # | Requirement | Notes |
|---|-------------|-------|
| 1 | Windows 10/11 x64 | Tier A target OS |
| 2 | Node.js 18+ and npm | for Electron + electron-builder |
| 3 | A **Python 3.10–3.12** interpreter | PyInstaller does **not** support 3.14; the dev backend runs on 3.14 but the *bundle* must be built with 3.10–3.12. Set `AQUAFLOW_BUILD_PYTHON` to its path. |
| 4 | Frontend deps installed | `npm ci` in `aquaflow/frontend` |
| 5 | Desktop deps installed | `npm ci` in `aquaflow/desktop` (downloads the Electron binary) |
| 6 | (Release only) Authenticode code-signing certificate | for signed installer + verified auto-update |

---

## 2. Sub-build verification

| # | Item | Status | Evidence / how to check |
|---|------|--------|-------------------------|
| 2.1 | Vite production build (`build:web`) | **[VERIFIED-HERE]** | Ran `scripts/build-web.js` → real `web/` output produced with `--base=./` for `file://` loading. |
| 2.2 | Engine bundle (`build:engine`, PyInstaller) | **[PENDING-BUILD]** | Needs `AQUAFLOW_BUILD_PYTHON` (3.10–3.12). Run `npm run build:engine`; expect `resources/engine/aquaflow-engine.exe`. |
| 2.3 | Frozen engine entrypoint imports the app | **[VERIFIED-HERE]** | `engine_entry.py` imports `from main import app` and fails loud without `AQUAFLOW_LICENSE_SECRET` (SystemExit 2). |
| 2.4 | PyInstaller spec collects submodules/data | **[PENDING-BUILD]** | `aquaflow-engine.spec` lists uvicorn/api.routes/services/engine/safety + `data/`. Confirm no missing-module errors at runtime. |

---

## 3. Electron shell (headless-verifiable)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 3.1 | All main-process JS passes `node --check` | **[VERIFIED-HERE]** | main.js, preload.js, menu.js, launcher.js, app-config.js, updater.js. |
| 3.2 | Free-port selection | **[VERIFIED-HERE]** | `launcher.findFreePort()` unit-tested headlessly. |
| 3.3 | Engine spawn env scrubbing | **[VERIFIED-HERE]** | `startEngine()` strips `AQUAFLOW_DEV/ENV/UNSAFE_DEV/DEV_MODE`; unit-checked. |
| 3.4 | Health polling / clean shutdown | **[VERIFIED-HERE]** | `waitForHealth()` + `stopEngine()` (SIGTERM→SIGKILL) unit-checked. |
| 3.5 | `.aquashow` argv parsing | **[VERIFIED-HERE]** | `showPathFromArgv()` 6/6 headless cases (real→found, missing/empty/undefined→null). |
| 3.6 | Single-instance lock | **[VERIFIED-HERE]** (logic) / **[PENDING-BUILD]** (behaviour) | Lock + `second-instance` handler present; live focus/forward needs GUI. |
| 3.7 | Config resolution (license + update URL) | **[VERIFIED-HERE]** | `resolveConfig()` priority env → bundled → dev default. |

---

## 4. GUI / runtime behaviour — **[PENDING-BUILD]** (all)

Run `npm start` (dev) or install the packaged app, then tick:

- [ ] Splash window shows branded forest/gold screen with status text.
- [ ] Engine starts; `/api/health` reached within 30 s; splash closes; main window opens.
- [ ] Main window loads the AquaFlow UI (not the "Frontend not built" fallback).
- [ ] App icon renders on window + taskbar.
- [ ] Menu: File (Open Show…/Save/Exit), View, Help (Documentation/Check for Updates/About).
- [ ] About dialog shows correct version + LuxuryCon copyright + Electron/Chromium/Node.
- [ ] File > Open Show… → picks a `.aquashow` → renderer receives `open-show`.
- [ ] Ctrl+S → renderer receives `menu-save`.
- [ ] Closing the window stops the engine (no orphaned python/exe process).
- [ ] Startup failure (e.g. no license secret) shows an error dialog, not a silent hang.

**Parity check (critical):** the packaged app must behave **identically** to the dev setup —
same safety kernel, same `AQUAFLOW_HARDWARE_COMMISSIONED=FALSE` default, same commissioning
gate. Confirm the bench-safety lock and honest protocol endpoints behave the same when run
from the bundled engine.

- [ ] `AQUAFLOW_HARDWARE_COMMISSIONED` defaults FALSE in the packaged engine.
- [ ] Bench-safety lock still blocks unsafe dev flags in the bundle.
- [ ] Protocol support endpoint reports the same REAL/GATED/UNSUPPORTED matrix.

---

## 5. File association — **[PENDING-BUILD]**

- [ ] Installer registers `.aquashow`.
- [ ] Double-clicking a `.aquashow` (app closed) launches AquaFlow and loads the show.
- [ ] Double-clicking (app open) loads it in the existing window — no second instance.
- [ ] Corrupt/missing file → "Cannot open show" dialog, not a crash.
- [ ] `.aquashow` files show the document icon.

---

## 6. Auto-update — **[PENDING-BUILD]**

Requires a packaged build + a reachable generic feed serving `latest.yml` + installer.

- [ ] Launch check is silent when offline / feed unreachable (log only, no dialog).
- [ ] A newer version on the feed downloads in the background.
- [ ] "Restart to update / Later" prompt appears; Later defers without interrupting.
- [ ] Restart installs the update; version increments.
- [ ] Help > Check for Updates… reports "up to date" when current (interactive feedback).
- [ ] Feed URL cannot be changed from the UI (admin env/app-config.json only). **MITM guard.**
- [ ] Installer is code-signed **or** the report explicitly records checksum-only integrity.

---

## 7. Installer (NSIS) — **[PENDING-BUILD]**

Run `npm run dist` on the build machine, then:

- [ ] `AquaFlow Studio-Setup-<version>.exe` produced in `dist/`.
- [ ] Assisted installer runs (welcome → dir → progress → finish).
- [ ] Desktop + Start-menu shortcuts created (Start menu under "LuxuryCon").
- [ ] App launches from shortcut and from finish-page "run after".
- [ ] Upgrade over a prior version preserves user shows/settings (`%APPDATA%\AquaFlow Studio`).
- [ ] Uninstaller removes the app but (by default) keeps user data.
- [ ] Clean-machine install (no Node/Python installed) launches successfully.

---

## 8. Outstanding assets required from CEO

The build succeeds with placeholders, but production polish needs:

1. **App icon / logo** — ≥512×512 PNG (and/or `.ico`) to replace `build/icon.png` placeholder.
2. **`.aquashow` document icon** — optional dedicated icon (else app icon is reused).
3. **Installer graphics** — sidebar `164×314` BMP, header `150×57` BMP, installer/uninstaller `.ico`.
4. **Install scope decision** — per-user (current default) vs per-machine `Program Files\LuxuryCon`.
5. **Internal update-server location** — HTTPS URL hosting `latest.yml` + installers.
6. **Code-signing certificate** — for signed installer + tamper-verified auto-update.

---

## 9. Honest bottom line

- **Code + configuration: complete and internally verified** for everything checkable
  without a GUI/toolchain (syntax, unit logic, real web build, YAML/asset validity).
- **Not yet proven:** any GUI render, the engine bundle, the installer, file association,
  auto-update, and clean-machine install. These are gated on a Windows build machine and
  are listed above as explicit, tickable steps.
- **No packaging acceptance criterion that requires a running GUI/installer is claimed as
  passing in this report.**
