import { useState, useRef, useCallback, useEffect } from "react";
import { useShowStore } from "../../store/showStore";
import { API_BASE_URL } from "../../config";

const API = `${API_BASE_URL}/audio`;

export default function AudioPanel() {
  const [tab, setTab] = useState("upload");
  const { currentShow, addServerLog } = useShowStore();

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36, background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14 }}>♫</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Audio Engine
        </span>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", flexShrink: 0 }}>
        {[["upload", "Upload"], ["analyze", "Analysis"], ["sync", "Sync"], ["player", "Player"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex: 1, padding: "7px 0", background: "transparent", border: "none",
            borderBottom: tab === key ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab === key ? "var(--text-accent)" : "var(--text-muted)",
            fontFamily: "var(--font-body)", fontSize: 10, fontWeight: tab === key ? 600 : 400,
            textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer",
          }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "upload"  && <UploadTab onAnalyzed={(r) => { setTab("analyze"); }} addServerLog={addServerLog} />}
        {tab === "analyze" && <AnalysisTab addServerLog={addServerLog} />}
        {tab === "sync"    && <SyncTab bpm={currentShow.bpm} addServerLog={addServerLog} />}
        {tab === "player"  && <PlayerTab />}
      </div>
    </div>
  );
}

// ── Upload Tab ─────────────────────────────────────────────────────────────────
function UploadTab({ onAnalyzed, addServerLog }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState(null);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    try {
      const res = await fetch(`${API}/list`);
      const data = await res.json();
      setFiles(data.files || []);
    } catch {}
  };

  const uploadFile = async (file) => {
    setError(null);
    setUploading(true);
    setProgress(0);
    setStatus("Uploading...");
    addServerLog({ level: "info", msg: `Uploading ${file.name}...` });

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/upload`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = await res.json();
      const id = data.job_id;
      setJobId(id);
      // Auto-copy to localStorage so Sync tab can use it
      localStorage.setItem("aquaflow_last_job_id", id);
      setStatus("Analyzing...");
      setProgress(0.1);
      pollAnalysis(id);
      addServerLog({ level: "info", msg: `Analyzing ${file.name} — Job ID: ${id}` });
    } catch (e) {
      setError(e.message);
      setUploading(false);
      addServerLog({ level: "warn", msg: `Upload failed: ${e.message}` });
    }
  };

  const pollAnalysis = (id) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/status/${id}`);
        const data = await res.json();
        setProgress(data.progress || 0);
        setStatus(data.status === "analyzing" ? "Analyzing audio..." : data.status);

        if (data.status === "complete") {
          clearInterval(pollRef.current);
          setUploading(false);
          setStatus("✓ Analysis complete");
          setProgress(1.0);
          loadFiles();
          onAnalyzed(data.result);
          addServerLog({ level: "info", msg: `Analysis complete: ${data.result?.bpm} BPM, ${data.result?.key}` });
        } else if (data.status === "error") {
          clearInterval(pollRef.current);
          setUploading(false);
          setError(data.error || "Analysis failed");
        }
      } catch {}
    }, 800);
  };

  useEffect(() => () => clearInterval(pollRef.current), []);

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  };

  return (
    <div style={{ padding: 12 }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border-mid)"}`,
          borderRadius: "var(--radius-md)", padding: "28px 16px",
          textAlign: "center", cursor: "pointer",
          background: dragOver ? "var(--accent-pulse)" : "var(--bg-surface)",
          transition: "all 0.15s", marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>♫</div>
        <div style={{ fontSize: 12, color: "var(--text-primary)", marginBottom: 4 }}>
          Drop audio file here
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
          MP3, WAV, FLAC, OGG, AAC supported
        </div>
        <input ref={fileRef} type="file" accept=".mp3,.wav,.flac,.ogg,.aac,.m4a"
          style={{ display: "none" }}
          onChange={e => e.target.files[0] && uploadFile(e.target.files[0])} />
      </div>

      {uploading && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden", marginBottom: 4 }}>
            <div style={{ width: `${progress * 100}%`, height: "100%", background: "var(--accent)", borderRadius: 2, transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{status}</div>
        </div>
      )}

      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "var(--radius-sm)", color: "var(--red)", fontSize: 11, marginBottom: 10 }}>
          ✕ {error}
        </div>
      )}

      {status && !uploading && (
        <div style={{ padding: "6px 10px", background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "var(--radius-sm)", color: "var(--green)", fontSize: 11, marginBottom: 10 }}>
          {status}
        </div>
      )}

      {jobId && (
        <div style={{ padding: "8px 12px", background: "rgba(0,212,255,0.05)", border: "1px solid var(--border-accent)", borderRadius: "var(--radius-sm)", marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>JOB ID — use this in Analysis & Sync tabs</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <code style={{ flex: 1, fontSize: 10, color: "var(--text-accent)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{jobId}</code>
            <button className="btn" style={{ fontSize: 9, padding: "2px 8px", flexShrink: 0 }}
              onClick={() => navigator.clipboard.writeText(jobId).then(() => {})}>
              Copy
            </button>
          </div>
        </div>
      )}

      <SectionLabel>Uploaded Files ({files.length})</SectionLabel>
      {files.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>
          No audio files uploaded yet
        </div>
      ) : (
        files.map((f, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
            <span style={{ fontSize: 14, opacity: 0.6 }}>♫</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{f.size_mb} MB</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Analysis Tab ───────────────────────────────────────────────────────────────
function AnalysisTab({ addServerLog }) {
  const [jobId, setJobId] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadAnalysis = async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/status/${jobId}`);
      const data = await res.json();
      if (data.result) setResult(data.result);
    } catch {}
    setLoading(false);
  };

  return (
    <div style={{ padding: 12 }}>
      <SectionLabel>Load Analysis</SectionLabel>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <input className="input" placeholder="Job ID or filename_mp3" value={jobId}
          onChange={e => setJobId(e.target.value)} style={{ flex: 1, fontSize: 11 }} />
        <button className="btn primary" onClick={loadAnalysis} style={{ fontSize: 10 }}>Load</button>
      </div>

      {result && (
        <div style={{ animation: "fade-in 0.2s ease" }}>
          {/* Key stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[
              ["BPM", `${result.bpm} (${Math.round(result.bpm_confidence * 100)}% conf)`, "#00d4ff"],
              ["Key", result.key, "#8b5cf6"],
              ["Mood", result.mood, "#f59e0b"],
              ["Duration", `${Math.floor(result.duration/60)}:${String(Math.floor(result.duration%60)).padStart(2,"0")}`, "#10b981"],
              ["Beats", result.beat_count, "#00d4ff"],
              ["Sections", result.section_count, "#f97316"],
            ].map(([label, value, color]) => (
              <div key={label} style={{ padding: "8px 10px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color, fontFamily: "var(--font-mono)" }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Sections */}
          <SectionLabel>Sections</SectionLabel>
          {result.sections?.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, padding: "5px 8px", background: "var(--bg-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
              <div style={{ width: 40, height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${s.energy * 100}%`, height: "100%", background: `hsl(${200 - s.energy * 120}, 80%, 55%)`, borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", width: 28 }}>
                {Math.floor(s.start/60)}:{String(Math.floor(s.start%60)).padStart(2,"0")}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-primary)", flex: 1, textTransform: "capitalize" }}>{s.label}</span>
              <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{Math.round(s.energy * 100)}%</span>
            </div>
          ))}

          {/* Energy waveform */}
          <SectionLabel>Energy Profile</SectionLabel>
          <EnergyWaveform data={result.energy_profile} bassData={result.bass_profile} />

          {/* Beat preview */}
          <SectionLabel>Beat Map (first 32)</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            {result.beats?.slice(0, 32).map((b, i) => (
              <div key={i} style={{
                width: 14, height: 14, borderRadius: 2,
                background: b.type === "downbeat" ? "var(--accent)" : b.type === "beat" ? "rgba(0,212,255,0.4)" : "var(--border)",
                title: `${b.time}s`,
              }} />
            ))}
          </div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
            ■ Downbeat &nbsp; ▪ Beat &nbsp; · Weak
          </div>
        </div>
      )}

      {!result && !loading && (
        <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: 11 }}>
          Upload an audio file first, then enter the job ID here
        </div>
      )}
    </div>
  );
}

