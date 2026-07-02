import { useState, useRef, useCallback, useEffect } from "react";
import { useShowStore } from "../../store/showStore";
import { API_BASE_URL } from "../../config";

const API = `${API_BASE_URL}/audio`;

// ── Helper: persist job history ─────────────────────────────────────────────
const getStoredJobs = () => {
  try { return JSON.parse(localStorage.getItem("aquaflow_file_jobs") || "[]"); }
  catch { return []; }
};
const saveStoredJobs = (jobs) => {
  localStorage.setItem("aquaflow_file_jobs", JSON.stringify(jobs.slice(0, 30)));
};

export default function AudioPanel() {
  const [tab, setTab] = useState("upload");
  const [selectedJobId, setSelectedJobId] = useState(() => localStorage.getItem("aquaflow_selected_job_id") || "");
  const [fileJobs, setFileJobs] = useState(getStoredJobs);
  const addServerLog = useShowStore(s => s.addServerLog) || (() => {});

  // Track selected job across tabs
  const selectJob = (jobId) => {
    setSelectedJobId(jobId);
    localStorage.setItem("aquaflow_selected_job_id", jobId);
  };

  // Add a new job to history
      const addJob = (filename, jobId, size_mb) => {
    const entry = { filename, jobId, size_mb, timestamp: Date.now() };
    setFileJobs(prev => {
      const updated = [entry, ...prev.filter(j => j.jobId !== jobId)].slice(0, 30);
      saveStoredJobs(updated);
      return updated;
    });
    selectJob(jobId);
  };

  return (
    <div style={{ width:"100%", height:"100%", display:"flex", flexDirection:"column", background:"var(--bg-panel)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 12px", height:36, background:"var(--bg-surface)", borderBottom:"1px solid var(--border)", flexShrink:0 }}>
        <span style={{ fontSize:14 }}>♪</span>
        <span style={{ fontFamily:"var(--font-display)", fontSize:11, fontWeight:600, letterSpacing:"0.12em", color:"var(--text-secondary)", textTransform:"uppercase" }}>
          Audio Engine
        </span>
        {selectedJobId && (
          <span style={{ fontSize:9, color:"var(--accent)", fontFamily:"var(--font-mono)", marginLeft:"auto" }}>
            JOB: {selectedJobId.slice(0, 8)}...
          </span>
        )}
      </div>

      <div style={{ display:"flex", borderBottom:"1px solid var(--border)", background:"var(--bg-surface)", flexShrink:0 }}>
        {[["upload","Upload"],["analyze","Analysis"],["sync","Sync"],["player","Player"]].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex:1, padding:"7px 0", background:"transparent", border:"none",
            borderBottom: tab===key ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab===key ? "var(--text-accent)" : "var(--text-muted)",
            fontFamily:"var(--font-body)", fontSize:10, fontWeight: tab===key ? 600 : 400,
            textTransform:"uppercase", letterSpacing:"0.05em", cursor:"pointer",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:"auto" }}>
                {tab==="upload"  && <UploadTab 
          onAnalyzed={(jobId) => { selectJob(jobId); setTab("analyze"); }} 
          addServerLog={addServerLog} 
          addJob={addJob}
          fileJobs={fileJobs}
          selectedJobId={selectedJobId}
          selectJob={selectJob}
          setTab={setTab}
        />}
        {tab==="analyze" && <AnalysisTab 
          addServerLog={addServerLog} 
          selectedJobId={selectedJobId}
          fileJobs={fileJobs}
          selectJob={selectJob}
        />}
        {tab==="sync"    && <SyncTab 
          addServerLog={addServerLog} 
          selectedJobId={selectedJobId}
          fileJobs={fileJobs}
          selectJob={selectJob}
        />}
        {tab==="player"  && <PlayerTab />}
      </div>
    </div>
  );
}

