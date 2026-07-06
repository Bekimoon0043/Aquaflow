// Team B: kept entire track list, timeline area, audio loading, BeatMarkerLane, AudioWaveform
// Team C additions (marked with // ─── TEAM C):
//   1. BPM connected to showStore instead of hardcoded 128
//   2. Color-coded track labels by type
//   3. Keyboard shortcuts (Space, Delete, Ctrl+C/V, arrows)
//   4. Copy/paste clipboard
//   5. Tabbed right panel: Clip Inspector | AI | Cues
//   6. Bellagio-style cue list with GO button
//   7. Timecode display (MM:SS.mm format)
//   8. Multi-select foundation (selectedClipIds Set)

// ─── TEAM C: added useCallback + useEffect to existing imports
import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import useEngineeringStore from "../../store/engineeringStore";
// AF-HUB-002 — use the single canonical equipment-category resolver instead of a
// local mirror (both delegate to utils/fixtureTypeResolver via autoTrackGenerator).
import { generateAutoTracks, getEquipmentCategory } from "../../runtime/autoTrackGenerator";
import { buildRuntimeDeviceGraph, getTrackDevices } from "../../runtime/runtimeDeviceGraph";
import { useShowStore } from "../../store/showStore";
import AudioWaveform from "./AudioWaveform";
import BeatMarkerLane from "./BeatMarkerLane";
// ─── TEAM C: import AI panel (reads from showStore.audioData separately)
import AIChoreographyPanel from "./AIChoreographyPanel";

// ─── BACKEND API IMPORTS (Team B - Phase 1) ────────────────────────────
import { 
  listPrograms, 
  saveProgramToBackend, 
  loadProgramFromBackend,
  deleteProgramFromBackend,
  compileProgram,
  testBackendConnection 
} from "../../utils/showProgrammerApi";
import { createDryRunPreviewSession } from "../../utils/dryRunPreview";

// ─── TEAM C: track type colour map ────────────────────────────────────────
const SHOW_PROGRAMMER_STORAGE_KEY = "aquaflow_show_programmer_local_v1";
const TRACK_TYPE_COLORS = {
  lighting_master: "#f59e0b",
  lighting_red:    "#ef4444",
  lighting_green:  "#22c55e",
  lighting_blue:   "#3b82f6",
  pump_speed:      "#00d4ff",
  pump_pressure:   "#06b6d4",
  solenoid_open:   "#8b5cf6",
  solenoid_duration: "#a78bfa",
  fire_trigger:    "#f97316",
  fire_intensity:  "#fb923c",
  fog_density:     "#6b7280",
  laser_intensity: "#ec4899",
  laser_pattern:   "#db2777",
  device_enable:   "#94a3b8",
  device_intensity:"#64748b",
  motion_intensity: "#38bdf8",
  motion_angle: "#0ea5e9",
  motion_pan: "#2563eb",
  motion_tilt: "#1d4ed8",
};

// ─── TEAM C: format timecode MM:SS.mm ─────────────────────────────────────
// AF-HUB-002 — getEquipmentCategory is imported from autoTrackGenerator (the single
// canonical resolver, backed by utils/fixtureTypeResolver); the local mirror was removed.
const isRgbTrack = (type = "") =>
  type.includes("lighting_red") ||
  type.includes("lighting_green") ||
  type.includes("lighting_blue") ||
  type.includes("lighting_master");

const isMotionTrack = (type = "") =>
  type.includes("motion") ||
  type.includes("pan") ||
  type.includes("tilt") ||
  type.includes("angle");

const isIntensityTrack = (type = "") =>
  !isMotionTrack(type);
const compileClipsToRuntimeEvents = (clips = []) => {
  return clips.map((clip) => ({
    id: `runtime-${clip.id}`,
    clipId: clip.id,
    trackId: clip.trackId,
    fixtureId: clip.fixtureId,
    type: clip.type,
    startTime: Number(clip.startTime || 0),
    endTime: Number((clip.startTime || 0) + (clip.duration || 0)),
    duration: Number(clip.duration || 0),
    value: Number(clip.value ?? 100),
    fadeIn: Number(clip.fadeIn || 0),
    fadeOut: Number(clip.fadeOut || 0),
    curveType: clip.curveType || "linear",
    color: clip.color || "#00b7ff",
    rgb: {
      r: Number(clip.r ?? 255),
      g: Number(clip.g ?? 255),
      b: Number(clip.b ?? 255),
    },
    motion: {
      pan: Number(clip.pan || 0),
      tilt: Number(clip.tilt || 0),
      angle: Number(clip.angle || 0),
    },
    effects: clip.effects || [],
  }));
};
const TOOLBAR_BUTTON_STYLE = {
  height: 32,
  minWidth: 32,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid #1e293b",
  background: "#0f172a",
  color: "#cbd5e1",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  transition: "all 0.18s ease",
};

const TOOLBAR_SECTION_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  paddingRight: 14,
  marginRight: 14,
  borderRight: "1px solid rgba(148,163,184,0.18)",
};

const PRIMARY_IMPORT_BUTTON_STYLE = {
  ...TOOLBAR_BUTTON_STYLE,
  background: "linear-gradient(135deg,#14532d,#166534)",
  border: "1px solid #22c55e",
  color: "#dcfce7",
  boxShadow: "0 0 14px rgba(34,197,94,0.22)",
};

const PROFESSIONAL_TOOLBAR_GROUP_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.16)",
  background:
    "linear-gradient(180deg, rgba(15,23,42,0.92), rgba(2,6,23,0.72))",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 22px rgba(0,0,0,0.18)",
};

const PROFESSIONAL_TOOLBAR_LABEL_STYLE = {
  fontSize: 9,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#64748b",
  fontWeight: 800,
  marginRight: 2,
  whiteSpace: "nowrap",
};

const PROFESSIONAL_TIMELINE_BG =
  "linear-gradient(to right, rgba(148,163,184,0.10) 1px, transparent 1px), linear-gradient(180deg, #08111f 0%, #070d18 100%)";

const getClipVisualBackground = (clip, selectedClipId) => {
  const base = clip.color || "#00b7ff";

  if (clip.id === selectedClipId) {
    return "linear-gradient(135deg, #fff7ad 0%, #ffd166 48%, #f59e0b 100%)";
  }

  return `linear-gradient(135deg, ${base} 0%, ${base}dd 52%, #020617 145%)`;
};

const getClipVisualBorder = (clip, selectedClipId, snapFeedback) => {
  if (snapFeedback?.clipId === clip.id) {
    return snapFeedback.type === "beat"
      ? "2px solid #00ff88"
      : "2px solid #ff6b6b";
  }

  if (clip.id === selectedClipId) {
    return "2px solid rgba(255,255,255,0.95)";
  }

  return "1px solid rgba(125,211,252,0.72)";
};

const TRACK_VISUAL_COLORS = {
  water: "#00d4ff",
  lighting: "#fbbf24",
  motion: "#8b5cf6",
  fire: "#f97316",
  fog: "#64748b",
  laser: "#ec4899",
  sensor: "#22c55e",
  default: "#38bdf8",
};

