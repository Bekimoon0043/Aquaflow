import { useState, useEffect } from "react";
import { API_BASE_URL } from "../../config";
import { useShowStore } from "../../store/showStore";

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
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#040810", color:"#cce8ff", fontFamily:"monospace", fontSize:"11px", overflow:"auto" }}>

      {/* Header */}
      <div style={{ padding:"8px 12px", borderBottom:"1px solid #0a2030", background:"#030608", flexShrink:0 }}>
        <span style={{ color:"#ffcc00", fontSize:13, fontWeight:"bold" }}>◈ SHOW COMPILER</span>
        <div style={{ fontSize:9, color:"#334455", marginTop:2 }}>Compile editor show into a validated .luxshow deployment bundle</div>
      </div>

      <div style={{ padding:12, flex:1, overflow:"auto" }}>

        {/* Current show info */}
        <div style={{ background:"#050d18", border:"1px solid #0a2030", borderRadius:6, padding:10, marginBottom:12 }}>
          <div style={{ color:"#556677", fontSize:9, marginBottom:6 }}>CURRENT SHOW</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
            {[
              ["Show name", currentShow?.name || "Untitled Show", "#ffcc00"],
              ["Tracks",    trackCount,   "#00aaff"],
              ["Clips",     clipCount,    "#00ccaa"],
              ["BPM",       currentShow?.bpm || "128", "#aa88ff"],
              ["Duration",  currentShow?.duration_ms ? `${Math.round(currentShow.duration_ms/1000)}s` : "—", "#7ab"],
            ].map(([label,val,color]) => (
              <div key={label} style={{ padding:"5px 7px", background:"#0a1520", borderRadius:3 }}>
                <div style={{ color:"#334455", fontSize:8 }}>{label}</div>
                <div style={{ color, fontSize:12, fontWeight:"bold" }}>{val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Compile options */}
        <div style={{ background:"#050d18", border:"1px solid #0a2030", borderRadius:6, padding:10, marginBottom:12 }}>
          <div style={{ color:"#556677", fontSize:9, marginBottom:8 }}>COMPILE OPTIONS</div>

          <div style={{ marginBottom:8 }}>
            <div style={{ color:"#7ab", fontSize:9, marginBottom:3 }}>Target hardware</div>
            <select value={target} onChange={e => setTarget(e.target.value)}
              style={{ width:"100%", padding:"4px 6px", background:"#0a1825", color:"#cce8ff", border:"1px solid #0a2535", borderRadius:3, fontFamily:"monospace", fontSize:10 }}>
              <option value="development">Development (no hardware)</option>
              <option value="field_pc">Field PC</option>
              <option value="industrial_pc">Industrial PC</option>
              <option value="embedded">Embedded controller</option>
            </select>
          </div>

          <div style={{ marginBottom:8 }}>
            <div style={{ color:"#7ab", fontSize:9, marginBottom:3 }}>Operator notes</div>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Optional — notes about this compile"
              style={{ width:"100%", padding:"4px 6px", background:"#0a1825", color:"#cce8ff", border:"1px solid #0a2535", borderRadius:3, fontFamily:"monospace", fontSize:10 }} />
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div onClick={() => setDryRun(!dryRun)} style={{ cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
              <div style={{ width:12, height:12, border:`1px solid ${dryRun?"#00ccaa":"#0a2535"}`, borderRadius:2, background: dryRun?"#00ccaa22":"transparent", display:"flex", alignItems:"center", justifyContent:"center" }}>
                {dryRun && <span style={{ color:"#00ccaa", fontSize:8 }}>✓</span>}
              </div>
              <span style={{ color: dryRun?"#00ccaa":"#556677", fontSize:10 }}>Dry run (validate only, no output)</span>
            </div>
          </div>
        </div>

        {/* Compile button */}
        <button onClick={compile} disabled={compiling} style={{
          width:"100%", padding:"10px", marginBottom:12,
          background: compiling ? "#0a1520" : "#1a1000",
          color: compiling ? "#556677" : "#ffcc00",
          border:`1px solid ${compiling?"#0a2030":"#ffcc0044"}`,
          borderRadius:6, cursor: compiling?"not-allowed":"pointer",
          fontFamily:"monospace", fontSize:12, fontWeight:"bold",
        }}>
          {compiling ? "⟳ COMPILING..." : "◈ COMPILE TO .LUXSHOW"}
        </button>

        {/* Compile result */}
        {result && (
          <div style={{ background: result.success ? "#050d18" : "#1a0808", border:`1px solid ${result.success?"#00ff8844":"#ff444444"}`, borderRadius:6, padding:10, marginBottom:12 }}>
            {result.success ? (
              <>
                <div style={{ color:"#00ff88", fontWeight:"bold", marginBottom:6 }}>✓ COMPILE SUCCESS</div>
                <div style={{ color:"#7ab", fontSize:10, marginBottom:4 }}>Bundle: {result.bundle_id}</div>
                {result.stats && (
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {Object.entries(result.stats).map(([k,v]) => (
                      <span key={k} style={{ fontSize:9, color:"#556677" }}>{k.replace(/_/g," ")}: <span style={{ color:"#7ab" }}>{v}</span></span>
                    ))}
                  </div>
                )}
                {result.message && <div style={{ color:"#7ab", fontSize:10, marginTop:4 }}>{result.message}</div>}
              </>
            ) : (
              <>
                <div style={{ color:"#ff4444", fontWeight:"bold", marginBottom:6 }}>✗ COMPILE FAILED</div>
                {(result.errors||[]).map((e,i) => (
                  <div key={i} style={{ color:"#ff8866", fontSize:10, padding:"2px 0" }}>• {e.message || e}</div>
                ))}
              </>
            )}
            {(result.warnings||[]).length > 0 && (
              <div style={{ marginTop:6 }}>
                {result.warnings.map((w,i) => (
                  <div key={i} style={{ color:"#ffcc00", fontSize:9, padding:"1px 0" }}>⚠ {w.message || w}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bundle list */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <span style={{ color:"#556677", fontSize:9 }}>COMPILED BUNDLES ({bundles.length})</span>
          <button onClick={loadBundles} style={{ background:"none", border:"none", color:"#334455", cursor:"pointer", fontSize:9 }}>↺ REFRESH</button>
        </div>
        {bundles.length === 0 ? (
          <div style={{ color:"#223344", fontSize:10, textAlign:"center", padding:"16px 0" }}>
            No bundles yet — compile a show to create one
          </div>
        ) : (
          bundles.map((b,i) => (
            <div key={b.bundle_id||i} style={{ background:"#050d18", border:"1px solid #0a2030", borderRadius:5, padding:"8px 10px", marginBottom:6 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                <span style={{ color:"#ffcc00", fontSize:11, fontWeight:"bold" }}>{b.show_name}</span>
                <span style={{ color:"#334455", fontSize:9 }}>{b.size_kb} KB</span>
              </div>
              <div style={{ fontSize:9, color:"#556677", marginBottom:6 }}>
                {b.bundle_id} · {b.track_count} tracks · {b.device_count} devices · {new Date((b.compiled_at||0)*1000).toLocaleString()}
              </div>
              <div style={{ display:"flex", gap:5 }}>
                <button onClick={() => loadBundle(b.bundle_id)} style={{ flex:1, padding:"4px 0", background:"#003520", color:"#00ff88", border:"1px solid #00aa4444", borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:9 }}>
                  ▶ LOAD TO RUNTIME
                </button>
                <button onClick={() => deleteBundle(b.bundle_id)} style={{ padding:"4px 8px", background:"#1a0808", color:"#ff4444", border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:9 }}>
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
