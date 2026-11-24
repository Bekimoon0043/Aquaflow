import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP_COLOR, clipTooltip, countLabel, hashString, memberNoun, ownerColor, ownerLabel,
  ownerOfBlock, ownerOfClip, ownerOfLegacyClip, ownerOfRecipe, ownershipIndex, ownerSummary, stickyOffset,
} from './timelineOwnership';

const items = [
  ...Array.from({ length: 24 }, (_, i) => ({ id: `jet-${i}`, label: `Jet ${i}`, type: 'nozzle_straight_dn25', groupId: 'inner_ring' })),
  { id: 'lamp-1', label: 'Lamp 1', type: 'light_uw_rgb_18w', groupId: 'inner_ring' },
  { id: 'pump-1', label: 'Main pump', type: 'pump_vfd_15kw' },
];
const studio = {
  groups: [
    { id: 'g-arc', name: 'Blue arc inner', memberFixtureIds: items.slice(0, 24).map(i => i.id), color: '#ff8800' },
    { id: 'g-default', name: 'Default colour', memberFixtureIds: ['lamp-1'], color: DEFAULT_GROUP_COLOR },
  ],
  recipes: [], legacyClips: [],
};

describe('timeline ownership helpers', () => {
  it('hashes deterministically', () => {
    expect(hashString('g-arc')).toBe(hashString('g-arc'));
    expect(hashString('g-arc')).not.toBe(hashString('g-arc2'));
  });

  it('uses a chosen group colour, else a stable id-derived colour', () => {
    expect(ownerColor('g-arc', '#ff8800')).toBe('#ff8800');
    const derived = ownerColor('g-default', DEFAULT_GROUP_COLOR);
    expect(derived).toMatch(/^hsl\(\d+ 62% 60%\)$/);
    expect(ownerColor('g-default')).toBe(derived);
    expect(ownerColor('another-group')).not.toBe(derived);
    expect(ownerColor('x', 'not a colour')).toMatch(/^hsl/);
  });

  it('names members by kind and counts them', () => {
    expect(memberNoun(['jet-1', 'jet-2'], items)).toBe('jet');
    expect(memberNoun(['lamp-1'], items)).toBe('light');
    expect(memberNoun(['jet-1', 'lamp-1'], items)).toBe('device');
    expect(countLabel(24, 'jet')).toBe('24 jets');
    expect(countLabel(1, 'jet')).toBe('1 jet');
  });

  it('resolves a recipe to its group with member count', () => {
    const index = ownershipIndex(studio, items);
    const owner = ownerOfRecipe({ groupId: 'g-arc' }, index);
    expect(owner).toMatchObject({ kind: 'group', name: 'Blue arc inner', color: '#ff8800', count: 24, noun: 'jet' });
    expect(ownerSummary(owner)).toBe('Group · 24 jets');
    expect(ownerLabel(owner)).toBe('Blue arc inner');
    expect(ownerOfClip({ groupId: 'g-arc', start: 0 }, index).name).toBe('Blue arc inner');
  });

  it('resolves automatic engineering groups and missing groups', () => {
    const index = ownershipIndex(studio, items);
    const auto = index.group('auto:groupId:inner_ring');
    expect(auto).toMatchObject({ kind: 'group', name: 'inner ring', count: 25, noun: 'device', auto: true });
    expect(ownerSummary(auto)).toBe('Auto group · 25 devices');
    expect(index.group('gone')).toMatchObject({ name: 'Missing group', missing: true });
  });

  it('resolves a legacy clip to its fixture and channel', () => {
    const index = ownershipIndex(studio, items);
    const owner = ownerOfLegacyClip({ fixtureId: 'pump-1', type: 'pump_speed' }, index);
    expect(owner).toMatchObject({ kind: 'item', name: 'Main pump', channel: 'Speed', noun: 'pump' });
    expect(ownerLabel(owner)).toBe('Main pump · Speed');
    expect(ownerSummary(owner)).toBe('Item · Speed');
    expect(ownerOfClip({ fixtureId: 'pump-1', type: 'pump_speed', startTime: 0 }, index).name).toBe('Main pump');
  });

  it('resolves 3D sequence blocks (water + separate lights group, recorded cues)', () => {
    const index = ownershipIndex(studio, items);
    const block = { type: 'field', water: { groupId: 'g-arc' }, lights: { groupId: 'g-default' } };
    const owner = ownerOfBlock(block, index);
    expect(owner.name).toBe('Blue arc inner');
    expect(owner.also.name).toBe('Default colour');
    const legacy = [{ id: 'c1', fixtureId: 'jet-1' }, { id: 'c2', fixtureId: 'jet-2' }, { id: 'c3', fixtureId: 'jet-2' }];
    expect(ownerOfBlock({ type: 'recorded', legacyIds: ['c2', 'c3'] }, index, legacy)).toMatchObject({ kind: 'item', name: 'Jet 2' });
    expect(ownerOfBlock({ type: 'recorded', id: 'r', legacyIds: ['c1', 'c2'] }, index, legacy)).toMatchObject({ kind: 'items', name: '2 jets' });
  });

  it('builds a hover card text with owner, pattern, time span and level', () => {
    const owner = ownershipIndex(studio, items).group('g-arc');
    expect(clipTooltip({ owner, name: 'Blue inner rises', kind: 'wave', start: 4, duration: 6.5, level: 80 }).split('\n')).toEqual([
      'Blue arc inner — Group · 24 jets', 'Pattern: Blue inner rises (wave)', '4 s – 10.5 s (6.5 s)', 'Level 80%',
    ]);
    expect(ownerSummary({ kind: 'track', name: 'Pump A', channel: 'pump_speed' })).toBe('Track · pump_speed');
  });

  it('computes sticky label offsets', () => {
    expect(stickyOffset(300, 400, 200)).toBe(0);    // clip starts in view
    expect(stickyOffset(100, 400, 250)).toBe(150);  // pinned to the view's left edge
    expect(stickyOffset(100, 120, 400)).toBe(72);   // never past the clip end (reserve 48)
  });
});
