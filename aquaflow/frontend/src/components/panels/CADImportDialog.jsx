/**
 * CADImportDialog — AF-CAD-012 / 014 / 017 review UI.
 *
 * Flow: choose file → backend POST /api/cad/import (ezdxf, ≤100 MB, DXF ASCII/binary, or the
 * AutoLISP .json export) → review → one primary "Import" button. When the backend is not
 * reachable the dialog falls back to the built-in dxf-parser (ASCII DXF ≤10 MB, layer mapping).
 * DWG is converted locally by the desktop app (AutoCAD accoreconsole by default; ODA only with
 * the licence notice acknowledged) and the resulting DXF goes to the same backend importer.
 *
 * Safety invariants: design data only — no controller/hardware command is ever sent; matched
 * fixtures keep their IDs and hardware addresses; duplicate IDs are refused; new fixtures get
 * no PLC/I-CAN/DMX address.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CAD_MAX_BYTES, CAD_BACKEND_MAX_BYTES, CAD_ROLES, CAD_UNITS, CAD_CANDIDATE_TYPES, CAD_CANDIDATE_DEFAULT_FIXTURE,
  parseCadDxf, previewCadImport, applyCadImport, clientCadUnderlay,
  requestCadImport, previewCadImportResponse, listCadTemplates, saveCadTemplate, recognizeCadImport,
  cadTemplateFromOverrides, cadOverridesFromTemplate, cadDiffPrevious, cadDiffCandidates, requestCadDiff,
  cadTopologyInput, requestCadTopology, cadHydraulicGroups, cadCategoryForFixtureType, CAD_CONTRACT_UNITS,
} from "../../engineering/cadExchange";
import { CAD_FRAME_DEFAULTS, cadFrame, planToCad, edgeAlignRotation } from "../../engineering/geometryContract";
import { buildUnderlayIndex, drawCadUnderlay, fitPlanView, nearestUnderlaySegment, underlayLayerVisibility } from "../../engineering/cadUnderlay";
import { FIXTURE_LIBRARY } from "../../data/fixtureLibrary";
import { apiGet } from "../../utils/apiClient";

const field = { background: "#0a1825", border: "1px solid #31536a", color: "#d9edf7", borderRadius: 4, padding: "7px 9px", font: "inherit" };
const button = { ...field, cursor: "pointer", padding: "9px 12px" };
const small = { ...field, padding: "3px 6px", fontSize: 12 };
const roleLabel = { ignore: "Ignore", pool: "Pool boundary", island: "Island (hole)", nozzle: "Nozzles", light: "Lights", equipment: "Equipment", pipe: "Pipes", depth: "Depth zones", measurement: "Measurements" };
const typeLabel = { nozzle: "Nozzle", light: "Light", pump: "Pump", valve: "Valve", equipment: "Equipment", laser: "Laser", fire: "Fire", mist: "Mist", ignore: "Ignore" };
const confidenceColor = c => (c >= 0.8 ? "#36e3a0" : c >= 0.5 ? "#ffca57" : "#ff7a6b");
const confidenceText = c => (c >= 0.8 ? "high" : c >= 0.5 ? "medium" : "low");
const PREVIEW_W = 560, PREVIEW_H = 300;

function Section({ title, children, defaultOpen = true, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return <div style={{ border: "1px solid #244255", borderRadius: 5, marginBottom: 10 }}>
    <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
      style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0b1d2b", color: "#bfe6f7", border: "none", padding: "8px 10px", cursor: "pointer", font: "inherit", fontWeight: 600, borderRadius: 5 }}>
      <span>{open ? "▾" : "▸"} {title}</span>{badge != null && <span style={{ color: "#91adc0", fontWeight: 400 }}>{badge}</span>}
    </button>
    {open && <div style={{ padding: 10 }}>{children}</div>}
  </div>;
}

/** Canvas preview: whole-drawing underlay, outlines by role, fixtures by confidence; pick tools. */
function ReviewCanvas({ preview, pickMode, onPick }) {
  const ref = useRef(null);
  const underlay = preview?.underlay || null;
  const index = useMemo(() => (underlay ? buildUnderlayIndex(underlay) : null), [underlay]);
  const bounds = useMemo(() => {
    const b = underlay?.bounds || preview?.bounds;
    if (!b) return null;
    const pb = preview?.bounds;
    // Fit the design when the drawing is a large site plan, but keep the whole drawing otherwise.
    if (pb && (b.maxX - b.minX) > 20 * Math.max(1, pb.maxX - pb.minX)) return pb;
    return b;
  }, [underlay, preview?.bounds]);
  const view = useMemo(() => fitPlanView(bounds, PREVIEW_W, PREVIEW_H, 18), [bounds]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !preview) return;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = PREVIEW_W * dpr; canvas.height = PREVIEW_H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#040b12"; ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    const { zoom, pan } = view;
    const sx = x => pan.x + x * zoom, sy = y => pan.y + y * zoom;
    if (underlay) drawCadUnderlay(ctx, { ...underlay, opacity: 0.45 }, { zoom, pan, width: PREVIEW_W, height: PREVIEW_H, maxTexts: 300 });
    const poly = (pts, stroke, fill, width = 1.5) => {
      if (!pts?.length) return;
      ctx.beginPath(); ctx.moveTo(sx(pts[0].x), sy(pts[0].y));
      pts.slice(1).forEach(p => ctx.lineTo(sx(p.x), sy(p.y))); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke();
    };
    (preview.outlines || []).forEach(o => { if (o.role === "ignore" && o.id !== preview.boundary?.id) poly(o.points, "#3d5a70", null, 1); });
    if (preview.boundary) {
      const g = preview.boundary.geometry;
      if (g?.type === "circle") { ctx.beginPath(); ctx.arc(sx(g.center.x), sy(g.center.y), g.radius * zoom, 0, Math.PI * 2); ctx.fillStyle = "#004a7044"; ctx.fill(); ctx.strokeStyle = "#38bdff"; ctx.lineWidth = 2; ctx.stroke(); }
      else poly(preview.boundary.points, "#38bdff", "#004a7044", 2);
    }
    (preview.islands || []).forEach(h => poly(h, "#ffa94d", "#3a230888", 1.5));
    (preview.landSurfaces || []).forEach(s => poly(s.points, s.color, `${s.color}33`, 1));
    (preview.pipes || []).forEach(p => { ctx.beginPath(); p.points.forEach((q, i) => (i ? ctx.lineTo(sx(q.x), sy(q.y)) : ctx.moveTo(sx(q.x), sy(q.y)))); ctx.strokeStyle = "#c79aff"; ctx.lineWidth = 1; ctx.stroke(); });
    (preview.fixtures || []).forEach(f => {
      ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), 3.2, 0, Math.PI * 2);
      ctx.fillStyle = preview.source === "backend" ? confidenceColor(f.confidence) : f.type.startsWith("light") ? "#ffca57" : f.type.startsWith("nozzle") ? "#36e3bd" : "#a7b6c9";
      ctx.fill();
    });
    // Origin marker (plan 0,0 = the picked CAD origin).
    ctx.strokeStyle = "#ff5c8a"; ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(sx(0) - 7, sy(0)); ctx.lineTo(sx(0) + 7, sy(0)); ctx.moveTo(sx(0), sy(0) - 7); ctx.lineTo(sx(0), sy(0) + 7); ctx.stroke();
  }, [preview, underlay, view]);

  const onClick = e => {
    if (!pickMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (PREVIEW_W / rect.width), cy = (e.clientY - rect.top) * (PREVIEW_H / rect.height);
    const pt = { x: (cx - view.pan.x) / view.zoom, y: (cy - view.pan.y) / view.zoom };
    const aperture = 10 / view.zoom;
    if (pickMode === "origin") {
      const snap = index?.nearestVertex(pt, aperture, { visibleLayers: underlayLayerVisibility(underlay) });
      onPick({ kind: "origin", point: snap ? { x: snap.x, y: snap.y } : pt, snapped: !!snap });
    } else {
      const seg = nearestUnderlaySegment(underlay, index, pt, aperture);
      if (seg) onPick({ kind: "edge", a: seg.a, b: seg.b });
    }
  };
  return <canvas ref={ref} onClick={onClick} role="img" aria-label="CAD import layout preview"
    style={{ width: "100%", maxWidth: PREVIEW_W, aspectRatio: `${PREVIEW_W}/${PREVIEW_H}`, borderRadius: 5, display: "block", cursor: pickMode ? "crosshair" : "default", outline: pickMode ? "2px solid #ff5c8a" : "none" }} />;
}

