// Real catalogue products: in the library, resolvable to runtime channels, drawn in 3D as declared.
import { describe, it, expect } from 'vitest'
import { REFERENCE_PRODUCTS } from '../fixtureReferenceProducts'
import { FIXTURE_LIBRARY, getFixtureType } from '../fixtureLibrary'
import { getFixtureInfo } from '../../utils/fixtureTypeResolver'
import { resolveFixtureType, classifyFixtureType, fixturesToNozzleConfigs, resolveFixtureGroup } from '../../hooks/fixtureTypeMap'
import { isWaterNozzleFixture } from '../../engineering/hydraulicAdapter'

const keys = new Set(FIXTURE_LIBRARY.map(f => f.key))
const place = (key) => ({ id: key, type: key, x: 0, y: 0, engineering: getFixtureType(key).engineering })

describe('catalogue reference products', () => {
  it('are all in the merged library with a maker, model and source page', () => {
    expect(REFERENCE_PRODUCTS.length).toBeGreaterThan(100)
    for (const p of REFERENCE_PRODUCTS) {
      expect(keys.has(p.key), p.key).toBe(true)
      const f = getFixtureType(p.key)
      expect(f.manufacturer, p.key).toBeTruthy()
      expect(f.model, p.key).toBeTruthy()
      expect(f.engineering.referenceSource, p.key).toMatch(/^https:\/\//)
    }
  })

  it('stay flagged as estimates until a datasheet is attached', () => {
    for (const p of REFERENCE_PRODUCTS) expect(getFixtureType(p.key).generic, p.key).toBe(true)
  })

  it('resolve to their declared runtime type', () => {
    for (const p of REFERENCE_PRODUCTS.filter(x => x.resolverKey)) {
      expect(getFixtureInfo(p.key), p.key).toBe(getFixtureInfo(p.resolverKey))
    }
  })

  it('water nozzles are never classified as equipment and draw as declared', () => {
    for (const p of REFERENCE_PRODUCTS.filter(x => x.preview3d)) {
      expect(classifyFixtureType(p.key), p.key).not.toBe('equipment')
      const want = p.preview3d.startsWith('like:') ? resolveFixtureType(p.preview3d.slice(5)).nozzleType : p.preview3d
      expect(resolveFixtureType(p.key).nozzleType, p.key).toBe(want)
    }
  })

  it('equipment (pumps, valves, controls, projector, accessories) is not drawn as water', () => {
    const equipment = REFERENCE_PRODUCTS.filter(p => ['Pumps', 'Valves', 'Controls', 'Sensors', 'Electrical',
      'Hydraulic Accessories', 'Filtration', 'Projection'].includes(p.category))
    expect(equipment.length).toBeGreaterThan(20)
    for (const p of equipment) expect(classifyFixtureType(p.key), p.key).toBe('equipment')
  })

  it('a rotating catalogue nozzle reaches the 3D preview with its outlets and height', () => {
    const [cfg] = fixturesToNozzleConfigs([place('nozzle_twister_g3_saferain')]).nozzleConfigs
    expect(cfg.type).toBe('pirouette')
    expect(cfg.engineering.outletCount).toBe(12)
    expect(cfg.designHeightM).toBe(4)
  })
})

describe('solenoid jets', () => {
  const solenoid = REFERENCE_PRODUCTS.filter(p => p.family === 'Solenoid Jets (catalogue)')

  it('are water nozzles with fast on/off (digital) channels, drawn as jets', () => {
    expect(solenoid.length).toBeGreaterThanOrEqual(5)
    for (const p of solenoid) {
      expect(getFixtureInfo(p.key).channels, p.key).toContain('enable')
      expect(getFixtureInfo(p.key).deviceType, p.key).toBe('digital')
      expect(isWaterNozzleFixture(place(p.key)), p.key).toBe(true)
      expect(['jet_1d', 'jet_3d']).toContain(fixturesToNozzleConfigs([place(p.key)]).nozzleConfigs[0].type)
    }
  })

  it('the Fontana POP Jet keeps its 20 ms valve and 0.9 m height', () => {
    const e = getFixtureType('nozzle_solenoid_pop_jet_pj100_fontana').engineering
    expect(e.responseMs).toBe(20)
    expect(e.jetHeightM).toBe(0.9)
  })
})

describe('1D / 2D / 3D swing nozzles', () => {
  const motion = REFERENCE_PRODUCTS.filter(p => p.category === 'Motion Systems')

  it('resolve to the motion runtime matching their axis count and draw as moving jets', () => {
    for (const p of motion) {
      const axes = p.engineering.axisCount
      const want = axes >= 3 ? 'motion_3d' : axes === 2 ? 'motion_2d' : 'motion_1d'
      expect(getFixtureInfo(p.key).runtimeType, p.key).toBe(want)
      expect(resolveFixtureType(p.key).nozzleType, p.key).toBe(want)
      expect(resolveFixtureGroup(p.key), p.key).toBe(`${want}_jets`)
    }
  })

  it('carry a rated jet so they draw at their real height and count in the water network', () => {
    for (const p of motion) {
      const [cfg] = fixturesToNozzleConfigs([place(p.key)]).nozzleConfigs
      expect(cfg.designHeightM, p.key).toBeGreaterThan(0)
      expect(isWaterNozzleFixture(place(p.key)), p.key).toBe(true)
    }
  })
})
