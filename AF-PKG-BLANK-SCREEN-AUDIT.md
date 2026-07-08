# AquaFlow Desktop — Blank-Screen Audit (full pipeline, fix-once)

**Date:** 2026-07-08 · **Scope:** entire desktop packaging pipeline, source → installer → running app
**Outcome:** 6 real defects found (2 critical), all fixed in this commit; 2 suspected bugs disproven with evidence. **No engine rebuild required.**

---

## 1. Why the screen was blank — the actual failure chain

Three independent defects compounded, which is why one-at-a-time fixes kept "not working":

1. **[F2 — fixed in e647345, never yet built by CEO]** The Vite build emits
   `<script type="module" crossorigin …>`. Module scripts cannot be fetched over `file://`
   (CORS fetch from a null origin) → React never mounts → black `#root`.
   *Fix:* serve the UI over a loopback HTTP server (`ui-server.js`).
2. **[F1 — NEW, critical]** The backend prints a startup banner containing `✅` **at import**
   (`main.py:269`). When Electron spawns the engine its stdout is a **pipe**, and Python
   3.10–3.12 on Windows encodes pipes as **cp1252** → `UnicodeEncodeError` → **the engine dies
   instantly inside the app while running perfectly standalone in a terminal** (the console
   API handles Unicode; pipes don't). Reproduced and cured in this audit (see §4).
   *Fix:* launcher injects `PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1` — env applies before
   Python starts, so **the existing engine bundle is fixed without a rebuild**.
   (`engine_entry.py` also now self-reconfigures for future rebuilds.)
3. **[Masking effect]** If a standalone engine was left running on 8000 (as during manual
   testing), the app's health check passed against that **stale process** even when the app's
   own engine had crashed — hiding defect F1 completely.

## 2. All findings

| # | Finding | Verdict | Fix |
|---|---------|---------|-----|
| F1 | Engine crashes at import under piped cp1252 stdout (`✅` in safety banner) | **CRITICAL — reproduced** | `PYTHONIOENCODING=utf-8`+`PYTHONUTF8=1` in spawn env (launcher.js); `engine_entry.py` reconfigure for future builds |
| F2 | ESM + `crossorigin` unloadable over `file://` | CRITICAL (fixed e647345, unbuilt) | loopback `ui-server.js`, window loads `http://127.0.0.1:<uiPort>` |
| F3 | `web/` packed **inside app.asar**; ui-server streams with plain `fs`, which can't be trusted to read from the archive | HIGH (unverifiable here → made deterministic) | `asarUnpack: web/**` + `resolveWebRoot()` prefers `app.asar.unpacked` |
| F4 | `SafetyMonitorPanel.jsx` hardcoded `http://localhost:8000/api` | HIGH | uses shared `config.js` (`?api=` wins) |
| F5 | `showProgrammerApi.js` read wrong env var (`VITE_API_URL`) + hardcoded fallback (3 call sites) | HIGH | uses shared `config.js` `BACKEND_ORIGIN` |
| F6 | `desktop/.gitignore` used **inline comments** — gitignore treats them as part of the pattern, so `dist/`, `web/`, `resources/engine/` were **never ignored** | MEDIUM (repo hygiene; `git add -A` would commit installers) | comments moved to their own lines; `package-lock.json` now committed (`npm ci` needs it) |
| F7 | *Suspected:* backend CORS rejects the UI server's random port | **NOT A BUG** — `allow_origin_regex` allows any `localhost`/`127.0.0.1` port and has been in `main.py` since **July 2** (in the CEO's built engine). Empirically verified against the real middleware: `http://127.0.0.1:54321` → allowed; `http://evil…` → rejected | UI-server origin still injected via `AQUAFLOW_CORS_ORIGINS` (belt-and-braces) |
| F8 | *Suspected:* engine ignores `AQUAFLOW_PORT` | **NOT A BUG** — honored since AF-PKG-002 (in the CEO's bundle). It logged 8000 because `findFreePort(8000)` legitimately picked 8000 | `whenPort` (adopt engine's real port from its log) kept as belt-and-braces |

Other audit answers: launcher pipes **both** stdout+stderr and parses both for the port line (uvicorn logs to stderr) ✓ · packaged engine path `process.resourcesPath/engine/aquaflow-engine.exe` matches `extraResources` ✓ · both servers bind **127.0.0.1 only** (no firewall prompt) ✓ · `whenPort` falls back to the requested port after 8 s ✓ · splash → window → dialogs on every startup-failure path ✓ · DevTools auto-open unless `AQUAFLOW_DEVTOOLS=0` ✓ · MIME map covers js/mjs/css/html/svg/png/ico/json/map/woff/woff2/wasm ✓ · frontend WS uses `config.js WS_URL` (reads `?ws=`) ✓ · no `.env` file exists to bake overrides (only `.env.example`) ✓.

