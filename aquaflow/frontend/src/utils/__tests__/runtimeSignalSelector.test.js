// Unit tests for the runtime-signal projection (AQ-S1-009).
// deriveRuntimeSignals projects timeline clips at the current playhead into the
// normalized runtime signals that drive the 3D preview and PLC compile — the
// core show-playback projection on the frontend.
import { describe, it, expect } from 'vitest'
import {
  createDefaultRuntimeSignals,
  deriveRuntimeSignals,
} from '../runtimeSignalSelector'

function pumpTrack(clip) {
  return { id: 'track-pump', type: 'pump', clips: [clip] }
}

describe('createDefaultRuntimeSignals', () => {
  it('returns an all-zero signal frame', () => {
    const s = createDefaultRuntimeSignals()
    expect(s.pump).toBe(0)
    expect(s.lighting).toBe(0)
    expect(s.flame).toBe(0)
    expect(s.groups).toBeTypeOf('object')
  })
})

describe('deriveRuntimeSignals — timeline projection', () => {
  it('projects an active pump clip into the pump signal', () => {
    const signals = deriveRuntimeSignals({
      timelineTracks: [pumpTrack({ id: 'c1', start: 0, end: 3, intensity: 80 })],
      playhead: 1.0,
      mode: 'timeline',
    })
    // intensity 80 → normalized 0.8
    expect(signals.pump).toBeCloseTo(0.8, 5)
    expect(signals.activeClips.length).toBe(1)
  })

  it('emits zero when the playhead is outside every clip', () => {
    const signals = deriveRuntimeSignals({
      timelineTracks: [pumpTrack({ id: 'c1', start: 0, end: 3, intensity: 80 })],
      playhead: 5.0,
      mode: 'timeline',
    })
    expect(signals.pump).toBe(0)
    expect(signals.activeClips.length).toBe(0)
  })

  it('ignores muted tracks', () => {
    const signals = deriveRuntimeSignals({
      timelineTracks: [{ id: 't', type: 'pump', muted: true, clips: [{ id: 'c', start: 0, end: 3, intensity: 100 }] }],
      playhead: 1.0,
      mode: 'timeline',
    })
    expect(signals.pump).toBe(0)
  })

  it('takes the max intensity when clips overlap', () => {
    const signals = deriveRuntimeSignals({
      timelineTracks: [
        { id: 't1', type: 'pump', clips: [{ id: 'a', start: 0, end: 3, intensity: 40 }] },
        { id: 't2', type: 'pump', clips: [{ id: 'b', start: 0, end: 3, intensity: 90 }] },
      ],
      playhead: 1.0,
      mode: 'timeline',
    })
    expect(signals.pump).toBeCloseTo(0.9, 5)
  })

  it('accepts 0..1 intensities as well as 0..100', () => {
    const signals = deriveRuntimeSignals({
      timelineTracks: [pumpTrack({ id: 'c1', start: 0, end: 3, intensity: 0.5 })],
      playhead: 1.0,
      mode: 'timeline',
    })
    expect(signals.pump).toBeCloseTo(0.5, 5)
  })

  it('is safe on empty input', () => {
    const signals = deriveRuntimeSignals({ timelineTracks: [], playhead: 0, mode: 'timeline' })
    expect(signals.pump).toBe(0)
    expect(signals.activeClips).toEqual([])
  })
})

describe('deriveRuntimeSignals — lighting projection', () => {
  it('projects a lighting clip into both the lighting signal and rgb_lights group', () => {
    const signals = deriveRuntimeSignals({
      timelineTracks: [{ id: 'tl', type: 'lighting', clips: [{ id: 'c', start: 0, end: 3, intensity: 100, color: '#ff0000' }] }],
      playhead: 1.0,
      mode: 'timeline',
    })
    expect(signals.lighting).toBeCloseTo(1.0, 5)
    expect(signals.groups.rgb_lights).toBeCloseTo(1.0, 5)
    // Red channel drives lighting color at full intensity.
    expect(signals.lightingColor.r).toBeCloseTo(1.0, 5)
    expect(signals.lightingColor.b).toBeCloseTo(0.0, 5)
  })
})
