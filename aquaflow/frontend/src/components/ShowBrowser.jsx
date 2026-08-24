import { useState, useRef, useEffect, useMemo } from "react";
import { useShowStore } from "../store/showStore";
import useEngineeringStore from "../store/engineeringStore";
import { createDefaultEngineeringProject } from "../engineering/engineeringProject";
import {
  downloadShowFile,
  readShowFile,
  getRecentShows,
  saveToRecent,
  loadAutoSave,
  serializeShow,
  deserializeShow,
} from "../utils/showFile";
import { API_BASE_URL } from "../config";

export default function ShowBrowser({ mode, onClose }) {
  const store = useShowStore();
  const {
    currentShow,
    loadShow,
    markClean,
    addServerLog,
    connectionState,
  } = store;

  const [tab, setTab] = useState(mode === "save" ? "save" : mode === "new" ? "new" : "open");
  const [showName, setShowNameLocal] = useState(currentShow.name);
  const [bpm, setBpm] = useState(currentShow.bpm);
  const [duration, setDuration] = useState(currentShow.duration);
  const [recentShows, setRecentShows] = useState([]);
  const [backendShows, setBackendShows] = useState([]);
  const [backendBusy, setBackendBusy] = useState(false);
  const [savingRemote, setSavingRemote] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [backendError, setBackendError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const fileInputRef = useRef(null);
  const autoSave = loadAutoSave();
  const backendAvailable = connectionState === "connected";
  const engineeringRevision = useEngineeringStore((s) => s.lastUpdated);
  const loadEngineeringProject = useEngineeringStore((s) => s.loadProject);
  const currentEngineering = useMemo(
    () => useEngineeringStore.getState().getProjectPayload(),
    [engineeringRevision]
  );

  useEffect(() => {
    setRecentShows(getRecentShows());
  }, []);

  useEffect(() => {
    setShowNameLocal(currentShow.name);
    setBpm(currentShow.bpm);
    setDuration(currentShow.duration);
  }, [currentShow.name, currentShow.bpm, currentShow.duration]);

  const refreshBackendShows = async () => {
    if (!backendAvailable) {
      setBackendShows([]);
      setBackendError(null);
      return;
    }

    setBackendBusy(true);
    setBackendError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/shows`);
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      const data = await res.json();
      setBackendShows(Array.isArray(data.shows) ? data.shows : []);
    } catch (e) {
      setBackendError(`Backend show list unavailable: ${e.message}`);
    } finally {
      setBackendBusy(false);
    }
  };

  useEffect(() => {
    if (tab === "open") {
      refreshBackendShows();
    }
  }, [tab, backendAvailable]);

  const saveState = useMemo(() => {
    const state = useShowStore.getState();
    return {
      ...state,
      engineeringProject: currentEngineering,
      currentShow: {
        ...state.currentShow,
        name: showName || "Untitled Show",
        bpm: parseFloat(bpm) || 128,
        duration: parseFloat(duration) || 240,
      },
    };
  }, [showName, bpm, duration, currentEngineering]);

  const handleSave = async () => {
    setError(null);
    try {
      const payload = serializeShow(saveState, currentEngineering);

      if (backendAvailable) {
        setSavingRemote(true);
        const res = await fetch(`${API_BASE_URL}/shows`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Backend returned ${res.status}`);
        }
        const saved = await res.json();
        saveToRecent({ name: showName, bpm, duration, show_id: saved.show_id });
        markClean();
        addServerLog({ level: "info", msg: `Show saved to backend: ${saved.filename}` });
        await refreshBackendShows();
      } else {
        downloadShowFile(saveState);
        saveToRecent({ name: showName, bpm, duration });
        markClean();
        addServerLog({ level: "info", msg: `Show downloaded locally: ${showName}.aqua` });
      }

      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 1000);
    } catch (e) {
      setError("Save failed: " + e.message);
    } finally {
      setSavingRemote(false);
    }
  };

  const handleDownload = () => {
    setError(null);
    try {
      downloadShowFile(saveState, currentEngineering);
      addServerLog({ level: "info", msg: `Local export created: ${(showName || "show").replace(/\s+/g, "_")}.aqua` });
    } catch (e) {
      setError("Download failed: " + e.message);
    }
  };

  const handleFile = async (file) => {
    setError(null);
    try {
      const { state, meta } = await readShowFile(file);
      loadShow(state);
      loadEngineeringProject(state.engineeringProject);
      saveToRecent({ name: meta.name, savedAt: meta.savedAt });
      addServerLog({ level: "info", msg: `Opened local file: ${meta.name}` });
      onClose();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleOpenBackendShow = async (showId) => {
    setBackendError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/shows/${encodeURIComponent(showId)}`);
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      const data = await res.json();
      const state = deserializeShow(data);
      loadShow(state);
      loadEngineeringProject(state.engineeringProject);
      saveToRecent({
        name: data.show?.name || showId,
        savedAt: data.savedAt,
        show_id: showId,
      });
      addServerLog({ level: "info", msg: `Opened backend show: ${data.show?.name || showId}` });
      onClose();
    } catch (e) {
      setBackendError(`Open failed: ${e.message}`);
    }
  };

  const handleDeleteBackendShow = async (showId) => {
    if (!window.confirm(`Delete backend show '${showId}'?`)) return;
    setBackendError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/shows/${encodeURIComponent(showId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      addServerLog({ level: "warn", msg: `Deleted backend show: ${showId}` });
      await refreshBackendShows();
    } catch (e) {
      setBackendError(`Delete failed: ${e.message}`);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleNew = () => {
    loadShow({
      currentShow: {
        id: `show-${Date.now()}`,
        name: showName || "New Show",
        bpm: parseFloat(bpm) || 128,
        duration: parseFloat(duration) || 240,
        sampleRate: 48000,
      },
      nodes: [],
      connections: [],
      timelineTracks: [],
      devices: [],
      timelineZoom: 4,
      showGrid: true,
      snapToGrid: true,
    });
    loadEngineeringProject(createDefaultEngineeringProject());
    addServerLog({ level: "info", msg: `New show created: ${showName || "New Show"}` });
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 640,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 40px)",
          background: "var(--bg-panel)",
          border: "1px solid var(--border-mid)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          overflow: "hidden",
          animation: "fade-in 0.15s ease",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 20px",
            height: 48,
            background: "var(--bg-surface)",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <WaveIcon />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: "var(--text-primary)",
            }}
          >
            SHOW BROWSER
          </span>
          <div style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 10,
              color: backendAvailable ? "var(--green)" : "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {backendAvailable ? "Backend Connected" : "Local File Mode"}
          </span>
          <button className="btn icon-btn" onClick={onClose} style={{ fontSize: 14 }}>
            ✕
          </button>
        </div>

        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", flexShrink: 0 }}>
          {[["open", "Open Show"], ["save", "Save Show"], ["new", "New Show"]].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                flex: 1,
                padding: "10px 0",
                background: "transparent",
                border: "none",
                borderBottom: tab === key ? "2px solid var(--accent)" : "2px solid transparent",
                color: tab === key ? "var(--text-accent)" : "var(--text-muted)",
                fontFamily: "var(--font-body)",
                fontSize: 12,
                fontWeight: tab === key ? 600 : 400,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ padding: 20, overflow: "auto" }}>
          {tab === "open" && (
            <div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border-mid)"}`,
                  borderRadius: "var(--radius-md)",
                  padding: "28px 20px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: dragOver ? "var(--accent-pulse)" : "var(--bg-surface)",
                  transition: "all 0.15s",
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>📂</div>
                <div style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 4 }}>
                  Drop a <code style={{ color: "var(--accent)" }}>.aqua</code> file here
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>or click to browse a local project file</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".aqua,.json"
                  style={{ display: "none" }}
                  onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
                />
              </div>

              {error && <Notice tone="error">✕ {error}</Notice>}
              {backendError && <Notice tone="warn">{backendError}</Notice>}

              {autoSave && (
                <div style={{ marginBottom: 16 }}>
                  <SectionLabel>Auto-saved Session</SectionLabel>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      background: "rgba(0,212,255,0.05)",
                      border: "1px solid var(--border-accent)",
                      borderRadius: "var(--radius-md)",
                    }}
                  >
                    <span style={{ fontSize: 18 }}>⟳</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: "var(--text-primary)" }}>
                        {autoSave.state?.currentShow?.name || "Auto-saved Show"}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        Saved: {autoSave.savedAt ? new Date(autoSave.savedAt).toLocaleString() : "Unknown"}
                      </div>
                    </div>
                    <button
                      className="btn primary"
                      style={{ fontSize: 11 }}
                      onClick={() => {
                        loadShow(autoSave.state);
                        loadEngineeringProject(autoSave.state.engineeringProject);
                        addServerLog({ level: "info", msg: "Auto-saved session restored" });
                        onClose();
                      }}
                    >
                      Restore
                    </button>
                  </div>
                </div>
              )}

              {backendAvailable && (
                <div style={{ marginBottom: 16 }}>
                  <SectionLabel>Backend Storage</SectionLabel>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Saved shows on the AquaFlow backend</span>
                    <button className="btn" onClick={refreshBackendShows} style={{ fontSize: 10, padding: "4px 8px" }}>
                      ⟳ Refresh
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {backendBusy && (
                      <div style={{ padding: "12px", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
                        Loading backend shows...
                      </div>
                    )}
                    {!backendBusy && backendShows.length === 0 && (
                      <div style={{ padding: "12px", fontSize: 11, color: "var(--text-muted)", textAlign: "center", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
                        No backend shows saved yet.
                      </div>
                    )}
                    {backendShows.map((show) => (
                      <BackendShowRow
                        key={show.id}
                        show={show}
                        onOpen={() => handleOpenBackendShow(show.id)}
                        onDelete={() => handleDeleteBackendShow(show.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {recentShows.length > 0 && (
                <div>
                  <SectionLabel>Recent Shows</SectionLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {recentShows.map((show, i) => (
                      <div
                        key={`${show.name}-${i}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 12px",
                          background: "var(--bg-surface)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          cursor: "default",
                        }}
                      >
                        <span style={{ fontSize: 14, opacity: 0.6 }}>🌊</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, color: "var(--text-primary)" }}>{show.name}</div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                            {show.openedAt ? new Date(show.openedAt).toLocaleString() : ""}
                            {show.bpm ? ` · ${show.bpm} BPM` : ""}
                            {show.show_id ? ` · id:${show.show_id}` : ""}
                          </div>
                        </div>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>.aqua</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {recentShows.length === 0 && !autoSave && !backendBusy && (!backendAvailable || backendShows.length === 0) && (
                <div style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: 11 }}>
                  No recent shows found. Save a show first to populate this view.
                </div>
              )}
            </div>
          )}

          {tab === "save" && (
            <div>
              {error && <Notice tone="error">✕ {error}</Notice>}
              <SectionLabel>Show Details</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                <FieldRow label="Show Name">
                  <input
                    className="input"
                    value={showName}
                    onChange={(e) => setShowNameLocal(e.target.value)}
                    placeholder="My Fountain Show"
                    style={{ fontSize: 13 }}
                  />
                </FieldRow>
                <FieldRow label="BPM">
                  <input
                    className="input"
                    type="number"
                    value={bpm}
                    min={20}
                    max={300}
                    onChange={(e) => setBpm(e.target.value)}
                    style={{ fontSize: 13, fontFamily: "var(--font-mono)" }}
                  />
                </FieldRow>
                <FieldRow label="Duration (sec)">
                  <input
                    className="input"
                    type="number"
                    value={duration}
                    min={10}
                    onChange={(e) => setDuration(e.target.value)}
                    style={{ fontSize: 13, fontFamily: "var(--font-mono)" }}
                  />
                </FieldRow>
              </div>

              <div
                style={{
                  padding: "12px 14px",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Save payload
                </div>
                {[
                  ["Nodes", useShowStore.getState().nodes.length],
                  ["Connections", useShowStore.getState().connections.length],
                  ["Timeline Tracks", useShowStore.getState().timelineTracks.length],
                  ["Devices", useShowStore.getState().devices.length],
                  ["Engineering Fixtures", currentEngineering.fixtures.length],
                  ["Engineering Pipes", currentEngineering.pipes.length],
                ].map(([label, count]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 }}>
                    <span>{label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-accent)" }}>{count}</span>
                  </div>
                ))}
                <div style={{ marginTop: 6, fontSize: 10, color: backendAvailable ? "var(--green)" : "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  → {backendAvailable ? "Saving to backend storage" : `Downloading ${(showName || "show").replace(/\s+/g, "_")}.aqua`}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  className="btn primary"
                  onClick={handleSave}
                  style={{ flex: 1, justifyContent: "center", fontSize: 13, padding: "10px" }}
                  disabled={savingRemote}
                >
                  {saveSuccess ? "✓ Saved!" : savingRemote ? "Saving..." : backendAvailable ? "Save to Backend" : "Save as Local File"}
                </button>
                <button className="btn" onClick={handleDownload} style={{ width: 170, justifyContent: "center", fontSize: 13, padding: "10px" }}>
                  Download .aqua
                </button>
              </div>
            </div>
          )}

          {tab === "new" && (
            <div>
              <SectionLabel>New Show Settings</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                <FieldRow label="Show Name">
                  <input
                    className="input"
                    value={showName}
                    onChange={(e) => setShowNameLocal(e.target.value)}
                    placeholder="New Fountain Show"
                    style={{ fontSize: 13 }}
                    autoFocus
                  />
                </FieldRow>
                <FieldRow label="BPM">
                  <input
                    className="input"
                    type="number"
                    value={bpm}
                    min={20}
                    max={300}
                    onChange={(e) => setBpm(e.target.value)}
                    style={{ fontSize: 13, fontFamily: "var(--font-mono)" }}
                  />
                </FieldRow>
                <FieldRow label="Duration (sec)">
                  <input
                    className="input"
                    type="number"
                    value={duration}
                    min={10}
                    onChange={(e) => setDuration(e.target.value)}
                    style={{ fontSize: 13, fontFamily: "var(--font-mono)" }}
                  />
                </FieldRow>
              </div>

              <SectionLabel>Start from Template</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                {[
                  { name: "Blank", icon: "◻", desc: "Empty show" },
                  { name: "Music Sync", icon: "♫", desc: "Beat-reactive setup" },
                  { name: "Cinematic", icon: "🎬", desc: "Dramatic water ballet" },
                  { name: "Interactive", icon: "◉", desc: "Sensor-driven" },
                ].map((t) => (
                  <button
                    key={t.name}
                    className="btn"
                    style={{
                      flexDirection: "column",
                      gap: 4,
                      padding: "12px 8px",
                      textAlign: "center",
                      height: "auto",
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{t.icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 500 }}>{t.name}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{t.desc}</span>
                  </button>
                ))}
              </div>

              <button
                className="btn primary"
                onClick={handleNew}
                style={{ width: "100%", justifyContent: "center", fontSize: 13, padding: "10px" }}
              >
                ✦ Create New Show
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Notice({ tone = "info", children }) {
  const tones = {
    info: {
      background: "rgba(0,212,255,0.08)",
      border: "rgba(0,212,255,0.2)",
      color: "var(--accent)",
    },
    warn: {
      background: "rgba(245,158,11,0.08)",
      border: "rgba(245,158,11,0.2)",
      color: "var(--amber)",
    },
    error: {
      background: "rgba(239,68,68,0.08)",
      border: "rgba(239,68,68,0.2)",
      color: "var(--red)",
    },
  };

  const style = tones[tone] || tones.info;
  return (
    <div
      style={{
        padding: "8px 12px",
        background: style.background,
        border: `1px solid ${style.border}`,
        borderRadius: "var(--radius-sm)",
        color: style.color,
        fontSize: 11,
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

function BackendShowRow({ show, onOpen, onDelete }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <span style={{ fontSize: 16, opacity: 0.75 }}>☁</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {show.name || show.id}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {show.savedAt ? new Date(show.savedAt).toLocaleString() : "Unknown save time"}
          {show.bpm ? ` · ${show.bpm} BPM` : ""}
          {show.duration ? ` · ${show.duration}s` : ""}
        </div>
      </div>
      <button className="btn" onClick={onOpen} style={{ fontSize: 10, padding: "4px 8px" }}>
        Open
      </button>
      <button className="btn danger" onClick={onDelete} style={{ fontSize: 10, padding: "4px 8px" }}>
        Delete
      </button>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 9,
        fontWeight: 600,
        fontFamily: "var(--font-mono)",
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        marginBottom: 8,
        borderBottom: "1px solid var(--border)",
        paddingBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function FieldRow({ label, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", width: 100, flexShrink: 0, textAlign: "right", fontFamily: "var(--font-mono)" }}>
        {label}
      </span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function WaveIcon() {
  return <img src="/luxcon-icon.png" alt="LuxuryCon" style={{ height: 22, width: "auto" }} />;
}
