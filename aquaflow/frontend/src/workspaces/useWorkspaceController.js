/**
 * useWorkspaceController.js — AF-NEXT-014 glue between App's single `activePanel` and the
 * four guided workspaces. No new store: the chosen workspace is a per-user preference in
 * localStorage; project facts are read from the existing stores.
 *
 * Read-only network use: GET /siemens-sites and GET /hardware/commissioning for the
 * checklist, and the AF-NEXT-009 preflight gate (POST /api/preflight is read-only).
 * Nothing here connects to, arms, starts or pulses any controller.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useEngineeringStore from "../store/engineeringStore";
import useProjectStore from "../store/projectStore";
import { useShowStore } from "../store/showStore";
import { getFixtureProvenance } from "../data/fixtureLibrary";
import { getFixtureInfo } from "../utils/fixtureTypeResolver";
import { isVerifiedProvenance } from "../data/fixtureProvenance";
import { apiGet } from "../utils/apiClient";
import { poolCenter } from "../engineering/geometryContract";
import { buildPreflightProject, openDiagnosticFix, publishPreflightResult, runPreflight } from "../preflight/preflight";
import {
  buildGuidance, buildProjectSnapshot, collectWorkspaceDiagnostics, defaultPanelFor, diagnosticsFor,
  HELP_ENTRIES, isWorkspaceId, loadLastPanels, loadWorkspaceChoice, saveLastPanel, saveWorkspaceChoice, workspaceForPanel,
} from "./workspaceModel";
import { openWorkspaceTarget } from "./navigation";
import { getProjectSignals, reopenAssetReport, subscribeProjectSignals } from "./projectSignals";
import { openLebuPilot } from "./pilotProject";

const HELP_PANELS = new Set(HELP_ENTRIES.map(e => e.target.panel));

/**
 * Fixture trust/type facts for the checklist: "unknown" is Show Studio's own rule
 * (getFixtureInfo → deviceType "unknown"); "verified" is the AF-NEXT-012 provenance rule.
 */
export function fixtureInfo(fixture) {
  let unknown = false, verified = false;
  try { const info = getFixtureInfo(fixture?.type); unknown = !info || info.deviceType === "unknown"; } catch { unknown = true; }
  try { verified = isVerifiedProvenance(getFixtureProvenance(fixture)); } catch { verified = false; }
  return { unknown, verified };
}

/**
 * Compile Show Studio patterns when the project has not been opened in Show Studio yet
 * (timelineClips is only written by Show Studio). Pure read: nothing is stored.
 */
export async function resolvedProgrammer(programmer, engineering) {
  const p = programmer || {};
  if ((p.timelineClips || []).length || !(p.studio?.recipes || []).length) return p;
  const { compileStudio, inventory, readStudio } = await import("../components/programmer/studio/showModel");
  const items = inventory(engineering.fixtures || [], engineering.siteModels || [],
    poolCenter(engineering.geometry, engineering.params, engineering.poolType));
  return { ...p, timelineClips: compileStudio(readStudio(p), items).clips };
}

const defaultDeps = {
  fetchSiemensSites: () => apiGet("/siemens-sites"),
  fetchCommissioning: () => apiGet("/hardware/commissioning"),
  runPreflight: (project, target) => runPreflight(project, target),
  openPilot: () => openLebuPilot(),
  storage: undefined,
  confirm: (text) => (typeof window !== "undefined" && window.confirm ? window.confirm(text) : true),
};

