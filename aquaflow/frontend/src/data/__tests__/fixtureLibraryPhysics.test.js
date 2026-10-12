// Physics / honesty invariants for the merged fixture library (library audit fix A/B/D).
// Mirrors tools/validate_fixture_library.py, but over curated + generated entries.
import { describe, it, expect } from 'vitest'
import {
  FIXTURE_LIBRARY,
  getFixtureType,
  getDefaultEngineering,
  getFixtureRatings,
  parsePhase,
} from '../fixtureLibrary'

const G = 9.81
const BAR_TO_M = 10.197
const byKey = (k) => FIXTURE_LIBRARY.find(f => f.key === k)
const orificeLpm = (e) =>
  e.dischargeCoeff * (e.orificeCount || 1) * Math.PI / 4 * (e.nozzleDiaMm / 1000) ** 2
  * Math.sqrt(2 * G * e.pressureBar * BAR_TO_M) * 60000

describe('unknown fixture types', () => {
  it('returns a neutral Unknown entry instead of the first library item', () => {
    const t = getFixtureType('no_such_fixture_type')
    expect(t.category).toBe('Unknown')
    expect(t.key).not.toBe(FIXTURE_LIBRARY[0].key)
    expect(t.engineering).toEqual({})
    expect(t.electrical.powerW).toBe(0)
    expect(t.engineering.plcChannel).toBeUndefined()
  })

  it('getDefaultEngineering of an unknown type is {}', () => {
    expect(getDefaultEngineering('no_such_fixture_type')).toEqual({})
    expect(getDefaultEngineering(undefined)).toEqual({})
  })
})

describe('honesty', () => {
  it('every item is flagged generic with a datasheet note', () => {
    const bad = FIXTURE_LIBRARY.filter(f =>
      f.generic !== true || f.source !== 'generic' || !/datasheet/.test(f.engineering.dataSource || ''))
    expect(bad.map(f => f.key)).toEqual([])
  })

  it('no per-type plcChannel defaults remain', () => {
    expect(FIXTURE_LIBRARY.filter(f => 'plcChannel' in f.engineering).map(f => f.key)).toEqual([])
  })

  it('labels are unique', () => {
    const seen = new Map()
    const dups = []
    for (const f of FIXTURE_LIBRARY) {
      if (seen.has(f.label)) dups.push(f.label)
      seen.set(f.label, f.key)
    }
    expect(dups).toEqual([])
  })
})

describe('water physics', () => {
  const nozzles = FIXTURE_LIBRARY.filter(f => f.category === 'Nozzles')

  it('jet height never exceeds 0.9 x pressure head (falls excepted)', () => {
    const bad = nozzles.filter(f => f.engineering.heightBasis !== 'fall'
      && f.engineering.jetHeightM > 0.9 * f.engineering.pressureBar * BAR_TO_M + 1e-6)
    expect(bad.map(f => f.key)).toEqual([])
  })

  it('flow matches the orifice equation within 10 %', () => {
    const bad = nozzles.filter(f => {
      const ref = orificeLpm(f.engineering)
      return !(ref > 0) || Math.abs(f.engineering.flowLpm - ref) > 0.1 * ref
    })
    expect(bad.map(f => f.key)).toEqual([])
  })

  it('Straight Jet DN15 at 1 bar: h = 0.8 x 10.2 m, Q from a 7 mm orifice', () => {
    const e = byKey('nozzle_straight_dn15').engineering
    expect(e.pressureBar).toBe(1)
    expect(e.jetHeightM).toBeCloseTo(8.16, 1)
    expect(e.flowLpm).toBeCloseTo(30.4, 0)
  })

  it('water screen 15 m needs ~3 bar, not 1.2', () => {
    const e = byKey('nozzle_water_screen').engineering
    expect(e.jetHeightM).toBeLessThanOrEqual(0.9 * e.pressureBar * BAR_TO_M)
    expect(e.pressureBar).toBeGreaterThanOrEqual(3)
  })

  it('the mist pump can feed the high-pressure fog head', () => {
    const pump = byKey('pump_high_pressure_mist_2_2kw').engineering
    const fog = byKey('nozzle_fog_highpressure').engineering
    expect(fog.flowLpm).toBeLessThan(pump.flowLpm)
    expect(fog.pressureBar).toBe(pump.pressureBar)
  })
})

