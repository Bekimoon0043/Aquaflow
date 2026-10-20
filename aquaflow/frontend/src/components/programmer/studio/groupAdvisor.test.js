import { describe, it, expect } from 'vitest';
import { conflictSummary, groupConflicts } from './groupAdvisor';

// 12 jets around a ring on 2 pumps (P1: jets 0–5, P2: jets 6–11), like a small Lebu.
const jets = Array.from({ length: 12 }, (_, i) => `j${i}`);
const design = {
  nozzleById: new Map(jets.map((id, i) => [id, { id, pumpId: i < 6 ? 'p1' : 'p2' }])),
  pumps: new Map([['p1', { id: 'p1', name: 'Pump 1', item: { engineering: { controlType: 'VFD' } } }], ['p2', { id: 'p2', name: 'Pump 2', item: {} }]]),
};
const group = (id, pick) => ({ id, name: id, memberFixtureIds: jets.filter((_, i) => pick(i)) });
const G1 = group('G1', (i) => i % 2 === 0), G2 = group('G2', (i) => i % 2 === 1);
const G3 = group('G3', (i) => Math.floor(i / 3) % 2 === 0), G4 = group('G4', (i) => Math.floor(i / 3) % 2 === 1);
const membersOf = (g) => g.memberFixtureIds;
const play = (groupId, start, duration) => ({ groupId, start, duration, muted: false });
const whole = (...ids) => ids.map((id) => play(id, 0, 120));

describe('group advisor', () => {
  it('finds the Lebu pattern: alternate groups overlap and every group shares the pumps', () => {
    const c = groupConflicts({ groups: [G1, G2, G3, G4], membersOf, design, recipes: whole('G1', 'G2', 'G3', 'G4') });
    expect(c).toHaveLength(6);
    const g13 = c.find((x) => x.a === 'G1' && x.b === 'G3');
    expect(g13.sharedJets).toBe(4);                      // G1 = even jets, G3 = 0,1,2,6,7,8 → 0, 2, 6, 8
    expect(g13.sharedPumps.map((p) => p.name)).toEqual(['Pump 1', 'Pump 2']);
    expect(g13.together).toBe(120);
    expect(g13.text).toMatch(/G1 and G3 share 4 jets and 2 pumps \(Pump 1 and Pump 2\), and they play together for 2:00/);
    expect(g13.fix).toMatch(/make the groups separate.*own pump with a VFD/);
    // G1 / G2 have no jet in common but share both pumps: heights cannot differ.
    const g12 = c.find((x) => x.a === 'G1' && x.b === 'G2');
    expect(g12.sharedJets).toBe(0);
    expect(g12.text).toMatch(/cannot show different heights/);
    expect(g12.fix).not.toMatch(/separate/);
    // Jet overlaps come first.
    expect(c[0].sharedJets).toBeGreaterThan(0);
  });

  it('says nothing when each group has its own jets and its own pump', () => {
    const left = group('Left', (i) => i < 6), right = group('Right', (i) => i >= 6);
    expect(groupConflicts({ groups: [left, right], membersOf, design, recipes: whole('Left', 'Right') })).toEqual([]);
  });

  it('skips a group inside another (All jets and one side) and folders with their children', () => {
    const all = group('All', () => true), left = group('Left', (i) => i < 6);
    expect(groupConflicts({ groups: [all, left], membersOf, design, recipes: whole('All', 'Left') })).toEqual([]);
    const folder = { ...group('Folder', (i) => i < 8) }, child = { ...group('Child', (i) => i > 4), parentId: 'Folder' };
    expect(groupConflicts({ groups: [folder, child], membersOf, design, recipes: whole('Folder', 'Child') })).toEqual([]);
  });

  it('only counts groups that play at the same time, unless both follow the music', () => {
    const turns = [play('G1', 0, 15), play('G3', 15, 15)];
    expect(groupConflicts({ groups: [G1, G3], membersOf, design, recipes: turns })).toEqual([]);
    // Linked to stems → they will play together when the show is made from the music.
    expect(groupConflicts({ groups: [G1, G3], membersOf, design, recipes: turns, linked: ['G1', 'G3'] })).toHaveLength(1);
    // Muted patterns and groups without patterns do not count …
    expect(groupConflicts({ groups: [G1, G3], membersOf, design, recipes: [play('G1', 0, 30), { ...play('G3', 0, 30), muted: true }] })).toEqual([]);
    // … but a new group (focus) is checked against the groups that play.
    const c = groupConflicts({ groups: [G1, G2, G3], membersOf, design, recipes: whole('G1'), focus: ['G3'] });
    expect(c.map((x) => [x.a, x.b])).toEqual([['G1', 'G3']]);
    expect(c[0].together).toBeNull();
  });

  it('writes a one-line warning for the new group', () => {
    const c = groupConflicts({ groups: [G1, G2, G3], membersOf, design, recipes: whole('G1', 'G2'), focus: ['G3'] });
    const line = conflictSummary(c, 'G3');
    expect(line).toMatch(/This group shares jets with G1 and G2/);
    expect(conflictSummary([], 'G3')).toBe('');
  });
});
