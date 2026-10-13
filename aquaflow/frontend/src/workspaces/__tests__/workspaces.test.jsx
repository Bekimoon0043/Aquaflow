// @vitest-environment jsdom
// AF-NEXT-014 — guided operator workspaces: switching, panel reachability, project-state
// guidance, diagnostic navigation and the generic Start workflow. The harness wires the real
// controller/components exactly as App.jsx does (same open-panel event, same stores).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import useProjectStore from "../../store/projectStore";
import useEngineeringStore from "../../store/engineeringStore";
import { MENU_ITEMS, allToolsEntries } from "../../components/topBarMenu";
import WorkspaceSwitcher from "../../components/workspace/WorkspaceSwitcher";
import WorkspaceNav from "../../components/workspace/WorkspaceNav";
import GuidanceStrip from "../../components/workspace/GuidanceStrip";
import StartCard from "../../components/workspace/StartCard";
import useWorkspaceController from "../useWorkspaceController";
import {
  PANEL_CATALOG, WORKSPACES, WORKSPACE_STORAGE_KEY, buildGuidance, buildProjectSnapshot, reachablePanels, workspaceForPanel,
} from "../workspaceModel";
import { resetProjectSignals } from "../projectSignals";
import { takePanelAction } from "../navigation";
import { publishPreflightResult, takePendingFocus } from "../../preflight/preflight";
import TopBar from "../../components/TopBar";

// TopBar needs only `send` from the WebSocket context; nothing is sent in these tests.
vi.mock("../../hooks/WebSocketContext", () => ({ useWS: () => ({ send: () => false }) }));

globalThis.React = React;
const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.resolve(here, "..", "..", "App.jsx"), "utf8");

/** Panels App.jsx actually renders. */
function appPanels() {
  const ids = new Set([...appSource.matchAll(/keepAlivePanel\("([a-z0-9_]+)"/g)].map(m => m[1]));
  ["geometry", "show_programmer"].forEach(id => { if (appSource.includes(`visitedPanelsRef.current.has("${id}")`)) ids.add(id); });
  return ids;
}

const baseDeps = (extra = {}) => ({
  fetchSiemensSites: vi.fn(async () => ({ sites: [] })),
  fetchCommissioning: vi.fn(async () => ({ hardware_commissioned: false })),
  runPreflight: vi.fn(async () => ({ ok: true, issues: [], summary: { errors: 0, warnings: 0, infos: 0, total: 0 }, target: { kind: "preview" } })),
  ...extra,
});

function Harness({ deps }) {
  const activePanel = useProjectStore(s => s.workspace.activePanel);
  const setActivePanel = useProjectStore(s => s.setActivePanel);
  // Same navigation authority as App.jsx.
  useEffect(() => {
    const onOpen = (e) => { if (e?.detail?.panel) setActivePanel(e.detail.panel); };
    window.addEventListener("aquaflow:open-panel", onOpen);
    return () => window.removeEventListener("aquaflow:open-panel", onOpen);
  }, [setActivePanel]);
  const g = useWorkspaceController({ activePanel, setActivePanel, deps });
  return <>
    <WorkspaceSwitcher workspace={g.workspace} onSelect={g.selectWorkspace} onStart={() => g.setStartOpen(true)} />
    <GuidanceStrip workspace={g.workspace} steps={g.steps} diagnostics={g.diagnostics} onGo={g.goStep}
      onDiagnostic={g.runDiagnostic} onRunPreflight={g.runPreflightNow} preflightBusy={g.preflightBusy} preflightError={g.preflightError} />
    <WorkspaceNav workspace={g.workspace} activePanel={activePanel} onOpen={g.open} />
    <output data-testid="active-panel">{activePanel}</output>
    {g.startOpen && <StartCard onImportCad={() => g.setStartOpen(false)} onOpenProject={() => g.setStartOpen(false)} onClose={() => g.setStartOpen(false)} />}
  </>;
}

const activePanel = () => useProjectStore.getState().workspace.activePanel;
const tab = (name) => screen.getByRole("tab", { name: new RegExp(name) });
const openChecklist = () => fireEvent.click(screen.getByRole("button", { name: /^Checklist/ }));
const checklistStep = (id) => document.querySelector(`.ws-check[data-step="${id}"]`);

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  useEngineeringStore.getState().resetProject();
  useProjectStore.getState().resetProjectDocument("Untitled Show");
  useProjectStore.getState().setActivePanel("nodes");
  resetProjectSignals();
  while (takePendingFocus("clip") || takePendingFocus("engineering")) { /* drain */ }
  ["plc", "engtools", "docs", "devices", "geometry"].forEach(takePanelAction);
});
afterEach(() => cleanup());

