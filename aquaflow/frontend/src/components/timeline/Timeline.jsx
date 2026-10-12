import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import useProjectStore from "../../store/projectStore";
import { useShowStore } from "../../store/showStore";
import { useICANPreviewStore } from "../../store/icanPreviewStore";
import { useWS } from "../../hooks/WebSocketContext";
import AudioWaveformTrack from "./AudioWaveformTrack";
import { buildSimulationTracks } from "./simulationTimeline";

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
    setPlayback,
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
  const sitePreview = useICANPreviewStore();
  const containerRef = useRef(null);
  const dragStateRef = useRef(null);
  const marqueeStateRef = useRef(null);
  const scrollRef = useRef({ left: 0, top: 0 });
  const animRef = useRef(null);
  const startTimeRef = useRef(null);
  const [scrollX, setScrollX] = useState(0);
  const [marqueeRect, setMarqueeRect] = useState(null);

  const totalDuration = Math.max(30, Number(currentShow?.duration || 180));
  const simulationActive = Boolean(sitePreview.active && sitePreview.plan);
  const activeDuration = simulationActive
    ? Math.max(0.1, Number(sitePreview.plan.duration) || 0.1)
    : totalDuration;
  const activePlayhead = simulationActive ? sitePreview.position : playhead;
  const activePlayback = simulationActive ? sitePreview.playback : playbackState;
  const displayZoom = simulationActive ? clamp(1100 / activeDuration, 6, 160) : timelineZoom;
  const canvasWidth = Math.max(1200, activeDuration * displayZoom);
  const simulationTracks = useMemo(() => buildSimulationTracks(sitePreview.plan), [sitePreview.plan]);
  const displayedTracks = simulationActive ? simulationTracks : timelineTracks;
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
      const ph = activePlayhead * displayZoom;
      const visW = containerRef.current.clientWidth - HEADER_W;
      if (ph - scrollRef.current.left > visW * 0.75) {
        const nextScroll = Math.max(0, ph - visW * 0.25);
        containerRef.current.scrollLeft = nextScroll;
        scrollRef.current.left = nextScroll;
        setScrollX(nextScroll);
      }
    }
  }, [activePlayhead, displayZoom]);

  const playOrPause = () => {
    if (simulationActive) {
      if (sitePreview.playback === "playing") sitePreview.pause();
      else sitePreview.play();
      return;
    }
    const next = playbackState === "playing" ? "paused" : "playing";
    setPlayback(next);
    if (serverAuthoritative) send({ type: "playback", action: next === "playing" ? "play" : "pause" });
  };

  const stopPlayback = () => {
    if (simulationActive) { sitePreview.stop(); return; }
    setPlayback("stopped");
    setPlayhead(0);
    if (serverAuthoritative) send({ type: "playback", action: "stop" });
  };

  const seekActive = (value) => {
    const next = clamp(Number(value) || 0, 0, activeDuration);
    if (simulationActive) { sitePreview.seek(next); return; }
    setPlayhead(next);
    if (serverAuthoritative) send({ type: "playback", action: "seek", position: next });
  };

  const seekAndPlay = useCallback((value) => {
    const next = clamp(Number(value) || 0, 0, activeDuration);
    if (simulationActive) {
      sitePreview.seek(next);
      sitePreview.play();
      return;
    }
    setPlayhead(next);
    setPlayback("playing");
    if (serverAuthoritative) {
      send({ type: "playback", action: "seek", position: next });
      send({ type: "playback", action: "play" });
    }
  }, [activeDuration, send, serverAuthoritative, setPlayback, setPlayhead, simulationActive, sitePreview]);

  const timeFromClientX = useCallback((clientX) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = clientX - rect.left + scrollRef.current.left;
    return clamp(x / displayZoom, 0, activeDuration);
  }, [activeDuration, displayZoom]);

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
      if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (event.defaultPrevented) return;

      if (event.code === "Space") {
        event.preventDefault();
        if (event.shiftKey) stopPlayback();
        else playOrPause();
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
    removeSelectedTimelineClips,
    removeTimelineClip,
    selectedClipCount,
    selectedClipInfo,
    playOrPause,
    stopPlayback,
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
    seekAndPlay(timeFromClientX(event.clientX));
  };

  const onEmptyTrackClick = (event, trackId) => {
    selectTrack(trackId);
    seekAndPlay(timeFromClientX(event.clientX));
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

  useEffect(() => {
    const onEditCommand = (event) => {
      // This timeline is hidden under Show Programming and the Engineering Designer.
      if (["show_programmer", "geometry"].includes(useProjectStore.getState().workspace?.activePanel)) return;
      if (event.detail?.command === "delete") { handleDelete(); event.detail.handled = true; }
      if (event.detail?.command === "deselect") { setSelectedClips(null, []); event.detail.handled = true; }
    };
    window.addEventListener("aquaflow:edit-command", onEditCommand);
    return () => window.removeEventListener("aquaflow:edit-command", onEditCommand);
  }, [selectedClipCount, selectedClipInfo, setSelectedClips]);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const ticks = [];
  const tickInterval = displayZoom >= 80 ? 1 : displayZoom >= 24 ? 5 : displayZoom >= 8 ? 10 : 20;
  for (let t = 0; t <= activeDuration; t += tickInterval) ticks.push(t);
  const microTicks = [];
  const microInterval = tickInterval / 5;
  for (let t = 0; t <= activeDuration; t += microInterval) {
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
          {simulationActive ? "Simulation Timeline" : "Timeline"}
        </span>
        <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"2px 7px", borderRadius:10, background: simulationActive ? "rgba(16,185,129,0.12)" : "rgba(201,162,39,0.08)", color: simulationActive ? "var(--green)" : "var(--text-accent)", fontSize:9, fontFamily:"var(--font-mono)" }}>
          <span style={{ width:5, height:5, borderRadius:"50%", background:"currentColor", boxShadow:"0 0 6px currentColor" }} />
          {simulationActive ? "DESIGN SIM · NO OUTPUT" : "SHOW PROGRAM"}
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
          {simulationActive ? `${displayedTracks.length} VISUAL LANES` : selectedClipCount > 0 ? `${selectedClipCount} SELECTED` : "NO CLIP SELECTION"}
        </span>
        <div style={{ flex: 1 }} />
        {simulationActive && <><div style={{ display:"flex", alignItems:"center", gap:2, padding:"2px 4px", border:"1px solid var(--border-mid)", borderRadius:5, background:"var(--bg-void)" }}>
          <button className="btn icon-btn" title="Go to start" onClick={() => seekActive(0)} style={{ padding:"2px 6px", fontSize:10 }}>⏮</button>
          <button className="btn icon-btn" title="Back 5 seconds" onClick={() => seekActive(activePlayhead - 5)} style={{ padding:"2px 6px", fontSize:10 }}>−5</button>
          <button className="btn icon-btn primary" title={`${activePlayback === "playing" ? "Pause" : "Play"} · Space`} onClick={playOrPause} style={{ padding:"2px 8px", fontSize:11 }}>{activePlayback === "playing" ? "Ⅱ" : "▶"}</button>
          <button className="btn icon-btn" title="Stop · Shift+Space" onClick={stopPlayback} style={{ padding:"2px 6px", fontSize:10 }}>■</button>
          <button className="btn icon-btn" title="Forward 5 seconds" onClick={() => seekActive(activePlayhead + 5)} style={{ padding:"2px 6px", fontSize:10 }}>+5</button>
        </div>
        <span style={{ minWidth:94, textAlign:"center", color: activePlayback === "playing" ? "var(--green)" : "var(--text-secondary)", fontFamily:"var(--font-mono)", fontSize:10 }}>
          {formatTime(activePlayhead)} / {formatTime(activeDuration)}
        </span></>}
        {!simulationActive && <>
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
        <button className="btn primary" onClick={() => {
          window.dispatchEvent(new CustomEvent("aquaflow:open-panel", { detail: { panel: "show_programmer" } }));
          window.setTimeout(() => window.dispatchEvent(new CustomEvent("aquaflow:open-show-ai")), 0);
          addServerLog({ level: "info", msg: "Opened the fixture-aware AI / Music Show Builder" });
        }} style={{ padding: "2px 8px", fontSize: 10 }}>✨ AI Show Builder</button>
        </>}
        {simulationActive && <button className="btn" onClick={sitePreview.close} style={{ padding:"2px 8px", fontSize:10 }}>Exit simulation</button>}
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ width: HEADER_W, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
          <div style={{ height: RULER_H, borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", padding: "0 10px", fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            TRACKS
          </div>
          <div style={{ flex: 1, overflowY: "hidden" }}>
{!simulationActive && <AudioWaveformTrack
  audioData={audioData}
  timelineZoom={timelineZoom}
  playhead={playhead}
  scrollLeft={scrollX}
  trackLabelWidth={HEADER_W}
  onRemove={() => setAudioData(null)}
/>}
{displayedTracks.map((track, trackIndex) => (
              <TrackHeader
                key={track.id}
                track={track}
                index={trackIndex}
                selected={!simulationActive && track.id === selectedTrack?.id}
                readOnly={simulationActive}
                canMoveUp={trackIndex > 0}
                canMoveDown={trackIndex < displayedTracks.length - 1}
                onSelect={() => { if (!simulationActive) selectTrack(track.id); }}
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
            <div title="Click to seek and play" style={{ height: RULER_H, background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 20, cursor: "pointer", overflow: "hidden" }} onClick={onRulerClick}>
              <svg width={canvasWidth} height={RULER_H}>
                {microTicks.map((t) => (
                  <line key={t} x1={t * displayZoom} y1={RULER_H - 6} x2={t * displayZoom} y2={RULER_H} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
                ))}
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={t * displayZoom} y1={0} x2={t * displayZoom} y2={RULER_H} stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
                    <text x={t * displayZoom + 3} y={14} fontSize={9} fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.4)">{formatTime(t)}</text>
                  </g>
                ))}
                <line x1={activePlayhead * displayZoom} y1={0} x2={activePlayhead * displayZoom} y2={RULER_H} stroke={simulationActive ? "#34d399" : "#c9a227"} strokeWidth="1.5" />
                <polygon points={`${activePlayhead * displayZoom - 5},0 ${activePlayhead * displayZoom + 5},0 ${activePlayhead * displayZoom},8`} fill={simulationActive ? "#34d399" : "#c9a227"} />
              </svg>
            </div>

            {displayedTracks.map((track, trackIndex) => (
              <TrackRow
                key={track.id}
                track={track}
                trackIndex={trackIndex}
                timelineZoom={displayZoom}
                canvasWidth={canvasWidth}
                selectedTrackId={simulationActive ? null : selectedTrack?.id}
                selectedClipSet={simulationActive ? new Set() : selectedClipSet}
                readOnly={simulationActive}
                onSelectTrack={(event) => onEmptyTrackClick(event, track.id)}
                onSelectClip={(event, clipId) => { if (!simulationActive) handleClipSelection(event, track.id, clipId); }}
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
              left: activePlayhead * displayZoom,
              width: 1,
              background: simulationActive ? "#34d399" : "#c9a227",
              pointerEvents: "none",
              zIndex: 15,
              boxShadow: simulationActive ? "0 0 6px rgba(52,211,153,0.65)" : "0 0 6px rgba(201,162,39,0.65)",
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
        {simulationActive ? <>
          <span style={{ color:"var(--green)" }}>{sitePreview.plan.name}</span>
          <span>{displayedTracks.length} VISUAL LANES</span>
          <span>{activePlayback.toUpperCase()}</span>
          <span>Click the ruler or an empty lane to seek & play · Space play/pause · Shift+Space stop · preview never sends hardware output</span>
        </> : <>
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
          <span>Click ruler/empty lane to seek & play · Space play/pause · Del delete · Ctrl+D duplicate · Shift-drag marquee</span>
        )}</>}
      </div>
    </div>
  );
}

