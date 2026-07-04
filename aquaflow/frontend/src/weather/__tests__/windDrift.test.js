// Unit tests for Wind Drift Safety (AQ-X-012), mirroring the backend engine.
//   1. wind drift from weather data, 2. safety zones + breach detection,
//   3. operator warnings displayed (severity-ranked).
import { describe, it, expect } from 'vitest'
import {
  jetTimeOfFlight, windDrift, windVector, computeSafetyZones, operatorWarnings,
  analyzeWindDrift, HIGH_WIND_SHUTDOWN_MS,
} from '../windDrift'

const WEST_WIND = { windSpeed: 5.0, windDirection: 270.0 }
const JET = { id: 'j1', x: 0, y: 0, height: 4, splashRadius: 0.5 }
const FOUNTAIN = { keepClearM: 4.0, jets: [JET], barriers: [{ name: 'rail', distanceM: 6.0 }] }
const codes = (ws) => new Set(ws.map((w) => w.code))

describe('drift from weather data', () => {
  it('time of flight and drift match the physics', () => {
    const t = jetTimeOfFlight(4)
    expect(t).toBeCloseTo(2 * Math.sqrt((2 * 4) / 9.81), 9)
    expect(windDrift(4, 5, 0.5)).toBeCloseTo(0.5 * 5 * t, 9)
    expect(windDrift(4, 0)).toBe(0)
  })

  it('west wind blows the spray east', () => {
    const v = windVector(5, 270)
    expect(v.east).toBeCloseTo(5, 6)
    expect(Math.abs(v.north)).toBeLessThan(1e-6)
  })
})

describe('safety zones', () => {
  it('calm zone is just the splash radius', () => {
    const z = computeSafetyZones(FOUNTAIN, { windSpeed: 0, windDirection: 0 })
    expect(z.exclusionRadiusM).toBeCloseTo(0.5, 3)
    expect(z.breaches).toEqual([])
  })

  it('wind expands the zone and breaches keep-clear', () => {
    const z = computeSafetyZones(FOUNTAIN, WEST_WIND)
    const drift = windDrift(4, 5, 0.5)
    expect(z.exclusionRadiusM).toBeCloseTo(drift + 0.5, 2)
    expect(z.breaches.some((b) => b.type === 'keep_clear')).toBe(true)
  })

  it('strong wind breaches a barrier', () => {
    const z = computeSafetyZones(FOUNTAIN, { windSpeed: 8, windDirection: 270 })
    expect(z.breaches.some((b) => b.type === 'barrier')).toBe(true)
  })

  it('centre is the jet centroid', () => {
    const z = computeSafetyZones(
      { keepClearM: 10, jets: [{ id: 'a', x: 0, y: 0, height: 2 }, { id: 'b', x: 4, y: 0, height: 2 }] },
      { windSpeed: 0, windDirection: 0 })
    expect(z.center[0]).toBeCloseTo(2, 6)
  })

  it('recompute is deterministic (real-time safe)', () => {
    expect(computeSafetyZones(FOUNTAIN, WEST_WIND).exclusionRadiusM)
      .toBe(computeSafetyZones(FOUNTAIN, WEST_WIND).exclusionRadiusM)
  })
})

describe('operator warnings', () => {
  it('breach raises a critical warning', () => {
    const z = computeSafetyZones(FOUNTAIN, WEST_WIND)
    const w = operatorWarnings(z, WEST_WIND)
    const kc = w.find((x) => x.code === 'keep_clear_breach')
    expect(kc.severity).toBe('critical')
  })

  it('high wind sorts first and is critical', () => {
    const high = { windSpeed: HIGH_WIND_SHUTDOWN_MS + 1, windDirection: 270 }
    const w = operatorWarnings(computeSafetyZones(FOUNTAIN, high), high)
    expect(w[0].severity).toBe('critical')
    expect(codes(w).has('high_wind')).toBe(true)
  })

  it('calm conditions yield a single clear info', () => {
    const calm = { windSpeed: 1, windDirection: 0 }
    const w = operatorWarnings(computeSafetyZones(FOUNTAIN, calm), calm)
    expect(w.length).toBe(1)
    expect(w[0].code).toBe('clear')
  })

  it('gust-only breach is flagged', () => {
    const f = { keepClearM: 5.2, jets: [JET] }
    const z = computeSafetyZones(f, WEST_WIND)
    const w = operatorWarnings(z, WEST_WIND)
    expect(z.exclusionRadiusM).toBeLessThanOrEqual(5.2)
    expect(z.gustExclusionRadiusM).toBeGreaterThan(5.2)
    expect(codes(w).has('gust_breach')).toBe(true)
  })
})

describe('analyzeWindDrift', () => {
  it('summarises safety', () => {
    const r = analyzeWindDrift(FOUNTAIN, WEST_WIND)
    expect(r.summary.safe).toBe(false)
    expect(r.summary.highestSeverity).toBe('critical')
    expect(r.summary.exclusionRadiusM).toBeGreaterThan(4)
  })

  it('is safe when calm', () => {
    const r = analyzeWindDrift(FOUNTAIN, { windSpeed: 1, windDirection: 0 })
    expect(r.summary.safe).toBe(true)
    expect(r.summary.breachCount).toBe(0)
  })
})
