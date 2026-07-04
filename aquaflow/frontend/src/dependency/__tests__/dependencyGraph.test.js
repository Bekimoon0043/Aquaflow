// Unit tests for the Equipment Dependency Graph (AQ-X-008).
// Covers the acceptance criteria via the pure builder + layout:
//   1. graph generated from system data (nodes/edges),
//   2. dependency conflicts flagged (address clash, missing dep, cycle, SPOF, orphan),
//   3. layout assigns drawable positions for the UI.
import { describe, it, expect } from 'vitest'
import {
  buildDependencyGraph, layoutGraph, deriveDeviceClass, LAYER,
} from '../dependencyGraph'

const types = (g) => new Set(g.conflicts.map((c) => c.type))

describe('deriveDeviceClass', () => {
  it('maps fixture types to control classes', () => {
    expect(deriveDeviceClass('light_rgb')).toBe('lighting')
    expect(deriveDeviceClass('center_jets')).toBe('pump')
    expect(deriveDeviceClass('flame_unit')).toBe('flame')
    expect(deriveDeviceClass('laser')).toBe('laser')
    expect(deriveDeviceClass('mystery')).toBe('aux')
  })
})

describe('buildDependencyGraph — generation', () => {
  it('builds fixture, group and controller nodes with edges', () => {
    const g = buildDependencyGraph([
      { id: 'jet-1', type: 'center_jets', groupId: 'jets', engineering: { plcHost: '10.0.0.5' } },
      { id: 'rgb-1', type: 'light_rgb', groupId: 'lights', universe: 1, channel: 1 },
    ])
    const ids = new Set(g.nodes.map((n) => n.id))
    for (const id of ['jet-1', 'rgb-1', 'group:jets', 'group:lights', 'plc:10.0.0.5', 'universe:1'])
      expect(ids.has(id)).toBe(true)
    expect(g.stats.fixtureCount).toBe(2)
    expect(g.stats.controllerCount).toBe(2)
    expect(g.edges.some((e) => e.from === 'jet-1' && e.to === 'plc:10.0.0.5' && e.kind === 'controlled_by')).toBe(true)
    expect(g.edges.some((e) => e.from === 'rgb-1' && e.to === 'group:lights' && e.kind === 'member_of')).toBe(true)
  })

  it('assigns layers for layout', () => {
    const g = buildDependencyGraph([{ id: 'j', type: 'center_jets', groupId: 'g', engineering: { plcHost: 'h' } }])
    const byKind = Object.fromEntries(g.nodes.map((n) => [n.kind, n.layer]))
    expect(byKind.plc).toBe(LAYER.plc)
    expect(byKind.group).toBe(LAYER.group)
    expect(byKind.fixture).toBe(LAYER.fixture)
  })

  it('is safe on empty input', () => {
    const g = buildDependencyGraph([])
    expect(g.nodes).toEqual([])
    expect(g.conflicts).toEqual([])
  })

  it('a clean design has no conflicts', () => {
    const g = buildDependencyGraph([
      { id: 'a', type: 'light_rgb', universe: 1, channel: 1 },
      { id: 'b', type: 'light_rgb', universe: 1, channel: 5 },
    ])
    expect(g.conflicts).toEqual([])
  })
})

describe('buildDependencyGraph — conflicts', () => {
  it('flags a duplicate DMX address', () => {
    const g = buildDependencyGraph([
      { id: 'a', type: 'light_rgb', universe: 1, channel: 1 },
      { id: 'b', type: 'light_rgb', universe: 1, channel: 1 },
    ])
    expect(types(g).has('address_conflict')).toBe(true)
    const c = g.conflicts.find((x) => x.type === 'address_conflict')
    expect(new Set(c.nodes)).toEqual(new Set(['a', 'b']))
  })

  it('flags a duplicate Modbus register', () => {
    const g = buildDependencyGraph([
      { id: 'p1', type: 'pump', engineering: { plcHost: 'h' }, register: 10 },
      { id: 'p2', type: 'pump', engineering: { plcHost: 'h' }, register: 10 },
    ])
    expect(types(g).has('address_conflict')).toBe(true)
  })

  it('flags a missing dependency', () => {
    const g = buildDependencyGraph([{ id: 'p2', type: 'pump', dependsOn: ['ghost'] }])
    expect(types(g).has('missing_dependency')).toBe(true)
  })

  it('flags a circular dependency', () => {
    const g = buildDependencyGraph([
      { id: 'a', type: 'pump', dependsOn: ['b'] },
      { id: 'b', type: 'pump', dependsOn: ['c'] },
      { id: 'c', type: 'pump', dependsOn: ['a'] },
    ])
    expect(types(g).has('cycle')).toBe(true)
    const cyc = g.conflicts.find((x) => x.type === 'cycle')
    expect(new Set(cyc.nodes)).toEqual(new Set(['a', 'b', 'c']))
  })

  it('does not flag a valid DAG as a cycle', () => {
    const g = buildDependencyGraph([
      { id: 'a', type: 'pump', dependsOn: ['b', 'c'] },
      { id: 'b', type: 'pump', dependsOn: ['c'] },
      { id: 'c', type: 'pump' },
    ])
    expect(types(g).has('cycle')).toBe(false)
  })

  it('flags a single point of failure', () => {
    const g = buildDependencyGraph(
      [0, 1, 2].map((i) => ({ id: `j${i}`, type: 'center_jets', engineering: { plcHost: 'shared' } })),
    )
    expect(types(g).has('single_point_of_failure')).toBe(true)
    expect(g.conflicts.find((c) => c.type === 'single_point_of_failure').severity).toBe('warning')
  })

  it('respects the SPOF threshold', () => {
    const g = buildDependencyGraph([
      { id: 'j1', type: 'center_jets', engineering: { plcHost: 'h' } },
      { id: 'j2', type: 'center_jets', engineering: { plcHost: 'h' } },
    ], 3)
    expect(types(g).has('single_point_of_failure')).toBe(false)
  })

  it('flags an orphan fixture', () => {
    const g = buildDependencyGraph([{ id: 'widget', type: 'totally_unknown' }])
    expect(types(g).has('orphan')).toBe(true)
  })
})

describe('layoutGraph', () => {
  it('assigns x/y positions and marks conflict nodes', () => {
    const g = buildDependencyGraph([
      { id: 'a', type: 'light_rgb', universe: 1, channel: 1 },
      { id: 'b', type: 'light_rgb', universe: 1, channel: 1 },
    ])
    const laid = layoutGraph(g)
    expect(laid.nodes.every((n) => typeof n.x === 'number' && typeof n.y === 'number')).toBe(true)
    expect(laid.height).toBeGreaterThan(0)
    // both conflicting fixtures are flagged for red highlighting
    expect(laid.nodes.filter((n) => n.hasConflict).map((n) => n.id).sort()).toContain('a')
    // controllers (layer 0) sit above fixtures (layer 2)
    const uni = laid.nodes.find((n) => n.kind === 'universe')
    const fix = laid.nodes.find((n) => n.kind === 'fixture')
    expect(uni.y).toBeLessThan(fix.y)
  })
})
