/**
 * workspaceModel.js — AF-NEXT-014 guided operator workspaces (pure, no React/stores).
 *
 * Four journeys — Design, Program, Commission, Operate — group the EXISTING panels that
 * App.jsx renders (no new editors). Each workspace has a primary nav, a "More in …" list
 * (legacy / advanced panels stay discoverable) and a project-specific checklist built
 * from a snapshot of real project state (buildGuidance). Diagnostics shown in a workspace
 * (collectWorkspaceDiagnostics) always carry the action that opens the responsible object
 * or procedure. Navigation only: nothing here connects, arms, starts or pulses hardware.
 *
 * Target: { panel, action?, detail? } — performed by navigation.js openWorkspaceTarget().
 */

export const WORKSPACE_STORAGE_KEY = "aquaflow.workspace.v1";
export const WORKSPACE_LAST_PANEL_KEY = "aquaflow.workspace.lastPanel.v1";
export const DEFAULT_WORKSPACE = "design";

/** Every panel App.jsx can show. A test keeps this in sync with App.jsx and the menus. */
export const PANEL_CATALOG = Object.freeze({
  geometry: "Engineering Designer",
  show_programmer: "Show Studio",
  nodes: "Node Editor",
  preview: "3D Preview",
  ai: "AI Assistant",
  devices: "Device Discovery",
  fountain: "Fountain Control (I-CAN)",
  audio: "Audio",
  plc: "PLC / Siemens Setup",
  scheduler: "Scheduler",
  safety: "Safety Monitor",
  operator: "Operator Console",
  diagnostics: "Diagnostics",
  dependencies: "Dependencies",
  validation: "Live Validation",
  wind: "Wind Drift Safety",
  engtools: "Engineering Tools",
  mobilemon: "Mobile Monitoring",
  collab: "Collaboration",
  envmaterial: "Environments & Materials",
  academy: "Training Academy",
  docs: "Documentation Center",
  twin: "Digital Twin",
  optimize: "AI Optimization",
  adaptation: "Autonomous Adaptation",
  fleet: "Fleet Management",
  cloud: "Global Asset Cloud",
  generative: "Generative Designer",
  compile: "Compile & Preflight",
  presets: "Presets",
  calibration: "Calibration",
  keyframes: "Keyframes",
  patterns: "Pattern Designer",
  export3d: "3D Export",
});

const entry = (id, label, panel, extra = {}) => ({ id, label, target: { panel, ...extra } });
const tab = (_panel, tabId) => ({ action: "tab", detail: { tab: tabId } });

export const COMMISSIONING_ARTICLE = "safe-commissioning";

