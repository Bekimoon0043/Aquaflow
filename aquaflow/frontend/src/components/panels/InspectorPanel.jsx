import { useMemo, useState } from "react";
import { useShowStore } from "../../store/showStore";
import { API_BASE_URL } from "../../config";

const DEVICES_API = `${API_BASE_URL}/devices`;
const AI_API = `${API_BASE_URL}/ai`;

const inferPatternFromPrompt = (prompt) => {
  const text = prompt.toLowerCase();
  if (text.includes("burst") || text.includes("hit") || text.includes("drop")) return "burst";
  if (text.includes("wave") || text.includes("sweep") || text.includes("flow")) return "wave";
  if (text.includes("random") || text.includes("scatter") || text.includes("chaos")) return "random";
  if (text.includes("pulse") || text.includes("beat") || text.includes("strobe")) return "pulse";
  return "cascade";
};

const inferIntensityFromPrompt = (prompt) => {
  const text = prompt.toLowerCase();
  if (text.includes("gentle") || text.includes("soft") || text.includes("ambient")) return 45;
  if (text.includes("aggressive") || text.includes("intense") || text.includes("full")) return 95;
  if (text.includes("medium") || text.includes("balanced")) return 70;
  return 80;
};

export default function InspectorPanel({ width }) {
  const {
    nodes,
    devices,
    timelineTracks,
    currentShow,
    selectedNodeId,
    selectedDeviceId,
    selectedTrackId,
    selectedClipId,
    selectedClipIds,
    updateNodeParam,
    updateDevicePatch,
    updateTimelineClip,
    removeTimelineClip,
    removeSelectedTimelineClips,
    duplicateTimelineClip,
    duplicateSelectedTimelineClips,
    applyPatternToTrack,
    addServerLog,
  } = useShowStore();
  const [tab, setTab] = useState("params");

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) || null;
  const selectedTrack = timelineTracks.find((track) => track.id === selectedTrackId) || null;
  const normalizedSelectedClipIds = selectedClipIds?.length ? selectedClipIds : (selectedClipId ? [selectedClipId] : []);
  const selectedClips = timelineTracks.flatMap((track) =>
    (track.clips || [])
      .filter((clip) => normalizedSelectedClipIds.includes(clip.id))
      .map((clip) => ({ clip, track }))
  );
  const selectedClip = selectedClips.length === 1 ? selectedClips[0].clip : null;
  const selectedClipTrack = selectedClips.length === 1 ? selectedClips[0].track : selectedTrack;
  const subject = selectedNode || selectedDevice;
  const clipOnlyMode = !subject && selectedClips.length === 1;
  const multiClipMode = !subject && selectedClips.length > 1;

  return (
    <div className="panel-right" style={{ width, flexShrink: 0 }}>
      <div className="panel-header">
        <div className="dot amber" />
        <span className="panel-title">Inspector</span>
      </div>

      {!clipOnlyMode && (
        <div style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-surface)",
          flexShrink: 0,
        }}>
          {["params", "io", "ai"].map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1,
              padding: "6px 0",
              background: "transparent",
              border: "none",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab === t ? "var(--text-accent)" : "var(--text-muted)",
              fontFamily: "var(--font-body)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              cursor: "pointer",
              fontWeight: tab === t ? 600 : 400,
            }}>
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="panel-body" style={{ padding: "10px" }}>
        {!subject && !selectedClips.length ? (
          <EmptyState />
        ) : multiClipMode ? (
          <MultiClipSummary
            selectedClips={selectedClips}
            duplicateSelectedTimelineClips={duplicateSelectedTimelineClips}
            removeSelectedTimelineClips={removeSelectedTimelineClips}
            addServerLog={addServerLog}
          />
        ) : clipOnlyMode ? (
          <ClipTab
            clip={selectedClip}
            track={selectedClipTrack}
            currentShow={currentShow}
            updateTimelineClip={updateTimelineClip}
            removeTimelineClip={removeTimelineClip}
            duplicateTimelineClip={duplicateTimelineClip}
            addServerLog={addServerLog}
          />
        ) : tab === "params" ? (
          <ParamsTab
            subject={subject}
            isNode={!!selectedNode}
            updateNodeParam={updateNodeParam}
            updateDevicePatch={updateDevicePatch}
            addServerLog={addServerLog}
          />
        ) : tab === "io" ? (
          <IOTab subject={subject} isNode={!!selectedNode} />
        ) : (
          <AITab
            subject={subject}
            currentShow={currentShow}
            applyPatternToTrack={applyPatternToTrack}
            addServerLog={addServerLog}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted)" }}>
      <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.4 }}>◈</div>
      <div style={{ fontSize: 11, lineHeight: 1.6 }}>
        Select a node, device, or timeline clip<br />to inspect properties<br />Ctrl/Cmd-click or Shift-drag in the timeline for bulk clip workflows
      </div>
    </div>
  );
}

