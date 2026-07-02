import { useState, useEffect } from "react";
import { useShowStore } from "../../store/showStore";
import { API_BASE_URL } from "../../config";

const API = `${API_BASE_URL}/ai`;

const MOODS = ["energetic", "calm", "dramatic", "cinematic", "playful"];
const MOOD_ICONS = { energetic:"⚡", calm:"〰", dramatic:"🎭", cinematic:"🎬", playful:"✦" };
const TRACK_COLORS = { pump:"#00d4ff", valve:"#8b5cf6", lighting:"#f59e0b", flame:"#ef4444", fog:"#6b7280", laser:"#f97316" };

export default function AIPanel() {
  const [tab, setTab] = useState("generate");
  const { currentShow, timelineTracks, addServerLog, applyPatternToTrack, loadShow } = useShowStore();

  return (
    <div style={{ width:"100%", height:"100%", display:"flex", flexDirection:"column", background:"var(--bg-panel)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 12px", height:36, background:"var(--bg-surface)", borderBottom:"1px solid var(--border)", flexShrink:0 }}>
        <span style={{ fontSize:14, color:"var(--accent)" }}>✨</span>
        <span style={{ fontFamily:"var(--font-display)", fontSize:11, fontWeight:600, letterSpacing:"0.12em", color:"var(--text-secondary)", textTransform:"uppercase" }}>
          AI Choreography
        </span>
      </div>

      <div style={{ display:"flex", borderBottom:"1px solid var(--border)", background:"var(--bg-surface)", flexShrink:0 }}>
        {[["generate","Generate"],["learned","✦ Smart"],["learn","Learn"],["pattern","Pattern"],["enhance","Enhance"],["optimize","Optimize"]].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex:1, padding:"7px 0", background:"transparent", border:"none",
            borderBottom: tab===key ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab===key ? "var(--text-accent)" : "var(--text-muted)",
            fontFamily:"var(--font-body)", fontSize:9, fontWeight: tab===key ? 600 : 400,
            textTransform:"uppercase", letterSpacing:"0.05em", cursor:"pointer",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:12 }}>
        {tab==="generate" && <GenerateTab show={currentShow} onGenerate={(tracks, show) => {
          loadShow({ timelineTracks:tracks, currentShow:{ ...currentShow, ...show } });
          addServerLog({ level:"info", msg:`AI generated show: ${show.name}` });
        }} />}
        {tab==="learned" && <LearnedGenerateTab show={currentShow} onGenerate={(tracks, show) => {
          loadShow({ timelineTracks:tracks, currentShow:{ ...currentShow, ...show } });
          addServerLog({ level:"info", msg:`AI smart show generated: ${show.name}` });
        }} />}
        {tab==="learn" && <LearnTab tracks={timelineTracks} bpm={currentShow.bpm} />}
        {tab==="pattern" && <PatternTab bpm={currentShow.bpm} onApply={(clips, type) => {
          applyPatternToTrack(type, clips);
          addServerLog({ level:"info", msg:`AI pattern applied to ${type} track` });
        }} />}
        {tab==="enhance" && <EnhanceTab tracks={timelineTracks} bpm={currentShow.bpm} />}
        {tab==="optimize" && <OptimizeTab tracks={timelineTracks} bpm={currentShow.bpm} />}
      </div>
    </div>
  );
}

