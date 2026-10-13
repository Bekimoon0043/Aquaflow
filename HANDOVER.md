# Session Handover — LuxuryCon Platforms

> **AF-NEXT-015 update (2026-10-13):** controller support and physical evidence are now
> separate in Device Discovery. Every catalog/device class is labeled **simulated**,
> **bench verified**, **site commissioned**, or **unsupported**, with its evidence scope.
> The specific `192.168.5.2` I-CAN path is **bench verified**; no entry is currently
> **site commissioned**. Art-Net/sACN loopback passed 5/5 and the focused PLC/protocol
> simulator set passed 223/223. Physical sign-off remains mandatory. See
> `docs/evidence/AF-NEXT-015.md`.

> **AUTHORITATIVE AquaFlow numbers (2026-07-06, AF-HUB Stage 7):** backend pytest **532
> passed, 21 skipped, 0 errors** · line coverage **59%** · frontend vitest **231 passed** ·
> build green. See `AQUAFLOW_STATUS_CANONICAL.md`. Older counts below are point-in-time.

**Date:** 2026-07-05
**Purpose:** Bring a fresh session up to speed with zero re-derivation. Read this first.

---

## 1. What you're working on (3 repos)

| Repo (local path) | Role | HEAD commit | Pushed? |
| --- | --- | --- | --- |
| `Luxurycon/aquaflow-phase1-stabilization-clean` | **AquaFlow Studio** — fountain control platform (primary) | `62caab7` EVAL-AQ-003 | ✅ origin/main |
| `Luxurycon/luxurycon-forex` | **Forex AI** — MT5/Exness connectivity (new) | `c56eb64` FX-S1-001 | ❌ **local only, no remote** |
| `Luxurycon/LuxuryCon-AI-Hub` | **AI Command Hub** — roadmap SPA (`index.html`) + bridge | `8029d39` HUB-008 report | ✅ origin/main |

GitHub org: `burook-Luxury`. Git user: Burook <burookm@gmail.com>.

---

## 2. Current status per repo

### AquaFlow Studio (primary)
- **Stages 1–5 complete in code.** AQ-X recovery series done **except AQ-X-016** (3D export bridge — not started).
- **Tests green:** backend `pytest` **532 passed, 21 skipped**, frontend `vitest` **231 passed**, `npm run build` green (line coverage 59%).
- **Run it locally** (two terminals):
  - Backend: `cd aquaflow/backend && .\.venv\Scripts\Activate.ps1 && python main.py` → http://localhost:8000 (`/docs` for API)
  - Frontend: `cd aquaflow/frontend && npm run dev` → http://localhost:3000 (Vite proxies `/api`,`/ws` → :8000)
  - `.venv` and `node_modules` already installed. Backend is Python **3.14**.
- **Uncommitted at repo root** (audit deliverables from the last task — decide whether to keep/commit/ignore):
  `AquaFlow_Full_Audit_Package_20260705.zip`, `AquaFlow_File_Tree_20260705.txt`, and this `HANDOVER.md`.
  (`EVALUATION_REPORT.md`, `fix_strategy_*` are already committed.)

### Forex AI (FX-S1-001 — MT5 Exness connectivity)
- Demo-only, safety-gated MT5 connectivity layer. `validate_mt5_connectivity.py` **41/41**, `pytest` **24 passed**.
- **`MetaTrader5` is dependency-injected** (never imported at module top) — the app runs anywhere; a faithful in-memory `FakeMT5` simulator drives all tests. Real terminal not available in this environment.
- **Two open items:** (a) create the `luxurycon-forex` GitHub remote and push `c56eb64`; (b) real-terminal validation on a Windows host with Exness demo creds.

### AI Command Hub (`index.html` single-file SPA)
- HUB-008 added render + export tasks: **LuxuryForm 66**, **LuxuryScape 77**, **AQ-X series 16** (added AQ-X-016). Badges `renderStudio`/`universalExport`; `LS-R-001` depends on `LF-R-001` (shared render core).
- Roadmap persists in localStorage; `RM_SEED_VER` gate merges new tasks. Currently **`RM_SEED_VER = "7"`** — bump it when you add tasks to a seed function so existing installs pick them up.
- Verified headlessly (python http.server + preview): zero console errors, counts confirmed.

---

## 3. How the autonomous task loop works (READ — this drives most work)