// ── Upload Tab ──────────────────────────────────────────────────────────────
function UploadTab({ onAnalyzed, addServerLog, addJob, fileJobs, selectedJobId, selectJob, setTab }) {
  const [dragOver, setDragOver]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [status, setStatus]       = useState(null);
  const [error, setError]         = useState(null);
  const [files, setFiles]         = useState([]);
  const fileRef  = useRef(null);
  const pollRef  = useRef(null);

  useEffect(() => { loadFiles(); }, []);

      const loadFiles = async () => {
    try {
      const res  = await fetch(`${API}/list`);
      const data = await res.json();
      const loadedFiles = data.files || [];
      setFiles(loadedFiles);
      
      loadedFiles.forEach(f => {
        if (f.job_id) {
          addJob(f.filename, f.job_id, f.size_mb);
        }
      });
    } catch (err) {
      console.error("loadFiles error:", err);
    }
  };

  const uploadFile = async (file) => {
    setError(null); setUploading(true); setProgress(0);
    setStatus("Uploading...");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/upload`, { method:"POST", body:form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Upload failed: ${res.status}`);
      }
            const data = await res.json();
      // Backend might return job_id, id, file_id, or nothing — handle all cases
      const id   = data.job_id || data.id || data.file_id || `client-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      
      // ── CRITICAL FIX: Track this file+job mapping ──
      addJob(file.name, id, (file.size/1024/1024).toFixed(2));
      localStorage.setItem("aquaflow_last_job_id", id);
      
      setStatus("Analyzing...");
      setProgress(0.1);
      pollAnalysis(id, file.name);
      addServerLog?.({ level:"info", msg:`Analyzing ${file.name} — Job: ${id}` });
    } catch (e) {
      setError(e.message);
      setUploading(false);
    }
  };

  const pollAnalysis = (id, filename) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`${API}/status/${id}`);
        const data = await res.json();
        setProgress(data.progress || 0);
        if (data.status === "complete") {
          clearInterval(pollRef.current);
          setUploading(false);
          setStatus("✔ Analysis complete");
          setProgress(1.0);
          loadFiles();
          onAnalyzed(id);
          addServerLog?.({ level:"info", msg:`Analysis complete: ${data.result?.bpm} BPM, ${data.result?.key}` });
        } else if (data.status === "error") {
          clearInterval(pollRef.current);
          setUploading(false);
          setError(data.error || "Analysis failed");
        } else {
          setStatus(`Analyzing... ${Math.round((data.progress||0)*100)}%`);
        }
      } catch {}
    }, 800);
  };

  useEffect(() => () => clearInterval(pollRef.current), []);

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  };

  return (
    <div style={{ padding:12 }}>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border:`2px dashed ${dragOver ? "var(--accent)" : "var(--border-mid)"}`,
          borderRadius:"var(--radius-md)", padding:"28px 16px",
          textAlign:"center", cursor:"pointer",
          background: dragOver ? "var(--accent-pulse)" : "var(--bg-surface)",
          transition:"all 0.15s", marginBottom:12,
        }}
      >
        <div style={{ fontSize:28, marginBottom:8, opacity:0.5 }}>♪</div>
        <div style={{ fontSize:12, color:"var(--text-primary)", marginBottom:4 }}>
          Drop audio file here or click to browse
        </div>
        <div style={{ fontSize:10, color:"var(--text-muted)" }}>
          MP3 · WAV · FLAC · OGG · AAC supported
        </div>
        <input ref={fileRef} type="file" accept=".mp3,.wav,.flac,.ogg,.aac,.m4a"
          style={{ display:"none" }}
          onChange={e => e.target.files[0] && uploadFile(e.target.files[0])} />
      </div>

      {/* Progress bar */}
      {uploading && (
        <div style={{ marginBottom:12 }}>
          <div style={{ height:4, background:"var(--border)", borderRadius:2, overflow:"hidden", marginBottom:4 }}>
            <div style={{ width:`${progress*100}%`, height:"100%", background:"var(--accent)", borderRadius:2, transition:"width 0.3s" }} />
          </div>
          <div style={{ fontSize:10, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>{status}</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding:"8px 12px", background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:"var(--radius-sm)", color:"var(--red)", fontSize:11, marginBottom:10 }}>
          ✗ {error}
        </div>
      )}

      {/* Success */}
      {status && !uploading && !error && (
        <div style={{ padding:"6px 10px", background:"rgba(16,185,129,0.08)", border:"1px solid rgba(16,185,129,0.2)", borderRadius:"var(--radius-sm)", color:"var(--green)", fontSize:11, marginBottom:10 }}>
          {status} — switching to Analysis tab...
        </div>
      )}

      <SectionLabel>Uploaded Files ({files.length})</SectionLabel>
      {files.length === 0 ? (
        <div style={{ fontSize:10, color:"var(--text-muted)", textAlign:"center", padding:"16px 0" }}>
          No audio files uploaded yet
        </div>
      ) : (
                files.map((f,i) => {
                              const job = fileJobs.find(j => j.filename === f.filename);
          const fallbackId = job ? job.jobId : (f.job_id || `file-${f.filename.replace(/[^a-z0-9]/gi, '-')}`);
          const isSelected = selectedJobId === fallbackId;
          return (
            <div 
              key={i} 
              onClick={() => {
                if (!job && f.job_id) {
                  addJob(f.filename, f.job_id, f.size_mb);
                } else if (job) {
                  selectJob(job.jobId);
                }
              }}
              style={{ 
                display:"flex", alignItems:"center", gap:8, 
                padding:"8px 10px", marginBottom:4, 
                background: isSelected ? "rgba(0,212,255,0.08)" : "var(--bg-surface)", 
                border:`1px solid ${isSelected ? "var(--accent)" : "var(--border)"}`, 
                borderRadius:"var(--radius-sm)",
                cursor: job ? "pointer" : "default",
                transition:"all 0.15s",
              }}
            >
              {/* Selection indicator */}
              <div style={{
                width:14, height:14, borderRadius:"50%",
                border:`2px solid ${isSelected ? "var(--accent)" : "var(--border-mid)"}`,
                background: isSelected ? "var(--accent)" : "transparent",
                display:"flex", alignItems:"center", justifyContent:"center",
                flexShrink:0,
              }}>
                {isSelected && <span style={{ color:"var(--bg-void)", fontSize:9 }}>✓</span>}
              </div>
              
              <span style={{ fontSize:14, opacity:0.6 }}>♪</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:11, color:"var(--text-primary)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {f.filename}
                </div>
                                <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>
                  {f.size_mb} MB {job ? `• Job: ${job.jobId.slice(0,8)}...` : `• ID: ${fallbackId.slice(0,8)}...`}
                </div>
              </div>
              
              {/* Action buttons */}
              {job && (
                <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                  <button 
                    className="btn" 
                    style={{ fontSize:9, padding:"3px 8px" }}
                    onClick={(e) => { e.stopPropagation(); selectJob(job.jobId); setTab?.("analyze"); }}
                  >
                    Analyze
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Analysis Tab ────────────────────────────────────────────────────────────
function AnalysisTab({ addServerLog, selectedJobId, fileJobs, selectJob }) {
  const [jobId, setJobId]   = useState(selectedJobId || "");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  // Auto-load when selectedJobId changes
  useEffect(() => {
    if (selectedJobId && selectedJobId !== jobId) {
      setJobId(selectedJobId);
      loadAnalysis(selectedJobId);
    }
  }, [selectedJobId]);

  const loadAnalysis = async (id) => {
    const target = id || jobId;
    if (!target) return;
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${API}/status/${target}`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (data.status === "complete" && data.result) {
        setResult(data.result);
      } else if (data.status === "error") {
        setError(data.error || "Analysis failed");
      } else {
        setError(`Analysis status: ${data.status} — still processing or upload a file first`);
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ padding:12 }}>
      <SectionLabel>Select Analysis</SectionLabel>
      
      {/* ── CRITICAL FIX: Dropdown of available jobs instead of blind text input ── */}
      <div style={{ display:"flex", gap:6, marginBottom:12, alignItems:"center" }}>
        <select 
          className="input"
          value={jobId} 
          onChange={e => { setJobId(e.target.value); selectJob(e.target.value); }}
          style={{ flex:1, fontSize:11, background:"var(--bg-void)", color:"var(--text-primary)" }}
        >
          <option value="">-- Choose an analyzed file --</option>
          {fileJobs.map((job) => (
            <option key={job.jobId} value={job.jobId}>
              {job.filename} ({job.jobId.slice(0,8)}...)
            </option>
          ))}
        </select>
        <button className="btn primary" onClick={() => loadAnalysis()} disabled={loading || !jobId} style={{ fontSize:10, flexShrink:0 }}>
          {loading ? "..." : "Load"}
        </button>
      </div>

      {/* Manual input fallback */}
      <div style={{ display:"flex", gap:6, marginBottom:12 }}>
        <input className="input" placeholder="Or enter Job ID manually"
          value={jobId} onChange={e => { setJobId(e.target.value); selectJob(e.target.value); }}
          style={{ flex:1, fontSize:11 }} />
      </div>

      {error && (
        <div style={{ padding:"8px 12px", background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:"var(--radius-sm)", color:"var(--red)", fontSize:11, marginBottom:10 }}>
          ✗ {error}
        </div>
      )}

      {result && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
            {[
              ["BPM",      `${result.bpm} (${Math.round(result.bpm_confidence*100)}% conf)`, "#00d4ff"],
              ["Key",      result.key,    "#8b5cf6"],
              ["Mood",     result.mood,   "#f59e0b"],
              ["Duration", `${Math.floor(result.duration/60)}:${String(Math.floor(result.duration%60)).padStart(2,"0")}`, "#10b981"],
              ["Beats",    result.beat_count,    "#00d4ff"],
              ["Sections", result.section_count, "#f97316"],
            ].map(([label,value,color]) => (
              <div key={label} style={{ padding:"8px 10px", background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)" }}>
                <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginBottom:2 }}>{label}</div>
                <div style={{ fontSize:13, fontWeight:600, color, fontFamily:"var(--font-mono)" }}>{value}</div>
              </div>
            ))}
          </div>

          <SectionLabel>Sections</SectionLabel>
          {result.sections?.map((s,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, padding:"5px 8px", background:"var(--bg-surface)", borderRadius:"var(--radius-sm)", border:"1px solid var(--border)" }}>
              <div style={{ width:40, height:4, background:"var(--border)", borderRadius:2, overflow:"hidden" }}>
                <div style={{ width:`${s.energy*100}%`, height:"100%", background:`hsl(${200-s.energy*120},80%,55%)`, borderRadius:2 }} />
              </div>
              <span style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--text-muted)", width:28 }}>
                {Math.floor(s.start/60)}:{String(Math.floor(s.start%60)).padStart(2,"0")}
              </span>
              <span style={{ fontSize:11, color:"var(--text-primary)", flex:1, textTransform:"capitalize" }}>{s.label}</span>
              <span style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--text-muted)" }}>{Math.round(s.energy*100)}%</span>
            </div>
          ))}

          <SectionLabel>Energy Profile</SectionLabel>
          <EnergyWaveform data={result.energy_profile} bassData={result.bass_profile} />

          <SectionLabel>Beat Map (first 32)</SectionLabel>
          <div style={{ display:"flex", flexWrap:"wrap", gap:2 }}>
            {result.beats?.slice(0,32).map((b,i) => (
              <div key={i} style={{
                width:14, height:14, borderRadius:2,
                background: b.type==="downbeat" ? "var(--accent)" : b.type==="beat" ? "rgba(0,212,255,0.4)" : "var(--border)",
              }} />
            ))}
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text-muted)", fontSize:11 }}>
          Select a file from the dropdown above — analysis loads automatically
        </div>
      )}
    </div>
  );
}

