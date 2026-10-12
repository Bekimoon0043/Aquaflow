// Equipment totals, BOM, DMX footprint and hydraulic-solve selection for
// generated library items (library audit fix A/E).
import { describe, it, expect } from 'vitest'
import { calculateEquipmentTotals } from '../hydraulicEngine'
import { generateBOM } from '../bomEngine'
import { buildHydraulicPreviewPayload, engineeringFixtureToSolverNozzle } from '../hydraulicAdapter'
import { readPatch } from '../../runtime/dmxPatch'
import { getDefaultEngineering } from '../../data/fixtureLibrary'

const place = (id, type) => ({ id, type, engineering: getDefaultEngineering(type) })

describe('equipment totals count generated items', () => {
  it('generated pumps contribute kW and capacity', () => {
    const t = calculateEquipmentTotals([place('p1', 'pump_inline_vfd_pump_7_5kw')])
    expect(t.totalPumpPowerKw).toBe(7.5)
    expect(t.totalPumpCapacityM3Hr).toBeGreaterThan(0)
    expect(t.totalWatts).toBe(7500)
  })

  it('generated lights contribute watts and DMX channels', () => {
    const t = calculateEquipmentTotals([
      place('l1', 'light_underwater_par_rgbw_36w'),
      place('l2', 'light_underwater_par_rgb_18w'),
    ])
    expect(t.totalWatts).toBe(54)
    expect(t.totalDmxChannels).toBe(7)
  })

  it('curated pumps read powerKw; filters read flowM3Hr once', () => {
    const t = calculateEquipmentTotals([place('p', 'pump_dry_centrifugal_15kw'), place('f', 'filter_sand_dn650')])
    expect(t.totalPumpPowerKw).toBe(15)
    expect(t.totalProcessFlowLpm).toBeCloseTo(15 / 0.06, 6)
  })

  it('mist nozzles are process flow only, not double-counted as display flow', () => {
    const t = calculateEquipmentTotals([place('m', 'nozzle_mist_ring')])
    expect(t.totalNozzleFlowLpm).toBe(0)
    expect(t.totalFlowLpm).toBeCloseTo(t.totalProcessFlowLpm, 9)
  })
})

describe('BOM counts generated items', () => {
  it('reports W, kW and DMX for generated fixtures', () => {
    const bom = generateBOM([place('p1', 'pump_inline_vfd_pump_7_5kw'), place('l1', 'light_underwater_par_rgbw_36w')])
    const pump = bom.find(i => i.key === 'pump_inline_vfd_pump_7_5kw')
    const light = bom.find(i => i.key === 'light_underwater_par_rgbw_36w')
    expect(pump.totalPowerKw).toBe(7.5)
    expect(pump.totalFlowM3Hr).toBeCloseTo(pump.totalFlowLpm * 0.06, 1)
    expect(light.totalWattage).toBe(36)
    expect(light.totalDmxChannels).toBe(4)
  })
})

describe('DMX patch footprint', () => {
  it('falls back to the library electrical footprint', () => {
    const p = readPatch({ id: 'a', type: 'light_underwater_par_rgbw_36w', universe: 1, channel: 10 })
    expect(p.channelCount).toBe(4)
    expect(p.endChannel).toBe(13)
  })
})

describe('hydraulic solve selection', () => {
  it('uses the connection DN for pipe diameter, not the orifice', () => {
    const n = engineeringFixtureToSolverNozzle(place('n', 'nozzle_straight_dn25'))
    expect(n.engineering.pipe_diameter_m).toBeCloseTo(0.025, 9)
    const legacy = engineeringFixtureToSolverNozzle({ id: 'x', engineering: { nozzleDiaMm: 12 } })
    expect(legacy.engineering.pipe_diameter_m).toBeCloseTo(0.05, 9)
  })

  it('only sends display-water nozzles to the water solve', () => {
    const payload = buildHydraulicPreviewPayload({
      fixtures: [
        place('jet', 'nozzle_straight_jet_dn25'),
        place('geyser', 'nozzle_geyser'),
        place('flame', 'flame_jet_burner_m'),
        place('fog', 'fog_fog_jet_pro'),
        place('mistpump', 'pump_high_pressure_mist_2_2kw'),
        place('mist', 'nozzle_fog_highpressure'),
        place('light', 'light_uw_rgb_18w'),
      ],
    })
    expect(payload.nozzles.map(n => n.id).sort()).toEqual(['geyser', 'jet'])
  })
})