describe("AF-NEXT-014 workspace model", () => {
  it("covers every panel App.jsx renders, every menu panel and the All tools menu", () => {
    const app = appPanels();
    expect(app.size).toBe(34);
    expect(new Set(Object.keys(PANEL_CATALOG))).toEqual(app);
    const menuPanels = new Set(Object.values(MENU_ITEMS).flat().filter(e => e[1] === "panel").map(e => e[2]));
    expect(menuPanels).toEqual(app);
    expect(reachablePanels()).toEqual(app);
    const allTools = new Set(allToolsEntries().filter(e => e[1] === "panel").map(e => e[2]));
    expect(allTools).toEqual(app);
    // Every menu action (Add Node, Scan Network, Emergency Stop, …) stays in All tools / File / Edit / Help.
    const actions = new Set([...allToolsEntries(), ...MENU_ITEMS.File, ...MENU_ITEMS.Edit, ...MENU_ITEMS.Help].filter(e => e[1] === "action").map(e => e[2]));
    Object.values(MENU_ITEMS).flat().filter(e => e[1] === "action").forEach(e => expect(actions.has(e[2])).toBe(true));
  });

  it("follows the panel to its workspace without leaving one that already lists it", () => {
    expect(workspaceForPanel("fleet", "design")).toBe("operate");
    expect(workspaceForPanel("plc", "program")).toBe("commission");
    expect(workspaceForPanel("preview", "program")).toBe("program"); // shared panel: stay
    expect(workspaceForPanel("compile", "commission")).toBe("commission");
    expect(workspaceForPanel("docs", "operate")).toBe("operate");    // help: never switches
    expect(workspaceForPanel("keyframes", "design")).toBe("program"); // legacy → its "More" list
  });
});

describe("AF-NEXT-014 workspace switching", () => {
  it("first run picks Design (and the designer), persists the choice and switches workspaces", async () => {
    render(<Harness deps={baseDeps()} />);
    expect(tab("Design").getAttribute("aria-selected")).toBe("true");
    expect(activePanel()).toBe("geometry");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe("design");
    expect(screen.getByRole("dialog", { name: /Start a fountain project/ })).toBeTruthy(); // first-run Start card
    fireEvent.click(screen.getByRole("button", { name: "Continue with the current project" }));

    fireEvent.click(tab("Program"));
    expect(tab("Program").getAttribute("aria-selected")).toBe("true");
    expect(activePanel()).toBe("show_programmer");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe("program");
    expect(screen.getByRole("navigation", { name: "Program tools" })).toBeTruthy();

    fireEvent.click(tab("Operate"));
    expect(activePanel()).toBe("operator");
    // Opening a panel from anywhere (e.g. All tools / an event) moves to its workspace.
    act(() => { window.dispatchEvent(new CustomEvent("aquaflow:open-panel", { detail: { panel: "plc" } })); });
    expect(tab("Commission").getAttribute("aria-selected")).toBe("true");
    // Returning to Program restores its last panel.
    fireEvent.click(tab("Program"));
    expect(activePanel()).toBe("show_programmer");
    cleanup();

    // Persisted: a second launch starts where the operator left off, with no Start card.
    render(<Harness deps={baseDeps()} />);
    expect(tab("Program").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("dialog", { name: /Start a fountain project/ })).toBeNull();
  });

  it("every existing panel is reachable from a workspace nav (legacy ones under More)", () => {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, "design");
    useProjectStore.getState().setActivePanel("geometry");
    render(<Harness deps={baseDeps()} />);
    const reached = new Set();
    for (const ws of WORKSPACES) {
      fireEvent.click(tab(ws.label));
      const nav = screen.getByRole("navigation", { name: `${ws.label} tools` });
      const more = within(nav).getByRole("button", { name: new RegExp(`More in ${ws.label}`) });
      if (more.getAttribute("aria-expanded") !== "true") fireEvent.click(more);
      const count = within(nav).getAllByRole("button").filter(b => b.dataset.panel).length;
      for (let i = 0; i < count; i++) {
        const button = within(screen.getByRole("navigation", { name: `${ws.label} tools` })).getAllByRole("button").filter(b => b.dataset.panel)[i];
        fireEvent.click(button);
        expect(activePanel()).toBe(button.dataset.panel);
        reached.add(activePanel());
        expect(tab(ws.label).getAttribute("aria-selected")).toBe("true"); // listed panels never switch away
      }
    }
    expect(reached).toEqual(appPanels());
  });
});