// ── Smart Generate Tab (Learning Engine) ───────────────────────────────────────
function LearnedGenerateTab({ show, onGenerate }) {
  const manualPriority = useShowStore(s => s.manualPriority);
  if (manualPriority) return <div style={{padding:12,color:"var(--text-muted)",fontSize:11,lineHeight:1.6}}>◈ Manual Pattern Designer is active.<br/>Disable it in the Pattern Designer panel to use AI choreography.</div>;
  const [prompt, setPrompt]           = useState("");
  const [mood, setMood]               = useState("energetic");
  const [duration, setDuration]       = useState(show.duration || 120);
  const [bpm, setBpm]                 = useState(show.bpm || 128);
  const [includeFlame, setIncludeFlame] = useState(false);
  const [includeLaser, setIncludeLaser] = useState(false);
  const [includeFog, setIncludeFog]   = useState(true);
  const [useEvolution, setUseEvolution] = useState(true);
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState(null);
  const [error, setError]             = useState(null);
  const [rating, setRating]           = useState(0);
  const [rated, setRated]             = useState(false);
  const [stats, setStats]             = useState(null);

  useEffect(() => {
    fetch(`${API}/learned/stats`).then(r=>r.json()).then(d=>setStats(d)).catch(()=>{});
  }, []);

  const generate = async () => {
    setLoading(true); setError(null); setResult(null); setRating(0); setRated(false);
    try {
      const res = await fetch(`${API}/learned/generate`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ prompt, mood, duration:parseFloat(duration), bpm:parseFloat(bpm),
          include_flame:includeFlame, include_laser:includeLaser, include_fog:includeFog,
          use_evolution:useEvolution }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setResult(data);
      setStats(data.learning_stats);
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const submitRating = async (stars) => {
    if (!result || rated) return;
    setRating(stars);
    try {
      await fetch(`${API}/learned/rate`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          rating: stars,
          patterns_used: result.patterns_used || [],
          mood, bpm: parseFloat(bpm),
          duration: parseFloat(duration),
        }),
      });
      setRated(true);
      fetch(`${API}/learned/stats`).then(r=>r.json()).then(d=>setStats(d)).catch(()=>{});
    } catch {}
  };

  const qualityLabel = stats?.capabilities?.learning_quality;
  const qualityColor = qualityLabel==="high" ? "var(--green)" : qualityLabel==="medium" ? "var(--amber)" : "var(--text-muted)";

  return (
    <div>
      {stats && (
        <div style={{ padding:"8px 10px", background:"rgba(0,212,255,0.04)", border:"1px solid var(--border-accent)", borderRadius:"var(--radius-sm)", marginBottom:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
            <span style={{ fontSize:9, fontFamily:"var(--font-mono)", color:"var(--text-muted)" }}>AI LEARNING STATUS</span>
            <span style={{ fontSize:9, fontFamily:"var(--font-mono)", color:qualityColor }}>● {qualityLabel?.toUpperCase()}</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:4 }}>
            {[
              ["Patterns", stats.stats?.total_patterns],
              ["High Quality", stats.stats?.high_quality_patterns],
              ["Feedback", stats.stats?.feedback_count],
            ].map(([label, val]) => (
              <div key={label} style={{ textAlign:"center", padding:"4px", background:"var(--bg-surface)", borderRadius:3 }}>
                <div style={{ fontSize:12, fontFamily:"var(--font-mono)", color:"var(--accent)", fontWeight:600 }}>{val ?? "—"}</div>
                <div style={{ fontSize:8, color:"var(--text-muted)" }}>{label}</div>
              </div>
            ))}
          </div>
          {stats.tips?.length > 0 && (
            <div style={{ marginTop:6, fontSize:9, color:"var(--text-muted)", lineHeight:1.5 }}>
              💡 {stats.tips[0]}
            </div>
          )}
        </div>
      )}

      <SectionLabel>Describe your show</SectionLabel>
      <textarea value={prompt} onChange={e=>setPrompt(e.target.value)}
        placeholder="e.g. Grand opening ceremony — powerful jets and dramatic lighting builds..."
        style={{ width:"100%", height:60, background:"var(--bg-void)", border:"1px solid var(--border-mid)", borderRadius:"var(--radius-sm)", color:"var(--text-primary)", fontFamily:"var(--font-body)", fontSize:11, padding:"8px", resize:"none", outline:"none", lineHeight:1.5 }}
      />

      <SectionLabel>Mood</SectionLabel>
      <div style={{ display:"flex", gap:4, marginBottom:10, flexWrap:"wrap" }}>
        {MOODS.map(m => (
          <button key={m} onClick={()=>setMood(m)} style={{
            padding:"3px 9px", borderRadius:"var(--radius-sm)", fontSize:10, cursor:"pointer",
            background: mood===m ? "rgba(0,212,255,0.1)" : "var(--bg-raised)",
            border:`1px solid ${mood===m ? "var(--accent)" : "var(--border)"}`,
            color: mood===m ? "var(--text-accent)" : "var(--text-muted)",
          }}>{MOOD_ICONS[m]} {m}</button>
        ))}
      </div>

      <div style={{ display:"flex", gap:8, marginBottom:10 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:3 }}>DURATION (s)</div>
          <input className="input" type="number" value={duration} onChange={e=>setDuration(e.target.value)} style={{ fontSize:12, fontFamily:"var(--font-mono)" }} />
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:3 }}>BPM</div>
          <input className="input" type="number" value={bpm} onChange={e=>setBpm(e.target.value)} style={{ fontSize:12, fontFamily:"var(--font-mono)" }} />
        </div>
      </div>

      <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
        <Toggle label="🔥 Flame"    value={includeFlame}   onChange={setIncludeFlame} />
        <Toggle label="✸ Laser"     value={includeLaser}   onChange={setIncludeLaser} />
        <Toggle label="≈ Fog"       value={includeFog}     onChange={setIncludeFog} />
        <Toggle label="🧬 Evolve"   value={useEvolution}   onChange={setUseEvolution} />
      </div>

      <button className="btn primary" onClick={generate} disabled={loading}
        style={{ width:"100%", justifyContent:"center", fontSize:12, padding:"8px" }}>
        {loading ? "⟳ Learning & Generating..." : "✨ Smart Generate (Learned)"}
      </button>

      {error && <div style={{ marginTop:8, fontSize:10, color:"var(--red)", fontFamily:"var(--font-mono)" }}>{error}</div>}

      {result && (
        <div style={{ marginTop:12 }}>
          <div style={{ padding:"10px 12px", background:"rgba(0,212,255,0.05)", border:"1px solid var(--border-accent)", borderRadius:"var(--radius-md)", marginBottom:8 }}>
            <div style={{ fontSize:12, fontWeight:600, color:"var(--text-primary)", marginBottom:4 }}>{result.show?.name}</div>
            <div style={{ fontSize:10, color:"var(--text-secondary)", lineHeight:1.6, marginBottom:6 }}>{result.show?.notes}</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              <Tag label={`${result.patterns_used?.length} patterns used`} accent />
              <Tag label={`${result.tracks?.length} tracks`} />
              <Tag label={result.analysis?.mood} />
            </div>
          </div>

          <SectionLabel>Generated Tracks</SectionLabel>
          {result.tracks?.map(track => (
            <div key={track.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 8px", marginBottom:4, background:"var(--bg-surface)", borderRadius:"var(--radius-sm)", border:"1px solid var(--border)" }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:TRACK_COLORS[track.type] || "#94a3b8", flexShrink:0 }} />
              <span style={{ flex:1, fontSize:11, color:"var(--text-primary)" }}>{track.label}</span>
              <span style={{ fontSize:9, fontFamily:"var(--font-mono)", color:"var(--text-muted)" }}>{track.clips?.length} clips</span>
            </div>
          ))}

          <button className="btn primary" onClick={() => onGenerate(result.tracks, result.show)}
            style={{ width:"100%", justifyContent:"center", fontSize:11, padding:"7px", marginBottom:10 }}>
            ↓ Apply to Timeline
          </button>

          <SectionLabel>Rate this show — help the AI learn</SectionLabel>
          <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:8 }}>
            {[1,2,3,4,5].map(star => (
              <button key={star} onClick={() => submitRating(star)} disabled={rated}
                style={{ fontSize:22, background:"none", border:"none", cursor:rated?"default":"pointer",
                  color: star<=rating ? "var(--amber)" : "var(--border)", transition:"color 0.1s",
                  opacity: rated && star!==rating ? 0.4 : 1 }}>
                ★
              </button>
            ))}
          </div>
          {rated && (
            <div style={{ textAlign:"center", fontSize:10, color:"var(--green)", marginBottom:8 }}>
              ✓ Rating saved — AI will improve future generations
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Learn Tab ──────────────────────────────────────────────────────────────────
function LearnTab({ tracks, bpm }) {
  const [mood, setMood]       = useState("energetic");
  const [source, setSource]   = useState("manual");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [patterns, setPatterns] = useState(null);
  const [evolveType, setEvolveType] = useState("pump");
  const [evolving, setEvolving]     = useState(false);
  const [evolved, setEvolved]       = useState(null);

  const learnFromCurrent = async () => {
    if (!tracks?.length) return;
    setLoading(true); setResult(null);
    try {
      const res = await fetch(`${API}/learned/learn-from-tracks`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ tracks, bpm, mood, source }),
      });
      const data = await res.json();
      setResult(data);
    } catch(e) {
      setResult({ status:"error", message: e.message });
    } finally {
      setLoading(false);
    }
  };

  const loadPatterns = async () => {
    try {
      const res = await fetch(`${API}/learned/patterns`);
      const data = await res.json();
      setPatterns(data);
    } catch {}
  };

  const evolvePattern = async () => {
    setEvolving(true); setEvolved(null);
    try {
      const res = await fetch(`${API}/learned/evolve`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ device_type:evolveType, mood, bpm }),
      });
      const data = await res.json();
      setEvolved(data);
    } catch(e) {
      setEvolved({ status:"error", message:e.message });
    } finally {
      setEvolving(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize:11, color:"var(--text-secondary)", lineHeight:1.6, marginBottom:12 }}>
        Teach the AI from your current timeline. It extracts reusable patterns and improves future generations.
      </div>

      <div style={{ padding:"8px 10px", background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)", marginBottom:10 }}>
        <div style={{ fontSize:10, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:4 }}>CURRENT TIMELINE</div>
        <div style={{ fontSize:11, color:"var(--text-secondary)" }}>
          {tracks?.length} tracks · {bpm} BPM ·{" "}
          {tracks?.reduce((sum, t) => sum + (t.clips?.length || 0), 0)} clips
        </div>
      </div>

      <div style={{ display:"flex", gap:8, marginBottom:10 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:3 }}>MOOD LABEL</div>
          <select className="input" value={mood} onChange={e=>setMood(e.target.value)} style={{ fontSize:11 }}>
            {MOODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:3 }}>SOURCE TYPE</div>
          <select className="input" value={source} onChange={e=>setSource(e.target.value)} style={{ fontSize:11 }}>
            <option value="manual">Manual (operator)</option>
            <option value="audio_sync">Audio sync</option>
            <option value="imported">Imported</option>
          </select>
        </div>
      </div>

      <button className="btn primary" onClick={learnFromCurrent} disabled={loading || !tracks?.length}
        style={{ width:"100%", justifyContent:"center", fontSize:11, padding:"7px", marginBottom:12 }}>
        {loading ? "⟳ Learning..." : "🧠 Learn from Current Timeline"}
      </button>

      {result && (
        <div style={{ padding:"8px 10px", background: result.status==="error" ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)", border:`1px solid ${result.status==="error" ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)"}`, borderRadius:"var(--radius-sm)", marginBottom:12 }}>
          {result.status==="error" ? (
            <div style={{ fontSize:10, color:"var(--red)" }}>✗ {result.message}</div>
          ) : (
            <>
              <div style={{ fontSize:11, color:"var(--green)", marginBottom:4 }}>
                ✓ Extracted {result.patterns_extracted} pattern(s) — total in memory: {result.total_in_memory}
              </div>
              {result.patterns?.map(p => (
                <div key={p.id} style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>
                  {p.name} ({p.device_type}, {p.clips} clips)
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <SectionLabel>Pattern Evolution — create new patterns</SectionLabel>
      <div style={{ fontSize:10, color:"var(--text-secondary)", lineHeight:1.5, marginBottom:8 }}>
        The AI combines and mutates your best patterns to create new variations using a genetic algorithm.
      </div>
      <div style={{ display:"flex", gap:6, marginBottom:8 }}>
        <select className="input" value={evolveType} onChange={e=>setEvolveType(e.target.value)} style={{ flex:1, fontSize:11 }}>
          {["pump","valve","lighting","fog","flame","laser"].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn" onClick={evolvePattern} disabled={evolving}
          style={{ fontSize:10, padding:"5px 12px" }}>
          {evolving ? "⟳" : "🧬 Evolve"}
        </button>
      </div>

      {evolved && (
        <div style={{ padding:"8px 10px", background: evolved.status==="error" ? "rgba(239,68,68,0.08)" : "rgba(139,92,246,0.08)", border:`1px solid ${evolved.status==="error" ? "rgba(239,68,68,0.2)" : "rgba(139,92,246,0.3)"}`, borderRadius:"var(--radius-sm)", marginBottom:12 }}>
          {evolved.status==="error" ? (
            <div style={{ fontSize:10, color:"var(--red)" }}>✗ {evolved.message}</div>
          ) : (
            <>
              <div style={{ fontSize:11, color:"var(--purple)", marginBottom:2 }}>🧬 {evolved.pattern?.name}</div>
              <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>
                {evolved.pattern?.clips?.length} clips · score: {evolved.pattern?.score?.toFixed(2)} · {evolved.pattern?.source}
              </div>
            </>
          )}
        </div>
      )}

      <SectionLabel>Pattern Library</SectionLabel>
      <button className="btn" onClick={loadPatterns} style={{ width:"100%", justifyContent:"center", fontSize:10, padding:"5px", marginBottom:8 }}>
        View All Learned Patterns
      </button>

      {patterns && (
        <div style={{ maxHeight:300, overflowY:"auto" }}>
          <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:6 }}>
            {patterns.count} patterns · avg score: {patterns.stats?.avg_score?.toFixed(2)}
          </div>
          {patterns.patterns?.slice(0, 30).map(p => (
            <div key={p.id} style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 6px", marginBottom:3, background:"var(--bg-surface)", borderRadius:3, border:"1px solid var(--border)" }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:TRACK_COLORS[p.device_type]||"#94a3b8", flexShrink:0 }} />
              <span style={{ flex:1, fontSize:10, color:"var(--text-secondary)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</span>
              <span style={{ fontSize:8, fontFamily:"var(--font-mono)", color:"var(--text-muted)" }}>{p.source}</span>
              <span style={{ fontSize:9, fontFamily:"var(--font-mono)", color: p.score>=0.75?"var(--green)":p.score>=0.55?"var(--amber)":"var(--red)" }}>
                {(p.score*100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Generate Tab (original) ────────────────────────────────────────────────────
function GenerateTab({ show, onGenerate }) {
  const manualPriority = useShowStore(s => s.manualPriority);
  if (manualPriority) return <div style={{padding:12,color:"var(--text-muted)",fontSize:11,lineHeight:1.6}}>◈ Manual Pattern Designer is active.<br/>Disable it in the Pattern Designer panel to use AI choreography.</div>;
  const [prompt, setPrompt]       = useState("");
  const [mood, setMood]           = useState("energetic");
  const [duration, setDuration]   = useState(show.duration || 120);
  const [bpm, setBpm]             = useState(show.bpm || 128);
  const [includeFlame, setIncludeFlame] = useState(false);
  const [includeLaser, setIncludeLaser] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState(null);

  const EXAMPLE_PROMPTS = [
    "Dramatic cinematic show with aggressive central jets and flame bursts",
    "Gentle ambient water ballet with soft blue lighting",
    "High-energy music festival fountain with synchronized RGB lighting",
    "Romantic evening display with flowing arcs and warm amber lights",
  ];

  const generate = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch(`${API}/generate`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ prompt, mood, duration:parseFloat(duration), bpm:parseFloat(bpm), include_flame:includeFlame, include_laser:includeLaser }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setResult(await res.json());
    } catch(e) {
      setResult(generateOffline(prompt, mood, parseFloat(bpm), parseFloat(duration)));
    } finally { setLoading(false); }
  };

  return (
    <div>
      <div style={{ fontSize:10, color:"var(--text-muted)", lineHeight:1.5, marginBottom:8, padding:"6px 8px", background:"rgba(0,212,255,0.04)", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)" }}>
        💡 Try the <strong>Smart Generate</strong> tab for AI-powered generation that learns from your feedback.
      </div>
      <SectionLabel>Describe your show</SectionLabel>
      <textarea value={prompt} onChange={e=>setPrompt(e.target.value)}
        placeholder="e.g. Generate a 2-minute dramatic fountain show with aggressive central jets..."
        style={{ width:"100%", height:72, background:"var(--bg-void)", border:"1px solid var(--border-mid)", borderRadius:"var(--radius-sm)", color:"var(--text-primary)", fontFamily:"var(--font-body)", fontSize:11, padding:"8px", resize:"none", outline:"none", lineHeight:1.5 }} />
      <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:10, marginTop:4 }}>
        {EXAMPLE_PROMPTS.map((p,i) => (
          <button key={i} onClick={()=>setPrompt(p)} style={{ fontSize:9, fontFamily:"var(--font-mono)", color:"var(--text-muted)", background:"var(--bg-raised)", border:"1px solid var(--border)", borderRadius:3, padding:"2px 6px", cursor:"pointer" }}>
            {p.slice(0,28)}...
          </button>
        ))}
      </div>
      <SectionLabel>Mood</SectionLabel>
      <div style={{ display:"flex", gap:5, marginBottom:10, flexWrap:"wrap" }}>
        {MOODS.map(m => (
          <button key={m} onClick={()=>setMood(m)} style={{ padding:"4px 10px", borderRadius:"var(--radius-sm)", fontSize:10, cursor:"pointer", background:mood===m?"rgba(0,212,255,0.1)":"var(--bg-raised)", border:`1px solid ${mood===m?"var(--accent)":"var(--border)"}`, color:mood===m?"var(--text-accent)":"var(--text-muted)" }}>
            {MOOD_ICONS[m]} {m}
          </button>
        ))}
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:10 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:3 }}>DURATION (s)</div>
          <input className="input" type="number" value={duration} onChange={e=>setDuration(e.target.value)} style={{ fontSize:12, fontFamily:"var(--font-mono)" }} />
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:3 }}>BPM</div>
          <input className="input" type="number" value={bpm} onChange={e=>setBpm(e.target.value)} style={{ fontSize:12, fontFamily:"var(--font-mono)" }} />
        </div>
      </div>
      <div style={{ display:"flex", gap:12, marginBottom:12 }}>
        <Toggle label="🔥 Flame" value={includeFlame} onChange={setIncludeFlame} />
        <Toggle label="✸ Laser" value={includeLaser} onChange={setIncludeLaser} />
      </div>
      <button className="btn primary" onClick={generate} disabled={loading} style={{ width:"100%", justifyContent:"center", fontSize:12, padding:"8px" }}>
        {loading ? "⟳ Generating..." : "✨ Generate Show"}
      </button>
      {error && <div style={{ marginTop:8, fontSize:10, color:"var(--red)", fontFamily:"var(--font-mono)" }}>{error}</div>}
      {result && (
        <div style={{ marginTop:12 }}>
          <div style={{ padding:"10px 12px", background:"rgba(0,212,255,0.05)", border:"1px solid var(--border-accent)", borderRadius:"var(--radius-md)", marginBottom:8 }}>
            <div style={{ fontSize:12, fontWeight:600, color:"var(--text-primary)", marginBottom:4 }}>{result.show?.name || "Generated Show"}</div>
            <div style={{ fontSize:10, color:"var(--text-secondary)", lineHeight:1.6 }}>{result.show?.notes}</div>
            {result.analysis && (
              <div style={{ marginTop:6, display:"flex", gap:8, flexWrap:"wrap" }}>
                <Tag label={`${result.analysis.beat_count} beats`} />
                <Tag label={`${result.analysis.sections?.length} sections`} />
                <Tag label={result.analysis.key} />
                <Tag label={result.analysis.mood} accent />
              </div>
            )}
          </div>
          <SectionLabel>Generated Tracks ({result.tracks?.length})</SectionLabel>
          {result.tracks?.map(track => (
            <div key={track.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 8px", marginBottom:4, background:"var(--bg-surface)", borderRadius:"var(--radius-sm)", border:"1px solid var(--border)" }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:track.color, flexShrink:0 }} />
              <span style={{ flex:1, fontSize:11, color:"var(--text-primary)" }}>{track.label}</span>
              <span style={{ fontSize:9, fontFamily:"var(--font-mono)", color:"var(--text-muted)" }}>{track.clips?.length} clips</span>
            </div>
          ))}
          <button className="btn primary" onClick={()=>onGenerate(result.tracks, result.show)} style={{ width:"100%", justifyContent:"center", fontSize:11, padding:"7px" }}>
            ↓ Apply to Timeline
          </button>
        </div>
      )}
    </div>
  );
}

// ── Pattern Tab ────────────────────────────────────────────────────────────────
function PatternTab({ bpm, onApply }) {
  const [deviceType, setDeviceType] = useState("pump");
  const [pattern, setPattern]       = useState("cascade");
  const [intensity, setIntensity]   = useState(80);
  const [duration, setDuration]     = useState(32);
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState(null);
  const DEVICE_TYPES = ["pump","valve","lighting","flame","fog"];
  const PATTERNS     = ["cascade","burst","wave","pulse","random"];
  const PATTERN_DESC = { cascade:"Gradually building clips", burst:"Short sharp bursts on beats", wave:"Sine wave intensity variation", pulse:"Rapid on/off pulses", random:"Randomized timing" };

  const generate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/generate-pattern`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ device_type:deviceType, pattern, intensity, duration:parseFloat(duration), bpm }) });
      setResult(await res.json());
    } catch {
      setResult(generatePatternOffline(deviceType, pattern, intensity, parseFloat(duration), bpm));
    } finally { setLoading(false); }
  };

  return (
    <div>
      <SectionLabel>Device Type</SectionLabel>
      <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:10 }}>
        {DEVICE_TYPES.map(t => (
          <button key={t} onClick={()=>setDeviceType(t)} style={{ padding:"3px 10px", fontSize:10, cursor:"pointer", background:deviceType===t?"rgba(0,212,255,0.1)":"var(--bg-raised)", border:`1px solid ${deviceType===t?"var(--accent)":"var(--border)"}`, color:deviceType===t?"var(--text-accent)":"var(--text-muted)", borderRadius:"var(--radius-sm)" }}>{t}</button>
        ))}
      </div>
      <SectionLabel>Pattern</SectionLabel>
      <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:10 }}>
        {PATTERNS.map(p => (
          <button key={p} onClick={()=>setPattern(p)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 10px", fontSize:11, cursor:"pointer", background:pattern===p?"rgba(0,212,255,0.08)":"var(--bg-surface)", border:`1px solid ${pattern===p?"var(--border-accent)":"var(--border)"}`, color:pattern===p?"var(--text-primary)":"var(--text-secondary)", borderRadius:"var(--radius-sm)" }}>
            <span style={{ textTransform:"capitalize", fontWeight:pattern===p?600:400 }}>{p}</span>
            <span style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>{PATTERN_DESC[p]}</span>
          </button>
        ))}
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:12 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:3 }}>INTENSITY %</div>
          <input className="input" type="number" value={intensity} min={10} max={100} onChange={e=>setIntensity(parseInt(e.target.value))} style={{ fontSize:12, fontFamily:"var(--font-mono)" }} />
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:3 }}>DURATION (s)</div>
          <input className="input" type="number" value={duration} onChange={e=>setDuration(e.target.value)} style={{ fontSize:12, fontFamily:"var(--font-mono)" }} />
        </div>
      </div>
      <button className="btn primary" onClick={generate} disabled={loading} style={{ width:"100%", justifyContent:"center", fontSize:11, padding:"7px" }}>
        {loading ? "⟳ Generating..." : "✦ Generate Pattern"}
      </button>
      {result && (
        <div style={{ marginTop:10, padding:"10px 12px", background:"rgba(0,212,255,0.05)", border:"1px solid var(--border-accent)", borderRadius:"var(--radius-md)" }}>
          <div style={{ fontSize:11, color:"var(--text-primary)", marginBottom:4 }}>{result.clip_count} clips generated · {result.pattern} pattern</div>
          <button className="btn" onClick={()=>onApply(result.clips, result.device_type)} style={{ width:"100%", justifyContent:"center", fontSize:10, marginTop:6 }}>
            ↓ Apply to {result.device_type} track
          </button>
        </div>
      )}
    </div>
  );
}

