// GenerativeDesignerPanel.jsx — AquaFlow Generative Fountain Designer (AQ-S5-006)
//
// Enter a design brief → generate fountain concepts → download the engineering or
// construction package for the chosen concept. Consumes /api/generative.
import { useState } from "react";
import { apiPost, apiUrl } from "../../utils/apiClient";

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };
const field = { background: "var(--bg-panel)", color: "var(--text-primary)",
  border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, padding: "4px 7px", width: "100%" };
const STYLES = ["grand", "romantic", "modern", "playful", "dramatic"];

export default function GenerativeDesignerPanel() {
  const [brief, setBrief] = useState({ venue: "Grand Plaza", area_m2: 300, budget_usd: 400000,
    style: "grand", theme: "Desert Dawn", depth_m: 1.4 });
  const [concepts, setConcepts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setBrief((b) => ({ ...b, [k]: v }));

  const generate = async () => {
    setBusy(true); setError("");
    try {
      const r = await apiPost("/generative/concepts", { brief, count: 3 });
      setConcepts(r.concepts || []);
      setSelected(r.concepts?.[0] || null);
    } catch (e) { setError(String(e.message || e)); }
    setBusy(false);
  };

  const download = async (kind) => {
    if (!selected) return;
    setError("");
    try {
      const res = await fetch(apiUrl(`/generative/${kind}-package`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concept: selected }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selected.name.replace(/[^a-z0-9]+/gi, "_")}_${kind}_package.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(String(e.message || e)); }
  };

  const money = (n) => "$" + Number(n || 0).toLocaleString();

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>✨</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Generative Fountain Designer
        </span>
      </div>

      {error && <div style={{ ...box, margin: 8, padding: 8, color: "#ef4444", fontSize: 10 }}>⛔ {error}</div>}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* brief */}
        <div style={{ width: 210, flexShrink: 0, overflow: "auto", padding: 10, borderRight: "1px solid var(--border)" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 6 }}>DESIGN BRIEF</div>
          {[["Venue", "venue", "text"], ["Theme", "theme", "text"],
            ["Area (m²)", "area_m2", "number"], ["Depth (m)", "depth_m", "number"],
            ["Budget (USD)", "budget_usd", "number"]].map(([label, key, type]) => (
            <label key={key} style={{ display: "block", marginBottom: 6 }}>
              <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{label}</span>
              <input type={type} value={brief[key]} style={field}
                onChange={(e) => set(key, type === "number" ? Number(e.target.value) : e.target.value)} />
            </label>
          ))}
          <label style={{ display: "block", marginBottom: 8 }}>
            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>Style</span>
            <select value={brief.style} style={field} onChange={(e) => set("style", e.target.value)}>
              {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <button onClick={generate} disabled={busy} style={{ width: "100%", background: "var(--accent)",
            border: "none", borderRadius: 6, color: "#fff", fontSize: 11, fontWeight: 600,
            padding: "7px 0", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Generating…" : "✨ Generate Concepts"}
          </button>
        </div>

        {/* concepts */}
        <div style={{ flex: 1, overflow: "auto", padding: 10, borderRight: "1px solid var(--border)" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 4 }}>
            CONCEPTS ({concepts.length})
          </div>
          {concepts.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Enter a brief and generate concepts.</div>
          ) : concepts.map((c) => (
            <div key={c.id} onClick={() => setSelected(c)} style={{ ...box, padding: "8px 10px", marginBottom: 6,
              cursor: "pointer", borderLeft: `3px solid ${selected?.id === c.id ? "var(--accent)" : "transparent"}`,
              outline: selected?.id === c.id ? "1px solid var(--accent)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)", flex: 1 }}>{c.name}</span>
                <span style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase" }}>{c.archetype}</span>
              </div>
              <div style={{ display: "flex", gap: 3, margin: "4px 0" }}>
                {(c.palette || []).map((p, i) => (
                  <span key={i} style={{ width: 16, height: 8, borderRadius: 2, background: p }} />
                ))}
              </div>
              <div style={{ fontSize: 9.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>{c.narrative}</div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4 }}>
                {c.estimate.fixture_count} fixtures · {money(c.estimate.total_cost_usd)} ·
                {" "}{c.within_budget ? "✓ within budget" : "⚠ over budget"}
              </div>
            </div>
          ))}
        </div>

        {/* selected concept + packages */}
        <div style={{ width: 260, flexShrink: 0, overflow: "auto", padding: 10 }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 4 }}>SELECTED CONCEPT</div>
          {!selected ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No concept selected.</div>
          ) : (
            <>
              <div style={{ ...box, padding: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{selected.name}</div>
                <div style={{ fontSize: 9.5, color: "var(--text-muted)", margin: "3px 0 6px" }}>
                  {selected.pool.length_m}×{selected.pool.width_m}×{selected.pool.depth_m} m · {selected.pool.area_m2} m²
                </div>
                <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 2 }}>SIGNATURE ELEMENTS</div>
                {selected.signature_elements.map((s, i) => (
                  <div key={i} style={{ fontSize: 9.5, color: "var(--text-secondary)", marginBottom: 2 }}>• {s}</div>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 9.5, color: "var(--text-secondary)" }}>
                  <span>Equip {money(selected.estimate.equipment_cost_usd)}</span>
                  <span>Civil {money(selected.estimate.civil_cost_usd)}</span>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginTop: 3 }}>
                  Total {money(selected.estimate.total_cost_usd)}
                </div>
              </div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 4 }}>DELIVERABLE PACKAGES</div>
              <button onClick={() => download("engineering")} style={{ width: "100%", marginBottom: 6,
                background: "transparent", border: "1px solid var(--border)", borderRadius: 6,
                color: "var(--text-primary)", fontSize: 11, padding: "8px 0", cursor: "pointer" }}>
                ⬇ Engineering Package (.zip)
              </button>
              <button onClick={() => download("construction")} style={{ width: "100%",
                background: "transparent", border: "1px solid var(--border)", borderRadius: 6,
                color: "var(--text-primary)", fontSize: 11, padding: "8px 0", cursor: "pointer" }}>
                ⬇ Construction Package (.zip)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