export default function useWorkspaceController({ activePanel, setActivePanel, deps: injected = {} }) {
  const deps = useMemo(() => ({ ...defaultDeps, ...injected }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [choice] = useState(() => loadWorkspaceChoice(deps.storage));
  const [workspace, setWorkspace] = useState(choice.workspace);
  const [startOpen, setStartOpen] = useState(choice.firstRun);
  const firstRun = useRef(choice.firstRun);

  // Persist the chosen workspace (first run → Design is stored on the first render).
  useEffect(() => { saveWorkspaceChoice(workspace, deps.storage); }, [workspace, deps.storage]);

  // First run: leave the legacy node editor default for the Design workspace's designer.
  useEffect(() => {
    if (firstRun.current && (!activePanel || activePanel === "nodes")) setActivePanel(defaultPanelFor("design"));
    firstRun.current = false;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Any navigation (menus, events, diagnostics) keeps the workspace in step with the panel.
  useEffect(() => {
    const next = workspaceForPanel(activePanel, workspace);
    if (next !== workspace) { setWorkspace(next); return; }
    if (!HELP_PANELS.has(activePanel)) saveLastPanel(workspace, activePanel, deps.storage);
  }, [activePanel, workspace, deps.storage]);

  const selectWorkspace = useCallback((id) => {
    if (!isWorkspaceId(id)) return;
    setWorkspace(id);
    const current = useProjectStore.getState().workspace?.activePanel ?? activePanel;
    if (workspaceForPanel(current, id) !== id) setActivePanel(defaultPanelFor(id, loadLastPanels(deps.storage)));
  }, [activePanel, setActivePanel, deps.storage]);

  // ── project snapshot ──────────────────────────────────────────────────────
  const fixtures = useEngineeringStore(s => s.fixtures);
  const basins = useEngineeringStore(s => s.basins);
  const geometry = useEngineeringStore(s => s.geometry);
  const cadUnderlay = useEngineeringStore(s => s.cadUnderlay);
  const programmer = useProjectStore(s => s.programmer);
  const integrations = useProjectStore(s => s.integrations);
  const currentShow = useShowStore(s => s.currentShow);
  const [signalsVersion, setSignalsVersion] = useState(0);
  useEffect(() => subscribeProjectSignals(() => setSignalsVersion(v => v + 1)), []);
  const signals = getProjectSignals();

  const [siemens, setSiemens] = useState(null);
  const [commissioning, setCommissioning] = useState(null);
  const siteId = integrations?.siemensSiteId || null;
  const refreshRemote = useCallback(() => {
    let alive = true;
    Promise.resolve().then(deps.fetchSiemensSites).then(r => {
      if (!alive) return;
      const sites = Array.isArray(r?.sites) ? r.sites : [];
      setSiemens({ known: true, site: sites.find(s => s.id === siteId) || null });
    }).catch(e => alive && setSiemens({ known: false, site: null, error: e?.message || String(e) }));
    Promise.resolve().then(deps.fetchCommissioning).then(r => alive && setCommissioning({ known: true, commissioned: r?.hardware_commissioned === true }))
      .catch(() => alive && setCommissioning({ known: false, commissioned: false }));
    return () => { alive = false; };
  }, [deps, siteId]);
  // Refresh when entering Commission/Operate or when the chosen site changes.
  useEffect(() => refreshRemote(), [refreshRemote, workspace]);

  const infoById = useMemo(() => new Map((fixtures || []).map(f => [f, fixtureInfo(f)])), [fixtures]);
  const snapshot = useMemo(() => buildProjectSnapshot({
    engineering: { fixtures, basins, geometry, cadUnderlay }, programmer, integrations, show: currentShow,
    preflight: signals.preflight, assets: signals.assets, siemens, commissioning,
    fixtureInfo: f => infoById.get(f) || fixtureInfo(f),
  }), [fixtures, basins, geometry, cadUnderlay, programmer, integrations, currentShow, signalsVersion, siemens, commissioning, infoById]); // eslint-disable-line react-hooks/exhaustive-deps

  const guidance = useMemo(() => buildGuidance(snapshot), [snapshot]);
  const allDiagnostics = useMemo(() => collectWorkspaceDiagnostics(snapshot), [snapshot]);
  const diagnostics = useMemo(() => diagnosticsFor(allDiagnostics, workspace), [allDiagnostics, workspace]);

  // ── actions ───────────────────────────────────────────────────────────────
  const open = useCallback((target) => openWorkspaceTarget(target), []);
  const goStep = useCallback((step) => open(step?.go?.fix ? { fix: step.go.fix } : step?.go?.target), [open]);
  const runDiagnostic = useCallback((diag) => {
    const action = diag?.action;
    if (!action) return null;
    if (action.kind === "fix") return openDiagnosticFix(action.issue);
    if (action.kind === "asset-report") return reopenAssetReport();
    return open(action.target);
  }, [open]);

  const [preflightBusy, setPreflightBusy] = useState(false);
  const [preflightError, setPreflightError] = useState("");
  const runPreflightNow = useCallback(async () => {
    setPreflightBusy(true); setPreflightError("");
    try {
      const eng = useEngineeringStore.getState();
      const proj = useProjectStore.getState();
      const prog = await resolvedProgrammer(proj.programmer, eng);
      const project = buildPreflightProject({ fixtures: eng.fixtures, programmer: prog, hydraulicNetwork: eng.hydraulic_network || null,
        site: { basins: eng.basins, geometry: eng.geometry, poolType: eng.poolType, params: eng.params } });
      const sid = proj.integrations?.siemensSiteId;
      const target = workspace === "commission" && sid ? { kind: "siemens", site_id: sid } : { kind: "preview" };
      const result = await deps.runPreflight(project, target);
      publishPreflightResult(result, target);
      return result;
    } catch (e) {
      setPreflightError(`${e?.message || e}. Hardware output stays blocked.`);
      return null;
    } finally {
      setPreflightBusy(false);
    }
  }, [deps, workspace]);

  const [pilotState, setPilotState] = useState({ busy: false, error: "" });
  const openPilot = useCallback(async () => {
    const dirty = useProjectStore.getState().dirty || useShowStore.getState().isDirty;
    if (dirty && !deps.confirm("Open the Lebu pilot sample? Unsaved changes in the current project will be replaced.")) return false;
    setPilotState({ busy: true, error: "" });
    try {
      await deps.openPilot();
      setPilotState({ busy: false, error: "" });
      setStartOpen(false);
      setWorkspace("design");
      setActivePanel("geometry");
      return true;
    } catch (e) {
      setPilotState({ busy: false, error: e?.message || String(e) });
      return false;
    }
  }, [deps, setActivePanel]);

  return {
    workspace, selectWorkspace, snapshot, guidance, steps: guidance[workspace] || [], diagnostics, allDiagnostics,
    open, goStep, runDiagnostic, runPreflightNow, preflightBusy, preflightError,
    startOpen, setStartOpen, openPilot, pilotState, refreshRemote,
  };
}