function ParamsTab({ subject, isNode, updateNodeParam, updateDevicePatch, addServerLog }) {
  const [busyAction, setBusyAction] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const TYPE_COLORS = {
    pump: "#00d4ff", valve: "#8b5cf6", lighting: "#f59e0b",
    flame: "#ef4444", sequencer: "#10b981", audio: "#a78bfa",
  };
  const color = TYPE_COLORS[subject.type] || "var(--accent)";

  const runDeviceAction = async (action) => {
    if (isNode) return;
    setBusyAction(action);
    setActionStatus("");
    try {
      const endpoint = action === "emergency"
        ? `${DEVICES_API}/emergency-stop`
        : `${DEVICES_API}/${subject.id}/${action}`;
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `${action} failed`);
      if (action === "test") {
        updateDevicePatch(subject.id, { status: "warn" });
        setActionStatus("Test command sent");
      } else if (action === "identify") {
        setActionStatus("Identify command sent");
      } else {
        updateDevicePatch(subject.id, { status: "offline", health: 0 });
        setActionStatus("Emergency stop sent");
      }
      addServerLog({ level: action === "emergency" ? "error" : "info", msg: `${subject.label}: ${action} command accepted` });
    } catch (error) {
      setActionStatus(error.message);
      addServerLog({ level: "error", msg: `${subject.label}: ${error.message}` });
    } finally {
      setBusyAction("");
    }
  };

  return (
    <div>
      <div style={{
        background: "var(--bg-surface)", borderRadius: "var(--radius-md)",
        border: `1px solid ${color}33`, padding: "10px 12px", marginBottom: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>{subject.label}</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className={`badge ${subject.protocol || ""}`} style={{ fontSize: 9 }}>
            {subject.protocol?.toUpperCase() || "INTERNAL"}
          </span>
          <span className={`badge ${subject.status}`} style={{ fontSize: 9 }}>
            {subject.status?.toUpperCase()}
          </span>
        </div>
        {subject.ip && (
          <div style={{ marginTop: 6, fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            {subject.ip}:{subject.port}
          </div>
        )}
      </div>

      {isNode && subject.params && (
        <div>
          <SectionLabel>Parameters</SectionLabel>
          {Object.entries(subject.params).map(([key, val]) => (
            <ParamRow key={key} label={key} value={val}
              onChange={(v) => updateNodeParam(subject.id, key, v)}
            />
          ))}
        </div>
      )}

      {!isNode && (
        <>
          <SectionLabel>Health</SectionLabel>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Signal Quality</span>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{subject.health}%</span>
            </div>
            <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                width: `${subject.health}%`, height: "100%", borderRadius: 2,
                background: subject.health > 80 ? "var(--green)" : subject.health > 50 ? "var(--amber)" : "var(--red)",
                transition: "width 0.3s",
              }} />
            </div>
          </div>

          <SectionLabel>Actions</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button className="btn" style={{ fontSize: 11, justifyContent: "center" }} onClick={() => runDeviceAction("test")}>
              {busyAction === "test" ? "Testing..." : "Test Device"}
            </button>
            <button className="btn" style={{ fontSize: 11, justifyContent: "center" }} onClick={() => runDeviceAction("identify")}>
              {busyAction === "identify" ? "Identifying..." : "Identify Device"}
            </button>
            <button className="btn danger" style={{ fontSize: 11, justifyContent: "center" }} onClick={() => runDeviceAction("emergency")}>
              {busyAction === "emergency" ? "Stopping..." : "Emergency Stop"}
            </button>
          </div>
          {actionStatus && (
            <div style={{ marginTop: 10, fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {actionStatus}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function IOTab({ subject, isNode }) {
  if (!isNode || !subject.ports) return (
    <div style={{ color: "var(--text-muted)", fontSize: 11 }}>No I/O configuration for devices.</div>
  );
  return (
    <div>
      <SectionLabel>Input Ports</SectionLabel>
      {subject.ports.in.map((port) => (
        <div key={port} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 8px", marginBottom: 4,
          background: "var(--bg-surface)", borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
        }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", border: "1.5px solid #00d4ff", background: "var(--bg-base)" }} />
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{port}</span>
          <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--text-muted)" }}>IN</span>
        </div>
      ))}
      <SectionLabel>Output Ports</SectionLabel>
      {subject.ports.out.map((port) => (
        <div key={port} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 8px", marginBottom: 4,
          background: "var(--bg-surface)", borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
        }}>
          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>OUT</span>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{port}</span>
          <div style={{ marginLeft: "auto", width: 7, height: 7, borderRadius: "50%", border: "1.5px solid #8b5cf6", background: "var(--bg-base)" }} />
        </div>
      ))}
    </div>
  );
}

function AITab({ subject, currentShow, applyPatternToTrack, addServerLog }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const trackType = useMemo(() => {
    return ["pump", "valve", "lighting", "flame", "fog", "laser"].includes(subject.type)
      ? subject.type
      : "lighting";
  }, [subject.type]);

  const generate = async (forcedPrompt = null) => {
    const finalPrompt = (forcedPrompt ?? prompt).trim();
    if (!finalPrompt) return;
    setLoading(true);
    try {
      const body = {
        device_type: ["pump", "valve", "lighting", "flame"].includes(trackType) ? trackType : "lighting",
        pattern: inferPatternFromPrompt(finalPrompt),
        intensity: inferIntensityFromPrompt(finalPrompt),
        duration: Math.min(32, Math.max(8, Number(currentShow?.duration || 32))),
        bpm: Number(currentShow?.bpm || 128),
      };
      const res = await fetch(`${AI_API}/generate-pattern`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Pattern generation failed");
      setResult({
        ...data,
        summary: `Generated ${data.clip_count} ${data.pattern} clips for ${subject.label}`,
      });
      addServerLog({ level: "info", msg: `AI generated ${data.clip_count} clips for ${subject.label}` });
    } catch (error) {
      setResult({
        clip_count: 0,
        pattern: inferPatternFromPrompt(finalPrompt),
        clips: [],
        summary: error.message,
      });
      addServerLog({ level: "error", msg: `AI generation failed for ${subject.label}: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  const quickActions = [
    "Sync to beat with pulse hits",
    "Mirror left/right with wave motion",
    "Randomize timing for organic variation",
    "Optimize energy with gentle cascades",
  ];

  return (
    <div>
      <SectionLabel>AI Choreography</SectionLabel>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8, lineHeight: 1.5 }}>
        Describe the desired behavior for <strong style={{ color: "var(--text-primary)" }}>{subject.label}</strong>:
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. Aggressive burst pattern synchronized to bass drops, ramp up during intro..."
        style={{
          width: "100%", height: 80, background: "var(--bg-void)", border: "1px solid var(--border-mid)",
          borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontFamily: "var(--font-body)",
          fontSize: 11, padding: "8px", resize: "none", outline: "none", lineHeight: 1.5,
        }}
      />
      <button
        className="btn primary"
        style={{ width: "100%", marginTop: 8, justifyContent: "center", fontSize: 11 }}
        onClick={() => generate()}
        disabled={loading}
      >
        {loading ? "Generating..." : "✨ Generate Pattern"}
      </button>

      {result && (
        <div style={{
          marginTop: 12, padding: "10px 12px",
          background: "rgba(0,212,255,0.05)", border: "1px solid var(--border-accent)",
          borderRadius: "var(--radius-md)", fontSize: 11, color: "var(--text-secondary)",
          lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>{result.summary}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
            Pattern: {result.pattern || "—"} · Clips: {result.clip_count ?? 0} · Target track: {trackType}
          </div>
          {result.clips?.length > 0 && (
            <button
              className="btn"
              style={{ marginTop: 8, fontSize: 10, justifyContent: "center", width: "100%" }}
              onClick={() => {
                applyPatternToTrack(trackType, result.clips);
                addServerLog({ level: "info", msg: `Applied AI pattern to ${trackType} track` });
              }}
            >
              Apply to {trackType} track
            </button>
          )}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <SectionLabel>Quick Actions</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {quickActions.map((action) => (
            <button
              key={action}
              className="btn"
              style={{ fontSize: 10, justifyContent: "flex-start", gap: 6 }}
              onClick={() => {
                setPrompt(action);
                generate(action);
              }}
            >
              <span style={{ color: "var(--accent)", fontSize: 9 }}>✦</span> {action}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MultiClipSummary({ selectedClips, duplicateSelectedTimelineClips, removeSelectedTimelineClips, addServerLog }) {
  const trackCount = new Set(selectedClips.map(({ track }) => track.id)).size;
  const earliest = Math.min(...selectedClips.map(({ clip }) => Number(clip.start)));
  const latest = Math.max(...selectedClips.map(({ clip }) => Number(clip.end)));
  const averageIntensity = Math.round(
    selectedClips.reduce((sum, { clip }) => sum + Number(clip.intensity || 0), 0) / Math.max(1, selectedClips.length)
  );
  const typeSummary = [...new Set(selectedClips.map(({ track }) => track.type?.toUpperCase() || "TRACK"))].join(" · ");

  return (
    <div>
      <div style={{
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-md)",
        border: "1px solid rgba(201,162,39,0.35)",
        padding: "10px 12px",
        marginBottom: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>{selectedClips.length} Clips Selected</span>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {trackCount} track{trackCount === 1 ? "" : "s"} · {typeSummary}
        </div>
      </div>

      <SectionLabel>Selection Summary</SectionLabel>
      <div style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "10px 12px",
        fontSize: 11,
        color: "var(--text-secondary)",
        lineHeight: 1.7,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>Tracks affected</span><span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{trackCount}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>Time span</span><span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{earliest.toFixed(2)}s → {latest.toFixed(2)}s</span></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>Average intensity</span><span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{averageIntensity}%</span></div>
      </div>

      <SectionLabel>Included Clips</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {selectedClips.slice(0, 8).map(({ clip, track }) => (
          <div
            key={clip.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              padding: "7px 9px",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-surface)",
              border: `1px solid ${track?.color || "var(--border)"}33`,
              fontSize: 10,
            }}
          >
            <div>
              <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>{clip.label}</div>
              <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{track?.label || "Track"}</div>
            </div>
            <div style={{ textAlign: "right", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
              <div>{Number(clip.start).toFixed(2)}s → {Number(clip.end).toFixed(2)}s</div>
              <div>{Number(clip.intensity).toFixed(0)}%</div>
            </div>
          </div>
        ))}
        {selectedClips.length > 8 && (
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            +{selectedClips.length - 8} more clips in selection
          </div>
        )}
      </div>

      <SectionLabel>Bulk Actions</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button className="btn" style={{ fontSize: 11, justifyContent: "center" }} onClick={() => {
          duplicateSelectedTimelineClips();
          addServerLog({ level: "info", msg: `Duplicated ${selectedClips.length} selected clips` });
        }}>
          Duplicate Selection
        </button>
        <button className="btn danger" style={{ fontSize: 11, justifyContent: "center" }} onClick={() => {
          removeSelectedTimelineClips();
          addServerLog({ level: "warn", msg: `Deleted ${selectedClips.length} selected clips` });
        }}>
          Delete Selection
        </button>
      </div>
    </div>
  );
}

function ClipTab({ clip, track, currentShow, updateTimelineClip, removeTimelineClip, duplicateTimelineClip, addServerLog }) {
  const bpm = Number(currentShow?.bpm || 120);
  const beatStep = Math.max(0.05, (60 / Math.max(1, bpm)) * 0.25);

  return (
    <div>
      <div style={{
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${track?.color || "var(--border-accent)"}`,
        padding: "10px 12px",
        marginBottom: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: track?.color || "var(--accent)" }} />
          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>{clip.label}</span>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {track?.label || "Track"} · {track?.type?.toUpperCase() || "TRACK"}
          {track?.muted ? " · MUTED" : ""}
          {track?.solo ? " · SOLO" : ""}
        </div>
      </div>

      <SectionLabel>Clip Parameters</SectionLabel>
      <ParamRow label="label" value={clip.label} onChange={(value) => updateTimelineClip(track.id, clip.id, { label: value })} />
      <ParamRow label="start" value={clip.start} onChange={(value) => updateTimelineClip(track.id, clip.id, { start: value })} />
      <ParamRow label="end" value={clip.end} onChange={(value) => updateTimelineClip(track.id, clip.id, { end: value })} />
      <ParamRow label="intensity" value={clip.intensity} onChange={(value) => updateTimelineClip(track.id, clip.id, { intensity: value })} />

      <SectionLabel>Timing</SectionLabel>
      <div style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "10px 12px",
        fontSize: 11,
        color: "var(--text-secondary)",
        lineHeight: 1.7,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>Duration</span><span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{Math.max(0, clip.end - clip.start).toFixed(2)}s</span></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>Quarter-step</span><span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{beatStep.toFixed(2)}s</span></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>Show BPM</span><span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{bpm}</span></div>
      </div>

      <SectionLabel>Actions</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button className="btn" style={{ fontSize: 11, justifyContent: "center" }} onClick={() => {
          duplicateTimelineClip(track.id, clip.id);
          addServerLog({ level: "info", msg: `Duplicated clip '${clip.label}'` });
        }}>
          Duplicate Clip
        </button>
        <button className="btn danger" style={{ fontSize: 11, justifyContent: "center" }} onClick={() => {
          removeTimelineClip(track.id, clip.id);
          addServerLog({ level: "warn", msg: `Deleted clip '${clip.label}'` });
        }}>
          Delete Clip
        </button>
      </div>
    </div>
  );
}

function ParamRow({ label, value, onChange }) {
  const isNum = typeof value === "number";
  const isBool = typeof value === "boolean";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      marginBottom: 6, minHeight: 26,
    }}>
      <span style={{
        fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)",
        width: 90, flexShrink: 0, textAlign: "right",
      }}>
        {label}
      </span>
      {isBool ? (
        <button
          onClick={() => onChange(!value)}
          style={{
            width: 36, height: 18, borderRadius: 9,
            background: value ? "rgba(0,212,255,0.2)" : "var(--bg-void)",
            border: `1px solid ${value ? "var(--accent)" : "var(--border-mid)"}`,
            cursor: "pointer", position: "relative", transition: "all 0.15s",
          }}
        >
          <div style={{
            width: 12, height: 12, borderRadius: "50%", position: "absolute",
            top: 2, left: value ? 20 : 2, background: value ? "var(--accent)" : "var(--text-muted)",
            transition: "left 0.15s",
          }} />
        </button>
      ) : isNum ? (
        <input
          type="number" value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="input" style={{ fontSize: 11, fontFamily: "var(--font-mono)", flex: 1 }}
        />
      ) : (
        <input
          type="text" value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="input" style={{ fontSize: 11, fontFamily: "var(--font-mono)", flex: 1 }}
        />
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 600, fontFamily: "var(--font-mono)",
      color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em",
      marginBottom: 8, marginTop: 14, borderBottom: "1px solid var(--border)", paddingBottom: 4,
    }}>
      {children}
    </div>
  );
}