export const WORKSPACES = Object.freeze([
  {
    id: "design",
    label: "Design",
    hint: "Site, basins, CAD drawing, fixtures, hydraulics and equipment data",
    nav: [
      entry("design-designer", "Site & basin designer", "geometry"),
      entry("design-cad", "Import CAD drawing", "geometry", { action: "cad-import" }),
      entry("design-hydraulics", "Hydraulics", "engtools", tab("engtools", "hydraulics")),
      entry("design-verified", "Verified equipment models", "engtools", tab("engtools", "verified")),
      entry("design-bom", "Bill of materials", "engtools", tab("engtools", "bom")),
      entry("design-engtools", "All engineering tools", "engtools"),
      entry("design-preview", "3D preview", "preview"),
    ],
    more: [
      entry("design-envmaterial", "Environments & materials", "envmaterial"),
      entry("design-export3d", "3D export", "export3d"),
      entry("design-generative", "Generative designer", "generative"),
      entry("design-collab", "Collaboration", "collab"),
      entry("design-nodes", "Node editor (legacy)", "nodes"),
    ],
  },
  {
    id: "program",
    label: "Program",
    hint: "Groups, patterns, timeline, audio, preview and preflight",
    nav: [
      entry("program-studio", "Show Studio (groups & patterns)", "show_programmer"),
      entry("program-preview", "3D preview & show timeline", "preview"),
      entry("program-patterns", "Pattern designer", "patterns"),
      entry("program-audio", "Audio", "audio"),
      entry("program-preflight", "Preflight & compile", "compile"),
    ],
    more: [
      entry("program-keyframes", "Keyframes (legacy)", "keyframes"),
      entry("program-presets", "Presets", "presets"),
      entry("program-ai", "AI assistant", "ai"),
      entry("program-optimize", "AI optimization", "optimize"),
      entry("program-nodes", "Node editor (legacy)", "nodes"),
    ],
  },
  {
    id: "commission",
    label: "Commission",
    hint: "Controllers, Siemens/PLCSIM, I/O map, tests and the commissioning procedure",
    nav: [
      entry("commission-siemens", "Siemens setup & PLCSIM", "plc", tab("plc", "setup")),
      entry("commission-iomap", "I/O map", "plc", tab("plc", "map")),
      entry("commission-devices", "Device discovery", "devices"),
      entry("commission-protocols", "Protocols & generic PLC", "plc", tab("plc", "connect")),
      entry("commission-ican", "Fountain control (I-CAN)", "fountain"),
      entry("commission-test", "Hardware test", "devices", tab("devices", "test")),
      entry("commission-preflight", "Preflight & compile", "compile"),
      entry("commission-procedure", "Commissioning procedure", "docs", { action: "article", detail: { articleId: COMMISSIONING_ARTICLE } }),
    ],
    more: [
      entry("commission-calibration", "Calibration", "calibration"),
      entry("commission-dependencies", "Dependencies", "dependencies"),
      entry("commission-tags", "PLC tag browser", "plc", tab("plc", "tags")),
      entry("commission-fieldio", "Field I/O", "plc", tab("plc", "fieldio")),
      entry("commission-site", "Advanced Siemens site", "plc", tab("plc", "site")),
    ],
  },
  {
    id: "operate",
    label: "Operate",
    hint: "Playback, scheduling, monitoring and status",
    nav: [
      entry("operate-operator", "Operator console", "operator"),
      entry("operate-scheduler", "Scheduler", "scheduler"),
      entry("operate-safety", "Safety monitor", "safety"),
      entry("operate-diagnostics", "Diagnostics", "diagnostics"),
      entry("operate-validation", "Live validation", "validation"),
      entry("operate-mobile", "Mobile monitoring", "mobilemon"),
    ],
    more: [
      entry("operate-wind", "Wind drift safety", "wind"),
      entry("operate-twin", "Digital twin", "twin"),
      entry("operate-adaptation", "Autonomous adaptation", "adaptation"),
      entry("operate-fleet", "Fleet management", "fleet"),
      entry("operate-cloud", "Global asset cloud", "cloud"),
    ],
  },
]);

/** Shown at the bottom of every workspace nav. */
export const HELP_ENTRIES = Object.freeze([
  entry("help-docs", "Documentation", "docs"),
  entry("help-academy", "Training academy", "academy"),
]);

export const WORKSPACE_IDS = WORKSPACES.map(w => w.id);
export const isWorkspaceId = id => WORKSPACE_IDS.includes(id);
export const getWorkspace = id => WORKSPACES.find(w => w.id === id) || WORKSPACES[0];
export const workspaceEntries = (id, { includeMore = true, includeHelp = true } = {}) => {
  const ws = getWorkspace(id);
  return [...ws.nav, ...(includeMore ? ws.more : []), ...(includeHelp ? HELP_ENTRIES : [])];
};
export const workspaceHasPanel = (id, panel) => workspaceEntries(id).some(e => e.target.panel === panel);

/** Panels reachable from any workspace (nav, more or help). */
export function reachablePanels() {
  const set = new Set();
  for (const ws of WORKSPACES) for (const e of workspaceEntries(ws.id)) set.add(e.target.panel);
  return set;
}

/**
 * Which workspace should show `panel`: the current one when it already lists it, else the
 * first workspace with it in its primary nav, else in its "more" list, else unchanged.
 */
export function workspaceForPanel(panel, current = DEFAULT_WORKSPACE) {
  if (!panel) return current;
  // Help panels are listed in every workspace, so they never force a switch.
  if (isWorkspaceId(current) && workspaceHasPanel(current, panel)) return current;
  const primary = WORKSPACES.find(w => w.nav.some(e => e.target.panel === panel));
  if (primary) return primary.id;
  const secondary = WORKSPACES.find(w => w.more.some(e => e.target.panel === panel));
  return secondary ? secondary.id : current;
}

