# AF-NEXT-014 evidence: guided operator workspaces

Date: 2026-10-13. Scope: `aquaflow/frontend` only. Nothing in this ticket connects to, arms, starts, pulses or deploys to any equipment. The workspace guidance makes only read-only calls: `GET /api/siemens-sites`, `GET /api/hardware/commissioning`, and the AF-NEXT-009 preflight gate, which is read-only. Nothing is committed, because the worktree is shared.

## Behaviour before this ticket

- `App.jsx` switched on one flat `activePanel`. That value covers 34 panels: 32 `keepAlivePanel` slots plus the full-screen `geometry` and `show_programmer` panels.
- The panels were reachable only through seven top-bar menus: File, Edit, Design, Devices, Runtime, AI and Help.
  - The menus mixed old and new tools. For example, the Node editor sat next to the Engineering Designer, and Compile was listed under Runtime.
  - No menu indicated what to do next.
- The only guided flow was the Siemens Setup wizard.
- Some diagnostics already had navigation: Preflight issues (AF-NEXT-009) opened their clip or Engineering item.
- Other warnings had no route to their cause:
  - Generic-data trust warnings (AF-NEXT-012) appeared only inside individual panels.
  - Missing assets (AF-NEXT-006) were shown once in a modal and could not be found again afterwards.

## What was built

| Area | Files |
| --- | --- |
| Model (pure) | `src/workspaces/workspaceModel.js` defines the four workspaces and the panel catalog, `workspaceForPanel`, persistence, `buildProjectSnapshot`, `buildGuidance`, `nextStep` and `collectWorkspaceDiagnostics`. |
| Navigation | `src/workspaces/navigation.js` provides `openWorkspaceTarget` and `usePanelAction`. A request sent to a lazy panel is dispatched as `aquaflow:panel-action` and also parked until the panel mounts. This is the same pattern as `takePendingFocus`. Diagnostic fixes are handed to the existing `openDiagnosticFix`. |
| Signals | `src/workspaces/projectSignals.js` keeps the last preflight result (`aquaflow:preflight-result`) and the last asset report (`aquaflow:asset-report` / `-updated`). A project baseline clears both. |
| Controller | `src/workspaces/useWorkspaceController.js` stores the chosen workspace and keeps it in step with `activePanel`. It builds the live snapshot, guidance and diagnostics from the existing stores. It also provides "Run preflight", which compiles Show Studio patterns read-only when Show Studio has not been opened yet, and "Open pilot". |
| Pilot | `src/workspaces/pilotProject.js` opens `aquaflow/samples/lebu-pilot/Lebu_Fountain_Pilot.aqua` through the normal `openProjectBytes` loader. The file is bundled as a lazy 54 kB raw chunk. `vite.config.js` allows `../samples` on the dev server. |
| UI | `src/components/workspace/WorkspaceSwitcher.jsx` (top-bar tabs plus a Start button), `WorkspaceNav.jsx` (left nav, a "More in …" list and Help, collapsible), `GuidanceStrip.jsx` (next step, checklist and a Warnings list) and `StartCard.jsx`, styled by `workspace.css`. |
| App wiring (additive) | `App.jsx` adds the imports, the controller, the switcher passed into `TopBar`, the guidance strip, a `workspace-frame` around the existing `.workspace` with the nav, and the Start card. Every existing line is preserved, including the user's `PreviewShowTimeline` and `ProjectRecoveryHost` changes. |
| Top bar | `TopBar.jsx` and `topBarMenu.js`: when a switcher is supplied, the menus are **File · Edit · [Design Program Commission Operate · Start] · All tools · Help**. "All tools" contains every entry of the old Design, Devices, Runtime, AI and Help menus, with section headers, so every panel and every action is still available. `MENU_ITEMS` is unchanged. Without a switcher, the old seven menus render as before. |
| Panel deep links (small additive hooks) | `PLCPanel` (tab), `EngineeringToolsPanel` (tab, including Verified Models), `DeviceDiscoveryPanel` (tab), `DocumentationPanel` (article) and `PoolGeometryDesigner` ("cad-import" opens the existing `CADImportDialog`). |
| Supporting edits | `PreflightPanel.jsx` publishes its result. `preflight.js` adds `publishPreflightResult`. `ProjectRecoveryHost.jsx` emits `aquaflow:asset-report-updated` after a relink. `docs/articles.js` adds the bundled article "Safe Commissioning Procedure" (`safe-commissioning`), which points to `HARDWARE_COMMISSIONING_CHECKLIST.md` and `AF-HUB-011_COMMISSIONING_RECORD.md`. |

No new store was added. The chosen workspace is a per-user preference stored in localStorage under `aquaflow.workspace.v1`, with the last panel per workspace under `aquaflow.workspace.lastPanel.v1`. It is not written into the project document, so `.aqua` files are unchanged. The project facts are read from `engineeringStore`, `projectStore` and `showStore`.

## Workspaces (all reuse existing panels)

