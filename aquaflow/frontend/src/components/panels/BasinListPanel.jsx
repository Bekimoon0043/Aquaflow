/**
 * BasinListPanel.jsx — AF-NEXT-010: list the design's basins, add one, choose which basin
 * the designer edits (outline, pool type, depth zones), rename or remove extra basins.
 * State lives in engineering/useDesignerBasins.js.
 */
import React from "react";
import { basinArea } from "../../engineering/basins";

const btn = { background: "#0b2236", color: "#cfe8f7", border: "1px solid #1d4664", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 };

export default function BasinListPanel({ basins = [], activeIndex = 0, onSelect, onAdd, onRemove, onRename, disabled = false }) {
  return (
    <div aria-label="Basins" style={{ margin: "8px 0", padding: 8, background: "#06131f", border: "1px solid #12324a", borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <strong style={{ fontSize: 12, color: "#9fd3f0" }}>Basins ({basins.length})</strong>
        <button type="button" style={btn} disabled={disabled} onClick={onAdd} title="Add a rectangular basin beside the design">+ Add basin</button>
      </div>
      {basins.map((b, i) => (
        <div key={b.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 6, alignItems: "center", padding: "2px 0" }}>
          <input type="radio" name="active-basin" aria-label={`Edit ${b.name || b.id}`} checked={i === activeIndex} onChange={() => onSelect?.(i)} />
          <input aria-label={`Basin ${i + 1} name`} value={b.name || ""} onChange={(e) => onRename?.(i, e.target.value)}
            style={{ background: "#0a1b2a", color: "#d9edf7", border: "1px solid #18344a", borderRadius: 3, fontSize: 11, padding: "2px 4px", minWidth: 0 }} />
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#7fa3b8" }}>{basinArea(b).toFixed(1)} m²{b.holes?.length ? ` · ${b.holes.length} island${b.holes.length > 1 ? "s" : ""}` : ""}</span>
            {basins.length > 1 && <button type="button" style={btn} aria-label={`Remove ${b.name || b.id}`} onClick={() => onRemove?.(i)}>×</button>}
          </span>
        </div>
      ))}
      {basins.length > 1 && <p style={{ margin: "6px 0 0", fontSize: 10, color: "#7fa3b8" }}>The selected basin is edited on the canvas; depth zones are drawn inside it. Basin 1 sets the 3D origin.</p>}
    </div>
  );
}
