/**
 * PatternDesignerPanel.jsx — Manual Fountain Pattern Designer  v2
 *
 * MERGED: preserves all Phase 14 code from other developers.
 * ADDED (Phase 15):
 *   Tab 1 — Nozzle Map   : per-nozzle live intensity top-view
 *   Tab 2 — DMX Patch    : fixture → universe / channel mapping UI
 *   Tab 3 — Recording    : capture pattern session → timeline clips
 *   Save / Load patterns : POST/GET /api/patterns
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useShowStore } from "../../store/showStore";
import useEngineeringStore from "../../store/engineeringStore";
import { API_BASE_URL } from "../../config";
import NozzleMap from "./NozzleMap";
import { DEFAULT_DEVICE_GROUPS } from "../../utils/deviceGroupSelector";
import { resolveFixtureGroup, fixturePlanCoords } from "../../hooks/fixtureTypeMap";
import ICANSiteDesignStudio from "./ICANSiteDesignStudio";

const API        = `${API_BASE_URL}/devices`;
const PATTERN_API = API_BASE_URL; // base for /api/patterns, /api/dmx-map, etc.

// ─── constants (unchanged from original) ─────────────────────────────────────

const PATTERNS = [
  { key:"wave",      label:"Wave",      icon:"〰" },
  { key:"pulse",     label:"Pulse",     icon:"◎" },
  { key:"chase",     label:"Chase",     icon:"→" },
  { key:"burst",     label:"Burst",     icon:"✦" },
  { key:"ripple",    label:"Ripple",    icon:"≋" },
  { key:"spiral",    label:"Spiral",    icon:"◌" },
  { key:"alternate", label:"Alternate", icon:"⇌" },
  { key:"firework",  label:"Firework",  icon:"✸" },
  { key:"manual",    label:"Manual",    icon:"◈" },
];

const DEVICE_COLORS = {
  pump:"#00d4ff", valve:"#8b5cf6", lighting:"#f59e0b",
  flame:"#ef4444", fog:"#6b7280", laser:"#f97316",
};

const UNIVERSE_COLORS = ["#1a6fbd","#2e7d32","#8a4700","#6a1b9a","#ad1457"];

const TABS = ["Pattern","Nozzle Map","DMX Patch","Recording","Site I-CAN"];

// ─── Professional runtime group mapping ──────────────────────────────────────

function normalizeType(value) {
  return String(value || "").trim().toLowerCase();
}

function matchProfessionalGroup(fixture) {
  return resolveFixtureGroup(fixture.type || fixture.nozzleType || fixture.kind);
}

function buildGroupsFromFixtures(fixtures, devices) {
  const groupMap = Object.fromEntries(
    DEFAULT_DEVICE_GROUPS.map(group => [
      group.id,
      {
        id: group.id,
        label: group.name,
        type: group.type,
        deviceId: devices?.find(d => normalizeType(d.type) === normalizeType(group.type))?.id || group.id,
        nozzles: [],
      }
    ])
  );

  if (!fixtures?.length) {
    groupMap.center_jets.nozzles.push({ id:"n-0", x:0, z:0, type:"geyser" });
    groupMap.arch_jets.nozzles.push({ id:"n-1", x:3, z:0, type:"arch" });
    groupMap.arch_jets.nozzles.push({ id:"n-2", x:-3, z:0, type:"arch" });
    groupMap.rgb_lights.nozzles.push({ id:"n-3", x:0, z:3, type:"lighting" });
  } else {
    fixtures.forEach((fixture, index) => {
     const groupId = fixture.groupId || matchProfessionalGroup(fixture);
      if (!groupId) return;          // skip plant/control equipment
      const group = groupMap[groupId];
      if (!group) return;

      // Canonical engineering(x,y) → plan/3D(x,z) conversion; single source of
      // truth shared with fixturesToNozzleConfigs and the Nozzle Map top view.
      const { x, z } = fixturePlanCoords(fixture);
      group.nozzles.push({
        id: fixture.id || `fixture-${index}`,
        x,
        z,
        type: fixture.type || fixture.nozzleType || "jet_3d",
        groupId,
      });
    });
  }

  return Object.values(groupMap).filter(group => group.nozzles.length > 0);
}
// ─── component ────────────────────────────────────────────────────────────────

export default function PatternDesignerPanel() {

  // ── store (unchanged from original) ────────────────────────────────────────
  const {
    devices, addServerLog,
    manualPatterns, setManualPatterns,
    manualPriority, setManualPriority,
    manualPatternConfig, setManualPatternConfig,
    playbackState, playhead,
    timelineTracks, currentShow,
  } = useShowStore();

  const fixtures  = useEngineeringStore(s => s.fixtures);
  const geometry  = useEngineeringStore(s => s.geometry);
     const params    = useEngineeringStore(s => s.params);
     const poolType  = useEngineeringStore(s => s.poolType);
     const poolGeometry = {
       width:  params?.width  ?? 10,
       length: params?.length ?? 20,
       shape:  (poolType === "elliptical" || poolType === "circular") ? "ellipse" : "rectangle",
     };
  const audioData = useShowStore(s => s.audioData);

  // ── state (original) ───────────────────────────────────────────────────────
  const [groups, setGroups]               = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [activePattern, setActivePattern] = useState(() => useShowStore.getState().manualPatternConfig?.patternType || "wave");
  const [intensity, setIntensity]         = useState(() => useShowStore.getState().manualPatternConfig?.intensity ?? 0.85);
  const [speed, setSpeed]                 = useState(() => useShowStore.getState().manualPatternConfig?.speed ?? 1.0);
  const [isPlaying, setIsPlaying]         = useState(false);
  const [beatSync, setBeatSync]           = useState(() => useShowStore.getState().manualPatternConfig?.beatSync ?? false);
  const [steps, setSteps]                 = useState(() => useShowStore.getState().manualPatternConfig?.steps || Array(16).fill(0.8));
  const [currentStep, setCurrentStep]     = useState(0);
  const [stepLength, setStepLength]       = useState(() => useShowStore.getState().manualPatternConfig?.stepLength ?? 0.5);
     const [lightColor, setLightColor]       = useState(() => useShowStore.getState().manualPatternConfig?.lightColor || "#ffffff");

  // ── state (new — Phase 15) ─────────────────────────────────────────────────
  const [activeTab, setActiveTab]         = useState(0);

  // Save / load
  const [savedPatterns, setSavedPatterns] = useState([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName]           = useState("");
  const [saveError, setSaveError]         = useState("");

  // Nozzle map
  const [selectedNozzles, setSelectedNozzles] = useState(new Set());
  const [nozzleOverride, setNozzleOverride]   = useState(null);

  // DMX patch
  const [dmxMap, setDmxMap]   = useState([]);
  const [dmxEdit, setDmxEdit] = useState(null);
  const [dmxDraft, setDmxDraft] = useState({ universe:1, channel:1 });

  // Recording
  const [recording, setRecording]       = useState(false);
  const [recordBuffer, setRecordBuffer] = useState([]);
  const [recordStart, setRecordStart]   = useState(0);
  const [exportMsg, setExportMsg]       = useState("");

  // ── refs (original) ────────────────────────────────────────────────────────
  const patternTimerRef = useRef(null);
  const stepRef         = useRef(0);
  const bpmRef          = useRef(128);
  const liveIntensitiesRef = useRef(null); // shared with NozzleMap

  // ── derived ────────────────────────────────────────────────────────────────
  // Flat fixture list for NozzleMap (one entry per nozzle across all groups)
  const flatFixtures = groups.flatMap(g =>
  g.nozzles.map(n => ({
    id: n.id,
    type: n.type,
    groupId: g.id,
    groupName: g.label,
    deviceId: g.deviceId,
    name: `${g.label} · ${n.id}`,
    position: { x:n.x, y:n.z },
  }))
);

  // ── original effects ───────────────────────────────────────────────────────
  useEffect(() => {
    const g = buildGroupsFromFixtures(fixtures, devices);
    setGroups(g);
    if (g.length && !selectedGroup) setSelectedGroup(g[0].id);
  }, [fixtures, devices]);

    // Sync pattern config back to store so it survives panel switches
     useEffect(() => {
        setManualPatternConfig({
      patternType: activePattern,
      intensity,
      speed,
      stepLength,
      beatSync,
      steps,
      lightColor,
    });
          }, [activePattern, intensity, speed, stepLength, beatSync, steps, lightColor]);

  useEffect(() => {
    bpmRef.current = currentShow?.bpm || 128;
    if (beatSync) setStepLength(60 / bpmRef.current / 2);
  }, [currentShow?.bpm, beatSync]);

  // ── new effect: load saved patterns on mount ───────────────────────────────
    useEffect(() => {
    fetch(`${PATTERN_API}/patterns`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSavedPatterns(data);
        } else if (Array.isArray(data?.patterns)) {
          setSavedPatterns(data.patterns);
        } else if (Array.isArray(data?.items)) {
          setSavedPatterns(data.items);
        } else {
          setSavedPatterns([]);
        }
      })
      .catch(() => setSavedPatterns([]));
  }, []);

  // ── new effect: load saved DMX map on mount ────────────────────────────────
  useEffect(() => {
    fetch(`${PATTERN_API}/dmx-map`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setDmxMap(data);
        } else if (Array.isArray(data?.map)) {
          setDmxMap(data.map);
        } else {
          setDmxMap([]);
        }
      })
      .catch(() => setDmxMap([]));
  }, []);

  // ── original pattern engine (unchanged) ───────────────────────────────────

  const computePatternIntensities = useCallback((patternKey, stepIndex, t, ix, spd) => {
    const n = groups.reduce((sum, g) => sum + g.nozzles.length, 0) || 8;
    const arr = new Array(n).fill(0);
    const phase = t * spd * 2;

    switch (patternKey) {
      case "wave":
        arr.forEach((_, i) => { arr[i] = ix * (0.4 + 0.6 * Math.sin(phase + i * 0.4)); }); break;
      case "pulse":
        arr.fill(ix * (0.3 + 0.7 * Math.abs(Math.sin(phase * 2)))); break;
      case "chase":
        arr[Math.floor(phase * 3) % n] = ix; break;
      case "burst":
        arr.fill(ix * (Math.random() > 0.4 ? 1 : 0.1)); break;
      case "ripple":
        arr.forEach((_, i) => { arr[i] = ix * (0.4 + 0.6 * Math.sin(phase * 2 - i * 0.5)); }); break;
      case "spiral":
        arr.forEach((_, i) => { arr[i] = ix * (0.35 + 0.65 * Math.sin(phase * 1.5 + i * 0.7)); }); break;
      case "alternate":
        arr.forEach((_, i) => { arr[i] = (i % 2 === Math.floor(phase) % 2) ? ix : 0.1; }); break;
      case "firework":
        arr.forEach((_, i) => { arr[i] = Math.abs(Math.sin(phase)) > 0.8 ? ix * (0.5 + Math.random() * 0.5) : 0.05; }); break;
      case "manual":
        arr.fill(steps[stepIndex % steps.length] * ix); break;
      default:
        arr.fill(ix * 0.5);
    }
    return arr;
  }, [groups, steps]);

  const sendPatternToDevices = useCallback(async (intensities) => {
    if (!groups.length) return;
    let nozzleIdx = 0;
    for (const group of groups) {
      const groupIntensity = intensities
        .slice(nozzleIdx, nozzleIdx + group.nozzles.length)
        .reduce((a, b) => a + b, 0) / group.nozzles.length;
      nozzleIdx += group.nozzles.length;
      try {
        await fetch(`${API}/${group.deviceId}/command`, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
                    body: JSON.stringify({
            type: group.type,
            intensity: Math.round(groupIntensity * 100),
            command: "intensity",
            source: "manual_pattern",
            color: group.id === "rgb_lights" ? lightColor : undefined,
            rgb: group.id === "rgb_lights" ? lightColor : undefined,
          }),
        });
      } catch { /* offline dev mode */ }
    }
    }, [groups, lightColor]);

  const tickPattern = useCallback(() => {
    const t = Date.now() / 1000;
    const intensities = computePatternIntensities(activePattern, stepRef.current, t, intensity, speed);

    // keep ref up to date for NozzleMap
    liveIntensitiesRef.current = new Float32Array(intensities);

    setManualPatterns(intensities, {
      lightColor,
      fixtures: flatFixtures.map((fx, index) => ({
        index,
        id: fx.id,
        type: fx.type,
        groupId: fx.groupId || "center_jets",
        groupName: fx.groupName || "Center Jets",
        deviceId: fx.deviceId || null,
        color: (fx.groupId === "rgb_lights" || String(fx.type || "").includes("light")) ? lightColor : null,
      })),
    });
    sendPatternToDevices(intensities);

    // capture frame for recording
    if (recording) {
      setRecordBuffer(buf => [...buf, { time: performance.now() - recordStart, intensities: [...intensities] }]);
    }

    stepRef.current = (stepRef.current + 1) % 16;
    setCurrentStep(stepRef.current);
  }, [activePattern, intensity, speed, computePatternIntensities, setManualPatterns, sendPatternToDevices, recording, recordStart]);

  useEffect(() => {
    if (patternTimerRef.current) clearInterval(patternTimerRef.current);
    if (isPlaying && manualPriority) {
      const interval = Math.max(50, stepLength * 1000);
      patternTimerRef.current = setInterval(tickPattern, interval);
    }
    return () => clearInterval(patternTimerRef.current);
  }, [isPlaying, manualPriority, stepLength, tickPattern]);

  // ── original handlers (unchanged) ─────────────────────────────────────────

  const handlePlay = () => {
    if (!manualPriority) setManualPriority(true);
    setIsPlaying(true);
    addServerLog({ level:"info", msg:`Manual pattern started: ${activePattern} @ ${intensity*100}%` });
  };

  const handleStop = () => {
    setIsPlaying(false);
    setManualPatterns(null);
    liveIntensitiesRef.current = null;
    addServerLog({ level:"info", msg:"Manual pattern stopped — AI choreography active" });
  };

  const handleStepChange = (idx, val) => {
    const newSteps = [...steps];
    newSteps[idx] = parseFloat(val);
    setSteps(newSteps);
  };

  // ── new handlers (Phase 15) ────────────────────────────────────────────────

  // Nozzle map
  const handleNozzleSelect = useCallback((idx, multi) => {
    setSelectedNozzles(prev => {
      const next = new Set(multi ? prev : []);
      if (prev.has(idx) && !multi) next.clear();
      else if (prev.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

    const handleSoloIntensity = useCallback((v) => {
    if (!selectedNozzles.size) return;

    const base = liveIntensitiesRef.current
      ? new Float32Array(liveIntensitiesRef.current)
      : new Float32Array(flatFixtures.length);

    selectedNozzles.forEach(idx => {
      base[idx] = v;
    });

    setNozzleOverride(base);

    setManualPatterns(Array.from(base), {
      lightColor,
      fixtures: flatFixtures.map((fx, index) => ({
        index,
        id: fx.id,
        type: fx.type,
        groupId: fx.groupId || "center_jets",
        groupName: fx.groupName || "Center Jets",
        deviceId: fx.deviceId || null,
        color: (fx.groupId === "rgb_lights" || String(fx.type || "").includes("light")) ? lightColor : null,
      })),
    });
  }, [selectedNozzles, flatFixtures, setManualPatterns, lightColor]);

  // Save / load
  const handleSave = useCallback(async () => {
    if (!saveName.trim()) return;
        const payload = {
      name: saveName.trim(),
      patternType: activePattern,
      intensity,
      speed,
      stepDuration: Math.round(stepLength * 1000),
      beatSync,
      seqSteps: steps,
      dmxMap,
      lightColor,
    };
    try {
      const r = await fetch(`${PATTERN_API}/patterns`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
      const saved = await r.json();
      setSavedPatterns(prev => [...prev.filter(p => p.name !== saved.name), saved]);
      setSaveDialogOpen(false);
      setSaveName("");
    } catch { setSaveError("Save failed — backend unreachable"); }
    }, [saveName, activePattern, intensity, speed, stepLength, beatSync, steps, dmxMap, lightColor]);

  const handleLoad = useCallback((p) => {
    if (p.patternType) setActivePattern(p.patternType);
    if (p.intensity  != null) setIntensity(p.intensity);
    if (p.speed      != null) setSpeed(p.speed);
    if (p.stepDuration)       setStepLength(p.stepDuration / 1000);
    if (p.beatSync   != null) setBeatSync(p.beatSync);
    if (p.seqSteps?.length)   setSteps(p.seqSteps);
    if (p.dmxMap?.length)     setDmxMap(p.dmxMap);
         if (p.lightColor)         setLightColor(p.lightColor);
  }, []);

  const handleDeletePattern = useCallback(async (name) => {
    try {
      await fetch(`${PATTERN_API}/patterns/${encodeURIComponent(name)}`, { method:"DELETE" });
      setSavedPatterns(prev => prev.filter(p => p.name !== name));
    } catch {}
  }, []);

  // DMX patch
  const openDmxEdit = useCallback((i) => {
    const existing = dmxMap.find(m => m.fixtureId === (flatFixtures[i]?.id ?? i));
    setDmxDraft(existing ? { universe: existing.universe, channel: existing.channel } : { universe: 1, channel: 1 });
    setDmxEdit(i);
  }, [dmxMap, flatFixtures]);

  const persistDmxMap = useCallback(async (nextMap) => {
    try {
      const r = await fetch(`${PATTERN_API}/dmx-map`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ map: nextMap }),
      });

      const saved = await r.json();

      if (Array.isArray(saved?.map)) {
        setDmxMap(saved.map);
      }

      addServerLog?.({
        level: "info",
        msg: `DMX map saved: ${nextMap.length} patched fixtures`,
      });
    } catch {
      addServerLog?.({
        level: "error",
        msg: "DMX map save failed — backend unreachable",
      });
    }
  }, [addServerLog]);

  const saveDmxEdit = useCallback(() => {
    if (dmxEdit == null) return;

    const fxId = flatFixtures[dmxEdit]?.id ?? dmxEdit;

    const nextMap = [
      ...dmxMap.filter(m => m.fixtureId !== fxId),
      {
        fixtureId: fxId,
        universe: Number(dmxDraft.universe),
        channel: Number(dmxDraft.channel),
      },
    ];

    setDmxMap(nextMap);
    setDmxEdit(null);
    persistDmxMap(nextMap);
  }, [dmxEdit, dmxDraft, flatFixtures, dmxMap, persistDmxMap]);

  const pushDmxToBackend = useCallback(async () => {
    await persistDmxMap(dmxMap);
  }, [dmxMap, persistDmxMap]);

  // Recording
  const startRecording = useCallback(() => {
    setRecordBuffer([]);
    setRecordStart(performance.now());
    setRecording(true);
    if (!isPlaying) handlePlay();
  }, [isPlaying, handlePlay]);

  const stopRecording = useCallback(async () => {
    setRecording(false);
    handleStop();
    if (!recordBuffer.length) return;

    const clips = flatFixtures.map((fx, fxIdx) => ({
  fixtureId:   fx.id ?? fxIdx,
  fixtureName: fx.name ?? `Fixture ${fxIdx+1}`,
  groupId:     fx.groupId || "center_jets",
  groupName:   fx.groupName || "Center Jets",
  deviceId:    fx.deviceId || null,
   type:        fx.type || "jet_3d",
  color:       (fx.groupId === "rgb_lights" || String(fx.type || "").includes("light")) ? lightColor : null,
  rgb:         (fx.groupId === "rgb_lights" || String(fx.type || "").includes("light")) ? lightColor : null,
  keyframes:   recordBuffer.map(f => ({
    time: f.time / 1000,
    value: f.intensities[fxIdx] ?? 0,
  })),
  duration:    (recordBuffer[recordBuffer.length-1]?.time ?? 0) / 1000,
}));

    try {
      const r = await fetch(`${PATTERN_API}/timeline/clips`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ clips, name:`Manual ${new Date().toLocaleTimeString()}` }),
      });
      const result = await r.json();
      setExportMsg(`✓ Exported ${clips.length} tracks to timeline`);
    } catch {
      const blob = new Blob([JSON.stringify(clips, null, 2)], { type:"application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `manual-pattern-${Date.now()}.json`; a.click();
      URL.revokeObjectURL(url);
      setExportMsg("Backend offline — downloaded as JSON");
    }
    setTimeout(() => setExportMsg(""), 4000);
    }, [handleStop, recordBuffer, flatFixtures, lightColor]);

  // ── styles (original variables preserved) ─────────────────────────────────

  const s = {
    panel:        { width:"100%", height:"100%", display:"flex", flexDirection:"column", background:"var(--bg-panel)", overflow:"hidden" },
    header:       { display:"flex", alignItems:"center", gap:8, padding:"0 12px", height:36, background:"var(--bg-surface)", borderBottom:"1px solid var(--border)", flexShrink:0 },
    tabBar:       { display:"flex", borderBottom:"1px solid var(--border)", flexShrink:0 },
    tab:          (active) => ({ flex:1, padding:"7px 4px", fontSize:10, background:"none", border:"none", borderBottom: active?"2px solid var(--accent)":"2px solid transparent", color: active?"var(--accent)":"var(--text-muted)", cursor:"pointer", fontFamily:"var(--font-mono)", letterSpacing:"0.05em" }),
    body:         { flex:1, overflowY:"auto", padding:10 },
    sectionLabel: { fontSize:9, fontWeight:600, fontFamily:"var(--font-mono)", color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:6, marginTop:12, borderBottom:"1px solid var(--border)", paddingBottom:3 },
    priorityBanner: (on) => ({ padding:"6px 10px", borderRadius:4, marginBottom:10, background: on?"rgba(0,212,255,0.08)":"rgba(139,92,246,0.06)", border:`1px solid ${on?"rgba(0,212,255,0.3)":"rgba(139,92,246,0.2)"}`, display:"flex", justifyContent:"space-between", alignItems:"center" }),
    btn:          (active, color="#00aaff") => ({ padding:"4px 10px", borderRadius:4, fontSize:10, cursor:"pointer", fontFamily:"var(--font-mono)", background: active?`${color}22`:"var(--bg-raised)", color: active?color:"var(--text-muted)", border:`1px solid ${active?`${color}55`:"var(--border)"}` }),
    patternBtn:   (active) => ({ flex:1, padding:"5px 4px", fontSize:10, cursor:"pointer", background: active?"rgba(0,212,255,0.1)":"var(--bg-surface)", color: active?"var(--accent)":"var(--text-muted)", border:`1px solid ${active?"var(--accent)":"var(--border)"}`, borderRadius:4, fontFamily:"var(--font-mono)", display:"flex", flexDirection:"column", alignItems:"center", gap:1 }),
    group:        (active) => ({ padding:"6px 8px", borderRadius:4, marginBottom:4, background: active?"rgba(0,212,255,0.06)":"var(--bg-surface)", border:`1px solid ${active?"var(--accent)":"var(--border)"}`, cursor:"pointer" }),
    // new
    savedChip:    { display:"flex", alignItems:"center", background:"rgba(0,212,255,0.06)", border:"1px solid rgba(0,212,255,0.2)", borderRadius:10, overflow:"hidden", fontSize:10 },
    dmxRow:       (even) => ({ display:"flex", alignItems:"center", borderBottom:"1px solid var(--border)", padding:"4px 0", background: even?"rgba(255,255,255,0.01)":"transparent" }),
    dmxCell:      { flex:1, padding:"0 8px", fontSize:10, color:"var(--text-secondary)", display:"flex", alignItems:"center", gap:4 },
    input:        { background:"var(--bg-raised)", border:"1px solid var(--border)", borderRadius:4, padding:"4px 8px", color:"var(--text-primary)", fontSize:11, outline:"none", width:"100%" },
    actionBtn:    { padding:"2px 8px", borderRadius:3, border:"1px solid var(--border)", background:"var(--bg-raised)", color:"var(--text-secondary)", fontSize:10, cursor:"pointer", fontFamily:"var(--font-mono)" },
  };

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div style={s.panel}>

      {/* header (original) */}
      <div style={s.header}>
        <span style={{ fontSize:14, color:"var(--accent)" }}>◈</span>
        <span style={{ fontFamily:"var(--font-display)", fontSize:11, fontWeight:600, letterSpacing:"0.12em", color:"var(--text-secondary)", textTransform:"uppercase" }}>
          Pattern Designer
        </span>
        {isPlaying && <span style={{ marginLeft:"auto", fontSize:9, fontFamily:"var(--font-mono)", color:"var(--green)", animation:"pulse 1s infinite" }}>● LIVE</span>}
      </div>

      {/* tab bar (new) */}
      <div style={s.tabBar}>
        {TABS.map((t,i) => (
          <button key={t} style={s.tab(activeTab===i)} onClick={() => setActiveTab(i)}>{t}</button>
        ))}
      </div>

      {/* ── TAB 0 : Pattern (original content, unchanged) ─────────────────── */}
      {activeTab === 0 && (
        <div style={s.body}>

          {/* Priority toggle (original) */}
          <div style={s.priorityBanner(manualPriority)}>
            <div>
              <div style={{ fontSize:11, color: manualPriority?"var(--accent)":"var(--purple)", fontWeight:600 }}>
                {manualPriority ? "● Manual Priority ACTIVE" : "○ AI Choreography Active"}
              </div>
              <div style={{ fontSize:9, color:"var(--text-muted)" }}>
                {manualPriority ? "Manual patterns override AI completely" : "Enable to override AI with manual patterns"}
              </div>
            </div>
            <button onClick={() => { setManualPriority(!manualPriority); if(isPlaying&&manualPriority) handleStop(); }}
              style={{ ...s.btn(manualPriority), fontSize:9 }}>
              {manualPriority ? "Disable" : "Enable"}
            </button>
          </div>

          {/* Nozzle groups (original) */}
          <div style={s.sectionLabel}>Nozzle Groups ({groups.length})</div>
          {groups.map(g => (
            <div key={g.id} style={s.group(selectedGroup===g.id)} onClick={() => setSelectedGroup(g.id)}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:DEVICE_COLORS[g.type]||"#94a3b8", flexShrink:0 }}/>
                <span style={{ fontSize:11, color:"var(--text-primary)", flex:1 }}>{g.label}</span>
                <span style={{ fontSize:9, fontFamily:"var(--font-mono)", color:"var(--text-muted)" }}>{g.nozzles.length} nozzles</span>
                <span style={{ fontSize:9, fontFamily:"var(--font-mono)", color:"var(--text-muted)", marginLeft:4 }}>{g.deviceId}</span>
              </div>
            </div>
          ))}
          {!groups.length && (
            <div style={{ fontSize:10, color:"var(--text-muted)", padding:"8px 0", lineHeight:1.5 }}>
              Open Engineering Designer, place fixtures and click Push to Devices to populate groups here.
            </div>
          )}

          {/* Pattern selector (original) */}
          <div style={s.sectionLabel}>Pattern</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:4, marginBottom:10 }}>
            {PATTERNS.map(p => (
              <button key={p.key} onClick={() => setActivePattern(p.key)} style={s.patternBtn(activePattern===p.key)}>
                <span style={{ fontSize:14 }}>{p.icon}</span>
                <span style={{ fontSize:8 }}>{p.label}</span>
              </button>
            ))}
          </div>

          {/* Manual step sequencer (original) */}
          {activePattern === "manual" && (
            <>
              <div style={s.sectionLabel}>Step Sequencer (16 steps)</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(8,1fr)", gap:3, marginBottom:10 }}>
                {steps.map((val, idx) => (
                  <div key={idx} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                    <div style={{ width:"100%", height:40, background:"var(--bg-surface)", borderRadius:3, border:`1px solid ${currentStep===idx&&isPlaying?"var(--accent)":"var(--border)"}`, position:"relative", cursor:"pointer", overflow:"hidden" }}
                      onClick={e => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const v = 1 - (e.clientY - rect.top) / rect.height;
                        handleStepChange(idx, Math.max(0, Math.min(1, v)));
                      }}>
                      <div style={{ position:"absolute", bottom:0, left:0, right:0, background: currentStep===idx&&isPlaying?"var(--accent)":"var(--purple)", height:`${val*100}%`, opacity:0.8, transition:"height 0.05s" }}/>
                      <span style={{ position:"absolute", top:2, left:0, right:0, textAlign:"center", fontSize:7, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>{idx+1}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", gap:6, marginBottom:10 }}>
                <button onClick={() => setSteps(Array(16).fill(0))}          style={{ ...s.btn(false), flex:1, fontSize:9 }}>Clear</button>
                <button onClick={() => setSteps(Array(16).fill(1))}          style={{ ...s.btn(false), flex:1, fontSize:9 }}>Full</button>
                <button onClick={() => setSteps(steps.map((_,i)=>i%2===0?1:0))} style={{ ...s.btn(false), flex:1, fontSize:9 }}>Alt</button>
                <button onClick={() => setSteps(steps.map((_,i)=>i/15))}    style={{ ...s.btn(false), flex:1, fontSize:9 }}>Ramp</button>
              </div>
            </>
          )}

          {/* Controls (original) */}
          <div style={s.sectionLabel}>Controls</div>
          {[
            ["Intensity", intensity, setIntensity, 0,   1,   0.01, `${Math.round(intensity*100)}%`,    "#00aaff"],
            ["Speed",     speed,     setSpeed,     0.2, 4,   0.1,  `${speed.toFixed(1)}x`,             "#8b5cf6"],
            ["Step (s)",  stepLength,setStepLength,0.1, 2,   0.05, `${stepLength.toFixed(2)}s`,         "#00ccaa"],
          ].map(([label, val, setter, min, max, step, display, color]) => (
            <div key={label} style={{ marginBottom:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                <span style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>{label}</span>
                <span style={{ fontSize:9, color, fontFamily:"var(--font-mono)" }}>{display}</span>
              </div>
              <input type="range" min={min} max={max} step={step} value={val}
                onChange={e => setter(parseFloat(e.target.value))}
                style={{ width:"100%", accentColor:color }}/>
            </div>
          ))}
	          <div style={{ marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
              <span style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>RGB Light Color</span>
              <span style={{ fontSize:9, color:lightColor, fontFamily:"var(--font-mono)" }}>{lightColor}</span>
            </div>
            <input
              type="color"
              value={lightColor}
              onChange={e => setLightColor(e.target.value)}
              style={{
                width:"100%",
                height:28,
                border:"1px solid var(--border)",
                borderRadius:4,
                background:"var(--bg-raised)",
                cursor:"pointer",
              }}
            />
          </div>

          {/* Beat sync (original) */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <input type="checkbox" checked={beatSync} onChange={e => {
              setBeatSync(e.target.checked);
              if (e.target.checked) setStepLength(60/bpmRef.current/2);
            }} id="beatSync"/>
            <label htmlFor="beatSync" style={{ fontSize:10, color:"var(--text-secondary)", cursor:"pointer" }}>
              Sync to audio BPM ({currentShow?.bpm||128} BPM)
            </label>
          </div>

          {/* Play / Stop (original) */}
          <div style={{ display:"flex", gap:6, marginBottom:12 }}>
            <button onClick={handlePlay} disabled={isPlaying}
              style={{ ...s.btn(!isPlaying,"#00ff88"), flex:1, justifyContent:"center", padding:"8px", color: isPlaying?"var(--text-muted)":"var(--green)", fontSize:12 }}>
              ▶ Play Pattern
            </button>
            <button onClick={handleStop} disabled={!isPlaying}
              style={{ ...s.btn(isPlaying,"#ef4444"), flex:1, justifyContent:"center", padding:"8px", color: !isPlaying?"var(--text-muted)":"var(--red)", fontSize:12 }}>
              ⏹ Stop
            </button>
          </div>

          {/* Live nozzle signals (original) */}
          {isPlaying && manualPriority && (
            <>
              <div style={s.sectionLabel}>Live Nozzle Signals</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(8,1fr)", gap:2, marginBottom:10 }}>
                {(useShowStore.getState().manualPatterns || Array(8).fill(0)).slice(0,16).map((v,i) => (
                  <div key={i} style={{ height:20, background:"var(--bg-surface)", borderRadius:2, position:"relative", overflow:"hidden" }}>
                    <div style={{ position:"absolute", bottom:0, left:0, right:0, background:"var(--accent)", height:`${(v||0)*100}%`, opacity:0.9 }}/>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── NEW: Save / Load row ──────────────────────────────────────── */}
          <div style={s.sectionLabel}>Saved Patterns</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
            {savedPatterns.map(p => (
              <span key={p.name} style={s.savedChip}>
                <span style={{ padding:"3px 8px 3px 10px", cursor:"pointer", color:"var(--accent)" }} onClick={() => handleLoad(p)}>{p.name}</span>
                <span style={{ padding:"3px 7px", cursor:"pointer", color:"var(--red)", borderLeft:"1px solid var(--border)" }} onClick={() => handleDeletePattern(p.name)}>×</span>
              </span>
            ))}
            {!savedPatterns.length && <span style={{ fontSize:9, color:"var(--text-muted)" }}>No saved patterns</span>}
          </div>
          <button style={{ ...s.btn(false), fontSize:9 }} onClick={() => setSaveDialogOpen(true)}>Save Current Pattern…</button>

          {saveDialogOpen && (
            <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:6, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:4, padding:"10px 12px" }}>
              <span style={{ fontSize:10, color:"var(--text-secondary)" }}>Pattern name:</span>
              <input style={s.input} value={saveName} onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if(e.key==="Enter") handleSave(); }}
                placeholder="e.g. Opening Ceremony Wave" autoFocus/>
              {saveError && <span style={{ fontSize:9, color:"var(--red)" }}>{saveError}</span>}
              <div style={{ display:"flex", gap:6 }}>
                <button style={{ ...s.btn(true,"#00aaff"), flex:1 }} onClick={handleSave}>Save</button>
                <button style={{ ...s.btn(false), flex:1 }} onClick={() => { setSaveDialogOpen(false); setSaveError(""); }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Info box (original) */}
          <div style={{ marginTop:12, padding:"8px 10px", background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:4, fontSize:9, color:"var(--text-muted)", lineHeight:1.6 }}>
            Pattern → showStore → 3D Preview (60fps)<br/>
            Pattern → Protocol Bus → PLC/DMX hardware<br/>
            Manual priority = AI choreography paused
          </div>
        </div>
      )}

      {/* ── TAB 1 : Nozzle Map ────────────────────────────────────────────── */}
      {activeTab === 1 && (
        <div style={s.body}>
          <div style={s.sectionLabel}>Pool Top View — {flatFixtures.length} nozzles{selectedNozzles.size ? ` · ${selectedNozzles.size} selected` : ""}</div>

          <div style={{ display:"flex", justifyContent:"center", background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:6, padding:8, overflow:"hidden" }}>
            <NozzleMap
              fixtures={flatFixtures}
              intensities={liveIntensitiesRef.current}
              poolGeometry={poolGeometry}
              selected={selectedNozzles}
              onSelect={handleNozzleSelect}
            />
          </div>

          {selectedNozzles.size > 0 && (
            <div style={{ marginTop:8, padding:"8px 10px", background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:4 }}>
              <div style={{ fontSize:9, color:"var(--text-muted)", marginBottom:6 }}>Solo intensity for selected nozzles (overrides pattern)</div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", width:32 }}>Solo</span>
                <input type="range" min={0} max={1} step={0.01}
                  value={nozzleOverride ? (Array.from(selectedNozzles).reduce((s,i) => s+(nozzleOverride[i]??0),0)/selectedNozzles.size) : 0}
                  onChange={e => handleSoloIntensity(parseFloat(e.target.value))}
                  style={{ flex:1, accentColor:"var(--accent)" }}/>
                <span style={{ fontSize:9, color:"var(--accent)", fontFamily:"var(--font-mono)", width:32, textAlign:"right" }}>
                  {Math.round((nozzleOverride ? (Array.from(selectedNozzles).reduce((s,i) => s+(nozzleOverride[i]??0),0)/selectedNozzles.size) : 0)*100)}%
                </span>
              </div>
              <button style={{ ...s.btn(false), marginTop:6, fontSize:9 }} onClick={() => { setSelectedNozzles(new Set()); setNozzleOverride(null); }}>Clear selection</button>
            </div>
          )}

          <div style={{ marginTop:6, fontSize:9, color:"var(--text-muted)", textAlign:"center" }}>
            Click to select · Ctrl+click for multi-select · Color = live intensity
          </div>
        </div>
      )}

      {/* ── TAB 2 : DMX Patch ─────────────────────────────────────────────── */}
      {activeTab === 2 && (
        <div style={s.body}>
          <div style={s.sectionLabel}>DMX Channel Mapping — {flatFixtures.length} fixtures</div>

          {/* Universe legend */}
          <div style={{ display:"flex", gap:10, marginBottom:8, flexWrap:"wrap" }}>
            {[1,2,3,4,5].map(u => (
              <span key={u} style={{ display:"flex", alignItems:"center", gap:4, fontSize:9, color:"var(--text-muted)" }}>
                <span style={{ width:8, height:8, borderRadius:2, background:UNIVERSE_COLORS[u-1] }}/>
                Univ {u}
              </span>
            ))}
          </div>

          {/* Header row */}
          <div style={{ ...s.dmxRow(false), borderBottom:"1px solid var(--border)", background:"var(--bg-surface)" }}>
            {["Fixture","Type","Universe","Channel",""].map((h,i) => (
              <span key={i} style={{ ...s.dmxCell, fontSize:8, color:"var(--text-muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em" }}>{h}</span>
            ))}
          </div>

          {flatFixtures.map((fx, i) => {
            const mapping = dmxMap.find(m => m.fixtureId === (fx.id ?? i));
            const editing = dmxEdit === i;
            return (
              <div key={fx.id??i} style={s.dmxRow(i%2===0)}>
                <span style={s.dmxCell}>{fx.name?.split(" · ")[0] ?? `#${i+1}`}</span>
                <span style={{ ...s.dmxCell, color:"var(--text-muted)" }}>{fx.type ?? "—"}</span>
                {editing ? (
                  <>
                    <span style={s.dmxCell}>
                      <select value={dmxDraft.universe} onChange={e => setDmxDraft(d=>({...d,universe:Number(e.target.value)}))}
                        style={{ ...s.input, padding:"2px 4px", fontSize:10 }}>
                        {[1,2,3,4,5].map(u => <option key={u} value={u}>Universe {u}</option>)}
                      </select>
                    </span>
                    <span style={s.dmxCell}>
                      <input type="number" min={1} max={512} value={dmxDraft.channel}
                        onChange={e => setDmxDraft(d=>({...d,channel:Number(e.target.value)}))}
                        style={{ ...s.input, width:60, padding:"2px 6px", fontSize:10 }}/>
                    </span>
                    <span style={{ ...s.dmxCell, gap:4 }}>
                      <button style={s.actionBtn} onClick={saveDmxEdit}>✓</button>
                      <button style={s.actionBtn} onClick={() => setDmxEdit(null)}>✕</button>
                    </span>
                  </>
                ) : (
                  <>
                    <span style={s.dmxCell}>
                      {mapping
                        ? <><span style={{ width:8, height:8, borderRadius:2, background:UNIVERSE_COLORS[mapping.universe-1], flexShrink:0 }}/>{`Univ ${mapping.universe}`}</>
                        : <span style={{ color:"var(--red)", opacity:0.6 }}>—</span>}
                    </span>
                    <span style={s.dmxCell}>
                      {mapping ? `Ch ${mapping.channel}` : <span style={{ color:"var(--red)", opacity:0.6 }}>unmapped</span>}
                    </span>
                    <span style={s.dmxCell}>
                      <button style={s.actionBtn} onClick={() => openDmxEdit(i)}>Edit</button>
                    </span>
                  </>
                )}
              </div>
            );
          })}

          <div style={{ display:"flex", gap:6, marginTop:10 }}>
            <button style={{ ...s.btn(true,"#00aaff"), flex:1 }} onClick={pushDmxToBackend}>Push to Hardware</button>
            <button style={{ ...s.btn(false), flex:1 }} onClick={() => setDmxMap([])}>Clear All</button>
          </div>
        </div>
      )}

      {/* ── TAB 3 : Recording ─────────────────────────────────────────────── */}
      {activeTab === 3 && (
        <div style={s.body}>
          <div style={s.sectionLabel}>Capture to Timeline</div>

          <div style={{ fontSize:10, color:"var(--text-muted)", lineHeight:1.6, marginBottom:12 }}>
            Record a live pattern session and export it as timeline clips.
            Captured keyframes appear in the Timeline panel for fine-tuning.
          </div>

          {/* Status indicator */}
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:4, marginBottom:12 }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background: recording?"#ef4444":"var(--text-muted)", boxShadow: recording?"0 0 6px #ef4444":"none", flexShrink:0 }}/>
            <span style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--text-secondary)" }}>
              {recording
                ? `Recording… ${Math.round((performance.now()-recordStart)/1000)}s · ${recordBuffer.length} frames`
                : "Ready"}
            </span>
          </div>

          <div style={{ display:"flex", gap:6, marginBottom:12 }}>
            {!recording
              ? <button style={{ ...s.btn(false,"#ef4444"), flex:1, padding:"8px", fontSize:11 }} onClick={startRecording}>⏺ Start Recording</button>
              : <button style={{ ...s.btn(false,"#00ff88"), flex:1, padding:"8px", fontSize:11 }} onClick={stopRecording}>⏹ Stop &amp; Export</button>
            }
          </div>

          {exportMsg && (
            <div style={{ padding:"6px 10px", background:"rgba(0,212,100,0.08)", border:"1px solid rgba(0,212,100,0.25)", borderRadius:4, fontSize:10, color:"var(--green)", marginBottom:10 }}>
              {exportMsg}
            </div>
          )}

          {/* Mini preview of last recording */}
          {recordBuffer.length > 0 && !recording && (
            <>
              <div style={s.sectionLabel}>Last Recording Preview</div>
              <RecordingPreview buffer={recordBuffer} fixtureCount={flatFixtures.length} />
            </>
          )}

          <div style={{ marginTop:16 }}>
            <div style={s.sectionLabel}>How it works</div>
            <ol style={{ margin:"4px 0 0 14px", padding:0, fontSize:9, color:"var(--text-muted)", lineHeight:2 }}>
              <li>Choose a pattern type in the Pattern tab</li>
              <li>Click Start Recording — playback starts automatically</li>
              <li>Adjust intensity / speed or paint nozzles live</li>
              <li>Click Stop &amp; Export to push clips to the timeline</li>
              <li>Open the Timeline panel to fine-tune keyframes</li>
            </ol>
          </div>
        </div>
      )}

      {activeTab === 4 && <ICANSiteDesignStudio />}

    </div>
  );
}

// ─── RecordingPreview ─────────────────────────────────────────────────────────

function RecordingPreview({ buffer, fixtureCount }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer.length) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    const dur = buffer[buffer.length-1].time;
    const rowH = Math.max(2, Math.floor((H-4)/fixtureCount));
    buffer.forEach(({ time, intensities }) => {
      const x = (time/dur)*(W-2)+1;
      intensities.forEach((v,fi) => {
        if (v < 0.02) return;
        const y = 2 + fi * rowH;
        const l = Math.round(20 + v*60);
        ctx.fillStyle = `hsl(185,80%,${l}%)`;
        ctx.fillRect(x, y, 1.5, rowH-1);
      });
    });
  }, [buffer, fixtureCount]);
  return (
    <canvas ref={canvasRef} width={480} height={Math.max(40, fixtureCount*6)}
      style={{ width:"100%", height:Math.max(40, fixtureCount*6), borderRadius:3, background:"var(--bg-surface)" }}/>
  );
}
