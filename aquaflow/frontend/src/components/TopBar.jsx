import { Fragment, useEffect, useRef, useState } from "react";
import { useShowStore } from "../store/showStore";
import { useICANPreviewStore } from "../store/icanPreviewStore";
import useEngineeringStore from "../store/engineeringStore";
import useProjectStore from "../store/projectStore";
import { useWS } from "../hooks/WebSocketContext";
import { trackFeature, hasConsent, setConsent } from "../utils/analytics";
import { apiGet } from "../utils/apiClient";
import { downloadShowFile } from "../utils/showFile";
import { saveProject, packageProject, openProjectFile } from "../utils/projectPersistence"; // AF-NEXT-006
import { setHelpContext } from "../docs/helpContext";
import { version as FRONTEND_VERSION } from "../../package.json";
import {
  MENU_ITEMS,
  ALL_TOOLS_MENU,
  WORKSPACE_TOP_MENUS,
  allToolsEntries,
  createMenuActionHandlers,
  desktopVersionFromUserAgent,
  editCommandNotice,
  retryDispatch,
} from "./topBarMenu";

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
  export3d: "Design",
  academy: "Help",
  docs: "Help",
  mobilemon: "Runtime",
  twin: "Runtime",
  adaptation: "Runtime",
  fleet: "Runtime",
  cloud: "Runtime",
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
  generative: "AI",
};

const emitStudioEvent = (name, detail = {}) =>
  typeof window !== "undefined" && window.dispatchEvent(new CustomEvent(name, { detail }));

const SHORTCUT_GROUPS = [
  ["Global", [["Undo", "Ctrl+Z"], ["Redo", "Ctrl+Y"], ["Play / Pause", "Space"], ["Stop", "Shift+Space"], ["Close / Cancel", "Esc"]]],
  ["Timeline", [["Seek and play", "Click ruler / empty lane"], ["Delete clips", "Del / Backspace"], ["Duplicate clips", "Ctrl+D"], ["Multi-select", "Ctrl+Click"], ["Marquee select", "Shift+Drag"]]],
  ["Engineering", [["Delete selected item", "Del / Backspace"], ["Duplicate fixture", "Ctrl+D"], ["Fit drawing", "F"], ["Reset view", "H"], ["Temporary pan", "Space + Drag"]]],
  ["Node Editor", [["Delete node", "Del / Backspace"], ["Duplicate node", "Ctrl+D"], ["Frame selection / all", "F"], ["Reset view", "Home"]]],
  ["3D Preview", [["Move", "G"], ["Rotate", "R"], ["Scale", "S"], ["Frame selected", "F"], ["Delete object", "Del"]]],
];