| Workspace | Primary nav | More in … (advanced / legacy) |
| --- | --- | --- |
| Design | Site & basin designer, Import CAD drawing, Hydraulics, Verified equipment models, Bill of materials, All engineering tools, 3D preview | Environments & materials, 3D export, Generative designer, Collaboration, Node editor (legacy) |
| Program | Show Studio (groups & patterns), 3D preview & show timeline, Pattern designer, Audio, Preflight & compile | Keyframes (legacy), Presets, AI assistant, AI optimization, Node editor (legacy) |
| Commission | Siemens setup & PLCSIM, I/O map, Device discovery, Protocols & generic PLC, Fountain control (I-CAN), Hardware test, Preflight & compile, Commissioning procedure | Calibration, Dependencies, PLC tag browser, Field I/O, Advanced Siemens site |
| Operate | Operator console, Scheduler, Safety monitor, Diagnostics, Live validation, Mobile monitoring | Wind drift safety, Digital twin, Autonomous adaptation, Fleet management, Global asset cloud |
| (every workspace) | Help: Documentation, Training academy | |

How the workspace and panel stay in step:

- **Opening a panel** by any route (All tools, an `aquaflow:open-panel` event, a diagnostic or a Go button) switches to that panel's workspace. A workspace that already lists the panel is kept; this applies to shared panels such as Preview and Compile, and to Help.
- **Switching workspace** restores the panel last used in that workspace.
- **On first run** (nothing stored), Design is selected, the Engineering Designer opens instead of the legacy Node editor, and the Start card appears.

## Project-specific guidance (reads real state)

| Workspace | Steps (status source) |
| --- | --- |
| Design | <ul><li>Basins: `basins.length` / geometry, with names, and whether they came from a drawing.</li><li>Units: `geometry.source.units` / `cadUnderlay.units`. A drawing without units gives a warning; a design drawn in AquaFlow is treated as metres.</li><li>Fixtures: count, plus Show Studio's unknown-type rule. Go selects the first unknown fixture through `open_engineering_item`.</li><li>Data trust: the AF-NEXT-012 `isVerifiedProvenance(getFixtureProvenance(f))`. Go opens Verified Models.</li><li>Tip: the hydraulics and splash preview.</li></ul> |
| Program | <ul><li>Groups: `programmer.studio.groups`.</li><li>Patterns: recipes and clips, with the show name and duration.</li><li>Tip: the 3D review.</li><li>Run preflight: not run, *N* errors (blocked), or done. The step has a **Run preflight** button.</li></ul> |
| Commission | <ul><li>Preflight (with the Siemens target when a site is chosen).</li><li>Siemens site: `integrations.siemensSiteId`.</li><li>**Test on PLCSIM**: `site.mode` and the compiled show, from GET `/siemens-sites`. The text says Verify and Test are operator actions in Siemens Setup and that AquaFlow never starts, arms or pulses a PLC from this checklist.</li><li>**Safe commissioning procedure**: "operator action", or "done" only when the backend reports `hardware_commissioned === true`. It opens the procedure article.</li></ul> |
| Operate | <ul><li>Commissioning status: a warning until the backend reports commissioned.</li><li>Preflight.</li><li>Tips: Scheduler, Safety monitor and Operator console.</li></ul> |

Every step has a **Go** action that opens the responsible panel or object.

## Every warning opens its responsible object or procedure

The Warnings list in the guidance strip is filtered by workspace.

| Warning | Action |
| --- | --- |
| Preflight issue with a fix | `openDiagnosticFix`: the clip in Show Studio (pending focus `clip`), the Engineering item (pending `engineering`), or a panel. |
| Hydraulics or splash diagnostic (merged into preflight by AF-NEXT-007/008) | Its fix if it has one; otherwise the 3D preview, which hosts the Engineering preview and Splash envelope. |
| Preflight issue without a fix | The Preflight & compile panel. |
| Unknown fixture type | Selects that fixture in the Engineering Designer. |
| Generic equipment data (AF-NEXT-012) | Engineering Tools → Verified Models tab. |
| Missing or changed project asset (AF-NEXT-006) | Re-opens the asset report dialog, which offers Locate… and Relink…. The list follows relinks. |

## Tests

New: `src/workspaces/__tests__/workspaces.test.jsx` (jsdom, testing-library, 10 tests). The harness wires the real controller and components exactly as `App.jsx` does, using the same `aquaflow:open-panel` handler and stores.