Tasks arrive as messages starting with `LUXHUB-AUTO-2026:`. Standing rules (`CLAUDE.md`):
1. **Implement immediately** — no clarifying questions. Read files → implement → verify against acceptance criteria.
2. Run `npm run build` if frontend changed; run the test suites.
3. **Commit** with the task's exact message; end commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Branch off main first if needed.
4. **Push** to origin main (when a remote exists).
5. **Write** `Luxurycon/LuxuryCon-AI-Hub/bridge/session-report.json` in the LUXHUB-AUTO-2026 format (the hub auto-ingests it on startup). Only write this file for `LUXHUB-AUTO-2026:` messages.
6. Post `LUXHUB-COMPLETE: <task-id>` in chat.
7. For AquaFlow work also update `CURRENT_STATUS.md`.

Each engine/task follows the same shape: a service in `backend/services/`, a FastAPI router in `backend/api/routes/` wired in `main.py`, a `validate_<name>.py` scenario harness (hand-checked), a `tests/test_<name>.py` pytest, and (if UI) a panel in `frontend/src/components/panels/` wired into `App.jsx` + `TopBar.jsx`.

---

## 4. Open / pending items (start here)

1. **AQ-FIX-001 — physical-hardware output commissioning (P0, safety).** Output is only loopback-verified; the first real DMX/Art-Net/sACN fixture bring-up is outstanding and must gate any live site. Checklist: `aquaflow/docs/commissioning_checklist.md`. **Cannot run in CI** (needs hardware).
2. **AQ-X-016 — AquaFlow 3D Export Bridge** (roadmap, not started): export the 3D scene to glTF/GLB, FBX, OBJ/MTL, USD.
3. **luxurycon-forex:** create GitHub remote + push `c56eb64`; then real-terminal MT5 validation.
4. **Test-coverage follow-ups** (from EVALUATION_REPORT §6): broader UI→API→engine journey tests; `pytest --cov`; frontend component/DOM tests (jsdom not installed).
5. Decide on the uncommitted audit-package artifacts at the AquaFlow repo root.

See generated `OPEN_ISSUES.md` / `NEXT_TASKS.md` inside the audit ZIP for the full list; source of truth is `EVALUATION_REPORT.md` and `docs/reviews/fix_strategy_report.md`.

---

## 5. Gotchas / lessons from this session (save yourself the pain)

- **Bash heredocs mangle regex backslashes** on this Windows/Git-Bash setup (`\\s` → `\s` → broke a validation harness). Write JS/Node helper scripts with the **Write tool**, not `cat <<'EOF'`.
- **vitest env is `node`** (no DOM/localStorage/jsdom). Only pure-function/engine tests run headlessly; DOM shims needed otherwise. `jsdom` is **not** a dependency.
- **`MetaTrader5`** is Windows-terminal-bound and not installed — always inject it; verify against `FakeMT5`.
- **Preview server** (`preview_start`) runs from the **primary working dir** (aquaflow), not other repos — to preview the hub, point a `python -m http.server --directory <hub>` config there (and clean it up after).
- Windows shows `LF will be replaced by CRLF` warnings on `git add` — harmless.
- The hub is one big `index.html`; validate edits with a headless Node parse (`vm.Script`) + a targeted seed-function eval before committing.

---

## 6. Key files map

- AquaFlow status/roadmap: `CURRENT_STATUS.md` (root), `aquaflow/docs/MASTER_ROADMAP_ChatGPT_v1.0.txt`
- Evaluation + fixes: `EVALUATION_REPORT.md`, `fix_strategy_report.md`, `fix_strategy_queue.json` (root)
- Test index: `aquaflow/TESTING.md`, `aquaflow/docs/TEST_COVERAGE_MAP.md`
- Backend entry: `aquaflow/backend/main.py` (uvicorn on 0.0.0.0:8000, `python main.py`)
- Frontend shell: `aquaflow/frontend/src/App.jsx` (default panel `nodes`), menus in `components/TopBar.jsx`
- Hub roadmap seeds: `LuxuryCon-AI-Hub/index.html` → `seedLuxuryformTasks()`, `seedLuxuryscapeTasks()`, `RECOVERY_TASKS`
- Bridge handoff: `LuxuryCon-AI-Hub/bridge/session-report.json`
- Forex layer: `luxurycon-forex/backend/services/mt5_*.py`, `validate_mt5_connectivity.py`

---

## 7. First actions for the new session
1. Read this file, then `CURRENT_STATUS.md`.
2. If a `LUXHUB-AUTO-2026:` task is waiting → follow §3.
3. Otherwise, the highest-value open work is **AQ-X-016** (3D export) or pushing **luxurycon-forex** to a new remote (§4).
4. Sanity check before big changes: `cd aquaflow/backend && python -m pytest -q` (expect 532 passed, 21 skipped) and `cd aquaflow/frontend && npx vitest run` (expect 231).
