// Show Programming channel resolution for fixture-library keys (library audit fix C).
// Library keys without an exact FIXTURE_TYPE_MAP entry resolve from the library
// entry's category/family instead of blind substring matching.
import { describe, it, expect } from 'vitest'
import { getFixtureInfo, getFixtureCategory, getFixtureChannels, FIXTURE_TYPE_MAP } from '../fixtureTypeResolver'
import { generateAutoTracks, getEquipmentCategory } from '../../runtime/autoTrackGenerator'
import { FIXTURE_LIBRARY } from '../../data/fixtureLibrary'

const trackTypes = (type) =>
  generateAutoTracks({ fixtures: [{ id: 'f1', type }] }).tracks.map(t => t.type)

describe('library lights get lighting channels', () => {
  it('a curated RGB underwater light gets master + R/G/B tracks', () => {
    expect(getEquipmentCategory('light_uw_rgb_18w')).toBe('lighting')
    const types = trackTypes('light_uw_rgb_18w')
    expect(types).toEqual(expect.arrayContaining(['lighting_master', 'lighting_red', 'lighting_green', 'lighting_blue']))
    expect(types).not.toContain('device_enable')
  })

  it('every light_uw_rgb_* key resolves to lighting', () => {
    const keys = FIXTURE_LIBRARY.map(f => f.key).filter(k => k.startsWith('light_uw_rgb_'))
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) expect(getFixtureCategory(k)).toBe('lighting')
  })

  it('RGBW fixtures carry a white channel, RGB fixtures do not', () => {
    expect(getFixtureChannels('light_underwater_par_rgbw_36w')).toContain('w')
    expect(getFixtureChannels('light_underwater_par_rgb_36w')).not.toContain('w')
    expect(getFixtureChannels('light_uw_rgb_18w')).toEqual(expect.arrayContaining(['r', 'g', 'b']))
  })

  it('single-colour white lights get one intensity channel', () => {
    expect(getFixtureCategory('light_uw_white_18w')).toBe('lighting')
    expect(getFixtureChannels('light_uw_white_18w')).toEqual(['intensity'])
  })
})

describe('family-correct resolution', () => {
  it('chlorine dosing pumps are generic process equipment, not pumps', () => {
    expect(getFixtureCategory('dosing_chlorine_pump')).not.toBe('pump')
    expect(getFixtureCategory('water_treatment_chlorine_dosing_pump')).not.toBe('pump')
    expect(getEquipmentCategory('dosing_chlorine_pump')).toBe('generic')
  })

  it('the high-pressure mist pump is a pump, not a fog emitter', () => {
    expect(getFixtureCategory('pump_high_pressure_mist_2_2kw')).toBe('pump')
  })

  it('generated nozzles get a water level track instead of enable-only', () => {
    expect(getFixtureCategory('nozzle_straight_jet_dn25')).toBe('pump')
    expect(trackTypes('nozzle_straight_jet_dn25')).toContain('pump_speed')
    expect(getFixtureInfo('nozzle_straight_jet_dn25').previewCategory).toMatch(/^water_/)
  })

  it('mist nozzles map to fog density', () => {
    expect(getFixtureCategory('nozzle_mist_jet_dn25')).toBe('fog')
    expect(getFixtureCategory('nozzle_mist_ring')).toBe('fog')
  })

  it('valves → solenoid, flame → fire, fog → fog, laser → laser', () => {
    expect(getFixtureCategory('valve_gate_valve_dn50')).toBe('solenoid')
    expect(getFixtureCategory('flame_line_burner_m')).toBe('fire')
    expect(getFixtureCategory('fog_haze_machine_pro')).toBe('fog')
    expect(getFixtureCategory('laser_green_laser_3w')).toBe('laser')
  })

  it('fuel tanks are not triggerable burners and sensors are read-only', () => {
    expect(getFixtureCategory('fuel_lpg_tank_100kg')).toBe('generic')
    expect(getFixtureInfo('sensor_wind_sensor').runtimeType).toBe('sensor')
  })

  it('no library light or nozzle falls through to enable-only generic', () => {
    const bad = FIXTURE_LIBRARY
      .filter(f => f.category === 'Lights' || f.category === 'Nozzles')
      .filter(f => getFixtureCategory(f.key) === 'generic')
      .map(f => f.key)
    expect(bad).toEqual([])
  })
})

describe('existing exact mappings are unchanged', () => {
  it('exact keys return their own map entry', () => {
    for (const k of ['nozzle_geyser', 'nozzle_volcano', 'nozzle_laminar', 'nozzle_water_screen', 'geyser', 'light_rgb', 'pump']) {
      expect(getFixtureInfo(k)).toBe(FIXTURE_TYPE_MAP[k])
    }
  })

  it('non-library unknown types still get the safe generic fallback', () => {
    expect(getFixtureInfo('totally_made_up_fixture_xyz').category).toBe('generic')
  })
})