/** AF-CAD-015 review step: proposed pump → valve → nozzle groups (confirm each), dangling ends. */
function HydraulicNetworkStep({ topology, groups, status, pipeCount, candidates, onFind, onToggle }) {
  const label = id => { const c = (candidates || []).find(x => x.id === id); return c ? (c.tag || `${typeLabel[c.effectiveType] || c.type} ${c.source_handle}`) : id; };
  if (!pipeCount) return <p style={{ color: "#91adc0", fontSize: 12, margin: 0 }}>No pipes were recognised in this drawing.</p>;
  return <div style={{ fontSize: 12 }}>
    <p style={{ color: "#91adc0", margin: "0 0 6px" }}>AquaFlow can trace the drawn pipes to propose which pump feeds which valves and nozzles. Proposals are stored only for the groups you confirm; nothing is sent to hardware.</p>
    <button type="button" style={small} onClick={onFind}>{topology ? "Trace again" : "Find pipe network"}</button>
    {status && <p role="status" style={{ margin: "6px 0 0" }}>{status}</p>}
    {topology && <>
      <p style={{ margin: "6px 0" }}>{topology.stats?.nodes ?? 0} nodes · {topology.stats?.links ?? 0} pipe runs · {(topology.dangling || []).length} dangling ends · {(topology.unattached || []).length} components not on a pipe</p>
      {!groups.length && <p style={{ color: "#ffd58b", margin: "4px 0" }}>No pump was found on the pipe network, so no groups are proposed.</p>}
      {groups.map((g, i) => <label key={`${g.pump}-${i}`} style={{ display: "block", background: "#0b1d2b", padding: 6, borderRadius: 4, marginBottom: 4 }}>
        <input type="checkbox" aria-label={`Confirm pump group ${label(g.pump)}`} checked={!!g.confirmed} onChange={e => onToggle(i, e.target.checked)} />
        {" "}<strong>{label(g.pump)}</strong> → {(g.valves || []).length} valve{(g.valves || []).length === 1 ? "" : "s"} → {(g.nozzles || []).length} nozzle{(g.nozzles || []).length === 1 ? "" : "s"}
        {(g.valves || []).map(v => <div key={v} style={{ color: "#bcd", paddingLeft: 18 }}>{label(v)}: {(g.valve_nozzles?.[v] || []).map(label).join(", ") || "no nozzles"}</div>)}
        {(g.direct_nozzles || []).length > 0 && <div style={{ color: "#bcd", paddingLeft: 18 }}>direct from pump: {g.direct_nozzles.map(label).join(", ")}</div>}
      </label>)}
      {(topology.dangling || []).length > 0 && <details><summary style={{ cursor: "pointer" }}>Dangling pipe ends ({topology.dangling.length})</summary>
        <ul style={{ margin: "4px 0", paddingLeft: 18 }}>{topology.dangling.slice(0, 50).map((d, i) => <li key={i}>{Number(d[0]).toFixed(2)}, {Number(d[1]).toFixed(2)} (CAD m)</li>)}</ul></details>}
      {(topology.warnings || []).map(w => <p key={w} style={{ color: "#ffd58b", margin: "4px 0" }}>{w}</p>)}
    </>}
  </div>;
}

function fixtureChoices(category) {
  const match = {
    nozzle: f => f.key.startsWith("nozzle"), light: f => /^light/.test(f.key), laser: f => /^laser/.test(f.key),
    pump: f => /^pump/.test(f.key), valve: f => /^valve/.test(f.key), fire: f => /^effect_flame|^fuel/.test(f.key),
    mist: f => /mist|fog/.test(f.key), equipment: f => !/^(nozzle|light|laser)/.test(f.key),
  }[category] || (() => true);
  const list = FIXTURE_LIBRARY.filter(match).map(f => ({ key: f.key, label: f.label }));
  const fallback = CAD_CANDIDATE_DEFAULT_FIXTURE[category];
  if (fallback && !list.some(f => f.key === fallback)) list.unshift({ key: fallback, label: `${typeLabel[category]} (generic)` });
  return list;
}