const resolveTrackVisualColor = (track = {}) => {
  const runtime =
    String(track.runtimeType || "").toLowerCase();

  const category =
    String(track.category || "").toLowerCase();

  const type =
    String(track.type || track.trackType || "").toLowerCase();

  const combined = `${runtime} ${category} ${type}`;

  if (
    combined.includes("pump") ||
    combined.includes("water") ||
    combined.includes("jet")
  ) {
    return TRACK_VISUAL_COLORS.water;
  }

  if (
    combined.includes("light") ||
    combined.includes("rgb") ||
    combined.includes("lighting")
  ) {
    return TRACK_VISUAL_COLORS.lighting;
  }

  if (
    combined.includes("motion") ||
    combined.includes("pan") ||
    combined.includes("tilt") ||
    combined.includes("angle")
  ) {
    return TRACK_VISUAL_COLORS.motion;
  }

  if (
    combined.includes("fire") ||
    combined.includes("flame")
  ) {
    return TRACK_VISUAL_COLORS.fire;
  }

  if (
    combined.includes("fog") ||
    combined.includes("mist") ||
    combined.includes("smoke")
  ) {
    return TRACK_VISUAL_COLORS.fog;
  }

  if (
    combined.includes("laser")
  ) {
    return TRACK_VISUAL_COLORS.laser;
  }

  if (
    combined.includes("sensor")
  ) {
    return TRACK_VISUAL_COLORS.sensor;
  }

  return TRACK_VISUAL_COLORS.default;
};
const fmtTC = (sec) => {
  const s = Math.max(0, Number(sec || 0));
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2,"0")}:${r.toFixed(2).padStart(5,"0")}`;
};

export default function ShowProgrammerPanel() {
  // ── existing Team B state ──────────────────────────────────────────────
  const fixtures = useEngineeringStore((s) => s.fixtures);
  const devices  = useShowStore((s) => s.devices);
  const [timelineClips, setTimelineClips]   = useState([]);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [audioFile, setAudioFile]           = useState(null);
  const [audioBuffer, setAudioBuffer]       = useState(null);
  const [audioDuration, setAudioDuration]   = useState(120);
  const [currentTime, setCurrentTime]       = useState(0);
  const [zoom, setZoom]                     = useState(80);
  const [beatMarkers, setBeatMarkers]       = useState([]);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [draggingClip, setDraggingClip]     = useState(null);
  const [resizingClip, setResizingClip]     = useState(null);
  const [snapFeedback, setSnapFeedback]     = useState(null); // { clipId, type: 'beat'|'grid' }
  const [hoverTime, setHoverTime]             = useState(null);
  const [isPanning, setIsPanning]               = useState(false);
  const [followPlayhead, setFollowPlayhead]     = useState(false);
  const dragOffsetRef = useRef(0);
  const panStartRef = useRef({ x: 0, scrollLeft: 0 });
  const lastScrollLeftRef = useRef(0);
  const resizeStartRef = useRef({ clipId: null, startX: 0, initialDuration: 0, initialStartTime: 0 });
  const suppressNextRowClickRef = useRef(false);
  const shiftKeyRef = useRef(false);
  const lastDragUpdateRef = useRef({ x: 0, time: 0 });
  const audioElementRef = useRef(null);
  const rafIdRef = useRef(null);
  const lastPlayheadPushRef = useRef(-1);
  const timelineContainerRef = useRef(null);

  // ─── TEAM C: new state ─────────────────────────────────────────────────
  const bpmFromStore = useShowStore((s) => s.currentShow?.bpm || 128);
  const [rightTab, setRightTab] = useState("clip"); // clip | ai | cues
  const [cues, setCues]         = useState([]);
  const clipboardRef            = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);

  // ─── BACKEND PERSISTENCE STATE (Team B - Phase 1) ─────────────────────
  const [savedPrograms, setSavedPrograms] = useState([]);
  const [showProgramList, setShowProgramList] = useState(false);
  const [trackSearch, setTrackSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("all");
  const [denseMode, setDenseMode] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState(() => {
    const saved = localStorage.getItem('aquaflow_collapsed_categories');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  
  // ─── CATEGORY ORDER AND FUNCTION (defined ONCE here) ────────────────────
  const categoryOrder = ["Lighting", "Pumps", "Motion", "Fire", "Fog", "Lasers", "General"];
  
  const getCategoryFromTrack = (track) => {
    const type = String(track.type || "").toLowerCase();
    if (type.includes("lighting") || type.includes("rgb")) return "Lighting";
    if (type.includes("pump")) return "Pumps";
    if (type.includes("motion") || type.includes("pan") || type.includes("tilt") || type.includes("angle")) return "Motion";
    if (type.includes("fire") || type.includes("flame")) return "Fire";
    if (type.includes("fog") || type.includes("mist")) return "Fog";
    if (type.includes("laser")) return "Lasers";
    return "General";
  };
  
  const [backendAvailable, setBackendAvailable] = useState(null);
  const [isBackendAction, setIsBackendAction] = useState(false);
  const [currentProgramId, setCurrentProgramId] = useState(null);
  const [currentProgramName, setCurrentProgramName] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [validationModal, setValidationModal] = useState(null); // { errors: [], warnings: [], stats: {} }
  const [dryRunSession, setDryRunSession] = useState(null); // NEW: dry-run preview session
  const [dryRunPreviewActive, setDryRunPreviewActive] = useState(false); // NEW: preview mode flag
  const [isEngineeringImporting, setIsEngineeringImporting] = useState(false);
  const [validationReport, setValidationReport] = useState(null);
  const [showValidationModal, setShowValidationModal] = useState(false); 
  const [toast, setToast] = useState(null); // { type: "info"|"success"|"warning"|"error", message: string } 

  const notify = useCallback((message, type = "info") => { 
     setToast({ message, type }); 
     window.clearTimeout(window.__aquaflowToastTimer); 
     window.__aquaflowToastTimer = window.setTimeout(() => { 
        setToast(null); 
     }, 3200); 
  }, []);

  // ─── IMPORT VALIDATION FUNCTION ──────────────────────────────────────────
  const validateImportedData = () => {
    const engineeringFixtures = useEngineeringStore.getState().fixtures || [];

    const result = generateAutoTracks({
      fixtures: engineeringFixtures,
      devices: [],
    });

    const generatedTracks = Array.isArray(result?.tracks) ? result.tracks : [];
    const unsupportedFixtures = Array.isArray(result?.unsupportedFixtures)
      ? result.unsupportedFixtures
      : [];

    const now = Date.now();

    const simulatedClips = generatedTracks.map((track, index) => ({
      id: `validation_clip_${track.id}_${now}_${index}`,
      trackId: track.id,
      fixtureId: track.fixtureId,
      name: track.label || `Validation Clip ${index + 1}`,
      type: track.type,
      startTime: index * 2,
      duration: 2,
      value: 80,
      color: resolveTrackVisualColor(track),
      fadeIn: 0,
      fadeOut: 0,
      curveType: "linear",
      parameter: "intensity",
      pan: 0,
      tilt: 0,
      angle: 0,
      source: "validation-only",
      effects: [
        {
          type: "basic",
          startTime: 0,
          duration: 2,
          params: {
            value: 80,
          },
        },
      ],
    }));

    const clipIds = simulatedClips.map((clip) => clip.id);
    const duplicateClipIds = clipIds.filter((id, index) => clipIds.indexOf(id) !== index);

    const clipsMissingTrackId = simulatedClips.filter((clip) => !clip.trackId).length;
    const clipsMissingFixtureId = simulatedClips.filter((clip) => !clip.fixtureId).length;
    const clipsMissingType = simulatedClips.filter((clip) => !clip.type).length;
    const clipsInvalidDuration = simulatedClips.filter((clip) => !(Number(clip.duration) > 0)).length;
    const clipsInvalidStartTime = simulatedClips.filter((clip) => {
      const start = Number(clip.startTime);
      return !Number.isFinite(start) || start < 0;
    }).length;

    const unsupportedTypes = simulatedClips
      .filter((clip) => !clip.type || !TRACK_TYPE_COLORS[clip.type])
      .map((clip) => clip.type || "missing-type");

    const uniqueUnsupportedTypes = Array.from(new Set(unsupportedTypes));

    const readyReasons = [];

    if (engineeringFixtures.length === 0) {
      readyReasons.push("No engineering fixtures found.");
    }

    if (generatedTracks.length === 0) {
      readyReasons.push("No generated tracks were produced from the current engineering fixtures.");
    }

    if (simulatedClips.length === 0) {
      readyReasons.push("No validation clips could be simulated.");
    }

    if (clipsMissingTrackId > 0) {
      readyReasons.push(`${clipsMissingTrackId} clip(s) are missing trackId.`);
    }

    if (clipsMissingFixtureId > 0) {
      readyReasons.push(`${clipsMissingFixtureId} clip(s) are missing fixtureId.`);
    }

    if (clipsMissingType > 0) {
      readyReasons.push(`${clipsMissingType} clip(s) are missing type.`);
    }

    if (clipsInvalidDuration > 0) {
      readyReasons.push(`${clipsInvalidDuration} clip(s) have invalid duration.`);
    }

    if (clipsInvalidStartTime > 0) {
      readyReasons.push(`${clipsInvalidStartTime} clip(s) have invalid startTime.`);
    }

    if (duplicateClipIds.length > 0) {
      readyReasons.push(`${duplicateClipIds.length} duplicate clip ID(s) detected.`);
    }

    if (uniqueUnsupportedTypes.length > 0) {
      readyReasons.push(`${uniqueUnsupportedTypes.length} clip type(s) are not mapped to the current compiler/color set.`);
    }

    const readyForDryRun = readyReasons.length === 0;

    setValidationReport({
      fixturesFound: engineeringFixtures.length,
      tracksGenerated: generatedTracks.length,
      clipsCreated: simulatedClips.length,
      unsupportedTypes: uniqueUnsupportedTypes,
      unsupportedFixtures,
      clipsMissingTrackId,
      clipsMissingFixtureId,
      clipsMissingType,
      clipsInvalidDuration,
      clipsInvalidStartTime,
      duplicateClipIds,
      duplicateCount: duplicateClipIds.length,
      readyForDryRun,
      readyReasons,
    });

    setShowValidationModal(true);
  };

  // ── existing Team B: programmable tracks ──────────────────────────────
  const generatedTracksFromStore = useShowStore((s) => s.generatedTracks);
  
  const programmableTracks = useMemo(() => {
    // First, get tracks from fixtures/devices (existing behavior)
    const sourceItems = (fixtures && fixtures.length > 0) ? fixtures : devices;
    const tracks = [];
    
    (sourceItems || []).forEach((fx, index) => {
      const fxId    = fx.id || fx.deviceId || `item-${index}`;
      const fxLabel = fx.label || fx.name || fx.type || `Item ${index + 1}`;
      const fxType  = String(fx.type || fx.kind || "").toLowerCase();
      const category = getEquipmentCategory(fxType);
      
      // Track type mapping based on category
      if (category === "lighting") {
        tracks.push(
          { id: `${fxId}-master`, fixtureId: fxId, label: `${fxLabel} / Intensity`, type: "lighting_master" },
          { id: `${fxId}-red`,    fixtureId: fxId, label: `${fxLabel} / Red`,       type: "lighting_red" },
          { id: `${fxId}-green`,  fixtureId: fxId, label: `${fxLabel} / Green`,     type: "lighting_green" },
          { id: `${fxId}-blue`,   fixtureId: fxId, label: `${fxLabel} / Blue`,      type: "lighting_blue" }
        );
      } else if (category === "pump") {
        tracks.push(
          { id: `${fxId}-speed`,    fixtureId: fxId, label: `${fxLabel} / Speed`,    type: "pump_speed" },
          { id: `${fxId}-pressure`, fixtureId: fxId, label: `${fxLabel} / Pressure`, type: "pump_pressure" }
        );
      } else if (category === "motion_1d") {
        tracks.push(
          { id: `${fxId}-intensity`, fixtureId: fxId, label: `${fxLabel} / Intensity`, type: "motion_intensity" },
          { id: `${fxId}-angle`,     fixtureId: fxId, label: `${fxLabel} / Angle`,     type: "motion_angle" }
        );
      } else if (category === "motion_2d") {
        tracks.push(
          { id: `${fxId}-intensity`, fixtureId: fxId, label: `${fxLabel} / Intensity`, type: "motion_intensity" },
          { id: `${fxId}-pan`,       fixtureId: fxId, label: `${fxLabel} / Pan`,       type: "motion_pan" },
          { id: `${fxId}-tilt`,      fixtureId: fxId, label: `${fxLabel} / Tilt`,      type: "motion_tilt" }
        );
      } else if (category === "motion_3d") {
        tracks.push(
          { id: `${fxId}-intensity`, fixtureId: fxId, label: `${fxLabel} / Intensity`, type: "motion_intensity" },
          { id: `${fxId}-pan`,       fixtureId: fxId, label: `${fxLabel} / Pan`,       type: "motion_pan" },
          { id: `${fxId}-tilt`,      fixtureId: fxId, label: `${fxLabel} / Tilt`,      type: "motion_tilt" },
          { id: `${fxId}-angle`,     fixtureId: fxId, label: `${fxLabel} / Angle`,     type: "motion_angle" }
        );
      } else if (category === "solenoid") {
        tracks.push(
          { id: `${fxId}-open`,     fixtureId: fxId, label: `${fxLabel} / Open`,     type: "solenoid_open" },
          { id: `${fxId}-duration`, fixtureId: fxId, label: `${fxLabel} / Duration`, type: "solenoid_duration" }
        );
      } else if (category === "fire") {
        tracks.push(
          { id: `${fxId}-trigger`,   fixtureId: fxId, label: `${fxLabel} / Trigger`,   type: "fire_trigger" },
          { id: `${fxId}-intensity`, fixtureId: fxId, label: `${fxLabel} / Intensity`, type: "fire_intensity" }
        );
      } else if (category === "fog") {
        tracks.push({ id: `${fxId}-density`, fixtureId: fxId, label: `${fxLabel} / Density`, type: "fog_density" });
      } else if (category === "laser") {
        tracks.push(
          { id: `${fxId}-intensity`, fixtureId: fxId, label: `${fxLabel} / Intensity`, type: "laser_intensity" },
          { id: `${fxId}-pattern`,   fixtureId: fxId, label: `${fxLabel} / Pattern`,   type: "laser_pattern" }
        );
      } else {
        tracks.push(
          { id: `${fxId}-enable`,    fixtureId: fxId, label: `${fxLabel} / Enable`,    type: "device_enable" },
          { id: `${fxId}-intensity`, fixtureId: fxId, label: `${fxLabel} / Intensity`, type: "device_intensity" }
        );
      }
    });

    // Add generated tracks from store (if any) - these are engineering fixture tracks
    if (generatedTracksFromStore && generatedTracksFromStore.length > 0) {
      for (const genTrack of generatedTracksFromStore) {
        // Check if track already exists (avoid duplicates)
        const exists = tracks.some(t => t.id === genTrack.id);
        if (!exists) {
          tracks.push(genTrack);
        }
      }
    }
    
    return tracks;
  }, [fixtures, devices, generatedTracksFromStore]);

  // ─── FILTERED TRACKS (search + filter) ────────────────────────────────────
  const filteredTracks = useMemo(() => {
    let tracks = [...programmableTracks];
    
    // Apply search filter
    if (trackSearch) {
      const searchLower = trackSearch.toLowerCase();
      tracks = tracks.filter(track => 
        track.label.toLowerCase().includes(searchLower) ||
        track.type.toLowerCase().includes(searchLower)
      );
    }
    
    // Apply type filter
    if (trackFilter !== "all") {
      tracks = tracks.filter(track => track.type.includes(trackFilter));
    }
    
    return tracks;
  }, [programmableTracks, trackSearch, trackFilter]);

  // ─── CATEGORY GROUPING FOR TRACK LIST (using defined categoryOrder and getCategoryFromTrack) ───
  const groupedTracks = useMemo(() => {
    const groups = {};
    for (const cat of categoryOrder) {
      groups[cat] = [];
    }
    groups["Other"] = [];
    for (const track of filteredTracks) {
      const cat = getCategoryFromTrack(track);
      if (groups[cat]) {
        groups[cat].push(track);
      } else {
        groups["Other"].push(track);
      }
    }
    return groups;
  }, [filteredTracks, categoryOrder, getCategoryFromTrack]);
  
  const categoryCounts = useMemo(() => {
    const counts = {};
    for (const track of programmableTracks) {
      const cat = getCategoryFromTrack(track);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [programmableTracks, getCategoryFromTrack]);
  
  const toggleCategory = (category) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      localStorage.setItem('aquaflow_collapsed_categories', JSON.stringify([...next]));
      return next;
    });
  };

  const pushHistory = () => {
    undoStackRef.current.push({
      timelineClips: JSON.parse(JSON.stringify(timelineClips)),
      beatMarkers: JSON.parse(JSON.stringify(beatMarkers)),
      cues: JSON.parse(JSON.stringify(cues)),
    });

    redoStackRef.current = [];

    if (undoStackRef.current.length > 50) {
      undoStackRef.current.shift();
    }
  };

  const restoreHistoryState = (snapshot) => {
    setTimelineClips(snapshot.timelineClips || []);
    setBeatMarkers(snapshot.beatMarkers || []);
    setCues(snapshot.cues || []);
    setSelectedClipId(null);
  };

  const undoProgramEdit = () => {
    const last = undoStackRef.current.pop();
    if (!last) return;

    redoStackRef.current.push({
      timelineClips: JSON.parse(JSON.stringify(timelineClips)),
      beatMarkers: JSON.parse(JSON.stringify(beatMarkers)),
      cues: JSON.parse(JSON.stringify(cues)),
    });

    restoreHistoryState(last);
  };

  const redoProgramEdit = () => {
    const next = redoStackRef.current.pop();
    if (!next) return;

    undoStackRef.current.push({
      timelineClips: JSON.parse(JSON.stringify(timelineClips)),
      beatMarkers: JSON.parse(JSON.stringify(beatMarkers)),
      cues: JSON.parse(JSON.stringify(cues)),
    });

    restoreHistoryState(next);
  };

  // ── existing Team B: clip helpers ──────────────────────────────────────
  const createClip = (track, timeIndex) => {
    pushHistory();
    const newClip = {
      id: `clip-${Date.now()}`, trackId: track.id, fixtureId: track.fixtureId,
      name: `${track.label} Cue`, type: track.type,
      startTime: timeIndex, duration: 2, value: 100,
            color: resolveTrackVisualColor(track),

      // PROFESSIONAL CLIP MODEL FIELDS
      fadeIn: 0,
      fadeOut: 0,
      curveType: "linear",
      parameter: "intensity",

      // motion-ready fields
      pan: 0,
      tilt: 0,
      angle: 0,

      effects: [{
        type: "basic",
        startTime: 0,
        duration: 2,
        params: {
          value: 100,
        }
      }],
    };
    setTimelineClips((prev) => [...prev, newClip]);
    setSelectedClipId(newClip.id);
  };

  const updateClip = (clipId, updates) => {
    setTimelineClips((prev) => prev.map((c) => c.id === clipId ? { ...c, ...updates } : c));
  };

  const selectedClip = timelineClips.find((c) => c.id === selectedClipId) || null;

  const updateSelectedClip = (patch) => {
    if (!selectedClipId) return;
    setTimelineClips((prev) => prev.map((c) =>
      c.id === selectedClipId
        ? { ...c, ...patch, effects: [{ ...(c.effects?.[0] || {}), duration: patch.duration ?? c.duration, params: { ...(c.effects?.[0]?.params || {}), value: patch.value ?? c.value } }] }
        : c
    ));
  };

  const deleteSelectedClip = useCallback(() => {
    if (!selectedClipId) return;
    pushHistory();
    setTimelineClips((prev) => prev.filter((c) => c.id !== selectedClipId));
    setSelectedClipId(null);
  }, [selectedClipId]);

  // ── existing Team B: audio handlers ────────────────────────────────────
  const handleAudioUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioFile(file);
    const audioUrl = URL.createObjectURL(file);
    const audio = new Audio(audioUrl);
    audioElementRef.current = audio;
    audio.addEventListener("loadedmetadata", () => { setAudioDuration(audio.duration || 120); });
    audio.addEventListener("timeupdate", () => {
      const t = audio.currentTime || 0;
      setCurrentTime(t);
      // Push to shared store so PreviewPanel receives the playhead position
      if (typeof useShowStore.getState?.().setPlayhead === "function") {
        useShowStore.getState().setPlayhead(t);
      }
    });
    const arrayBuffer  = await file.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const decoded      = await audioContext.decodeAudioData(arrayBuffer);
    setAudioBuffer(decoded);
  };

  const togglePlayback = useCallback(() => {
    if (!audioElementRef.current) {
      notify("Audio file required for transport playback. Dry-run preview can compile without audio.", "warning");
      return;
    }

    audioElementRef.current.paused
      ? audioElementRef.current.play()
      : audioElementRef.current.pause();
  }, [notify]);


  useEffect(() => {
    const drivePlayhead = () => {
      const audio = audioElementRef.current;

      if (audio) {
        // Skip updates when paused to save CPU
        if (audio.paused) {
          rafIdRef.current = requestAnimationFrame(drivePlayhead);
          return;
        }
        const t = audio.currentTime || 0;

        if (Math.abs(t - lastPlayheadPushRef.current) >= 0.016) {
          lastPlayheadPushRef.current = t;
          setCurrentTime(t);

          if (typeof useShowStore.getState?.().setPlayhead === "function") {
            useShowStore.getState().setPlayhead(t);
          }
        }
      }

      rafIdRef.current = requestAnimationFrame(drivePlayhead);
    };

    rafIdRef.current = requestAnimationFrame(drivePlayhead);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const handleSeek = (time) => {
    if (audioElementRef.current) audioElementRef.current.currentTime = time;
    setCurrentTime(time);
    // Sync shared store for PreviewPanel
    if (typeof useShowStore.getState?.().setPlayhead === "function") {
      useShowStore.getState().setPlayhead(time);
    }
    // Sync dry-run session queue if active
    const activeSession =
      dryRunSession ||
      (typeof window !== "undefined" ? window.__dryRunSession : null);

    if (activeSession?.seek) {
      activeSession.seek(time);
    }
  };

  const addBeatMarker    = (time, bpm) => setBeatMarkers((prev) => [...prev, { time, bpm }]);
  const removeBeatMarker = (index)     => setBeatMarkers((prev) => prev.filter((_, i) => i !== index));
  const moveBeatMarker   = (index, newTime) =>
    setBeatMarkers((prev) => prev.map((b, i) => i === index ? { ...b, time: newTime } : b));

  // ─── TEAM C: keyboard shortcuts ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.tagName === "SELECT" ||
        e.target.isContentEditable
      ) return;
      const ctrl = e.ctrlKey || e.metaKey;

      // Space → play/pause
      if (e.key === " " && !ctrl) { e.preventDefault(); togglePlayback(); return; }

      // Delete / Backspace → delete selected clip
      if ((e.key === "Delete" || e.key === "Backspace") && !ctrl) {
        e.preventDefault(); // prevent browser back-navigation on Backspace
        deleteSelectedClip(); return;
      }

      // Ctrl+Z → undo
      if (ctrl && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undoProgramEdit();
        return;
      }

      // Ctrl+Y or Ctrl+Shift+Z → redo
      if ((ctrl && e.key.toLowerCase() === "y") || (ctrl && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        redoProgramEdit();
        return;
      }
      // Ctrl+C → copy selected clip
      if (ctrl && e.key.toLowerCase() === "c" && selectedClip) {
        clipboardRef.current = {
          ...selectedClip,
          effects: (selectedClip.effects || []).map(ef => ({ ...ef, params: { ...(ef.params || {}) } })),
        };
        return;
      }

      // Ctrl+V → paste at current time
      if (ctrl && e.key.toLowerCase() === "v" && clipboardRef.current) {
        const src = clipboardRef.current;
        const pasted = {
          ...src,
          id: `clip-${Date.now()}`,
          startTime: currentTime,
          name: src.name + " (copy)",
          effects: (src.effects || []).map(ef => ({ ...ef, params: { ...(ef.params || {}) } })),
        };
        setTimelineClips((prev) => [...prev, pasted]);
        setSelectedClipId(pasted.id);
        return;
      }

      // Ctrl+D → duplicate
      if (ctrl && e.key.toLowerCase() === "d" && selectedClip) {
        e.preventDefault();
        const dup = {
          ...selectedClip,
          id: `clip-${Date.now()}`,
          startTime: selectedClip.startTime + selectedClip.duration + 0.1,
          effects: (selectedClip.effects || []).map(ef => ({ ...ef, params: { ...(ef.params || {}) } })),
        };
        setTimelineClips((prev) => [...prev, dup]);
        setSelectedClipId(dup.id);
        return;
      }

      // Arrow keys → nudge selected clip ±0.1s (±1s with Shift)
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && selectedClip) {
        e.preventDefault();
        const delta = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 1.0 : 0.1);
        updateSelectedClip({ startTime: Math.max(0, selectedClip.startTime + delta) });
      }

      // ? key → toggle help modal
      if (e.key === "?" && !ctrl) {
        e.preventDefault();
        setShowShortcuts(prev => !prev);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedClip, currentTime, deleteSelectedClip, togglePlayback]);

  // ─── LOCAL SAVE / LOAD ─────────────────────────────────────────────────
const saveLocalProgram = () => {
  // Get generatedTracks from showStore
  const generatedTracks = useShowStore.getState().generatedTracks || [];
  
  const payload = {
    timelineClips,
    beatMarkers,
    cues,
    zoom,
    audioDuration,
    generatedTracks: generatedTracks,
    savedAt: new Date().toISOString(),
  };

  localStorage.setItem(
    SHOW_PROGRAMMER_STORAGE_KEY,
    JSON.stringify(payload)
  );

  alert("Show Programmer saved locally.");
};

const loadLocalProgram = () => {
  const raw = localStorage.getItem(SHOW_PROGRAMMER_STORAGE_KEY);

  if (!raw) {
    alert("No saved local show program found.");
    return;
  }

  try {
    const payload = JSON.parse(raw);

    setTimelineClips(Array.isArray(payload.timelineClips) ? payload.timelineClips : []);
    setBeatMarkers(Array.isArray(payload.beatMarkers) ? payload.beatMarkers : []);
    setCues(Array.isArray(payload.cues) ? payload.cues : []);
    setZoom(Number(payload.zoom || 80));
    setAudioDuration(Number(payload.audioDuration || 120));
    setSelectedClipId(null);

    if (payload.generatedTracks) {
      useShowStore.getState().setGeneratedTracks(payload.generatedTracks);
    }

    alert("Show Programmer loaded locally.");
  } catch (err) {
    console.error("Failed to load local show program:", err);
    alert("Saved local program is damaged and could not be loaded.");
  }
};

const exportProgramJson = () => {
  const estimatedDuration = timelineClips.length
    ? Math.max(
        ...timelineClips.map(
          (clip) => Number(clip.startTime || 0) + Number(clip.duration || 0)
        )
      )
    : 0;

  const payload = {
    version: "aquaflow-show-programmer-v1",
    schemaVersion: "1.0.0",
    fileType: "aquaflow-show-program",
    metadata: {
      title: currentProgramName || "Untitled Show Program",
      bpm: bpmFromStore,
      audioDuration,
      estimatedDuration,
      clipCount: timelineClips.length,
      cueCount: cues.length,
      beatMarkerCount: beatMarkers.length,
      exportedAt: new Date().toISOString(),
    },
    timelineClips,
    beatMarkers,
    cues,
    zoom,
    audioDuration,
    bpm: bpmFromStore,
    generatedTracks: useShowStore.getState().generatedTracks || [],
    exportedAt: new Date().toISOString(),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `aquaflow-show-program-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