## 3. Does anything need REBUILDING?

| Artifact | Rebuild? | Why |
|----------|----------|-----|
| **Engine (PyInstaller)** | **NO** | F1 is fixed by env vars set before Python starts; CORS regex + `AQUAFLOW_PORT` already in the built bundle |
| **Frontend (web/)** | Yes — **automatic** | `npm run dist` runs `build:web` first; F4/F5 land by just building |
| **Installer (Electron)** | Yes | picks up main.js/launcher.js/ui-server.js/yml |

## 4. Verified in this environment

- **F1 reproduced + cured:** printing the exact banner char to a piped cp1252 stdout → exit 1 `UnicodeEncodeError`; with the launcher's new env → exit 0, clean UTF-8.
- **Full startup simulation (8/8):** real `startEngine`/`waitForHealth`/`startUiServer` + real web build in an `app.asar.unpacked` layout: unpacked path resolved; index.html + 199 KB module JS served with correct MIME; fake engine binding a *different* port than requested → `whenPort` adopted it; health passed on the adopted port; child env carried `PYTHONIOENCODING=utf-8` + CORS `null,<ui-origin>` + `AQUAFLOW_PORT`; final URL round-trips `?api`/`?ws` with the **engine** port.
- **CORS empirical:** real middleware allows `127.0.0.1:54321`, `localhost:49152`, `null`; rejects foreign origins; preflight OK.
- **Built bundle grep:** hardcoded `http://localhost:8000` reduced 3 chunks → 1 (the inert config SSR fallback, always overridden by `?api=`).
- **Suites:** backend pytest green (see commit message for count) · frontend vitest **231 passed** · `node --check` all 7 desktop JS files · `electron-builder.yml` parses, every referenced file exists.

**Not verifiable here (needs the Windows build machine):** the packaged `.exe` end-to-end (Electron GUI can't run in this sandbox). The instrumentation below shows exactly where it fails if it still does.

## 5. CEO — the one build (run exactly this)

### Step 0 — make sure no stale engine is running (it masks failures)
```powershell
taskkill /F /IM aquaflow-engine.exe 2>$null
taskkill /F /IM "AquaFlow Studio.exe" 2>$null
```

### Step 1 — get and VERIFY the code (never build stale again)
```powershell
cd <your clone>\aquaflow-phase1-stabilization-clean
git pull origin main
git log --oneline -3
git status
```
**Expected:** first `git log` line is the commit titled **"AF-PKG: Full blank-screen audit …"**; `git status` says *nothing to commit, working tree clean* (untracked `web/`, `dist/`, `resources/` entries are fine and now correctly ignored).

Then verify the fixes are in YOUR files:
```powershell
findstr /C:"PYTHONIOENCODING" aquaflow\desktop\launcher.js
findstr /C:"resolveWebRoot" aquaflow\desktop\main.js
findstr /C:"asarUnpack" aquaflow\desktop\electron-builder.yml
findstr /C:"BACKEND_ORIGIN" aquaflow\frontend\src\utils\showProgrammerApi.js
git hash-object aquaflow\desktop\main.js aquaflow\desktop\launcher.js aquaflow\desktop\ui-server.js
```
**Expected:** every `findstr` prints at least one line; the three hashes start with
`4d33e795f51b`, `591abeb45af3`, `4fc79b9ff2e9`. **If any of these don't match, STOP — you are on stale code; paste the output.**

### Step 2 — build (engine is NOT rebuilt; web is rebuilt automatically)
```powershell
cd aquaflow\desktop
$env:AQUAFLOW_LICENSE_SECRET = "<same secret as before>"
npm ci
npm run dist
```
*(If you prefer not to rebuild the engine: it isn't — `build:engine` just restages the existing exe. `npm run dist` takes ~5–15 min.)*

### Step 3 — install & run
Install `dist\AquaFlowSetup-1.0.0.exe` (SmartScreen → More info → Run anyway). DevTools opens automatically (debug build).

**SUCCESS looks like:** splash → main window with the full AquaFlow UI; DevTools Console has no red errors; Network tab shows `index.html`, `assets/*.js` from `127.0.0.1:<uiPort>` and `health` from `127.0.0.1:<enginePort>` — all 200.

**If it fails, paste ALL of:**
1. DevTools **Console** tab (right-click → Save as… or screenshot),
2. DevTools **Network** tab (any red rows),
3. Run it once from a terminal to capture main-process logs:
   ```powershell
   & "$env:LOCALAPPDATA\Programs\AquaFlow Studio\AquaFlow Studio.exe"
   ```
   and paste every `[aquaflow]` / `[engine]` line — they log: engine port, health PASS/FAIL, UI-server port, web root, the exact URL loaded, and any renderer error.