describe("AF-NEXT-014 project-specific guidance", () => {
  it("reads basins, units, fixtures and data trust from the project", () => {
    const snap = (engineering, extra = {}) => buildProjectSnapshot({ engineering, fixtureInfo: f => ({ unknown: f.type === "mystery", verified: !!f.verified }), ...extra });
    let g = buildGuidance(snap({}));
    expect(g.design.find(s => s.id === "design-basins")).toMatchObject({ status: "todo", go: { target: { panel: "geometry", action: "cad-import" } } });
    g = buildGuidance(snap({ basins: [{ id: "b1", name: "Main" }], geometry: { source: { file: "x.dwg" } },
      fixtures: [{ id: "a", type: "nozzle" }, { id: "m", type: "mystery" }] }));
    expect(g.design.find(s => s.id === "design-basins")).toMatchObject({ status: "done" });
    expect(g.design.find(s => s.id === "design-basins").detail).toMatch(/1 basin \(Main\) from the drawing/);
    expect(g.design.find(s => s.id === "design-units").status).toBe("warn");          // CAD without units
    expect(g.design.find(s => s.id === "design-fixtures")).toMatchObject({ status: "warn", go: { fix: { kind: "open_engineering_item", target: "m" } } });
    expect(g.design.find(s => s.id === "design-trust").detail).toMatch(/2 fixtures use generic estimates/);
    g = buildGuidance(snap({ basins: [{ id: "b1" }], geometry: { source: { file: "x.dwg", units: "meters" } }, fixtures: [{ id: "a", type: "nozzle", verified: true }] }));
    expect(g.design.filter(s => s.status !== "info").every(s => s.status === "done")).toBe(true);
    // Preflight errors block; a PLCSIM site with a compiled show completes the PLCSIM step.
    g = buildGuidance(snap({ fixtures: [{ id: "a" }] }, {
      preflight: { summary: { errors: 2, warnings: 1 }, issues: [], target: { kind: "preview" } },
      integrations: { siemensSiteId: "s1" }, siemens: { known: true, site: { id: "s1", name: "Bench", mode: "plcsim", show: { clips: [1, 2] } } },
    }));
    expect(g.program.find(s => s.id === "program-preflight")).toMatchObject({ status: "blocked" });
    expect(g.program.find(s => s.id === "program-preflight").detail).toMatch(/2 errors, 1 warning/);
    expect(g.commission.find(s => s.id === "commission-plcsim").status).toBe("done");
    expect(g.commission.find(s => s.id === "commission-procedure")).toMatchObject({ status: "manual", go: { target: { panel: "docs", action: "article" } } });
  });

  it("the live checklist follows store changes and preflight results", async () => {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, "design");
    render(<Harness deps={baseDeps()} />);
    expect(screen.getByTestId("next-step").dataset.step).toBe("design-basins");
    act(() => useEngineeringStore.setState({ basins: [{ id: "b1", name: "Pool" }], fixtures: [{ id: "f1", type: "light_rgb", x: 0, y: 0 }] }));
    openChecklist();
    expect(checklistStep("design-basins").dataset.status).toBe("done");
    expect(checklistStep("design-fixtures").dataset.status).toBe("done");
    expect(checklistStep("design-trust").dataset.status).toBe("warn");          // library data is generic
    fireEvent.click(tab("Program"));
    act(() => publishPreflightResult({ ok: false, issues: [], summary: { errors: 3, warnings: 0 } }, { kind: "preview" }));
    openChecklist();
    expect(checklistStep("program-preflight").dataset.status).toBe("blocked");
    expect(checklistStep("program-preflight").textContent).toMatch(/3 errors/);
  });
});

