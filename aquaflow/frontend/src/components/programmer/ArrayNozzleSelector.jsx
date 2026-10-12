import { useState } from "react";

const button = { background: "#0b2434", color: "#b9e8ff", border: "1px solid #28546a", borderRadius: 4, padding: "5px 7px", cursor: "pointer", fontSize: 10 };

/** Engineering positions and fixture IDs only. Never generates device addresses. */
export default function ArrayNozzleSelector({ fixtures, selectedIds, onChange, zones, onSaveZone, onDeleteZone, onLoadZone, activeIds = [] }) {
  const [zoneName, setZoneName] = useState("");
  const selected = new Set(selectedIds ?? fixtures.map(f => f.id));
  const active = new Set(activeIds);
  const xs = fixtures.map(f => Number(f.x) || 0), ys = fixtures.map(f => Number(f.y) || 0);
  const minX = Math.min(0, ...xs), maxX = Math.max(1, ...xs);
  const minY = Math.min(0, ...ys), maxY = Math.max(1, ...ys);
  const toggle = id => { const next = new Set(selected); next.has(id) ? next.delete(id) : next.add(id); onChange([...next]); };
  const subset = predicate => onChange(fixtures.filter(predicate).map(f => f.id));
  return <div style={{ margin: "10px 0", color: "#9fb5cd", fontSize: 10 }}>
    <div style={{ fontWeight: 800, marginBottom: 5 }}>Select outlets on the engineering plan</div>
    <svg aria-label="Array outlet selection" viewBox="0 0 340 150" style={{ width: "100%", background: "#041421", border: "1px solid #234153", borderRadius: 5 }}>
      {fixtures.map((f, index) => <g key={f.id} role="button" tabIndex={0}
        aria-label={`${f.label || f.id}, outlet ${index + 1}`} aria-pressed={selected.has(f.id)}
        onClick={() => toggle(f.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(f.id); } }} style={{ cursor: "pointer" }}>
        <title>{index + 1}: {f.label || f.id} · {f.engineering?.mappingStatus || "Design only"}</title>
        <circle cx={12 + ((Number(f.x) || 0) - minX) / (maxX - minX) * 316}
          cy={12 + ((Number(f.y) || 0) - minY) / (maxY - minY) * 125} r={4}
          fill={active.has(f.id) ? "#facc15" : selected.has(f.id) ? "#22d3ee" : "#203a50"}
          stroke={selected.has(f.id) ? "#baf4ff" : "#527188"} strokeWidth={0.7} />
      </g>)}
    </svg>
    <div style={{ margin: "5px 0" }}>Cyan: selected · Yellow: preview stage · {selected.size}/{fixtures.length} selected</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      <button style={button} onClick={() => onChange(null)}>All</button>
      <button style={button} onClick={() => onChange([])}>None</button>
      <button style={button} onClick={() => subset((_, i) => i % 2 === 0)}>Odd</button>
      <button style={button} onClick={() => subset((_, i) => i % 2 === 1)}>Even</button>
      <button style={button} onClick={() => subset(f => (Number(f.x) || 0) <= (minX + maxX) / 2)}>Left half</button>
      <button style={button} onClick={() => subset(f => (Number(f.x) || 0) > (minX + maxX) / 2)}>Right half</button>
      <button style={button} onClick={() => subset(f => !selected.has(f.id))}>Invert</button>
    </div>
    <div style={{ display: "flex", gap: 4, marginTop: 7 }}>
      <input aria-label="Zone name" value={zoneName} onChange={e => setZoneName(e.target.value)} placeholder="Name this zone" style={{ minWidth: 0, flex: 1, background: "#08111f", color: "#dcefff", border: "1px solid #26384d", padding: 5 }} />
      <button style={button} disabled={!zoneName.trim() || !selected.size} onClick={() => { onSaveZone(zoneName.trim(), [...selected]); setZoneName(""); }}>Save zone</button>
    </div>
    {zones.map(zone => <div key={zone.id} style={{ display: "flex", gap: 4, marginTop: 4 }}>
      <button style={{ ...button, flex: 1, textAlign: "left" }} onClick={() => onLoadZone(zone)}>{zone.name} ({zone.fixtureIds.length})</button>
      <button style={button} aria-label={`Delete zone ${zone.name}`} onClick={() => onDeleteZone(zone.id)}>×</button>
    </div>)}
  </div>;
}
