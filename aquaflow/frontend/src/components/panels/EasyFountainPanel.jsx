// Easy Fountain Design — drag equipment from the asset tray into a big 3D space, see it connect
// itself (pump → valve → nozzle, light → nozzle), re-plug any line by dragging its plug, and edit
// every property with the water reacting live. The design is the Engineering project itself
// (engineeringStore.fixtures), so every other AquaFlow tool sees the same fountain.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useEngineeringStore from "../../store/engineeringStore";
import useProjectStore from "../../store/projectStore";
import { useShowStore } from "../../store/showStore";
import { buildEasyFountain } from "../../fx/easyFountain";
import { validateSceneContract } from "../../fx/sceneContract";
import { getFixtureLibraryEntry } from "../../data/fixtureLibrary";
import { poolCenter, poolBounds, engineeringToWorld, worldToEngineering } from "../../engineering/geometryContract";
import { readConnections, connectionProblems } from "../../engineering/connections";
import {
  ASSET_GROUPS, assetsFor, assetSummary, roleOf, modelKindOf, designLinks, LINK_STYLE, canConnect, connectPair,
  replugLink, disconnectLink, dropAsset, autoConnectAll, removeFixtures, liveJets, LINK_FIELDS, fieldsFor, effectOf, laserStateOf,
  flameOf, fogOf, motionOf, isMovingNozzle, axesOf,
  setEngineeringField, setFixtureFields, lightColorOf, afterMove,
} from "../../fx/easyDesigner";
import { EasyScene } from "./easy/EasyScene";
import { poolShape, basinPolygon } from "./easy/sceneData";
import { laserFrame, insidePoly } from "../preview/laser/laserRig";

const ROLE_UI = {
  pump: { label: "Pump", color: "#38bdf8", icon: "⊚" },
  valve: { label: "Valve", color: "#a78bfa", icon: "⧓" },
  nozzle: { label: "Nozzle", color: "#5eead4", icon: "↑" },
  light: { label: "Light", color: "#facc15", icon: "✦" },
  effect: { label: "Effect", color: "#fb923c", icon: "✸" },
};
const EFFECT_UI = {
  laser: { label: "Laser", color: "#4ade80", icon: "◆" },
  flame: { label: "Flame", color: "#fb923c", icon: "♨" },
  fog: { label: "Fog", color: "#cbd5e1", icon: "☁" },
};
const S = {
  btn: { padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border-bright)", background: "var(--bg-raised)", color: "var(--text-button)", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" },
  btnOn: { background: "var(--accent-glow)", border: "1px solid var(--border-accent)", color: "var(--text-accent)" },
  field: { width: "100%", boxSizing: "border-box", background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border-mid)", borderRadius: 5, padding: "5px 7px", fontSize: 12 },
  label: { fontSize: 11, color: "var(--text-secondary)" },
  section: { borderTop: "1px solid var(--border-mid)", paddingTop: 10, marginTop: 10 },
  h: { fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 },
};
const r3 = (v) => Math.round(Number(v) * 1000) / 1000;
const isTyping = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

