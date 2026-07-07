# Building AquaFlow Studio (Desktop)

How to turn the AquaFlow source into a standalone Windows desktop app. Everything here runs
on a **Windows build machine** — the packaging steps cannot be completed on Linux/CI without
Wine + a Windows Python, and are not meant to be.

> The app is an **Electron shell** (`aquaflow/desktop`) that launches a **bundled backend
> engine** (`aquaflow/backend`, frozen with PyInstaller) and loads the **Vite frontend build**
> (`aquaflow/frontend`). See `main.js` for the startup orchestration.

---

## 1. Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| Windows 10/11 x64 | — | Tier A target OS |
| Node.js | 18+ | Electron + electron-builder |
| npm | 9+ | dependency install |
| Python (build) | **3.10 – 3.12** | PyInstaller does not support 3.14. Point `AQUAFLOW_BUILD_PYTHON` at this interpreter. The dev backend still *runs* on 3.14 — this is only for freezing the bundle. |
| Git | any | source |

> **Why two Pythons?** Development uses `aquaflow/backend/.venv` (Python 3.14). PyInstaller
> can't freeze 3.14 yet, so the *packaged* engine is built with a separate 3.10–3.12
> interpreter. The runtime behaviour is identical — same source, same `main:app`.

---

## 2. One-time setup

```bash
# Frontend deps
cd aquaflow/frontend && npm ci

# Desktop deps (this downloads the Electron runtime binary)
cd ../desktop && npm ci

# Build-Python deps for the engine bundle (in a 3.10–3.12 venv)
#   pip install -r ../backend/requirements.txt pyinstaller
export AQUAFLOW_BUILD_PYTHON="C:/path/to/py311/python.exe"
```

---

## 3. Build steps

Run from `aquaflow/desktop`:

| Command | What it does | Output |
|---------|--------------|--------|
| `npm run build:web` | Vite production build with `--base=./` (for `file://` loading) | `desktop/web/` |
| `npm run build:engine` | PyInstaller freezes the backend via `aquaflow-engine.spec` | `desktop/resources/engine/aquaflow-engine.exe` |
| `npm run pack` | Unpacked app dir (fast smoke test, no installer) | `desktop/dist/win-unpacked/` |
| `npm run dist` | Full build: web + engine + **NSIS installer** | `desktop/dist/AquaFlow Studio-Setup-<version>.exe` (+ `latest.yml`) |
| `npm start` | Run the shell in dev against a locally-built `web/` + dev engine | — |

A complete release build is just:

```bash
cd aquaflow/desktop
AQUAFLOW_BUILD_PYTHON="C:/py311/python.exe" npm run dist
```

---

## 4. Configuration the build/app needs

Resolved at runtime by `app-config.js` (priority: env → bundled `resources/app-config.json`
→ dev default):

| Key | Env var | Purpose |
|-----|---------|---------|
| `licenseSecret` | `AQUAFLOW_LICENSE_SECRET` | backend license HMAC secret (see security note in `app-config.js`) |
| `updateUrl` | `AQUAFLOW_UPDATE_URL` | auto-update feed (admin-only; MITM guard) |

For a provisioned installer, ship a `resources/app-config.json`:

```json
{ "licenseSecret": "…", "updateUrl": "https://updates.luxuryconworld.com/aquaflow/" }
```

---

## 5. Single source of version

**`aquaflow/desktop/package.json` `version` is the one and only version source.**

- `app.getVersion()` (About dialog, update comparison) reads it.
- `electron-builder` names the installer and writes `latest.yml` from it.
- `${version}` in `electron-builder.yml` `artifactName` derives from it.

Bump it with npm so the git tag stays in lockstep (see `RELEASE.md`):

```bash
cd aquaflow/desktop
npm version patch    # or minor / major  → updates package.json + creates a git tag
```

Do **not** hardcode the version anywhere else.

---

## 6. Verify

After a build, work through `AF-PKG-VERIFICATION-REPORT.md` (repo root) — it is the tickable
checklist for GUI, file association, auto-update, and installer behaviour.

The backend test suite (unchanged by packaging) still gates correctness:

```bash
cd aquaflow/backend && .venv/Scripts/python -m pytest
```
