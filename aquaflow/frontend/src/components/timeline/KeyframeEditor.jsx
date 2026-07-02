import { useState, useRef, useEffect, useCallback } from "react";
import { useShowStore } from "../../store/showStore";

const CHANNELS = [
  { key:"pump",    label:"Pump",    color:"#00aaff" },
  { key:"valve",   label:"Valve",   color:"#00ccaa" },
  { key:"lighting",label:"Lighting",color:"#ffcc00" },
  { key:"flame",   label:"Flame",   color:"#ff6600" },
  { key:"fog",     label:"Fog",     color:"#aabbcc" },
  { key:"laser",   label:"Laser",   color:"#ff00ff" },
];

const EASINGS = [
  { key:"linear",   label:"Linear" },
  { key:"ease-in",  label:"Ease In" },
  { key:"ease-out", label:"Ease Out" },
  { key:"ease-both",label:"Ease Both" },
  { key:"step",     label:"Step" },
];

function applyEasing(t, easing) {
  switch(easing) {
    case "ease-in":   return t * t;
    case "ease-out":  return 1 - (1-t)*(1-t);
    case "ease-both": return t < 0.5 ? 2*t*t : 1-2*(1-t)*(1-t);
    case "step":      return t < 0.5 ? 0 : 1;
    default:          return t;
  }
}

function interpolateKeyframes(kfs, t) {
  if (!kfs || kfs.length === 0) return 0;
  if (kfs.length === 1) return kfs[0].value;
  const sorted = [...kfs].sort((a,b) => a.t - b.t);
  if (t <= sorted[0].t) return sorted[0].value;
  if (t >= sorted[sorted.length-1].t) return sorted[sorted.length-1].value;
  for (let i = 0; i < sorted.length-1; i++) {
    if (t >= sorted[i].t && t <= sorted[i+1].t) {
      const frac = (t - sorted[i].t) / (sorted[i+1].t - sorted[i].t);
      const eased = applyEasing(frac, sorted[i].easing || "linear");
      return sorted[i].value + (sorted[i+1].value - sorted[i].value) * eased;
    }
  }
  return 0;
}

