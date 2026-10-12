import { useEffect, useMemo, useState } from "react";
import { siemensRequest } from "../../../utils/siemensSite";
import SiemensTerm from "./SiemensTerm";

const FIRMWARE = { "s7-1200": ["V4.2", "V4.3", "V4.4", "V4.5", "V4.6", "V4.7"], "s7-1500": ["V2.9", "V3.0", "V3.1", "V4.0", "V4.1"], "et200sp": ["V2.9", "V3.0", "V3.1", "V4.0", "V4.1"] };
const FAMILY_LABEL = { "s7-1200": "S7-1200 G1", "s7-1500": "S7-1500", "et200sp": "ET 200SP CPU" };
export const firmwareFor = family => FIRMWARE[family] || FIRMWARE["s7-1200"];
// Free module slot for a CPU family: S7-1200 slots 2-9, S7-1500 rack and ET 200SP up to their module count.
export function freeSlot(cpu, modules) {
  const used = new Set(modules.map(m => m.slot));
  const last = cpu?.family === "s7-1200" ? 9 : (cpu?.max_modules ?? 8) + 1;
  for (let slot = 2; slot <= last; slot++) if (!used.has(slot)) return slot;
  return null;
}

export function hardwareCapacity(hardware, catalog) {
  const byId = new Map(catalog.map(item => [item.id, item]));
  const parts = [hardware.cpu, hardware.signal_board, ...hardware.modules.map(m => m.catalog)].map(id => byId.get(id)).filter(Boolean);
  return ["di", "dq", "ai", "aq"].reduce((total, key) => ({ ...total, [key]: parts.reduce((sum, part) => sum + (part[key] || 0), 0) }), {});
}

