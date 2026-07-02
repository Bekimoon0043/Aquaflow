import { useEffect, useState } from "react";
import { useShowStore } from "../store/showStore";
import { useWS } from "../hooks/WebSocketContext";

const MENU_ITEMS = {
  File:    ["New Show", "Open Show...", "Save", "Save As...", "---", "Import Audio", "Import Show", "Export Show", "---", "Preferences"],
  Edit:    ["Undo", "Redo", "---", "Cut", "Copy", "Paste", "Delete", "---", "Select All", "Deselect All"],
  Show:    ["Add Track", "Add Node", "---", "Quantize", "Auto-Choreograph (AI)", "---", "Show Properties"],
  Devices: ["Device Manager", "Scan Network", "---", "Test All Devices", "Emergency Stop"],
  View:    ["Node Editor", "Preview", "3D Simulation", "---", "Toggle Grid", "Toggle Snap", "---", "Reset Layout"],
  AI:      ["Generate Show from Music...", "Text to Show...", "Enhance Choreography", "---", "AI Settings"],
  Help:    ["Documentation", "Keyboard Shortcuts", "---", "About AquaFlow"],
};

const emitStudioEvent = (name, detail = {}) => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
};

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
    const onKeyDown = (event) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        addServerLog({ level: "info", msg: "Undo executed from global shortcut" });
        return;
      }

      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
        event.preventDefault();
        redo();
        addServerLog({ level: "info", msg: "Redo executed from global shortcut" });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addServerLog, redo, undo]);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = Math.floor(sec % 60).toString().padStart(2, "0");
    const ms = Math.floor((sec % 1) * 100).toString().padStart(2, "0");
    return `${m}:${s}.${ms}`;
  };

  const safeSend = (payload, offlineMessage) => {
    const ok = send(payload);
    if (!ok && offlineMessage) {
      addServerLog({ level: "warn", msg: offlineMessage });
    }
    return ok;
  };

  const handlePlay = () => {
    const next = playbackState === "playing" ? "paused" : "playing";
    setPlayback(next);
    safeSend(
      { type: "playback", action: next === "playing" ? "play" : "pause" },
      `Backend offline — ${next} applied locally only`
    );
  };

  const seekRelative = (delta) => {
    const next = Math.max(0, playhead + delta);
    setPlayhead(next);
    safeSend(
      { type: "playback", action: "seek", position: next },
      "Backend offline — seek applied locally only"
    );
  };

  const handleStop = () => {
    setPlayback("stopped");
    setPlayhead(0);
    safeSend({ type: "playback", action: "stop" }, "Backend offline — stop applied locally only");
  };

  const handleEStop = () => {
    setPlayback("stopped");
    setPlayhead(0);
    addServerLog({ level: "error", msg: "Emergency stop requested by operator" });
    safeSend({ type: "emergency_stop" }, "Backend offline — emergency stop requested locally only");
  };

  const handleMenuAction = (item) => {
    switch (item) {
      case "Undo":
        undo();
        addServerLog({ level: "info", msg: "Undo executed from menu" });
        break;
      case "Redo":
        redo();
        addServerLog({ level: "info", msg: "Redo executed from menu" });
        break;
      case "Open Show...":
      case "Import Show":
        onOpenBrowser?.("open");
        break;
      case "Save":
      case "Save As...":
      case "Export Show":
        onOpenBrowser?.("save");
        break;
      case "Import Audio":
        setActivePanel("audio");
        break;
      case "Add Track":
        addTimelineTrack();
        addServerLog({ level: "info", msg: "Timeline track added" });
        break;
      case "Add Node":
        setActivePanel("nodes");
        emitStudioEvent("aquaflow:add-node-request");
        addServerLog({ level: "info", msg: "Node add request opened in node editor" });
        break;
      case "Quantize":
        quantizeTimeline();
        addServerLog({ level: "info", msg: "Timeline quantized to beat grid" });
        break;
      case "Auto-Choreograph (AI)":
        setActivePanel("ai");
        autoGenerateTimeline();
        addServerLog({ level: "info", msg: "AI auto-generation applied to empty tracks" });
        break;
      case "Device Manager":
        setActivePanel("devices");
        break;
      case "Scan Network":
        setActivePanel("devices");
        emitStudioEvent("aquaflow:start-device-scan");
        addServerLog({ level: "info", msg: "Device scan requested" });
        break;
      case "Test All Devices":
        setActivePanel("devices");
        addServerLog({ level: "info", msg: "Open Hardware Test tab to run device tests" });
        break;
      case "Emergency Stop":
        handleEStop();
        break;
      case "Node Editor":
        setActivePanel("nodes");
        break;
      case "Preview":
      case "3D Simulation":
        setActivePanel("preview");
        break;
      case "Toggle Grid":
        toggleShowGrid();
        addServerLog({ level: "info", msg: "Node editor grid toggled" });
        break;
      case "Toggle Snap":
        toggleSnapToGrid();
        addServerLog({ level: "info", msg: "Snap-to-grid toggled" });
        break;
      case "Reset Layout":
        setActivePanel("nodes");
        emitStudioEvent("aquaflow:reset-node-editor");
        addServerLog({ level: "info", msg: "Node editor view reset" });
        break;
      case "Generate Show from Music...":
      case "Text to Show...":
      case "Enhance Choreography":
      case "AI Settings":
        setActivePanel("ai");
        break;
      case "New Show":
        onOpenBrowser?.("new");
        break;
      default:
        addServerLog({ level: "info", msg: `${item} clicked` });
        break;
    }
    setOpenMenu(null);
  };

  const connColor = {
    connected:    "var(--green)",
    disconnected: "var(--amber)",
    error:        "var(--red)",
    failed:       "var(--red)",
  }[connectionState] || "var(--text-muted)";

  return (
    <div style={{
      height: "var(--topbar-h)",
      background: "linear-gradient(180deg, #0c1a10 0%, #080e0a 100%)",
      borderBottom: "1px solid var(--border-accent)",
      display: "flex",
      alignItems: "center",
      flexShrink: 0,
      position: "relative",
      zIndex: 100,
      boxShadow: "0 1px 0 rgba(201,162,39,0.1)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "0 16px", borderRight: "1px solid var(--border)",
        height: "100%", minWidth: 200,
        background: "linear-gradient(90deg, rgba(10,51,32,0.8) 0%, transparent 100%)",
      }}>
        <img src="/luxcon-icon.png" alt="LuxuryCon" style={{ height: 30, width: "auto", objectFit: "contain" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{
            fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14,
            letterSpacing: "0.12em", color: "var(--brand-gold-light)",
            textTransform: "uppercase",
          }}>
            Luxury Con
          </span>
          <span style={{
            fontSize: 8, color: "var(--brand-gold)", fontFamily: "var(--font-body)",
            letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.8,
          }}>
            Fountain Studio
          </span>
        </div>
      </div>

      <div style={{ display: "flex", height: "100%", position: "relative" }}>
        {Object.keys(MENU_ITEMS).map((menu) => (
          <div key={menu} style={{ position: "relative" }}>
            <button
              onClick={() => setOpenMenu(openMenu === menu ? null : menu)}
              style={{ height: "100%", padding: "0 12px", background: openMenu === menu ? "var(--bg-hover)" : "transparent", border: "none", color: openMenu === menu ? "var(--text-primary)" : "var(--text-secondary)", fontFamily: "var(--font-body)", fontSize: 12, cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; if (openMenu) setOpenMenu(menu); }}
              onMouseLeave={(e) => { if (openMenu !== menu) e.currentTarget.style.color = "var(--text-secondary)"; }}
            >
              {menu}
            </button>
            {openMenu === menu && (
              <DropdownMenu
                items={MENU_ITEMS[menu]}
                onClose={() => setOpenMenu(null)}
                onAction={handleMenuAction}
              />
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: "0 16px", borderLeft: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{currentShow.name}</span>
        {isDirty && <span style={{ fontSize: 9, color: "var(--amber)", fontFamily: "var(--font-mono)" }} title="Unsaved changes">●</span>}
        <button className="btn" onClick={() => onOpenBrowser?.("save")}
          style={{ padding: "2px 8px", fontSize: 10, marginLeft: 4 }}>
          Save
        </button>
        <button className="btn" onClick={() => onOpenBrowser?.("open")}
          style={{ padding: "2px 8px", fontSize: 10 }}>
          Open
        </button>
        <button className="btn" disabled={!canUndo} onClick={() => handleMenuAction("Undo")}
          style={{ padding: "2px 8px", fontSize: 10, opacity: canUndo ? 1 : 0.5 }}>
          Undo
        </button>
        <button className="btn" disabled={!canRedo} onClick={() => handleMenuAction("Redo")}
          style={{ padding: "2px 8px", fontSize: 10, opacity: canRedo ? 1 : 0.5 }}>
          Redo
        </button>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", gap: 4, padding: "0 8px", borderRight: "1px solid var(--border)", height: "100%", alignItems: "center" }}>
        {[ ["nodes","Nodes"], ["preview","3D"], ["ai","✨ AI"], ["devices","⟳ Devices"], ["audio","♫ Audio"], ["plc","⚙ PLC"], ["scheduler","⏰ Schedule"] ].map(([key, label]) => (
          <button key={key} onClick={() => setActivePanel(key)} className="btn" style={{
            background: activePanel === key ? "rgba(201,162,39,0.12)" : "transparent",
            borderColor: activePanel === key ? "var(--border-accent)" : "transparent",
            color: activePanel === key ? "var(--text-accent)" : "var(--text-secondary)",
            padding: "3px 8px", fontSize: 11,
          }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 12px", borderRight: "1px solid var(--border)", height: "100%" }}>
        <TransportBtn icon="⏮" tip="Start" onClick={() => { setPlayhead(0); safeSend({ type: "playback", action: "seek", position: 0 }, "Backend offline — start seek applied locally only"); }} />
        <TransportBtn icon="⏪" tip="Rewind" onClick={() => seekRelative(-5)} />
        <TransportBtn icon={playbackState === "playing" ? "⏸" : "▶"} tip={playbackState === "playing" ? "Pause" : "Play"} onClick={handlePlay} accent />
        <TransportBtn icon="⏹" tip="Stop" onClick={handleStop} />
        <TransportBtn icon="⏺" tip="Record" onClick={() => { setPlayback("recording"); safeSend({ type: "playback", action: "record" }, "Backend offline — recording state applied locally only"); }} red />
        <TransportBtn icon="⏩" tip="Forward" onClick={() => seekRelative(5)} />
      </div>

      <div style={{ padding: "0 16px", borderRight: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 500, color: playbackState === "playing" ? "var(--text-accent)" : "var(--text-primary)", letterSpacing: "0.05em" }}>
        {formatTime(playhead)}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderRight: "1px solid var(--border)" }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>BPM</span>
        <input
          type="number" value={bpm} min={20} max={300}
          onChange={(e) => {
            const nextBpm = parseFloat(e.target.value || currentShow.bpm);
            setBpm(e.target.value);
            safeSend({ type: "set_bpm", bpm: nextBpm }, "Backend offline — BPM change sent locally only");
          }}
          style={{ width: 52, background: "var(--bg-void)", border: "1px solid var(--border-mid)", borderRadius: 3, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 500, textAlign: "center", padding: "2px 4px" }}
        />
        <BeatIndicator active={playbackState === "playing"} />
      </div>

      <div style={{ padding: "0 10px", display: "flex", alignItems: "center", gap: 5, borderRight: "1px solid var(--border)" }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: connColor, boxShadow: connectionState === "connected" ? "0 0 6px var(--green)" : "none" }} />
        <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase" }}>
          {connectionState === "connected" ? "live" : connectionState}
        </span>
      </div>

      <button className="btn" onClick={onToggleLogs} style={{ margin: "0 4px", padding: "4px 8px", fontSize: 10, color: "var(--text-muted)" }}>
        ⬛ Logs
      </button>

      <button className="btn danger" onClick={handleEStop} style={{ margin: "0 8px", padding: "4px 10px", fontSize: 11, fontWeight: 600 }}>
        ⛔ E-STOP
      </button>
    </div>
  );
}

function TransportBtn({ icon, tip, onClick, accent, red }) {
  return (
    <button onClick={onClick} data-tip={tip} style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", borderRadius: 4, color: accent ? "var(--accent)" : red ? "var(--red)" : "var(--text-secondary)", fontSize: 13, cursor: "pointer", transition: "all 0.1s" }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
    >
      {icon}
    </button>
  );
}

function BeatIndicator({ active }) {
  return (
    <div style={{ width: 8, height: 8, borderRadius: "50%", background: active ? "var(--accent)" : "var(--border-bright)", boxShadow: active ? "0 0 6px var(--accent)" : "none", animation: active ? "pulse-glow 0.5s ease-in-out infinite" : "none" }} />
  );
}

function DropdownMenu({ items, onClose, onAction }) {
  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={onClose} />
      <div style={{ position: "absolute", top: "100%", left: 0, background: "var(--bg-raised)", border: "1px solid var(--border-mid)", borderRadius: "var(--radius-md)", minWidth: 200, zIndex: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", padding: "4px 0" }}>
        {items.map((item, i) =>
          item === "---"
            ? <div key={i} style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
            : <button key={i} onClick={() => onAction?.(item)} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 14px", background: "transparent", border: "none", color: "var(--text-primary)", fontSize: 12, cursor: "pointer" }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >{item}</button>
        )}
      </div>
    </>
  );
}

function WaveIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M1 10 Q3 4, 5 10 Q7 16, 9 10 Q11 4, 13 10 Q15 16, 17 10 Q19 4, 20 8" stroke="#00d4ff" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}