/** The panel to open when switching into a workspace. */
export function defaultPanelFor(id, lastPanels = {}) {
  const remembered = lastPanels?.[id];
  if (remembered && workspaceHasPanel(id, remembered)) return remembered;
  return getWorkspace(id).nav[0].target.panel;
}

// ─── persistence ────────────────────────────────────────────────────────────

const safeStorage = storage => {
  if (storage) return storage;
  try { return globalThis.window?.localStorage || null; } catch { return null; }
};

/** { workspace, firstRun } — first run (nothing stored) always starts in Design. */
export function loadWorkspaceChoice(storage) {
  const s = safeStorage(storage);
  let stored = null;
  try { stored = s?.getItem(WORKSPACE_STORAGE_KEY) || null; } catch { stored = null; }
  return isWorkspaceId(stored) ? { workspace: stored, firstRun: false } : { workspace: DEFAULT_WORKSPACE, firstRun: true };
}

export function saveWorkspaceChoice(id, storage) {
  if (!isWorkspaceId(id)) return;
  try { safeStorage(storage)?.setItem(WORKSPACE_STORAGE_KEY, id); } catch { /* private mode */ }
}

export function loadLastPanels(storage) {
  try { return JSON.parse(safeStorage(storage)?.getItem(WORKSPACE_LAST_PANEL_KEY) || "{}") || {}; } catch { return {}; }
}

