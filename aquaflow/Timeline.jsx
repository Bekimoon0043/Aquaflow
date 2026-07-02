import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useShowStore } from "../../store/showStore";
import { useWS } from "../../hooks/WebSocketContext";

const TRACK_H = 50;
const HEADER_W = 200;
const RULER_H = 28;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const roundTime = (value) => Number(Number(value || 0).toFixed(3));
const getBeatStep = (show, subdivision = 0.25) => {
  const bpm = Math.max(1, Number(show?.bpm || 120));
  return Math.max(0.05, (60 / bpm) * subdivision);
};

export default function Timeline({ height }) {
  const {
    timelineTracks,
    timelineZoom,
    playhead,
    currentShow,
    connectionState,
    playbackState,
    snapToGrid,
    selectedClipId,
    selectedTrackId,
    setPlayhead,
    setTimelineZoom,
    addTimelineTrack,
    createTimelineClip,
    updateTimelineClip,
    removeTimelineClip,
    duplicateTimelineClip,
    quantizeTimeline,
    autoGenerateTimeline,
    toggleTrackMute,
    toggleTrackSolo,
    selectTrack,
    selectClip,
    beginHistoryTransaction,
    commitHistoryTransaction,
    cancelHistoryTransaction,
    undo,
    redo,
    canUndo,
    canRedo,
    addServerLog,
  } = useShowStore();
  const { send } = useWS();
  const containerRef = useRef(null);
  const dragStateRef = useRef(null);
  const scrollXRef = useRef(0);
  const animRef = useRef(null);
  const startTimeRef = useRef(null);
  const [scrollX, setScrollX] = useState(0);

  const totalDuration = Math.max(30, Number(currentShow?.duration || 180));
  const canvasWidth = Math.max(1200, totalDuration * timelineZoom);
  const serverAuthoritative = connectionState === "connected";
  const snapStep = useMemo(() => getBeatStep(currentShow, 0.25), [currentShow]);
  const minDuration = Math.max(0.1, snapStep);

  const selectedTrack = useMemo(
    () => timelineTracks.find((track) => track.id === selectedTrackId) || timelineTracks[0] || null,
    [timelineTracks, selectedTrackId]
  );

  const selectedClipInfo = useMemo(() => {
    for (const track of timelineTracks) {
      const clip = (track.clips || []).find((entry) => entry.id === selectedClipId);
      if (clip) return { track, clip };
    }
    return null;
  }, [timelineTracks, selectedClipId]);

  const visibleSoloCount = useMemo(
    () => timelineTracks.filter((track) => track.solo).length,
    [timelineTracks]
  );

  useEffect(() => {
    scrollXRef.current = scrollX;
  }, [scrollX]);

  useEffect(() => {
    if (!serverAuthoritative && playbackState === "playing") {
      startTimeRef.current = performance.now() - playhead * 1000;
      const tick = () => {
        const elapsed = (performance.now() - startTimeRef.current) / 1000;
        setPlayhead(elapsed % totalDuration);
        animRef.current = requestAnimationFrame(tick);
        if (containerRef.current) {
          const ph = elapsed * timelineZoom;
          const visW = containerRef.current.clientWidth - HEADER_W;
          if (ph - scrollXRef.current > visW * 0.75) {
            const nextScroll = Math.max(0, ph - visW * 0.25);
            containerRef.current.scrollLeft = nextScroll;
            setScrollX(nextScroll);
          }
        }
      };
      animRef.current = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(animRef.current);
      if (playbackState === "stopped") startTimeRef.current = null;
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [serverAuthoritative, playbackState, playhead, setPlayhead, timelineZoom, totalDuration]);

  useEffect(() => {
    if (containerRef.current) {
      const ph = playhead * timelineZoom;
      const visW = containerRef.current.clientWidth - HEADER_W;
      if (ph - scrollXRef.current > visW * 0.75) {
        const nextScroll = Math.max(0, ph - visW * 0.25);
        containerRef.current.scrollLeft = nextScroll;
        setScrollX(nextScroll);
      }
    }
  }, [playhead, timelineZoom]);

  const snapTime = useCallback((value) => {
    if (!snapToGrid) return roundTime(Math.max(0, value));
    return roundTime(Math.round(Math.max(0, value) / snapStep) * snapStep);
  }, [snapStep, snapToGrid]);

  const clearDragListeners = useCallback(() => {
    const drag = dragStateRef.current;
    if (!drag) return;
    if (drag.moveHandler) document.removeEventListener("pointermove", drag.moveHandler);
    if (drag.upHandler) document.removeEventListener("pointerup", drag.upHandler);
    dragStateRef.current = null;
  }, []);

  useEffect(() => () => clearDragListeners(), [clearDragListeners]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;
      if (!selectedClipInfo) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeTimelineClip(selectedClipInfo.track.id, selectedClipInfo.clip.id);
        addServerLog({ level: "warn", msg: "Selected timeline clip deleted" });
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        addServerLog({ level: "info", msg: "Undo executed from timeline keyboard shortcut" });
        return;
      }

      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
        event.preventDefault();
        redo();
        addServerLog({ level: "info", msg: "Redo executed from timeline keyboard shortcut" });
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateTimelineClip(selectedClipInfo.track.id, selectedClipInfo.clip.id);
        addServerLog({ level: "info", msg: "Selected timeline clip duplicated" });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addServerLog, duplicateTimelineClip, removeTimelineClip, selectedClipInfo]);

  const startClipDrag = (event, trackId, clip, mode) => {
    event.stopPropagation();
    selectClip(trackId, clip.id);
    beginHistoryTransaction();

    const moveHandler = (moveEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;

      const deltaPx = moveEvent.clientX - drag.startX;
      const deltaTime = deltaPx / timelineZoom;
      const duration = drag.initialEnd - drag.initialStart;
      let start = drag.initialStart;
      let end = drag.initialEnd;

      if (drag.mode === "move") {
        start = clamp(snapTime(drag.initialStart + deltaTime), 0, Math.max(0, totalDuration - duration));
        end = roundTime(start + duration);
      } else if (drag.mode === "resize-start") {
        start = clamp(snapTime(drag.initialStart + deltaTime), 0, drag.initialEnd - minDuration);
        end = drag.initialEnd;
      } else if (drag.mode === "resize-end") {
        start = drag.initialStart;
        end = Math.max(start + minDuration, snapTime(drag.initialEnd + deltaTime));
      }

      drag.didMove = true;
      updateTimelineClip(drag.trackId, drag.clipId, { start, end }, { captureHistory: false });
    };

    const upHandler = () => {
      const drag = dragStateRef.current;
      if (drag?.didMove) {
        commitHistoryTransaction();
        const actionLabel = drag.mode === "move" ? "Timeline clip moved" : drag.mode === "resize-start" ? "Timeline clip start adjusted" : "Timeline clip end adjusted";
        addServerLog({ level: "info", msg: actionLabel });
      } else {
        cancelHistoryTransaction();
      }
      clearDragListeners();
    };

    dragStateRef.current = {
      trackId,
      clipId: clip.id,
      mode,
      startX: event.clientX,
      initialStart: Number(clip.start),
      initialEnd: Number(clip.end),
      didMove: false,
      moveHandler,
      upHandler,
    };

    document.addEventListener("pointermove", moveHandler);
    document.addEventListener("pointerup", upHandler);
  };

  const addClipAtCursor = (trackId, event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const t = Math.max(0, Math.min(totalDuration, x / timelineZoom));
    createTimelineClip(trackId, t);
    addServerLog({ level: "info", msg: "Timeline clip inserted" });
  };

  const onRulerClick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left + scrollXRef.current;
    const t = Math.max(0, Math.min(totalDuration, x / timelineZoom));
    setPlayhead(t);
    if (serverAuthoritative) {
      send({ type: "playback", action: "seek", position: t });
    }
  };

  const addTrackThenClip = () => {
    if (selectedTrack) {
      createTimelineClip(selectedTrack.id, playhead);
      addServerLog({ level: "info", msg: "Timeline clip created at playhead" });
      return;
    }
    addTimelineTrack();
    addServerLog({ level: "info", msg: "Timeline track created — add a clip next" });
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const ticks = [];
  const tickInterval = timelineZoom >= 8 ? 5 : timelineZoom >= 4 ? 10 : 20;
  for (let t = 0; t <= totalDuration; t += tickInterval) ticks.push(t);
  const microTicks = [];
  const microInterval = tickInterval / 5;
  for (let t = 0; t <= totalDuration; t += microInterval) {
    if (t % tickInterval !== 0) microTicks.push(t);
  }

  return (
    <div style={{
      height,
      background: "var(--bg-panel)",
      borderTop: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
    }}>
      <div style={{
        height: 34,
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 12px",
        flexShrink: 0,
      }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Timeline
        </span>
        <span style={{ fontSize: 9, color: serverAuthoritative ? "var(--green)" : "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {serverAuthoritative ? "SERVER AUTHORITY" : "LOCAL PREVIEW"}
        </span>
        <span style={{ fontSize: 9, color: snapToGrid ? "var(--text-accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {snapToGrid ? `SNAP ${snapStep.toFixed(2)}s` : "FREE MOVE"}
        </span>
        <span style={{ fontSize: 9, color: visibleSoloCount > 0 ? "var(--amber)" : "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {visibleSoloCount > 0 ? `${visibleSoloCount} SOLO` : "ALL TRACKS ACTIVE"}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>ZOOM</span>
        <button className="btn icon-btn" onClick={() => setTimelineZoom(timelineZoom / 1.5)} style={{ padding: "2px 6px", fontSize: 12 }}>−</button>
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-secondary)", minWidth: 36, textAlign: "center" }}>
          {timelineZoom}x
        </span>
        <button className="btn icon-btn" onClick={() => setTimelineZoom(timelineZoom * 1.5)} style={{ padding: "2px 6px", fontSize: 12 }}>+</button>
        <div style={{ width: 1, height: 16, background: "var(--border)" }} />
        <button className="btn" onClick={() => { addTimelineTrack(); addServerLog({ level: "info", msg: "Track added from timeline toolbar" }); }} style={{ padding: "2px 8px", fontSize: 10 }}>+ Track</button>
        <button className="btn" onClick={addTrackThenClip} style={{ padding: "2px 8px", fontSize: 10 }}>+ Clip</button>
        <button className="btn" disabled={!selectedClipInfo} onClick={() => selectedClipInfo && duplicateTimelineClip(selectedClipInfo.track.id, selectedClipInfo.clip.id)} style={{ padding: "2px 8px", fontSize: 10, opacity: selectedClipInfo ? 1 : 0.5 }}>Duplicate</button>
        <button className="btn danger" disabled={!selectedClipInfo} onClick={() => selectedClipInfo && removeTimelineClip(selectedClipInfo.track.id, selectedClipInfo.clip.id)} style={{ padding: "2px 8px", fontSize: 10, opacity: selectedClipInfo ? 1 : 0.5 }}>Delete</button>
        <button className="btn" onClick={() => { quantizeTimeline(); addServerLog({ level: "info", msg: "Timeline quantized from toolbar" }); }} style={{ padding: "2px 8px", fontSize: 10 }}>Quantize</button>
        <button className="btn primary" onClick={() => { autoGenerateTimeline(); addServerLog({ level: "info", msg: "AI timeline generation executed" }); }} style={{ padding: "2px 8px", fontSize: 10 }}>✨ AI Generate</button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ width: HEADER_W, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
          <div style={{ height: RULER_H, borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", padding: "0 10px", fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            TRACKS
          </div>
          <div style={{ flex: 1, overflowY: "hidden" }}>
            {timelineTracks.map((track) => (
              <TrackHeader
                key={track.id}
                track={track}
                selected={track.id === selectedTrack?.id}
                onSelect={() => selectTrack(track.id)}
                onAddClip={() => createTimelineClip(track.id, playhead)}
                onToggleMute={() => toggleTrackMute(track.id)}
                onToggleSolo={() => toggleTrackSolo(track.id)}
              />
            ))}
          </div>
        </div>

        <div ref={containerRef} style={{ flex: 1, overflow: "auto", position: "relative" }} onScroll={(event) => setScrollX(event.currentTarget.scrollLeft)}>
          <div style={{ width: canvasWidth, position: "relative" }}>
            <div style={{ height: RULER_H, background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 20, cursor: "pointer", overflow: "hidden" }} onClick={onRulerClick}>
              <svg width={canvasWidth} height={RULER_H}>
                {microTicks.map((t) => (
                  <line key={t} x1={t * timelineZoom} y1={RULER_H - 6} x2={t * timelineZoom} y2={RULER_H} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
                ))}
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={t * timelineZoom} y1={0} x2={t * timelineZoom} y2={RULER_H} stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
                    <text x={t * timelineZoom + 3} y={14} fontSize={9} fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.4)">{formatTime(t)}</text>
                  </g>
                ))}
                <line x1={playhead * timelineZoom} y1={0} x2={playhead * timelineZoom} y2={RULER_H} stroke="#00d4ff" strokeWidth="1.5" />
                <polygon points={`${playhead * timelineZoom - 5},0 ${playhead * timelineZoom + 5},0 ${playhead * timelineZoom},8`} fill="#00d4ff" />
              </svg>
            </div>

            {timelineTracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                timelineZoom={timelineZoom}
                canvasWidth={canvasWidth}
                selectedTrackId={selectedTrack?.id}
                selectedClipId={selectedClipId}
                onSelectTrack={() => selectTrack(track.id)}
                onSelectClip={(clipId) => selectClip(track.id, clipId)}
                onAddClip={(event) => addClipAtCursor(track.id, event)}
                onMoveClip={startClipDrag}
              />
            ))}

            <div style={{
              position: "absolute",
              top: RULER_H,
              bottom: 0,
              left: playhead * timelineZoom,
              width: 1,
              background: "#00d4ff",
              pointerEvents: "none",
              zIndex: 15,
              boxShadow: "0 0 6px rgba(0,212,255,0.6)",
            }} />
          </div>
        </div>
      </div>

      <div style={{
        height: 24,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 12px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-surface)",
        fontSize: 10,
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        flexShrink: 0,
      }}>
        <span>{selectedTrack ? `TRACK ${selectedTrack.label}` : "NO TRACK SELECTED"}</span>
        {selectedClipInfo ? (
          <>
            <span>CLIP {selectedClipInfo.clip.label}</span>
            <span>{selectedClipInfo.clip.start.toFixed(2)}s → {selectedClipInfo.clip.end.toFixed(2)}s</span>
            <span>INT {selectedClipInfo.clip.intensity}%</span>
          </>
        ) : (
          <span>Double-click a row to create a clip · Drag clip body to move · Drag edges to resize</span>
        )}
      </div>
    </div>
  );
}

function TrackHeader({ track, selected, onSelect, onAddClip, onToggleMute, onToggleSolo }) {
  return (
    <div onClick={onSelect} style={{
      height: TRACK_H,
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "0 10px",
      borderBottom: "1px solid var(--border)",
      background: selected ? "rgba(201,162,39,0.08)" : "var(--bg-panel)",
      cursor: "pointer",
    }}>
      <div style={{ width: 3, height: 28, borderRadius: 2, background: track.color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.label}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{track.type}</span>
          <span style={{ fontSize: 9, color: track.muted ? "var(--red)" : track.solo ? "var(--amber)" : "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {track.muted ? "MUTED" : track.solo ? "SOLO" : `${track.clips?.length || 0} CLIPS`}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 3 }} onClick={(event) => event.stopPropagation()}>
        <button className="btn icon-btn" onClick={onAddClip} style={{ padding: "2px 4px", fontSize: 9, color: "var(--text-secondary)" }} data-tip="Add Clip">+</button>
        <button className="btn icon-btn" onClick={onToggleMute} style={{ padding: "2px 4px", fontSize: 9, color: track.muted ? "var(--red)" : "var(--text-muted)" }} data-tip="Mute">M</button>
        <button className="btn icon-btn" onClick={onToggleSolo} style={{ padding: "2px 4px", fontSize: 9, color: track.solo ? "var(--amber)" : "var(--text-muted)" }} data-tip="Solo">S</button>
      </div>
    </div>
  );
}

function TrackRow({ track, timelineZoom, selectedTrackId, selectedClipId, onSelectTrack, onSelectClip, onAddClip, onMoveClip, canvasWidth }) {
  const gridStep = timelineZoom * 4;
  const backgroundColor = selectedTrackId === track.id ? "rgba(201,162,39,0.03)" : "var(--bg-base)";

  return (
    <div
      onClick={onSelectTrack}
      onDoubleClick={onAddClip}
      style={{
        height: TRACK_H,
        position: "relative",
        borderBottom: "1px solid var(--border)",
        background: backgroundColor,
        cursor: "pointer",
      }}
    >
      <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width={canvasWidth} height={TRACK_H}>
        {Array.from({ length: Math.floor(canvasWidth / gridStep) }).map((_, i) => (
          <line key={i} x1={i * gridStep} y1={0} x2={i * gridStep} y2={TRACK_H} stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
        ))}
      </svg>
      {(track.clips || []).map((clip) => (
        <Clip
          key={clip.id}
          clip={clip}
          color={track.color}
          timelineZoom={timelineZoom}
          selected={selectedClipId === clip.id}
          muted={track.muted}
          solo={track.solo}
          onSelect={() => onSelectClip(clip.id)}
          onDragStart={(event, mode) => onMoveClip(event, track.id, clip, mode)}
        />
      ))}
    </div>
  );
}

function Clip({ clip, color, timelineZoom, selected, muted, solo, onSelect, onDragStart }) {
  const left = clip.start * timelineZoom;
  const width = Math.max(8, (clip.end - clip.start) * timelineZoom);
  const intHeight = Math.round((clip.intensity / 100) * (TRACK_H - 10));
  const borderColor = muted ? "rgba(239,68,68,0.55)" : selected ? color : `${color}55`;
  const labelColor = muted ? "var(--red)" : color;

  return (
    <div
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onPointerDown={(event) => onDragStart(event, "move")}
      style={{
        position: "absolute",
        left,
        top: 5,
        width,
        height: TRACK_H - 10,
        borderRadius: 4,
        cursor: "grab",
        background: muted ? "rgba(239,68,68,0.08)" : `${color}22`,
        border: `1px solid ${borderColor}`,
        overflow: "hidden",
        transition: "border-color 0.1s, box-shadow 0.1s",
        boxShadow: selected ? `0 0 8px ${color}44` : solo ? `0 0 4px ${color}33` : "none",
      }}
    >
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: intHeight, background: muted ? "rgba(239,68,68,0.16)" : `${color}33`, borderTop: `1px solid ${color}44` }} />
      {width > 40 && (
        <span style={{ position: "absolute", left: 8, right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 9, fontWeight: 500, fontFamily: "var(--font-mono)", color: labelColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>
          {clip.label}
        </span>
      )}
      <div onPointerDown={(event) => onDragStart(event, "resize-start")} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize", background: selected ? `${color}44` : "transparent" }} />
      <div onPointerDown={(event) => onDragStart(event, "resize-end")} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize", background: selected ? `${color}44` : "transparent" }} />
    </div>
  );
}