const importProgramJson = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const payload = JSON.parse(text);

    pushHistory();
    setTimelineClips(Array.isArray(payload.timelineClips) ? payload.timelineClips : []);
    setBeatMarkers(Array.isArray(payload.beatMarkers) ? payload.beatMarkers : []);
    setCues(Array.isArray(payload.cues) ? payload.cues : []);
    setZoom(Number(payload.zoom || 80));
    setAudioDuration(Number(payload.audioDuration || 120));
    setSelectedClipId(null);

    if (payload.generatedTracks) {
      useShowStore.getState().setGeneratedTracks(payload.generatedTracks);
    }

    alert("Show program imported successfully.");
  } catch (err) {
    console.error("Import failed:", err);
    alert("Could not import this show program file.");
  } finally {
    e.target.value = "";
  }
};

const clearLocalProgram = () => {
  const confirmed = window.confirm(
    "Clear all current clips, cues, and beat markers?"
  );

  if (!confirmed) return;
  pushHistory();

  setTimelineClips([]);
  setBeatMarkers([]);
  setCues([]);
  setSelectedClipId(null);
  setSelectedRegion(null);
  useShowStore.getState().setGeneratedTracks([]);
  localStorage.removeItem(SHOW_PROGRAMMER_STORAGE_KEY);
};

  // ─── BACKEND PERSISTENCE FUNCTIONS (Team B - Phase 1) ─────────────────
  
  // Test backend connection on component mount
  useEffect(() => {
    const checkBackend = async () => {
      const available = await testBackendConnection();
      setBackendAvailable(available);
      if (available) {
        refreshProgramList();
      }
    };
    checkBackend();
  }, []);

  // Refresh the list of saved programs
  const refreshProgramList = async () => {
    if (!backendAvailable) return;
    const result = await listPrograms();
    if (result.success) {
      setSavedPrograms(result.programs);
    }
  };

  // Save current program to backend
  const handleBackendSave = async (name) => {
    if (!backendAvailable) {
      alert("Backend is not available. Use local Save instead.");
      return;
    }
    
    setIsBackendAction(true);
    try {
      const payload = {
        name: name || `Show-${Date.now()}`,
        timelineClips,
        beatMarkers,
        cues,
        zoom,
        audioDuration,
        audioFile: audioFile ? audioFile.name : null,
      };
      
      const result = await saveProgramToBackend(payload);
      
      if (result.success) {
        setCurrentProgramId(result.programId);
        setCurrentProgramName(result.name);
        setHasUnsavedChanges(false);
        alert(`✅ Program "${result.name}" saved to backend!`);
        await refreshProgramList();
      } else {
        alert(`❌ Failed to save: ${result.error}`);
      }
    } catch (error) {
      console.error('Backend save error:', error);
      alert('❌ Error saving to backend.');
    } finally {
      setIsBackendAction(false);
    }
  };

  // Load a program from backend by ID
  const handleBackendLoad = async (programId, programName) => {
    // Check for unsaved changes
    if (hasUnsavedChanges && (timelineClips.length > 0 || beatMarkers.length > 0 || cues.length > 0)) {
      const confirmLoad = window.confirm(
        "You have unsaved changes. Load anyway? (Current timeline will be replaced)"
      );
      if (!confirmLoad) return;
    }
    
    setIsBackendAction(true);
    try {
      const result = await loadProgramFromBackend(programId);
      
      if (result.success && result.program) {
        // Push current state to undo stack before loading
        pushHistory();
        
        // Restore the saved state
        setTimelineClips(result.program.timelineClips || []);
        setBeatMarkers(result.program.beatMarkers || []);
        setCues(result.program.cues || []);
        setZoom(result.program.zoom || 80);
        setAudioDuration(result.program.audioDuration || 120);
        setSelectedClipId(null);
        setSelectedRegion(null);
        
        // Track the loaded program
        setCurrentProgramId(programId);
        setCurrentProgramName(result.program.name);
        setHasUnsavedChanges(false);
        
        alert(`✅ Program "${result.program.name}" loaded successfully!`);
        setShowProgramList(false);
      } else {
        alert(`❌ Failed to load: ${result.error}`);
      }
    } catch (error) {
      console.error('Backend load error:', error);
      alert('❌ Error loading from backend.');
    } finally {
      setIsBackendAction(false);
    }
  };

  // Delete a program from backend
  const handleBackendDelete = async (programId, programName) => {
    if (!window.confirm(`Delete "${programName}" permanently?`)) return;
    
    setIsBackendAction(true);
    try {
      const result = await deleteProgramFromBackend(programId);
      
      if (result.success) {
        alert(`✅ Program "${programName}" deleted.`);
        
        // Clear current program if it was deleted
        if (currentProgramId === programId) {
          setCurrentProgramId(null);
          setCurrentProgramName(null);
        }
        
        await refreshProgramList();
      } else {
        alert(`❌ Failed to delete: ${result.error}`);
      }
    } catch (error) {
      console.error('Backend delete error:', error);
      alert('❌ Error deleting from backend.');
    } finally {
      setIsBackendAction(false);
    }
  };

  // Compile program to runtime events
  const handleCompile = async () => {
    if (timelineClips.length === 0) {
      alert("No clips to compile. Add clips to the timeline first.");
      return;
    }
    
    setIsBackendAction(true);
    try {
      const runtimeEvents = compileClipsToRuntimeEvents(timelineClips);
      const payload = {
        events: runtimeEvents,
        duration: audioDuration,
        bpm: bpmFromStore,
      };
      
      const result = await compileProgram(payload);
      
      if (result.success) {
        alert(`✅ Compilation successful! ${result.eventCount || runtimeEvents.length} events compiled.`);
        return result;
      } else {
        alert(`❌ Compilation failed: ${result.error}`);
        return null;
      }
    } catch (error) {
      console.error('Compile error:', error);
      alert('❌ Error during compilation.');
      return null;
    } finally {
      setIsBackendAction(false);
    }
  };

  // Show program list modal/dropdown
  const toggleProgramList = async () => {
    if (!showProgramList) {
      await refreshProgramList();
    }
    setShowProgramList(!showProgramList);
  };
  // ─── DRY-RUN PREVIEW FUNCTION ─────────────────────────────────────────────