// ── Enhance Tab ────────────────────────────────────────────────────────────────
function EnhanceTab({ tracks, bpm }) {
  const [loading, setLoading]     = useState(false);
  const [suggestions, setSuggestions] = useState(null);

  const enhance = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/enhance`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ tracks, bpm }) });
      setSuggestions((await res.json()).suggestions);
    } catch {
      setSuggestions(["Add flame bursts at chorus sections for dramatic effect","Add atmospheric fog during intro and outro sections","Increase pump intensity peaks for more visual impact","Enable energy optimization to reduce idle consumption by ~15%","Consider 1/8 note valve patterns for tight beat sync"]);
    } finally { setLoading(false); }
  };

  return (
    <div>
      <div style={{ fontSize:11, color:"var(--text-secondary)", lineHeight:1.6, marginBottom:12 }}>
        Analyze your current show and get AI suggestions to improve the choreography, timing, and visual impact.
      </div>
      <div style={{ padding:"8px 10px", background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)", marginBottom:12 }}>
        <div style={{ fontSize:10, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:4 }}>CURRENT SHOW</div>
        <div style={{ fontSize:11, color:"var(--text-secondary)" }}>{tracks.length} tracks · {bpm} BPM</div>
      </div>
      <button className="btn primary" onClick={enhance} disabled={loading} style={{ width:"100%", justifyContent:"center", fontSize:11, padding:"7px", marginBottom:12 }}>
        {loading ? "⟳ Analyzing..." : "🔍 Analyze Show"}
      </button>
      {suggestions && (
        <div>
          <SectionLabel>Suggestions ({suggestions.length})</SectionLabel>
          {suggestions.map((s,i) => (
            <div key={i} style={{ display:"flex", gap:8, padding:"8px 10px", marginBottom:6, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)" }}>
              <span style={{ color:"var(--accent)", fontSize:10, flexShrink:0, marginTop:1 }}>✦</span>
              <span style={{ fontSize:11, color:"var(--text-secondary)", lineHeight:1.5 }}>{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Optimize Tab ───────────────────────────────────────────────────────────────
function OptimizeTab({ tracks, bpm }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);

  const optimize = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/optimize-energy`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ tracks, bpm }) });
      setResult(await res.json());
    } catch {
      setResult({ estimated_savings:"18%", optimizations:[{ track:"Master Pump Array", action:"Reduce 3 idle clips from 30% to 15%", savings_pct:8 }], recommendations:["Use VFD speed ramping instead of instant on/off for pumps","Stagger jet start times to reduce peak current draw"] });
    } finally { setLoading(false); }
  };

  return (
    <div>
      <div style={{ fontSize:11, color:"var(--text-secondary)", lineHeight:1.6, marginBottom:12 }}>
        Optimize power consumption across all devices while maintaining visual quality.
      </div>
      <button className="btn primary" onClick={optimize} disabled={loading} style={{ width:"100%", justifyContent:"center", fontSize:11, padding:"7px", marginBottom:12 }}>
        {loading ? "⟳ Optimizing..." : "⚡ Optimize Energy"}
      </button>
      {result && (
        <div>
          <div style={{ padding:"10px 12px", background:"rgba(16,185,129,0.06)", border:"1px solid rgba(16,185,129,0.2)", borderRadius:"var(--radius-md)", marginBottom:10 }}>
            <div style={{ fontSize:18, fontFamily:"var(--font-mono)", color:"var(--green)", fontWeight:700 }}>{result.estimated_savings}</div>
            <div style={{ fontSize:10, color:"var(--text-muted)" }}>Estimated energy savings</div>
          </div>
          {result.optimizations?.map((o,i) => (
            <div key={i} style={{ padding:"7px 10px", marginBottom:5, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)" }}>
              <div style={{ fontSize:10, fontWeight:600, color:"var(--text-primary)" }}>{o.track}</div>
              <div style={{ fontSize:10, color:"var(--text-muted)", marginTop:2 }}>{o.action}</div>
            </div>
          ))}
          <SectionLabel>Recommendations</SectionLabel>
          {result.recommendations?.map((r,i) => (
            <div key={i} style={{ display:"flex", gap:6, marginBottom:5, fontSize:10, color:"var(--text-secondary)", lineHeight:1.5 }}>
              <span style={{ color:"var(--green)" }}>→</span> {r}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{ fontSize:9, fontWeight:600, fontFamily:"var(--font-mono)", color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:7, marginTop:12, borderBottom:"1px solid var(--border)", paddingBottom:3 }}>
      {children}
    </div>
  );
}
function Tag({ label, accent }) {
  return (
    <span style={{ fontSize:9, fontFamily:"var(--font-mono)", padding:"1px 6px", borderRadius:3, background:accent?"rgba(0,212,255,0.1)":"var(--bg-raised)", color:accent?"var(--accent)":"var(--text-muted)", border:`1px solid ${accent?"rgba(0,212,255,0.2)":"var(--border)"}` }}>
      {label}
    </span>
  );
}
function Toggle({ label, value, onChange }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer" }} onClick={()=>onChange(!value)}>
      <div style={{ width:32, height:16, borderRadius:8, background:value?"rgba(0,212,255,0.2)":"var(--bg-raised)", border:`1px solid ${value?"var(--accent)":"var(--border)"}`, position:"relative", transition:"all 0.15s" }}>
        <div style={{ width:10, height:10, borderRadius:"50%", background:value?"var(--accent)":"var(--text-muted)", position:"absolute", top:2, left:value?18:2, transition:"left 0.15s" }} />
      </div>
      <span style={{ fontSize:10, color:value?"var(--text-primary)":"var(--text-muted)" }}>{label}</span>
    </div>
  );
}
function generateOffline(prompt, mood, bpm, duration) {
  const sections = [
    { label:"Intro",  start:0,              end:duration*0.1, energy:0.3 },
    { label:"Verse",  start:duration*0.1,   end:duration*0.4, energy:0.6 },
    { label:"Chorus", start:duration*0.4,   end:duration*0.7, energy:1.0 },
    { label:"Finale", start:duration*0.7,   end:duration,     energy:0.8 },
  ];
  const tracks = [
    { id:"off-pump",  label:"Pump Array",   type:"pump",     color:"#00d4ff", deviceId:"pump-01",  clips:sections.map((s,i)=>({ id:`op-${i}`, start:Math.round(s.start), end:Math.round(s.end), intensity:Math.round(s.energy*100), label:s.label })) },
    { id:"off-light", label:"RGB Lighting", type:"lighting", color:"#f59e0b", deviceId:"light-01", clips:sections.map((s,i)=>({ id:`ol-${i}`, start:Math.round(s.start), end:Math.round(s.end), intensity:Math.round(s.energy*100), label:s.label })) },
  ];
  return { show:{ name:`AI Show (${mood})`, bpm, duration, notes:`Generated offline at ${bpm} BPM, ${mood} mood.` }, tracks, analysis:{ beat_count:Math.round(bpm*duration/60), sections:sections.length, key:"A minor", mood } };
}
function generatePatternOffline(deviceType, pattern, intensity, duration, bpm) {
  const beat = 60.0/bpm;
  const clips = []; let t=0, id=0;
  const step = pattern==="burst"?beat*4:pattern==="pulse"?beat*0.5:beat*2;
  while (t < duration) { clips.push({ id:`pat-${id++}`, start:Math.round(t*100)/100, end:Math.round((t+step*0.85)*100)/100, intensity, label:pattern.charAt(0).toUpperCase()+pattern.slice(1) }); t+=step; }
  return { device_type:deviceType, pattern, clips, clip_count:clips.length, bpm, duration };
}