| Test | Covers |
| --- | --- |
| model coverage | <ul><li>The panel IDs parsed from `App.jsx` (34) equal `PANEL_CATALOG`, the menu panels, the panels reachable from workspaces, and the All tools panels.</li><li>Every menu action still exists in All tools, File, Edit or Help.</li></ul> |
| `workspaceForPanel` | Follows the panel; shared, Help and legacy panels resolve correctly. |
| switching | <ul><li>First run selects Design and the designer, and shows the Start card.</li><li>Switching changes the active panel and the nav.</li><li>An event-opened panel moves the workspace.</li><li>The last panel per workspace is restored.</li><li>The choice is persisted, and a second launch restores it with no Start card.</li></ul> |
| reachability | Clicks every nav, More and Help button in all four workspaces, which reaches all 34 panels. |
| guidance (pure) | Basins and drawing, units without a declaration, an unknown fixture (Go selects it), generic data, preflight errors that block, a PLCSIM site with a compiled show marked done, and the procedure step as an operator action. |
| guidance (live) | Store changes and a published preflight result update the checklist. |
| diagnostics | Each of the following is clicked and checked: <ul><li>open_clip opens Show Studio, with pending focus on `{clipId, itemId, timeMs}`.</li><li>A splash issue without a fix opens Preview.</li><li>A hydraulics item opens the Engineering Designer, with the engineering pending focus set.</li><li>Generic data opens Engineering Tools, with the Verified Models tab request parked.</li><li>A missing asset re-dispatches the asset report.</li></ul> |
| **walkthrough** | A new operator uses only the workspace UI, never the legacy menus: <ol><li>First-run Start card → **Open the pilot** (real `.aqua` through the real loader).</li><li>**Design**: "1 basin … from the drawing", units "meters", "39 fixtures", trust warning (honest: generic estimates).</li><li>**Program**: "6 groups", "Lebu Fountain · Pilot · 13 patterns · 60 s". The next step is Run preflight.</li><li>**Run preflight** from the strip. The gate receives 39 fixtures, 6 groups and compiled clips with a `preview` target, and Program is then "all done".</li><li>**Commission** opens Siemens Setup. The "Test on PLCSIM" step is shown with its no-auto-start note. Go parks the `setup` tab, and the procedure opens the `safe-commissioning` article. No Arm, Start show or Pulse control appears.</li></ol> |
| panel-side request | A request parked before the lazy Documentation panel mounts opens the procedure article on mount. |
| top bar | The switcher tabs and the File, Edit, All tools and Help menus render. Clicking each All tools panel item opens all 34 panels. |

## Command results

| Command | Result |
| --- | --- |
| `npx vitest run src/workspaces` | 10/10 passed. It also prints React `act()` warnings from the mocked async site/commissioning fetches; these are harmless. |
| `npx vitest run src/workspaces src/docs src/components/__tests__/topBarMenu.test.js src/preflight` | 5 files, all passed. |
| `npx vitest run` (full) | **104 files, 1100/1100 passed** on the final run. On an earlier run, one test failed: `components/preview/__tests__/sceneAdaptive.test.js › eco draws fewer, larger droplets`. That file belongs to AF-NEXT-013's untracked, in-progress adaptive-quality work, owned by the concurrent agent. It passed alone and passed on the rerun. |
| `npx vite build` | Built. Only the existing >750 kB `three`/`mediabunny` chunk warning appears. The pilot is its own lazy chunk, `Lebu_Fountain_Pilot-*.js`, 54 kB (7 kB gzip). |

## Screenshots

No screenshots were captured. The studio is behind `AppLicenseGate`, which needs the backend license service, and no backend or licensed desktop session was available to this agent. In the running app, the result is laid out as follows:

- **Top bar:** File, Edit, then the numbered tabs `1 Design · 2 Program · 3 Commission · 4 Operate` and a small Start button, then All tools and Help, followed by the existing show name, transport and E-stop.
- **Guidance strip:** a 30 px strip under the top bar reads "DESIGN · NEXT STEP ○ Import a CAD drawing or draw the basin — … [Import CAD →]". On the right are the Checklist n/m and Warnings N buttons, which open overlay lists.
- **Left nav:** a 184 px column, collapsible to 26 px, sits left of the existing panel area. Its title and hint are followed by the primary tools, "▸ More in Design (5)", and Help.

## Known limitations and field verification

- The PLCSIM step reads the site's mode and compiled show only. It does not read Verify or Test acceptance results, because those need the status endpoint that polls the PLC. Those checks remain operator actions in Siemens Setup.
- "Units confirmed" relies on the CAD import dialog's rule: it refuses a unitless drawing until a unit is chosen. A legacy project with a CAD underlay but no unit record shows a warning.
- The preflight shown in the guidance is the last run in this session. Opening another project clears it. Editing the show after a run does not mark it stale; re-run it before output.
- The Lebu pilot is a design and programming sample with **unmapped** hardware. Completing its walkthrough is not evidence of a commissioned installation. Physical commissioning follows `HARDWARE_COMMISSIONING_CHECKLIST.md` with the site's approved operator.

## Rollback

Remove the AF-NEXT-014 blocks from `App.jsx`: the imports, `guided`, the `workspaceSwitcher` prop, `GuidanceStrip`, the `workspace-frame`/`WorkspaceNav` wrapper and `StartCard`. `TopBar` then renders the original seven menus. The panel hooks and the article are inert without the workspace UI.