function TrackHeader({ track, index, selected, readOnly = false, canMoveUp, canMoveDown, onSelect, onAddClip, onToggleMute, onToggleSolo, onMoveUp, onMoveDown }) {
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
      {!readOnly && <div style={{ display: "flex", gap: 3 }} onClick={(event) => event.stopPropagation()}>
        <button className="btn icon-btn" onClick={onMoveUp} disabled={!canMoveUp} style={{ padding: "2px 4px", fontSize: 9, color: canMoveUp ? "var(--text-secondary)" : "var(--text-muted)", opacity: canMoveUp ? 1 : 0.35 }} data-tip="Move Up">↑</button>
        <button className="btn icon-btn" onClick={onMoveDown} disabled={!canMoveDown} style={{ padding: "2px 4px", fontSize: 9, color: canMoveDown ? "var(--text-secondary)" : "var(--text-muted)", opacity: canMoveDown ? 1 : 0.35 }} data-tip="Move Down">↓</button>
        <button className="btn icon-btn" onClick={onAddClip} style={{ padding: "2px 4px", fontSize: 9, color: "var(--text-secondary)" }} data-tip="Add Clip">+</button>
        <button className="btn icon-btn" onClick={onToggleMute} style={{ padding: "2px 4px", fontSize: 9, color: track.muted ? "var(--red)" : "var(--text-muted)" }} data-tip="Mute">M</button>
        <button className="btn icon-btn" onClick={onToggleSolo} style={{ padding: "2px 4px", fontSize: 9, color: track.solo ? "var(--amber)" : "var(--text-muted)" }} data-tip="Solo">S</button>
      </div>}
    </div>
  );
}