export function saveLastPanel(id, panel, storage) {
  if (!isWorkspaceId(id) || !panel) return;
  try {
    const all = loadLastPanels(storage);
    all[id] = panel;
    safeStorage(storage)?.setItem(WORKSPACE_LAST_PANEL_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

// ─── project snapshot ───────────────────────────────────────────────────────

const unitName = u => (typeof u === "string" ? u : u && typeof u === "object" ? (u.name || u.key || null) : null);

/**
 * Reduce store state to what the guidance needs. Inputs are plain values so this is
 * testable without React. `fixtureInfo(f)` → { unknown, verified } is injected.
 */
export function buildProjectSnapshot({
  engineering = {}, programmer = null, integrations = {}, show = {}, preflight = null,
  assets = null, siemens = null, commissioning = null, fixtureInfo = () => ({ unknown: false, verified: false }),
} = {}) {
  const fixtures = Array.isArray(engineering.fixtures) ? engineering.fixtures : [];
  const basins = Array.isArray(engineering.basins) ? engineering.basins : [];
  const geometry = engineering.geometry || null;
  const underlay = engineering.cadUnderlay || null;
  const cadImported = Boolean(underlay || geometry?.source?.file || geometry?.source?.layer
    || fixtures.some(f => f?.cadHandle || f?.cadLayer));
  const units = unitName(geometry?.source?.units) || unitName(underlay?.units) || null;
  const unitless = Boolean(underlay?.units?.unitless && !underlay?.units?.overridden);
  const unknownIds = [], genericIds = [];
  for (const f of fixtures) {
    const info = fixtureInfo(f) || {};
    if (info.unknown) unknownIds.push(String(f.id));
    if (!info.verified) genericIds.push(String(f.id));
  }
  const studio = programmer?.studio || {};
  const items = assets?.report?.items || [];
  const site = siemens?.site || null;
  return {
    design: {
      fixtures: fixtures.length,
      basins: basins.length || (geometry ? 1 : 0),
      basinNames: basins.map(b => b?.name).filter(Boolean),
      cadImported,
      units: !cadImported ? { status: "native", name: "metres" } : unitless || !units ? { status: "unconfirmed", name: units } : { status: "confirmed", name: units },
      unknownFixtureIds: unknownIds,
      genericFixtureIds: genericIds,
    },
    program: {
      showName: show?.name || "",
      duration: Number(show?.duration) || 0,
      groups: Array.isArray(studio.groups) ? studio.groups.length : 0,
      recipes: Array.isArray(studio.recipes) ? studio.recipes.length : 0,
      clips: Array.isArray(programmer?.timelineClips) ? programmer.timelineClips.length : 0,
    },
    preflight: preflight ? {
      ran: true, errors: preflight.summary?.errors || 0, warnings: preflight.summary?.warnings || 0,
      target: preflight.target?.kind || preflight.targetKind || "preview", at: preflight.at || null,
      issues: Array.isArray(preflight.issues) ? preflight.issues : [],
    } : { ran: false, errors: 0, warnings: 0, issues: [] },
    siemens: {
      siteId: integrations?.siemensSiteId || null,
      known: Boolean(siemens?.known),
      site: site ? { id: site.id, name: site.name || site.id, mode: site.mode || "simulated", compiledClips: site.show?.clips?.length || 0 } : null,
      error: siemens?.error || null,
    },
    commissioning: { known: Boolean(commissioning?.known), commissioned: commissioning?.commissioned === true },
    assets: {
      missing: items.filter(i => i.status === "missing"),
      changed: items.filter(i => i.status === "changed"),
    },
  };
}

// ─── guidance ───────────────────────────────────────────────────────────────

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DESIGNER = { panel: "geometry" };
const CAD_IMPORT = { panel: "geometry", action: "cad-import" };
const STUDIO = { panel: "show_programmer" };
const PREFLIGHT = { panel: "compile" };
const SIEMENS_SETUP = { panel: "plc", action: "tab", detail: { tab: "setup" } };
const PROCEDURE = { panel: "docs", action: "article", detail: { articleId: COMMISSIONING_ARTICLE } };
const VERIFIED = { panel: "engtools", action: "tab", detail: { tab: "verified" } };

function preflightStep(snap, id, extra = "") {
  const p = snap.preflight;
  return {
    id, title: "Run preflight",
    status: !p.ran ? "todo" : p.errors > 0 ? "blocked" : "done",
    detail: !p.ran ? `Check the resolved show for missing links, conflicts and unsafe transitions before any output.${extra}`
      : `${plural(p.errors, "error")}, ${plural(p.warnings, "warning")} (${p.target} target). ${p.errors > 0 ? "Errors block hardware output — open them below." : "No blocking errors."}`,
    go: { label: "Open preflight", target: PREFLIGHT },
    runPreflight: true,
  };
}

/** Project-specific checklist per workspace. Steps: {id,title,status,detail,go:{label,target}}. */
export function buildGuidance(snap) {
  const d = snap.design, p = snap.program, s = snap.siemens, c = snap.commissioning;
  const firstUnknown = d.unknownFixtureIds[0];
  const design = [
    {
      id: "design-basins", title: d.cadImported ? "CAD drawing imported" : "Import a CAD drawing or draw the basin",
      status: d.basins > 0 ? "done" : "todo",
      detail: d.basins > 0 ? `${plural(d.basins, "basin")}${d.basinNames.length ? ` (${d.basinNames.slice(0, 3).join(", ")})` : ""}${d.cadImported ? " from the drawing" : ""}.`
        : "No basin yet. Import the site DWG/DXF (or draw a basin) in the Engineering Designer.",
      go: d.basins > 0 ? { label: "Open designer", target: DESIGNER } : { label: "Import CAD", target: CAD_IMPORT },
    },
    {
      id: "design-units", title: "Confirm drawing units",
      status: d.units.status === "confirmed" || d.units.status === "native" ? "done" : d.basins > 0 ? "warn" : "todo",
      detail: d.units.status === "native" ? "Drawn in AquaFlow — metres." : d.units.status === "confirmed" ? `Drawing units: ${d.units.name}.`
        : "The imported drawing has no confirmed units. Re-import it and choose its real units.",
      go: { label: "CAD import", target: CAD_IMPORT },
    },
    {
      id: "design-fixtures", title: "Place and confirm fixtures",
      status: d.fixtures === 0 ? "todo" : d.unknownFixtureIds.length ? "warn" : "done",
      detail: d.fixtures === 0 ? "No fixtures yet. Place nozzles, lights, pumps and valves (or import them from the drawing)."
        : d.unknownFixtureIds.length ? `${plural(d.unknownFixtureIds.length, "fixture")} ha${d.unknownFixtureIds.length === 1 ? "s" : "ve"} an unknown type — choose a valid type.`
        : `${plural(d.fixtures, "fixture")} with known types.`,
      go: firstUnknown ? { label: "Select fixture", target: DESIGNER, fix: { kind: "open_engineering_item", target: firstUnknown } } : { label: "Open designer", target: DESIGNER },
    },
    {
      id: "design-trust", title: "Equipment data trust",
      status: d.fixtures === 0 ? "todo" : d.genericFixtureIds.length ? "warn" : "done",
      detail: d.fixtures === 0 ? "Place fixtures first." : d.genericFixtureIds.length
        ? `${plural(d.genericFixtureIds.length, "fixture")} use${d.genericFixtureIds.length === 1 ? "s" : ""} generic estimates — link verified manufacturer or measured models before sizing equipment.`
        : "Every fixture uses verified (datasheet or measured) data.",
      go: { label: "Verified models", target: VERIFIED },
    },
    {
      id: "design-preview", title: "Check hydraulics & splash in 3D",
      status: "info",
      detail: "Use the 3D preview's Engineering preview and Splash envelope (advisory, not field calibrated).",
      go: { label: "Open 3D preview", target: { panel: "preview" } },
    },
  ];
  const program = [
    {
      id: "program-groups", title: "Create fixture groups",
      status: d.fixtures === 0 ? "blocked" : p.groups > 0 ? "done" : "todo",
      detail: d.fixtures === 0 ? "Design fixtures first (Design workspace)." : p.groups > 0 ? `${plural(p.groups, "group")} in Show Studio.` : "Group fixtures in Show Studio (Groups panel or auto-groups).",
      go: { label: "Open Show Studio", target: STUDIO },
    },
    {
      id: "program-patterns", title: "Create patterns on the timeline",
      status: p.groups === 0 ? "todo" : p.recipes > 0 || p.clips > 0 ? "done" : "todo",
      detail: p.recipes > 0 || p.clips > 0
        ? `${p.showName ? `“${p.showName}” · ` : ""}${plural(p.recipes, "pattern")}${p.duration ? ` · ${Math.round(p.duration)} s` : ""}.`
        : "Drag a pattern onto a group in Show Studio.",
      go: { label: "Open Show Studio", target: STUDIO },
    },
    {
      id: "program-preview", title: "Review the show in 3D",
      status: "info",
      detail: "The 3D preview plays the same show frame as the timeline and compiler.",
      go: { label: "Open 3D preview", target: { panel: "preview" } },
    },
    preflightStep(snap, "program-preflight"),
  ];
  const mode = s.site?.mode;
  const commission = [
    preflightStep(snap, "commission-preflight", s.siteId ? "" : " Choose a Siemens site to check that controller."),
    {
      id: "commission-site", title: "Create a Siemens site from the design",
      status: s.siteId ? "done" : "todo",
      detail: s.siteId ? `Site: ${s.site?.name || s.siteId}.` : "Siemens Setup builds the site, wiring and TIA export from your designed pumps, valves and lights.",
      go: { label: "Siemens setup", target: SIEMENS_SETUP },
    },
    {
      id: "commission-plcsim", title: "Test on PLCSIM",
      status: !s.siteId ? "todo" : mode === "plcsim" ? (s.site?.compiledClips ? "done" : "todo") : mode === "physical" ? "warn" : "todo",
      detail: !s.siteId ? "After the site exists, choose “Test PLC: PLCSIM on this PC” in Siemens Setup → Connect, then Verify and Test there."
        : mode === "plcsim" ? (s.site?.compiledClips ? `PLCSIM site with a compiled show (${plural(s.site.compiledClips, "command")}). Run Verify/Test yourself in Siemens Setup.` : "PLCSIM selected. Compile the show for this site in Siemens Setup → Run show.")
        : mode === "physical" ? "This site targets a real PLC. Prove the program on PLCSIM first."
        : s.site ? "This site is an AquaFlow animation only. Switch it to the PLCSIM test PLC in Siemens Setup → Connect."
        : "Site details unavailable (backend offline). Open Siemens Setup to check its mode.",
      go: { label: "Open PLCSIM setup", target: SIEMENS_SETUP },
      note: "AquaFlow never starts, arms or pulses a PLC from this checklist.",
    },
    {
      id: "commission-procedure", title: "Safe commissioning procedure",
      status: c.commissioned ? "done" : "manual",
      detail: c.commissioned ? "The backend reports hardware commissioned."
        : "Real outputs are tested on site by the approved operator with interlocks and E-stop, following the commissioning checklist. Until signed off, output is simulated.",
      go: { label: "Open procedure", target: PROCEDURE },
    },
  ];
  const operate = [
    {
      id: "operate-status", title: "Hardware commissioning status",
      status: c.commissioned ? "done" : "warn",
      detail: c.commissioned ? "Hardware commissioned." : "Hardware not commissioned — simulated output only.",
      go: { label: "Open procedure", target: PROCEDURE },
    },
    preflightStep(snap, "operate-preflight"),
    { id: "operate-schedule", title: "Schedule shows", status: "info", detail: "Plan when shows run.", go: { label: "Open scheduler", target: { panel: "scheduler" } } },
    { id: "operate-safety", title: "Monitor safety", status: "info", detail: "Safety interlocks, wind and live validation.", go: { label: "Open safety monitor", target: { panel: "safety" } } },
    { id: "operate-console", title: "Operator console", status: "info", detail: "Playback and status for the operator.", go: { label: "Open console", target: { panel: "operator" } } },
  ];
  return { design, program, commission, operate };
}

const ACTIONABLE = new Set(["todo", "warn", "blocked"]);
/** The first unfinished step (todo/warn/blocked), else the first manual step, else null. */
export function nextStep(steps = []) {
  return steps.find(s => ACTIONABLE.has(s.status)) || steps.find(s => s.status === "manual") || null;
}
export function guidanceProgress(steps = []) {
  const counted = steps.filter(s => s.status !== "info");
  return { done: counted.filter(s => s.status === "done").length, total: counted.length };
}

// ─── diagnostics ────────────────────────────────────────────────────────────

const SOURCE_WORKSPACES = {
  hydraulics: ["design", "program", "commission"],
  splash: ["design", "program", "commission"],
};

/** Where a diagnostic without a fix should take the operator. */
export function fallbackTarget(issue) {
  if (issue?.source === "hydraulics" || issue?.source === "splash") return { panel: "preview" };
  return PREFLIGHT;
}

/**
 * Every warning shown in a workspace, each with an action:
 *   { id, severity, message, source, workspaces[], action: {kind:"fix", issue} | {kind:"target", target} | {kind:"asset-report"} }
 */
export function collectWorkspaceDiagnostics(snap) {
  const out = [];
  snap.preflight.issues.forEach((issue, i) => {
    out.push({
      id: `preflight-${i}-${issue.code}`, severity: issue.severity || "warning", code: issue.code, message: issue.message,
      source: issue.source || "preflight", timeMs: issue.timeMs ?? null,
      workspaces: SOURCE_WORKSPACES[issue.source] || ["program", "commission", "operate"],
      action: issue.fix ? { kind: "fix", issue } : { kind: "target", target: fallbackTarget(issue) },
    });
  });
  for (const id of snap.design.unknownFixtureIds) {
    out.push({ id: `unknown-${id}`, severity: "warning", code: "FIXTURE_TYPE_UNKNOWN", source: "design",
      message: `Fixture ${id} has an unknown type.`, workspaces: ["design", "program"],
      action: { kind: "fix", issue: { code: "FIXTURE_TYPE_UNKNOWN", fix: { kind: "open_engineering_item", target: id }, timeMs: null } } });
  }
  if (snap.design.genericFixtureIds.length) {
    const n = snap.design.genericFixtureIds.length;
    out.push({ id: "generic-data", severity: "warning", code: "GENERIC_EQUIPMENT_DATA", source: "data trust",
      message: `${plural(n, "fixture")} use${n === 1 ? "s" : ""} generic estimated equipment data — verify with supplier datasheets.`,
      workspaces: ["design", "commission"], action: { kind: "target", target: VERIFIED } });
  }
  const assetProblems = [...snap.assets.missing.map(i => ["missing", i]), ...snap.assets.changed.map(i => ["changed", i])];
  for (const [status, item] of assetProblems) {
    out.push({ id: `asset-${item.id}`, severity: status === "missing" ? "error" : "warning", code: status === "missing" ? "ASSET_MISSING" : "ASSET_CHANGED",
      source: "project assets", message: `${item.name || item.id} (${item.role || "asset"}) is ${status}. Locate or relink it.`,
      workspaces: WORKSPACE_IDS, action: { kind: "asset-report" } });
  }
  return out;
}

export const diagnosticsFor = (diagnostics, workspaceId) => diagnostics.filter(d => d.workspaces.includes(workspaceId));