export default function EasyFountainPanel() {
  const fixtures = useEngineeringStore((s) => s.fixtures);
  const geometry = useEngineeringStore((s) => s.geometry);
  const params = useEngineeringStore((s) => s.params);
  const poolType = useEngineeringStore((s) => s.poolType);
  const updateEngineering = useEngineeringStore((s) => s.updateEngineering);
  // Haze is shared with the full 3D preview (render.laserHaze): beams are only seen where it scatters them.
  const haze = useProjectStore((s) => (Number.isFinite(Number(s.render?.laserHaze)) ? Number(s.render.laserHaze) : 0.35));
  const setHaze = (v) => useProjectStore.getState().updateRender({ laserHaze: v });

  const [selectedId, setSelectedId] = useState(null);
  const [selectedLinkId, setSelectedLinkId] = useState(null);
  const [live, setLive] = useState({});
  const [tab, setTab] = useState("nozzles");
  const [query, setQuery] = useState("");
  const [showLinks, setShowLinks] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  // Realistic render (bloom, reflective water, indirect light); remembered per computer.
  const [realistic, setRealistic] = useState(() => { try { return localStorage.getItem("aquaflow.easy.realistic") !== "0"; } catch { return true; } });
  useEffect(() => {
    sceneRef.current?.setRealistic(realistic);
    try { localStorage.setItem("aquaflow.easy.realistic", realistic ? "1" : "0"); } catch { /* private mode */ }
  }, [realistic]);
  const [status, setStatus] = useState("Drag a pump and some nozzles from the tray below into the 3D space — they connect themselves.");
  const [confirm, setConfirm] = useState(null);
  const history = useRef([]);

  const center = useMemo(() => poolCenter(geometry, params, poolType), [geometry, params, poolType]);
  const pool = useMemo(() => poolShape(geometry, params, poolType, center), [geometry, params, poolType, center]);
  // Basin outline [[x, z]] in world space: outside it counts as audience for the laser safety rule.
  const safetyBasin = useMemo(() => basinPolygon(pool), [pool]);
  const design = useMemo(() => readConnections(fixtures), [fixtures]);
  const links = useMemo(() => designLinks(fixtures, design), [fixtures, design]);
  const water = useMemo(() => liveJets(fixtures, live, design), [fixtures, live, design]);
  const byId = useMemo(() => new Map(fixtures.map((f) => [f.id, f])), [fixtures]);
  const selected = selectedId ? byId.get(selectedId) : null;
  const selectedLink = selectedLinkId ? links.find((l) => l.id === selectedLinkId) : null;

  // ─── writing ──────────────────────────────────────────────────────────────
  const fixturesRef = useRef(fixtures);
  fixturesRef.current = fixtures;
  const commit = useCallback((next, message) => {
    const prev = fixturesRef.current;
    if (next === prev) { if (message) setStatus(message); return; }
    history.current = [...history.current, prev].slice(-60);
    fixturesRef.current = next;
    updateEngineering({ fixtures: next });
    if (message) setStatus(message);
  }, [updateEngineering]);
  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) { setStatus("Nothing to undo."); return; }
    fixturesRef.current = prev;
    updateEngineering({ fixtures: prev });
    setStatus("Undone.");
  }, [updateEngineering]);

  const toPlan = useCallback((p) => {
    const e = worldToEngineering({ x: p.x, y: 0, z: p.z }, center);
    return { x: r3(e.x), y: r3(e.y) };
  }, [center]);

  const addAsset = useCallback((key, worldPoint) => {
    let r = dropAsset(fixturesRef.current, key, toPlan(worldPoint));
    const label = r.fixtures.find((f) => f.id === r.id)?.label || key;
    let note = "";
    if (effectOf({ type: key }) === "laser" && safetyBasin && !insidePoly(worldPoint.x, worldPoint.z, safetyBasin)) {
      // Outside the basin is audience space: a show laser there must beam from at least 3 m up.
      r = { ...r, fixtures: setEngineeringField(r.fixtures, r.id, "mountHeightM", 3.5) };
      note = " It stands outside the basin (audience space), so it is mounted on a 3.5 m truss — beams must stay 3 m above people.";
    }
    commit(r.fixtures, (r.lines.length ? `Added ${label}. Auto-connected: ${r.lines.join("; ")}.` : `Added ${label}. ${roleHint(roleOf({ type: key }), design)}`) + note);
    setSelectedId(r.id);
    setSelectedLinkId(null);
  }, [commit, toPlan, design, safetyBasin]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const name = byId.get(selectedId)?.label || "item";
    commit(removeFixtures(fixturesRef.current, [selectedId]), `Deleted ${name} and its connections.`);
    setSelectedId(null);
  }, [selectedId, byId, commit]);

  const duplicateSelected = useCallback(() => {
    const f = selected;
    if (!f) return;
    const r = dropAsset(fixturesRef.current, f.type, { x: Number(f.x) + 0.8, y: Number(f.y) + 0.8 });
    const copy = r.fixtures.map((x) => (x.id === r.id ? { ...x, engineering: { ...x.engineering, ...pickProps(f.engineering) }, ...(f.color ? { color: f.color } : {}) } : x));
    commit(copy, `Duplicated ${f.label}.`);
    setSelectedId(r.id);
  }, [selected, commit]);

  // ─── 3D scene ─────────────────────────────────────────────────────────────
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const handlers = useRef({});
  handlers.current = {
    onDrop: (key, p) => addAsset(key, p),
    onSelect: (id) => { setSelectedId(id); setSelectedLinkId(null); },
    onSelectLink: (id) => { setSelectedLinkId(id); setSelectedId(null); },
    onMoveEnd: (id, p) => {
      const plan = toPlan(p);
      const r = afterMove(setFixtureFields(fixturesRef.current, id, { x: plan.x, y: plan.y }), id);
      commit(r.fixtures, `Moved ${byId.get(id)?.label || "item"} to ${plan.x.toFixed(2)}, ${plan.y.toFixed(2)} m.${r.message}`);
    },
    onReplug: (linkId, end, target) => {
      const link = designLinks(fixturesRef.current).find((l) => l.id === linkId);
      const r = replugLink(fixturesRef.current, link, end, target);
      if (r.ok) commit(r.fixtures, r.message);
      else { setStatus(r.message); sceneRef.current?.setData({}); }
      setSelectedLinkId(null);
    },
    canConnect: (a, b) => canConnect(fixturesRef.current, a, b),
  };
  useEffect(() => {
    if (!hostRef.current) return undefined;
    let scene;
    try {
      scene = new EasyScene(hostRef.current, {
        onDrop: (...a) => handlers.current.onDrop(...a),
        onSelect: (...a) => handlers.current.onSelect(...a),
        onSelectLink: (...a) => handlers.current.onSelectLink(...a),
        onMoveEnd: (...a) => handlers.current.onMoveEnd(...a),
        onReplug: (...a) => handlers.current.onReplug(...a),
        canConnect: (...a) => handlers.current.canConnect(...a),
      });
    } catch (error) {
      setStatus(`3D view could not start: ${error.message}`);
      return undefined;
    }
    sceneRef.current = scene;
    scene.setRealistic(realistic);
    if (import.meta.env?.DEV) window.__aquaflowEasyScene = scene;   // dev-only hook for UI checks
    return () => { scene.dispose(); sceneRef.current = null; };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const items = fixtures.filter((f) => f.visible !== false).map((f) => {
      const w = engineeringToWorld(f, center);
      const role = roleOf(f);
      const e = f.engineering || {};
      const laser = effectOf(f) === "laser";
      return { id: f.id, label: f.label || f.type, role, modelKind: modelKindOf(f), x: w.x, z: w.z,
        elevation: laser ? Math.max(Number(f.z) || 0, Number(e.mountHeightM ?? 0.5)) : Number(f.z) || 0,
        rotation: Number(f.rotation) || 0, on: live[f.id]?.on !== false,
        color: role === "light" ? lightColorOf(f) : null, intensity: Number(e.intensityPct ?? 100), beamDeg: Number(e.beamAngleDeg) || 40 };
    });
    const effects = fixtures.filter((f) => f.visible !== false && effectOf(f)).map((f) => {
      const on = live[f.id]?.on !== false;
      const kind = effectOf(f);
      if (kind === "laser") return { id: f.id, kind, state: laserStateOf(f, on), engineering: f.engineering || {}, mountM: Number(f.engineering?.mountHeightM ?? 0.5) };
      if (kind === "flame") return { id: f.id, kind, ...flameOf(f, on) };
      return { id: f.id, kind, ...fogOf(f, on) };
    });
    scene.setData({ items, links, jets: water.jets, effects, pool, safetyBasin, haze, selectedId, selectedLinkId, showLinks, showLabels });
  }, [fixtures, links, water, pool, safetyBasin, haze, center, selectedId, selectedLinkId, showLinks, showLabels, live]);

  // Keyboard: Delete, Ctrl+Z, Ctrl+D, Esc — only while this panel is visible and not typing.
  const rootRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (!rootRef.current?.offsetParent || isTyping(document.activeElement)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) { e.preventDefault(); deleteSelected(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedLink) { e.preventDefault(); commit(disconnectLink(fixturesRef.current, selectedLink), "Connection unplugged."); setSelectedLinkId(null); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && selectedId) { e.preventDefault(); duplicateSelected(); }
      else if (e.key === "Escape") { setSelectedId(null); setSelectedLinkId(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedLink, deleteSelected, duplicateSelected, undo, commit]);

  // ─── starter fountain (the previous one-click builder) ─────────────────────
  const loadProject = useEngineeringStore((s) => s.loadProject);
  const updateRender = useProjectStore((s) => s.updateRender);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const buildStarter = () => {
    const next = buildEasyFountain({ name: "Easy Fountain", seconds: 30, ringCount: 12, style: "clear" });
    const issues = validateSceneContract(next.aquafx);
    if (issues.length) { setStatus(`Starter fountain failed: ${issues.join(", ")}`); return; }
    history.current = [...history.current, fixturesRef.current].slice(-60);
    sceneRef.current?.reframeOnNextPool();
    loadProject(next.engineering);
    useShowStore.getState().loadShow({ currentShow: next.currentShow, timelineTracks: next.timelineTracks, nodes: [], connections: [], devices: [] });
    useShowStore.getState().setPoolGeometry({ poolType: next.engineering.pool_type, params: next.engineering.params, geometry: next.engineering.geometry });
    updateRender(next.render);
    setProjectName(next.currentShow.name);
    setSelectedId(null);
    setConfirm(null);
    setStatus(`Starter fountain loaded: ${next.engineering.fixtures.length} items, all connected. Change anything you like.`);
  };

  const pumpsOver = [...water.pumps.values()].filter((p) => p.loadPct > 100).length;
  const loose = water.jets.filter((j) => /No pump/.test(j.reason)).length;

  return (
    <div ref={rootRef} style={{ position: "absolute", inset: 0, display: "grid", gridTemplateRows: "auto minmax(0,1fr) 172px", gridTemplateColumns: "minmax(0,1fr) 320px", background: "var(--bg-void)", color: "var(--text-primary)", fontFamily: "var(--font-body)" }}>
      {/* toolbar */}
      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border-mid)", background: "var(--bg-panel)", flexWrap: "wrap" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, marginRight: 8 }}>Easy Fountain Design</div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {design.pumps.size} pumps · {design.nozzles.length} nozzles · {design.valves.size} valves · {design.lights.length} lights · {links.length} connections
        </span>
        {loose > 0 && <span style={{ fontSize: 11, color: "var(--amber)" }}>· {loose} nozzle{loose === 1 ? "" : "s"} without water</span>}
        {pumpsOver > 0 && <span style={{ fontSize: 11, color: "var(--red)" }}>· {pumpsOver} pump{pumpsOver === 1 ? "" : "s"} overloaded</span>}
        <div style={{ flex: 1 }} />
        <button style={S.btn} onClick={() => { const r = autoConnectAll(fixturesRef.current); commit(r.fixtures, r.lines.length ? `Auto-connected ${r.lines.length}: ${r.lines.slice(0, 4).join("; ")}${r.lines.length > 4 ? " …" : ""}` : "Everything is already connected."); }}>⚡ Auto-connect all</button>
        <button style={{ ...S.btn, ...(showLinks ? S.btnOn : {}) }} onClick={() => setShowLinks((v) => !v)}>Lines</button>
        <button style={{ ...S.btn, ...(showLabels ? S.btnOn : {}) }} onClick={() => setShowLabels((v) => !v)}>Labels</button>
        <button title="Bloom, reflective water and indirect light (turn off on a slow computer)" style={{ ...S.btn, ...(realistic ? S.btnOn : {}) }} onClick={() => setRealistic((v) => !v)}>Realistic</button>
        <label title="Haze in the air: laser beams are only visible where haze scatters them (shared with the full 3D preview)" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)" }}>
          Haze <input type="range" min="0" max="1" step="0.05" value={haze} onChange={(e) => setHaze(Number(e.target.value))} style={{ width: 80 }} />
          <span style={{ width: 30 }}>{Math.round(haze * 100)}%</span>
        </label>
        <button style={S.btn} onClick={() => sceneRef.current?.frameAll()}>Frame view</button>
        <button style={S.btn} onClick={undo} title="Ctrl+Z">↶ Undo</button>
        <button style={S.btn} onClick={() => setConfirm("starter")}>Starter fountain</button>
        <button style={S.btn} onClick={() => setConfirm("clear")}>Clear all</button>
        <button style={{ ...S.btn, background: "var(--accent)", color: "#111", border: "1px solid var(--accent)" }} onClick={() => window.dispatchEvent(new CustomEvent("aquaflow:open-panel", { detail: { panel: "preview" } }))}>Full 3D preview</button>
      </div>

      {/* 3D space */}
      <div style={{ gridRow: 2, gridColumn: 1, position: "relative", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
        <div style={{ position: "absolute", left: 10, bottom: 10, right: 10, pointerEvents: "none", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-end" }}>
          <div style={{ fontSize: 12, background: "rgba(5,10,16,0.78)", border: "1px solid var(--border-mid)", padding: "7px 10px", borderRadius: 6, maxWidth: 640, lineHeight: 1.4 }}>{status}</div>
          <div style={{ fontSize: 10.5, color: "var(--text-muted)", background: "rgba(5,10,16,0.7)", padding: "6px 9px", borderRadius: 6, lineHeight: 1.5, textAlign: "right" }}>
            {Object.entries(LINK_STYLE).map(([k, v]) => <span key={k} style={{ marginLeft: 10 }}><span style={{ color: v.color }}>━</span> {v.label}</span>)}<br />
            Drag items to move · drag a white plug to re-plug · right-drag to pan · wheel to zoom
          </div>
        </div>
        {confirm && (
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", background: "var(--bg-panel)", border: "1px solid var(--border-accent)", borderRadius: 8, padding: 12, fontSize: 12, display: "grid", gap: 8, maxWidth: 380, zIndex: 2 }}>
            <div>{confirm === "clear" ? "Remove every item from this design? (Undo brings them back.)" : "Replace the current project with a ready-made starter fountain (pump, 12 jets with valves and lights, centre jet)? Undo restores the items."}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={S.btn} onClick={() => setConfirm(null)}>Cancel</button>
              <button style={{ ...S.btn, ...S.btnOn }} onClick={() => {
                if (confirm === "clear") { commit([], "Cleared. Drag new items from the tray."); setSelectedId(null); setConfirm(null); }
                else buildStarter();
              }}>{confirm === "clear" ? "Clear all" : "Load starter"}</button>
            </div>
          </div>
        )}
      </div>

      {/* properties */}
      <div style={{ gridRow: "2 / 4", gridColumn: 2, borderLeft: "1px solid var(--border-mid)", background: "var(--bg-panel)", overflow: "auto", padding: 12, minHeight: 0 }}>
        {selected ? (
          <FixtureProperties f={selected} design={design} links={links} water={water} byId={byId} fixtures={fixtures}
            on={live[selected.id]?.on !== false}
            setOn={(v) => setLive((cur) => ({ ...cur, [selected.id]: { ...(cur[selected.id] || {}), on: v } }))}
            commit={commit} fixturesRef={fixturesRef} onSelect={(id) => { setSelectedId(id); setSelectedLinkId(null); }}
            onSelectLink={(id) => { setSelectedLinkId(id); setSelectedId(null); }}
            onDelete={deleteSelected} onDuplicate={duplicateSelected} center={center} safetyBasin={safetyBasin} />
        ) : selectedLink ? (
          <LinkProperties link={selectedLink} byId={byId} fixtures={fixtures} commit={commit} fixturesRef={fixturesRef}
            onDone={() => setSelectedLinkId(null)} onSelect={(id) => { setSelectedId(id); setSelectedLinkId(null); }} />
        ) : (
          <Overview fixtures={fixtures} design={design} water={water} commit={commit} fixturesRef={fixturesRef}
            geometry={geometry} params={params} poolType={poolType} updateEngineering={updateEngineering} onSelect={setSelectedId} />
        )}
      </div>

      {/* asset tray */}
      <AssetTray tab={tab} setTab={setTab} query={query} setQuery={setQuery}
        onAdd={(key) => addAsset(key, sceneRef.current?.viewCenter() || { x: 0, z: 0 })} />
    </div>
  );
}

function roleHint(role, design) {
  if (role === "nozzle" && !design.pumps.size) return "Add a pump and it connects to this nozzle automatically.";
  if (role === "pump" && !design.nozzles.length) return "Now drop nozzles — they connect to this pump.";
  if (role === "light" && !design.nozzles.length) return "Lights pair with the nearest nozzle once there is one.";
  if (role === "valve" && !design.nozzles.length) return "Drop a nozzle next to this valve and it plugs in.";
  return "";
}

/** Design settings worth copying on duplicate (not links). */
function pickProps(e = {}) {
  return Object.fromEntries(Object.entries(e).filter(([k]) => !LINK_FIELDS.has(k)));
}

// ─── properties: one item ───────────────────────────────────────────────────

function NumberField({ def, value, onChange }) {
  const v = value ?? def.fallback ?? "";
  if (def.select) {
    return (
      <label style={{ display: "grid", gap: 3, ...S.label }}>{def.label}
        <select style={S.field} value={v} onChange={(e) => onChange(e.target.value)}>
          {def.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label style={{ display: "grid", gap: 3, ...S.label }}>
      <span style={{ display: "flex", justifyContent: "space-between" }}><span>{def.label}</span><span style={{ color: "var(--text-primary)" }}>{v === "" ? "—" : `${v} ${def.unit || ""}`}</span></span>
      {def.slider && <input type="range" min={def.min} max={def.sliderMax ?? def.max} step={def.step} value={Number(v) || 0} onChange={(e) => onChange(Number(e.target.value))} />}
      <input style={S.field} type="number" min={def.min} max={def.max} step={def.step} value={v} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
    </label>
  );
}

function FixtureProperties({ f, design, links, water, byId, fixtures, on, setOn, commit, fixturesRef, onSelect, onSelectLink, onDelete, onDuplicate, center, safetyBasin }) {
  const role = roleOf(f);
  const fxKind = effectOf(f);
  const motion = role === "nozzle" ? motionOf(f) : null;
  const ui = fxKind ? EFFECT_UI[fxKind] : motion ? { ...ROLE_UI.nozzle, label: `Moving nozzle · ${motion.axes}D`, icon: "⤧" } : ROLE_UI[role];
  const entry = getFixtureLibraryEntry(f.type);
  const e = f.engineering || {};
  const setEng = (key, value) => commit(setEngineeringField(fixturesRef.current, f.id, key, value));
  const setTop = (patch) => {
    const moved = setFixtureFields(fixturesRef.current, f.id, patch);
    if (!("x" in patch || "y" in patch)) { commit(moved); return; }
    const r = afterMove(moved, f.id);
    commit(r.fixtures, r.message ? r.message.trim() : undefined);
  };
  const mine = links.filter((l) => l.from === f.id || l.to === f.id);
  const candidates = fixtures.filter((x) => x.id !== f.id && canConnect(fixtures, f.id, x.id) && !mine.some((l) => l.from === x.id || l.to === x.id));
  const fields = fieldsFor(f);
  const shown = new Set(fields.map((d) => d.key));
  const extra = Object.entries(e).filter(([k, v]) => !shown.has(k) && !LINK_FIELDS.has(k) && (typeof v === "number" || typeof v === "string" || typeof v === "boolean"));
  const jet = water.jets.find((j) => j.id === f.id);
  const pump = water.pumps.get(f.id);
  const [allOpen, setAllOpen] = useState(false);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: `${ui.color}22`, color: ui.color, fontSize: 16 }}>{ui.icon}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, color: ui.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{ui.label}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={entry?.label || f.type}>{entry?.label || f.type}</div>
        </div>
        <button style={{ ...S.btn, ...(on ? S.btnOn : {}), padding: "4px 9px" }} onClick={() => setOn(!on)} title="Preview switch (not saved)">{role === "valve" ? (on ? "Open" : "Closed") : (on ? "On" : "Off")}</button>
      </div>
      <input style={{ ...S.field, fontSize: 13, fontWeight: 600 }} value={f.label || ""} onChange={(ev) => setTop({ label: ev.target.value })} />

      {/* live result */}
      {jet && (
        <div style={{ background: "var(--bg-surface)", borderRadius: 6, padding: 8, fontSize: 12 }}>
          Jet now <b>{jet.heightM.toFixed(2)} m</b> of {jet.nominalHeightM.toFixed(2)} m · {Math.round(jet.flowLpm)} L/min
          {jet.reason && <div style={{ color: jet.on ? "var(--amber)" : "var(--red)", marginTop: 3 }}>{jet.reason}</div>}
          {jet.motion && <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3 }}>
            {jet.motion.axes === 1 ? "1D: swings in one plane" : jet.motion.axes === 2 ? "2D: tilts and rotates (any direction in a cone)" : `3D: tilts, rotates and spins its ${jet.motion.outlets}-outlet head`}
            {" · "}{jet.motion.speedHz} Hz
            {jet.motion.limited && <div style={{ color: "var(--amber)" }}>Slowed from {jet.motion.wantedHz} Hz: the drive turns at most {jet.motion.driveDegS}°/s.</div>}
          </div>}
        </div>
      )}
      {pump && (
        <div style={{ background: "var(--bg-surface)", borderRadius: 6, padding: 8, fontSize: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Load</span><b style={{ color: pump.loadPct > 100 ? "var(--red)" : "var(--green)" }}>{pump.loadPct ?? "—"}%</b></div>
          <div style={{ height: 6, background: "var(--bg-hover)", borderRadius: 3, margin: "4px 0", overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, pump.loadPct || 0)}%`, height: "100%", background: pump.loadPct > 100 ? "var(--red)" : "var(--green)" }} />
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Jets ask {pump.needKw} kW of {pump.powerKw} kW · feeds {pump.jets} jet{pump.jets === 1 ? "" : "s"} ({pump.open} open)</div>
          {pump.loadPct > 100 && <div style={{ color: "var(--red)", fontSize: 11, marginTop: 3 }}>Too weak — the jets drop. Raise the power or lower the speed / heights.</div>}
        </div>
      )}

      {fxKind === "laser" && <LaserStatus f={f} on={on} center={center} safetyBasin={safetyBasin} setEng={setEng} />}

      {(role === "light" || fxKind === "laser") && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, ...S.label }}>Colour
          <input type="color" value={fxKind === "laser" ? lightColorOf({ color: f.color || "#3dff4f" }) : lightColorOf(f)} onChange={(ev) => setTop({ color: ev.target.value })} style={{ width: 44, height: 26, border: "none", background: "none", cursor: "pointer" }} />
          <span style={{ display: "flex", gap: 4 }}>{["#ffffff", "#4fc3ff", "#2563eb", "#22c55e", "#facc15", "#f97316", "#ef4444", "#d946ef"].map((c) => (
            <button key={c} onClick={() => setTop({ color: c })} style={{ width: 16, height: 16, borderRadius: 4, border: "1px solid #0006", background: c, cursor: "pointer", padding: 0 }} />))}</span>
        </label>
      )}
      {fields.map((def) => <NumberField key={def.key} def={def} value={e[def.key]} onChange={(v) => setEng(def.key, v)} />)}

      <div style={S.section}>
        <div style={S.h}>Position</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {[["x", "X (m)"], ["y", "Y (m)"], ["z", "Height (m)"], ["rotation", "Rotation (°)"]].map(([k, l]) => (
            <label key={k} style={{ display: "grid", gap: 3, ...S.label }}>{l}
              <input style={S.field} type="number" step={k === "rotation" ? 5 : 0.1} value={Number(f[k]) || 0} onChange={(ev) => setTop({ [k]: Number(ev.target.value) || 0 })} />
            </label>
          ))}
        </div>
      </div>

      <div style={S.section}>
        <div style={S.h}>Connections</div>
        {!mine.length && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Not connected.</div>}
        {mine.map((l) => {
          const other = byId.get(l.from === f.id ? l.to : l.from);
          return (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 0" }}>
              <span style={{ color: LINK_STYLE[l.kind].color }}>━</span>
              <span style={{ flex: 1, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => onSelect(other?.id)} title="Select">
                {l.from === f.id ? "→ " : "← "}{other?.label || "?"}
              </span>
              <button style={{ ...S.btn, padding: "2px 7px", fontSize: 11 }} onClick={() => onSelectLink(l.id)}>Edit</button>
              <button style={{ ...S.btn, padding: "2px 7px", fontSize: 11 }} onClick={() => commit(disconnectLink(fixturesRef.current, l), "Connection unplugged.")}>Unplug</button>
            </div>
          );
        })}
        {candidates.length > 0 && (
          <select style={{ ...S.field, marginTop: 6 }} value="" onChange={(ev) => { const r = connectPair(fixturesRef.current, f.id, ev.target.value); commit(r.fixtures, r.message); }}>
            <option value="">+ Connect to…</option>
            {candidates.map((x) => <option key={x.id} value={x.id}>{ROLE_UI[roleOf(x)].label}: {x.label}</option>)}
          </select>
        )}
      </div>

      <div style={S.section}>
        <button style={{ ...S.btn, width: "100%", textAlign: "left" }} onClick={() => setAllOpen((v) => !v)}>{allOpen ? "▾" : "▸"} All properties ({extra.length})</button>
        {allOpen && (
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {extra.map(([k, v]) => (
              <label key={k} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, alignItems: "center", ...S.label }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={k}>{k}</span>
                {typeof v === "boolean"
                  ? <input type="checkbox" checked={v} onChange={(ev) => setEng(k, ev.target.checked)} />
                  : <input style={S.field} type={typeof v === "number" ? "number" : "text"} value={v} onChange={(ev) => setEng(k, typeof v === "number" ? (ev.target.value === "" ? 0 : Number(ev.target.value)) : ev.target.value)} />}
              </label>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, ...S.section }}>
        <button style={{ ...S.btn, flex: 1 }} onClick={onDuplicate} title="Ctrl+D">Duplicate</button>
        <button style={{ ...S.btn, flex: 1, color: "var(--red)" }} onClick={onDelete} title="Delete">Delete</button>
      </div>
      {entry?.generic !== false && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Values are generic estimates — check the supplier datasheet.</div>}
    </div>
  );
}

/** What the laser safety rule does to this projector right now (same rule as the full preview). */
function LaserStatus({ f, on, center, safetyBasin, setEng }) {
  const w = engineeringToWorld(f, center);
  const e = f.engineering || {};
  const mount = Math.max(Number(f.z) || 0, Number(e.mountHeightM ?? 0.5));
  const frame = laserFrame({ id: f.id, x: w.x, z: w.z, y: mount, rotation: Number(f.rotation) || 0, engineering: e },
    laserStateOf(f, true), 0, { basin: safetyBasin });
  const blanked = frame.blanked > 0 && frame.beams.length === 0;
  return (
    <div style={{ background: "var(--bg-surface)", borderRadius: 6, padding: 8, fontSize: 12, lineHeight: 1.45 }}>
      {!on ? <span style={{ color: "var(--text-muted)" }}>Switched off.</span>
        : blanked ? (<>
          <div style={{ color: "var(--red)" }}>Blanked: it stands in audience space below the 3 m minimum beam height, so it may not fire.</div>
          <button style={{ ...S.btn, marginTop: 6, padding: "3px 8px", fontSize: 11 }} onClick={() => setEng("mountHeightM", 3.5)}>Mount on a 3.5 m truss</button>
        </>)
        : <span>{frame.beams.length} beam{frame.beams.length === 1 ? "" : "s"} · {e.laserClass ? `class ${e.laserClass}` : "show laser"}{e.opticalPowerW ? ` · ${e.opticalPowerW} W` : ""}
          {frame.clamped > 0 && <div style={{ color: "var(--amber)" }}>{frame.clamped} beam{frame.clamped === 1 ? "" : "s"} raised to stay 3 m above the audience.</div>}</span>}
      <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 4 }}>Preview only — AquaFlow never arms a laser. Class 3B/4 needs a key switch, e-stop and a show permit.</div>
    </div>
  );
}

// ─── properties: one connection ─────────────────────────────────────────────

function LinkProperties({ link, byId, fixtures, commit, fixturesRef, onDone, onSelect }) {
  const from = byId.get(link.from), to = byId.get(link.to);
  const style = LINK_STYLE[link.kind];
  const optionsFor = (fixedId, current) => fixtures.filter((x) => x.id !== current && canConnect(fixtures, fixedId, x.id));
  const replug = (end, target) => {
    const r = replugLink(fixturesRef.current, link, end, target);
    commit(r.ok ? r.fixtures : fixturesRef.current, r.message);
    if (r.ok) onDone();
  };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 10, color: style.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{style.label}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>
        <span style={{ cursor: "pointer" }} onClick={() => onSelect(from?.id)}>{from?.label}</span>
        <span style={{ color: style.color }}> ━▶ </span>
        <span style={{ cursor: "pointer" }} onClick={() => onSelect(to?.id)}>{to?.label}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>Drag the white plug at either end of the line in 3D onto another item, or choose here.</div>
      <label style={{ display: "grid", gap: 3, ...S.label }}>Plug the start into
        <select style={S.field} value="" onChange={(e) => replug("from", e.target.value)}>
          <option value="">{from?.label} (current)</option>
          {optionsFor(link.to, link.from).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <label style={{ display: "grid", gap: 3, ...S.label }}>Plug the end into
        <select style={S.field} value="" onChange={(e) => replug("to", e.target.value)}>
          <option value="">{to?.label} (current)</option>
          {optionsFor(link.from, link.to).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <button style={{ ...S.btn, color: "var(--red)" }} onClick={() => { commit(disconnectLink(fixturesRef.current, link), "Connection unplugged."); onDone(); }}>Unplug this connection</button>
    </div>
  );
}

// ─── overview (nothing selected) ────────────────────────────────────────────

function Overview({ fixtures, design, water, commit, fixturesRef, geometry, params, poolType, updateEngineering, onSelect }) {
  const problems = useMemo(() => connectionProblems(fixtures, design).filter((p) => p.code !== "nozzle-no-valve" && p.code !== "light-unpaired"), [fixtures, design]);
  const shape = geometry?.type === "circle" ? "circle" : (!geometry || (geometry.points?.length === 4 && poolType === "rectangular")) ? "rect" : "custom";
  const b = poolBounds(geometry, params, poolType);
  const setBasin = (next) => {
    if (next.shape === "circle") {
      const radius = Math.max(1, next.radius);
      updateEngineering({ poolType: "circular", params: { ...params, radius, width: radius * 2, length: radius * 2 }, geometry: { type: "circle", center: { x: b.cx, y: b.cy }, radius } });
    } else {
      const w = Math.max(1, next.width), l = Math.max(1, next.length);
      const x0 = b.cx - w / 2, y0 = b.cy - l / 2;
      updateEngineering({ poolType: "rectangular", params: { ...params, width: w, length: l },
        geometry: { type: "polygon", closed: true, points: [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + l }, { x: x0, y: y0 + l }] } });
    }
  };
  const width = r3(b.maxX - b.minX), length = r3(b.maxY - b.minY), radius = r3(b.radius || width / 2);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>Your fountain</div>
      {!fixtures.length && (
        <ol style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, margin: 0, paddingLeft: 18 }}>
          <li>Drag a <b>pump</b> from the tray into the 3D space.</li>
          <li>Drag <b>nozzles</b> where you want jets — each one connects to the pump.</li>
          <li>Add <b>lights</b> next to nozzles; they pair themselves.</li>
          <li>Click anything to change its power, height, colour… and watch the water.</li>
        </ol>
      )}
      {[...water.pumps.values()].map((p) => (
        <div key={p.id} onClick={() => onSelect(p.id)} style={{ cursor: "pointer", background: "var(--bg-surface)", borderRadius: 6, padding: 8, fontSize: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><b>{p.name}</b><span style={{ color: p.loadPct > 100 ? "var(--red)" : "var(--green)" }}>{p.loadPct ?? "—"}%</span></div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.jets} jets · {p.powerKw} kW · speed {p.speedPct}%</div>
        </div>
      ))}
      {problems.length > 0 && (
        <div style={S.section}>
          <div style={S.h}>Needs attention ({problems.length})</div>
          {problems.slice(0, 10).map((p, i) => (
            <div key={i} style={{ fontSize: 11.5, padding: "4px 0", display: "grid", gap: 4 }}>
              <span style={{ color: p.severity === "error" ? "var(--red)" : "var(--amber)", cursor: "pointer" }} onClick={() => onSelect(p.ids[0])}>{p.text}</span>
              {p.fix?.apply && <button style={{ ...S.btn, padding: "3px 8px", fontSize: 11, justifySelf: "start" }} onClick={() => commit(p.fix.apply(fixturesRef.current), p.fix.label)}>{p.fix.label}</button>}
            </div>
          ))}
        </div>
      )}
      <div style={S.section}>
        <div style={S.h}>Basin</div>
        {shape === "custom" ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Custom basin shape from the Site designer ({width} × {length} m). Edit it there.</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ ...S.btn, flex: 1, ...(shape === "rect" ? S.btnOn : {}) }} onClick={() => setBasin({ shape: "rect", width, length })}>Rectangle</button>
              <button style={{ ...S.btn, flex: 1, ...(shape === "circle" ? S.btnOn : {}) }} onClick={() => setBasin({ shape: "circle", radius: Math.max(width, length) / 2 })}>Circle</button>
            </div>
            {shape === "circle"
              ? <NumberField def={{ label: "Radius", unit: "m", min: 1, max: 60, step: 0.5, slider: true }} value={radius} onChange={(v) => setBasin({ shape: "circle", radius: Number(v) || 1 })} />
              : <>
                <NumberField def={{ label: "Width", unit: "m", min: 1, max: 120, step: 0.5, slider: true, sliderMax: 60 }} value={width} onChange={(v) => setBasin({ shape: "rect", width: Number(v) || 1, length })} />
                <NumberField def={{ label: "Length", unit: "m", min: 1, max: 120, step: 0.5, slider: true, sliderMax: 60 }} value={length} onChange={(v) => setBasin({ shape: "rect", width, length: Number(v) || 1 })} />
              </>}
          </div>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--text-muted)", lineHeight: 1.6, ...S.section }}>
        Delete removes the selected item · Ctrl+Z undo · Ctrl+D duplicate · Esc deselect. Everything here is the Engineering project, so Site Design, Show Programming and the full 3D preview see the same fountain.
      </div>
    </div>
  );
}

// ─── asset tray ─────────────────────────────────────────────────────────────

function AssetTray({ tab, setTab, query, setQuery, onAdd }) {
  const [axes, setAxes] = useState(0);
  const group = ASSET_GROUPS.find((g) => g.id === tab);
  const list = useMemo(() => assetsFor(tab, query, group?.axes ? axes : 0), [tab, query, axes, group]);
  const counts = useMemo(() => Object.fromEntries(ASSET_GROUPS.map((g) => [g.id, assetsFor(g.id).length])), []);
  return (
    <div style={{ gridRow: 3, gridColumn: 1, borderTop: "1px solid var(--border-mid)", background: "var(--bg-panel)", display: "grid", gridTemplateRows: "auto minmax(0,1fr)", minWidth: 0, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginRight: 4 }}>Assets</span>
        {ASSET_GROUPS.map((g) => (
          <button key={g.id} onClick={() => setTab(g.id)} style={{ ...S.btn, padding: "4px 10px", ...(tab === g.id ? S.btnOn : {}) }}>
            {g.label} <span style={{ opacity: 0.6 }}>{counts[g.id]}</span>
          </button>
        ))}
        {group?.axes && (
          <span style={{ display: "flex", gap: 4, marginLeft: 8 }}>
            {[[0, "All"], [1, "1D"], [2, "2D"], [3, "3D"]].map(([n, l]) => (
              <button key={n} onClick={() => setAxes(n)} style={{ ...S.btn, padding: "3px 9px", fontSize: 11, ...(axes === n ? S.btnOn : {}) }}>{l}</button>
            ))}
          </span>
        )}
        <input style={{ ...S.field, width: 200, marginLeft: "auto" }} placeholder="Search assets…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", overflowY: "hidden", padding: "4px 10px 10px", alignItems: "stretch" }}>
        {!list.length && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: 10 }}>No assets match.</div>}
        {list.map((a) => {
          const role = roleOf(a);
          const fx = effectOf({ type: a.key });
          const ui = fx ? EFFECT_UI[fx] : isMovingNozzle(a) ? { ...ROLE_UI.nozzle, label: `Moving ${axesOf(a)}D`, icon: "⤧" } : ROLE_UI[role];
          return (
            <div key={a.key} draggable
              onDragStart={(e) => { e.dataTransfer.setData("application/x-aquaflow-asset", a.key); e.dataTransfer.setData("text/plain", a.label); e.dataTransfer.effectAllowed = "copy"; }}
              onDoubleClick={() => onAdd(a.key)}
              title={`${a.label}\n${a.family || ""}\nDrag into the 3D space (or double-click to add in the middle).`}
              style={{ flex: "0 0 132px", background: "var(--bg-surface)", border: "1px solid var(--border-mid)", borderRadius: 8, padding: 8, cursor: "grab", display: "grid", gridTemplateRows: "auto auto 1fr", gap: 4, userSelect: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 26, height: 26, borderRadius: 6, display: "grid", placeItems: "center", background: `${a.color || ui.color}33`, color: a.color || ui.color, fontSize: 14 }}>{a.icon || ui.icon}</span>
                <span style={{ fontSize: 9.5, color: ui.color, fontWeight: 700, textTransform: "uppercase" }}>{ui.label}</span>
              </div>
              <div style={{ fontSize: 11.5, lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{a.label}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", alignSelf: "end" }}>{assetSummary(a)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