export default function KeyframeEditor({ clipId, durationMs = 4000 }) {
  const W = 560, H = 140, PAD = 20;
  const svgRef = useRef(null);
  const [activeChannel, setActiveChannel] = useState("pump");
  const [keyframes, setKeyframes] = useState({
    pump:     [{ t:0, value:0, easing:"ease-in" }, { t:0.5, value:0.8, easing:"ease-out" }, { t:1, value:0 }],
    valve:    [{ t:0, value:0 }, { t:0.4, value:1.0, easing:"linear" }, { t:1, value:0 }],
    lighting: [{ t:0, value:0.5 }, { t:1, value:0.5 }],
    flame:    [{ t:0, value:0 }, { t:1, value:0 }],
    fog:      [{ t:0, value:0.3 }, { t:0.5, value:0.6 }, { t:1, value:0.3 }],
    laser:    [{ t:0, value:0 }, { t:1, value:0 }],
  });
  const [dragging, setDragging] = useState(null);
  const [selectedKf, setSelectedKf] = useState(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const animRef = useRef(null);
  const lastTimeRef = useRef(null);

  const ch = CHANNELS.find(c => c.key === activeChannel);
  const kfs = keyframes[activeChannel] || [];

  // Convert keyframe t (0-1) to SVG x
  const tx = t => PAD + t * (W - PAD*2);
  const vy = v => H - PAD - v * (H - PAD*2);
  // Convert SVG coords back
  const xt = x => Math.max(0, Math.min(1, (x - PAD) / (W - PAD*2)));
  const yv = y => Math.max(0, Math.min(1, (H - PAD - y) / (H - PAD*2)));

  // Build path
  const buildPath = (kfList, color) => {
    if (kfList.length === 0) return null;
    const sorted = [...kfList].sort((a,b) => a.t - b.t);
    const steps = 80;
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const v = interpolateKeyframes(sorted, t);
      const x = tx(t), y = vy(v);
      d += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
    }
    return <path d={d} stroke={color} strokeWidth="2" fill="none" opacity="0.9" />;
  };

  const onSvgMouseDown = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    const t = xt(x), v = yv(y);

    // Check if clicking near existing keyframe
    const hit = kfs.findIndex(kf => Math.abs(tx(kf.t) - tx(t)) < 10 && Math.abs(vy(kf.value) - vy(v)) < 10);
    if (hit >= 0) {
      setDragging(hit);
      setSelectedKf(hit);
    } else {
      // Add new keyframe
      const newKf = { t: Math.round(t * 100) / 100, value: Math.round(v * 100) / 100, easing: "linear" };
      const updated = [...kfs, newKf].sort((a,b) => a.t - b.t);
      setKeyframes(prev => ({ ...prev, [activeChannel]: updated }));
      setSelectedKf(updated.findIndex(k => k.t === newKf.t));
    }
  };

  const onSvgMouseMove = useCallback((e) => {
    if (dragging === null) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    const t = Math.round(xt(x) * 100) / 100;
    const v = Math.round(yv(y) * 100) / 100;
    setKeyframes(prev => {
      const updated = [...prev[activeChannel]];
      updated[dragging] = { ...updated[dragging], t, value: v };
      return { ...prev, [activeChannel]: updated };
    });
  }, [dragging, activeChannel]);

  const onSvgMouseUp = () => setDragging(null);

  const deleteSelected = () => {
    if (selectedKf === null || kfs.length <= 2) return;
    const updated = kfs.filter((_, i) => i !== selectedKf);
    setKeyframes(prev => ({ ...prev, [activeChannel]: updated }));
    setSelectedKf(null);
  };

  const setEasing = (easing) => {
    if (selectedKf === null) return;
    setKeyframes(prev => {
      const updated = [...prev[activeChannel]];
      updated[selectedKf] = { ...updated[selectedKf], easing };
      return { ...prev, [activeChannel]: updated };
    });
  };

  // Playhead animation
  useEffect(() => {
    if (!playing) { cancelAnimationFrame(animRef.current); return; }
    const tick = (ts) => {
      if (!lastTimeRef.current) lastTimeRef.current = ts;
      const delta = (ts - lastTimeRef.current) / durationMs;
      lastTimeRef.current = ts;
      setPlayhead(p => {
        const next = p + delta;
        if (next >= 1) { setPlaying(false); return 0; }
        return next;
      });
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(animRef.current); lastTimeRef.current = null; };
  }, [playing, durationMs]);

  const selectedKfData = selectedKf !== null ? kfs[selectedKf] : null;

  return (
    <div style={{ background:"#040810", color:"#cce8ff", fontFamily:"monospace", fontSize:"11px", padding:12, height:"100%" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <span style={{ color:"#ffcc00", fontWeight:"bold", fontSize:12 }}>◈ KEYFRAME EDITOR</span>
        {clipId && <span style={{ color:"#334455", fontSize:9 }}>clip: {clipId}</span>}
        <div style={{ flex:1 }}/>
        <button onClick={()=>{ setPlayhead(0); setPlaying(p=>!p); }} style={{
          padding:"3px 10px", background: playing?"#1a0a0a":"#0a1520",
          color: playing?"#ff4444":"#00ff88",
          border:`1px solid ${playing?"#ff444444":"#00ff8844"}`,
          borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:10,
        }}>{playing ? "■ STOP" : "▶ PREVIEW"}</button>
        <button onClick={deleteSelected} disabled={selectedKf===null} style={{
          padding:"3px 8px", background:"#1a0808", color:"#ff4444",
          border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:10,
          opacity: selectedKf===null ? 0.3 : 1,
        }}>✕ DELETE KF</button>
      </div>

      {/* Channel tabs */}
      <div style={{ display:"flex", gap:4, marginBottom:8, flexWrap:"wrap" }}>
        {CHANNELS.map(c => (
          <button key={c.key} onClick={()=>setActiveChannel(c.key)} style={{
            padding:"3px 8px", background: activeChannel===c.key ? `${c.color}22` : "#0a1825",
            color: activeChannel===c.key ? c.color : "#556677",
            border:`1px solid ${activeChannel===c.key ? `${c.color}44` : "#0a2030"}`,
            borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:10,
          }}>{c.label}</button>
        ))}
      </div>

      {/* SVG curve editor */}
      <div style={{ border:"1px solid #0a2030", borderRadius:6, background:"#020608", marginBottom:8, overflow:"hidden" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width:"100%", height:H, cursor:"crosshair", display:"block" }}
          onMouseDown={onSvgMouseDown}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseLeave={onSvgMouseUp}
        >
          {/* Grid */}
          {[0,0.25,0.5,0.75,1].map(v => (
            <line key={v} x1={PAD} y1={vy(v)} x2={W-PAD} y2={vy(v)} stroke="#0a2030" strokeWidth="1" />
          ))}
          {[0,0.25,0.5,0.75,1].map(t => (
            <line key={t} x1={tx(t)} y1={PAD} x2={tx(t)} y2={H-PAD} stroke="#0a2030" strokeWidth="1" />
          ))}
          {/* Grid labels */}
          {[0,0.25,0.5,0.75,1].map(v => (
            <text key={v} x={PAD-2} y={vy(v)+4} fill="#334455" fontSize="9" textAnchor="end">{Math.round(v*100)}%</text>
          ))}

          {/* All channel curves (background) */}
          {CHANNELS.filter(c => c.key !== activeChannel).map(c => (
            <g key={c.key} opacity="0.2">
              {buildPath(keyframes[c.key] || [], c.color)}
            </g>
          ))}

          {/* Active channel curve */}
          {buildPath(kfs, ch.color)}

          {/* Keyframe handles */}
          {kfs.map((kf, i) => (
            <g key={i}>
              <circle
                cx={tx(kf.t)} cy={vy(kf.value)} r={selectedKf===i ? 7 : 5}
                fill={selectedKf===i ? ch.color : "#0a1825"}
                stroke={ch.color} strokeWidth="2"
                style={{ cursor:"grab" }}
              />
              {selectedKf===i && (
                <text x={tx(kf.t)} y={vy(kf.value)-10} fill={ch.color} fontSize="9" textAnchor="middle">
                  t={Math.round(kf.t*100)}% v={Math.round(kf.value*100)}%
                </text>
              )}
            </g>
          ))}

          {/* Playhead */}
          <line x1={tx(playhead)} y1={PAD} x2={tx(playhead)} y2={H-PAD} stroke="#ff4444" strokeWidth="1.5" opacity="0.8" />
          <circle cx={tx(playhead)} cy={PAD} r={4} fill="#ff4444" />

          {/* Current value indicator */}
          <circle
            cx={tx(playhead)}
            cy={vy(interpolateKeyframes(kfs, playhead))}
            r={4} fill="#ff4444" opacity="0.8"
          />
        </svg>
      </div>

      {/* Easing + value editor for selected keyframe */}
      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        {selectedKfData ? (
          <>
            <span style={{ color:"#556677", fontSize:9 }}>EASING:</span>
            {EASINGS.map(e => (
              <button key={e.key} onClick={()=>setEasing(e.key)} style={{
                padding:"2px 7px", fontSize:9, fontFamily:"monospace",
                background: selectedKfData.easing===e.key ? "#002030":"#0a1825",
                color: selectedKfData.easing===e.key ? "#00aaff":"#556677",
                border:`1px solid ${selectedKfData.easing===e.key?"#00aaff44":"#0a2030"}`,
                borderRadius:3, cursor:"pointer",
              }}>{e.label}</button>
            ))}
            <span style={{ color:"#334455", marginLeft:8, fontSize:9 }}>
              t={Math.round(selectedKfData.t*100)}% · v={Math.round(selectedKfData.value*100)}%
            </span>
          </>
        ) : (
          <span style={{ color:"#223344", fontSize:9 }}>Click on the curve to add a keyframe · drag handles to adjust</span>
        )}
      </div>

      {/* Live values */}
      <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap" }}>
        {CHANNELS.map(c => (
          <div key={c.key} style={{ display:"flex", alignItems:"center", gap:4 }}>
            <span style={{ color:c.color, fontSize:9 }}>{c.label}</span>
            <div style={{ width:40, height:3, background:"#0a1825", borderRadius:2, overflow:"hidden" }}>
              <div style={{ width:`${Math.round(interpolateKeyframes(keyframes[c.key]||[], playhead)*100)}%`, height:"100%", background:c.color }} />
            </div>
            <span style={{ color:"#334455", fontSize:9, width:24 }}>{Math.round(interpolateKeyframes(keyframes[c.key]||[], playhead)*100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { interpolateKeyframes, applyEasing };
