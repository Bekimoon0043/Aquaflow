// FixtureConnectionsSection.jsx — the Engineering Designer's fixture panel: the selected pump /
// valve / nozzle / light's links as dropdowns (collapsed by default, so dragging stays fast).
// Edits go through the designer's own fixture update (its undo history), via engineering/connections.js.
import { useMemo, useState } from "react";
import { connectToPump, pairLights, readConnections, setNozzleValve, setValveNozzle } from "../../../engineering/connections";
import { partRole } from "../../programmer/studio/fountainDesign";
import { inventory } from "../../programmer/studio/showModel";
import { openWorkspaceTarget } from "../../../workspaces/navigation";

const sel = { flex: 1, padding: 2, background: "#0a1825", color: "#cce8ff", border: "1px solid #0a2535", borderRadius: 3, fontSize: 9, fontFamily: "monospace" };
const name = (f) => String(f?.label || f?.id || "");
const near = (list, from, n = 40) => [...list].sort((a, b) => Math.hypot(a.item.x - from.x, a.item.y - from.y) - Math.hypot(b.item.x - from.x, b.item.y - from.y)).slice(0, n);

export default function FixtureConnectionsSection({ fixture, fixtures, onUpdateFixtures }) {
  const [open, setOpen] = useState(false);
  const role = useMemo(() => (fixture ? partRole(inventory([fixture])[0]) : null), [fixture]);
  const design = useMemo(() => (open && role ? readConnections(fixtures) : null), [open, role, fixtures]);
  if (!role) return null;
  const id = fixture.id;
  const write = (fn, label) => onUpdateFixtures((prev) => fn(prev), label);
  const row = (label, control) => (
    <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 4 }}><span style={{ color: "#7ab", fontSize: 9, width: 42 }}>{label}</span>{control}</div>
  );
  const pumps = design ? [...design.pumps.values()] : [];
  const pumpSelect = (value, onChange) => (
    <select aria-label="Pump" value={value || ""} onChange={(e) => onChange(e.target.value || null)} style={sel}>
      <option value="">— none —</option>
      {pumps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
  let body = null;
  if (design && role === "nozzle" && design.nozzleById.has(id)) {
    const n = design.nozzleById.get(id);
    const valves = near([...design.valves.values()], n.item);
    if (n.valveId && !valves.some((v) => v.id === n.valveId)) valves.unshift(design.valves.get(n.valveId));
    const lights = near(design.lights, n.item, 30);
    const paired = design.lights.filter((l) => (l.item.engineering?.pairedNozzleId || l.item.pairedNozzleId) === id);
    body = <>
      {row("Valve", <select aria-label="Valve" value={n.valveId || ""} onChange={(e) => write((f) => setNozzleValve(f, id, e.target.value || null), "Set valve")} style={sel}>
        <option value="">— none —</option>{valves.map((v) => <option key={v.id} value={v.id}>{name(v.item)}</option>)}</select>)}
      {row("Pump", pumpSelect(n.pumpId, (pid) => write((f) => connectToPump(f, [id], pid), "Set pump")))}
      {row("Light", <select aria-label="Light" value={paired[0]?.id || ""} onChange={(e) => write((f) => (e.target.value ? pairLights(f, [e.target.value], id) : pairLights(f, paired.map((l) => l.id), null)), "Pair light")} style={sel}>
        <option value="">— none —</option>{lights.map((l) => <option key={l.id} value={l.id}>{name(l.item)}</option>)}</select>)}
    </>;
  } else if (design && role === "valve" && design.valves.has(id)) {
    const v = design.valves.get(id);
    const nozzles = near(design.nozzles, v.item);
    for (const nid of v.nozzleIds) if (!nozzles.some((n) => n.id === nid)) nozzles.unshift(design.nozzleById.get(nid));
    const pumpId = v.nozzleIds.map((nid) => design.nozzleById.get(nid).pumpId).find(Boolean) || null;
    body = <>
      {row("Nozzle", <select aria-label="Nozzle" value={v.nozzleIds[0] || ""} onChange={(e) => write((f) => setValveNozzle(f, id, e.target.value || null), "Set nozzle")} style={sel}>
        <option value="">— none —</option>{nozzles.map((n) => <option key={n.id} value={n.id}>{name(n.item)}</option>)}</select>)}
      {row("Pump", pumpSelect(pumpId, (pid) => write((f) => connectToPump(f, [id], pid), "Set pump")))}
    </>;
  } else if (design && role === "light") {
    const l = design.lights.find((x) => x.id === id);
    const explicit = l?.item.engineering?.pairedNozzleId || l?.item.pairedNozzleId;
    body = l ? row("Nozzle", <select aria-label="Nozzle" value={explicit && design.nozzleById.has(explicit) ? explicit : ""} onChange={(e) => write((f) => pairLights(f, [id], e.target.value || null), "Pair light")} style={sel}>
      <option value="">— nearest —</option>{near(design.nozzles, l.item).map((n) => <option key={n.id} value={n.id}>{name(n.item)}</option>)}</select>) : null;
  } else if (design && role === "pump" && design.pumps.has(id)) {
    const p = design.pumps.get(id);
    body = <div style={{ color: "#7ab", fontSize: 9 }}>{p.nozzleIds.length} outlets · {p.valveIds.length} valves — edit them in the Connections editor.</div>;
  }
  return (
    <div data-testid="fixture-connections" style={{ margin: "8px 0", padding: 7, background: "#050d14", border: "1px solid #0a3040", borderRadius: 4 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ background: "none", border: "none", color: "#65d9d0", fontSize: 9, fontWeight: "bold", cursor: "pointer", padding: 0 }}>
        {open ? "▾" : "▸"} 🔗 CONNECTIONS
      </button>
      {open && <div style={{ marginTop: 6 }}>
        {body}
        <button type="button" onClick={() => openWorkspaceTarget({ panel: "engtools", action: "tab", detail: { tab: "connections" } })}
          style={{ width: "100%", padding: 3, background: "#06121c", color: "#7fd8ff", border: "1px solid #16415a", borderRadius: 3, cursor: "pointer", fontSize: 8 }}>
          OPEN CONNECTIONS EDITOR
        </button>
      </div>}
    </div>
  );
}
