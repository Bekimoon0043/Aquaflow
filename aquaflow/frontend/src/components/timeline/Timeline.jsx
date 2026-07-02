import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useShowStore } from "../../store/showStore";
import { useWS } from "../../hooks/WebSocketContext";
import AudioWaveformTrack from "./AudioWaveformTrack";

const TRACK_H = 50;
const HEADER_W = 200;
const RULER_H = 28;
const MARQUEE_DRAG_THRESHOLD = 4;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const roundTime = (value) => Number(Number(value || 0).toFixed(3));
const getBeatStep = (show, subdivision = 0.25) => {
  const bpm = Math.max(1, Number(show?.bpm || 120));
  return Math.max(0.05, (60 / bpm) * subdivision);
};

function findSelectedClipInfo(tracks, selectedIds) {
  if (!selectedIds?.length) return null;
  const targetId = selectedIds[selectedIds.length - 1];
  for (const track of tracks) {
    const clip = (track.clips || []).find((entry) => entry.id === targetId);
    if (clip) return { track, clip };
  }
  return null;
}

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
    selectedClipIds,
    selectedTrackId,
    setPlayhead,
     audioData,
     setAudioData,
    setTimelineZoom,
    addTimelineTrack,
    createTimelineClip,
    updateTimelineClip,
    removeTimelineClip,
    removeSelectedTimelineClips,
    duplicateTimelineClip,
    duplicateSelectedTimelineClips,
    quantizeTimeline,
    autoGenerateTimeline,
    healTimelineOverlaps,
    toggleTrackMute,
    toggleTrackSolo,
    moveTimelineTrack,
    selectTrack,
    selectClip,
    toggleClipSelection,
    setSelectedClips,
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
  const marqueeStateRef = useRef(null);
  const scrollRef = useRef({ left: 0, top: 0 });
  const animRef = useRef(null);
  const startTimeRef = useRef(null);
  const [scrollX, setScrollX] = useState(0);
  const [marqueeRect, setMarqueeRect] = useState(null);

  const totalDuration = Math.max(30, Number(currentShow?.duration || 180));
  const canvasWidth = Math.max(1200, totalDuration * timelineZoom);
  const serverAuthoritative = connectionState === "connected";
  const snapStep = useMemo(() => getBeatStep(currentShow, 0.25), [currentShow]);
  const minDuration = Math.max(0.1, snapStep);

  const selectedClipSet = useMemo(() => new Set(selectedClipIds || []), [selectedClipIds]);
  const selectedClipCount = selectedClipIds?.length || 0;
  const selectedTrack = useMemo(
    () => timelineTracks.find((track) => track.id === selectedTrackId) || null,
    [timelineTracks, selectedTrackId]
  );
  const selectedClipInfo = useMemo(
    () => findSelectedClipInfo(timelineTracks, selectedClipIds?.length ? selectedClipIds : (selectedClipId ? [selectedClipId] : [])),
    [timelineTracks, selectedClipId, selectedClipIds]
  );
  const selectedTrackCount = useMemo(() => {
    const ids = new Set();
    timelineTracks.forEach((track) => {
      if ((track.clips || []).some((clip) => selectedClipSet.has(clip.id))) ids.add(track.id);
    });
    return ids.size;
  }, [timelineTracks, selectedClipSet]);
  const visibleSoloCount = useMemo(
    () => timelineTracks.filter((track) => track.solo).length,
    [timelineTracks]
  );

  useEffect(() => {
    scrollRef.current.left = scrollX;
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
          if (ph - scrollRef.current.left > visW * 0.75) {
            const nextScroll = Math.max(0, ph - visW * 0.25);
            containerRef.current.scrollLeft = nextScroll;
            scrollRef.current.left = nextScroll;
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
      if (ph - scrollRef.current.left > visW * 0.75) {
        const nextScroll = Math.max(0, ph - visW * 0.25);
        containerRef.current.scrollLeft = nextScroll;
        scrollRef.current.left = nextScroll;
        setScrollX(nextScroll);
      }
    }
  }, [playhead, timelineZoom]);

  const snapTime = useCallback((value) => {
    if (!snapToGrid) return roundTime(Math.max(0, value));
    return roundTime(Math.round(Math.max(0, value) / snapStep) * snapStep);
  }, [snapStep, snapToGrid]);

  const pointFromEvent = useCallback((event) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: event.clientX - rect.left + scrollRef.current.left,
      y: event.clientY - rect.top + scrollRef.current.top,
    };
  }, []);

  const buildSelectionRect = useCallback((x1, y1, x2, y2) => ({
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }), []);

  const findMarqueeClipIds = useCallback((selectionRect) => {
    const selectedIds = [];
    timelineTracks.forEach((track, trackIndex) => {
      const rowTop = RULER_H + trackIndex * TRACK_H + 5;
      const rowBottom = rowTop + TRACK_H - 10;
      (track.clips || []).forEach((clip) => {
        const left = clip.start * timelineZoom;
        const right = left + Math.max(8, (clip.end - clip.start) * timelineZoom);
        const intersects = !(right < selectionRect.left || left > selectionRect.right || rowBottom < selectionRect.top || rowTop > selectionRect.bottom);
        if (intersects) selectedIds.push(clip.id);
      });
    });
    return selectedIds;
  }, [timelineTracks, timelineZoom]);

  const clearDragListeners = useCallback(() => {
    const drag = dragStateRef.current;
    if (!drag) return;
    if (drag.moveHandler) document.removeEventListener("pointermove", drag.moveHandler);
    if (drag.upHandler) document.removeEventListener("pointerup", drag.upHandler);
    dragStateRef.current = null;
  }, []);

  const clearMarqueeListeners = useCallback(() => {
    const marquee = marqueeStateRef.current;
    if (!marquee) return;
    if (marquee.moveHandler) document.removeEventListener("pointermove", marquee.moveHandler);
    if (marquee.upHandler) document.removeEventListener("pointerup", marquee.upHandler);
    marqueeStateRef.current = null;
    setMarqueeRect(null);
  }, []);

  useEffect(() => () => {
    clearDragListeners();
    clearMarqueeListeners();
  }, [clearDragListeners, clearMarqueeListeners]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;

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

      if (!selectedClipCount) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (selectedClipCount > 1) {
          removeSelectedTimelineClips();
          addServerLog({ level: "warn", msg: `${selectedClipCount} selected timeline clips deleted` });
        } else if (selectedClipInfo) {
          removeTimelineClip(selectedClipInfo.track.id, selectedClipInfo.clip.id);
          addServerLog({ level: "warn", msg: "Selected timeline clip deleted" });
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        if (selectedClipCount > 1) {
          duplicateSelectedTimelineClips();
          addServerLog({ level: "info", msg: `${selectedClipCount} selected timeline clips duplicated` });
        } else if (selectedClipInfo) {
          duplicateTimelineClip(selectedClipInfo.track.id, selectedClipInfo.clip.id);
          addServerLog({ level: "info", msg: "Selected timeline clip duplicated" });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    addServerLog,
    duplicateSelectedTimelineClips,
    duplicateTimelineClip,
    redo,
    removeSelectedTimelineClips,
    removeTimelineClip,
    selectedClipCount,
    selectedClipInfo,
    undo,
  ]);

  const startClipDrag = (event, trackId, clip, mode) => {
    event.stopPropagation();
    if (!selectedClipSet.has(clip.id)) selectClip(trackId, clip.id);
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
        const actionLabel = drag.mode === "move"
          ? "Timeline clip moved"
          : drag.mode === "resize-start"
            ? "Timeline clip start adjusted"
            : "Timeline clip end adjusted";
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

  const startMarqueeSelection = (event, fallbackTrackId) => {
    if (!event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const origin = pointFromEvent(event);
    const additive = event.ctrlKey || event.metaKey;
    const originalIds = additive ? [...selectedClipIds] : [];

    const moveHandler = (moveEvent) => {
      const marquee = marqueeStateRef.current;
      if (!marquee) return;
      const point = pointFromEvent(moveEvent);
      const rect = buildSelectionRect(marquee.originX, marquee.originY, point.x, point.y);
      marquee.didMove = marquee.didMove || rect.width > MARQUEE_DRAG_THRESHOLD || rect.height > MARQUEE_DRAG_THRESHOLD;
      if (!marquee.didMove) return;
      setMarqueeRect(rect);
      const hitIds = findMarqueeClipIds(rect);
      const nextIds = marquee.additive ? [...new Set([...marquee.originalIds, ...hitIds])] : hitIds;
      const preferredTrackId = nextIds.length === 1 ? fallbackTrackId : null;
      setSelectedClips(preferredTrackId, nextIds);
    };

    const upHandler = () => {
      clearMarqueeListeners();
    };

    marqueeStateRef.current = {
      originX: origin.x,
      originY: origin.y,
      additive,
      originalIds,
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
    const x = event.clientX - rect.left + scrollRef.current.left;
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

  const handleClipSelection = (event, trackId, clipId) => {
    if (event.ctrlKey || event.metaKey) {
      toggleClipSelection(trackId, clipId);
      return;
    }
    selectClip(trackId, clipId);
  };

  const handleDuplicate = () => {
    if (!selectedClipCount) return;
    if (selectedClipCount > 1) {
      duplicateSelectedTimelineClips();
      addServerLog({ level: "info", msg: `${selectedClipCount} selected timeline clips duplicated` });
      return;
    }
    if (selectedClipInfo) {
      duplicateTimelineClip(selectedClipInfo.track.id, selectedClipInfo.clip.id);
      addServerLog({ level: "info", msg: "Selected timeline clip duplicated" });
    }
  };

  const handleDelete = () => {
    if (!selectedClipCount) return;
    if (selectedClipCount > 1) {
      removeSelectedTimelineClips();
      addServerLog({ level: "warn", msg: `${selectedClipCount} selected timeline clips deleted` });
      return;
    }
    if (selectedClipInfo) {
      removeTimelineClip(selectedClipInfo.track.id, selectedClipInfo.clip.id);
      addServerLog({ level: "warn", msg: "Selected timeline clip deleted" });
    }
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
        <span style={{ fontSize: 9, color: selectedClipCount > 0 ? "var(--text-accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {selectedClipCount > 0 ? `${selectedClipCount} SELECTED` : "NO CLIP SELECTION"}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn" disabled={!canUndo} onClick={() => { undo(); addServerLog({ level: "info", msg: "Undo executed from timeline toolbar" }); }} style={{ padding: "2px 8px", fontSize: 10, opacity: canUndo ? 1 : 0.5 }}>↶ Undo</button>
        <button className="btn" disabled={!canRedo} onClick={() => { redo(); addServerLog({ level: "info", msg: "Redo executed from timeline toolbar" }); }} style={{ padding: "2px 8px", fontSize: 10, opacity: canRedo ? 1 : 0.5 }}>↷ Redo</button>
        <button className="btn" onClick={() => { healTimelineOverlaps(); addServerLog({ level: "info", msg: "Timeline overlap healing executed" }); }} style={{ padding: "2px 8px", fontSize: 10 }}>Heal</button>
        <div style={{ width: 1, height: 16, background: "var(--border)" }} />
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>ZOOM</span>
        <button className="btn icon-btn" onClick={() => setTimelineZoom(timelineZoom / 1.5)} style={{ padding: "2px 6px", fontSize: 12 }}>−</button>
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-secondary)", minWidth: 36, textAlign: "center" }}>
          {timelineZoom}x
        </span>
        <button className="btn icon-btn" onClick={() => setTimelineZoom(timelineZoom * 1.5)} style={{ padding: "2px 6px", fontSize: 12 }}>+</button>
        <div style={{ width: 1, height: 16, background: "var(--border)" }} />
        <button className="btn" onClick={() => { addTimelineTrack(); addServerLog({ level: "info", msg: "Track added from timeline toolbar" }); }} style={{ padding: "2px 8px", fontSize: 10 }}>+ Track</button>
        <button className="btn" onClick={addTrackThenClip} style={{ padding: "2px 8px", fontSize: 10 }}>+ Clip</button>
        <button className="btn" disabled={!selectedClipCount} onClick={handleDuplicate} style={{ padding: "2px 8px", fontSize: 10, opacity: selectedClipCount ? 1 : 0.5 }}>{selectedClipCount > 1 ? "Duplicate Sel" : "Duplicate"}</button>
        <button className="btn danger" disabled={!selectedClipCount} onClick={handleDelete} style={{ padding: "2px 8px", fontSize: 10, opacity: selectedClipCount ? 1 : 0.5 }}>{selectedClipCount > 1 ? "Delete Sel" : "Delete"}</button>
        <button className="btn" onClick={() => { quantizeTimeline(); addServerLog({ level: "info", msg: "Timeline quantized from toolbar" }); }} style={{ padding: "2px 8px", fontSize: 10 }}>Quantize</button>
        <button className="btn primary" onClick={() => { autoGenerateTimeline(); addServerLog({ level: "info", msg: "AI timeline generation executed" }); }} style={{ padding: "2px 8px", fontSize: 10 }}>✨ AI Generate</button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ width: HEADER_W, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
          <div style={{ height: RULER_H, borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", padding: "0 10px", fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            TRACKS
          </div>
          <div style={{ flex: 1, overflowY: "hidden" }}>
<AudioWaveformTrack
  audioData={audioData}
  timelineZoom={timelineZoom}
  playhead={playhead}
  scrollLeft={scrollX}
  trackLabelWidth={HEADER_W}
  onRemove={() => setAudioData(null)}
/>            
{timelineTracks.map((track, trackIndex) => (
              <TrackHeader
                key={track.id}
                track={track}
                index={trackIndex}
                selected={track.id === selectedTrack?.id}
                canMoveUp={trackIndex > 0}
                canMoveDown={trackIndex < timelineTracks.length - 1}
                onSelect={() => selectTrack(track.id)}
                onAddClip={() => createTimelineClip(track.id, playhead)}
                onToggleMute={() => toggleTrackMute(track.id)}
                onToggleSolo={() => toggleTrackSolo(track.id)}
                onMoveUp={() => moveTimelineTrack(track.id, -1)}
                onMoveDown={() => moveTimelineTrack(track.id, 1)}
              />
            ))}
          </div>
        </div>

        <div
          ref={containerRef}
          style={{ flex: 1, overflow: "auto", position: "relative" }}
          onScroll={(event) => {
            const left = event.currentTarget.scrollLeft;
            const top = event.currentTarget.scrollTop;
            scrollRef.current = { left, top };
            setScrollX(left);
          }}
        >
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

            {timelineTracks.map((track, trackIndex) => (
              <TrackRow
                key={track.id}
                track={track}
                trackIndex={trackIndex}
                timelineZoom={timelineZoom}
                canvasWidth={canvasWidth}
                selectedTrackId={selectedTrack?.id}
                selectedClipSet={selectedClipSet}
                onSelectTrack={() => selectTrack(track.id)}
                onSelectClip={(event, clipId) => handleClipSelection(event, track.id, clipId)}
                onAddClip={(event) => addClipAtCursor(track.id, event)}
                onMoveClip={startClipDrag}
                onStartMarquee={startMarqueeSelection}
              />
            ))}

            {marqueeRect && (
              <div style={{
                position: "absolute",
                left: marqueeRect.left,
                top: marqueeRect.top,
                width: marqueeRect.width,
                height: marqueeRect.height,
                border: "1px dashed rgba(201,162,39,0.8)",
                background: "rgba(201,162,39,0.10)",
                pointerEvents: "none",
                zIndex: 18,
              }} />
            )}

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
        {selectedClipCount > 1 ? (
          <>
            <span>{selectedClipCount} CLIPS SELECTED</span>
            <span>{selectedTrackCount} TRACKS AFFECTED</span>
            <span>Bulk duplicate/delete enabled</span>
          </>
        ) : selectedClipInfo ? (
          <>
            <span>CLIP {selectedClipInfo.clip.label}</span>
            <span>{selectedClipInfo.clip.start.toFixed(2)}s → {selectedClipInfo.clip.end.toFixed(2)}s</span>
            <span>INT {selectedClipInfo.clip.intensity}%</span>
          </>
        ) : (
          <span>Double-click a row to create a clip · Ctrl/Cmd-click clips to multi-select · Shift-drag empty timeline to marquee select · Use arrows on tracks to reorder</span>
        )}
      </div>
    </div>
  );
}

function TrackHeader({ track, index, selected, canMoveUp, canMoveDown, onSelect, onAddClip, onToggleMute, onToggleSolo, onMoveUp, onMoveDown }) {
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
        <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{index + 1}. {track.label}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{track.type}</span>
          <span style={{ fontSize: 9, color: track.muted ? "var(--red)" : track.solo ? "var(--amber)" : "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {track.muted ? "MUTED" : track.solo ? "SOLO" : `${track.clips?.length || 0} CLIPS`}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 3 }} onClick={(event) => event.stopPropagation()}>
        <button className="btn icon-btn" onClick={onMoveUp} disabled={!canMoveUp} style={{ padding: "2px 4px", fontSize: 9, color: canMoveUp ? "var(--text-secondary)" : "var(--text-muted)", opacity: canMoveUp ? 1 : 0.35 }} data-tip="Move Up">↑</button>
        <button className="btn icon-btn" onClick={onMoveDown} disabled={!canMoveDown} style={{ padding: "2px 4px", fontSize: 9, color: canMoveDown ? "var(--text-secondary)" : "var(--text-muted)", opacity: canMoveDown ? 1 : 0.35 }} data-tip="Move Down">↓</button>
        <button className="btn icon-btn" onClick={onAddClip} style={{ padding: "2px 4px", fontSize: 9, color: "var(--text-secondary)" }} data-tip="Add Clip">+</button>
        <button className="btn icon-btn" onClick={onToggleMute} style={{ padding: "2px 4px", fontSize: 9, color: track.muted ? "var(--red)" : "var(--text-muted)" }} data-tip="Mute">M</button>
        <button className="btn icon-btn" onClick={onToggleSolo} style={{ padding: "2px 4px", fontSize: 9, color: track.solo ? "var(--amber)" : "var(--text-muted)" }} data-tip="Solo">S</button>
      </div>
    </div>
  );
}

function TrackRow({ track, trackIndex, timelineZoom, selectedTrackId, selectedClipSet, onSelectTrack, onSelectClip, onAddClip, onMoveClip, onStartMarquee, canvasWidth }) {
  const gridStep = timelineZoom * 4;
  const backgroundColor = selectedTrackId === track.id ? "rgba(201,162,39,0.03)" : "var(--bg-base)";

  return (
    <div
      onClick={onSelectTrack}
      onDoubleClick={onAddClip}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && event.shiftKey) onStartMarquee(event, track.id);
      }}
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
          selected={selectedClipSet.has(clip.id)}
          muted={track.muted}
          solo={track.solo}
          onSelect={(event) => onSelectClip(event, clip.id)}
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
      onClick={(event) => { event.stopPropagation(); onSelect(event); }}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
        onDragStart(event, "move");
      }}
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
        boxShadow: selected ? `0 0 8px ${color}66` : solo ? `0 0 4px ${color}33` : "none",
      }}
    >
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: intHeight, background: muted ? "rgba(239,68,68,0.16)" : `${color}33`, borderTop: `1px solid ${color}44` }} />
      {width > 40 && (
        <span style={{ position: "absolute", left: 8, right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 9, fontWeight: 500, fontFamily: "var(--font-mono)", color: labelColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>
          {clip.label}
        </span>
      )}
      <div onPointerDown={(event) => { if (event.button !== 0) return; onDragStart(event, "resize-start"); }} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize", background: selected ? `${color}44` : "transparent" }} />
      <div onPointerDown={(event) => { if (event.button !== 0) return; onDragStart(event, "resize-end"); }} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize", background: selected ? `${color}44` : "transparent" }} />
    </div>
  );
}