describe('pumps', () => {
  it('hydraulic power rho*g*Q*H is 45-75 % of the motor rating', () => {
    const bad = FIXTURE_LIBRARY.filter(f => f.category === 'Pumps').filter(f => {
      const e = f.engineering
      const eff = 1000 * G * (e.flowM3Hr / 3600) * e.headM / (e.powerKw * 1000)
      return !(eff >= 0.45 && eff <= 0.75)
    })
    expect(bad.map(f => f.key)).toEqual([])
  })

  it('flowLpm/flowM3Hr and headM/pressureBar agree', () => {
    const bad = FIXTURE_LIBRARY.filter(f => {
      const e = f.engineering
      if (e.flowLpm !== undefined && e.flowM3Hr !== undefined
        && Math.abs(e.flowLpm * 0.06 - e.flowM3Hr) > 0.02 * e.flowM3Hr + 0.01) return true
      if (e.headM !== undefined && e.pressureBar > 0
        && Math.abs(e.pressureBar * BAR_TO_M - e.headM) > 0.02 * e.headM + 0.05) return true
      return false
    })
    expect(bad.map(f => f.key)).toEqual([])
  })
})

describe('electrical derivation', () => {
  it('parses phase strings', () => {
    expect(parsePhase('3P')).toBe(3)
    expect(parsePhase('1P')).toBe(1)
    expect(parsePhase('1-phase')).toBe(1)
    expect(parsePhase('3-phase')).toBe(3)
    expect(parsePhase(undefined)).toBeNull()
  })

  it('reads powerKw and uses motor pf/eff for 3-phase pumps', () => {
    const el = byKey('pump_dry_centrifugal_15kw').electrical
    expect(el.powerW).toBe(15000)
    expect(el.phase).toBe(3)
    expect(el.currentA).toBeCloseTo(15000 / (Math.sqrt(3) * 380 * 0.85 * 0.88), 2)
  })

  it('single-phase motors use P/(V*pf*eff)', () => {
    const el = byKey('pump_submersible_1_5kw').electrical
    expect(el.phase).toBe(1)
    expect(el.currentA).toBeCloseTo(1500 / (220 * 0.85 * 0.88), 2)
  })

  it('never produces a 400 V single-phase load', () => {
    expect(FIXTURE_LIBRARY.filter(f => f.electrical.voltageV >= 380 && f.electrical.phase === 1)
      .map(f => f.key)).toEqual([])
  })

  it('lights keep pf 0.9 / eff 1 and realistic DMX footprints', () => {
    expect(byKey('light_spot_100w').electrical.currentA).toBeCloseTo(100 / (220 * 0.9), 2)
    expect(byKey('light_uw_white_18w').electrical.dmxChannels).toBe(1)
    expect(byKey('light_uw_rgb_18w').electrical.dmxChannels).toBe(3)
    expect(byKey('light_uw_rgbw_72w').electrical.dmxChannels).toBe(4)
    const mh = byKey('light_moving_head_350w').electrical.dmxChannels
    expect(mh).toBeGreaterThanOrEqual(12)
    expect(mh).toBeLessThanOrEqual(16)
    expect(byKey('laser_rgb_5w').electrical.dmxChannels).toBeGreaterThan(0)
    expect(byKey('effect_fog_machine').electrical.dmxChannels).toBeGreaterThan(0)
  })
})

describe('getFixtureRatings', () => {
  it('falls back to the library electrical block for generated items', () => {
    const type = 'pump_inline_vfd_pump_5_5kw'
    const r = getFixtureRatings({ type, engineering: getDefaultEngineering(type) })
    expect(r.powerW).toBe(5500)
    expect(r.flowM3Hr).toBeGreaterThan(0)
    const light = getFixtureRatings({ type: 'light_underwater_par_rgbw_36w', engineering: getDefaultEngineering('light_underwater_par_rgbw_36w') })
    expect(light.powerW).toBe(36)
    expect(light.dmxChannels).toBe(4)
  })

  it('instance engineering values win over library defaults', () => {
    const r = getFixtureRatings({ type: 'light_uw_rgb_18w', engineering: { wattage: 99, dmxChannels: 7 } })
    expect(r.powerW).toBe(99)
    expect(r.dmxChannels).toBe(7)
  })

  it('converts flowM3Hr and flowLph', () => {
    expect(getFixtureRatings({ engineering: { flowM3Hr: 6 } }).flowLpm).toBeCloseTo(100, 6)
    expect(getFixtureRatings({ engineering: { flowLph: 60 } }).flowLpm).toBeCloseTo(1, 6)
  })
})
