// Unit tests for the fixture-type resolver (AQ-S1-009).
// The resolver maps designer fixture types → runtime type / group / channels used
// across the runtime device graph, PLC compile, and 3D preview, so its behaviour
// is a contract the rest of the frontend relies on.
import { describe, it, expect } from 'vitest'
import {
  normalizeFixtureType,
  getFixtureInfo,
  getRuntimeType,
  getFixtureCategory,
  getFixtureChannels,
  getChannelCountForType,
  getDefaultGroupId,
} from '../fixtureTypeResolver'

describe('normalizeFixtureType', () => {
  it('lowercases, trims, and normalizes separators', () => {
    expect(normalizeFixtureType('RGB Light')).toBe('rgb_light')
    expect(normalizeFixtureType('center-jets')).toBe('center_jets')
    expect(normalizeFixtureType('  Crown Jet  ')).toBe('crown_jet')
  })

  it('is null/undefined safe', () => {
    expect(normalizeFixtureType()).toBe('')
    expect(normalizeFixtureType(null)).toBe('')
  })
})

describe('getFixtureInfo', () => {
  it('resolves a known fixture to its runtime mapping', () => {
    const info = getFixtureInfo('geyser')
    expect(info.runtimeType).toBe('pump')
    expect(info.category).toBe('pump')
    expect(info.group).toBe('center_jets')
    expect(Array.isArray(info.channels)).toBe(true)
  })

  it('falls back to a safe generic mapping for unknown types', () => {
    const info = getFixtureInfo('totally_made_up_fixture_xyz')
    expect(info.runtimeType).toBe('equipment')
    expect(info.category).toBe('generic')
    expect(info.channels.length).toBeGreaterThan(0)
  })

  it('matches nozzle_-prefixed aliases to the base fixture', () => {
    expect(getFixtureInfo('nozzle_geyser').deviceType).toBe(getFixtureInfo('geyser').deviceType)
  })
})

describe('derived accessors stay consistent with getFixtureInfo', () => {
  it('getRuntimeType / getFixtureCategory mirror the info object', () => {
    expect(getRuntimeType('geyser')).toBe(getFixtureInfo('geyser').runtimeType)
    expect(getFixtureCategory('geyser')).toBe(getFixtureInfo('geyser').category)
  })

  it('getChannelCountForType matches the channel list length', () => {
    expect(getChannelCountForType('geyser')).toBe(getFixtureChannels('geyser').length)
    // Unknown types still get at least one channel.
    expect(getChannelCountForType('unknown_xyz')).toBeGreaterThanOrEqual(1)
  })
})

describe('getDefaultGroupId', () => {
  it('returns the mapped group for a known fixture', () => {
    expect(getDefaultGroupId('geyser')).toBe('center_jets')
  })

  it('always returns a non-empty group id', () => {
    expect(typeof getDefaultGroupId('anything')).toBe('string')
    expect(getDefaultGroupId('anything').length).toBeGreaterThan(0)
  })
})