// ── Sync Tab ───────────────────────────────────────────────────────────────────
function SyncTab({ bpm, addServerLog }) {
  const [analysisId, setAnalysisId] = useState(() => localStorage.getItem("aquaflow_last_job_id") || "");
  const [bpmOverride, setBpmOverride] = useState("");
  const [includeFlame, setIncludeFlame] = useState(false);
  const [includeFog, setIncludeFog] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const { loadShow, currentShow } = useShowStore();

  const sync = async () => {
    if (!analysisId) { setError("Enter an analysis ID first"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/sync-to-show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis_id: analysisId,
          bpm_override: bpmOverride ? parseFloat(bpmOverride) : null,
          include_flame: includeFlame,
          include_fog: includeFog,
        }),
      });
      if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
      const data = await res.json();
      setResult(data);
      addServerLog({ level: "info", msg: `Show synced to audio: ${data.audio?.filename}` });
    } catch (e) {
      setError(e.message);
      addServerLog({ level: "warn", msg: `Sync failed: ${e.message}` });
    } finally {
      setLoading(false);
    }
  };

  const applyToTimeline = () => {
    if (!result) return;
    loadShow({
      timelineTracks: result.tracks,
      currentShow: { ...currentShow, ...result.show },
    });
    addServerLog({ level: "info", msg: `Applied audio-synced show to timeline` });
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>
        Synchronize your show to uploaded audio. The timeline will be auto-generated with clips aligned to beats and song sections.
      </div>

      <SectionLabel>Analysis ID</SectionLabel>
      <input className="input" placeholder="From upload job (e.g. mysong_mp3)"
        value={analysisId} onChange={e => setAnalysisId(e.target.value)}
        style={{ marginBottom: 10, fontSize: 11 }} />

      <SectionLabel>BPM Override (optional)</SectionLabel>
      <input className="input" type="number" placeholder={`Auto-detected (current: ${bpm})`}
        value={bpmOverride} onChange={e => setBpmOverride(e.target.value)}
        style={{ marginBottom: 10, fontSize: 11, fontFamily: "var(--font-mono)" }} />

      <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
        <Toggle label="🔥 Include Flame" value={includeFlame} onChange={setIncludeFlame} />
        <Toggle label="≈ Include Fog"   value={includeFog}   onChange={setIncludeFog} />
      </div>

      <button className="btn primary" onClick={sync} disabled={loading}
        style={{ width: "100%", justifyContent: "center", fontSize: 12, padding: "8px", marginBottom: 10 }}>
        {loading ? "⟳ Syncing to audio..." : "♫ Sync Show to Audio"}
      </button>

      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "var(--radius-sm)", color: "var(--red)", fontSize: 11, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ animation: "fade-in 0.2s ease" }}>
          <div style={{ padding: "10px 12px", background: "rgba(0,212,255,0.05)", border: "1px solid var(--border-accent)", borderRadius: "var(--radius-md)", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
              {result.show?.name}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {result.show?.notes}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <Tag label={`${result.audio?.bpm} BPM`} accent />
              <Tag label={result.audio?.key} />
              <Tag label={result.audio?.mood} />
              <Tag label={`${result.tracks?.length} tracks`} />
            </div>
          </div>
          <button className="btn primary" onClick={applyToTimeline}
            style={{ width: "100%", justifyContent: "center", fontSize: 11, padding: "7px" }}>
            ↓ Apply to Timeline
          </button>
        </div>
      )}
    </div>
  );
}

