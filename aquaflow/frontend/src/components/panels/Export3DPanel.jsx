// Export3DPanel.jsx — AquaFlow 3D Export Bridge (AQ-X-016)
//
// Exports the live engineering design (pool geometry + fixtures) — the same
// scene the 3D preview renders — to binary FBX, glTF/GLB, OBJ+MTL, COLLADA, 3D DXF,
// STL, PLY, USD, the LUXEXCHANGE envelope, or all of them in one zip. Pure client-side
// (no backend); every format is checked by importing it into Blender (see export3d tests).
import { useMemo, useState } from "react";
import useEngineeringStore from "../../store/engineeringStore";
import { useShowStore } from "../../store/showStore";
import { buildSceneGraph, sceneTriangleCount, exportScene, EXPORT_FORMATS } from "../../export3d";

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };

function download(filename, data, mimeType) {
  const blob = new Blob([data], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Export3DPanel() {
  const [format, setFormat] = useState("fbx");
  const [includeSite, setIncludeSite] = useState(true);
  const [includeWater, setIncludeWater] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  // Live design — engineering store is the source of truth for the 3D scene;
  // fall back to the show store's mirrored copy if the designer hasn't loaded.
  const geometry = useEngineeringStore((s) => s.geometry);
  const params = useEngineeringStore((s) => s.params);
  const poolType = useEngineeringStore((s) => s.poolType);
  // AF-HUB-004 — fixtures come only from the single master (engineeringStore.fixtures);
  // the old showStore.engineeringFixtures fallback was a dead mirror (never written).
  const engFixtures = useEngineeringStore((s) => s.fixtures);
  const siteSurfaces = useEngineeringStore((s) => s.siteSurfaces);
  const showPool = useShowStore((s) => s.poolGeometry);
  const showName = useShowStore((s) => s.currentShow?.name);

  const design = useMemo(() => {
    const fixtures = engFixtures || [];
    const poolGeometry = (geometry || params)
      ? { poolType, params, geometry }
      : (showPool || null);
    return { name: showName || "AquaFlow Scene", fixtures, poolGeometry, siteSurfaces: siteSurfaces || [] };
  }, [engFixtures, geometry, params, poolType, showPool, showName, siteSurfaces]);

  const buildOptions = useMemo(() => ({ includeSite, includeWater }), [includeSite, includeWater]);
  const graph = useMemo(() => buildSceneGraph(design, buildOptions), [design, buildOptions]);
  const stats = useMemo(() => ({
    nodes: graph.nodes.length,
    fixtures: graph.meta.fixtureCount,
    lights: graph.meta.lightCount,
    triangles: sceneTriangleCount(graph),
  }), [graph]);

  const activeFmt = EXPORT_FORMATS.find((f) => f.id === format);
  const hasContent = stats.fixtures > 0 || stats.nodes > 0;

  const doExport = () => {
    setError(""); setStatus("");
    try {
      const out = exportScene(design, format, { ...buildOptions, graph });
      download(out.filename, out.data, out.mimeType);
      out.companions.forEach((c) => download(c.filename, c.data, c.mimeType));
      const extra = out.companions.length ? ` (+${out.companions.length} companion)` : "";
      setStatus(`Exported ${out.filename}${extra}`);
      setTimeout(() => setStatus(""), 3500);
    } catch (e) {
      setError(String(e.message || e));
    }
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>⬡</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          3D Export Bridge
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)" }}>
          {stats.fixtures} fixtures · {stats.triangles.toLocaleString()} tris
        </span>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Scene summary */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[["Nodes", stats.nodes], ["Fixtures", stats.fixtures], ["Lights", stats.lights], ["Triangles", stats.triangles.toLocaleString()]]
            .map(([label, val]) => (
            <div key={label} style={{ ...box, padding: "8px 12px", flex: 1, minWidth: 90 }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)" }}>{val}</div>
            </div>
          ))}
        </div>

        {!hasContent && (
          <div style={{ ...box, padding: 12, fontSize: 11, color: "var(--text-muted)", borderLeft: "3px solid #f59e0b" }}>
            No fixtures found. Add fixtures in the Engineering Designer, then export. A pool-only
            scene will still export if geometry is defined.
          </div>
        )}

        {/* Format picker */}
        <div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Format
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {EXPORT_FORMATS.map((f) => (
              <button key={f.id} onClick={() => setFormat(f.id)} style={{
                ...box, padding: 10, textAlign: "left", cursor: "pointer",
                borderColor: format === f.id ? "var(--accent)" : "var(--border)",
                background: format === f.id ? "var(--bg-hover, var(--bg-surface))" : "var(--bg-surface)",
                outline: format === f.id ? "1px solid var(--accent)" : "none" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{f.label}</div>
                <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.35 }}>{f.blurb}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Options */}
        <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--text-secondary)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={includeSite} onChange={(e) => setIncludeSite(e.target.checked)} />
            Site surfaces (lawn, paving, islands)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={includeWater} onChange={(e) => setIncludeWater(e.target.checked)} />
            Water jets at design height
          </label>
        </div>

        {/* Action */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={doExport} disabled={!hasContent} style={{
            padding: "9px 18px", borderRadius: 6, border: "none", cursor: hasContent ? "pointer" : "not-allowed",
            background: hasContent ? "var(--accent)" : "var(--bg-surface)",
            color: hasContent ? "#04121a" : "var(--text-muted)", fontWeight: 700, fontSize: 12 }}>
            ⬇ Export {activeFmt?.label.split(" (")[0]}
          </button>
          {status && <span style={{ fontSize: 11, color: "#22c55e" }}>{status}</span>}
          {error && <span style={{ fontSize: 11, color: "#ef4444" }}>{error}</span>}
        </div>

        <div style={{ ...box, padding: 12, fontSize: 10.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          <strong style={{ color: "var(--text-secondary)" }}>About</strong> — AquaFlow stays control
          software; this exports a presentation copy of the 3D scene (pool basin, water surface, site,
          fixtures, water jets, lights) in real metres. FBX, glTF, OBJ, COLLADA and USD are Y-up;
          DXF, STL and PLY are Z-up and line up with the 2D CAD export. Lights travel in glTF/GLB.
          Use <strong>LUXEXCHANGE</strong> to import the layout into LuxuryForm / LuxuryScape.
        </div>
      </div>
    </div>
  );
}
