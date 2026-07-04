// EnvironmentMaterialPanel.jsx — AquaFlow Environment & Material Library (AQ-S3-008)
//
// Browse the 20 built-in environments and 20 PBR materials, edit their parameters,
// and save custom presets (up to 50 environments / 100 materials). Material rows show
// a live PBR swatch driven by roughness/metalness/reflectivity.
import { useMemo, useState } from "react";
import {
  getAllEnvironments, getAllMaterials, ENV_PARAM_RANGES, MATERIAL_PARAM_RANGES,
  ENV_EDITABLE_FIELDS, MATERIAL_EDITABLE_FIELDS,
  saveCustomEnvironment, saveCustomMaterial, deleteCustomEnvironment, deleteCustomMaterial,
  MAX_CUSTOM_ENVIRONMENTS, MAX_CUSTOM_MATERIALS,
} from "../../environment";

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };

function swatch(m) {
  // crude PBR-ish preview: metals reflect their colour, dielectrics are matte.
  const gloss = 1 - (m.roughness ?? 0.5);
  const hi = Math.round(40 + gloss * 60 + (m.reflectivity ?? 0.5) * 40);
  return {
    background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,${0.15 + gloss * 0.5}), ${m.color} 55%)`,
    boxShadow: `inset 0 0 ${Math.round(hi / 6)}px rgba(255,255,255,${0.1 + gloss * 0.3})`,
  };
}

export default function EnvironmentMaterialPanel() {
  const [tab, setTab] = useState("environments");
  const [rev, setRev] = useState(0);          // bump to refresh custom lists
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState("");

  const environments = useMemo(() => getAllEnvironments(), [rev]);
  const materials = useMemo(() => getAllMaterials(), [rev]);
  const isEnv = tab === "environments";
  const list = isEnv ? environments : materials;
  const ranges = isEnv ? ENV_PARAM_RANGES : MATERIAL_PARAM_RANGES;
  const fields = isEnv ? ENV_EDITABLE_FIELDS : MATERIAL_EDITABLE_FIELDS;
  const customCount = list.filter((x) => !x.builtin).length;
  const limit = isEnv ? MAX_CUSTOM_ENVIRONMENTS : MAX_CUSTOM_MATERIALS;

  const pick = (item) => {
    setSel(item);
    setDraft(isEnv ? { ...item, params: { ...item.params } } : { ...item });
    setMsg("");
  };

  const setField = (k, v) => {
    if (isEnv && k in ENV_PARAM_RANGES) setDraft({ ...draft, params: { ...draft.params, [k]: v } });
    else setDraft({ ...draft, [k]: v });
  };
  const getField = (k) => (isEnv && k in ENV_PARAM_RANGES ? draft.params[k] : draft[k]);

  const save = () => {
    try {
      const asCustom = { ...draft, builtin: false, id: draft.builtin ? undefined : draft.id };
      if (isEnv) saveCustomEnvironment(asCustom); else saveCustomMaterial(asCustom);
      setRev(rev + 1); setMsg("Saved as custom preset ✓");
    } catch (e) { setMsg(String(e.message || e)); }
  };
  const remove = (item) => {
    if (isEnv) deleteCustomEnvironment(item.id); else deleteCustomMaterial(item.id);
    setRev(rev + 1); if (sel?.id === item.id) { setSel(null); setDraft(null); }
  };

  const numField = (k) => {
    const r = ranges[k];
    return (
      <label key={k} style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 2 }}>
        {k.replace(/_/g, " ")} <span style={{ color: "var(--accent)" }}>{Number(getField(k)).toFixed(r.max <= 1 ? 3 : 1)}</span>
        <input type="range" min={r.min} max={r.max} step={(r.max - r.min) / 200}
          value={getField(k)} onChange={(e) => setField(k, Number(e.target.value))} />
      </label>
    );
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>🎨</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Environment & Material Library
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)" }}>
          {customCount}/{limit} custom
        </span>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        {[["environments", `Environments (${environments.length})`], ["materials", `Materials (${materials.length})`]].map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setSel(null); setDraft(null); }}
            style={{ padding: "7px 14px", background: "transparent", border: "none",
              borderBottom: tab === k ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab === k ? "var(--text-accent)" : "var(--text-muted)", fontSize: 10,
              fontWeight: tab === k ? 600 : 400, cursor: "pointer" }}>{label}</button>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* list */}
        <div style={{ width: 200, borderRight: "1px solid var(--border)", overflow: "auto", flexShrink: 0 }}>
          {list.map((item) => (
            <div key={item.id} onClick={() => pick(item)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", cursor: "pointer",
                fontSize: 10.5, borderBottom: "1px solid var(--border)",
                background: sel?.id === item.id ? "var(--bg-surface)" : "transparent",
                color: sel?.id === item.id ? "var(--text-accent)" : "var(--text-primary)" }}>
              {!isEnv && <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, ...swatch(item) }} />}
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
              {!item.builtin && <span onClick={(e) => { e.stopPropagation(); remove(item); }}
                style={{ color: "#ef4444", cursor: "pointer" }}>✕</span>}
            </div>
          ))}
        </div>

        {/* editor */}
        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          {!draft ? (
            <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Select a preset to view and customise it.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!isEnv && <span style={{ width: 40, height: 40, borderRadius: 8, ...swatch(draft) }} />}
                <input value={draft.name} onChange={(e) => setField("name", e.target.value)}
                  style={{ ...box, flex: 1, padding: 6, fontSize: 12, color: "var(--text-primary)" }} />
              </div>
              {!isEnv && (
                <label style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                  Base colour
                  <input type="color" value={draft.color} onChange={(e) => setField("color", e.target.value)} />
                </label>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {fields.filter((k) => k in ranges).map((k) => numField(k))}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={save} style={{ background: "var(--accent)", color: "#04140a", border: "none",
                  borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  {draft.builtin ? "Save as custom" : "Update preset"}
                </button>
                {msg && <span style={{ fontSize: 10, color: msg.includes("✓") ? "#22c55e" : "#ef4444" }}>{msg}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