export default function TopBar({ activePanel, setActivePanel, onToggleLogs, onOpenBrowser, isDirty, workspaceSwitcher = null }) {
  const {
    currentShow,
    playbackState,
    setPlayback,
    setPlayhead,
    playhead,
    connectionState,
    addTimelineTrack,
    quantizeTimeline,
    toggleShowGrid,
    toggleSnapToGrid,
    showGrid,
    snapToGrid,
    timelineZoom,
    setTimelineZoom,
    loadShow,
    undo,
    redo,
    canUndo,
    canRedo,
    addServerLog,
  } = useShowStore();

  const { send } = useWS();
  const sitePreview = useICANPreviewStore();
  const displayedPlayback = sitePreview.active ? sitePreview.playback : playbackState;
  const displayedPosition = sitePreview.active ? sitePreview.position : playhead;
  const [openMenu, setOpenMenu] = useState(null);
  const menuRoot = useRef(null);
  useEffect(() => {
    if (!openMenu) return;
    const dismiss = e => { if (!menuRoot.current?.contains(e.target)) setOpenMenu(null); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [openMenu]);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(() => hasConsent());
  const [notice, setNotice] = useState(null); // { text, level }
  const noticeTimer = useRef(null);
  const importInputRef = useRef(null);
  const [bpm, setBpm] = useState(currentShow.bpm);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const showNotice = (text, level = "warn") => {
    setNotice({ text, level });
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3500);
  };

  useEffect(() => {
    setBpm(currentShow.bpm);
  }, [currentShow.bpm]);

  useEffect(() => {
    const h = (e) => {
      if (e.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      // The engineering workspace owns its complete project history. Letting the
      // global show history also consume Ctrl/Cmd+Z mutated two unrelated domains.
      if (document.body.dataset.activeWorkspace === "engineering") {
        if (e.key === "Escape") {
          setOpenMenu(null);
          setShowShortcutHelp(false);
          setShowAbout(false);
          setShowPrefs(false);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        redo();
      }
      if (e.key === "Escape") {
        setOpenMenu(null);
        setShowShortcutHelp(false);
        setShowAbout(false);
        setShowPrefs(false);
      }
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
    if (sitePreview.active) {
      sitePreview.playback === "playing" ? sitePreview.pause() : sitePreview.play();
      return;
    }
    const n = playbackState === "playing" ? "paused" : "playing";
    setPlayback(n);
    safeSend({ type: "playback", action: n === "playing" ? "play" : "pause" }, "");
  };

  const seekRel = (d) => {
    if (sitePreview.active) { sitePreview.seek(sitePreview.position + d); return; }
    const n = Math.max(0, playhead + d);
    setPlayhead(n);
    safeSend({ type: "playback", action: "seek", position: n }, "");
  };

  const handleStop = () => {
    if (sitePreview.active) { sitePreview.stop(); return; }
    setPlayback("stopped");
    setPlayhead(0);
    safeSend({ type: "playback", action: "stop" }, "");
  };

  const handleEStop = () => {
    if (sitePreview.active) sitePreview.stop();
    setPlayback("stopped");
    setPlayhead(0);
    addServerLog({ level: "error", msg: "Emergency stop" });
    safeSend({ type: "emergency_stop" }, "");
  };

  // Edit menu commands go to whichever editor is active. Listeners that support the
  // command set event.detail.handled = true synchronously; otherwise the user is told.
  const runEditCommand = (command) => {
    const detail = { command, handled: false };
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aquaflow:edit-command", { detail }));
    const msg = editCommandNotice(command, { handled: detail.handled, activePanel });
    if (msg) {
      addServerLog({ level: "warn", msg });
      showNotice(msg);
    }
  };

  // Show Programming is lazy-loaded: re-dispatch until its listener has mounted.
  const openShowAi = () => retryDispatch(() => {
    const detail = { handled: false };
    window.dispatchEvent(new CustomEvent("aquaflow:open-show-ai", { detail }));
    return detail.handled;
  }, { schedule: (fn, ms) => window.setTimeout(fn, ms) });

  const exportShow = () => {
    try {
      const project = useProjectStore.getState();
      const state = useShowStore.getState();
      downloadShowFile(state, useEngineeringStore.getState().getProjectPayload(), project.getProjectDocument(state.currentShow?.name));
      const fileName = `${(state.currentShow?.name || "show").replace(/\s+/g, "_")}.aqua`;
      addServerLog({ level: "info", msg: `Exported show file: ${fileName}` });
      showNotice(`Exported ${fileName}`, "info");
    } catch (e) {
      addServerLog({ level: "error", msg: `Export failed: ${e.message}` });
      showNotice(`Export failed: ${e.message}`, "error");
    }
  };

  const importShow = () => {
    if (isDirty && !window.confirm("Import a show file? Unsaved changes in the current project will be replaced.")) return;
    const input = importInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

  const handleImportFile = async (file) => {
    if (!file) return;
    try {
      // AF-NEXT-006: .aqua or .aquapkg; files with an asset manifest are verified and the
      // missing/changed-asset report is shown before playback. Legacy files load unchanged.
      const { state } = await openProjectFile(file);
      const name = state.currentShow?.name || file.name;
      addServerLog({ level: "info", msg: `Imported show file: ${name}` });
      showNotice(`Imported ${name}`, "info");
    } catch (e) {
      addServerLog({ level: "error", msg: `Import failed: ${e.message}` });
      showNotice(`Import failed: ${e.message}`, "error");
    }
  };

  const menuActions = createMenuActionHandlers({
    openBrowser: (mode) => onOpenBrowser?.(mode),
    setActivePanel,
    importShow,
    exportShow,
    // Failures are already reported by projectPersistence (toast + log).
    saveProject: (options) => { saveProject(options).catch(() => {}); },
    packageProject: () => { packageProject().catch(() => {}); },
    showPreferences: () => { setAnalyticsOn(hasConsent()); setShowPrefs(true); },
    showAbout: () => setShowAbout(true),
    showShortcuts: () => setShowShortcutHelp(true),
    undo,
    redo,
    editCommand: runEditCommand,
    emit: emitStudioEvent,
    defer: (fn) => window.setTimeout(fn, 0),
    toggleShowGrid,
    toggleSnapToGrid,
    addTimelineTrack,
    quantizeTimeline,
    emergencyStop: () => handleEStop(),
    openShowAi,
  });

  const handleMenuAction = (item) => {
    setOpenMenu(null);
    const run = menuActions[item];
    if (!run) {
      addServerLog({ level: "warn", msg: `Menu item "${item}" has no action` });
      return;
    }
    run();
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
  // AF-NEXT-014: with workspaces, the panel menus live in one "All tools" menu.
  const topMenus = workspaceSwitcher ? WORKSPACE_TOP_MENUS : Object.keys(MENU_ITEMS);
  const menuEntries = (menu) => (menu === ALL_TOOLS_MENU ? allToolsEntries() : MENU_ITEMS[menu]);

  return (
    <>
    <div className="desktop-menubar"
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
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 12, color: "var(--brand-gold-light)", lineHeight: 1.2 }}>Luxury Con</span>
          <span style={{ fontSize: 9, color: "var(--brand-gold)", opacity: 0.7, lineHeight: 1.2 }}>Fountain Studio</span>
        </div>
      </div>

      {/* Professional grouped menus */}
      <div ref={menuRoot} style={{ display: "flex", height: "100%", flexShrink: 0 }}>
        {topMenus.map((menu) => (
          <Fragment key={menu}>
          <div style={{ position: "relative" }}>
            <button
              aria-haspopup="menu"
              aria-expanded={openMenu === menu}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault(); setOpenMenu(menu);
                  const container = e.currentTarget.parentElement;
                  requestAnimationFrame(() => container.querySelector('[role="menuitem"]')?.focus());
                }
              }}
              onClick={() => setOpenMenu(openMenu === menu ? null : menu)}
              onMouseEnter={() => {
                if (openMenu) setOpenMenu(menu);
              }}
              style={{
                height: "100%",
                padding: "0 10px",
                background: openMenu === menu || (!workspaceSwitcher && activeGroup === menu) ? "rgba(201,162,39,0.12)" : "transparent",
                border: "none",
                borderBottom: !workspaceSwitcher && activeGroup === menu ? "2px solid var(--border-accent)" : "2px solid transparent",
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
                    ...(menu === ALL_TOOLS_MENU ? { maxHeight: "calc(100vh - var(--topbar-h) - 16px)", overflowY: "auto" } : {}),
                  }}
                  role="menu"
                  aria-label={menu}
                  onKeyDown={e => {
                    const items = [...e.currentTarget.querySelectorAll('[role="menuitem"]')];
                    const index = items.indexOf(document.activeElement);
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault(); items[(index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
                    }
                    if (e.key === 'Escape') { e.currentTarget.parentElement.querySelector('button')?.focus(); setOpenMenu(null); }
                    if (e.key === 'Tab') setOpenMenu(null);
                  }}
                >
                  {menuEntries(menu).map((entry, i) => {
                    const [label, type, value, shortcut] = entry;
                    if (type === "separator") {
                      return <div key={i} style={{ height: 1, background: "var(--border)", margin: "5px 0" }} />;
                    }
                    if (type === "header") {
                      return <div key={i} style={{ padding: "7px 14px 3px", color: "var(--text-muted)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", borderTop: i ? "1px solid var(--border)" : "none", marginTop: i ? 4 : 0 }}>{label}</div>;
                    }

                    const isActivePanel = type === "panel" && activePanel === value;

                    return (
                      <button
                        key={i}
                        role="menuitem"
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
                        <span style={{ display:"inline-flex", alignItems:"center", gap:8, color:"var(--text-muted)", fontFamily:"var(--font-mono)", fontSize:10 }}>
                          {shortcut && <span>{shortcut}</span>}
                          {isActivePanel && <span style={{ color: "var(--text-accent)" }}>●</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          </Fragment>
        ))}
      </div>

      {/* Show name */}
      <div style={{ padding: "0 8px", borderLeft: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <span style={{ color: "var(--text-secondary)", fontSize: 11, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentShow.name}</span>
        {isDirty && <span style={{ fontSize: 8, color: "var(--amber)" }}>●</span>}
      </div>

      <div style={{ flex: 1 }} />

      {/* Show Studio owns its design-preview transport; keep global safety controls below. */}
      {activePanel !== "show_programmer" && <>
      {/* Transport */}
      <div style={{ display: "flex", alignItems: "center", gap: 1, padding: "0 5px", borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)", height: "100%", flexShrink: 0 }}>
        <TBtn title="Go to start" icon="⏮" onClick={() => { if (sitePreview.active) { sitePreview.seek(0); return; } setPlayhead(0); safeSend({ type: "playback", action: "seek", position: 0 }, ""); }} />
        <TBtn title="Back 5 seconds" icon="⏪" onClick={() => seekRel(-5)} />
        <TBtn title="Play / Pause · Space" icon={displayedPlayback === "playing" ? "⏸" : "▶"} onClick={handlePlay} accent />
        <TBtn title="Stop · Shift+Space" icon="⏹" onClick={handleStop} />
        <TBtn title="Record" icon="⏺" onClick={() => { if (sitePreview.active) { addServerLog({ level: "info", msg: "Use Record in 3D Preview to record the simulation video." }); return; } setPlayback("recording"); safeSend({ type: "playback", action: "record" }, ""); }} red />
        <TBtn title="Forward 5 seconds" icon="⏩" onClick={() => seekRel(5)} />
      </div>

      {/* Timecode */}
      <div style={{ padding: "0 8px", borderRight: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500, color: playbackState === "playing" ? "var(--text-accent)" : "var(--text-primary)", flexShrink: 0 }}>
        {fmt(displayedPosition)}{sitePreview.active && <span style={{ fontSize: 9, color: "#57e6a5", marginLeft: 6 }}>SIMULATION</span>}
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

      </>}
      {/* Status + E-STOP */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 6px", flexShrink: 0 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: connOk ? "var(--green)" : "var(--amber)" }} />
        <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{connOk ? "LIVE" : "OFF"}</span>
        <button className="btn" onClick={onToggleLogs} style={{ padding: "2px 5px", fontSize: 10, color: "var(--text-muted)" }}>Logs</button>
        <button className="btn danger" onClick={handleEStop} style={{ padding: "3px 7px", fontSize: 11, fontWeight: 700 }}>⛔</button>
      </div>
      {showShortcutHelp && (
        <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onMouseDown={() => setShowShortcutHelp(false)} style={{ position:"fixed", inset:0, zIndex:1200, display:"grid", placeItems:"center", background:"rgba(0,0,0,0.68)", backdropFilter:"blur(3px)" }}>
          <div onMouseDown={(event) => event.stopPropagation()} style={{ width:"min(760px, calc(100vw - 48px))", maxHeight:"calc(100vh - 70px)", overflow:"auto", background:"var(--bg-raised)", border:"1px solid var(--border-accent)", borderRadius:10, boxShadow:"0 24px 80px rgba(0,0,0,0.7)" }}>
            <div style={{ display:"flex", alignItems:"center", padding:"14px 18px", borderBottom:"1px solid var(--border)", position:"sticky", top:0, background:"var(--bg-raised)", zIndex:1 }}>
              <div><div style={{ color:"var(--text-accent)", fontSize:14, fontWeight:700 }}>Keyboard Shortcuts</div><div style={{ color:"var(--text-muted)", fontSize:10, marginTop:2 }}>Shortcuts follow the active editor and are disabled while typing.</div></div>
              <button className="btn" onClick={() => setShowShortcutHelp(false)} style={{ marginLeft:"auto" }}>Close · Esc</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:12, padding:16 }}>
              {SHORTCUT_GROUPS.map(([group, entries]) => <div key={group} style={{ border:"1px solid var(--border)", borderRadius:7, padding:10, background:"var(--bg-panel)" }}>
                <div style={{ color:"var(--text-accent)", fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:7 }}>{group}</div>
                {entries.map(([label, keys]) => <div key={label} style={{ display:"flex", justifyContent:"space-between", gap:14, padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,0.04)", fontSize:11 }}><span style={{ color:"var(--text-secondary)" }}>{label}</span><kbd style={{ color:"var(--text-primary)", fontFamily:"var(--font-mono)", whiteSpace:"nowrap" }}>{keys}</kbd></div>)}
              </div>)}
            </div>
          </div>
        </div>
      )}
      <input
        ref={importInputRef}
        type="file"
        accept=".aqua,.aquapkg,application/json"
        aria-label="Import show file"
        style={{ display: "none" }}
        onChange={(e) => handleImportFile(e.target.files?.[0])}
      />
      {notice && (
        <div role="status" aria-live="polite" style={{ position:"fixed", top:"calc(var(--topbar-h) + 8px)", right:12, zIndex:1300, maxWidth:360, padding:"7px 12px", background:"var(--bg-raised)", border:`1px solid ${notice.level === "error" ? "var(--red)" : notice.level === "info" ? "var(--border-accent)" : "var(--amber)"}`, borderRadius:6, color:"var(--text-primary)", fontSize:11, boxShadow:"0 8px 24px rgba(0,0,0,0.5)" }}>
          {notice.text}
        </div>
      )}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} connOk={connOk} />}
      {showPrefs && (
        <ModalShell label="Preferences" title="Preferences" subtitle="Changes apply immediately." onClose={() => setShowPrefs(false)}>
          <div style={{ display:"flex", flexDirection:"column", gap:10, padding:16 }}>
            <PrefToggle label="Show grid" hint="Grid in the node editor and timeline." checked={!!showGrid} onChange={() => toggleShowGrid()} />
            <PrefToggle label="Snap to grid" hint="Snap moved nodes and timeline clips to the grid / beat." checked={!!snapToGrid} onChange={() => toggleSnapToGrid()} />
            <label style={{ display:"flex", alignItems:"center", gap:10, fontSize:12, color:"var(--text-primary)" }}>
              <span style={{ flex:1 }}>Timeline zoom<div style={{ color:"var(--text-muted)", fontSize:10 }}>Pixels per second in the timeline (1–20).</div></span>
              <input type="range" min={1} max={20} step={1} value={timelineZoom ?? 4} onChange={(e) => setTimelineZoom(Number(e.target.value))} aria-label="Timeline zoom" />
              <span style={{ width:24, textAlign:"right", fontFamily:"var(--font-mono)", fontSize:11 }}>{timelineZoom}</span>
            </label>
            <PrefToggle label="Anonymous usage analytics" hint="Share anonymous feature usage to improve AquaFlow. No personal data." checked={analyticsOn} onChange={() => setAnalyticsOn(setConsent(!analyticsOn))} />
          </div>
        </ModalShell>
      )}
    </div>
    {workspaceSwitcher && <div className="desktop-workspace-bar">{workspaceSwitcher}</div>}
    </>
  );
}

function ModalShell({ label, title, subtitle, onClose, children }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={label} onMouseDown={onClose} style={{ position:"fixed", inset:0, zIndex:1200, display:"grid", placeItems:"center", background:"rgba(0,0,0,0.68)", backdropFilter:"blur(3px)" }}>
      <div onMouseDown={(event) => event.stopPropagation()} style={{ width:"min(460px, calc(100vw - 48px))", maxHeight:"calc(100vh - 70px)", overflow:"auto", background:"var(--bg-raised)", border:"1px solid var(--border-accent)", borderRadius:10, boxShadow:"0 24px 80px rgba(0,0,0,0.7)" }}>
        <div style={{ display:"flex", alignItems:"center", padding:"14px 18px", borderBottom:"1px solid var(--border)" }}>
          <div><div style={{ color:"var(--text-accent)", fontSize:14, fontWeight:700 }}>{title}</div>{subtitle && <div style={{ color:"var(--text-muted)", fontSize:10, marginTop:2 }}>{subtitle}</div>}</div>
          <button className="btn" onClick={onClose} style={{ marginLeft:"auto" }}>Close · Esc</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PrefToggle({ label, hint, checked, onChange }) {
  return (
    <label style={{ display:"flex", alignItems:"center", gap:10, fontSize:12, color:"var(--text-primary)", cursor:"pointer" }}>
      <span style={{ flex:1 }}>{label}{hint && <div style={{ color:"var(--text-muted)", fontSize:10 }}>{hint}</div>}</span>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} />
    </label>
  );
}

function AboutDialog({ onClose, connOk }) {
  const [license, setLicense] = useState(null);
  const [licenseError, setLicenseError] = useState(null);
  const [backendVersion, setBackendVersion] = useState(null);
  const [backendError, setBackendError] = useState(null);
  const isDesktop = typeof window !== "undefined" && window.aquaflow?.shell === "electron";
  const desktopVersion = isDesktop ? desktopVersionFromUserAgent(typeof navigator !== "undefined" ? navigator.userAgent : "") : null;

  useEffect(() => {
    let alive = true;
    apiGet("/license/status").then((d) => alive && setLicense(d)).catch((e) => alive && setLicenseError(e.message));
    apiGet("/health").then((d) => alive && setBackendVersion(d?.version || "unknown")).catch((e) => alive && setBackendError(e.message));
    return () => { alive = false; };
  }, []);

  const row = (k, v) => (
    <div key={k} style={{ display:"flex", justifyContent:"space-between", gap:14, padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,0.04)", fontSize:11 }}>
      <span style={{ color:"var(--text-secondary)" }}>{k}</span><span style={{ color:"var(--text-primary)", fontFamily:"var(--font-mono)", textAlign:"right" }}>{v}</span>
    </div>
  );
  const licensee = license ? [license.user_name, license.company_name].filter(Boolean).join(" · ") || "—" : null;
  const expiry = license?.expires_at ? `${String(license.expires_at).slice(0, 10)}${license.days_remaining != null ? ` (${license.days_remaining} days left)` : ""}` : "—";

  return (
    <ModalShell label="About AquaFlow" title="About AquaFlow" onClose={onClose}>
      <div style={{ padding:16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <img src="/luxcon-icon.png" alt="" style={{ height:34, width:"auto" }} />
          <div>
            <div style={{ color:"var(--brand-gold-light)", fontFamily:"var(--font-display)", fontWeight:700, fontSize:15 }}>AquaFlow Studio</div>
            <div style={{ color:"var(--text-muted)", fontSize:10 }}>Fountain design, engineering, programming & operation</div>
          </div>
        </div>
        {desktopVersion && row("Desktop app version", desktopVersion)}
        {row("Frontend version", FRONTEND_VERSION)}
        {row("Backend", backendError ? `unreachable (${backendError})` : backendVersion ? `${connOk ? "connected" : "reachable"} · v${backendVersion}` : "checking…")}
        {licenseError ? row("License", `unavailable (${licenseError})`) : !license ? row("License", "checking…") : <>
          {row("License status", license.status || (license.valid ? "VALID" : "INVALID"))}
          {row("Edition", license.edition || "—")}
          {row("Licensed to", licensee)}
          {row("Expires", expiry)}
        </>}
        <div style={{ marginTop:14, color:"var(--text-muted)", fontSize:10, textAlign:"center" }}>© LuxuryCon</div>
      </div>
    </ModalShell>
  );
}

function TBtn({ icon, onClick, accent, red, title }) {
  return (
    <button
      title={title}
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
