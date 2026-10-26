// ConnectionsEditor.jsx — Engineering Tools → Connections: link pumps, solenoid valves, nozzles
// and lights the easy way, see each pump's load, and fix what is not connected.
//
//   plan       every pump (square, its own colour), valve (diamond), nozzle (circle) and light
//              (yellow ring) with lines pump → valve / nozzle, valve → nozzle, light → nozzle;
//              unconnected items glow red
//   modes      Select · Connect to pump · Connect valve · Pair light — pick the source (a pump,
//              a valve, a nozzle) then click or drag a box over the targets (Shift = add, Alt = remove)
//   inspector  the selected item's links as dropdowns
//   auto       One valve per nozzle · Nearest pump · By zone / group · Pair lights — previewed,
//              applied as one undoable step
//   loads      rated flow vs all jets open and vs the show's real peak, head check, VFD
//   problems   everything unconnected or connected two ways, each with a one-click fix
//
// Writes go through engineering/connections.js (both sides of every link, existing fields
// only) and the engineering store, recorded in the shared drafting history (Undo / Ctrl+Z).
import { useCallback, useMemo, useRef, useState } from "react";
import useEngineeringStore from "../../../store/engineeringStore";
import useProjectStore from "../../../store/projectStore";
import { sharedDraftingHistory } from "../../../engineering/drafting/commands";
import { createStoreSceneHistory } from "../../preview/editor/engineeringDraftingBridge";
import {
  autoPairLights, autoPumps, autoValves, connectionProblems, connectToPump, connectValve, describeChange, disconnectValve,
  pairLights, problemGroups, readConnections, setNozzleValve, setValveNozzle,
} from "../../../engineering/connections";
import { DEFAULT_FLOW_MARGIN_PCT, clockOf, jetFlowLpm, pumpLoads } from "../../../engineering/pumpFlow";
import { pumpPeaks } from "../../programmer/studio/showMetrics";
import { openDiagnosticFix } from "../../../preflight/preflight";

export const PUMP_COLORS = ["#4f8cff", "#2fd3a2", "#f59e0b", "#e75ad1", "#a3e635", "#38bdf8", "#f87171", "#c084fc"];
const MODES = [["select", "Select"], ["pump", "Connect to pump"], ["valve", "Connect valve"], ["light", "Pair light"]];
const HINT = {
  select: "Click an item to see and edit its links. Drag a box to select several (then “+ Add selected” on a pump).",
  pump: "Pick a pump (click it on the plan or choose it here), then click or drag a box over nozzles / valves. Shift = add, Alt = remove.",
  valve: "Pick a valve, then click its nozzle (Shift = add another nozzle, Alt = remove).",
  light: "Pick a nozzle, then click or box the lights that belong to it (Alt = unpair). Or pick a light, then click its nozzle.",
};
const SEV = { error: "#f87171", warning: "#f59e0b", info: "#7ab8ff" };
const name = (item) => String(item?.label || item?.name || item?.id || "");
const btn = (on = false) => ({ padding: "4px 9px", fontSize: 10, cursor: "pointer", borderRadius: 4, border: "1px solid var(--border, #234)",
  background: on ? "var(--accent, #2b6cb0)" : "var(--bg-surface, #0b1622)", color: on ? "#fff" : "var(--text-secondary, #cde)" });
const small = { fontSize: 10, color: "var(--text-muted, #89a)" };

/** Write fixtures through the engineering store as one undoable step. */
export function commitFixtures(next, label, { store = useEngineeringStore, history = sharedDraftingHistory } = {}) {
  const s = store.getState();
  if (!next || next === s.fixtures) return false;
  history.record({ label, source: "connections", before: { fixtures: s.fixtures || [] }, after: { fixtures: next }, keys: ["fixtures"] });
  s.updateEngineering({ fixtures: next });
  return true;
}

/** Store-wired editor (Engineering Tools → Connections). */
export default function ConnectionsEditor() {
  const fixtures = useEngineeringStore((s) => s.fixtures) || [];
  const programmer = useProjectStore((s) => s.programmer);
  const scene = useMemo(() => createStoreSceneHistory(useEngineeringStore), []);
  const [, bump] = useState(0);
  const commit = useCallback((next, label) => { const ok = commitFixtures(next, label); bump((v) => v + 1); return ok; }, []);
  const undo = useCallback(() => { scene.undo(); bump((v) => v + 1); }, [scene]);
  const marginPct = Number(programmer?.studio?.site?.flowMarginPct) || DEFAULT_FLOW_MARGIN_PCT;
  return <ConnectionsEditorView fixtures={fixtures} clips={programmer?.timelineClips || null} onCommit={commit} onUndo={undo}
    canUndo={sharedDraftingHistory.canUndo()} undoLabel={sharedDraftingHistory.state().undoLabel} marginPct={marginPct} />;
}

