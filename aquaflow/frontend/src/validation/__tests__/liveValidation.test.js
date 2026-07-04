// Unit tests for Real-Time Validation (AQ-X-011).
// Covers the acceptance criteria:
//   1. validation results are produced for the UI to show,
//   2. errors are detected and tagged with a target for immediate highlighting,
//   3. performance stays within the 100 ms latency budget (measured + wall-clock).
import { describe, it, expect } from 'vitest'
import {
  validateSystem, erroredTargets, LATENCY_BUDGET_MS, DMX_MAX_CHANNEL,
} from '../liveValidation'

const codes = (v) => new Set(v.results.map((r) => r.code))

describe('validateSystem — produces results', () => {
  it('a clean design passes with no errors', () => {
    const v = validateSystem({
      fixtures: [
        { id: 'rgb-1', type: 'light_rgb', x: 1, y: 1, universe: 1, channel: 1 },
        { id: 'rgb-2', type: 'light_rgb', x: 2, y: 1, universe: 1, channel: 5 },
      ],
    })
    expect(v.ok).toBe(true)
    expect(v.counts.error).toBe(0)
    expect(typeof v.durationMs).toBe('number')
    expect(v.checkedAt).toBeGreaterThan(0)
  })

  it('sorts errors before warnings', () => {
    const v = validateSystem({
      fixtures: [
        { id: 'a', type: 'light_rgb', universe: 1, channel: 1 },   // missing coords → warning
        { id: 'b', type: 'light_rgb', x: 0, y: 0, channel: 9999 }, // channel range → error
      ],
    })
    expect(v.results[0].severity).toBe('error')
  })
})

describe('validateSystem — error detection + highlighting', () => {
  it('flags a duplicate fixture id', () => {
    const v = validateSystem({ fixtures: [
      { id: 'x', type: 'pump', x: 0, y: 0 }, { id: 'x', type: 'pump', x: 1, y: 1 }] })
    expect(codes(v).has('duplicate_id')).toBe(true)
    expect(v.ok).toBe(false)
  })

  it('flags an out-of-range DMX channel with the fixture as target', () => {
    const v = validateSystem({ fixtures: [
      { id: 'l1', type: 'light_rgb', x: 0, y: 0, channel: DMX_MAX_CHANNEL + 1 }] })
    const err = v.errors.find((e) => e.code === 'channel_range')
    expect(err).toBeTruthy()
    expect(err.target).toBe('l1')
    expect(erroredTargets(v).has('l1')).toBe(true)   // immediate highlight target
  })

  it('flags an out-of-range universe', () => {
    const v = validateSystem({ fixtures: [
      { id: 'l1', type: 'light_rgb', x: 0, y: 0, universe: 99999, channel: 1 }] })
    expect(codes(v).has('universe_range')).toBe(true)
  })

  it('flags a duplicate DMX address via the dependency graph', () => {
    const v = validateSystem({ fixtures: [
      { id: 'a', type: 'light_rgb', x: 0, y: 0, universe: 1, channel: 1 },
      { id: 'b', type: 'light_rgb', x: 1, y: 0, universe: 1, channel: 1 }] })
    expect(codes(v).has('address_conflict')).toBe(true)
    expect(v.ok).toBe(false)
  })

  it('flags a circular dependency', () => {
    const v = validateSystem({ fixtures: [
      { id: 'a', type: 'pump', x: 0, y: 0, dependsOn: ['b'] },
      { id: 'b', type: 'pump', x: 1, y: 0, dependsOn: ['a'] }] })
    expect(codes(v).has('cycle')).toBe(true)
  })

  it('warns on missing placement coordinates', () => {
    const v = validateSystem({ fixtures: [{ id: 'l1', type: 'light_rgb', universe: 1, channel: 1 }] })
    expect(codes(v).has('missing_coords')).toBe(true)
    expect(v.counts.warning).toBeGreaterThanOrEqual(1)
  })

  it('warns on out-of-range intensity', () => {
    const v = validateSystem({ fixtures: [{ id: 'p', type: 'pump', x: 0, y: 0, intensity: 1.4 }] })
    expect(codes(v).has('intensity_range')).toBe(true)
  })
})

describe('validateSystem — live safety status', () => {
  it('errors on an active emergency stop', () => {
    const v = validateSystem({ fixtures: [], safety: { state: 'EMERGENCY_STOP' } })
    expect(codes(v).has('estop')).toBe(true)
  })

  it('errors when playing without a permit and warns on PLC loss', () => {
    const v = validateSystem({ fixtures: [],
      safety: { playing: true, permit: false, plcOnline: false } })
    expect(codes(v).has('no_permit')).toBe(true)
    expect(codes(v).has('plc_offline')).toBe(true)
  })

  it('flags hardware conflicts from the live status', () => {
    const v = validateSystem({ fixtures: [], safety: { hardwareConflicts: 2 } })
    expect(codes(v).has('hw_conflict')).toBe(true)
  })
})

describe('performance — within 100 ms latency budget', () => {
  it('validates a large system well under budget', () => {
    const fixtures = []
    for (let i = 0; i < 500; i++) {
      fixtures.push({
        id: `fx-${i}`,
        type: i % 2 ? 'light_rgb' : 'center_jets',
        x: i % 25, y: Math.floor(i / 25),
        universe: 1 + Math.floor(i / 100),
        channel: 1 + ((i * 4) % 500),
        engineering: { plcHost: `10.0.0.${1 + (i % 8)}` },
      })
    }
    const start = performance.now()
    const v = validateSystem({ fixtures })
    const wall = performance.now() - start

    expect(v.counts.total).toBeGreaterThan(0)         // it did real work
    expect(v.durationMs).toBeLessThan(LATENCY_BUDGET_MS)
    expect(v.withinLatencyBudget).toBe(true)
    expect(wall).toBeLessThan(LATENCY_BUDGET_MS)
  })

  it('reports withinLatencyBudget on a normal design', () => {
    const v = validateSystem({ fixtures: [{ id: 'a', type: 'pump', x: 0, y: 0 }] })
    expect(v.withinLatencyBudget).toBe(true)
  })
})