export default function SiemensHardwarePicker({ site, onSaved }) {
  const [catalog, setCatalog] = useState([]);
  const [note, setNote] = useState("");
  const [hardware, setHardware] = useState(site.hardware || null);
  const [options, setOptions] = useState({ pump_feedback: true, pump_fault: true, valve_feedback: false, reassign_all: false });
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    siemensRequest("/hardware/catalog").then(result => {
      setCatalog(result.catalog); setNote(result.note);
      setHardware(current => current || result.default);
    }).catch(e => setMessage(e.message));
  }, []);
  useEffect(() => { setHardware(site.hardware || hardware); setPreview(null); }, [site.id, site.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const cpus = catalog.filter(c => c.kind === "cpu");
  const currentCpu = cpus.find(c => c.id === hardware?.cpu);
  const family = currentCpu?.family || "s7-1200";
  const boards = family === "s7-1200" ? catalog.filter(c => c.kind === "sb") : [];
  const modules = catalog.filter(c => c.kind === "sm" && (c.family || "s7-1200") === family);
  const cpu = cpus.find(c => c.id === hardware?.cpu);
  const capacity = useMemo(() => hardware && catalog.length ? hardwareCapacity(hardware, catalog) : null, [hardware, catalog]);
  const need = useMemo(() => {
    const pumps = site.channels.filter(c => c.kind === "pump").length, valves = site.channels.filter(c => c.kind === "valve").length;
    return { aq: pumps, dq: pumps + valves, di: 5 + (options.pump_feedback ? pumps : 0) + (options.pump_fault ? pumps : 0) + (options.valve_feedback ? valves : 0) };
  }, [site.channels, options]);
  const update = patch => { setHardware(h => ({ ...h, ...patch })); setPreview(null); };
  const addModule = id => {
    const slot = freeSlot(currentCpu, hardware.modules);
    if (!slot) { setMessage("No free module slot left."); return; }
    update({ modules: [...hardware.modules, { catalog: id, slot }] });
  };
  const run = async save => {
    setBusy(true); setMessage(save ? "Saving the hardware and addresses…" : "Assigning addresses…");
    try {
      const result = await siemensRequest(`/${site.id}/assign-addresses`, "POST", { revision: site.revision, hardware, options, save });
      setPreview(result);
      if (save) { onSaved?.(result.site); setMessage(result.assignment.complete ? "Saved. Every required signal has an address." : "Saved what fits. Add the suggested modules to wire the rest."); }
      else setMessage("");
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  // Adding suggested parts re-runs the preview, so the remaining suggestions (or "Everything fits") show at once.
  const [autoPreview, setAutoPreview] = useState(false);
  const applySuggestions = list => {
    for (const suggestion of list) {
      const item = catalog.find(c => c.id === suggestion.add);
      if (!item) continue;
      if (item.kind === "sb") setHardware(h => ({ ...h, signal_board: item.id }));
      else for (let i = 0; i < (suggestion.count || 1); i++) setHardware(h => {
        const slot = freeSlot(currentCpu, h.modules);
        return slot ? { ...h, modules: [...h.modules, { catalog: item.id, slot }] } : h;
      });
    }
    setPreview(null);
    setAutoPreview(true);
  };
  const applySuggestion = suggestion => applySuggestions([suggestion]);
  useEffect(() => { if (autoPreview) { setAutoPreview(false); run(false); } }, [autoPreview, hardware]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!hardware || !catalog.length) return <div className="s7-msg">{message || "Loading the Siemens hardware catalog…"}</div>;
  const short = capacity && { aq: need.aq - capacity.aq, dq: need.dq - capacity.dq, di: need.di - capacity.di };
  return <div>
    <p>Pick the PLC you plan to buy. AquaFlow knows how many inputs and outputs each part has, assigns every pump, valve and safety signal to a free terminal, and tells you what is missing before you order. Supported: the classic <SiemensTerm k="s71200">S7-1200 G1</SiemensTerm>, <SiemensTerm k="s71500">S7-1500</SiemensTerm> and ET 200SP CPUs.</p>
    {family !== "s7-1200" && <div className="s7-card s7-card--warn"><b>{FAMILY_LABEL[family]}:</b> uses the same AquaFlow PLC program and connection as the S7-1200 (PUT/GET, non-optimized DB100, rack 0 / slot 1). It is not yet proven on PLCSIM Advanced or a real CPU — run the acceptance test on PLCSIM Advanced before relying on it.</div>}
    <div className="s7-card s7-card--warn"><b>Before you order:</b> write the full order number (e.g. 6ES7 215-1AG40-0XB0) and “no substitution with G2 (-x50) parts” on the purchase order. Suppliers now ship the S7-1200 G2 by default, and AquaFlow does not support G2 yet. Siemens discontinues G1: announced for 1 Nov 2026, new units orderable until 1 Oct 2027.</div>
    <div className="s7-card">
      <div className="s7-row">
        <label>CPU <select value={hardware.cpu} onChange={e => {
          const next = cpus.find(c => c.id === e.target.value);
          const sameFamily = (next?.family || "s7-1200") === family;
          update(sameFamily ? { cpu: e.target.value, modules: hardware.modules.slice(0, next?.max_modules ?? 8) }
            : { cpu: e.target.value, modules: [], signal_board: "", firmware: firmwareFor(next?.family).at(-1) });
        }}>
          {Object.entries(FAMILY_LABEL).map(([id, label]) => <optgroup key={id} label={label}>
            {cpus.filter(c => (c.family || "s7-1200") === id).map(c => <option key={c.id} value={c.id}>{c.label} · {c.order_number}</option>)}
          </optgroup>)}
        </select></label>
        <label>Firmware <select value={hardware.firmware} onChange={e => update({ firmware: e.target.value })}>{firmwareFor(family).map(f => <option key={f}>{f}</option>)}</select></label>
        {family === "s7-1200" && <label><SiemensTerm k="sb">Signal board</SiemensTerm> <select value={hardware.signal_board} onChange={e => update({ signal_board: e.target.value })}>
          <option value="">None</option>{boards.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select></label>}
      </div>
      {cpu && <p style={{ marginTop: 8 }}>{cpu.di} digital inputs · {cpu.dq} digital outputs ({cpu.outputs}) · {cpu.aq} analog outputs · room for {cpu.max_modules} <SiemensTerm k="sm">signal module(s)</SiemensTerm>. {cpu.note}</p>}
      <h4><SiemensTerm k="sm">Signal modules</SiemensTerm></h4>
      {hardware.modules.length === 0 && <p>No modules yet.</p>}
      {hardware.modules.map((module, index) => <div key={`${module.slot}-${index}`} className="s7-row" style={{ marginBottom: 5 }}>
        <span className="s7-badge s7-badge--muted">slot {module.slot}</span>
        <select value={module.catalog} onChange={e => update({ modules: hardware.modules.map((m, i) => i === index ? { ...m, catalog: e.target.value } : m) })}>
          {modules.map(m => <option key={m.id} value={m.id}>{m.label} · {m.order_number}</option>)}
        </select>
        <button className="btn" onClick={() => update({ modules: hardware.modules.filter((_, i) => i !== index) })}>Remove</button>
      </div>)}
      <div className="s7-row">
        <select aria-label="Add a signal module" value="" disabled={hardware.modules.length >= (cpu?.max_modules ?? 0)} onChange={e => e.target.value && addModule(e.target.value)}>
          <option value="">{hardware.modules.length >= (cpu?.max_modules ?? 0) ? "This CPU has no free module slot" : "+ Add a signal module…"}</option>
          {modules.map(m => <option key={m.id} value={m.id}>{m.label} · {m.order_number}</option>)}
        </select>
      </div>
      {capacity && <table className="s7-table" style={{ marginTop: 10, maxWidth: 520 }}>
        <thead><tr><th>Signal</th><th>Needed</th><th>Available</th><th></th></tr></thead>
        <tbody>{[["Analog outputs (pump speed)", "aq"], ["Digital outputs (valves, pump run)", "dq"], ["Digital inputs (safety + feedback)", "di"]].map(([label, key]) =>
          <tr key={key}><td>{label}</td><td>{need[key]}</td><td>{capacity[key]}</td><td>{short[key] > 0 ? <span className="s7-badge s7-badge--bad">{short[key]} short</span> : <span className="s7-badge s7-badge--ok">OK</span>}</td></tr>)}</tbody>
      </table>}
    </div>
    <div className="s7-card">
      <b>What to wire</b>
      <div className="s7-row" style={{ marginTop: 6 }}>
        <label><input type="checkbox" checked={options.pump_feedback} onChange={e => setOptions(o => ({ ...o, pump_feedback: e.target.checked }))} /> Pump "running" feedback from each VFD</label>
        <label><input type="checkbox" checked={options.pump_fault} onChange={e => setOptions(o => ({ ...o, pump_fault: e.target.checked }))} /> Pump fault input from each VFD</label>
        <label><input type="checkbox" checked={options.valve_feedback} onChange={e => setOptions(o => ({ ...o, valve_feedback: e.target.checked }))} /> Valve limit-switch feedback</label>
        <label title="Off: addresses you already set by hand are kept"><input type="checkbox" checked={options.reassign_all} onChange={e => setOptions(o => ({ ...o, reassign_all: e.target.checked }))} /> Re-assign every address from scratch</label>
      </div>
      <p>The five <SiemensTerm k="safety">safety inputs</SiemensTerm> are always wired first. {note}</p>
      <div className="s7-row">
        <button className="btn" disabled={busy} onClick={() => run(false)}>Preview addresses</button>
        <button className="btn primary" disabled={busy} onClick={() => run(true)}>Use this hardware and save</button>
      </div>
    </div>
    {preview && <div className={`s7-card ${preview.assignment.complete ? "s7-card--ok" : "s7-card--warn"}`}>
      <b>{preview.assignment.complete ? "Everything fits." : "Not everything fits on this hardware."}</b>
      {preview.assignment.program_changed && <p style={{ color: "#f6d795" }}>{preview.site?.revision === site.revision && !message.startsWith("Saved") ? "If you save this, the PLC program changes: export the TIA package again and download it to the PLC." : "The PLC program changed: export the TIA package again and download it to the PLC."}</p>}
      {Object.entries(preview.assignment.missing || {}).map(([kind, count]) => <div key={kind}>Missing {count} {kind === "AQ" ? "analog output(s)" : kind === "DQ" ? "digital output(s)" : "digital input(s)"}.</div>)}
      {preview.assignment.skipped_optional?.length > 0 && <div>Optional, not wired (no free input): {preview.assignment.skipped_optional.join(", ")}.</div>}
      {preview.assignment.suggestions?.filter(s => s.add).length > 1 && <div className="s7-row" style={{ marginTop: 6 }}><button className="btn primary" disabled={busy} onClick={() => applySuggestions(preview.assignment.suggestions.filter(s => s.add))}>Add all suggested parts</button></div>}
      {preview.assignment.suggestions?.map((s, i) => <div key={i} className="s7-row" style={{ marginTop: 6 }}>
        <span>➜ {s.add ? `Add ${s.count > 1 ? `${s.count} × ` : ""}${s.label} (${s.order_number})` : s.label}: {s.why}</span>
        {s.add && <button className="btn" onClick={() => applySuggestion(s)}>Add it</button>}
      </div>)}
      {preview.assignment.notes?.slice(1).map(n => <p key={n}>{n}</p>)}
      <h4>Parts list</h4>
      <table className="s7-table"><thead><tr><th>Position</th><th>Item</th><th>Order number</th></tr></thead>
        <tbody>{preview.bom.map(b => <tr key={b.position}><td>{b.position}</td><td>{b.item}{b.firmware ? ` · ${b.firmware}` : ""}</td><td className="s7-mono">{b.order_number}</td></tr>)}</tbody></table>
    </div>}
    {message && <div className="s7-msg">{message}</div>}
  </div>;
}