// ── Sync Tab ────────────────────────────────────────────────────────────────
function SyncTab({ addServerLog, selectedJobId, fileJobs, selectJob }) {
  const [analysisId, setAnalysisId] = useState(selectedJobId || "");
  const [bpmOverride, setBpmOverride] = useState("");
  const [includeFlame, setIncludeFlame] = useState(false);
  const [includeFog,   setIncludeFog]   = useState(true);
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState(null);
  const loadShow = useShowStore(s => s.loadShow);

  // Sync with parent selection
  useEffect(() => {
    if (selectedJobId && selectedJobId !== analysisId) {
      setAnalysisId(selectedJobId);
    }
  }, [selectedJobId]);

  const sync = async () => {
    if (!analysisId) { setError("Select an analysis from the dropdown first"); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API}/sync-to-show`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          analysis_id: analysisId,
          job_id: analysisId,
          bpm_override: bpmOverride ? parseFloat(bpmOverride) : null,
          include_flame: includeFlame,
          include_fog:   includeFog,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Sync failed: ${res.status}`);
      }
      const data = await res.json();
      setResult(data);
      addServerLog?.({ level:"info", msg:`Show synced to: ${data.audio?.filename}` });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const applyToTimeline = () => {
    if (!result) return;
    loadShow?.({
      timelineTracks: result.tracks,
      audioData: {
        job_id: analysisId,
        filename: result.audio?.filename,
        bpm: result.audio?.bpm,
        duration: result.audio?.duration,
        key: result.audio?.key,
        mood: result.audio?.mood,
        waveform: result.audio?.waveform || [],
        beats: [],
        sections: [],
      },
    });
    addServerLog?.({ level:"info", msg:"Applied audio-synced show to timeline" });
  };

  return (
    <div style={{ padding:12 }}>
      <div style={{ fontSize:11, color:"var(--text-secondary)", lineHeight:1.6, marginBottom:12 }}>
        Generate a complete show synchronized to your audio. The timeline auto-generates clips aligned to beats and song sections.
      </div>

      <SectionLabel>Select Analysis</SectionLabel>
      
      {/* ── CRITICAL FIX: Dropdown instead of blind auto-select ── */}
      <select 
        className="input"
        value={analysisId} 
        onChange={e => { setAnalysisId(e.target.value); selectJob(e.target.value); }}
        style={{ marginBottom:10, fontSize:11, width:"100%", background:"var(--bg-void)", color:"var(--text-primary)" }}
      >
        <option value="">-- Choose an analyzed file --</option>
        {fileJobs.map((job) => (
          <option key={job.jobId} value={job.jobId}>
            {job.filename} ({job.jobId.slice(0,8)}...)
          </option>
        ))}
      </select>

      <SectionLabel>BPM Override (optional)</SectionLabel>
      <input className="input" type="number" placeholder="Leave blank to use detected BPM"
        value={bpmOverride} onChange={e => setBpmOverride(e.target.value)}
        style={{ marginBottom:10, fontSize:11, fontFamily:"var(--font-mono)" }} />

      <div style={{ display:"flex", gap:16, marginBottom:14 }}>
        <Toggle label="Include Flame" value={includeFlame} onChange={setIncludeFlame} />
        <Toggle label="Include Fog"   value={includeFog}   onChange={setIncludeFog} />
      </div>

      <button className="btn primary" onClick={sync} disabled={loading || !analysisId}
        style={{ width:"100%", justifyContent:"center", fontSize:12, padding:"8px", marginBottom:10 }}>
        {loading ? "Syncing to audio..." : "♪ Sync Show to Audio"}
      </button>

      {error && (
        <div style={{ padding:"8px 12px", background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:"var(--radius-sm)", color:"var(--red)", fontSize:11, marginBottom:10 }}>
          ✗ {error}
        </div>
      )}

      {result && (
        <div>
          <div style={{ padding:"10px 12px", background:"rgba(0,212,255,0.05)", border:"1px solid var(--border-accent)", borderRadius:"var(--radius-md)", marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:600, color:"var(--text-primary)", marginBottom:4 }}>
              {result.show?.name}
            </div>
            <div style={{ fontSize:10, color:"var(--text-secondary)", lineHeight:1.6 }}>
              {result.show?.notes}
            </div>
            <div style={{ display:"flex", gap:6, marginTop:6, flexWrap:"wrap" }}>
              <Tag label={`${result.audio?.bpm} BPM`} accent />
              <Tag label={result.audio?.key} />
              <Tag label={result.audio?.mood} />
              <Tag label={`${result.tracks?.length} tracks`} />
            </div>
          </div>
          <button className="btn primary" onClick={applyToTimeline}
            style={{ width:"100%", justifyContent:"center", fontSize:11, padding:"7px" }}>
            ↗ Apply to Timeline
          </button>
        </div>
      )}
    </div>
  );
}