// ── Player Tab ─────────────────────────────────────────────────────────────────
function PlayerTab() {
  const [files, setFiles] = useState([]);
  const [playing, setPlaying] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/list`).then(r => r.json()).then(d => setFiles(d.files || [])).catch(() => {});
  }, []);

  const play = (filename) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(`${API}/stream/${encodeURIComponent(filename)}`);
    audio.play().catch(() => {});
    audioRef.current = audio;
    setPlaying(filename);
    audio.onended = () => setPlaying(null);
  };

  const stop = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setPlaying(null);
  };

  return (
    <div style={{ padding: 12 }}>
      <SectionLabel>Audio Files</SectionLabel>
      {files.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>
          No audio files. Upload one in the Upload tab.
        </div>
      ) : (
        files.map((f, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", marginBottom: 5, background: playing === f.filename ? "rgba(0,212,255,0.06)" : "var(--bg-surface)", border: `1px solid ${playing === f.filename ? "var(--border-accent)" : "var(--border)"}`, borderRadius: "var(--radius-sm)" }}>
            <button onClick={() => playing === f.filename ? stop() : play(f.filename)}
              style={{ width: 24, height: 24, borderRadius: "50%", background: playing === f.filename ? "var(--accent)" : "var(--bg-raised)", border: `1px solid ${playing === f.filename ? "var(--accent)" : "var(--border)"}`, color: playing === f.filename ? "var(--bg-void)" : "var(--text-primary)", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {playing === f.filename ? "⏹" : "▶"}
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{f.size_mb} MB</div>
            </div>
            {playing === f.filename && (
              <div style={{ display: "flex", gap: 2 }}>
                {[3,5,7,4,6].map((h, i) => (
                  <div key={i} style={{ width: 3, height: h * 2, background: "var(--accent)", borderRadius: 1, animation: `pulse-glow ${0.4 + i * 0.1}s ease-in-out infinite` }} />
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ── Energy Waveform ────────────────────────────────────────────────────────────
function EnergyWaveform({ data, bassData }) {
  if (!data || !data.length) return null;
  const W = 280, H = 50;
  const step = W / data.length;
  const basePath = data.map((v, i) => `${i === 0 ? "M" : "L"}${i * step},${H - v * H}`).join(" ") + ` L${W},${H} L0,${H} Z`;
  const bassPath = bassData?.map((v, i) => `${i === 0 ? "M" : "L"}${i * step},${H - v * H * 0.7}`).join(" ") || "";
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginBottom: 8 }}>
      <path d={basePath} fill="rgba(0,212,255,0.15)" stroke="rgba(0,212,255,0.4)" strokeWidth="0.8" />
      {bassPath && <path d={bassPath + ` L${W},${H} L0,${H} Z`} fill="rgba(139,92,246,0.1)" stroke="rgba(139,92,246,0.3)" strokeWidth="0.6" />}
    </svg>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 9, fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 7, marginTop: 12, borderBottom: "1px solid var(--border)", paddingBottom: 3 }}>
      {children}
    </div>
  );
}

function Tag({ label, accent }) {
  return (
    <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", padding: "1px 6px", borderRadius: 3, background: accent ? "rgba(0,212,255,0.1)" : "var(--bg-raised)", color: accent ? "var(--accent)" : "var(--text-muted)", border: `1px solid ${accent ? "rgba(0,212,255,0.2)" : "var(--border)"}` }}>
      {label}
    </span>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => onChange(!value)}>
      <div style={{ width: 28, height: 14, borderRadius: 7, background: value ? "rgba(0,212,255,0.2)" : "var(--bg-raised)", border: `1px solid ${value ? "var(--accent)" : "var(--border)"}`, position: "relative", transition: "all 0.15s" }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: value ? "var(--accent)" : "var(--text-muted)", position: "absolute", top: 2, left: value ? 16 : 2, transition: "left 0.15s" }} />
      </div>
      <span style={{ fontSize: 10, color: value ? "var(--text-primary)" : "var(--text-muted)" }}>{label}</span>
    </div>
  );
}