// `initialImport` ({ response, fileName }) pre-loads a backend import response (tests / re-open); normally null.
export default function CADImportDialog({ currentProject, onApply, onClose, initialImport = null }) {
  const [fileName, setFileName] = useState(initialImport?.fileName || "");
  const [fileError, setFileError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState("");
  const [source, setSource] = useState(initialImport?.response ? "backend" : null); // "backend" | "client"
  const [response, setResponse] = useState(initialImport?.response || null);
  const [parsed, setParsed] = useState(null);
  const [units, setUnits] = useState("auto");
  const previousFrame = currentProject.cad_underlay?.frame || null;
  const [frame, setFrame] = useState(() => cadFrame(previousFrame || CAD_FRAME_DEFAULTS));
  const [roles, setRoles] = useState({});
  const [layerFixtureTypes, setLayerFixtureTypes] = useState({});
  const [boundaryId, setBoundaryId] = useState("");
  const [outlineRoles, setOutlineRoles] = useState({});
  const [groupTypes, setGroupTypes] = useState({});
  const [candidateTypes, setCandidateTypes] = useState({});
  const [fixtureTypes, setFixtureTypes] = useState({});
  const [includeLand, setIncludeLand] = useState(true);
  const [mode, setMode] = useState(currentProject.fixtures?.length ? "update" : "new");
  const [name, setName] = useState(currentProject.name || "Imported CAD design");
  const [depth, setDepth] = useState("");
  const [wallHeight, setWallHeight] = useState("");
  const [floorLevel, setFloorLevel] = useState("");
  const [pickMode, setPickMode] = useState(null);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateName, setTemplateName] = useState("");
  const [templateStatus, setTemplateStatus] = useState("");
  const [diff, setDiff] = useState(null);
  const [odaPrompt, setOdaPrompt] = useState(null);
  const [cadCaps, setCadCaps] = useState(null);
  const [topology, setTopology] = useState(null);
  const [hydraulicGroups, setHydraulicGroups] = useState([]);
  const [topologyStatus, setTopologyStatus] = useState("");
  const unitsRevision = useRef(0);
  const [licenseEdition, setLicenseEdition] = useState("UNKNOWN");
  const readRevision = useRef(0);
  const lastFile = useRef(null);
  const lastUpload = useRef(null); // the file actually sent (a converted DWG → DXF), for unit re-imports

  useEffect(() => {
    let live = true;
    window.aquaflow?.getCadCapabilities?.().then(c => { if (live) setCadCaps(c || null); }).catch(() => {});
    apiGet("/license/status").then(s => { if (live) setLicenseEdition(String(s?.edition || "UNKNOWN")); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const result = useMemo(() => {
    try {
      if (source === "backend" && response) {
        return { preview: previewCadImportResponse(response, {
          frame, units: units === "auto" ? undefined : units, outlineRoles, groupTypes, candidateTypes, fixtureTypes,
          currentFixtures: mode === "update" ? currentProject.fixtures || [] : [], includeLand, filename: fileName,
          depth: depth === "" ? (Number(currentProject.params?.depth) || undefined) : Number(depth), wallHeight: wallHeight === "" ? undefined : Number(wallHeight),
          floorLevel: floorLevel === "" ? undefined : Number(floorLevel),
        }) };
      }
      if (source === "client" && parsed) {
        return { preview: previewCadImport(parsed, { units, ...frame, roles, fixtureTypes: layerFixtureTypes, boundaryId, depth: depth || undefined }) };
      }
    } catch (e) { return { error: e.message }; }
    return {};
  }, [source, response, parsed, frame, units, outlineRoles, groupTypes, candidateTypes, fixtureTypes, includeLand, mode,
    currentProject.fixtures, currentProject.params?.depth, fileName, depth, wallHeight, floorLevel, roles, layerFixtureTypes, boundaryId]);

  // The client path's whole-drawing underlay only depends on the drawing, units and frame.
  const clientUnderlay = useMemo(() => {
    if (source !== "client" || !parsed) return null;
    try { return clientCadUnderlay(parsed, { units, frame, filename: fileName }); } catch { return null; }
  }, [source, parsed, units, frame, fileName]);
  const preview = useMemo(() => (result.preview && source === "client" ? { ...result.preview, underlay: clientUnderlay } : result.preview),
    [result.preview, source, clientUnderlay]);

  const matched = preview?.fixtures.filter(f => f.hasIdentity && currentProject.fixtures?.some(old => String(old.id) === f.id)).length || 0;
  // Unitless drawings: the backend already applied its suggested unit (units.name); the user must
  // confirm or choose another one. A re-import with `units=` (units.override) is a confirmation.
  const needsUnits = source === "backend" ? !!preview?.unitless && !response?.units?.override && units === "auto" : source === "client" && !parsed?.units && (units === "auto" || !units);

  // AF-CAD-017: re-import diff, shown before applying (update mode only).
  useEffect(() => {
    if (mode !== "update" || !preview || !currentProject.fixtures?.length) { setDiff(null); return undefined; }
    // Candidates and the previous design use the same keys as the backend diff: XDATA
    // aquaflow_id, then source_handle (instance_id for nested inserts) = fixture.cadHandle,
    // then same-category proximity.
    const candidates = preview.reviewCandidates ? cadDiffCandidates(preview) : preview.fixtures.map(f => {
      const p = planToCad(f, frame);
      return { id: f.id, type: cadCategoryForFixtureType(f.type), position: [p.x, p.y], aquaflow_id: f.hasIdentity ? f.id : null, source_handle: null };
    });
    const previous = cadDiffPrevious(currentProject.fixtures, frame);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      requestCadDiff(previous, candidates, { signal: controller.signal }).then(setDiff).catch(() => setDiff(null));
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [mode, preview, currentProject.fixtures, frame]);

  const refreshTemplates = useCallback(() => {
    listCadTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);
  useEffect(() => { if (source === "backend") refreshTemplates(); }, [source, refreshTemplates]);

  const resetReview = () => {
    setResponse(null); setParsed(null); setSource(null); setDiff(null); setOutlineRoles({}); setGroupTypes({}); setCandidateTypes({});
    setFixtureTypes({}); setBoundaryId(""); setPickMode(null); setNotice(""); setOdaPrompt(null);
    setTopology(null); setHydraulicGroups([]); setTopologyStatus("");
  };

  // Units: the backend applied units.name already. Choosing a different unit re-imports with
  // `units=` (recognition then runs at the right scale); until that returns — or when the file
  // is not at hand / the service is down — previewCadImportResponse rescales client-side,
  // relative to units.to_m, so nothing is ever scaled twice.
  const chooseUnits = async key => {
    setUnits(key || "auto");
    if (source !== "backend" || !key || key === "auto" || !response || !lastUpload.current) return;
    const unit = Object.entries(CAD_CONTRACT_UNITS).find(([, v]) => v === key)?.[0];
    // The applied unit (e.g. the suggested one) is already in the coordinates: confirming needs no re-read.
    if (!unit || unit === response.units?.name) return;
    const revision = ++unitsRevision.current;
    setLoading(`Re-reading the drawing in ${(CAD_UNITS[key]?.label || unit).toLowerCase()}…`);
    try {
      const data = await requestCadImport(lastUpload.current, { units: key, recognize: true });
      if (revision !== unitsRevision.current) return;
      setResponse(data); setUnits("auto"); setTopology(null); setHydraulicGroups([]); setTopologyStatus("");
    } catch { /* keep the client-side rescale */ }
    finally { if (revision === unitsRevision.current) setLoading(""); }
  };

  const findNetwork = async () => {
    if (!preview || source !== "backend") return;
    setTopologyStatus("Tracing the pipe network…");
    try {
      const found = await requestCadTopology(cadTopologyInput(preview));
      if (!found) { setTopologyStatus("The AquaFlow CAD service is not running, so the pipe network could not be traced."); return; }
      setTopology(found); setHydraulicGroups(cadHydraulicGroups(found)); setTopologyStatus("");
    } catch (e) { setTopologyStatus(`Pipe network not traced: ${e.message}`); }
  };

  const importFile = async (file, { odaAcknowledged = false } = {}) => {
    const revision = ++readRevision.current;
    resetReview(); setFileError(""); setLoading("");
    if (!file) return;
    lastFile.current = file;
    setFileName(file.name);
    const lower = file.name.toLowerCase();
    if (!/\.(dxf|dwg|json)$/.test(lower)) { setFileError("Choose an AutoCAD DWG or DXF drawing, or an AquaFlow AutoLISP export (.json)."); return; }
    if (file.size > CAD_BACKEND_MAX_BYTES) { setFileError("The drawing must be no larger than 100 MB. Export only the fountain area."); return; }
    try {
      let upload = file;
      if (lower.endsWith(".dwg")) {
        if (!window.aquaflow?.importDWG) throw new Error("DWG import requires the AquaFlow desktop app and an installed CAD engine. Save the drawing as DXF in AutoCAD, or use the AutoLISP export.");
        setLoading("Converting DWG locally with the CAD engine…");
        const converted = await window.aquaflow.importDWG(new Uint8Array(await file.arrayBuffer()), { licenseEdition, odaAcknowledged });
        if (revision !== readRevision.current) return;
        if (converted?.needsOdaAcknowledgement) { setOdaPrompt({ notice: converted.notice || converted.error, file }); setLoading(""); return; }
        if (!converted?.ok) throw new Error(converted?.error || "DWG conversion failed.");
        if (converted.notice) setNotice(converted.notice);
        upload = new File([converted.dxf], file.name.replace(/\.dwg$/i, ".dxf"), { type: "application/dxf" });
      }
      lastUpload.current = upload;
      setLoading("Reading drawing with the AquaFlow CAD service…");
      try {
        const data = await requestCadImport(upload, { recognize: true });
        if (revision !== readRevision.current) return;
        setResponse(data); setSource("backend");
        setUnits("auto");
        // Survey coordinates far from 0,0: default the origin to the drawing's lower-left corner.
        if (!previousFrame && data.extents?.min && Math.hypot(data.extents.min[0], data.extents.min[1]) > 10000) {
          setFrame(f => ({ ...f, origin: { x: data.extents.min[0], y: data.extents.min[1] } }));
          setNotice(n => `${n ? `${n} ` : ""}Large site coordinates were moved to a local origin at the drawing's lower-left corner. Use Pick origin to choose another point.`);
        }
      } catch (error) {
        if (!error?.backendUnavailable) throw error;
        if (lower.endsWith(".json")) throw new Error("AutoLISP exports (.json) are read by the AquaFlow CAD service, which is not running. Start AquaFlow's engine and try again.");
        if (upload.size > CAD_MAX_BYTES) throw new Error("The AquaFlow CAD service is not running, and the built-in reader is limited to 10 MB ASCII DXF. Start the engine and try again.");
        setLoading("CAD service unavailable — reading with the built-in DXF reader…");
        const drawing = parseCadDxf(await upload.text());
        if (revision !== readRevision.current) return;
        setParsed(drawing); setRoles(drawing.roles); setLayerFixtureTypes({}); setUnits(drawing.units ? "auto" : ""); setSource("client");
        setNotice(n => `${n ? `${n} ` : ""}The AquaFlow CAD service is not running, so the basic built-in reader was used (ASCII DXF up to 10 MB, mapped layers only).`);
      }
      if (mode === "new") setName(file.name.replace(/\.(dxf|dwg|json)$/i, ""));
    } catch (e) { if (revision === readRevision.current) setFileError(e.message); }
    finally { if (revision === readRevision.current) setLoading(""); }
  };

  const onPick = pick => {
    if (pick.kind === "origin") {
      const cad = planToCad(pick.point, frame);
      setFrame(f => ({ ...f, origin: cad }));
    } else {
      const a = planToCad(pick.a, frame), b = planToCad(pick.b, frame);
      setFrame(f => ({ ...f, rotationDeg: Number(edgeAlignRotation(a, b).toFixed(6)) }));
    }
    setPickMode(null);
  };

  const loadTemplate = async templateNameToLoad => {
    const t = templates.find(x => x.name === templateNameToLoad);
    if (!t) return;
    setGroupTypes(cadOverridesFromTemplate(t));
    setTemplateName(t.name);
    setTemplateStatus(`Loaded template "${t.name}".`);
    try {
      const recognition = await recognizeCadImport(response, t);
      if (recognition && Array.isArray(recognition.candidates)) setResponse(r => ({ ...r, recognition }));
    } catch { /* overrides above still apply when re-recognition is unavailable */ }
  };
  const storeTemplate = async () => {
    try {
      await saveCadTemplate(cadTemplateFromOverrides(templateName, groupTypes));
      setTemplateStatus(`Saved template "${templateName.trim()}".`);
      refreshTemplates();
    } catch (e) { setTemplateStatus(`Template not saved: ${e.message}`); }
  };

  const apply = () => {
    try {
      const project = applyCadImport(currentProject, preview, { mode, name, depth: depth === "" ? undefined : Number(depth), hydraulicGroups });
      onApply(project, { matched, imported: preview.fixtures.length, mode, fileName, diff });
    } catch (e) { setFileError(e.message); }
  };

  // Fixtures-only drawings (AutoLISP export) may update a design that already has a basin.
  const canApply = (!!preview?.boundary || (mode === "update" && !!currentProject.geometry)) && !loading && !result.error && !needsUnits;
  const counts = preview ? {
    fixtures: preview.fixtures.length, pipes: preview.pipes.length, islands: preview.islands?.length || 0,
    land: preview.landSurfaces?.length || 0, layers: preview.underlay?.layers?.length || 0,
  } : null;
  const outlineList = (preview?.outlines || []).slice(0, 12);
  const groupedCandidates = useMemo(() => {
    const m = new Map();
    (preview?.reviewCandidates || []).forEach(c => { if (!m.has(c.groupKey)) m.set(c.groupKey, []); m.get(c.groupKey).push(c); });
    return m;
  }, [preview?.reviewCandidates]);
  const usedCategories = [...new Set((preview?.reviewCandidates || []).filter(c => !c.excluded).map(c => c.effectiveType))];
  const odaActive = cadCaps?.engineKind === "oda" || /ODA/i.test(cadCaps?.engine || "");

  return <div style={{ position: "fixed", inset: 0, zIndex: 5000, background: "#000b", display: "grid", placeItems: "center", padding: 20 }}
    onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="cad-import-title" style={{ width: "min(1040px,100%)", maxHeight: "94vh", overflow: "auto", background: "#081420", border: "1px solid #31536a", borderRadius: 9, padding: 22, fontFamily: "sans-serif", fontSize: 13, color: "#d9edf7" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 id="cad-import-title" style={{ margin: 0, fontSize: 21, color: "#65d8ff" }}>Import AutoCAD drawing</h2>
        <button style={button} onClick={onClose} aria-label="Close CAD import">Close</button>
      </div>
      <p style={{ color: "#a9c2d3", lineHeight: 1.5 }}>Choose a DWG, a DXF (ASCII or binary, up to 100 MB) or an AquaFlow AutoLISP export (.json). AquaFlow reads the whole drawing as a locked reference and recognises fountain components for you to review.</p>
      <label style={{ display: "block", marginBottom: 12 }}>Drawing file
        <input autoFocus type="file" accept=".dxf,.dwg,.json" onChange={e => importFile(e.target.files?.[0])} aria-label="AutoCAD drawing file" style={{ display: "block", marginTop: 7 }} />
      </label>
      {odaActive && <p style={{ fontSize: 12, color: "#ffd58b", background: "#352e18", padding: 10, borderRadius: 4, lineHeight: 1.5 }}>
        {cadCaps?.odaNotice || "ODA File Converter is free for non-commercial use only."} AutoCAD (accoreconsole) is used first when it is installed.</p>}
      {odaPrompt && <div role="alertdialog" aria-label="ODA licence notice" style={{ background: "#352e18", color: "#ffe2a8", padding: 12, borderRadius: 5, marginBottom: 12, lineHeight: 1.5 }}>
        <strong>ODA File Converter licence</strong>
        <p style={{ margin: "6px 0" }}>{odaPrompt.notice}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={button} onClick={() => importFile(odaPrompt.file, { odaAcknowledged: true })}>I confirm this is non-commercial use — convert</button>
          <button style={button} onClick={() => setOdaPrompt(null)}>Cancel</button>
        </div>
        <p style={{ fontSize: 12, margin: "6px 0 0" }}>Alternatives with no ODA licence: save as DXF in AutoCAD, or run the AquaFlow AutoLISP export (tools/autocad/aquaflow_export.lsp).</p>
      </div>}
      {loading && <p role="status">{loading}</p>}
      {notice && <p style={{ color: "#a8d8ff", background: "#0d2638", padding: 10, borderRadius: 4, fontSize: 12, lineHeight: 1.5 }}>{notice}</p>}
      {(fileError || result.error) && <p role="alert" style={{ color: "#ffb39d", background: "#3b211b", padding: 12, borderRadius: 4 }}>{fileError || result.error}</p>}

      {(response || parsed) && <>
        {needsUnits && <div style={{ background: "#352e18", padding: 12, borderRadius: 5, marginBottom: 12, color: "#ffe2a8" }}>
          <strong>This drawing does not say which units it uses.</strong> {source === "backend" && preview?.units ? `It is previewed in ${(CAD_UNITS[preview.units]?.label || preview.units).toLowerCase()}, guessed from its size. ` : ""}Confirm or choose the units before importing (a 36,000 mm basin must preview as 36 m).
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
            {preview?.suggestedUnits && <button style={button} onClick={() => chooseUnits(preview.suggestedUnits)}>Use suggested: {CAD_UNITS[preview.suggestedUnits]?.label}</button>}
            <select aria-label="CAD drawing units" value={units === "auto" ? "" : units} onChange={e => chooseUnits(e.target.value || "auto")} style={field}>
              <option value="">Choose actual units</option>
              {Object.entries(CAD_UNITS).map(([key, u]) => <option key={key} value={key}>{u.label}</option>)}
            </select>
          </div>
        </div>}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,1.15fr) minmax(280px,1fr)", gap: 18 }}>
          <div style={{ minWidth: 0 }}>
            <ReviewCanvas preview={preview} pickMode={pickMode} onPick={onPick} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0", fontSize: 12, color: "#91adc0" }}>
              <span><span style={{ color: "#38bdff" }}>■</span> basin</span><span><span style={{ color: "#ffa94d" }}>■</span> island</span>
              {source === "backend" && <><span><span style={{ color: confidenceColor(1) }}>●</span> high confidence</span><span><span style={{ color: confidenceColor(.6) }}>●</span> medium</span><span><span style={{ color: confidenceColor(.2) }}>●</span> low</span></>}
              <span><span style={{ color: "#ff5c8a" }}>+</span> origin</span>
            </div>
            {counts && <p style={{ margin: "4px 0" }}>{counts.fixtures} fixtures · {counts.pipes} pipes · {counts.islands} islands · {counts.land} land areas · {counts.layers} reference layers</p>}
            {preview?.boundary && <p style={{ color: "#78dbfa", margin: "4px 0" }}>Pool span: {(Math.max(...preview.boundary.points.map(p => p.x)) - Math.min(...preview.boundary.points.map(p => p.x))).toFixed(3)} × {(Math.max(...preview.boundary.points.map(p => p.y)) - Math.min(...preview.boundary.points.map(p => p.y))).toFixed(3)} meters</p>}
            {mode === "update" && preview && <p style={{ color: "#8bdfc3", margin: "4px 0" }}>{matched} existing fixture IDs matched (control settings kept). {preview.fixtures.length - matched} new fixtures need commissioning. Omitted current fixtures are retained.</p>}
            {diff && <div aria-label="Re-import differences" style={{ background: "#0b1d2b", borderRadius: 5, padding: 10, margin: "8px 0" }}>
              <strong>Changes since the current design</strong>{diff.source === "local" && <span style={{ color: "#91adc0" }}> (checked locally)</span>}
              <div style={{ display: "flex", gap: 14, marginTop: 4 }}>
                <span style={{ color: "#36e3a0" }}>+{diff.added.length} added</span>
                <span style={{ color: "#ffca57" }}>{diff.moved.length} moved</span>
                <span style={{ color: "#ff7a6b" }}>{diff.removed.length} not in drawing</span>
                <span style={{ color: "#91adc0" }}>{diff.unchanged.length} unchanged</span>
              </div>
              {diff.warnings?.map(w => <p key={w} style={{ color: "#ffd58b", fontSize: 12, margin: "4px 0 0" }}>{w}</p>)}
              {(diff.moved.length > 0 || diff.removed.length > 0) && <details style={{ marginTop: 6 }}><summary style={{ cursor: "pointer" }}>Details</summary>
                <ul style={{ margin: "6px 0", paddingLeft: 18, maxHeight: 140, overflow: "auto", fontSize: 12 }}>
                  {diff.moved.slice(0, 200).map(m => <li key={`m-${m.id}`}>{m.id} moved {Number(m.distance_m).toFixed(3)} m{m.match && m.match !== "aquaflow_id" ? ` (matched by ${m.match === "source_handle" ? "CAD handle" : "position"})` : ""}{m.type_changed ? ` — now ${m.type_changed.to}` : ""}</li>)}
                  {diff.removed.slice(0, 200).map(r => <li key={`r-${r.id}`}>{r.id} is not in the drawing (kept in the design)</li>)}
                </ul></details>}
            </div>}
            {preview?.warnings.map(w => <p key={w} style={{ color: "#ffd58b", fontSize: 12, lineHeight: 1.45, margin: "4px 0" }}>{w}</p>)}
          </div>

          <div style={{ minWidth: 0 }}>
            {source === "backend" && preview && <>
              <Section title="Basin and islands" badge={`${outlineList.length} closed outlines`}>
                {!outlineList.length && <p style={{ color: "#ffb39d" }}>No closed outline found. Close the basin boundary in AutoCAD and import again.</p>}
                {outlineList.map(o => <div key={o.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "center", padding: "3px 0" }}>
                  <span title={(o.excluded ? [o.excluded] : o.reasons || []).join("; ")} style={{ fontSize: 12, wordBreak: "break-word", color: o.excluded ? "#91adc0" : undefined }}>{o.layer || "0"} · {Number(o.area).toFixed(1)} m²{o.excluded
                    ? <span> · reference only ({o.excluded})</span>
                    : o.confidence != null && <span style={{ color: confidenceColor(o.confidence) }}> · {confidenceText(o.confidence)}</span>}</span>
                  {o.excluded
                    // Depth zones, dimensions, annotations … are never basins or islands (contract `excluded`).
                    ? <select aria-label={`Use outline ${o.id} as`} value="ignore" disabled title={o.excluded} style={{ ...small, opacity: 0.6 }}><option value="ignore">Reference only</option></select>
                    : <select aria-label={`Use outline ${o.id} as`} value={o.role} onChange={e => setOutlineRoles(r => ({ ...r, ...(e.target.value === "basin" ? Object.fromEntries(outlineList.filter(x => x.role === "basin").map(x => [x.id, "ignore"])) : {}), [o.id]: e.target.value }))} style={small}>
                      <option value="basin">Basin</option><option value="island">Island</option><option value="ignore">Reference only</option>
                    </select>}
                </div>)}
              </Section>

              <Section title="Recognised fountain components" badge={`${preview.reviewCandidates.length} found`}>
                {!preview.reviewCandidates.length && <p style={{ color: "#91adc0" }}>No components recognised. Map blocks or layers with a template, or place fixtures in the designer.</p>}
                {preview.groups.map(g => {
                  const items = groupedCandidates.get(g.key) || [];
                  const groupValue = groupTypes[g.key] || (g.type === "mixed" ? "" : g.type);
                  return <div key={g.key} style={{ borderTop: "1px solid #18344a", padding: "6px 0" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "center" }}>
                      <button type="button" onClick={() => setExpandedGroup(x => (x === g.key ? null : g.key))} style={{ background: "none", border: "none", color: "#d9edf7", textAlign: "left", cursor: "pointer", font: "inherit", padding: 0, wordBreak: "break-word" }}>
                        {expandedGroup === g.key ? "▾" : "▸"} {g.key.replace(/^block:/, "Block ").replace(/^layer:/, "Layer ")} <span style={{ color: "#91adc0" }}>×{g.count}</span> <span style={{ color: confidenceColor(g.meanConfidence) }}>● {confidenceText(g.meanConfidence)}</span>
                      </button>
                      <select aria-label={`Type for all instances of ${g.key}`} title="Apply to all instances" value={groupValue} onChange={e => setGroupTypes(t => ({ ...t, [g.key]: e.target.value }))} style={small}>
                        {g.type === "mixed" && !groupTypes[g.key] && <option value="">Mixed</option>}
                        {[...CAD_CANDIDATE_TYPES, "ignore"].map(t => <option key={t} value={t}>{typeLabel[t]}</option>)}
                      </select>
                    </div>
                    {expandedGroup === g.key && <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, maxHeight: 220, overflow: "auto" }}>
                      {items.slice(0, 300).map(c => <li key={c.id} style={{ padding: "5px 6px", background: "#0b1d2b", borderLeft: `3px solid ${confidenceColor(c.confidence)}`, marginBottom: 4, fontSize: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                          <span>{c.tag || c.source_handle} · {Math.round((Number(c.confidence) || 0) * 100)}%{c.matchedId && <span style={{ color: "#8bdfc3" }}> · keeps {c.matchedId}</span>}</span>
                          <select aria-label={`Type for ${c.tag || c.id}`} value={candidateTypes[c.id] || c.effectiveType} onChange={e => setCandidateTypes(t => ({ ...t, [c.id]: e.target.value }))} style={{ ...small, fontSize: 11 }}>
                            {[...CAD_CANDIDATE_TYPES, "ignore"].map(t => <option key={t} value={t}>{typeLabel[t]}</option>)}
                          </select>
                        </div>
                        {c.reasons?.length > 0 && <div style={{ color: "#91adc0" }}>Why: {c.reasons.join("; ")}</div>}
                        {Object.entries(c.fields || {}).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => <div key={k} style={{ color: "#bcd" }}>
                          {k}: <strong>{String(v)}</strong>{c.field_provenance?.[k] && <span style={{ color: "#91adc0" }}> — from {c.field_provenance[k]}</span>}
                          {/^(dmx_address|pump_id)$/.test(k) && <span style={{ color: "#ffd58b" }}> (shown for reference; addresses are never assigned by import)</span>}
                        </div>)}
                      </li>)}
                    </ul>}
                  </div>;
                })}
                {usedCategories.length > 0 && <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: "#91adc0", marginBottom: 4 }}>AquaFlow fixture used for new items</div>
                  {usedCategories.map(cat => <label key={cat} style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 6, alignItems: "center", fontSize: 12, marginBottom: 4 }}>{typeLabel[cat]}
                    <select aria-label={`AquaFlow fixture for ${cat}`} value={fixtureTypes[cat] || CAD_CANDIDATE_DEFAULT_FIXTURE[cat]} onChange={e => setFixtureTypes(t => ({ ...t, [cat]: e.target.value }))} style={small}>
                      {fixtureChoices(cat).map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select></label>)}
                </div>}
              </Section>

              <Section title="Walls, floor and land" defaultOpen={false} badge={preview.levels ? `wall ${preview.levels.wallHeight.toFixed(2)} m` : ""}>
                {preview.levels && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <label style={{ fontSize: 12 }}>Wall height (m)<input aria-label="Wall height" type="number" step="0.05" value={wallHeight} placeholder={preview.levels.wallHeight.toFixed(2)} onChange={e => setWallHeight(e.target.value)} style={{ ...field, width: "100%", boxSizing: "border-box", marginTop: 4 }} />
                    <span style={{ color: "#91adc0" }}>from {preview.levels.provenance.wallHeight}</span></label>
                  <label style={{ fontSize: 12 }}>Floor level (m)<input aria-label="Floor level" type="number" step="0.05" value={floorLevel} placeholder={preview.levels.floorLevel.toFixed(2)} onChange={e => setFloorLevel(e.target.value)} style={{ ...field, width: "100%", boxSizing: "border-box", marginTop: 4 }} />
                    <span style={{ color: "#91adc0" }}>from {preview.levels.provenance.floorLevel}</span></label>
                </div>}
                <label style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={includeLand} onChange={e => setIncludeLand(e.target.checked)} /> Create land surfaces from hatches ({preview.landSurfaces?.length || 0}: {[...new Set((preview.landSurfaces || []).map(s => s.type))].join(", ") || "none"})</label>
              </Section>

              <Section title="Hydraulic network" defaultOpen={false} badge={hydraulicGroups.length ? `${hydraulicGroups.filter(g => g.confirmed).length}/${hydraulicGroups.length} pump groups confirmed` : `${preview.recognition?.pipes?.length || 0} pipes`}>
                <HydraulicNetworkStep topology={topology} groups={hydraulicGroups} status={topologyStatus} pipeCount={preview.recognition?.pipes?.length || 0}
                  candidates={preview.reviewCandidates} onFind={findNetwork} onToggle={(i, confirmed) => setHydraulicGroups(gs => gs.map((g, j) => (j === i ? { ...g, confirmed } : g)))} />
              </Section>
            </>}

            {source === "client" && parsed && <Section title="Map drawing layers" badge={`${parsed.layers.length} layers`}>
              <div style={{ maxHeight: 280, overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead><tr><th style={{ padding: 6 }}>CAD layer</th><th style={{ padding: 6 }}>Import as</th></tr></thead>
                  <tbody>{parsed.layers.map(layer => {
                    const role = roles[layer];
                    const fallback = role === "nozzle" ? "nozzle_geyser" : role === "light" ? "light_rgb" : "pump";
                    const choices = fixtureChoices(role === "nozzle" ? "nozzle" : role === "light" ? "light" : "equipment");
                    return <tr key={layer} style={{ borderTop: "1px solid #244255" }}>
                      <td style={{ padding: 6, wordBreak: "break-word", maxWidth: 140 }}>{layer}</td>
                      <td style={{ padding: 6 }}><select aria-label={`Role for ${layer}`} value={role} onChange={e => { setRoles(r => ({ ...r, [layer]: e.target.value })); setBoundaryId(""); }} style={{ ...small, width: "100%" }}>
                        {CAD_ROLES.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
                      </select>
                      {["nozzle", "light", "equipment"].includes(role) && <select aria-label={`Fixture type for ${layer}`} value={layerFixtureTypes[layer] || fallback}
                        onChange={e => setLayerFixtureTypes(t => ({ ...t, [layer]: e.target.value }))} style={{ ...small, width: "100%", marginTop: 4 }}>
                        {choices.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              {preview && <label style={{ display: "block", marginTop: 8 }}>Pool boundary<select aria-label="CAD pool boundary" value={preview.boundary?.id || ""} onChange={e => setBoundaryId(e.target.value)} style={{ ...field, display: "block", width: "100%", marginTop: 4 }}>
                <option value="">{preview.candidates.length ? "Choose one boundary" : "No closed boundary found"}</option>
                {preview.candidates.map((p, i) => <option key={p.id} value={p.id}>{p.layer} - boundary {i + 1} ({p.area.toFixed(2)} m²)</option>)}
              </select></label>}
            </Section>}

            <Section title="Advanced options" defaultOpen={false} badge="origin, units, templates">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <button type="button" style={{ ...small, borderColor: pickMode === "origin" ? "#ff5c8a" : "#31536a" }} onClick={() => setPickMode(m => (m === "origin" ? null : "origin"))}>{pickMode === "origin" ? "Click a point in the preview…" : "Pick origin"}</button>
                <button type="button" style={{ ...small, borderColor: pickMode === "edge" ? "#ff5c8a" : "#31536a" }} onClick={() => setPickMode(m => (m === "edge" ? null : "edge"))}>{pickMode === "edge" ? "Click an edge to align…" : "Align to edge"}</button>
                <button type="button" style={small} onClick={() => setFrame(f => ({ ...cadFrame(CAD_FRAME_DEFAULTS), flipY: f.flipY }))}>Reset placement</button>
              </div>
              <p style={{ fontSize: 12, color: "#91adc0", margin: "0 0 8px" }}>Origin (CAD) {frame.origin.x.toFixed(3)}, {frame.origin.y.toFixed(3)} · rotation {frame.rotationDeg.toFixed(2)}°</p>
              <label style={{ display: "block", marginBottom: 8 }}><input type="checkbox" checked={frame.flipY} onChange={e => setFrame(f => ({ ...f, flipY: e.target.checked }))} /> CAD north (+Y) at the top of the AquaFlow plan (recommended; keep on for AquaFlow exports)</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label style={{ fontSize: 12 }}>Drawing units<select aria-label="CAD drawing units override" value={units} onChange={e => (source === "backend" ? chooseUnits(e.target.value) : setUnits(e.target.value))} style={{ ...small, display: "block", width: "100%", marginTop: 4 }}>
                  <option value="auto">From drawing{source === "client" && parsed?.units ? ` (${CAD_UNITS[parsed.units].label})` : ""}</option>
                  {Object.entries(CAD_UNITS).map(([key, u]) => <option key={key} value={key}>{u.label}</option>)}
                </select></label>
                <label style={{ fontSize: 12 }}>Import method<select aria-label="CAD import method" value={mode} onChange={e => setMode(e.target.value)} style={{ ...small, display: "block", width: "100%", marginTop: 4 }}>
                  <option value="update">Update current design</option>
                  <option value="new">Create a new design</option>
                </select></label>
                <label style={{ fontSize: 12 }}>Pool depth (m)<input aria-label="CAD pool depth" type="number" min="0.05" max="100" step="0.05" value={depth} onChange={e => setDepth(e.target.value)} placeholder="Drawing / current" style={{ ...small, display: "block", width: "100%", boxSizing: "border-box", marginTop: 4 }} /></label>
                <label style={{ fontSize: 12 }}>Design name<input aria-label="Imported design name" value={name} onChange={e => setName(e.target.value)} style={{ ...small, display: "block", width: "100%", boxSizing: "border-box", marginTop: 4 }} /></label>
              </div>
              {source === "backend" && <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: "#91adc0", marginBottom: 4 }}>Mapping template (per client CAD standard)</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <select aria-label="Load mapping template" value="" onChange={e => loadTemplate(e.target.value)} style={small}>
                    <option value="">{templates.length ? "Load template…" : "No saved templates"}</option>
                    {templates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                  </select>
                  <input aria-label="Template name" value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Template name" style={{ ...small, flex: "1 1 120px" }} />
                  <button type="button" style={small} disabled={!templateName.trim() || !Object.keys(groupTypes).length} onClick={storeTemplate}>Save template</button>
                </div>
                {templateStatus && <p style={{ fontSize: 12, color: "#8bdfc3", margin: "4px 0 0" }}>{templateStatus}</p>}
              </div>}
            </Section>
          </div>
        </div>
        <p style={{ lineHeight: 1.5, color: "#ffd58b", background: "#352e18", padding: 10, borderRadius: 4, fontSize: 12 }}>CAD import updates design data only and sends nothing to the fountain hardware. Matching fixture IDs keep their AquaFlow control settings; new fixtures get no PLC/I-CAN/DMX address. Pipes, depth zones and measurements come from the drawing, and hydraulics must be recalculated.</p>
      </>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
        <button style={button} onClick={onClose}>Cancel</button>
        <button disabled={!canApply} onClick={apply} style={{ ...button, background: canApply ? "#07533d" : "#172b38", color: canApply ? "#b8ffe4" : "#8396a2", cursor: canApply ? "pointer" : "default", fontWeight: 700 }}>Import</button>
      </div>
    </section>
  </div>;
}