// ── Player Tab ──────────────────────────────────────────────────────────────
function PlayerTab() {
  const [files, setFiles]   = useState([]);
  const [playing, setPlaying] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/list`).then(r => r.json()).then(d => setFiles(d.files||[])).catch(() => {});
  }, []);

  const play = (filename) => {
    audioRef.current?.pause();
    const audio = new Audio(`${API}/stream/${encodeURIComponent(filename)}`);
    audio.play().catch(() => {});
    audioRef.current = audio;
    setPlaying(filename);
    audio.onended = () => setPlaying(null);
  };

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
  };

  return (
    <div style={{ padding:12 }}>
      <SectionLabel>Audio Files</SectionLabel>
      {files.length === 0 ? (
        <div style={{ fontSize:10, color:"var(--text-muted)", textAlign:"center", padding:"20px 0" }}>
          No audio files. Upload one in the Upload tab.
        </div>
      ) : (
        files.map((f,i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", marginBottom:5, background: playing===f.filename ? "rgba(0,212,255,0.06)" : "var(--bg-surface)", border:`1px solid ${playing===f.filename ? "var(--border-accent)" : "var(--border)"}`, borderRadius:"var(--radius-sm)" }}>
            <button onClick={() => playing===f.filename ? stop() : play(f.filename)}
              style={{ width:24, height:24, borderRadius:"50%", background: playing===f.filename ? "var(--accent)" : "var(--bg-raised)", border:`1px solid ${playing===f.filename ? "var(--accent)" : "var(--border)"}`, color: playing===f.filename ? "var(--bg-void)" : "var(--text-primary)", fontSize:10, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              {playing===f.filename ? "■" : "▶"}
            </button>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11, color:"var(--text-primary)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.filename}</div>
              <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>{f.size_mb} MB</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Shared components ───────────────────────────────────────────────────────
function EnergyWaveform({ data, bassData }) {
  if (!data?.length) return null;
  const W=280, H=50, step=W/data.length;
  const basePath = data.map((v,i) => `${i===0?"M":"L"}${i*step},${H-v*H}`).join(" ")+` L${W},${H} L0,${H} Z`;
  const bassPath = bassData?.map((v,i) => `${i===0?"M":"L"}${i*step},${H-v*H*0.7}`).join(" ")||"";
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginBottom:8 }}>
      <path d={basePath} fill="rgba(0,212,255,0.15)" stroke="rgba(0,212,255,0.4)" strokeWidth="0.8" />
      {bassPath && <path d={bassPath+` L${W},${H} L0,${H} Z`} fill="rgba(139,92,246,0.1)" stroke="rgba(139,92,246,0.3)" strokeWidth="0.6" />}
    </svg>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize:9, fontWeight:600, fontFamily:"var(--font-mono)", color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:7, marginTop:12, borderBottom:"1px solid var(--border)", paddingBottom:3 }}>
      {children}
    </div>
  );
}

function Tag({ label, accent }) {
  return (
    <span style={{ fontSize:9, fontFamily:"var(--font-mono)", padding:"1px 6px", borderRadius:3, background: accent ? "rgba(0,212,255,0.1)" : "var(--bg-raised)", color: accent ? "var(--accent)" : "var(--text-muted)", border:`1px solid ${accent ? "rgba(0,212,255,0.2)" : "var(--border)"}` }}>
      {label}
    </span>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer" }} onClick={() => onChange(!value)}>
      <div style={{ width:28, height:14, borderRadius:7, background: value ? "rgba(0,212,255,0.2)" : "var(--bg-raised)", border:`1px solid ${value ? "var(--accent)" : "var(--border)"}`, position:"relative", transition:"all 0.15s" }}>
        <div style={{ width:8, height:8, borderRadius:"50%", background: value ? "var(--accent)" : "var(--text-muted)", position:"absolute", top:2, left: value ? 16 : 2, transition:"left 0.15s" }} />
      </div>
      <span style={{ fontSize:10, color: value ? "var(--text-primary)" : "var(--text-muted)" }}>{label}</span>
    </div>
  );
}