const startDryRunPreview = async () => {
  if (timelineClips.length === 0) {
    alert("No clips to preview. Add clips to the timeline first.");
    return;
  }
  
  setIsBackendAction(true);
  
  try {
    // Build device registry
    const deviceRegistry = {};
    for (const track of programmableTracks) {
      if (track.fixtureId) {
        deviceRegistry[track.fixtureId] = {
          deviceId: track.fixtureId,
          deviceType: track.type.split('_')[0] || 'generic',
          protocol: 'relay',
          latencyMs: 0,
        };
      }
    }
    
    // Create preview session
    const session = await createDryRunPreviewSession({
      timelineClips: timelineClips,
      deviceRegistry: deviceRegistry,
      audioDuration: audioDuration,
      bpm: bpmFromStore,
      beatMarkers: beatMarkers,
      cues: cues,
    });
    
    if (!session.success) {
      console.error('[DryRun] Preview session failed:', session.errors);
      alert(`Preview failed: ${session.errors.join(', ')}`);
      setDryRunSession(null);
      setDryRunPreviewActive(false);
      return;
    }
    
    // Store session for preview panel
    setDryRunSession(session);
    setDryRunPreviewActive(true);
    
    // Expose globally for Preview Panel
      // ─── Expose globally for Preview Panel with cleanup ─────────────────
      if (typeof window !== 'undefined') {
        // Clean up previous session first
        if (window.__dryRunSession && window.__dryRunSession._cleanup) {
          window.__dryRunSession._cleanup();
        }
        // Add cleanup method to session
        session._cleanup = () => {
          if (window.__dryRunSession === session) {
            window.__dryRunSession = null;
          }
        };
        window.__dryRunSession = session;
      }
    
    console.log(`[DryRun] Preview session created: ${session.eventCount} events`);
    alert(`✅ Dry-run preview ready!\n\n${session.eventCount} events compiled\nDuration: ${session.duration.toFixed(1)}s`);
    
  } catch (error) {
    console.error('[DryRun] Preview error:', error);
    alert(`Preview error: ${error.message}`);
    setDryRunSession(null);
    setDryRunPreviewActive(false);
  } finally {
    setIsBackendAction(false);
  }
};
  
  const stopDryRunPreview = () => {
    const activeSession =
      dryRunSession ||
      (typeof window !== "undefined" ? window.__dryRunSession : null);

    if (activeSession?.cleanup) {
      activeSession.cleanup();
    }

    if (activeSession?._cleanup) {
      activeSession._cleanup();
    }

    setDryRunSession(null);
    setDryRunPreviewActive(false);

    if (typeof window !== "undefined") {
      window.__dryRunSession = null;
    }

    notify("Dry-run preview stopped and cleaned up.", "info");
    console.log("[DryRun] Preview session stopped and cleaned up");
  };
  
  const runValidation = () => {
    const errors = [];
    const warnings = [];

    // Clip validation
    timelineClips.forEach((clip) => {
      if (!clip.trackId) errors.push(`Clip "${clip.name || clip.id}" has no track assignment.`);
      if (clip.duration < 0.1) errors.push(`Clip "${clip.name || clip.id}" duration is too short (${clip.duration.toFixed(2)}s).`);
      if (clip.startTime < 0) errors.push(`Clip "${clip.name || clip.id}" starts before 0s.`);
      if (clip.startTime + clip.duration > audioDuration) {
        warnings.push(`Clip "${clip.name || clip.id}" extends past audio end (${fmtTC(clip.startTime + clip.duration)} > ${fmtTC(audioDuration)}).`);
      }
      if (clip.value === undefined || clip.value === null) {
        warnings.push(`Clip "${clip.name || clip.id}" has no value set.`);
      }
    });

    // Overlap check
    const trackGroups = {};
    timelineClips.forEach((c) => {
      if (!trackGroups[c.trackId]) trackGroups[c.trackId] = [];
      trackGroups[c.trackId].push(c);
    });
    Object.entries(trackGroups).forEach(([trackId, clips]) => {
      const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (curr.startTime < prev.startTime + prev.duration) {
          warnings.push(`Overlap on track ${trackId}: "${prev.name || prev.id}" and "${curr.name || curr.id}".`);
        }
      }
    });

    // Cue validation
    cues.forEach((cue, i) => {
      if (cue.time < 0) errors.push(`Cue ${cue.number} time is negative.`);
      if (cue.time > audioDuration) warnings.push(`Cue ${cue.number} is past audio end.`);
    });

    // Beat marker validation
    beatMarkers.forEach((bm, i) => {
      if (bm.time < 0) errors.push(`Beat marker ${i + 1} time is negative.`);
      if (bm.time > audioDuration) warnings.push(`Beat marker ${i + 1} is past audio end.`);
    });

    // General checks
    if (timelineClips.length === 0) warnings.push("Timeline is empty — no clips to compile.");
    if (cues.length === 0) warnings.push("No cues defined.");
    if (beatMarkers.length === 0) warnings.push("No beat markers set.");

    const estimatedDuration = timelineClips.length
      ? Math.max(
          ...timelineClips.map(
            (clip) => Number(clip.startTime || 0) + Number(clip.duration || 0)
          )
        )
      : 0;

    const criticalErrorCount = errors.length;
    const warningCount = warnings.length;

    const validationStatus =
      criticalErrorCount > 0
        ? "INVALID"
        : warningCount > 0
          ? "VALID WITH WARNINGS"
          : "VALID";

    setValidationModal({
      errors,
      warnings,
      stats: {
        clips: timelineClips.length,
        cues: cues.length,
        beatMarkers: beatMarkers.length,
        duration: audioDuration,
        estimatedDuration,
        bpm: bpmFromStore,
        validationStatus,
        criticalErrorCount,
        warningCount,
      },
    });
  };

  // ─── PLAYHEAD AUTO-SCROLL ───────────────────────────────────────────────
  useEffect(() => {
    if (!followPlayhead || !audioElementRef.current) return;
    const container = timelineContainerRef.current;
    if (!container) return;
    const scrollTarget = (currentTime * zoom) - (container.clientWidth / 2);
    container.scrollLeft = Math.max(0, scrollTarget);
  }, [currentTime, zoom, followPlayhead]);

  // ─── AUTO LOAD SAVED PROGRAM ON STARTUP ────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem(SHOW_PROGRAMMER_STORAGE_KEY);

    if (!raw) return;

    try {
      const payload = JSON.parse(raw);

      setTimelineClips(Array.isArray(payload.timelineClips) ? payload.timelineClips : []);
      setBeatMarkers(Array.isArray(payload.beatMarkers) ? payload.beatMarkers : []);
      setCues(Array.isArray(payload.cues) ? payload.cues : []);
      setZoom(Number(payload.zoom || 80));
      setAudioDuration(Number(payload.audioDuration || 120));
    } catch (err) {
      console.error("Auto-load failed:", err);
    }
  }, []);

  // ─── TEAM C: track list helpers ─────────────────────────────────────────
  const trackCategories = useMemo(() => {
    const cats = {};
    programmableTracks.forEach(track => {
      const cat = track.type.split("_")[0] || "other";
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(track);
    });
    return cats;
  }, [programmableTracks]);

  const categoryLabels = {
    lighting: "Lighting",
    pump: "Pumps",
    solenoid: "Valves",
    fire: "Fire",
    fog: "Fog/Mist",
    laser: "Lasers",
    motion_1d: "Motion 1D",
    motion_2d: "Motion 2D",
    motion_3d: "Motion 3D",
    device: "General",
  };

  const expandAllCategories = () => setCollapsedCategories(new Set());
  const collapseAllCategories = () => setCollapsedCategories(new Set(Object.keys(trackCategories)));

  // ─── TEAM C: cue management ─────────────────────────────────────────────
  const addCue = () => {
    const n = { id: `cue-${Date.now()}`, number: cues.length + 1, label: `Cue ${cues.length + 1}`, time: currentTime, color: "#00d4ff" };
    setCues((prev) => [...prev, n].sort((a, b) => a.time - b.time));
  };
  const removeCue = (id) => setCues((prev) => prev.filter((c) => c.id !== id));
  const goCue = () => {
    const next = cues.find((c) => c.time > currentTime);
    if (next) handleSeek(next.time);
  };

  // ─── TEAM C: right panel tabs config ────────────────────────────────────
  const RIGHT_TABS = [
    { key: "clip", label: "Clip",  icon: "◈" },
    { key: "ai",   label: "AI",    icon: "✨" },
    { key: "cues", label: "Cues",  icon: "▶" },
  ];

