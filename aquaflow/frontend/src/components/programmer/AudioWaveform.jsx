// src/components/showProgrammer/AudioWaveform.jsx
import React, { useRef, useEffect, useState, useCallback } from 'react';

/**
 * AudioWaveform — Standalone audio waveform visualization
 * Props:
 *   - audioBuffer: AudioBuffer | null
 *   - duration: number (seconds)
 *   - currentTime: number (seconds)
 *   - zoom: number (pixels per second, default 50)
 *   - onSeek: (time) => void
 *   - onRegionSelect: (start, end) => void
 *   - selectedRegion: { start, end } | null
 *   - beatMarkers: Array<{ time, bpm }>
 *   - height: number (px, default 120)
 *   - className: string
 */
export default function AudioWaveform({
  audioBuffer,
  duration = 0,
  currentTime = 0,
  zoom = 50,
  onSeek,
  onRegionSelect,
  selectedRegion = null,
  beatMarkers = [],
  height = 120,
  className = '',
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [waveformData, setWaveformData] = useState(null);

  const totalWidth = Math.max(duration * zoom, 0);

  // Extract waveform data from AudioBuffer
  useEffect(() => {
    if (!audioBuffer) {
      setWaveformData(null);
      return;
    }
    const channelData = audioBuffer.getChannelData(0);
    const samplesPerPixel = Math.floor(channelData.length / totalWidth) || 1;
    const peaks = [];
    const mins = [];
    
    for (let i = 0; i < totalWidth; i++) {
      const start = i * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, channelData.length);
      let max = -Infinity;
      let min = Infinity;
      for (let j = start; j < end; j++) {
        const sample = channelData[j];
        if (sample > max) max = sample;
        if (sample < min) min = sample;
      }
      peaks.push(max);
      mins.push(min);
    }
    setWaveformData({ peaks, mins });
  }, [audioBuffer, totalWidth]);

  // Draw waveform
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

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, totalWidth, height);

    if (!waveformData) {
      // Draw placeholder
      ctx.fillStyle = '#3a3a5e';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No audio loaded', totalWidth / 2, height / 2);
      return;
    }

    const { peaks, mins } = waveformData;
    const centerY = height / 2;
    const amplitudeScale = (height - 10) / 2;

    // Draw waveform bars
    for (let i = 0; i < peaks.length; i++) {
      const peak = peaks[i] * amplitudeScale;
      const min = mins[i] * amplitudeScale;
      const barHeight = Math.max(peak - min, 1);
      
      // Selected region highlight
      const timeAtPixel = i / zoom;
      const inSelectedRegion = selectedRegion && 
        timeAtPixel >= selectedRegion.start && 
        timeAtPixel <= selectedRegion.end;
      
      ctx.fillStyle = inSelectedRegion ? '#4a9eff' : '#6a6a8e';
      ctx.fillRect(i, centerY - peak, 1, barHeight);
    }

    // Draw beat markers
    beatMarkers.forEach(beat => {
      const x = beat.time * zoom;
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      
      // BPM label
      ctx.fillStyle = '#ff6b6b';
      ctx.font = '10px sans-serif';
      ctx.fillText(`${Math.round(beat.bpm)}`, x + 2, 12);
    });

    // Draw current time playhead
    const playheadX = currentTime * zoom;
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    // Draw time ruler
    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    for (let t = 0; t <= duration; t += 1) {
      const x = t * zoom;
      ctx.fillRect(x, height - 15, 1, 15);
      if (t % 5 === 0) {
        ctx.fillText(formatTime(t), x + 2, height - 2);
      }
    }

    // Draw drag selection
    if (isDragging && dragStart !== null) {
      const currentX = dragStart;
      ctx.fillStyle = 'rgba(74, 158, 255, 0.3)';
      ctx.fillRect(Math.min(currentX, dragStart), 0, Math.abs(currentX - dragStart), height);
    }
  }, [waveformData, currentTime, zoom, height, duration, beatMarkers, selectedRegion, isDragging, dragStart, totalWidth]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleMouseDown = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = x / zoom;
    setIsDragging(true);
    setDragStart(x);
    if (onSeek) onSeek(Math.max(0, Math.min(time, duration)));
  }, [zoom, duration, onSeek]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setDragStart(x);
  }, [isDragging]);

  const handleMouseUp = useCallback((e) => {
    if (!isDragging) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const startTime = Math.min(dragStart, endX) / zoom;
    const endTime = Math.max(dragStart, endX) / zoom;
    
    if (Math.abs(endX - dragStart) > 5 && onRegionSelect) {
      onRegionSelect(
        Math.max(0, Math.min(startTime, duration)),
        Math.max(0, Math.min(endTime, duration))
      );
    }
    setIsDragging(false);
    setDragStart(null);
  }, [isDragging, dragStart, zoom, duration, onRegionSelect]);

  return (
    <div 
      ref={containerRef}
      className={`audio-waveform ${className}`}
      style={{ overflowX: 'auto', overflowY: 'hidden', width: '100%' }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: isDragging ? 'crosshair' : 'pointer' }}
      />
    </div>
  );
}