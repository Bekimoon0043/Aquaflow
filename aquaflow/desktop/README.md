# AquaFlow Studio — Desktop Shell (AF-PKG)

Packaging/delivery layer that turns AquaFlow Studio into a standalone Windows desktop
app (Electron window + PyInstaller-bundled backend + NSIS installer + auto-update). **The
existing frontend/backend source is NOT modified by this layer** — it only wraps and
delivers it.

## Layout

```
aquaflow/desktop/
  package.json          Electron + electron-builder + electron-updater
  main.js               Electron main process (AF-PKG-001 scaffold → grows per task)
  preload.js            context bridge (empty scaffold)
  electron-builder.yml  installer config skeleton
  scripts/              build-web.js / build-engine.js (added AF-PKG-002/003)
  build/                icons + installer graphics (added AF-PKG-005)
  web/                  (generated) Vite production build — gitignored
  resources/engine/     (generated) aquaflow-engine.exe — gitignored
  dist/                 (generated) AquaFlowSetup.exe — gitignored
```

## Status: AF-PKG-001 — scaffolding only

`npm start` opens a blank branded window. It does **not** yet start the backend or load
the real UI (AF-PKG-002/003/004). See the AF-PKG task sequence.

## Prerequisites (to build later stages)

- Node.js 18+ and npm (present)
- Python 3.10–3.12 for the backend bundle — **note:** the repo's backend venv is Python
  3.14; PyInstaller does not yet support 3.14, so AF-PKG-002 needs a 3.10–3.12 build venv
  (documented in BUILD.md / the AF-PKG-002 report).
