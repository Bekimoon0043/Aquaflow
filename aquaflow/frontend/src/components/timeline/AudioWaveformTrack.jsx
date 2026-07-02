/**
 * AudioWaveformTrack.jsx — AquaFlow Audio Waveform Timeline Track
 *
 * Renders at the top of the Timeline when audio has been synced.
 * Shows:
 *  - Waveform bars (energy profile)
 *  - Beat markers (downbeats highlighted)
 *  - Section labels (intro/verse/chorus/outro)
 *  - BPM + duration info
 *  - Remove audio button
 */
import { useRef, useEffect, useCallback } from "react";

const TRACK_HEIGHT = 48;
const WAVEFORM_COLOR     = "#10b981";
const BEAT_COLOR         = "rgba(16,185,129,0.5)";
const DOWNBEAT_COLOR     = "#10b981";
const SECTION_COLORS     = {
  intro:  "#378ADD",
  verse:  "#534AB7",
  chorus: "#D85A30",
  bridge: "#BA7517",
  outro:  "#378ADD",
};

export default function AudioWaveformTrack({
  audioData,        // { waveform, duration, bpm, filename, sections, beats }
  timelineZoom,     // pixels per second
  playhead,         // current playhead position in seconds
  scrollLeft,       // timeline scroll offset
  trackLabelWidth,  // width of the left label column
  onRemove,         // callback to clear audio from timeline
}) {
  const canvasRef = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioData) return;
    const ctx  = canvas.getContext("2d");
    const W    = canvas.width;
    const H    = canvas.height;
    const zoom = timelineZoom || 4;
    const scroll = scrollLeft || 0;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "rgba(16,185,129,0.06)";
    ctx.fillRect(0, 0, W, H);

    // Border bottom
    ctx.strokeStyle = "rgba(16,185,129,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H - 1);
    ctx.lineTo(W, H - 1);
    ctx.stroke();

    const { waveform = [], duration = 0, beats = [], sections = [] } = audioData;
    const totalWidth = duration * zoom;

    // ── Section backgrounds ──────────────────────────────────────────────────
    sections.forEach(section => {
      const x1 = section.start * zoom - scroll;
      const x2 = section.end   * zoom - scroll;
      if (x2 < 0 || x1 > W) return;
      const color = SECTION_COLORS[section.label] || "#556677";
      ctx.fillStyle = color + "18";
      ctx.fillRect(Math.max(0, x1), 0, Math.min(W, x2) - Math.max(0, x1), H - 4);

      // Section label
      if (x1 > -10 && x1 < W - 20) {
        ctx.fillStyle = color + "cc";
        ctx.font = "8px monospace";
        ctx.textAlign = "left";
        ctx.fillText(section.label.toUpperCase(), Math.max(2, x1 + 3), 10);
      }
    });

    // ── Waveform bars ────────────────────────────────────────────────────────
    if (waveform.length > 0 && totalWidth > 0) {
      const barCount = Math.min(waveform.length, Math.ceil(W / 2));
      const step = waveform.length / barCount;
      const barW  = Math.max(1, totalWidth / waveform.length);

      for (let i = 0; i < waveform.length; i++) {
        const x = i * (totalWidth / waveform.length) - scroll;
        if (x < -barW || x > W) continue;

        const val    = waveform[i] || 0;
        const barH   = Math.max(2, val * (H - 12));
        const y      = H - 6 - barH;

        const alpha = 0.4 + val * 0.5;
        ctx.fillStyle = `rgba(16,185,129,${alpha.toFixed(2)})`;
        ctx.fillRect(x, y, Math.max(1, barW - 0.5), barH);
      }
    }

    // ── Beat markers ─────────────────────────────────────────────────────────
    beats.forEach(beat => {
      const x = beat.time * zoom - scroll;
      if (x < 0 || x > W) return;
      const isDownbeat = beat.type === "downbeat";
      ctx.strokeStyle = isDownbeat ? DOWNBEAT_COLOR : BEAT_COLOR;
      ctx.lineWidth   = isDownbeat ? 1.5 : 0.5;
      ctx.globalAlpha = isDownbeat ? 0.8 : 0.35;
      ctx.beginPath();
      ctx.moveTo(x, isDownbeat ? 0 : H * 0.4);
      ctx.lineTo(x, H - 4);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // ── Playhead ─────────────────────────────────────────────────────────────
    const phX = playhead * zoom - scroll;
    if (phX >= 0 && phX <= W) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth   = 1.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(phX, 0);
      ctx.lineTo(phX, H);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }, [audioData, timelineZoom, playhead, scrollLeft]);

  useEffect(() => { draw(); }, [draw]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(() => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = TRACK_HEIGHT;
      draw();
    });
    obs.observe(canvas);
    canvas.width  = canvas.offsetWidth;
    canvas.height = TRACK_HEIGHT;
    draw();
    return () => obs.disconnect();
  }, [draw]);

  if (!audioData) return null;

  const { filename, bpm, duration, key, mood } = audioData;
  const mins = Math.floor(duration / 60);
  const secs = String(Math.floor(duration % 60)).padStart(2, "0");

  return (
    <div style={{
      display: "flex",
      height: TRACK_HEIGHT,
      borderBottom: "1px solid rgba(16,185,129,0.25)",
      background: "rgba(16,185,129,0.04)",
      flexShrink: 0,
    }}>
      {/* Label column */}
      <div style={{
        width: trackLabelWidth || 160,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 8px",
        borderRight: "1px solid rgba(16,185,129,0.2)",
        gap: 2,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 9, color: "#10b981" }}>♪</span>
            <span style={{ fontSize: 9, fontFamily: "monospace", color: "#10b981", fontWeight: "bold", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>
              {filename || "Audio"}
            </span>
          </div>
          {onRemove && (
            <button onClick={onRemove} title="Remove audio" style={{
              background: "none", border: "none", color: "#556677", cursor: "pointer",
              fontSize: 9, padding: "0 2px", lineHeight: 1, flexShrink: 0,
            }}>✕</button>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {bpm && <span style={{ fontSize: 8, color: "#334455", fontFamily: "monospace" }}>{Math.round(bpm)} BPM</span>}
          {duration > 0 && <span style={{ fontSize: 8, color: "#334455", fontFamily: "monospace" }}>{mins}:{secs}</span>}
          {key && <span style={{ fontSize: 8, color: "#334455", fontFamily: "monospace" }}>{key}</span>}
        </div>
      </div>

      {/* Waveform canvas */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: TRACK_HEIGHT, display: "block" }}
        />
      </div>
    </div>
  );
}
