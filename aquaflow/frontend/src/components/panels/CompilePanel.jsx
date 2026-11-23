import { useState, useEffect } from "react";
import { API_BASE_URL } from "../../config";
import { useShowStore } from "../../store/showStore";
import PreflightPanel from "./PreflightPanel";

const API = API_BASE_URL;

export default function CompilePanel() {
  const [bundles,  setBundles]  = useState([]);
  const [compiling, setCompiling] = useState(false);
  const [result,   setResult]   = useState(null);
  const [notes,    setNotes]    = useState("");
  const [target,   setTarget]   = useState("development");
  const [dryRun,   setDryRun]   = useState(false);
  const [loading,  setLoading]  = useState(false);

  const currentShow = useShowStore(s => s.currentShow);
  const tracks      = useShowStore(s => s.timelineTracks);

  useEffect(() => { loadBundles(); }, []);

  const loadBundles = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/compiler/bundles`);
      if (res.ok) { const d = await res.json(); setBundles(d.bundles || []); }
    } catch {}
    setLoading(false);
  };

  const compile = async () => {
    setCompiling(true); setResult(null);
    try {
      const show_payload = {
        ...(currentShow || {}),
        tracks: tracks || [],
      };
      const res = await fetch(`${API}/compiler/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          show_payload,
          operator_notes: notes,
          target_hardware: target,
          dry_run: dryRun,
        }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) loadBundles();
    } catch(e) {
      setResult({ success:false, errors:[{ message:e.message }] });
    }
    setCompiling(false);
  };

  const loadBundle = async (bundleId) => {
    try {
      const res = await fetch(`${API}/compiler/load/${bundleId}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:"{}" });
      const data = await res.json();
      if (data.ok) setResult({ success:true, message:`Bundle ${bundleId} loaded into runtime transport` });
    } catch(e) {
      setResult({ success:false, errors:[{ message:e.message }] });
    }
  };

  const deleteBundle = async (bundleId) => {
    await fetch(`${API}/compiler/bundles/${bundleId}`, { method:"DELETE" });
    loadBundles();
  };

  const trackCount = (tracks||[]).length;
  const clipCount  = (tracks||[]).reduce((sum,t) => sum+(t.clips||[]).length, 0);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"var(--bg-void)", color:"var(--text-primary)", fontFamily:"monospace", fontSize:"11px", overflow:"auto" }}>

      {/* Header */}
      <div style={{ padding:"8px 12px", borderBottom:"1px solid var(--border)", background:"var(--bg-void)", flexShrink:0 }}>
        <span style={{ color:"var(--accent)", fontSize:13, fontWeight:"bold" }}>◈ SHOW COMPILER</span>
        <div style={{ fontSize:11, color:"var(--info)", marginTop:2 }}>Compile editor show into a validated .luxshow deployment bundle</div>
      </div>

      <div style={{ padding:12, flex:1, overflow:"auto" }}>

        {/* AF-NEXT-009 — preflight gate: every issue, grouped by severity, each with a fix location */}
        <PreflightPanel />

        {/* Current show info */}
        <div style={{ background:"var(--bg-void)", border:"1px solid var(--border)", borderRadius:6, padding:10, marginBottom:12 }}>
          <div style={{ color:"var(--text-muted)", fontSize:11, marginBottom:6 }}>CURRENT SHOW</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
            {[
              ["Show name", currentShow?.name || "Untitled Show", "#ffcc00"],
              ["Tracks",    trackCount,   "#00aaff"],
              ["Clips",     clipCount,    "#00ccaa"],
              ["BPM",       currentShow?.bpm || "128", "#aa88ff"],
              ["Duration",  currentShow?.duration_ms ? `${Math.round(currentShow.duration_ms/1000)}s` : "—", "#7ab"],
            ].map(([label,val,color]) => (
              <div key={label} style={{ padding:"5px 7px", background:"var(--bg-base)", borderRadius:3 }}>
                <div style={{ color:"var(--info)", fontSize:11 }}>{label}</div>
                <div style={{ color, fontSize:12, fontWeight:"bold" }}>{val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Compile options */}
        <div style={{ background:"var(--bg-void)", border:"1px solid var(--border)", borderRadius:6, padding:10, marginBottom:12 }}>
          <div style={{ color:"var(--text-muted)", fontSize:11, marginBottom:8 }}>COMPILE OPTIONS</div>

          <div style={{ marginBottom:8 }}>
            <div style={{ color:"var(--info)", fontSize:11, marginBottom:3 }}>Target hardware</div>
            <select value={target} onChange={e => setTarget(e.target.value)}
              style={{ width:"100%", padding:"4px 6px", background:"var(--bg-base)", color:"var(--text-primary)", border:"1px solid var(--border)", borderRadius:3, fontFamily:"monospace", fontSize:11 }}>
              <option value="development">Development (no hardware)</option>
              <option value="field_pc">Field PC</option>
              <option value="industrial_pc">Industrial PC</option>
              <option value="embedded">Embedded controller</option>
            </select>
          </div>

          <div style={{ marginBottom:8 }}>
            <div style={{ color:"var(--info)", fontSize:11, marginBottom:3 }}>Operator notes</div>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Optional — notes about this compile"
              style={{ width:"100%", padding:"4px 6px", background:"var(--bg-base)", color:"var(--text-primary)", border:"1px solid var(--border)", borderRadius:3, fontFamily:"monospace", fontSize:11 }} />
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div onClick={() => setDryRun(!dryRun)} style={{ cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
              <div style={{ width:12, height:12, border:`1px solid ${dryRun?"#00ccaa":"#0a2535"}`, borderRadius:2, background: dryRun?"color-mix(in srgb, var(--info) 13%, transparent)":"transparent", display:"flex", alignItems:"center", justifyContent:"center" }}>
                {dryRun && <span style={{ color:"var(--info)", fontSize:11 }}>✓</span>}
              </div>
              <span style={{ color: dryRun?"var(--info)":"var(--text-muted)", fontSize:11 }}>Dry run (validate only, no output)</span>
            </div>
          </div>
        </div>

        {/* Compile button */}
        <button onClick={compile} disabled={compiling} style={{
          width:"100%", padding:"10px", marginBottom:12,
          background: compiling ? "var(--bg-base)" : "var(--bg-void)",
          color: compiling ? "var(--text-muted)" : "var(--accent)",
          border:`1px solid ${compiling?"#0a2030":"#ffcc0044"}`,
          borderRadius:6, cursor: compiling?"not-allowed":"pointer",
          fontFamily:"monospace", fontSize:12, fontWeight:"bold",
        }}>
          {compiling ? "⟳ COMPILING..." : "◈ COMPILE TO .LUXSHOW"}
        </button>

        {/* Compile result */}
        {result && (
          <div style={{ background: result.success ? "var(--bg-void)" : "var(--bg-base)", border:`1px solid ${result.success?"#00ff8844":"#ff444444"}`, borderRadius:6, padding:10, marginBottom:12 }}>
            {result.success ? (
              <>
                <div style={{ color:"var(--ok)", fontWeight:"bold", marginBottom:6 }}>✓ COMPILE SUCCESS</div>
                <div style={{ color:"var(--info)", fontSize:11, marginBottom:4 }}>Bundle: {result.bundle_id}</div>
                {result.stats && (
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {Object.entries(result.stats).map(([k,v]) => (
                      <span key={k} style={{ fontSize:11, color:"var(--text-muted)" }}>{k.replace(/_/g," ")}: <span style={{ color:"var(--info)" }}>{v}</span></span>
                    ))}
                  </div>
                )}
                {result.message && <div style={{ color:"var(--info)", fontSize:11, marginTop:4 }}>{result.message}</div>}
              </>
            ) : (
              <>
                <div style={{ color:"var(--error)", fontWeight:"bold", marginBottom:6 }}>✗ COMPILE FAILED</div>
                {(result.errors||[]).map((e,i) => (
                  <div key={i} style={{ color:"var(--error)", fontSize:11, padding:"2px 0" }}>• {e.message || e}</div>
                ))}
              </>
            )}
            {(result.warnings||[]).length > 0 && (
              <div style={{ marginTop:6 }}>
                {result.warnings.map((w,i) => (
                  <div key={i} style={{ color:"var(--accent)", fontSize:11, padding:"1px 0" }}>⚠ {w.message || w}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bundle list */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <span style={{ color:"var(--text-muted)", fontSize:11 }}>COMPILED BUNDLES ({bundles.length})</span>
          <button onClick={loadBundles} style={{ background:"none", border:"none", color:"var(--info)", cursor:"pointer", fontSize:11 }}>↺ REFRESH</button>
        </div>
        {bundles.length === 0 ? (
          <div style={{ color:"var(--info)", fontSize:11, textAlign:"center", padding:"16px 0" }}>
            No bundles yet — compile a show to create one
          </div>
        ) : (
          bundles.map((b,i) => (
            <div key={b.bundle_id||i} style={{ background:"var(--bg-void)", border:"1px solid var(--border)", borderRadius:5, padding:"8px 10px", marginBottom:6 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                <span style={{ color:"var(--accent)", fontSize:11, fontWeight:"bold" }}>{b.show_name}</span>
                <span style={{ color:"var(--info)", fontSize:11 }}>{b.size_kb} KB</span>
              </div>
              <div style={{ fontSize:11, color:"var(--text-muted)", marginBottom:6 }}>
                {b.bundle_id} · {b.track_count} tracks · {b.device_count} devices · {new Date((b.compiled_at||0)*1000).toLocaleString()}
              </div>
              <div style={{ display:"flex", gap:5 }}>
                <button onClick={() => loadBundle(b.bundle_id)} style={{ flex:1, padding:"4px 0", background:"var(--bg-panel)", color:"var(--ok)", border:"1px solid color-mix(in srgb, var(--ok) 27%, transparent)", borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:11 }}>
                  ▶ LOAD TO RUNTIME
                </button>
                <button onClick={() => deleteBundle(b.bundle_id)} style={{ padding:"4px 8px", background:"var(--bg-base)", color:"var(--error)", border:"1px solid color-mix(in srgb, var(--error) 13%, transparent)", borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:11 }}>
                  ✕
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
