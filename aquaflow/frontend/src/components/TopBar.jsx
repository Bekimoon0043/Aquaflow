import { useEffect, useState } from "react";
import { useShowStore } from "../store/showStore";
import { useWS } from "../hooks/WebSocketContext";
import { trackFeature } from "../utils/analytics";
import { setHelpContext } from "../docs/helpContext";

const MENU_ITEMS = {
  File: [
    ["New Show", "action", "New Show"],
    ["Open Show...", "action", "Open Show..."],
    ["Save", "action", "Save"],
    ["Save As...", "action", "Save As..."],
    ["---", "separator"],
    ["Import Audio", "action", "Import Audio"],
    ["Import Show", "action", "Import Show"],
    ["Export Show", "action", "Export Show"],
    ["---", "separator"],
    ["Preferences", "action", "Preferences"],
  ],
  Edit: [
    ["Undo", "action", "Undo"],
    ["Redo", "action", "Redo"],
    ["---", "separator"],
    ["Cut", "action", "Cut"],
    ["Copy", "action", "Copy"],
    ["Paste", "action", "Paste"],
    ["Delete", "action", "Delete"],
    ["---", "separator"],
    ["Select All", "action", "Select All"],
    ["Deselect All", "action", "Deselect All"],
  ],
  Design: [
    ["Nodes", "panel", "nodes"],
    ["3D Preview", "panel", "preview"],
    ["Keyframes", "panel", "keyframes"],
    ["Presets", "panel", "presets"],
    ["Engineering Designer", "panel", "geometry"],
    ["Pattern Designer", "panel", "patterns"],
    ["Show Programmer", "panel", "show_programmer"],
    ["Engineering Tools", "panel", "engtools"],
    ["Collaboration", "panel", "collab"],
    ["Environments & Materials", "panel", "envmaterial"],
    ["---", "separator"],
    ["Add Node", "action", "Add Node"],
    ["Toggle Grid", "action", "Toggle Grid"],
    ["Toggle Snap", "action", "Toggle Snap"],
    ["Reset Layout", "action", "Reset Layout"],
  ],
  Devices: [
    ["Device Discovery", "panel", "devices"],
    ["Audio", "panel", "audio"],
    ["PLC", "panel", "plc"],
    ["Calibration", "panel", "calibration"],
    ["Dependencies", "panel", "dependencies"],
    ["---", "separator"],
    ["Scan Network", "action", "Scan Network"],
    ["Test All Devices", "action", "Test All Devices"],
  ],
  Runtime: [
    ["Scheduler", "panel", "scheduler"],
    ["Safety Monitor", "panel", "safety"],
    ["Operator", "panel", "operator"],
    ["Live Validation", "panel", "validation"],
    ["Wind Drift Safety", "panel", "wind"],
    ["Mobile Monitoring", "panel", "mobilemon"],
    ["Digital Twin", "panel", "twin"],
    ["Autonomous Adaptation", "panel", "adaptation"],
    ["Fleet Management", "panel", "fleet"],
    ["Diagnostics", "panel", "diagnostics"],
    ["Compile", "panel", "compile"],
    ["---", "separator"],
    ["Add Track", "action", "Add Track"],
    ["Quantize", "action", "Quantize"],
    ["Emergency Stop", "action", "Emergency Stop"],
  ],
  AI: [
    ["AI Studio", "panel", "ai"],
    ["AI Optimization", "panel", "optimize"],
    ["---", "separator"],
    ["Generate Show from Music...", "action", "Generate Show from Music..."],
    ["Text to Show...", "action", "Text to Show..."],
    ["Enhance Choreography", "action", "Enhance Choreography"],
    ["Auto-Choreograph (AI)", "action", "Auto-Choreograph (AI)"],
    ["AI Settings", "action", "AI Settings"],
  ],
  Help: [
    ["Documentation Center", "panel", "docs"],
    ["Training Academy", "panel", "academy"],
    ["Keyboard Shortcuts", "action", "Keyboard Shortcuts"],
    ["---", "separator"],
    ["About AquaFlow", "action", "About AquaFlow"],
  ],
};

