// src/components/showProgrammer/BeatMarkerLane.jsx
import React, { useRef, useEffect, useCallback, useState } from 'react';

/**
 * BeatMarkerLane — Standalone beat marker and measure lane
 * Props:
 *   - duration: number (seconds)
 *   - zoom: number (px/sec)
 *   - bpm: number (default 120)
 *   - timeSignature: [number, number] (default [4, 4])
 *   - beatMarkers: Array<{ time, bpm, label? }>
 *   - onBeatAdd: (time, bpm) => void
 *   - onBeatRemove: (index) => void
 *   - onBeatMove: (index, newTime) => void
 *   - currentTime: number
 *   - onSeek: (time) => void
 *   - selectedRegion: { start, end } | null
 *   - height: number (default 40)
 */
export default function BeatMarkerLane({
  duration = 0,
  zoom = 50,
  bpm = 120,
  timeSignature = [4, 4],
  beatMarkers = [],
  onBeatAdd,
  onBeatRemove,
  onBeatMove,
  currentTime = 0,
  onSeek,
  selectedRegion = null,
  height = 40,
}) {
  const canvasRef = useRef(null);
  const [draggingBeat, setDraggingBeat] = useState(null);
  const [dragStartX, setDragStartX] = useState(null);

  const beatsPerSecond = bpm / 60;
  const secondsPerBeat = 1 / beatsPerSecond;
  const beatsPerMeasure = timeSignature[0];
  const measureWidth = secondsPerBeat * beatsPerMeasure * zoom;

  const totalWidth = Math.max(duration * zoom, 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = totalWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, totalWidth, height);

    // Draw measure bars
    ctx.strokeStyle = '#3a3a5e';
    ctx.lineWidth = 1;
    const measureLabelStride = Math.max(1, Math.ceil(36 / measureWidth));
    for (let m = 0; m * measureWidth < totalWidth; m++) {
      const x = m * measureWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      
      // Measure number
      ctx.fillStyle = '#6a6a8e';
      ctx.font = '10px sans-serif';
      if (m % measureLabelStride === 0) ctx.fillText(`${m + 1}`, x + 2, 12);
    }

    // Draw beat ticks within measures
    ctx.strokeStyle = '#2a2a4e';
    for (let m = 0; measureWidth / beatsPerMeasure >= 4 && m * measureWidth < totalWidth; m++) {
      for (let b = 1; b < beatsPerMeasure; b++) {
        const x = m * measureWidth + (b * measureWidth / beatsPerMeasure);
        ctx.beginPath();
        ctx.moveTo(x, height / 2);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }

    // Draw selected region
    if (selectedRegion) {
      const startX = selectedRegion.start * zoom;
      const endX = selectedRegion.end * zoom;
      ctx.fillStyle = 'rgba(74, 158, 255, 0.15)';
      ctx.fillRect(startX, 0, endX - startX, height);
    }

    // Draw beat markers (user-defined)
    beatMarkers.forEach((beat, index) => {
      const x = beat.time * zoom;
      const isDragging = draggingBeat === index;
      
      // Marker triangle
      ctx.fillStyle = isDragging ? '#ffaa00' : '#ff6b6b';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x - 6, 12);
      ctx.lineTo(x + 6, 12);
      ctx.closePath();
      ctx.fill();

      // BPM label
      ctx.fillStyle = '#ff6b6b';
      ctx.font = '9px sans-serif';
      ctx.fillText(`${Math.round(beat.bpm)}`, x + 8, 10);

      // Beat line
      ctx.strokeStyle = isDragging ? '#ffaa00' : '#ff6b6b';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, 12);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Draw current time playhead
    const playheadX = currentTime * zoom;
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    // Time ruler at bottom
    ctx.fillStyle = '#555';
    ctx.font = '9px sans-serif';
    for (let t = 0; t <= duration; t += 1) {
      const x = t * zoom;
      if (t % 5 === 0) {
        ctx.fillRect(x, height - 8, 1, 8);
      }
    }
  }, [duration, zoom, bpm, timeSignature, beatMarkers, currentTime, selectedRegion, 
      draggingBeat, totalWidth, height, measureWidth, beatsPerMeasure]);

  const handleDoubleClick = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = x / zoom;
    if (onBeatAdd && time >= 0 && time <= duration) {
      onBeatAdd(time, bpm);
    }
  }, [zoom, duration, bpm, onBeatAdd]);

  const handleMouseDown = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = x / zoom;
    
    // Check if clicking near a beat marker
    const clickedBeat = beatMarkers.findIndex(beat => 
      Math.abs(beat.time * zoom - x) < 10
    );
    
    if (clickedBeat >= 0 && onBeatRemove && e.shiftKey) {
      onBeatRemove(clickedBeat);
      return;
    }
    
    if (clickedBeat >= 0 && onBeatMove) {
      setDraggingBeat(clickedBeat);
      setDragStartX(x);
      return;
    }
    
    if (onSeek) {
      onSeek(Math.max(0, Math.min(time, duration)));
    }
  }, [beatMarkers, zoom, duration, onBeatRemove, onBeatMove, onSeek]);

  const handleMouseMove = useCallback((e) => {
    if (draggingBeat === null || !onBeatMove) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const newTime = Math.max(0, Math.min(x / zoom, duration));
    onBeatMove(draggingBeat, newTime);
  }, [draggingBeat, zoom, duration, onBeatMove]);

  const handleMouseUp = useCallback(() => {
    setDraggingBeat(null);
    setDragStartX(null);
  }, []);

  return (
    <div className="beat-marker-lane" style={{ overflowX: 'auto', width: '100%' }}>
      <canvas
        ref={canvasRef}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: draggingBeat !== null ? 'grabbing' : 'pointer' }}
      />
    </div>
  );
}
