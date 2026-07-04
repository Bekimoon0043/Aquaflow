// Unit tests for the 4K Video Export Engine (AQ-S3-007).
//   1. 4K supported        — resolution presets + is4K.
//   2. 60 FPS supported    — framerate presets, frame count/period, bitrate.
//   3. Audio synchronized  — A/V sync offset + stream muxing.
import { describe, it, expect } from 'vitest'
import {
  RESOLUTIONS, FRAMERATES, getResolution, is4K, normalizeFps, estimateBitrate,
  frameCount, frameDurationMs, supportedMimeType, audioVideoSync, combineStreams,
  buildExportConfig,
} from '../videoExport'

// ── 1. 4K supported ──────────────────────────────────────────────────────────
describe('4K support', () => {
  it('has a 4K UHD preset at 3840×2160', () => {
    expect(RESOLUTIONS['4k'].w).toBe(3840)
    expect(RESOLUTIONS['4k'].h).toBe(2160)
    expect(is4K('4k')).toBe(true)
  })

  it('does not mark sub-4K resolutions as 4K', () => {
    expect(is4K('1080p')).toBe(false)
    expect(is4K('1440p')).toBe(false)
  })

  it('resolves custom {w,h} and unknown keys', () => {
    expect(getResolution({ w: 4096, h: 2160 }).w).toBe(4096)
    expect(is4K({ w: 4096, h: 2160 })).toBe(true)
    expect(getResolution('zzz').label).toBe('Full HD 1080p')  // fallback
  })

  it('buildExportConfig reports 4K dimensions', () => {
    const cfg = buildExportConfig({ resolution: '4k', fps: 60 })
    expect(cfg.width).toBe(3840)
    expect(cfg.height).toBe(2160)
    expect(cfg.is4K).toBe(true)
  })
})

// ── 2. 60 FPS supported ──────────────────────────────────────────────────────
describe('60 FPS support', () => {
  it('lists 60 as a valid framerate', () => {
    expect(FRAMERATES).toContain(60)
    expect(normalizeFps(60)).toBe(60)
    expect(normalizeFps(58)).toBe(60)   // snaps to nearest valid
  })

  it('frame count and period are correct at 60 fps', () => {
    expect(frameCount(10, 60)).toBe(600)
    expect(frameDurationMs(60)).toBeCloseTo(1000 / 60, 6)
  })

  it('bitrate scales with resolution and fps', () => {
    const b4k60 = estimateBitrate(3840, 2160, 60)
    const b1080_30 = estimateBitrate(1920, 1080, 30)
    expect(b4k60).toBeGreaterThan(b1080_30)
    expect(b4k60).toBeGreaterThan(0)
  })

  it('config carries fps 60 + a positive bitrate + frame count', () => {
    const cfg = buildExportConfig({ resolution: '4k', fps: 60, durationS: 5 })
    expect(cfg.fps).toBe(60)
    expect(cfg.videoBitrate).toBeGreaterThan(0)
    expect(cfg.frameCount).toBe(300)   // 5s * 60
  })
})

// ── 3. Audio synchronized ────────────────────────────────────────────────────
describe('audio sync', () => {
  it('flags aligned audio as synced and offset audio as not', () => {
    expect(audioVideoSync({ videoStartMs: 1000, audioStartMs: 1010 }).synced).toBe(true)  // 10ms
    const off = audioVideoSync({ videoStartMs: 1000, audioStartMs: 1200 })
    expect(off.synced).toBe(false)
    expect(off.offsetMs).toBe(200)
    expect(off.correctionMs).toBe(-200)   // shift audio back 200ms
  })

  it('accounts for audio pipeline latency', () => {
    const s = audioVideoSync({ videoStartMs: 0, audioStartMs: 0, audioLatencyMs: 100, toleranceMs: 40 })
    expect(s.offsetMs).toBe(100)
    expect(s.synced).toBe(false)
  })

  it('combines a video stream and an audio stream into one', () => {
    const vTrack = { kind: 'video' }, aTrack = { kind: 'audio' }
    const video = { getVideoTracks: () => [vTrack], getTracks: () => [vTrack] }
    const audio = { getAudioTracks: () => [aTrack], getTracks: () => [aTrack] }
    const out = combineStreams(video, audio)
    const kinds = out.getTracks().map(t => t.kind).sort()
    expect(kinds).toEqual(['audio', 'video'])
  })

  it('combines video-only when there is no audio', () => {
    const vTrack = { kind: 'video' }
    const out = combineStreams({ getVideoTracks: () => [vTrack] }, null)
    expect(out.getTracks().map(t => t.kind)).toEqual(['video'])
  })

  it('config enables audio + audio bitrate when requested', () => {
    const withAudio = buildExportConfig({ resolution: '4k', fps: 60, withAudio: true })
    expect(withAudio.hasAudio).toBe(true)
    expect(withAudio.audioBitrate).toBeGreaterThan(0)
    expect(buildExportConfig({ withAudio: false }).audioBitrate).toBe(0)
  })
})

// ── MIME selection ───────────────────────────────────────────────────────────
describe('mime type selection', () => {
  it('picks the first supported candidate', () => {
    const rec = { isTypeSupported: (m) => m === 'video/webm;codecs=vp9' }
    expect(supportedMimeType(undefined, rec)).toBe('video/webm;codecs=vp9')
  })

  it('falls back to video/webm when nothing matches', () => {
    expect(supportedMimeType(['video/mp4'], { isTypeSupported: () => false })).toBe('video/webm')
    expect(supportedMimeType(undefined, undefined)).toBe('video/webm')
  })
})