function TrackRow({ track, trackIndex, timelineZoom, selectedTrackId, selectedClipSet, readOnly = false, onSelectTrack, onSelectClip, onAddClip, onMoveClip, onStartMarquee, canvasWidth }) {
  const gridStep = timelineZoom * 4;
  const backgroundColor = selectedTrackId === track.id ? "rgba(201,162,39,0.03)" : "var(--bg-base)";

  return (
    <div
      onClick={(event) => onSelectTrack(event)}
      onDoubleClick={readOnly ? undefined : onAddClip}
      onPointerDown={(event) => {
        if (!readOnly && event.target === event.currentTarget && event.shiftKey) onStartMarquee(event, track.id);
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
          readOnly={readOnly}
          onSelect={(event) => onSelectClip(event, clip.id)}
          onDragStart={(event, mode) => { if (!readOnly) onMoveClip(event, track.id, clip, mode); }}
        />
      ))}
    </div>
  );
}

function Clip({ clip, color, timelineZoom, selected, muted, solo, readOnly = false, onSelect, onDragStart }) {
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
        cursor: readOnly ? "default" : "grab",
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
      {!readOnly && <><div onPointerDown={(event) => { if (event.button !== 0) return; onDragStart(event, "resize-start"); }} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize", background: selected ? `${color}44` : "transparent" }} />
      <div onPointerDown={(event) => { if (event.button !== 0) return; onDragStart(event, "resize-end"); }} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize", background: selected ? `${color}44` : "transparent" }} /></>}
    </div>
  );
}
