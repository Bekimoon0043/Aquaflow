# AquaFlow Studio — Agent Reference

> This file is written for AI coding agents working on AquaFlow Studio. It assumes you know nothing about the project. Read it before making changes.

AquaFlow Studio is LuxuryCon's professional multimedia fountain show-control platform: design, engineering, programming, and operation of computer-controlled fountain shows. The current phase is **Tier A hardening** — software stabilization is in progress and real hardware commissioning is pending.

---

## 1. Project overview

AquaFlow is a desktop-first control platform with three runtime layers:

- **Frontend:** React 18 + Vite SPA. Runs in a browser for development, or is loaded by the Electron shell in production.
- **Backend:** Python FastAPI server with WebSocket real-time telemetry. The single playback authority is the `ShowEngine` at 100 Hz.
- **Desktop shell:** Electron + `electron-builder` + PyInstaller-bundled backend + NSIS installer.

The platform controls real fountain hardware over **Art-Net**, **Modbus TCP**, and **I-CAN** (LuxuryCon's internal CAN-style protocol). All physical output paths are gated by a **Safety Kernel** and coordinated through a single **Runtime Authority** so that any E-stop / blackout / fault path halts every output subsystem.

Current canonical status is tracked in `AQUAFLOW_STATUS_CANONICAL.md` and `CURRENT_STATUS.md`. The authoritative test numbers (as of the latest dated entries) are: backend pytest **532 passed / 21 skipped / 0 errors**, backend line coverage **59%**, frontend Vitest **231 passed (20 files)**, and `npm run build` green.

---

## 2. Technology stack

| Layer | Technology | Key files |
|-------|------------|-----------|
| Frontend UI | React 18, Vite 5, Zustand, Immer, Three.js | `aquaflow/frontend/package.json`, `aquaflow/frontend/vite.config.js` |
| Desktop shell | Electron 33, electron-builder 25, electron-updater | `aquaflow/desktop/package.json`, `aquaflow/desktop/main.js`, `aquaflow/desktop/electron-builder.yml` |
| Backend API | Python 3.10–3.14, FastAPI, Uvicorn, Pydantic v2, WebSockets | `aquaflow/backend/main.py`, `aquaflow/backend/requirements.txt` |
| Protocol drivers | pymodbus, aiomqtt, custom Art-Net / I-CAN UDP/CAN adapters | `aquaflow/backend/protocols/`, `aquaflow/backend/engine/protocol_bus.py` |
| Tests | pytest + pytest-cov (backend), Vitest (frontend) | `aquaflow/backend/pytest.ini`, `aquaflow/frontend/package.json` |
| Packaging | PyInstaller for backend, NSIS installer via electron-builder | `aquaflow/desktop/scripts/build-engine.js`, `aquaflow/desktop/electron-builder.yml` |

There is **no `pyproject.toml`, `setup.py`, or `package-lock.json` committed at the repository root**. Dependency management is per-subproject:
- `aquaflow/backend/requirements.txt`
- `aquaflow/frontend/package.json`
- `aquaflow/desktop/package.json`

---

## 3. Repository layout

```
.
├── AGENTS.md                         # this file
├── AQUAFLOW_STATUS_CANONICAL.md      # single source of project status
├── CURRENT_STATUS.md                 # dated progress log
├── FIRST-BUILD-GUIDE.md              # CEO-facing build guide
├── INSTALL-AND-LICENSE-GUIDE.md      # end-user install + license guide
├── aquaflow/                         # main application
│   ├── README.md                     # project structure summary
│   ├── frontend/                     # React + Vite SPA
│   │   ├── package.json
│   │   ├── vite.config.js
│   │   ├── .env.example
│   │   └── src/
│   │       ├── App.jsx
│   │       ├── main.jsx
│   │       ├── store/                # Zustand state
│   │       ├── components/           # UI components (panels, timeline, 3D preview, nodes)
│   │       ├── hooks/                # WebSocket, sync, autosave hooks
│   │       ├── utils/                # API client, runtime sync, show file I/O
│   │       ├── __tests__/            # frontend unit tests (Vitest)
│   │       └── ... (data, engineering, export3d, rendering, runtime, validation, video, walkthrough, weather)
│   ├── backend/                      # FastAPI backend
│   │   ├── main.py                   # app entry, lifespan, routes, WebSocket
│   │   ├── engine_entry.py           # PyInstaller entry point (production bundle)
│   │   ├── app_state.py              # singletons: show_engine, device_manager, protocol_bus
│   │   ├── requirements.txt
│   │   ├── pytest.ini
│   │   ├── engine/                   # show_engine, protocol_bus, runtime_authority, runtime_transport
│   │   ├── api/routes/               # FastAPI routers (~40 route modules)
│   │   ├── services/                 # domain services (fixture registry, hydraulic solver, BOM, etc.)
│   │   ├── safety/                   # safety kernel
│   │   ├── protocols/                # Art-Net, Modbus, MQTT, I-CAN drivers
│   │   ├── plc/                      # PLC engine
│   │   ├── scheduler/                # show scheduler
│   │   ├── audio/                    # audio analysis engine
│   │   ├── ai/                       # choreography / AI helpers
│   │   ├── license/                  # machine-locked license engine
│   │   ├── schemas/                  # Pydantic schemas
│   │   ├── tests/                    # pytest suite
│   │   └── tools/                    # small helper scripts
│   ├── desktop/                      # Electron + packaging
│   │   ├── main.js                   # Electron main process
│   │   ├── package.json
│   │   ├── electron-builder.yml      # installer config
│   │   ├── scripts/                  # build-web.js, build-engine.js, generate_brand_assets.py
│   │   ├── web/                      # generated Vite build (gitignored)
│   │   ├── resources/engine/         # generated aquaflow-engine.exe (gitignored)
│   │   └── dist/                     # generated installer (gitignored)
│   ├── lux-schema/                   # JSON schemas for show data exchange
│   ├── shows/                        # saved show files (.aqua)
│   ├── data/                         # runtime / training data
│   └── audio/                        # audio assets
├── audits_archive/                   # superseded audit reports (kept for history)
├── data/                             # runtime data at repo level
├── release/                          # release packages / ZIPs
├── backend/data/                     # backend runtime data
└── kitfolder/                        # network captures / ETL maps
```

There is also a stale-looking directory `aquaflow/{frontend` and a `aquaflow/aquaflow-phase8-advanced-platform-modules/` folder. These are present in the working tree; do not assume they are active source. The canonical frontend is `aquaflow/frontend/`.

---

## 4. Build and run commands

### Backend (development)

From `aquaflow/backend`:

```bash
# Production / bench / operator mode (NO auto-reload) — default
python main.py
```

```bash
# Developer mode only — auto-reload + file watchers
AQUAFLOW_DEV=1 python main.py
```

The backend defaults to host `0.0.0.0` and port `8000`. Override with:
- `AQUAFLOW_HOST`
- `AQUAFLOW_PORT`

`start-backend.cmd` at `aquaflow/start-backend.cmd` is also provided, but note it currently runs with `--reload`, which is unsafe on a bench/production machine.

### Frontend (development)

From `aquaflow/frontend`:

```bash
npm install
npm run dev          # Vite dev server, default port 3000
npm run build        # production build
npm run test         # vitest run
npm run test:watch   # vitest watch mode
```

The dev server proxies `/api` and `/ws` to `http://localhost:8000`. Create `.env.local` from `.env.example` if it is missing.

### Desktop build (Windows only)

From `aquaflow/desktop`:

```bash
npm ci
AQUAFLOW_LICENSE_SECRET="..." AQUAFLOW_BUILD_PYTHON="C:\path\to\py311\python.exe" npm run dist
```

Output: `aquaflow/desktop/dist/AquaFlowSetup-<version>.exe`.

Build sub-steps:
- `npm run build:web` — Vite production build into `desktop/web/`
- `npm run build:engine` — PyInstaller frozen backend into `desktop/resources/engine/aquaflow-engine.exe`
- `npm run dist` — full build + NSIS installer
- `npm run pack` — unpacked app dir only (fast smoke test)
- `npm start` — run the Electron shell against a local build

**Important:** PyInstaller currently does **not** support Python 3.13/3.14. The build machine must use **Python 3.10–3.12** for `AQUAFLOW_BUILD_PYTHON`. The dev backend can run on newer Python.

### One-shot install script

On Windows, run `aquaflow/install.cmd` to install frontend, build it, create a backend virtual environment, install requirements, and verify syntax. `aquaflow/verify-install.cmd` performs a frontend build and backend syntax check.

---

## 5. Test commands

### Backend tests

From `aquaflow/backend`:

```bash
python -m pytest          # full suite (quiet, colored)
python -m pytest --cov    # with line coverage (~59% target)
```

The suite currently has **532 passing, 21 skipped, 0 errors**. The skips are mostly contract tests that depend on a transient `EVALUATION_REPORT.md`. Tests import backend modules as top-level packages (`schema_adapter`, `services.*`, `engine.*`, etc.) because `pytest.ini` sets `pythonpath = .` and the working directory is expected to be `aquaflow/backend`.

`conftest.py` sets a test-only `AQUAFLOW_LICENSE_SECRET` so the suite passes from a clean checkout. This does not weaken production because a real environment secret always takes precedence.

### Frontend tests

From `aquaflow/frontend`:

```bash
npm run test
```

Tests live in `src/__tests__/` and in `__tests__/` folders next to the code they cover.

---

## 6. Code style and development conventions

- **Language:** English for all code comments, docstrings, and documentation.
- **Python:**
  - Modern Python 3.10+ syntax (union types with `|`, `dict[str, ...]`, etc.).
  - Modules are imported as top-level packages from within `aquaflow/backend`.
  - Shared singletons live in `app_state.py` and are registered there.
  - Safety-critical code uses defensive `try/except` around optional subsystem wiring so one missing import cannot break the whole app.
- **JavaScript / React:**
  - JSX files, functional components, Zustand for state.
  - Vite splits `three.js` into its own chunk; everything else from `node_modules` shares one `vendor` chunk to avoid circular chunk issues that previously caused a blank screen.
- **Naming:**
  - Backend routes: `something_routes.py` exporting a `router`.
  - Task IDs in comments start with `AF-HUB-` or `AF-PKG-` or `AQ-S1-` — preserve these references when editing related code.
- **File format:** shows use `.aqua` (backend JSON) and `.aquashow` (desktop file association). The desktop shell forwards `.aquashow` paths to the renderer on launch.

---

## 7. Configuration and environment variables

### Backend

| Variable | Purpose |
|----------|---------|
| `AQUAFLOW_LICENSE_SECRET` | HMAC secret for machine-locked licenses. **Required** in production and in the desktop bundle. |
| `AQUAFLOW_DEV` | `1` / `true` / `yes` / `on` enables uvicorn auto-reload. **Never** on a bench/production machine. |
| `AQUAFLOW_DEV_MODE` + `AQUAFLOW_UNSAFE_DEV` | Required together to enable the unsafe dev safety bypass; blocked on commissioned hardware. |
| `AQUAFLOW_ENV=dev` | Legacy dev-mode selector (still honored). |
| `AQUAFLOW_HOST` / `AQUAFLOW_PORT` | Bind address and port. |
| `AQUAFLOW_CORS_ORIGINS` | Comma-separated extra CORS origins. |

### Desktop bundle

The Electron shell reads runtime config via `app-config.js`:
- `resources/app-config.json` (bundled, gitignored)
- `AQUAFLOW_LICENSE_SECRET` env var
- `AQUAFLOW_UPDATE_URL` env var

`resources/app-config.json` must exist on the build machine before running `npm run dist`.

### Frontend

`aquaflow/frontend/.env.local` (created from `.env.example`):

```
VITE_API_BASE_URL=http://localhost:8000/api
VITE_WS_URL=ws://localhost:8000/ws
```

---

## 8. Key architecture principles

1. **Single playback authority:** `ShowEngine` owns the 100 Hz clock. `RuntimeTransport` is a driven mirror; it does not run its own loop.
2. **Single runtime authority:** `RuntimeAuthority` in `engine/runtime_authority.py` coordinates emergency stop, blackout, and recovery across the safety kernel, show engine, protocol bus, hardware output, and device manager.
3. **Single protocol bus:** `ProtocolBus` is instantiated once with `primary=True` in `app_state.py`; a second primary is refused.
4. **Safety kernel gates every emit:** `protocol_bus.set_safety_kernel(...)` and per-fixture intensity limits are applied before any hardware write.
5. **Fail-closed routing:** If a hardware output path cannot be verified as safe, it routes to a safe null/simulated sink rather than emitting to real devices.
6. **Honest hardware labeling:** `services/commissioning.py` tracks whether real hardware has been commissioned. The UI shows a "simulated output only" banner until commissioning is verified (AF-HUB-000C / AF-HUB-011).
7. **Bench safety lock:** `services/bench_safety.py` prevents the unsafe dev bypass from ever being active on a commissioned machine, regardless of environment flags.

---

## 9. Security considerations

- **License secret:** Treat `AQUAFLOW_LICENSE_SECRET` as a production secret. It is needed at backend import time. The test suite sets a throwaway secret in `conftest.py`; never commit a real secret.
- **Machine-locked licenses:** Licenses are bound to a machine fingerprint. The desktop activation flow validates a picked license against the engine before overwriting the active license, so a corrupt/wrong file cannot brick an existing activation.
- **Auto-update MITM guard:** The update feed URL is read from the bundled config or env var, not from the app binary, and is served over HTTPS. Tier A builds are unsigned; integrity relies on HTTPS + SHA512 in `latest.yml`.
- **CORS:** Default origins include localhost and `null` (Electron `file://`). Extra origins can be added via `AQUAFLOW_CORS_ORIGINS`.
- **Dev safety bypass:** `AQUAFLOW_UNSAFE_DEV` clears faults and skips watchdog checks. It only works together with `AQUAFLOW_DEV_MODE` and only on non-commissioned hardware. Do not leave it enabled on any machine connected to real outputs.
- **Do not use `--reload` in production:** Uvicorn's reloader can restart the process mid-show, dropping hardware output.

---

## 10. End-of-session standing instructions

Before ending any session always do these steps:

1. Update `CURRENT_STATUS.md` with today's progress.
2. Write session report to:
   `E:\Burook platform development\Luxurycon\LuxuryCon-AI-Hub\bridge\session-report.json`
3. Commit all changes to GitHub.
4. Push to origin main.

The `session-report.json` must always be written even if the session ends mid-task. If a task is incomplete write status as **"In Progress"** not **"Done"**.

### session-report.json format

```json
{
  "date": "2026-07-02",
  "session_end": "18:30",
  "tasks_completed": [
    {
      "task_id": "AQ-S1-001",
      "title": "Backend fixture-aware architecture",
      "status": "Done",
      "files_modified": ["show_engine.py", "protocol_bus.py"],
      "acceptance_criteria_met": 3,
      "acceptance_criteria_total": 3,
      "notes": "All criteria met. Pushed to GitHub."
    }
  ],
  "tasks_in_progress": [],
  "tasks_started_today": ["AQ-S1-001"],
  "github_commits": ["abc123 - Stage 1 P1 complete"],
  "blockers": [],
  "next_recommended_task": "AQ-S1-002",
  "session_summary": "Short summary of what was accomplished this session."
}
```

The LuxuryCon AI Command Hub reads this file automatically on startup and updates the Master Roadmap, Memory Hub session log, progress trackers, CEO Dashboard, and the Daily Briefing. Task IDs must match the roadmap exactly (e.g. `AQ-S1-002`).

---

## 11. Autonomous hub instructions

_(These rules govern automated tasks from the hub's Auto Mode. The End-of-Session rules above apply to manual sessions.)_

When any message begins with `LUXHUB-AUTO-2026:` this is an automated task from the LuxuryCon AI Command Hub. Follow these rules exactly:

**RULE 1:** Implement the task immediately without asking for clarification. Read the files, make the changes, test, commit, push.

**RULE 2:** When complete write the report to:
`E:\Burook platform development\Luxurycon\LuxuryCon-AI-Hub\bridge\session-report.json`

Report format:
```json
{
  "trigger": "LUXHUB-AUTO-2026",
  "date": "[today]",
  "session_end": "[current time]",
  "tasks_completed": [{
    "task_id": "[task ID from instruction]",
    "title": "[task title]",
    "status": "Done",
    "files_modified": ["list of files"],
    "acceptance_criteria_met": [number],
    "acceptance_criteria_total": [number],
    "notes": "[brief summary]"
  }],
  "github_commits": ["[commit hash] - [message]"],
  "next_recommended_task": "[next task ID]",
  "session_summary": "[what was done]"
}
```

**RULE 3:** Do NOT write `session-report.json` for any message that does NOT start with `LUXHUB-AUTO-2026:`.

**RULE 4:** After writing `session-report.json` post a brief confirmation in chat:
`LUXHUB-COMPLETE: [task ID] done. Report written to bridge folder.`

**RULE 5:** If the task fails or has errors write:
```json
{
  "trigger": "LUXHUB-AUTO-2026",
  "task_id": "[task ID]",
  "status": "Failed",
  "error": "[what went wrong]",
  "partial_work": "[what was completed]"
}
```
And post in chat:
`LUXHUB-ERROR: [task ID] failed. See report for details.`

---

## 12. Useful references

- `AQUAFLOW_STATUS_CANONICAL.md` — current project status and AF-HUB task list.
- `CURRENT_STATUS.md` — dated progress log.
- `FIRST-BUILD-GUIDE.md` — CEO-facing Windows installer build guide.
- `INSTALL-AND-LICENSE-GUIDE.md` — how end users install and activate.
- `aquaflow/desktop/BUILD.md` — developer desktop build reference.
- `aquaflow/backend/pytest.ini` — pytest configuration.
- `aquaflow/frontend/vite.config.js` — Vite build and proxy configuration.
- `aquaflow/desktop/electron-builder.yml` — installer and auto-update configuration.