export function ConnectionsEditorView({ fixtures = [], clips = null, onCommit, onUndo = null, canUndo = false, undoLabel = null, marginPct = DEFAULT_FLOW_MARGIN_PCT }) {
  const design = useMemo(() => readConnections(fixtures), [fixtures]);
  const [mode, setMode] = useState("select");
  const [active, setActive] = useState(null);          // the picked source id (pump / valve / nozzle / light)
  const [selected, setSelected] = useState([]);        // selected ids (select mode)
  const [preview, setPreview] = useState(null);        // { title, lines, fixtures }
  const [scopeSelected, setScopeSelected] = useState(false);
  const [show, setShow] = useState({ pumps: true, valves: true, lights: true });
  const [openGroup, setOpenGroup] = useState(null);
  const [status, setStatus] = useState("");

  const pumpIds = useMemo(() => [...design.pumps.keys()], [design]);
  const colorOf = useCallback((pid) => (pid ? PUMP_COLORS[Math.max(0, pumpIds.indexOf(pid)) % PUMP_COLORS.length] : "#5b6b7b"), [pumpIds]);
  const roleOf = useCallback((id) => (design.pumps.has(id) ? "pump" : design.valves.has(id) ? "valve" : design.nozzleById.has(id) ? "nozzle"
    : design.lights.some((l) => l.id === id) ? "light" : null), [design]);
  const itemOf = useCallback((id) => design.pumps.get(id)?.item || design.valves.get(id)?.item || design.nozzleById.get(id)?.item
    || design.lights.find((l) => l.id === id)?.item || null, [design]);

  const problems = useMemo(() => connectionProblems(fixtures, design), [fixtures, design]);
  const groups = useMemo(() => problemGroups(problems), [problems]);
  const flagged = useMemo(() => new Set(problems.filter((p) => p.severity !== "info").flatMap((p) => p.ids)), [problems]);
  const peaks = useMemo(() => (Array.isArray(clips) && clips.length ? pumpPeaks(clips, design, { marginPct }) : null), [clips, design, marginPct]);
  const loads = useMemo(() => pumpLoads(design, { marginPct, peaks }), [design, marginPct, peaks]);

  const apply = useCallback((next, label) => {
    if (!next || next === fixtures) { setStatus("Nothing to change."); return; }
    onCommit?.(next, label);
    setStatus(`${label}: ${describeChange(fixtures, next)}.`);
  }, [fixtures, onCommit]);

  // ── clicks on the plan ──
  const onItem = useCallback((id, ev = {}) => {
    const role = roleOf(id), add = !!ev.shiftKey, remove = !!ev.altKey;
    if (mode === "select") {
      setSelected((cur) => (add ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]));
      return;
    }
    if (mode === "pump") {
      if (role === "pump") { setActive(id); return; }
      if (!design.pumps.has(active)) { setStatus("Pick a pump first."); return; }
      if (role === "nozzle" || role === "valve") {
        const cur = role === "nozzle" ? design.nozzleById.get(id).pumpId : design.valves.get(id).nozzleIds.map((n) => design.nozzleById.get(n).pumpId)[0];
        if (remove) { if (cur === active) apply(connectToPump(fixtures, [id], null, design), `Disconnect from ${design.pumps.get(active).name}`); }
        else apply(connectToPump(fixtures, [id], active, design), `Connect to ${design.pumps.get(active).name}`);
      }
      return;
    }
    if (mode === "valve") {
      if (role === "valve") { setActive(id); return; }
      if (role !== "nozzle") return;
      if (!design.valves.has(active)) { setStatus("Pick a valve first."); return; }
      if (remove) { if (design.nozzleById.get(id).valveId === active) apply(disconnectValve(fixtures, [id], design), "Unlink valve"); }
      else if (add) apply(connectValve(fixtures, active, [id], {}, design), "Link valve");
      else apply(setValveNozzle(fixtures, active, id, design), "Link valve");
      return;
    }
    if (mode === "light") {
      const activeRole = roleOf(active);
      if (role === "nozzle") {
        if (activeRole === "light") { apply(pairLights(fixtures, [active], id, design), "Pair light"); setActive(null); }
        else setActive(id);
      } else if (role === "light") {
        if (activeRole === "nozzle") apply(pairLights(fixtures, [id], remove ? null : active, design), remove ? "Unpair light" : "Pair light");
        else setActive(id);
      }
    }
  }, [mode, active, design, fixtures, apply, roleOf]);

  const onBox = useCallback((ids, ev = {}) => {
    const remove = !!ev.altKey;
    if (mode === "select") { setSelected((cur) => (ev.shiftKey ? [...new Set([...cur, ...ids])] : ids)); return; }
    if (mode === "pump" && design.pumps.has(active)) {
      const targets = ids.filter((id) => design.nozzleById.has(id) || design.valves.has(id));
      const mine = remove ? targets.filter((id) => (design.nozzleById.get(id)?.pumpId || design.valves.get(id)?.nozzleIds.map((n) => design.nozzleById.get(n).pumpId)[0]) === active) : targets;
      if (mine.length) apply(connectToPump(fixtures, mine, remove ? null : active, design), `${remove ? "Disconnect" : "Connect"} ${mine.length} to ${design.pumps.get(active).name}`);
    } else if (mode === "valve" && design.valves.has(active)) {
      const noz = ids.filter((id) => design.nozzleById.has(id));
      if (noz.length) apply(remove ? disconnectValve(fixtures, noz.filter((id) => design.nozzleById.get(id).valveId === active), design) : connectValve(fixtures, active, noz, {}, design), "Link valve");
    } else if (mode === "light" && design.nozzleById.has(active)) {
      const ls = ids.filter((id) => roleOf(id) === "light");
      if (ls.length) apply(pairLights(fixtures, ls, remove ? null : active, design), remove ? "Unpair lights" : `Pair ${ls.length} lights`);
    }
  }, [mode, active, design, fixtures, apply, roleOf]);

  // ── auto-connect ──
  const scope = scopeSelected && selected.length ? selected : null;
  const runAuto = (kind) => {
    let res, title;
    if (kind === "valves") { res = autoValves(fixtures, { ids: scope }); title = "One valve per nozzle"; }
    if (kind === "nearest") { res = autoPumps(fixtures, { mode: "nearest", ids: scope }); title = "Nearest pump"; }
    if (kind === "group") { res = autoPumps(fixtures, { mode: "group", ids: scope }); title = "Pumps by zone / group"; }
    if (kind === "lights") { res = autoPairLights(fixtures, { ids: scope }); title = "Pair lights to nearest nozzle"; }
    setPreview({ title, lines: res.lines, fixtures: res.fixtures });
  };

  const sel = mode === "select" ? (selected.length === 1 ? selected[0] : null) : active;
  return (
    <div data-testid="connections-editor" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {MODES.map(([k, label]) => (
          <button key={k} type="button" style={btn(mode === k)} aria-pressed={mode === k}
            onClick={() => { setMode(k); setActive(k === "pump" && !design.pumps.has(active) ? pumpIds[0] || null : k === "select" ? null : active); }}>{label}</button>
        ))}
        {mode === "pump" && (
          <select aria-label="Active pump" value={design.pumps.has(active) ? active : ""} onChange={(e) => setActive(e.target.value || null)} style={{ fontSize: 10 }}>
            <option value="">— pick a pump —</option>
            {[...design.pumps.values()].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <span style={{ flex: 1 }} />
        {onUndo && <button type="button" style={btn()} disabled={!canUndo} onClick={onUndo} title={undoLabel || ""}>↶ Undo{undoLabel ? ` ${undoLabel}` : ""}</button>}
      </div>
      <div style={small}>{HINT[mode]}{active && mode !== "select" ? ` · Picked: ${name(itemOf(active))}` : ""}</div>
      {status && <div role="status" style={{ ...small, color: "var(--text-accent, #9fd)" }}>{status}</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "2 1 420px", minWidth: 300 }}>
          <PlanView design={design} colorOf={colorOf} flagged={flagged} mode={mode} active={active} selected={mode === "select" ? selected : []}
            show={show} onItem={onItem} onBox={onBox} />
          <div style={{ display: "flex", gap: 10, ...small, marginTop: 4 }}>
            {[["pumps", "Pump lines"], ["valves", "Valve lines"], ["lights", "Light lines"]].map(([k, label]) => (
              <label key={k}><input type="checkbox" checked={show[k]} onChange={() => setShow((s) => ({ ...s, [k]: !s[k] }))} /> {label}</label>
            ))}
            <span>{design.summary}</span>
          </div>
        </div>
        <div style={{ flex: "1 1 260px", minWidth: 240, display: "flex", flexDirection: "column", gap: 10 }}>
          <Inspector id={sel} design={design} fixtures={fixtures} selected={selected} apply={apply} roleOf={roleOf} colorOf={colorOf} loads={loads} />
          <section>
            <h4 style={{ margin: "0 0 4px", fontSize: 11 }}>Auto-connect</h4>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" style={btn()} onClick={() => runAuto("valves")}>One valve per nozzle</button>
              <button type="button" style={btn()} onClick={() => runAuto("nearest")}>Nearest pump</button>
              <button type="button" style={btn()} onClick={() => runAuto("group")}>By zone / group</button>
              <button type="button" style={btn()} onClick={() => runAuto("lights")}>Pair lights to nearest nozzle</button>
            </div>
            <label style={{ ...small, display: "block", marginTop: 4 }}>
              <input type="checkbox" checked={scopeSelected} onChange={() => setScopeSelected((v) => !v)} /> Selected items only ({selected.length})
            </label>
            {preview && (
              <div data-testid="auto-preview" style={{ marginTop: 6, padding: 6, border: "1px solid var(--border, #234)", borderRadius: 4 }}>
                <b>{preview.title}</b> — {preview.lines.length ? `${preview.lines.length} change${preview.lines.length === 1 ? "" : "s"} (${describeChange(fixtures, preview.fixtures)})` : "nothing to do"}
                <ul style={{ margin: "4px 0", paddingLeft: 16, maxHeight: 120, overflow: "auto" }}>
                  {preview.lines.slice(0, 40).map((l, i) => <li key={i}>{l}</li>)}
                  {preview.lines.length > 40 && <li>… {preview.lines.length - 40} more</li>}
                </ul>
                <button type="button" style={btn(true)} disabled={!preview.lines.length} onClick={() => { apply(preview.fixtures, preview.title); setPreview(null); }}>Apply</button>{" "}
                <button type="button" style={btn()} onClick={() => setPreview(null)}>Cancel</button>
              </div>
            )}
          </section>
        </div>
      </div>

      <section>
        <h4 style={{ margin: "4px 0", fontSize: 11 }}>Pump load{marginPct !== 100 ? ` (margin ${marginPct} %)` : ""}</h4>
        {!loads.length && <div style={small}>No pumps in the design.</div>}
        {loads.map((l) => <LoadBar key={l.id} load={l} color={colorOf(l.id)} onPick={() => { setMode("pump"); setActive(l.id); }} hasShow={!!peaks} />)}
      </section>

      <section>
        <h4 style={{ margin: "4px 0", fontSize: 11 }}>Problems {problems.length ? `(${problems.length})` : ""}</h4>
        {!problems.length && <div style={{ ...small, color: "#2fd3a2" }}>Everything is connected.</div>}
        {groups.map((g) => (
          <div key={g.code} style={{ borderLeft: `3px solid ${SEV[g.severity]}`, paddingLeft: 6, marginBottom: 4 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button type="button" style={{ ...btn(), border: "none", background: "transparent", padding: 0 }} onClick={() => setOpenGroup(openGroup === g.code ? null : g.code)}>
                {openGroup === g.code ? "▾" : "▸"} {g.label}
              </button>
              {g.fixAll && <button type="button" style={btn()} onClick={() => apply(g.fixAll(fixtures), `Fix: ${g.title}`)}>Fix all</button>}
            </div>
            {openGroup === g.code && g.items.slice(0, 50).map((p, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", margin: "2px 0 2px 12px" }}>
                <span style={{ flex: 1 }}>{p.text}</span>
                <button type="button" style={btn()} onClick={() => { setMode("select"); setSelected(p.ids.filter((id) => roleOf(id))); }}>Select</button>
                {p.fix?.apply && <button type="button" style={btn()} onClick={() => apply(p.fix.apply(fixtures), p.fix.label)}>{p.fix.label}</button>}
                {p.fix?.pick && <button type="button" style={btn()} onClick={() => { setMode("pump"); setActive(p.fix.pick); }}>{p.fix.label}</button>}
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}

function LoadBar({ load: l, color, onPick, hasShow }) {
  const scale = Math.max(150, l.allOpenPct || 0, l.peakPct || 0);
  const w = (pct) => `${Math.min(100, (100 * (pct || 0)) / scale)}%`;
  return (
    <div data-testid={`load-${l.id}`} style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <button type="button" onClick={onPick} style={{ ...btn(), padding: "1px 6px", borderColor: color, color }}>{l.name}</button>
        <span>{l.ratedLpm ? `rated ${l.ratedLpm} L/min` : "rated flow ? (add Flow on the pump)"}</span>
        <span style={{ color: l.allOpenOver ? "#f87171" : undefined }}>all {l.jets} open {l.allOpenLpm} L/min{l.allOpenPct ? ` (${l.allOpenPct} %)` : ""}</span>
        <span style={{ color: l.over ? "#f87171" : undefined }}>
          {l.peakLpm != null ? `show peak ${l.peakPct ?? "?"} % at ${clockOf(l.peakT)} (${l.peakLpm} L/min)` : hasShow ? "not in the show" : "no compiled show"}
        </span>
        {l.headOk != null && <span style={{ color: l.headOk ? undefined : "#f87171" }}>head {Math.round(l.headM * 10) / 10} m {l.headOk ? "≥" : "<"} {l.requiredHeadM} m needed</span>}
        <span>{l.vfd ? "VFD" : "no VFD"}</span>
        {l.missingFlow > 0 && <span style={{ color: "#f59e0b" }}>{l.missingFlow} jets without flow data</span>}
      </div>
      <div style={{ position: "relative", height: 10, background: "var(--bg-surface, #0b1622)", borderRadius: 3, overflow: "hidden", marginTop: 2 }}
        aria-label={`${l.name} load`}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 5, width: w(l.allOpenPct), background: l.allOpenOver ? "#f87171" : color, opacity: 0.45 }} />
        <div style={{ position: "absolute", left: 0, top: 5, bottom: 0, width: w(l.peakPct), background: l.over ? "#f87171" : color }} />
        <div style={{ position: "absolute", left: `${(100 * 100) / scale}%`, top: 0, bottom: 0, width: 2, background: "#fff" }} title="Rated flow" />
      </div>
    </div>
  );
}

function sortByDistance(list, from) {
  return [...list].sort((a, b) => Math.hypot(a.item.x - from.x, a.item.y - from.y) - Math.hypot(b.item.x - from.x, b.item.y - from.y));
}

function Inspector({ id, design, fixtures, selected, apply, roleOf, colorOf, loads }) {
  const role = id ? roleOf(id) : null;
  if (!role) return <div style={small}>Select an item on the plan to see its connections.</div>;
  const field = (label, control) => <label style={{ display: "flex", gap: 6, alignItems: "center", margin: "3px 0" }}><span style={{ width: 52 }}>{label}</span>{control}</label>;
  const pumpSelect = (value, onChange) => (
    <select aria-label="Pump" value={value || ""} onChange={(e) => onChange(e.target.value || null)} style={{ flex: 1, fontSize: 10 }}>
      <option value="">— none —</option>
      {[...design.pumps.values()].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
  if (role === "nozzle") {
    const n = design.nozzleById.get(id);
    const valves = sortByDistance([...design.valves.values()], n.item).slice(0, 40);
    if (n.valveId && !valves.some((v) => v.id === n.valveId)) valves.unshift(design.valves.get(n.valveId));
    const paired = design.lights.filter((l) => (l.item.engineering?.pairedNozzleId || l.item.pairedNozzleId) === id);
    const free = sortByDistance(design.lights.filter((l) => !paired.includes(l)), n.item).slice(0, 30);
    return (
      <section data-testid="inspector">
        <h4 style={{ margin: "0 0 4px", fontSize: 11 }}>{name(n.item)} <span style={small}>nozzle · {Math.round(jetFlowLpm(n.item))} L/min · {n.heightM} m</span></h4>
        {field("Valve", (
          <select aria-label="Valve" value={n.valveId || ""} onChange={(e) => apply(setNozzleValve(fixtures, id, e.target.value || null, design), "Set valve")} style={{ flex: 1, fontSize: 10 }}>
            <option value="">— none —</option>
            {valves.map((v) => <option key={v.id} value={v.id}>{name(v.item)}{v.nozzleIds.length && !v.nozzleIds.includes(id) ? " (in use)" : ""}</option>)}
          </select>))}
        {field("Pump", pumpSelect(n.pumpId, (pid) => apply(connectToPump(fixtures, [id], pid, design), "Set pump")))}
        {field("Light", (
          <select aria-label="Light" value="" onChange={(e) => e.target.value && apply(pairLights(fixtures, [e.target.value], id, design), "Pair light")} style={{ flex: 1, fontSize: 10 }}>
            <option value="">{paired.length ? `${paired.length} paired — add another…` : "— pair a light —"}</option>
            {free.map((l) => <option key={l.id} value={l.id}>{name(l.item)}</option>)}
          </select>))}
        {paired.map((l) => (
          <div key={l.id} style={{ marginLeft: 58 }}>{name(l.item)} <button type="button" aria-label={`Unpair ${name(l.item)}`} style={{ ...btn(), padding: "0 5px" }}
            onClick={() => apply(pairLights(fixtures, [l.id], null, design), "Unpair light")}>×</button></div>
        ))}
      </section>
    );
  }
  if (role === "valve") {
    const v = design.valves.get(id);
    const nozzles = sortByDistance(design.nozzles, v.item).slice(0, 40);
    for (const nid of v.nozzleIds) if (!nozzles.some((n) => n.id === nid)) nozzles.unshift(design.nozzleById.get(nid));
    const pumpId = v.nozzleIds.map((nid) => design.nozzleById.get(nid).pumpId).find(Boolean) || null;
    return (
      <section data-testid="inspector">
        <h4 style={{ margin: "0 0 4px", fontSize: 11 }}>{name(v.item)} <span style={small}>solenoid valve</span></h4>
        {field("Nozzle", (
          <select aria-label="Nozzle" value={v.nozzleIds[0] || ""} onChange={(e) => apply(setValveNozzle(fixtures, id, e.target.value || null, design), "Set nozzle")} style={{ flex: 1, fontSize: 10 }}>
            <option value="">— none —</option>
            {nozzles.map((n) => <option key={n.id} value={n.id}>{name(n.item)}{n.valveId && n.valveId !== id ? " (has a valve)" : ""}</option>)}
          </select>))}
        {v.nozzleIds.length > 1 && <div style={small}>Also feeds {v.nozzleIds.slice(1).map((nid) => name(design.nozzleById.get(nid).item)).join(", ")}</div>}
        {field("Pump", pumpSelect(pumpId, (pid) => apply(connectToPump(fixtures, [id], pid, design), "Set pump")))}
      </section>
    );
  }
  if (role === "light") {
    const l = design.lights.find((x) => x.id === id);
    const explicit = l.item.engineering?.pairedNozzleId || l.item.pairedNozzleId;
    const nozzles = sortByDistance(design.nozzles, l.item).slice(0, 40);
    return (
      <section data-testid="inspector">
        <h4 style={{ margin: "0 0 4px", fontSize: 11 }}>{name(l.item)} <span style={small}>light</span></h4>
        {field("Nozzle", (
          <select aria-label="Nozzle" value={explicit && design.nozzleById.has(explicit) ? explicit : ""} onChange={(e) => apply(pairLights(fixtures, [id], e.target.value || null, design), "Pair light")} style={{ flex: 1, fontSize: 10 }}>
            <option value="">— nearest ({l.nozzleId ? name(design.nozzleById.get(l.nozzleId).item) : "none"}) —</option>
            {nozzles.map((n) => <option key={n.id} value={n.id}>{name(n.item)}</option>)}
          </select>))}
      </section>
    );
  }
  const p = design.pumps.get(id);
  const load = loads.find((x) => x.id === id);
  const addable = selected.filter((sid) => design.nozzleById.has(sid) || design.valves.has(sid));
  return (
    <section data-testid="inspector">
      <h4 style={{ margin: "0 0 4px", fontSize: 11, color: colorOf(id) }}>{p.name} <span style={small}>pump · {load?.vfd ? "VFD" : "fixed speed"}{load?.ratedLpm ? ` · ${load.ratedLpm} L/min` : ""}</span></h4>
      <div style={small}>{p.nozzleIds.length} outlet{p.nozzleIds.length === 1 ? "" : "s"} · {p.valveIds.length} valve{p.valveIds.length === 1 ? "" : "s"}</div>
      <div style={{ maxHeight: 160, overflow: "auto", margin: "4px 0" }}>
        {p.nozzleIds.map((nid) => {
          const n = design.nozzleById.get(nid);
          return (
            <div key={nid} style={{ display: "flex", gap: 6 }}>
              <span style={{ flex: 1 }}>{name(n.item)}{n.valveId ? ` · ${name(design.valves.get(n.valveId)?.item)}` : " · no valve"}</span>
              <button type="button" aria-label={`Remove ${name(n.item)}`} style={{ ...btn(), padding: "0 5px" }}
                onClick={() => apply(connectToPump(fixtures, [nid], null, design), `Disconnect from ${p.name}`)}>×</button>
            </div>
          );
        })}
      </div>
      <button type="button" style={btn()} disabled={!addable.length} onClick={() => apply(connectToPump(fixtures, addable, id, design), `Connect to ${p.name}`)}>
        + Add selected ({addable.length})
      </button>{" "}
      <button type="button" style={btn()} onClick={() => openDiagnosticFix({ fix: { kind: "open_engineering_item", target: id } })}>Show in Designer</button>
    </section>
  );
}

/** The 2D plan: shapes in plan metres (y down, as the Engineering Designer draws it). */
function PlanView({ design, colorOf, flagged, mode, active, selected, show, onItem, onBox }) {
  const svgRef = useRef(null);
  const [box, setBox] = useState(null);
  const all = useMemo(() => [...design.nozzles, ...design.valves.values(), ...design.pumps.values(), ...design.lights].map((x) => x.item), [design]);
  const vb = useMemo(() => {
    const xs = all.map((f) => Number(f.x) || 0), ys = all.map((f) => Number(f.y) || 0);
    if (!xs.length) return { x: -10, y: -10, w: 20, h: 20 };
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = Math.max(1, 0.06 * Math.max(x1 - x0, y1 - y0));
    return { x: x0 - pad, y: y0 - pad, w: Math.max(2, x1 - x0 + 2 * pad), h: Math.max(2, y1 - y0 + 2 * pad) };
  }, [all]);
  const u = Math.max(vb.w, vb.h) / 120;   // one "unit" of symbol size
  const P = (f) => [Number(f.x) || 0, Number(f.y) || 0];
  const toWorld = (ev) => {
    const svg = svgRef.current, m = svg?.getScreenCTM?.();
    if (!m || !svg.createSVGPoint) return null;
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const w = pt.matrixTransform(m.inverse());
    return [w.x, w.y];
  };
  const down = (ev) => { if (ev.target !== svgRef.current && !ev.target.dataset?.bg) return; const w = toWorld(ev); if (w) setBox({ a: w, b: w }); };
  const move = (ev) => { if (!box) return; const w = toWorld(ev); if (w) setBox((b) => ({ ...b, b: w })); };
  const up = (ev) => {
    if (!box) return;
    const [ax, ay] = box.a, [bx, by] = box.b;
    setBox(null);
    if (Math.hypot(ax - bx, ay - by) < u) return;
    const [x0, x1, y0, y1] = [Math.min(ax, bx), Math.max(ax, bx), Math.min(ay, by), Math.max(ay, by)];
    const inside = all.filter((f) => { const [x, y] = P(f); return x >= x0 && x <= x1 && y >= y0 && y <= y1; }).map((f) => f.id);
    if (inside.length) onBox(inside, ev);
  };
  const hl = new Set(selected);
  const click = (id) => (ev) => { ev.stopPropagation(); onItem(id, ev); };
  const ring = (id) => (id === active ? "#ffffff" : hl.has(id) ? "#9fd3ff" : flagged.has(id) ? "#f87171" : "none");
  const lightsOnTop = mode === "light";
  const lines = [];
  if (show.pumps) for (const p of design.pumps.values()) {
    const [px, py] = P(p.item);
    for (const nid of p.nozzleIds) {
      const n = design.nozzleById.get(nid), v = n.valveId ? design.valves.get(n.valveId)?.item : null;
      const [x, y] = P(v || n.item);
      lines.push(<line key={`p${nid}`} x1={px} y1={py} x2={x} y2={y} stroke={colorOf(p.id)} strokeWidth={u * 0.25} opacity={p.id === active ? 0.8 : 0.3} />);
    }
  }
  if (show.valves) for (const n of design.nozzles) if (n.valveId) {
    const v = design.valves.get(n.valveId)?.item; if (!v) continue;
    const [a, b] = P(v), [c, d] = P(n.item);
    if (Math.hypot(a - c, b - d) > 1e-3) lines.push(<line key={`v${n.id}`} x1={a} y1={b} x2={c} y2={d} stroke="#f97316" strokeWidth={u * 0.3} />);
  }
  if (show.lights) for (const l of design.lights) if (l.nozzleId) {
    const n = design.nozzleById.get(l.nozzleId).item, [a, b] = P(l.item), [c, d] = P(n);
    const explicit = (l.item.engineering?.pairedNozzleId || l.item.pairedNozzleId) === l.nozzleId;
    if (Math.hypot(a - c, b - d) > 1e-3) lines.push(<line key={`l${l.id}`} x1={a} y1={b} x2={c} y2={d} stroke="#facc15" strokeWidth={u * 0.2} strokeDasharray={explicit ? undefined : `${u} ${u}`} />);
  }
  const lightShapes = design.lights.map((l) => {
    const [x, y] = P(l.item);
    return <circle key={l.id} data-id={l.id} data-role="light" cx={x} cy={y} r={u * 1.6} fill="transparent" stroke={ring(l.id) !== "none" ? ring(l.id) : "#facc15"}
      strokeWidth={u * (ring(l.id) !== "none" ? 0.7 : 0.35)} style={{ cursor: "pointer" }} onClick={click(l.id)}><title>{name(l.item)}</title></circle>;
  });
  const nozzleShapes = design.nozzles.map((n) => {
    const [x, y] = P(n.item);
    return <circle key={n.id} data-id={n.id} data-role="nozzle" cx={x} cy={y} r={u * 1.1} fill={colorOf(n.pumpId)} stroke={ring(n.id)} strokeWidth={u * 0.6}
      style={{ cursor: "pointer" }} onClick={click(n.id)}><title>{`${name(n.item)}${n.pumpId ? ` · ${design.pumps.get(n.pumpId).name}` : " · no pump"}${n.valveId ? "" : " · no valve"}`}</title></circle>;
  });
  const valveShapes = [...design.valves.values()].map((v) => {
    const [x, y] = P(v.item), s = u * 0.8;
    return <polygon key={v.id} data-id={v.id} data-role="valve" points={`${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`} fill="#f97316"
      stroke={ring(v.id)} strokeWidth={u * 0.5} style={{ cursor: "pointer" }} onClick={click(v.id)}><title>{name(v.item)}</title></polygon>;
  });
  const pumpShapes = [...design.pumps.values()].map((p) => {
    const [x, y] = P(p.item), s = u * 2.2;
    return <g key={p.id}>
      <rect data-id={p.id} data-role="pump" x={x - s} y={y - s} width={2 * s} height={2 * s} fill={colorOf(p.id)} stroke={ring(p.id) === "none" ? "#0b1622" : ring(p.id)}
        strokeWidth={u * 0.6} style={{ cursor: "pointer" }} onClick={click(p.id)}><title>{p.name}</title></rect>
      <text x={x} y={y - s - u * 0.8} fontSize={u * 2.6} fill={colorOf(p.id)} textAnchor="middle" pointerEvents="none">{p.name}</text>
    </g>;
  });
  return (
    <svg ref={svgRef} data-testid="connections-plan" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: 420, background: "#06101a", borderRadius: 4, border: "1px solid var(--border, #234)", touchAction: "none", userSelect: "none" }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setBox(null)}>
      <rect data-bg="1" x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="transparent" />
      <g>{lines}</g>
      {!lightsOnTop && lightShapes}
      {nozzleShapes}
      {valveShapes}
      {pumpShapes}
      {lightsOnTop && lightShapes}
      {box && <rect x={Math.min(box.a[0], box.b[0])} y={Math.min(box.a[1], box.b[1])} width={Math.abs(box.a[0] - box.b[0])} height={Math.abs(box.a[1] - box.b[1])}
        fill="rgba(120,180,255,0.12)" stroke="#78b4ff" strokeWidth={u * 0.3} strokeDasharray={`${u} ${u}`} pointerEvents="none" />}
    </svg>
  );
}