const PANEL_TO_GROUP = {
  nodes: "Design",
  preview: "Design",
  keyframes: "Design",
  presets: "Design",
  geometry: "Design",
  show_programmer: "Design",
  engtools: "Design",
  collab: "Design",
  envmaterial: "Design",
  academy: "Help",
  docs: "Help",
  mobilemon: "Runtime",
  twin: "Runtime",
  adaptation: "Runtime",
  fleet: "Runtime",
  devices: "Devices",
  audio: "Devices",
  plc: "Devices",
  calibration: "Devices",
  dependencies: "Devices",
  scheduler: "Runtime",
  safety: "Runtime",
  operator: "Runtime",
  validation: "Runtime",
  wind: "Runtime",
  diagnostics: "Runtime",
  compile: "Runtime",
  ai: "AI",
  optimize: "AI",
};

const emitStudioEvent = (name, detail = {}) =>
  typeof window !== "undefined" && window.dispatchEvent(new CustomEvent(name, { detail }));

export default function TopBar({ activePanel, setActivePanel, onToggleLogs, onOpenBrowser, isDirty }) {
  const {
    currentShow,
    playbackState,
    setPlayback,
    setPlayhead,
    playhead,
    connectionState,
    addTimelineTrack,
    quantizeTimeline,
    autoGenerateTimeline,
    toggleShowGrid,
    toggleSnapToGrid,
    undo,
    redo,
    canUndo,
    canRedo,
    addServerLog,
  } = useShowStore();

  const { send } = useWS();
  const [openMenu, setOpenMenu] = useState(null);
  const [bpm, setBpm] = useState(currentShow.bpm);

  useEffect(() => {
    setBpm(currentShow.bpm);
  }, [currentShow.bpm]);

  useEffect(() => {
    const h = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        redo();
      }
      if (e.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [undo, redo]);

  const fmt = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const ss = Math.floor(s % 60).toString().padStart(2, "0");
    const ms = Math.floor((s % 1) * 100).toString().padStart(2, "0");
    return `${m}:${ss}.${ms}`;
  };

  const safeSend = (p, msg) => {
    const ok = send(p);
    if (!ok && msg) addServerLog({ level: "warn", msg });
    return ok;
  };

  const handlePlay = () => {
    const n = playbackState === "playing" ? "paused" : "playing";
    setPlayback(n);
    safeSend({ type: "playback", action: n === "playing" ? "play" : "pause" }, "");
  };

  const seekRel = (d) => {
    const n = Math.max(0, playhead + d);
    setPlayhead(n);
    safeSend({ type: "playback", action: "seek", position: n }, "");
  };

  const handleStop = () => {
    setPlayback("stopped");
    setPlayhead(0);
    safeSend({ type: "playback", action: "stop" }, "");
  };

  const handleEStop = () => {
    setPlayback("stopped");
    setPlayhead(0);
    addServerLog({ level: "error", msg: "Emergency stop" });
    safeSend({ type: "emergency_stop" }, "");
  };

  const handleMenuAction = (item) => {
    const m = {
      "Undo": () => undo(),
      "Redo": () => redo(),
      "Open Show...": () => onOpenBrowser?.("open"),
      "Import Show": () => onOpenBrowser?.("open"),
      "Save": () => onOpenBrowser?.("save"),
      "Save As...": () => onOpenBrowser?.("save"),
      "Export Show": () => onOpenBrowser?.("save"),
      "Import Audio": () => setActivePanel("audio"),
      "Add Track": () => addTimelineTrack(),
      "Add Node": () => {
        setActivePanel("nodes");
        emitStudioEvent("aquaflow:add-node-request");
      },
      "Quantize": () => quantizeTimeline(),
      "Auto-Choreograph (AI)": () => {
        setActivePanel("ai");
        autoGenerateTimeline();
      },
      "Scan Network": () => {
        setActivePanel("devices");
        emitStudioEvent("aquaflow:start-device-scan");
      },
      "Test All Devices": () => {
        setActivePanel("devices");
        addServerLog({ level: "info", msg: "Test All Devices clicked" });
      },
      "Emergency Stop": () => handleEStop(),
      "Toggle Grid": () => toggleShowGrid(),
      "Toggle Snap": () => toggleSnapToGrid(),
      "Reset Layout": () => {
        setActivePanel("nodes");
        emitStudioEvent("aquaflow:reset-node-editor");
      },
      "Generate Show from Music...": () => setActivePanel("ai"),
      "Text to Show...": () => setActivePanel("ai"),
      "Enhance Choreography": () => setActivePanel("ai"),
      "AI Settings": () => setActivePanel("ai"),
      "New Show": () => onOpenBrowser?.("new"),
    };

    (m[item] || (() => addServerLog({ level: "info", msg: item + " clicked" })))();
    setOpenMenu(null);
  };

  const handleMenuItem = (entry) => {
    const [label, type, value] = entry;
    if (type === "panel") {
      setActivePanel(value);
      trackFeature(value, { via: "menu" });   // AQ-S4-003: anonymous feature usage
      setHelpContext(value);                   // AQ-S4-006: context-sensitive help
      setOpenMenu(null);
      return;
    }
    if (type === "action") handleMenuAction(value || label);
  };

  const connOk = connectionState === "connected";
  const activeGroup = PANEL_TO_GROUP[activePanel];

  return (
    <div
      style={{
        height: "var(--topbar-h)",
        background: "linear-gradient(180deg,#0c1a10 0%,#080e0a 100%)",
        borderBottom: "1px solid var(--border-accent)",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        position: "relative",
        zIndex: 500,
        overflow: "visible",
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", borderRight: "1px solid var(--border)", height: "100%", flexShrink: 0 }}>
        <img src="/luxcon-icon.png" alt="" style={{ height: 26, width: "auto" }} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12, letterSpacing: "0.1em", color: "var(--brand-gold-light)", textTransform: "uppercase", lineHeight: 1.2 }}>Luxury Con</span>
          <span style={{ fontSize: 7, color: "var(--brand-gold)", letterSpacing: "0.15em", textTransform: "uppercase", opacity: 0.7, lineHeight: 1.2 }}>Fountain Studio</span>
        </div>
      </div>

      {/* Professional grouped menus */}
      <div style={{ display: "flex", height: "100%", flexShrink: 0 }}>
        {Object.keys(MENU_ITEMS).map((menu) => (
          <div key={menu} style={{ position: "relative" }}>
            <button
              onClick={() => setOpenMenu(openMenu === menu ? null : menu)}
              onMouseEnter={() => {
                if (openMenu) setOpenMenu(menu);
              }}
              style={{
                height: "100%",
                padding: "0 10px",
                background: openMenu === menu || activeGroup === menu ? "rgba(201,162,39,0.12)" : "transparent",
                border: "none",
                borderBottom: activeGroup === menu ? "2px solid var(--border-accent)" : "2px solid transparent",
                color: openMenu === menu || activeGroup === menu ? "var(--text-accent)" : "var(--text-secondary)",
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                whiteSpace: "nowrap",
              }}
            >
              {menu}
            </button>

            {openMenu === menu && (
              <>
                <div
                  onClick={() => setOpenMenu(null)}
                  style={{
                    position: "fixed",
                    left: 0,
                    right: 0,
                    top: "var(--topbar-h)",
                    bottom: 0,
                    zIndex: 510,
                    background: "transparent",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    background: "var(--bg-raised)",
                    border: "1px solid var(--border-mid)",
                    borderRadius: "var(--radius-md)",
                    minWidth: 220,
                    zIndex: 700,
                    boxShadow: "0 10px 34px rgba(0,0,0,0.55)",
                    padding: "5px 0",
                  }}
                >
                  {MENU_ITEMS[menu].map((entry, i) => {
                    const [label, type, value] = entry;
                    if (type === "separator") {
                      return <div key={i} style={{ height: 1, background: "var(--border)", margin: "5px 0" }} />;
                    }

                    const isActivePanel = type === "panel" && activePanel === value;

                    return (
                      <button
                        key={i}
                        onClick={() => handleMenuItem(entry)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          width: "100%",
                          textAlign: "left",
                          padding: "7px 14px",
                          background: isActivePanel ? "rgba(201,162,39,0.14)" : "transparent",
                          border: "none",
                          color: isActivePanel ? "var(--text-accent)" : "var(--text-primary)",
                          fontSize: 12,
                          cursor: "pointer",
                          fontFamily: "var(--font-body)",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = isActivePanel ? "rgba(201,162,39,0.18)" : "var(--bg-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = isActivePanel ? "rgba(201,162,39,0.14)" : "transparent")}
                      >
                        <span>{label}</span>
                        {isActivePanel && <span style={{ color: "var(--text-accent)", fontSize: 10 }}>●</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Show name */}
      <div style={{ padding: "0 8px", borderLeft: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <span style={{ color: "var(--text-secondary)", fontSize: 11, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentShow.name}</span>
        {isDirty && <span style={{ fontSize: 8, color: "var(--amber)" }}>●</span>}
      </div>

      <div style={{ flex: 1 }} />

      {/* Transport */}
      <div style={{ display: "flex", alignItems: "center", gap: 1, padding: "0 5px", borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)", height: "100%", flexShrink: 0 }}>
        <TBtn icon="⏮" onClick={() => { setPlayhead(0); safeSend({ type: "playback", action: "seek", position: 0 }, ""); }} />
        <TBtn icon="⏪" onClick={() => seekRel(-5)} />
        <TBtn icon={playbackState === "playing" ? "⏸" : "▶"} onClick={handlePlay} accent />
        <TBtn icon="⏹" onClick={handleStop} />
        <TBtn icon="⏺" onClick={() => { setPlayback("recording"); safeSend({ type: "playback", action: "record" }, ""); }} red />
        <TBtn icon="⏩" onClick={() => seekRel(5)} />
      </div>

      {/* Timecode */}
      <div style={{ padding: "0 8px", borderRight: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500, color: playbackState === "playing" ? "var(--text-accent)" : "var(--text-primary)", flexShrink: 0 }}>
        {fmt(playhead)}
      </div>

      {/* BPM */}
      <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "0 6px", borderRight: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>BPM</span>
        <input
          type="number"
          value={bpm}
          min={20}
          max={300}
          onChange={(e) => {
            setBpm(e.target.value);
            safeSend({ type: "set_bpm", bpm: parseFloat(e.target.value || 128) }, "");
          }}
          style={{
            width: 42,
            background: "var(--bg-void)",
            border: "1px solid var(--border-mid)",
            borderRadius: 3,
            color: "var(--text-primary)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            textAlign: "center",
            padding: "1px 2px",
          }}
        />
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: playbackState === "playing" ? "var(--accent)" : "var(--border-bright)" }} />
      </div>

      {/* Status + E-STOP */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 6px", flexShrink: 0 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: connOk ? "var(--green)" : "var(--amber)" }} />
        <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{connOk ? "LIVE" : "OFF"}</span>
        <button className="btn" onClick={onToggleLogs} style={{ padding: "2px 5px", fontSize: 10, color: "var(--text-muted)" }}>Logs</button>
        <button className="btn danger" onClick={handleEStop} style={{ padding: "3px 7px", fontSize: 11, fontWeight: 700 }}>⛔</button>
      </div>
    </div>
  );
}

function TBtn({ icon, onClick, accent, red }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 24,
        height: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        borderRadius: 3,
        color: accent ? "var(--accent)" : red ? "var(--red)" : "var(--text-secondary)",
        fontSize: 12,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {icon}
    </button>
  );
}