const importFromEngineering = () => {
  if (isEngineeringImporting) return;

  setIsEngineeringImporting(true);

  if (timelineClips.length > 0) {
    const confirmed = window.confirm(
      `Importing engineering fixtures will replace the current ${timelineClips.length} timeline clip(s).\n\nContinue?`
    );
    if (!confirmed) {
      notify("Engineering import cancelled. Existing timeline clips were preserved.", "info");
      setIsEngineeringImporting(false);
      return;
    }
  }

  window.setTimeout(() => {
    try {
      const engineeringFixtures = useEngineeringStore.getState().fixtures || [];

      if (engineeringFixtures.length === 0) {
        notify("No fixtures found in Engineering Designer. Please add fixtures first.", "warning");
        return;
      }

      if (engineeringFixtures.length > 100) {
        notify(`Large fixture count detected: ${engineeringFixtures.length}. Dense mode is recommended.`, "warning");
        setDenseMode(true);
      }

      const result = generateAutoTracks({
        fixtures: engineeringFixtures,
        devices: [],
      });

      const tracks = result?.tracks || [];

      if (tracks.length === 0) {
        notify("No compatible tracks could be generated from these fixtures.", "error");
        return;
      }

      const now = Date.now();

      const newClips = tracks.map((track, index) => ({
        id: `engclip_${track.id}_${now}_${index}`,
        trackId: track.id,
        fixtureId: track.fixtureId,
        name: track.label || `Engineering Clip ${index + 1}`,
        type: track.type,
        startTime: index * 2,
        duration: 2,
        value: 80,
        color: resolveTrackVisualColor(track),
        fadeIn: 0,
        fadeOut: 0,
        curveType: "linear",
        parameter: "intensity",
        pan: 0,
        tilt: 0,
        angle: 0,
        source: "engineering-import",
        effects: [
          {
            type: "basic",
            startTime: 0,
            duration: 2,
            params: {
              value: 80,
            },
          },
        ],
      }));

      setTimelineClips(newClips);
      setSelectedClipId(newClips[0]?.id || null);

      // ─── IMPORT SUMMARY ──────────────────────────────────────────────────
      const fixtureCount = engineeringFixtures.length;
      const trackCount = tracks.length;
      const clipCount = newClips.length;
      const skippedCount = result?.unsupportedFixtures?.length || 0;

      const summaryLines = [
        `📊 IMPORT SUMMARY`,
        `━━━━━━━━━━━━━━━━━━━━━`,
        `📦 Fixtures found:     ${fixtureCount}`,
        `🎚️ Tracks created:     ${trackCount}`,
        `🎬 Clips created:      ${clipCount}`,
        `⚠️ Skipped fixtures:   ${skippedCount}`,
        `━━━━━━━━━━━━━━━━━━━━━`,
        `✅ Status: ${skippedCount > 0 ? 'PARTIAL' : 'COMPLETE'}`,
        `📌 ${clipCount} clips placed on timeline`,
      ];

      if (skippedCount > 0) {
        summaryLines.push(`💡 ${skippedCount} fixture(s) had no compatible track mapping.`);
      }

      notify(summaryLines.join('\n'), skippedCount > 0 ? "warning" : "success");
      console.log('[Engineering Import] Summary:', {
        fixtures: fixtureCount,
        tracks: trackCount,
        clips: clipCount,
        skipped: skippedCount,
      });
      // ─── END IMPORT SUMMARY ─────────────────────────────────────────────

    } finally {
      setIsEngineeringImporting(false);
    }
  }, 80);
};

  return (
    <div style={{ width: "100%", height: "100%", background: "#0b0f14", color: "#d7e3f4", display: "flex", flexDirection: "column" }}>

      {/* ── HEADER (Team B — unchanged, TEAM C: added timecode) ─────── */}
      <div style={{ height: 48, borderBottom: "1px solid #1d2733", display: "flex", alignItems: "center", padding: "0 16px", background: "#111827", flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>AquaFlow Professional Show Programmer</div>
        <div style={{ marginLeft: 18, opacity: 0.7, fontSize: 12 }}>Manual Timeline + AI Assisted Choreography</div>
        {/* ─── TEAM C: timecode display */}
        <div style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 18, fontWeight: "bold", color: audioElementRef.current && !audioElementRef.current.paused ? "#00ff88" : "#e8f4ff", letterSpacing: "0.05em" }}>
          {fmtTC(currentTime)}
        </div>
        <div style={{ marginLeft: 12, fontSize: 10, color: "#556677", fontFamily: "monospace" }}>{bpmFromStore} BPM</div>
        {/* KEYBOARD SHORTCUTS HELP */}
        <button
          onClick={() => setShowShortcuts(true)}
          style={{
            marginLeft: 12,
            width: 28,
            height: 28,
            borderRadius: 14,
            border: "1px solid #4b5563",
            background: "#1f2937",
            color: "#9ca3af",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Keyboard shortcuts (press ?)"
        >
          ?
        </button>
        {/* FOLLOW PLAYHEAD TOGGLE */}
        <button
          onClick={() => setFollowPlayhead(!followPlayhead)}
          style={{
            marginLeft: 12,
            padding: "4px 10px",
            fontSize: 10,
            borderRadius: 4,
            cursor: "pointer",
            border: `1px solid ${followPlayhead ? "#00b7ff" : "#4b5563"}`,
            background: followPlayhead ? "rgba(0,183,255,0.15)" : "#1f2937",
            color: followPlayhead ? "#00b7ff" : "#9ca3af",
          }}
        >
          {followPlayhead ? "◉ Follow" : "◎ Follow"}
        </button>
      </div>

      {/* ── PROFESSIONAL TOOLBAR — TEAM E VISUAL PASS ONLY ───────────── */}
      <div
        style={{
          minHeight: 92,
          borderBottom: "1px solid rgba(148,163,184,0.16)",
          background: "linear-gradient(180deg,#0d1520 0%,#080e18 100%)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          flexShrink: 0,
          flexWrap: "wrap",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
        }}
      >
        <div style={PROFESSIONAL_TOOLBAR_GROUP_STYLE}>
          <span style={PROFESSIONAL_TOOLBAR_LABEL_STYLE}>Transport</span>
          <input
            type="file"
            accept="audio/*"
            onChange={handleAudioUpload}
            style={{ color: "#d7e3f4", fontSize: 12, maxWidth: 170 }}
          />
          <button
            onClick={togglePlayback}
            style={{
              ...TOOLBAR_BUTTON_STYLE,
              background: "linear-gradient(135deg,#38bdf8,#0284c7)",
              color: "#041018",
              border: "1px solid #7dd3fc",
              fontWeight: 800,
              boxShadow: "0 0 16px rgba(56,189,248,0.22)",
            }}
          >
            ▶ Play / Pause
          </button>
          <div style={{ fontSize: 11, opacity: 0.78, fontFamily: "monospace" }}>
            {currentTime.toFixed(2)}s
          </div>
          <div style={{ fontSize: 11, opacity: 0.58, fontFamily: "monospace" }}>
            / {audioDuration.toFixed(2)}s
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Zoom</div>
          <input
            type="range"
            min="40"
            max="240"
            value={zoom}
            onChange={(e) => {
              const newZoom = Number(e.target.value);
              const container = timelineContainerRef.current;

              if (container) {
                const containerWidth = container.clientWidth;
                const scrollTarget =
                  currentTime * newZoom - containerWidth / 2;

                container.scrollLeft = Math.max(0, scrollTarget);
              }

              setZoom(newZoom);
            }}
          />
        </div>

        <div style={PROFESSIONAL_TOOLBAR_GROUP_STYLE}>
          <span style={PROFESSIONAL_TOOLBAR_LABEL_STYLE}>Save / Load</span>
          <button onClick={undoProgramEdit} style={TOOLBAR_BUTTON_STYLE}>
            ↶ Undo
          </button>
          <button onClick={redoProgramEdit} style={TOOLBAR_BUTTON_STYLE}>
            ↷ Redo
          </button>
          <button
            onClick={saveLocalProgram}
            title="Save show to browser local storage (Ctrl+S)"
            style={{
              ...TOOLBAR_BUTTON_STYLE,
              background: "linear-gradient(135deg,#14532d,#166534)",
              color: "#d1fae5",
              border: "1px solid #22c55e",
            }}
          >
            Save
          </button>
          <button
            onClick={loadLocalProgram}
            title="Load show from browser local storage"
            style={{
              ...TOOLBAR_BUTTON_STYLE,
              background: "linear-gradient(135deg,#1e3a8a,#1d4ed8)",
              color: "#dbeafe",
              border: "1px solid #3b82f6",
            }}
          >
            Load
          </button>
          <button
            onClick={exportProgramJson}
            title="Export show as JSON file"
            style={{
              ...TOOLBAR_BUTTON_STYLE,
              background: "linear-gradient(135deg,#312e81,#4338ca)",
              color: "#e0e7ff",
              border: "1px solid #6366f1",
            }}
          >
            Export
          </button>
          <label
            title="Import a JSON show file from your computer"
            style={{
              ...TOOLBAR_BUTTON_STYLE,
              background: "linear-gradient(135deg,#713f12,#92400e)",
              color: "#fef3c7",
              border: "1px solid #f59e0b",
            }}
          >
            Import
            <input
              type="file"
              accept="application/json"
              onChange={importProgramJson}
              style={{ display: "none" }}
            />
          </label>
          <button
            onClick={clearLocalProgram}
            title="Clear all clips, cues and beat markers"
            style={{
              ...TOOLBAR_BUTTON_STYLE,
              background: "linear-gradient(135deg,#7f1d1d,#991b1b)",
              color: "#fee2e2",
              border: "1px solid #ef4444",
            }}
          >
            Clear
          </button>
        </div>

        <div style={PROFESSIONAL_TOOLBAR_GROUP_STYLE}>
          <span style={PROFESSIONAL_TOOLBAR_LABEL_STYLE}>Engineering</span>
          <button
            onClick={importFromEngineering}
            disabled={fixtures.length === 0}
            style={{
              ...PRIMARY_IMPORT_BUTTON_STYLE,
              cursor: fixtures.length === 0 ? "not-allowed" : "pointer",
              opacity: fixtures.length === 0 ? 0.5 : 1,
            }}
            title="Import fixtures from Engineering Designer as timeline tracks"
          >
            📥 Eng Fixtures
          </button>
          <button
            onClick={validateImportedData}
            style={{
              ...TOOLBAR_BUTTON_STYLE,
              background: "linear-gradient(135deg,#1e3a8a,#2563eb)",
              border: "1px solid #3b82f6",
              color: "#dbeafe",
            }}
            title="Validate imported fixtures, tracks, and clips"
          >
            ✅ Validate Import
          </button>
        </div>

        <div style={PROFESSIONAL_TOOLBAR_GROUP_STYLE}>
          <span style={PROFESSIONAL_TOOLBAR_LABEL_STYLE}>Validation</span>
          <button
            onClick={() =>
              alert("Backend Save is temporarily disabled. Use local Save for now.")
            }
            style={{
              ...TOOLBAR_BUTTON_STYLE,
              background: "#374151",
              color: "#d1d5db",
              border: "1px solid #6b7280",
            }}
            title="Backend Save is paused during Phase 1 stabilization."
          >
            💾 Backend Save Paused
          </button>
          <div
            style={{
              fontSize: 10,
              color: "#9ca3af",
              background: "#111827",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "7px 9px",
              whiteSpace: "nowrap",
            }}
            title="Backend Save and Runtime Compile are paused during stabilization"
          >
            Stabilization Mode
          </div>
          <button
            onClick={runValidation}
            style={{
              ...TOOLBAR_BUTTON_STYLE,
              background: "linear-gradient(135deg,#374151,#111827)",
              color: "#d1d5db",
              border: "1px solid #6b7280",
            }}
            title="Run validation check"
          >
            🔍 Validate Show
          </button>
        </div>

        <div style={PROFESSIONAL_TOOLBAR_GROUP_STYLE}>
          <span style={PROFESSIONAL_TOOLBAR_LABEL_STYLE}>Preview</span>
          <button
            onClick={dryRunPreviewActive ? stopDryRunPreview : startDryRunPreview}
            disabled={isBackendAction}
            style={{
              ...TOOLBAR_BUTTON_STYLE,
              background: dryRunPreviewActive
                ? "linear-gradient(135deg,#7f1d1d,#991b1b)"
                : "linear-gradient(135deg,#1e3a8a,#2563eb)",
              color: dryRunPreviewActive ? "#fee2e2" : "#dbeafe",
              border: dryRunPreviewActive
                ? "1px solid #ef4444"
                : "1px solid #3b82f6",
              cursor:
                isBackendAction || timelineClips.length === 0
                  ? "not-allowed"
                  : "pointer",
              opacity: isBackendAction || timelineClips.length === 0 ? 0.5 : 1,
            }}
            title={
              dryRunPreviewActive
                ? "Stop dry-run preview"
                : "Start dry-run preview (frontend-only, NO hardware)"
            }
          >
            {dryRunPreviewActive ? "⏹ Stop Preview" : "🎬 Dry-Run Preview"}
          </button>

          <button
            onClick={toggleProgramList}
            disabled={isBackendAction || !backendAvailable}
            style={{
              ...TOOLBAR_BUTTON_STYLE,
              background: "linear-gradient(135deg,#1e40af,#2563eb)",
              color: "#dbeafe",
              border: "1px solid #3b82f6",
              cursor:
                isBackendAction || !backendAvailable
                  ? "not-allowed"
                  : "pointer",
              opacity: isBackendAction || !backendAvailable ? 0.5 : 1,
            }}
            title="Load a saved program from backend"
          >
            📂 Backend Load
          </button>

          {backendAvailable !== null && (
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: backendAvailable ? "#22c55e" : "#ef4444",
                boxShadow: backendAvailable
                  ? "0 0 8px #22c55e"
                  : "0 0 8px rgba(239,68,68,0.55)",
              }}
            />
          )}
        </div>
      </div>

      {/* ─── PROGRAM LIST MODAL (Team B - Phase 1) ──────────────────────── */}
      {showProgramList && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }} onClick={() => setShowProgramList(false)}>
          <div style={{
            background: '#0f1722',
            border: '1px solid #1d2733',
            borderRadius: 8,
            width: 500,
            maxWidth: '90%',
            maxHeight: '80%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid #1d2733',
              background: '#111827',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontWeight: 700, color: '#e8f4ff' }}>Saved Programs (Backend)</span>
              <button onClick={() => setShowProgramList(false)} style={{
                background: 'none',
                border: 'none',
                color: '#556677',
                fontSize: 18,
                cursor: 'pointer',
              }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              {savedPrograms.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#334455' }}>
                  No saved programs found.
                  <br />
                  <span style={{ fontSize: 11 }}>Click "Backend Save" to create one.</span>
                </div>
              ) : (
                savedPrograms.map(program => (
                  <div key={program.program_id} style={{
                    padding: '12px',
                    marginBottom: '8px',
                    background: '#0a1628',
                    border: '1px solid #1a2a3a',
                    borderRadius: 6,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: '#e8f4ff', marginBottom: 4 }}>
                        {program.name}
                      </div>
                      <div style={{ fontSize: 10, color: '#556677', fontFamily: 'monospace' }}>
                        ID: {program.program_id} · {program.clipCount} clips · {program.cueCount} cues
                      </div>
                      <div style={{ fontSize: 9, color: '#334455' }}>
                        {program.updatedAt ? new Date(program.updatedAt).toLocaleString() : 'Unknown date'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleBackendLoad(program.program_id, program.name)}
                        style={{
                          padding: '4px 10px',
                          background: '#1e40af',
                          border: '1px solid #3b82f6',
                          borderRadius: 4,
                          color: '#dbeafe',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleBackendDelete(program.program_id, program.name)}
                        style={{
                          padding: '4px 10px',
                          background: '#7f1d1d',
                          border: '1px solid #ef4444',
                          borderRadius: 4,
                          color: '#fee2e2',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div style={{
              padding: '8px 12px',
              borderTop: '1px solid #1d2733',
              background: '#080e1e',
              fontSize: 10,
              color: '#556677',
              textAlign: 'center',
            }}>
              {backendAvailable ? '🟢 Backend Connected - Server save/load available' : '🔴 Backend Unavailable - Using Local Storage only'}
            </div>
          </div>
        </div>
      )}

      {/* ─── KEYBOARD SHORTCUTS HELP MODAL ─────────────────────────────── */}
      {showShortcuts && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }} onClick={() => setShowShortcuts(false)}>
          <div style={{
            background: '#0f1722',
            border: '1px solid #1d2733',
            borderRadius: 8,
            width: 420,
            maxWidth: '90%',
            maxHeight: '80%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid #1d2733',
              background: '#111827',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontWeight: 700, color: '#e8f4ff', fontSize: 14 }}>⌨️ Keyboard Shortcuts</span>
              <button onClick={() => setShowShortcuts(false)} style={{
                background: 'none',
                border: 'none',
                color: '#556677',
                fontSize: 18,
                cursor: 'pointer',
              }}>✕</button>
            </div>
            <div style={{ padding: '16px', overflowY: 'auto' }}>
              {[
                { key: 'Space', desc: 'Play / Pause audio' },
                { key: 'Delete', desc: 'Delete selected clip' },
                { key: 'Ctrl + Z', desc: 'Undo last action' },
                { key: 'Ctrl + Y', desc: 'Redo last action' },
                { key: 'Ctrl + C', desc: 'Copy selected clip' },
                { key: 'Ctrl + V', desc: 'Paste clip at current time' },
                { key: 'Ctrl + D', desc: 'Duplicate selected clip' },
                { key: '← / →', desc: 'Nudge clip ±0.1s' },
                { key: 'Shift + ← / →', desc: 'Nudge clip ±1.0s' },
                { key: 'Shift + Drag', desc: 'Disable snap while dragging' },
                { key: '?', desc: 'Toggle this help modal' },
              ].map((item, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 0',
                  borderBottom: i < 10 ? '1px solid #1a2a3a' : 'none',
                }}>
                  <code style={{
                    background: '#1a2a3a',
                    border: '1px solid #2d3a4a',
                    borderRadius: 4,
                    padding: '3px 8px',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: '#00b7ff',
                    minWidth: 110,
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}>
                    {item.key}
                  </code>
                  <span style={{ fontSize: 12, color: '#8899aa' }}>{item.desc}</span>
                </div>
              ))}
            </div>
            <div style={{
              padding: '10px 16px',
              borderTop: '1px solid #1d2733',
              background: '#080e1e',
              fontSize: 10,
              color: '#556677',
              textAlign: 'center',
            }}>
              Press <code style={{ color: '#00b7ff' }}>?</code> anytime to toggle this panel
            </div>
          </div>
        </div>
      )}


      {/* ── BODY ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── TRACK LIST — enhanced UX for large equipment counts ───── */}
        <div style={{ width: 320, borderRight: "1px solid #1d2733", overflowY: "auto", background: "#0f1722", display: "flex", flexDirection: "column" }}>
          {/* Header with search + filter + dense toggle */}
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #1d2733", position: "sticky", top: 0, background: "#111827", zIndex: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#8fa3bf" }}>
              PROGRAMMABLE DEVICES
              <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: "#556677" }}>({filteredTracks.length}/{programmableTracks.length})</span>
            </div>
            {/* Search */}
            <input
              type="text"
              placeholder="Search tracks..."
              value={trackSearch}
              onChange={(e) => setTrackSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 10px",
                background: "#0a1628",
                border: "1px solid #1a2a3a",
                borderRadius: 4,
                color: "#e8f4ff",
                fontSize: 12,
              }}
            />
            {/* Expand/Collapse buttons */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                onClick={expandAllCategories}
                style={{
                  padding: "3px 8px",
                  fontSize: 10,
                  borderRadius: 4,
                  cursor: "pointer",
                  border: "1px solid #4b5563",
                  background: "#1f2937",
                  color: "#9ca3af",
                }}
                title="Expand all categories"
              >
                ▼ Expand
              </button>
              <button
                onClick={collapseAllCategories}
                style={{
                  padding: "3px 8px",
                  fontSize: 10,
                  borderRadius: 4,
                  cursor: "pointer",
                  border: "1px solid #4b5563",
                  background: "#1f2937",
                  color: "#9ca3af",
                }}
                title="Collapse all categories"
              >
                ▶ Collapse
              </button>
            </div>
            {/* Filter + Dense toggle row */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select
                value={trackFilter}
                onChange={(e) => setTrackFilter(e.target.value)}
                style={{
                  flex: 1,
                  padding: "4px 8px",
                  background: "#0a1628",
                  border: "1px solid #1a2a3a",
                  borderRadius: 4,
                  color: "#e8f4ff",
                  fontSize: 11,
                }}
              >
                <option value="all">All Types</option>
                <option value="lighting">Lighting</option>
                <option value="pump">Pumps</option>
                <option value="solenoid">Valves</option>
                <option value="fire">Fire</option>
                <option value="fog">Fog/Mist</option>
                <option value="laser">Lasers</option>
                <option value="motion">Motion All</option>
                <option value="motion_1d">Motion 1D</option>
                <option value="motion_2d">Motion 2D</option>
                <option value="motion_3d">Motion 3D</option>
                <option value="device">General</option>
              </select>
              <button
                onClick={() => setDenseMode(!denseMode)}
                style={{
                  padding: "4px 8px",
                  fontSize: 10,
                  borderRadius: 4,
                  cursor: "pointer",
                  border: `1px solid ${denseMode ? "#00b7ff" : "#4b5563"}`,
                  background: denseMode ? "rgba(0,183,255,0.15)" : "#1f2937",
                  color: denseMode ? "#00b7ff" : "#9ca3af",
                }}
                title={denseMode ? "Compact mode" : "Comfortable mode"}
              >
                {denseMode ? "◫" : "☐"}
              </button>
            </div>
          </div>
                    {/* Category-grouped track list with collapsible headers */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filteredTracks.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "#556677", fontSize: 11 }}>
                <div style={{ fontSize: 20, opacity: 0.3, marginBottom: 6 }}>🔍</div>
                No tracks found.
                <br />
                <span style={{ fontSize: 10, opacity: 0.6 }}>Try adjusting your search or filter.</span>
              </div>
            )}
            {categoryOrder.map((category) => {
              const tracks = groupedTracks[category] || [];
              if (tracks.length === 0) return null;
              const isCollapsed = collapsedCategories.has(category);
              return (
                <div key={category}>
                  {/* Category Header */}
                  <div
                    onClick={() => toggleCategory(category)}
                    style={{
                      padding: denseMode ? "6px 14px" : "8px 14px",
                      background: "#0d1520",
                      borderBottom: "1px solid #1a2a3a",
                      borderTop: "1px solid #1a2a3a",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                      userSelect: "none",
                      position: "sticky",
                      top: 0,
                      zIndex: 5,
                      backgroundColor: "#0d1520",
                    }}
                  >
                    <span style={{ fontSize: 11, color: "#556677", fontWeight: 600 }}>
                      {isCollapsed ? "▶" : "▼"}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#8fa3bf", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      {category}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#556677", fontFamily: "monospace", background: "#0a1628", padding: "2px 8px", borderRadius: 12 }}>
                      {tracks.length}
                    </span>
                  </div>
                  
                  {/* Tracks in category */}
                  {!isCollapsed && tracks.map((track) => (
                    <div
                      key={track.id}
                      onClick={(e) => {
                        if (suppressNextRowClickRef.current) {
                          suppressNextRowClickRef.current = false;
                          return;
                        }
                        const rect = e.currentTarget.getBoundingClientRect();
                        createClip(track, Math.floor((e.clientX - rect.left + e.currentTarget.scrollLeft) / zoom));
                      }}
                      style={{
                        height: denseMode ? 26 : 42,
                        borderBottom: "1px solid #18202c",
                        position: "relative",
                        cursor: "crosshair",
                  background:
                    filteredTracks.indexOf(track) % 2 === 0
                      ? "rgba(15,23,42,0.16)"
                      : "rgba(30,41,59,0.24)",
                        transition: "background 0.12s ease, box-shadow 0.12s ease",
                        display: "flex",
                        alignItems: "center",
                        paddingLeft: 32,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow =
                                                            "inset 3px 0 0 0 #38bdf8, inset 0 1px 0 rgba(255,255,255,0.04)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = filteredTracks.indexOf(track) % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", overflow: "hidden" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, display: "inline-block", background: TRACK_TYPE_COLORS[track.type] || resolveTrackVisualColor(track) || "#94a3b8" }} />
                        <span style={{ fontSize: denseMode ? 10 : 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: denseMode ? 400 : 500 }}>{track.label}</span>
                        <span style={{ marginLeft: "auto", fontSize: 9, opacity: 0.45, fontFamily: "monospace", flexShrink: 0 }}>
                          {track.type.replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
            {groupedTracks["Other"] && groupedTracks["Other"].length > 0 && !categoryOrder.includes("Other") && (
              <div>
                <div
                  onClick={() => toggleCategory("Other")}
                  style={{
                    padding: denseMode ? "6px 14px" : "8px 14px",
                    background: "#0d1520",
                    borderBottom: "1px solid #1a2a3a",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <span style={{ fontSize: 11, color: "#556677", fontWeight: 600 }}>
                    {collapsedCategories.has("Other") ? "▶" : "▼"}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#8fa3bf", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Other
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "#556677" }}>{groupedTracks["Other"].length}</span>
                </div>
                {!collapsedCategories.has("Other") && groupedTracks["Other"].map((track) => (
                  <div
                    key={track.id}
                    onClick={(e) => {
                      if (suppressNextRowClickRef.current) {
                        suppressNextRowClickRef.current = false;
                        return;
                      }
                      const rect = e.currentTarget.getBoundingClientRect();
                      createClip(track, Math.floor((e.clientX - rect.left + e.currentTarget.scrollLeft) / zoom));
                    }}
                    style={{
                      height: denseMode ? 26 : 42,
                      borderBottom: "1px solid #18202c",
                      position: "relative",
                      cursor: "crosshair",
                      background: filteredTracks.indexOf(track) % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                      transition: "background 0.12s ease, box-shadow 0.12s ease",
                      display: "flex",
                      alignItems: "center",
                      paddingLeft: 32,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow =
                                                       "inset 3px 0 0 0 #38bdf8, inset 0 1px 0 rgba(255,255,255,0.04)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = filteredTracks.indexOf(track) % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", overflow: "hidden" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, display: "inline-block", background: TRACK_TYPE_COLORS[track.type] || resolveTrackVisualColor(track) || "#94a3b8" }} />
                      <span style={{ fontSize: denseMode ? 10 : 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── TIMELINE AREA (Team B — unchanged) ────────────────────── */}
        <div
          ref={timelineContainerRef}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
            const time = x / zoom;
            shiftKeyRef.current = e.shiftKey;

            // PANNING: middle-mouse or Space+drag
            if (isPanning || (e.buttons === 4) || (e.buttons === 1 && e.spaceKey)) {
              const container = e.currentTarget;
              const deltaX = panStartRef.current.x - e.clientX;
              container.scrollLeft = panStartRef.current.scrollLeft + deltaX;
              return;
            }

            // HOVER PREVIEW: show time under mouse when not dragging/resizing/panning
            if (!draggingClip && !resizingClip && !isPanning) {
              setHoverTime(time);
              return;
            }

            // Clear hover when dragging starts
            setHoverTime(null);

            // BEAT SNAP helper: beatMarkers first, then BPM grid
            const snapToBeat = (rawTime, clipId) => {
              // SHIFT = disable snapping temporarily
              if (shiftKeyRef.current) {
                setSnapFeedback(null);
                return rawTime;
              }
              const snapThreshold = 0.15;
              // 1. Snap to actual beatMarkers first
              for (const marker of beatMarkers) {
                if (Math.abs(rawTime - marker.time) < snapThreshold) {
                  setSnapFeedback({ clipId, type: 'beat' });
                  return marker.time;
                }
              }
              // 2. Fallback: snap to BPM grid
              const beatInterval = 60 / bpmFromStore;
              const nearestBeat = Math.round(rawTime / beatInterval) * beatInterval;
              if (Math.abs(rawTime - nearestBeat) < snapThreshold) {
                setSnapFeedback({ clipId, type: 'grid' });
                return nearestBeat;
              }
              setSnapFeedback(null);
              return rawTime;
            };
            // PERFORMANCE: throttle updates for tiny movements
            const now = performance.now();
            const last = lastDragUpdateRef.current;
            const shouldUpdate = Math.abs(x - last.x) > 2 || (now - last.time) > 50;

            if (draggingClip && shouldUpdate) {
              lastDragUpdateRef.current = { x, time: now };
              const rawTime = (x - dragOffsetRef.current) / zoom;
              const snappedTime = snapToBeat(Math.max(0, rawTime), draggingClip);
              updateClip(draggingClip, { startTime: snappedTime });
            }

            if (resizingClip && shouldUpdate) {
              lastDragUpdateRef.current = { x, time: now };
              const ref = resizeStartRef.current;
              if (!ref.clipId) return;
              const deltaX = e.clientX - ref.startX;
              const deltaTime = deltaX / zoom;
              const newDuration = Math.max(0.2, ref.initialDuration + deltaTime);
              const snappedDuration = snapToBeat(newDuration, resizingClip);
              updateClip(resizingClip, { duration: snappedDuration });
            }
          }}
          onMouseDown={(e) => {
            // PANNING START: middle mouse button (button 1) or Space+click
            if (e.button === 1 || (e.button === 0 && e.code === 'Space')) {
              e.preventDefault();
              setIsPanning(true);
              panStartRef.current = {
                x: e.clientX,
                scrollLeft: e.currentTarget.scrollLeft,
              };
            }
          }}
          onWheel={(e) => {
            // WHEEL ZOOM: centered around mouse position
            e.preventDefault();
            const container = e.currentTarget;
            const rect = container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseTime = (mouseX + container.scrollLeft) / zoom;

            const delta = e.deltaY > 0 ? -10 : 10;
            const newZoom = Math.max(40, Math.min(240, zoom + delta));

            // Center zoom around mouse
            const newScrollLeft = (mouseTime * newZoom) - mouseX;
            container.scrollLeft = Math.max(0, newScrollLeft);
            setZoom(newZoom);
          }}
          onMouseUp={() => {
            setDraggingClip(null);
            setResizingClip(null);
            setSnapFeedback(null);
            setIsPanning(false);
            dragOffsetRef.current = 0;
            resizeStartRef.current = { clipId: null, startX: 0, initialDuration: 0, initialStartTime: 0 };
            lastDragUpdateRef.current = { x: 0, time: 0 };
            suppressNextRowClickRef.current = false;
          }}
          onMouseLeave={() => {
            // SAFETY: stop drag/resize/pan if mouse leaves timeline
            setDraggingClip(null);
            setResizingClip(null);
            setHoverTime(null);
            setIsPanning(false);
            dragOffsetRef.current = 0;
            resizeStartRef.current = { clipId: null, startX: 0, initialDuration: 0, initialStartTime: 0 };
            suppressNextRowClickRef.current = false;
          }}
          style={{
            flex: 1,
            position: "relative",
            overflow: "auto",
            background: PROFESSIONAL_TIMELINE_BG,
            backgroundSize: `${zoom}px 100%, 100% 100%`,
            boxShadow: "inset 0 12px 28px rgba(0,0,0,0.28)",
          }}
        >
          {/* BEAT MARKER LANE — TEAM C: bpm now from showStore */}
          <BeatMarkerLane
            duration={audioDuration} zoom={zoom}
            bpm={bpmFromStore}
            height={32} beatMarkers={beatMarkers} currentTime={currentTime}
            onSeek={handleSeek} onBeatAdd={addBeatMarker}
            onBeatRemove={removeBeatMarker} onBeatMove={moveBeatMarker}
            selectedRegion={selectedRegion}
          />

          {/* AUDIO WAVEFORM (Team B — unchanged) */}
          <AudioWaveform
            audioBuffer={audioBuffer} duration={audioDuration}
            currentTime={currentTime} zoom={zoom} height={72}
            onSeek={handleSeek} beatMarkers={beatMarkers}
            selectedRegion={selectedRegion}
            onRegionSelect={(start, end) => setSelectedRegion({ start, end })}
          />

          {/* TIME RULER — TEAM E PROFESSIONAL VISUAL PASS */}
          <div
            style={{
              height: 46,
              borderBottom: "1px solid rgba(148,163,184,0.22)",
              position: "sticky",
              top: 0,
              background: "linear-gradient(180deg,#111827 0%,#0b1220 100%)",
              display: "flex",
              alignItems: "center",
              zIndex: 20,
              overflow: "hidden",
              boxShadow: "0 8px 18px rgba(0,0,0,0.22)",
            }}
          >
            {Array.from({ length: Math.ceil(audioDuration) + 1 }).map((_, i) => {
              const isMajor = i % 5 === 0;

              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: i * zoom,
                    top: 0,
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                  }}
                >
                  <div
                    style={{
                      width: isMajor ? 2 : 1,
                      height: isMajor ? 24 : 12,
                      background: isMajor
                        ? "rgba(125,211,252,0.82)"
                        : "rgba(148,163,184,0.24)",
                      boxShadow: isMajor
                        ? "0 0 10px rgba(56,189,248,0.26)"
                        : "none",
                    }}
                  />
                  {isMajor && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "#cbd5e1",
                        marginLeft: 5,
                        marginTop: 1,
                        fontFamily: "monospace",
                        fontWeight: 800,
                        textShadow: "0 0 10px rgba(56,189,248,0.22)",
                      }}
                    >
                      {fmtTC(i)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{
            position: "absolute",
            top: 0, width: 2, height: "100%",
            background: "#00ff88",
            zIndex: 30, pointerEvents: "none",
            transform: `translateX(${currentTime * zoom}px)`,
            willChange: "transform",
            boxShadow: "0 0 8px 2px rgba(0,255,136,0.35), 0 0 20px 4px rgba(0,255,136,0.15)",
          }} />
          {/* PLAYHEAD GLOW PULSE — subtle ambient glow behind playhead */}
          <div style={{
            position: "absolute",
            top: 0,
            width: 40,
            height: "100%",
            background: "linear-gradient(90deg, transparent 0%, rgba(0,255,136,0.03) 50%, transparent 100%)",
            zIndex: 29,
            pointerEvents: "none",
            transform: `translateX(${(currentTime * zoom) - 20}px)`,
            willChange: "transform",
          }} />
          {/* HOVER PREVIEW LINE */}
          {hoverTime !== null && (
            <div style={{
              position: "absolute",
              left: hoverTime * zoom,
              top: 0, width: 1, height: "100%",
              background: "rgba(255,255,255,0.3)",
              zIndex: 25, pointerEvents: "none",
            }}>
              <div style={{
                position: "absolute", top: 2, left: 4,
                fontSize: 10, color: "#8899aa",
                fontFamily: "monospace",
                background: "rgba(0,0,0,0.6)",
                padding: "1px 4px", borderRadius: 3,
                whiteSpace: "nowrap",
              }}>
                {hoverTime.toFixed(2)}s
              </div>
            </div>
          )}

          {/* TRACK ROWS (Team B — unchanged) */}
          <div>
            {filteredTracks.map((track) => (
              <div
                key={track.id}
                onClick={(e) => {
                  // GUARD: prevent accidental clip creation after drag/resize
                  if (suppressNextRowClickRef.current) {
                    suppressNextRowClickRef.current = false;
                    return;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  createClip(track, Math.floor((e.clientX - rect.left + e.currentTarget.scrollLeft) / zoom));
                }}
                style={{
                  height: denseMode ? 34 : 52,
                  borderBottom: "1px solid rgba(148,163,184,0.13)",
                  position: "relative",
                  cursor: "crosshair",
                  background: filteredTracks.indexOf(track) % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                  transition:
                    "background 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow =
                                             "inset 3px 0 0 0 #38bdf8, inset 0 1px 0 rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = filteredTracks.indexOf(track) % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                {/* Grid lines — seconds + faint beat subdivisions */}
                {Array.from({ length: 120 }).map((_, i) => (
                  <div
                    key={`sec-${i}`}
                    style={{
                      position: "absolute",
                      left: i * zoom,
                      top: 0,
                      width: i % 5 === 0 ? 2 : 1,
                      height: "100%",
                      background:
                        i % 5 === 0
                          ? "rgba(125,211,252,0.20)"
                          : "rgba(148,163,184,0.08)",
                    }}
                  />
                ))}
                {/* Beat subdivision lines */}
                {(() => {
                  const beatInterval = 60 / bpmFromStore;
                  const lines = [];
                  for (let t = 0; t < audioDuration; t += beatInterval) {
                    lines.push(
                      <div
                        key={`beat-${t}`}
                        style={{
                          position: "absolute",
                          left: t * zoom,
                          top: 0,
                          width: 1,
                          height: "100%",
                          background: "rgba(34,197,94,0.045)",
                        }}
                      />
                    );
                  }
                  return lines;
                })()}
                {timelineClips.filter((c) => c.trackId === track.id).map((clip) => (
                                                      <div
                    key={clip.id}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      suppressNextRowClickRef.current = true;
                      const w = e.currentTarget.clientWidth;
                      const x = e.nativeEvent.offsetX;
                      if (x > w - 12) {
                        // RESIZE: capture initial state
                        resizeStartRef.current = {
                          clipId: clip.id,
                          startX: e.clientX,
                          initialDuration: clip.duration,
                          initialStartTime: clip.startTime,
                        };
                        setResizingClip(clip.id);
                      } else {
                        // DRAG: capture offset from clip left edge
                        dragOffsetRef.current = x;
                        setDraggingClip(clip.id);
                      }
                      setSelectedClipId(clip.id);
                    }}
                    onClick={(e) => { e.stopPropagation(); setSelectedClipId(clip.id); }}
                    style={{
                      position: "absolute", left: clip.startTime * zoom, top: denseMode ? 4 : 8,
                      width: Math.max(4, clip.duration * zoom), height: denseMode ? 32 : 40,
                      background: getClipVisualBackground(clip, selectedClipId),
                      border: getClipVisualBorder(
                        clip,
                        selectedClipId,
                        snapFeedback
                      ),
                      borderRadius: 12,
                      display: "flex", alignItems: "center", paddingLeft: 10,
                      fontSize: denseMode ? 11 : 12, fontWeight: 600, color: "#041018",
                      boxShadow:
                        clip.id === selectedClipId
                          ? "0 0 0 2px rgba(255,255,255,0.95), 0 0 24px rgba(56,189,248,0.36), 0 12px 24px rgba(0,0,0,0.38)"
                          : "0 6px 16px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.24)",
                      overflow: "hidden",
                      userSelect: "none",
                      WebkitUserSelect: "none",
                      cursor: draggingClip === clip.id ? "grabbing" : (resizingClip === clip.id ? "ew-resize" : "grab"),
                      transition:
                        "box-shadow 0.2s ease, transform 0.15s ease, border 0.15s ease, filter 0.15s ease",
                      transform: "scaleY(1)",
                      zIndex: clip.id === selectedClipId ? 10 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!draggingClip && !resizingClip) {
                        e.currentTarget.style.transform =
                          "translateY(-1px) scaleY(1.05)";
                        e.currentTarget.style.boxShadow =
                          "0 12px 24px rgba(0,0,0,0.34), 0 0 0 1px rgba(255,255,255,0.28), 0 0 18px rgba(56,189,248,0.22)";
                        e.currentTarget.style.zIndex = "20";
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform =
                        "translateY(0) scaleY(1)";
                      e.currentTarget.style.boxShadow = clip.id === selectedClipId
                          ? "0 0 0 2px rgba(255,255,255,0.95), 0 0 24px rgba(56,189,248,0.36), 0 12px 24px rgba(0,0,0,0.38)"
                          : "0 6px 16px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.24)";
                      e.currentTarget.style.zIndex = clip.id === selectedClipId ? "10" : "1";
                    }}
                  >
                                        {track.label}
                    {/* RESIZE HANDLE VISUAL */}
                    <div style={{
                      position: "absolute", right: 0, top: 0, width: 12, height: "100%",
                      cursor: "ew-resize", background: "rgba(255,255,255,0.15)",
                      borderRadius: "0 5px 5px 0",
                    }} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ─── TEAM C: tabbed right panel ─────────────────────────────── */}
        <div style={{ width: 320, borderLeft: "1px solid #1d2733", background: "#0f1722", display: "flex", flexDirection: "column" }}>

          {/* Tab bar */}
          <div style={{ display: "flex", borderBottom: "1px solid #1d2733", background: "#111827", flexShrink: 0 }}>
            {RIGHT_TABS.map((t) => (
              <button key={t.key} onClick={() => setRightTab(t.key)} style={{
                flex: 1, padding: "8px 2px", fontSize: 10, cursor: "pointer", border: "none",
                borderBottom: `2px solid ${rightTab === t.key ? "#00b7ff" : "transparent"}`,
                background: "transparent",
                color: rightTab === t.key ? "#00b7ff" : "#556677",
                letterSpacing: "0.05em",
              }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* ── Clip tab: enhanced inspector ─────────────────────────── */}
          {rightTab === "clip" && (
            <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
              {selectedClip ? (
                <>
                  {/* track color badge */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: TRACK_TYPE_COLORS[selectedClip.type] || "#94a3b8", flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#e8f4ff" }}>{selectedClip.name}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#556677", fontFamily: "monospace", marginBottom: 12 }}>
                    {selectedClip.type} · id: {selectedClip.id.slice(-6)}
                  </div>

                  <label style={{ fontSize: 11, color: "#8fa3bf", display: "block", marginBottom: 3 }}>Start Time (s)</label>
                  <input type="number" value={selectedClip.startTime} step="0.1"
                    onChange={(e) => updateSelectedClip({ startTime: Number(e.target.value) })}
                    style={{ width: "100%", marginBottom: 10, background: "#0a1628", border: "1px solid #1a2a3a", color: "#e8f4ff", padding: "5px 8px", borderRadius: 4, fontSize: 12, fontFamily: "monospace" }}
                  />

                  <label style={{ fontSize: 11, color: "#8fa3bf", display: "block", marginBottom: 3 }}>Duration (s)</label>
                  <input type="number" value={selectedClip.duration} step="0.1" min="0.1"
                    onChange={(e) => updateSelectedClip({ duration: Number(e.target.value) })}
                    style={{ width: "100%", marginBottom: 10, background: "#0a1628", border: "1px solid #1a2a3a", color: "#e8f4ff", padding: "5px 8px", borderRadius: 4, fontSize: 12, fontFamily: "monospace" }}
                  />

                  <label style={{ fontSize: 11, color: "#8fa3bf", display: "block", marginBottom: 3 }}>Value / Intensity (%)</label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <input type="range" min="0" max="100" value={selectedClip.value}
                      onChange={(e) => updateSelectedClip({ value: Number(e.target.value) })}
                      style={{ flex: 1, accentColor: "#00b7ff" }}
                    />
                    <span style={{ fontFamily: "monospace", fontSize: 12, width: 34, color: "#00b7ff" }}>{selectedClip.value}%</span>
                  </div>

                  <label style={{ fontSize: 11, color: "#8fa3bf", display: "block", marginBottom: 3 }}>
                    Curve Type
                  </label>

                  <select
                    value={selectedClip.curveType || "linear"}
                    onChange={(e) => updateSelectedClip({ curveType: e.target.value })}
                    style={{
                      width: "100%",
                      marginBottom: 10,
                      background: "#0a1628",
                      border: "1px solid #1a2a3a",
                      color: "#e8f4ff",
                      padding: "6px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    <option value="linear">Linear</option>
                    <option value="ease-in">Ease In</option>
                    <option value="ease-out">Ease Out</option>
                    <option value="ease-in-out">Ease In-Out</option>
                    <option value="pulse">Pulse</option>
                    <option value="wave">Wave</option>
                  </select>

                  <label style={{ fontSize: 11, color: "#8fa3bf", display: "block", marginBottom: 3 }}>
                    Fade In (s)
                  </label>

                  <input
                    type="number"
                    value={selectedClip.fadeIn || 0}
                    min="0"
                    step="0.1"
                    onChange={(e) => updateSelectedClip({ fadeIn: Number(e.target.value) })}
                    style={{
                      width: "100%",
                      marginBottom: 10,
                      background: "#0a1628",
                      border: "1px solid #1a2a3a",
                      color: "#e8f4ff",
                      padding: "5px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  />

                  <label style={{ fontSize: 11, color: "#8fa3bf", display: "block", marginBottom: 3 }}>
                    Fade Out (s)
                  </label>

                  <input
                    type="number"
                    value={selectedClip.fadeOut || 0}
                    min="0"
                    step="0.1"
                    onChange={(e) => updateSelectedClip({ fadeOut: Number(e.target.value) })}
                    style={{
                      width: "100%",
                      marginBottom: 10,
                      background: "#0a1628",
                      border: "1px solid #1a2a3a",
                      color: "#e8f4ff",
                      padding: "5px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  />

                  {isRgbTrack(selectedClip.type) && (
                    <div style={{
                      marginTop: 14,
                      marginBottom: 14,
                      padding: 10,
                      border: "1px solid #1a2a3a",
                      borderRadius: 6,
                      background: "#080e1e",
                    }}>
                      <div style={{
                        fontSize: 10,
                        color: "#556677",
                        marginBottom: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}>
                        RGB Lighting Controls
                      </div>

                      <label style={{ fontSize: 11, color: "#8fa3bf" }}>
                        Red
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="255"
                        value={selectedClip.r ?? 255}
                        onChange={(e) => updateSelectedClip({ r: Number(e.target.value) })}
                        style={{ width: "100%", marginBottom: 8 }}
                      />

                      <label style={{ fontSize: 11, color: "#8fa3bf" }}>
                        Green
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="255"
                        value={selectedClip.g ?? 255}
                        onChange={(e) => updateSelectedClip({ g: Number(e.target.value) })}
                        style={{ width: "100%", marginBottom: 8 }}
                      />

                      <label style={{ fontSize: 11, color: "#8fa3bf" }}>
                        Blue
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="255"
                        value={selectedClip.b ?? 255}
                        onChange={(e) => updateSelectedClip({ b: Number(e.target.value) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                  )}

                  <label style={{ fontSize: 11, color: "#8fa3bf", display: "block", marginBottom: 3 }}>Clip Color</label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
                    <input type="color" value={selectedClip.color || "#00b7ff"}
                      onChange={(e) => updateSelectedClip({ color: e.target.value })}
                      style={{ width: 36, height: 28, border: "none", cursor: "pointer", borderRadius: 3 }}
                    />
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: "#556677" }}>{(selectedClip.color || "#00b7ff").toUpperCase()}</span>
                  </div>

                  {/* timecode summary */}
                  <div style={{ background: "#080e1e", border: "1px solid #1a2a3a", borderRadius: 4, padding: "10px 12px", marginBottom: 14, fontFamily: "monospace", fontSize: 10, color: "#556677" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Start</span><span style={{ color: "#00b7ff" }}>{fmtTC(selectedClip.startTime)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                      <span>End</span><span style={{ color: "#00b7ff" }}>{fmtTC(selectedClip.startTime + selectedClip.duration)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                      <span>Duration</span><span style={{ color: "#f59e0b" }}>{selectedClip.duration.toFixed(2)}s</span>
                    </div>
                  </div>

                  {isMotionTrack(selectedClip.type) && (
                    <div style={{
                      marginTop: 14,
                      marginBottom: 14,
                      padding: 10,
                      border: "1px solid #1a2a3a",
                      borderRadius: 6,
                      background: "#080e1e",
                    }}>
                      <div style={{
                        fontSize: 10,
                        color: "#556677",
                        marginBottom: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}>
                        Motion Parameters
                      </div>

                      <label style={{ fontSize: 11, color: "#8fa3bf" }}>
                        Pan: {selectedClip.pan || 0}°
                      </label>
                      <input
                        type="range"
                        min="-180"
                        max="180"
                        value={selectedClip.pan || 0}
                        onChange={(e) => updateSelectedClip({ pan: Number(e.target.value) })}
                        style={{ width: "100%", marginBottom: 8 }}
                      />

                      <label style={{ fontSize: 11, color: "#8fa3bf" }}>
                        Tilt: {selectedClip.tilt || 0}°
                      </label>
                      <input
                        type="range"
                        min="-180"
                        max="180"
                        value={selectedClip.tilt || 0}
                        onChange={(e) => updateSelectedClip({ tilt: Number(e.target.value) })}
                        style={{ width: "100%", marginBottom: 8 }}
                      />

                      <label style={{ fontSize: 11, color: "#8fa3bf" }}>
                        Angle: {selectedClip.angle || 0}°
                      </label>
                      <input
                        type="range"
                        min="-180"
                        max="180"
                        value={selectedClip.angle || 0}
                        onChange={(e) => updateSelectedClip({ angle: Number(e.target.value) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                  )}

                  <button onClick={deleteSelectedClip} style={{ width: "100%", padding: 10, background: "#ef4444", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>
                    Delete Clip
                  </button>

                  <div style={{ marginTop: 10, fontSize: 9, color: "#334455", textAlign: "center" }}>
                    ←/→ nudge · Shift+←/→ ×10 · Ctrl+D duplicate · Ctrl+C/V copy/paste
                  </div>
                </>
              ) : (
                <div style={{ padding: 20, textAlign: "center", color: "#334455", fontSize: 11 }}>
                  <div style={{ fontSize: 28, opacity: 0.3, marginBottom: 8 }}>◈</div>
                  Click a timeline row to create a cue.<br />
                  Click a clip to inspect it.<br />
                  <span style={{ fontSize: 9, opacity: 0.6 }}>Space = Play/Pause</span>
                </div>
              )}
            </div>
          )}

          {/* ── AI tab: full AI choreography panel ───────────────────── */}
          {rightTab === "ai" && (
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <AIChoreographyPanel />
            </div>
          )}

          {/* ── Cues tab: Bellagio-style cue list ────────────────────── */}
          {rightTab === "cues" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* cue toolbar */}
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #1d2733", display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={addCue} style={{ padding: "4px 12px", fontSize: 10, borderRadius: 4, cursor: "pointer", border: "1px solid #1d2733", background: "#080e1e", color: "#8fa3bf" }}>
                  + Add Cue at {fmtTC(currentTime)}
                </button>
                <div style={{ flex: 1 }} />
                <button onClick={goCue} disabled={!cues.some(c => c.time > currentTime)} style={{ padding: "5px 16px", fontSize: 12, fontWeight: "bold", borderRadius: 4, cursor: "pointer", border: "1px solid #00b7ff", background: cues.some(c => c.time > currentTime) ? "rgba(0,183,255,0.15)" : "#080e1e", color: cues.some(c => c.time > currentTime) ? "#00b7ff" : "#1a2a3a", letterSpacing: "0.1em" }}>
                  GO ▶
                </button>
              </div>
              {/* cue list */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                {cues.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: "#334455", fontSize: 10 }}>
                    No cues yet.<br />Mark moments in the timeline.
                  </div>
                ) : cues.map((cue, i) => {
                  const isCurrent = cues.filter(c => c.time <= currentTime).pop()?.id === cue.id;
                  const isNext    = cues.find(c => c.time > currentTime)?.id === cue.id;
                  return (
                    <div key={cue.id} onClick={() => handleSeek(cue.time)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", cursor: "pointer", background: isCurrent ? "rgba(0,183,255,0.08)" : isNext ? "rgba(0,183,255,0.04)" : "transparent", borderLeft: `2px solid ${isCurrent ? "#00b7ff" : isNext ? "#00b7ff44" : "transparent"}` }}>
                      <span style={{ width: 22, textAlign: "right", fontFamily: "monospace", fontSize: 9, color: isCurrent ? "#00b7ff" : "#334455" }}>{cue.number}</span>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: cue.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 10, color: isCurrent ? "#e8f4ff" : "#8899aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cue.label}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 9, color: "#334455" }}>{fmtTC(cue.time)}</span>
                      <button onClick={e => { e.stopPropagation(); removeCue(cue.id); }} style={{ background: "none", border: "none", color: "#1a2a3a", cursor: "pointer", fontSize: 12 }}>×</button>
                    </div>
                  );
                })}
              </div>
              {/* next cue indicator */}
              {cues.some(c => c.time > currentTime) && (
                <div style={{ padding: "5px 12px", borderTop: "1px solid #1d2733", display: "flex", gap: 8, fontSize: 9, background: "rgba(0,183,255,0.04)" }}>
                  <span style={{ color: "#334455" }}>NEXT</span>
                  <span style={{ flex: 1, color: "#00b7ff" }}>{cues.find(c => c.time > currentTime)?.label}</span>
                  <span style={{ fontFamily: "monospace", color: "#556677" }}>{fmtTC(cues.find(c => c.time > currentTime)?.time || 0)}</span>
                </div>
              )}
            </div>
          )}

          {/* status bar */}
          <div style={{ padding: "5px 14px", borderTop: "1px solid #1d2733", display: "flex", gap: 10, fontSize: 10, color: "#556677", background: "#080e1e", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: "monospace", color: "#8899aa" }}>{programmableTracks.length} tracks</span>
            <span style={{ color: "#1a2a3a" }}>|</span>
            <span style={{ fontFamily: "monospace", color: timelineClips.length > 0 ? "#00b7ff" : "#556677" }}>{timelineClips.length} clips</span>
            <span style={{ color: "#1a2a3a" }}>|</span>
            <span style={{ fontFamily: "monospace", color: cues.length > 0 ? "#f59e0b" : "#556677" }}>{cues.length} cues</span>
            <span style={{ color: "#1a2a3a" }}>|</span>
            {selectedClip ? (
              <span style={{ fontFamily: "monospace", color: "#00ff88" }}>
                ◈ {selectedClip.name} · {fmtTC(selectedClip.startTime)} → {fmtTC(selectedClip.startTime + selectedClip.duration)}
              </span>
            ) : (
              <span style={{ fontFamily: "monospace", color: "#334455" }}>No clip selected</span>
            )}
            <div style={{ flex: 1 }} />
            {currentProgramName && (
              <span style={{ color: "#00b7ff", fontWeight: 600 }}>📀 {currentProgramName}</span>
            )}
            {hasUnsavedChanges && (
              <span style={{ color: "#f59e0b", fontWeight: 600 }}>✏️ Unsaved</span>
            )}
            <span style={{ fontFamily: "monospace", color: "#8fa3bf" }}>{bpmFromStore} BPM</span>
            <span style={{ color: "#1a2a3a" }}>|</span>
            <span style={{ fontFamily: "monospace", color: "#8fa3bf" }}>{fmtTC(audioDuration)} total</span>
          </div>
        </div>

      </div>

      {/* ─── VALIDATION MODAL ─────────────────────────────────────────────── */}
      {toast && (
        <div
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            maxWidth: 360,
            padding: "12px 14px",
            borderRadius: 8,

            background:
              toast.type === "success"
                ? "rgba(20,83,45,0.96)"
                : toast.type === "warning"
                ? "rgba(113,63,18,0.96)"
                : toast.type === "error"
                ? "rgba(127,29,29,0.96)"
                : "rgba(15,23,42,0.96)",

            border:
              toast.type === "success"
                ? "1px solid #22c55e"
                : toast.type === "warning"
                ? "1px solid #f59e0b"
                : toast.type === "error"
                ? "1px solid #ef4444"
                : "1px solid #334155",

            color: "#f8fafc",
            fontSize: 12,
            fontFamily: "monospace",
            zIndex: 5000,
            boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
          }}
        >
          {toast.message}
        </div>
      )}
      {/* ─── IMPORT VALIDATION MODAL ──────────────────────────────────────── */}
      {showValidationModal && validationReport && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          zIndex: 2001,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }} onClick={() => setShowValidationModal(false)}>
          <div style={{
            background: '#0f1722',
            border: '1px solid #1d2733',
            borderRadius: 8,
            width: 520,
            maxWidth: '90%',
            maxHeight: '80%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid #1d2733',
              background: '#111827',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontWeight: 700, color: '#e8f4ff', fontSize: 14 }}>
                🔍 Import Validation Report
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: validationReport.readyForDryRun ? 'rgba(74,222,128,0.15)' : 'rgba(239,68,68,0.15)',
                  color: validationReport.readyForDryRun ? '#4ade80' : '#ef4444',
                  border: `1px solid ${validationReport.readyForDryRun ? 'rgba(74,222,128,0.3)' : 'rgba(239,68,68,0.3)'}`,
                }}>
                  {validationReport.readyForDryRun ? 'READY FOR DRY-RUN' : 'NOT READY'}
                </span>
                <button onClick={() => setShowValidationModal(false)} style={{
                  background: 'none',
                  border: 'none',
                  color: '#556677',
                  fontSize: 18,
                  cursor: 'pointer',
                }}>✕</button>
              </div>
            </div>

            {/* Stats grid */}
            <div style={{
              padding: '12px 16px',
              background: '#080e1e',
              borderBottom: '1px solid #1d2733',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
              fontSize: 11,
              fontFamily: 'monospace',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: '#0a1628', borderRadius: 4 }}>
                <span style={{ color: '#8fa3bf' }}>📦 Fixtures</span>
                <span style={{ color: '#00b7ff', fontWeight: 700 }}>{validationReport.fixturesFound}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: '#0a1628', borderRadius: 4 }}>
                <span style={{ color: '#8fa3bf' }}>🎚️ Tracks Generated</span>
                <span style={{ color: '#00b7ff', fontWeight: 700 }}>{validationReport.tracksGenerated}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: '#0a1628', borderRadius: 4 }}>
                <span style={{ color: '#8fa3bf' }}>🎬 Clips Created</span>
                <span style={{ color: '#00b7ff', fontWeight: 700 }}>{validationReport.clipsCreated}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: '#0a1628', borderRadius: 4 }}>
                <span style={{ color: '#8fa3bf' }}>⚠️ Unsupported Types</span>
                <span style={{ color: validationReport.unsupportedTypes.length > 0 ? '#f59e0b' : '#4ade80' }}>
                  {validationReport.unsupportedTypes.length || 0}
                </span>
              </div>
            </div>

            {/* Issues section */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
              {/* Missing TrackId */}
              {validationReport.clipsMissingTrackId > 0 && (
                <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(239,68,68,0.06)', borderLeft: '3px solid #ef4444', borderRadius: 4 }}>
                  <span style={{ color: '#ef4444', fontWeight: 700 }}>❌ Missing trackId:</span>
                  <span style={{ color: '#fca5a5', marginLeft: 8 }}>{validationReport.clipsMissingTrackId} clip(s)</span>
                </div>
              )}

              {/* Missing FixtureId */}
              {validationReport.clipsMissingFixtureId > 0 && (
                <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(239,68,68,0.06)', borderLeft: '3px solid #ef4444', borderRadius: 4 }}>
                  <span style={{ color: '#ef4444', fontWeight: 700 }}>❌ Missing fixtureId:</span>
                  <span style={{ color: '#fca5a5', marginLeft: 8 }}>{validationReport.clipsMissingFixtureId} clip(s)</span>
                </div>
              )}

              {/* Missing Type */}
              {validationReport.clipsMissingType > 0 && (
                <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(245,158,11,0.06)', borderLeft: '3px solid #f59e0b', borderRadius: 4 }}>
                  <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚠️ Missing type:</span>
                  <span style={{ color: '#fcd34d', marginLeft: 8 }}>{validationReport.clipsMissingType} clip(s)</span>
                </div>
              )}

              {/* Invalid Duration */}
              {validationReport.clipsInvalidDuration > 0 && (
                <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(245,158,11,0.06)', borderLeft: '3px solid #f59e0b', borderRadius: 4 }}>
                  <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚠️ Invalid duration (≤0):</span>
                  <span style={{ color: '#fcd34d', marginLeft: 8 }}>{validationReport.clipsInvalidDuration} clip(s)</span>
                </div>
              )}

              {/* Invalid StartTime */}
              {validationReport.clipsInvalidStartTime > 0 && (
                <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(245,158,11,0.06)', borderLeft: '3px solid #f59e0b', borderRadius: 4 }}>
                  <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚠️ Invalid startTime:</span>
                  <span style={{ color: '#fcd34d', marginLeft: 8 }}>{validationReport.clipsInvalidStartTime} clip(s)</span>
                </div>
              )}

              {/* Duplicate IDs */}
              {validationReport.duplicateCount > 0 && (
                <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(239,68,68,0.06)', borderLeft: '3px solid #ef4444', borderRadius: 4 }}>
                  <span style={{ color: '#ef4444', fontWeight: 700 }}>❌ Duplicate clip IDs:</span>
                  <span style={{ color: '#fca5a5', marginLeft: 8 }}>{validationReport.duplicateCount} duplicate(s)</span>
                </div>
              )}

              {/* Unsupported Types */}
              {validationReport.unsupportedTypes.length > 0 && (
                <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(245,158,11,0.06)', borderLeft: '3px solid #f59e0b', borderRadius: 4 }}>
                  <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚠️ Unsupported clip types:</span>
                  <span style={{ color: '#fcd34d', marginLeft: 8 }}>{validationReport.unsupportedTypes.join(', ')}</span>
                </div>
              )}

              {/* Not Ready Reasons */}
              {!validationReport.readyForDryRun && validationReport.readyReasons.length > 0 && (
                <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 4 }}>
                  <div style={{ color: '#ef4444', fontWeight: 700, marginBottom: 6 }}>❌ Dry-run not ready because:</div>
                  {validationReport.readyReasons.map((reason, idx) => (
                    <div key={idx} style={{ color: '#fca5a5', fontSize: 11, marginLeft: 12, marginBottom: 3 }}>• {reason}</div>
                  ))}
                </div>
              )}

              {/* Ready Success */}
              {validationReport.readyForDryRun && (
                <div style={{ marginTop: 12, padding: '10px', background: 'rgba(74,222,128,0.1)', borderRadius: 4, textAlign: 'center' }}>
                  <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 13 }}>✅ All checks passed! Ready for Dry-Run Preview.</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '10px 16px',
              borderTop: '1px solid #1d2733',
              background: '#080e1e',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 10,
              color: '#556677',
            }}>
              <span>Validation is frontend-only. No hardware/backend calls.</span>
              <button
                onClick={() => setShowValidationModal(false)}
                style={{
                  padding: '4px 12px',
                  background: '#1f2937',
                  border: '1px solid #4b5563',
                  borderRadius: 4,
                  color: '#e5e7eb',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {validationModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }} onClick={() => setValidationModal(null)}>
          <div style={{
            background: '#0f1722',
            border: '1px solid #1d2733',
            borderRadius: 8,
            width: 480,
            maxWidth: '90%',
            maxHeight: '80%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid #1d2733',
              background: '#111827',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontWeight: 700, color: '#e8f4ff', fontSize: 14 }}>
                {validationModal.errors.length > 0 ? '❌ Validation Failed' : validationModal.warnings.length > 0 ? '⚠️ Validation Warnings' : '✅ Validation Passed'}
              </span>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: validationModal.errors.length > 0 ? 'rgba(239,68,68,0.15)' : validationModal.warnings.length > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(74,222,128,0.15)',
                  color: validationModal.errors.length > 0 ? '#ef4444' : validationModal.warnings.length > 0 ? '#f59e0b' : '#4ade80',
                  border: `1px solid ${validationModal.errors.length > 0 ? 'rgba(239,68,68,0.3)' : validationModal.warnings.length > 0 ? 'rgba(245,158,11,0.3)' : 'rgba(74,222,128,0.3)'}`,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>
                  {validationModal.errors.length > 0 ? 'INVALID' : validationModal.warnings.length > 0 ? 'WARNING' : 'VALID'}
                </span>
                <button onClick={() => setValidationModal(null)} style={{
                  background: 'none',
                  border: 'none',
                  color: '#556677',
                  fontSize: 18,
                  cursor: 'pointer',
                }}>✕</button>
              </div>
            </div>

            {/* Stats bar */}
            <div style={{
              padding: '12px 16px',
              background: '#080e1e',
              borderBottom: '1px solid #1d2733',
              display: 'flex',
              gap: 16,
              fontSize: 11,
              fontFamily: 'monospace',
              alignItems: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#00b7ff', fontWeight: 700, fontSize: 14 }}>{validationModal.stats.clips}</span>
                <span style={{ color: '#556677', fontSize: 9, textTransform: 'uppercase' }}>clips</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 14 }}>{validationModal.stats.cues}</span>
                <span style={{ color: '#556677', fontSize: 9, textTransform: 'uppercase' }}>cues</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#8b5cf6', fontWeight: 700, fontSize: 14 }}>{validationModal.stats.beatMarkers}</span>
                <span style={{ color: '#556677', fontSize: 9, textTransform: 'uppercase' }}>beats</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#8899aa', fontWeight: 700, fontSize: 14 }}>{validationModal.stats.bpm}</span>
                <span style={{ color: '#556677', fontSize: 9, textTransform: 'uppercase' }}>BPM</span>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#556677', fontSize: 9, textTransform: 'uppercase' }}>duration</span>
                <span style={{ color: '#8fa3bf', fontWeight: 700, fontSize: 14 }}>{fmtTC(validationModal.stats.duration)}</span>
              </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
              {/* Errors */}
              {validationModal.errors.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 10,
                    paddingBottom: 8,
                    borderBottom: '1px solid rgba(239,68,68,0.2)',
                  }}>
                    <span style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#ef4444',
                      display: 'inline-block',
                    }} />
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#ef4444',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}>
                      Errors
                    </span>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#ef4444',
                      background: 'rgba(239,68,68,0.15)',
                      padding: '2px 8px',
                      borderRadius: 4,
                      marginLeft: 'auto',
                    }}>
                      {validationModal.errors.length}
                    </span>
                  </div>
                  {validationModal.errors.map((err, i) => (
                    <div key={`err-${i}`} style={{
                      padding: '8px 12px',
                      background: 'rgba(239,68,68,0.06)',
                      border: '1px solid rgba(239,68,68,0.15)',
                      borderRadius: 4,
                      marginBottom: 6,
                      fontSize: 12,
                      color: '#fca5a5',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 14 }}>×</span>
                      {err}
                    </div>
                  ))}
                </div>
              )}

              {/* Warnings */}
              {validationModal.warnings.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 10,
                    paddingBottom: 8,
                    borderBottom: '1px solid rgba(245,158,11,0.2)',
                  }}>
                    <span style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#f59e0b',
                      display: 'inline-block',
                    }} />
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#f59e0b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}>
                      Warnings
                    </span>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#f59e0b',
                      background: 'rgba(245,158,11,0.15)',
                      padding: '2px 8px',
                      borderRadius: 4,
                      marginLeft: 'auto',
                    }}>
                      {validationModal.warnings.length}
                    </span>
                  </div>
                  {validationModal.warnings.map((warn, i) => (
                    <div key={`warn-${i}`} style={{
                      padding: '8px 12px',
                      background: 'rgba(245,158,11,0.06)',
                      border: '1px solid rgba(245,158,11,0.15)',
                      borderRadius: 4,
                      marginBottom: 6,
                      fontSize: 12,
                      color: '#fcd34d',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 14 }}>!</span>
                      {warn}
                    </div>
                  ))}
                </div>
              )}

              {/* All clear */}
              {validationModal.errors.length === 0 && validationModal.warnings.length === 0 && (
                <div style={{
                  padding: 24,
                  textAlign: 'center',
                  color: '#4ade80',
                  fontSize: 13,
                }}>
                  <div style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: 'rgba(74,222,128,0.1)',
                    border: '2px solid rgba(74,222,128,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 12px',
                    fontSize: 24,
                  }}>✅</div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Timeline looks good</div>
                  <div style={{ fontSize: 11, color: '#556677' }}>Ready to compile</div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid #1d2733',
              background: '#080e1e',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontSize: 10, color: '#445566' }}>
                Open browser console (F12) for detailed diagnostics.
              </span>
              <button
                onClick={() => setValidationModal(null)}
                style={{
                  padding: '6px 16px',
                  background: '#1f2937',
                  border: '1px solid #4b5563',
                  borderRadius: 4,
                  color: '#e5e7eb',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}