describe("AF-NEXT-014 every warning opens its responsible object or procedure", () => {
  it("preflight, hydraulics, data-trust and missing-asset warnings navigate", async () => {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, "program");
    render(<Harness deps={baseDeps()} />);
    act(() => useEngineeringStore.setState({ fixtures: [{ id: "f1", type: "light_rgb" }] }));
    act(() => publishPreflightResult({ ok: false, summary: { errors: 1, warnings: 2 }, issues: [
      { code: "PUMP_DEADHEAD", severity: "error", timeMs: 4000, clipId: "rec1:f1:0", fix: { kind: "open_clip", target: "rec1:f1:0" }, source: "preflight", message: "Valves closed" },
      { code: "SPLASH_OUTSIDE_BASIN", severity: "warning", timeMs: 2000, fix: null, source: "splash", message: "Spray lands outside" },
      { code: "PUMP_OVER_CAPACITY", severity: "warning", timeMs: null, fix: { kind: "open_engineering_item", target: "pump-1" }, source: "hydraulics", message: "Pump too small" },
    ] }, { kind: "preview" }));
    const openWarnings = () => fireEvent.click(screen.getByRole("button", { name: /^Warnings/ }));
    const click = (code) => fireEvent.click(document.querySelector(`.ws-diag[data-code="${code}"]`));

    openWarnings();
    click("PUMP_DEADHEAD");
    expect(activePanel()).toBe("show_programmer");
    expect(takePendingFocus("clip")).toMatchObject({ clipId: "rec1:f1:0", itemId: "rec1", timeMs: 4000 });

    openWarnings();
    click("SPLASH_OUTSIDE_BASIN");                       // no fix → the engineering/splash preview
    expect(activePanel()).toBe("preview");

    openWarnings();
    click("PUMP_OVER_CAPACITY");
    expect(activePanel()).toBe("geometry");
    expect(takePendingFocus("engineering")).toMatchObject({ id: "pump-1" });

    fireEvent.click(tab("Design"));
    openWarnings();
    click("GENERIC_EQUIPMENT_DATA");
    expect(activePanel()).toBe("engtools");
    expect(takePanelAction("engtools")).toEqual({ action: "tab", detail: { tab: "verified" } });

    // Missing asset (AF-NEXT-006 report) → reopens the report dialog with Locate…/Relink….
    const report = { report: { total: 1, items: [{ id: "audio:programmer", name: "show.wav", role: "audio", status: "missing" }] } };
    act(() => { window.dispatchEvent(new CustomEvent("aquaflow:asset-report", { detail: report })); });
    const seen = vi.fn();
    window.addEventListener("aquaflow:asset-report", seen);
    openWarnings();
    click("ASSET_MISSING");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].detail).toBe(report);
    window.removeEventListener("aquaflow:asset-report", seen);
  });
});

describe("AF-NEXT-014 generic Start workflow", () => {
  it("offers CAD import and project open without bundling a customer-specific pilot", () => {
    const deps = baseDeps();
    render(<Harness deps={deps} />);
    expect(screen.getByRole("button", { name: "Import CAD…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open project…" })).toBeTruthy();
    expect(screen.queryByText(/Lebu/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /pilot/i })).toBeNull();
  });
});

describe("AF-NEXT-014 panel-side requests", () => {
  it("a request parked before a lazy panel mounts is applied on mount (Documentation → procedure)", async () => {
    const { openWorkspaceTarget } = await import("../navigation");
    const { default: DocumentationPanel } = await import("../../components/panels/DocumentationPanel");
    openWorkspaceTarget({ panel: "docs", action: "article", detail: { articleId: "safe-commissioning" } }, { dispatch: () => {} });
    render(<DocumentationPanel />);
    await waitFor(() => expect(document.body.textContent).toMatch(/HARDWARE_COMMISSIONING_CHECKLIST\.md/));
    expect(document.body.textContent).toMatch(/never arms, starts or pulses/);
  });
});

describe("AF-NEXT-014 top bar", () => {
  it("shows the workspace switcher and an All tools menu that opens every existing panel", () => {
    const opened = [];
    render(<TopBar activePanel="nodes" setActivePanel={(p) => opened.push(p)} onToggleLogs={() => {}} onOpenBrowser={() => {}} isDirty={false}
      workspaceSwitcher={<WorkspaceSwitcher workspace="design" onSelect={() => {}} />} />);
    expect(screen.getAllByRole("tab").map(t => t.textContent)).toEqual(["1Design", "2Program", "3Commission", "4Operate"]);
    const menus = ["File", "Edit", "All tools", "Help"];
    menus.forEach(name => expect(screen.getByRole("button", { name })).toBeTruthy());
    const panelCount = allToolsEntries().filter(e => e[1] === "panel").length;
    for (let i = 0; i < panelCount; i++) {
      fireEvent.click(screen.getByRole("button", { name: "All tools" }));
      const panelItems = allToolsEntries().filter(e => e[1] !== "header");
      const entry = allToolsEntries().filter(e => e[1] === "panel")[i];
      const items = screen.getAllByRole("menuitem");
      expect(items).toHaveLength(panelItems.length);
      fireEvent.click(items[panelItems.indexOf(entry)]);
    }
    expect(new Set(opened)).toEqual(appPanels());
  });
});
