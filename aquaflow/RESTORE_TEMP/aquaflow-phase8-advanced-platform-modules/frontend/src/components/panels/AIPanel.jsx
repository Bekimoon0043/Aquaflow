import { useState } from "react";
import { useShowStore } from "../../store/showStore";
import { API_BASE_URL } from "../../config";

const API = `${API_BASE_URL}/ai`;

const MOODS = ["energetic", "calm", "dramatic", "cinematic", "playful"];
const MOOD_ICONS = { energetic: "⚡", calm: "〰", dramatic: "🎭", cinematic: "🎬", playful: "✦" };

export default function AIPanel() {
  const [tab, setTab] = useState("generate"); // generate | pattern | enhance | optimize
  const { currentShow, timelineTracks, addServerLog, applyPatternToTrack } = useShowStore();
  const { loadShow } = useShowStore();

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>✨</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          AI Choreography
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", flexShrink: 0 }}>
        {[["generate", "Generate"], ["pattern", "Pattern"], ["enhance", "Enhance"], ["optimize", "Optimize"]].map(([key, label]) => (
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

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {tab === "generate" && <GenerateTab show={currentShow} onGenerate={(tracks, show) => {
          loadShow({ timelineTracks: tracks, currentShow: { ...currentShow, ...show } });
          addServerLog({ level: "info", msg: `AI generated show: ${show.name}` });
        }} />}
        {tab === "pattern" && <PatternTab bpm={currentShow.bpm} onApply={(clips, type) => {
          applyPatternToTrack(type, clips);
          addServerLog({ level: "info", msg: `AI pattern applied to ${type} track` });
        }} />}
        {tab === "enhance" && <EnhanceTab tracks={timelineTracks} bpm={currentShow.bpm} />}
        {tab === "optimize" && <OptimizeTab tracks={timelineTracks} bpm={currentShow.bpm} />}
      </div>
    </div>
  );
}

// ── Generate Tab ───────────────────────────────────────────────────────────────
function GenerateTab({ show, onGenerate }) {
  const [prompt, setPrompt] = useState("");
  const [mood, setMood] = useState("energetic");
  const [duration, setDuration] = useState(show.duration || 120);
  const [bpm, setBpm] = useState(show.bpm || 128);
  const [includeFlame, setIncludeFlame] = useState(false);
  const [includeLaser, setIncludeLaser] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const EXAMPLE_PROMPTS = [
    "Dramatic cinematic show with aggressive central jets and flame bursts",
    "Gentle ambient water ballet with soft blue lighting",
    "High-energy music festival fountain with synchronized RGB lighting",
    "Romantic evening display with flowing arcs and warm amber lights",
  ];

  const generate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, mood, duration: parseFloat(duration), bpm: parseFloat(bpm), include_flame: includeFlame, include_laser: includeLaser }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setResult(data);
    } catch (e) {
      // Offline fallback — generate locally
      setResult(generateOffline(prompt, mood, parseFloat(bpm), parseFloat(duration)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <SectionLabel>Describe your show</SectionLabel>
      <textarea
        value={prompt} onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. Generate a 2-minute dramatic fountain show with aggressive central jets, synchronized flame bursts at the chorus, and deep blue lighting..."
        style={{
          width: "100%", height: 72, background: "var(--bg-void)", border: "1px solid var(--border-mid)",
          borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontFamily: "var(--font-body)",
          fontSize: 11, padding: "8px", resize: "none", outline: "none", lineHeight: 1.5,
        }}
      />

      {/* Example prompts */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10, marginTop: 4 }}>
        {EXAMPLE_PROMPTS.map((p, i) => (
          <button key={i} onClick={() => setPrompt(p)} style={{
            fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)",
            background: "var(--bg-raised)", border: "1px solid var(--border)",
            borderRadius: 3, padding: "2px 6px", cursor: "pointer",
          }}>
            {p.slice(0, 28)}...
          </button>
        ))}
      </div>

      <SectionLabel>Mood</SectionLabel>
      <div style={{ display: "flex", gap: 5, marginBottom: 10, flexWrap: "wrap" }}>
        {MOODS.map((m) => (
          <button key={m} onClick={() => setMood(m)} style={{
            padding: "4px 10px", borderRadius: "var(--radius-sm)", fontSize: 10, cursor: "pointer",
            background: mood === m ? "rgba(0,212,255,0.1)" : "var(--bg-raised)",
            border: `1px solid ${mood === m ? "var(--accent)" : "var(--border)"}`,
            color: mood === m ? "var(--text-accent)" : "var(--text-muted)",
          }}>
            {MOOD_ICONS[m]} {m}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 3 }}>DURATION (s)</div>
          <input className="input" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} style={{ fontSize: 12, fontFamily: "var(--font-mono)" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 3 }}>BPM</div>
          <input className="input" type="number" value={bpm} onChange={(e) => setBpm(e.target.value)} style={{ fontSize: 12, fontFamily: "var(--font-mono)" }} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <Toggle label="🔥 Flame" value={includeFlame} onChange={setIncludeFlame} />
        <Toggle label="✸ Laser" value={includeLaser} onChange={setIncludeLaser} />
      </div>

      <button className="btn primary" onClick={generate} disabled={loading}
        style={{ width: "100%", justifyContent: "center", fontSize: 12, padding: "8px" }}>
        {loading ? "⟳ Generating..." : "✨ Generate Show"}
      </button>

      {error && <div style={{ marginTop: 8, fontSize: 10, color: "var(--red)", fontFamily: "var(--font-mono)" }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 12, animation: "fade-in 0.2s ease" }}>
          <div style={{ padding: "10px 12px", background: "rgba(0,212,255,0.05)", border: "1px solid var(--border-accent)", borderRadius: "var(--radius-md)", marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
              {result.show?.name || "Generated Show"}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {result.show?.notes}
            </div>
            {result.analysis && (
              <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Tag label={`${result.analysis.beat_count} beats`} />
                <Tag label={`${result.analysis.sections?.length} sections`} />
                <Tag label={result.analysis.key} />
                <Tag label={result.analysis.mood} accent />
              </div>
            )}
          </div>

          <div style={{ marginBottom: 8 }}>
            <SectionLabel>Generated Tracks ({result.tracks?.length})</SectionLabel>
            {result.tracks?.map((track) => (
              <div key={track.id} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", marginBottom: 4,
                background: "var(--bg-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: track.color, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 11, color: "var(--text-primary)" }}>{track.label}</span>
                <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                  {track.clips?.length} clips
                </span>
              </div>
            ))}
          </div>

          <button className="btn primary" onClick={() => onGenerate(result.tracks, result.show)}
            style={{ width: "100%", justifyContent: "center", fontSize: 11, padding: "7px" }}>
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
  const [pattern, setPattern] = useState("cascade");
  const [intensity, setIntensity] = useState(80);
  const [duration, setDuration] = useState(32);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const DEVICE_TYPES = ["pump", "valve", "lighting", "flame", "fog"];
  const PATTERNS = ["cascade", "burst", "wave", "pulse", "random"];
  const PATTERN_DESC = {
    cascade: "Gradually building clips",
    burst:   "Short sharp bursts on beats",
    wave:    "Sine wave intensity variation",
    pulse:   "Rapid on/off pulses",
    random:  "Randomized timing",
  };

  const generate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/generate-pattern`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_type: deviceType, pattern, intensity, duration: parseFloat(duration), bpm }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult(generatePatternOffline(deviceType, pattern, intensity, parseFloat(duration), bpm));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <SectionLabel>Device Type</SectionLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
        {DEVICE_TYPES.map((t) => (
          <button key={t} onClick={() => setDeviceType(t)} style={{
            padding: "3px 10px", fontSize: 10, cursor: "pointer",
            background: deviceType === t ? "rgba(0,212,255,0.1)" : "var(--bg-raised)",
            border: `1px solid ${deviceType === t ? "var(--accent)" : "var(--border)"}`,
            color: deviceType === t ? "var(--text-accent)" : "var(--text-muted)",
            borderRadius: "var(--radius-sm)",
          }}>
            {t}
          </button>
        ))}
      </div>

      <SectionLabel>Pattern</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
        {PATTERNS.map((p) => (
          <button key={p} onClick={() => setPattern(p)} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "6px 10px", fontSize: 11, cursor: "pointer",
            background: pattern === p ? "rgba(0,212,255,0.08)" : "var(--bg-surface)",
            border: `1px solid ${pattern === p ? "var(--border-accent)" : "var(--border)"}`,
            color: pattern === p ? "var(--text-primary)" : "var(--text-secondary)",
            borderRadius: "var(--radius-sm)",
          }}>
            <span style={{ textTransform: "capitalize", fontWeight: pattern === p ? 600 : 400 }}>{p}</span>
            <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{PATTERN_DESC[p]}</span>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 3 }}>INTENSITY %</div>
          <input className="input" type="number" value={intensity} min={10} max={100}
            onChange={(e) => setIntensity(parseInt(e.target.value))}
            style={{ fontSize: 12, fontFamily: "var(--font-mono)" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 3 }}>DURATION (s)</div>
          <input className="input" type="number" value={duration}
            onChange={(e) => setDuration(e.target.value)}
            style={{ fontSize: 12, fontFamily: "var(--font-mono)" }} />
        </div>
      </div>

      <button className="btn primary" onClick={generate} disabled={loading}
        style={{ width: "100%", justifyContent: "center", fontSize: 11, padding: "7px" }}>
        {loading ? "⟳ Generating..." : "✦ Generate Pattern"}
      </button>

      {result && (
        <div style={{ marginTop: 10, padding: "10px 12px", background: "rgba(0,212,255,0.05)", border: "1px solid var(--border-accent)", borderRadius: "var(--radius-md)" }}>
          <div style={{ fontSize: 11, color: "var(--text-primary)", marginBottom: 4 }}>
            {result.clip_count} clips generated · {result.pattern} pattern
          </div>
          <button className="btn" onClick={() => onApply(result.clips, result.device_type)}
            style={{ width: "100%", justifyContent: "center", fontSize: 10, marginTop: 6 }}>
            ↓ Apply to {result.device_type} track
          </button>
        </div>
      )}
    </div>
  );
}

// ── Enhance Tab ────────────────────────────────────────────────────────────────
function EnhanceTab({ tracks, bpm }) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(null);

  const enhance = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/enhance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks, bpm }),
      });
      const data = await res.json();
      setSuggestions(data.suggestions);
    } catch {
      setSuggestions([
        "Add flame bursts at chorus sections for dramatic effect",
        "Add atmospheric fog during intro and outro sections",
        "Increase pump intensity peaks for more visual impact",
        "Enable energy optimization to reduce idle consumption by ~15%",
        "Consider 1/8 note valve patterns for tight beat sync",
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>
        Analyze your current show and get AI suggestions to improve the choreography, timing, and visual impact.
      </div>

      <div style={{ padding: "8px 10px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>CURRENT SHOW</div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{tracks.length} tracks · {bpm} BPM</div>
      </div>

      <button className="btn primary" onClick={enhance} disabled={loading}
        style={{ width: "100%", justifyContent: "center", fontSize: 11, padding: "7px", marginBottom: 12 }}>
        {loading ? "⟳ Analyzing..." : "🔍 Analyze Show"}
      </button>

      {suggestions && (
        <div style={{ animation: "fade-in 0.2s ease" }}>
          <SectionLabel>Suggestions ({suggestions.length})</SectionLabel>
          {suggestions.map((s, i) => (
            <div key={i} style={{
              display: "flex", gap: 8, padding: "8px 10px", marginBottom: 6,
              background: "var(--bg-surface)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
            }}>
              <span style={{ color: "var(--accent)", fontSize: 10, flexShrink: 0, marginTop: 1 }}>✦</span>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>{s}</span>
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
  const [result, setResult] = useState(null);

  const optimize = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/optimize-energy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks, bpm }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({
        estimated_savings: "18%",
        optimizations: [{ track: "Master Pump Array", action: "Reduce 3 idle clips from 30% to 15%", savings_pct: 8 }],
        recommendations: [
          "Use VFD speed ramping instead of instant on/off for pumps",
          "Stagger jet start times to reduce peak current draw",
        ],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>
        Optimize power consumption across all devices while maintaining visual quality.
      </div>

      <button className="btn primary" onClick={optimize} disabled={loading}
        style={{ width: "100%", justifyContent: "center", fontSize: 11, padding: "7px", marginBottom: 12 }}>
        {loading ? "⟳ Optimizing..." : "⚡ Optimize Energy"}
      </button>

      {result && (
        <div style={{ animation: "fade-in 0.2s ease" }}>
          <div style={{ padding: "10px 12px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "var(--radius-md)", marginBottom: 10 }}>
            <div style={{ fontSize: 18, fontFamily: "var(--font-mono)", color: "var(--green)", fontWeight: 700 }}>{result.estimated_savings}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Estimated energy savings</div>
          </div>
          {result.optimizations?.map((o, i) => (
            <div key={i} style={{ padding: "7px 10px", marginBottom: 5, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-primary)" }}>{o.track}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{o.action}</div>
            </div>
          ))}
          <SectionLabel>Recommendations</SectionLabel>
          {result.recommendations?.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 5, fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              <span style={{ color: "var(--green)" }}>→</span> {r}
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
      <div style={{ width: 32, height: 16, borderRadius: 8, background: value ? "rgba(0,212,255,0.2)" : "var(--bg-raised)", border: `1px solid ${value ? "var(--accent)" : "var(--border)"}`, position: "relative", transition: "all 0.15s" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: value ? "var(--accent)" : "var(--text-muted)", position: "absolute", top: 2, left: value ? 18 : 2, transition: "left 0.15s" }} />
      </div>
      <span style={{ fontSize: 10, color: value ? "var(--text-primary)" : "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

// Offline fallback generators
function generateOffline(prompt, mood, bpm, duration) {
  const sections = [
    { label: "Intro", start: 0, end: duration * 0.1, energy: 0.3 },
    { label: "Verse", start: duration * 0.1, end: duration * 0.4, energy: 0.6 },
    { label: "Chorus", start: duration * 0.4, end: duration * 0.7, energy: 1.0 },
    { label: "Finale", start: duration * 0.7, end: duration, energy: 0.8 },
  ];
  const tracks = [
    { id: "off-pump", label: "Pump Array", type: "pump", color: "#00d4ff", deviceId: "pump-01",
      clips: sections.map((s, i) => ({ id: `op-${i}`, start: Math.round(s.start), end: Math.round(s.end), intensity: Math.round(s.energy * 100), label: s.label })) },
    { id: "off-light", label: "RGB Lighting", type: "lighting", color: "#f59e0b", deviceId: "light-01",
      clips: sections.map((s, i) => ({ id: `ol-${i}`, start: Math.round(s.start), end: Math.round(s.end), intensity: Math.round(s.energy * 100), label: s.label })) },
  ];
  return { show: { name: `AI Show (${mood})`, bpm, duration, notes: `Generated offline at ${bpm} BPM, ${mood} mood.` }, tracks, analysis: { beat_count: Math.round(bpm * duration / 60), sections: sections.length, key: "A minor", mood } };
}

function generatePatternOffline(deviceType, pattern, intensity, duration, bpm) {
  const beatInterval = 60.0 / bpm;
  const clips = [];
  let t = 0, id = 0;
  const step = pattern === "burst" ? beatInterval * 4 : pattern === "pulse" ? beatInterval * 0.5 : beatInterval * 2;
  while (t < duration) {
    clips.push({ id: `pat-${id++}`, start: Math.round(t * 100) / 100, end: Math.round((t + step * 0.85) * 100) / 100, intensity, label: pattern.charAt(0).toUpperCase() + pattern.slice(1) });
    t += step;
  }
  return { device_type: deviceType, pattern, clips, clip_count: clips.length, bpm, duration };
}
