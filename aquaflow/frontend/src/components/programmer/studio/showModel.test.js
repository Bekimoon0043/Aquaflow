import { describe, it, expect } from 'vitest';
import { aiRecipes, autoGroups, compileStudio, copyStudioClips, envelopeValue, groupFlag, inventory, moveStudioClips, newRecipe, orderMembers, pasteStudioClips, readStudio, resolveMembers, sampleClips, snapBeat } from './showModel';
import { createFullShowPreview } from '../../../utils/fullShowPreview';
import { normalizeUnifiedProject } from '../../../store/projectStore';

const fixtures = Array.from({ length: 320 }, (_, i) => ({ id: `jet-${i}`, type: 'nozzle_geyser', label: `Jet ${i + 1}`, x: i % 32, y: Math.floor(i / 32), groupId: `ring-${i % 4}`, zone: 'Basin A' }));
const items = inventory(fixtures);
const group = { id: 'outer', name: 'Outer ring', memberFixtureIds: fixtures.map(f => f.id), orderMode: 'engineering' };
const studio = () => ({ ...readStudio(null), groups: [group], recipes: [newRecipe('outer')] });

describe('Show Studio Engineering and groups', () => {
  it('lists all 320 fixtures and scenery separately from programmable channels', () => {
    const all = inventory([...fixtures, { id: 'unknown', type: 'unrecognized-part-xyz' }], [{ id: 'tree', name: 'Tree' }]);
    expect(all).toHaveLength(322);
    expect(all.find(i => i.id === 'unknown').status).toBe('Needs mapping');
    expect(all.at(-1).tracks).toEqual([]);
    expect(items.every(i => i.tracks.length > 0)).toBe(true);
  });
  it('keeps automatic group identity and membership when Engineering grows', () => {
    const automatic = autoGroups(items)[0];
    const changed = inventory([...fixtures, { id: 'new', type: 'nozzle_geyser', groupId: 'ring-0' }]);
    expect(resolveMembers(automatic, changed)).toContain('new');
    expect(autoGroups(changed)[0].id).toBe(automatic.id);
  });
  it('supports spatial and explicit selection order', () => {
    const ordered = orderMembers(['jet-3', 'jet-1', 'jet-2'], items, 'left-to-right');
    expect(ordered.map(f => f.id)).toEqual(['jet-1', 'jet-2', 'jet-3']);
    expect(orderMembers(['jet-3', 'jet-1'], items).map(f => f.id)).toEqual(['jet-3', 'jet-1']);
    expect(orderMembers(group.memberFixtureIds, items, 'clockwise')).toHaveLength(320);
  });
});
describe('Recipe resolution and persistence', () => {
  it('resolves a wave to valid timed clips for every group member and actual 3D preview', () => {
    const result = compileStudio(studio(), items);
    expect(result.issues).toEqual([]);
    expect(result.clips).toHaveLength(640);
    expect(new Set(result.clips.map(c => c.fixtureId)).size).toBe(320);
    expect(() => createFullShowPreview(result.clips, fixtures)).not.toThrow();
    expect(Object.keys(sampleClips(result.clips, .5)).length).toBeGreaterThan(0);
    expect(Object.keys(sampleClips(result.clips, 9))).toHaveLength(0);
  });
  it('resolves all supported effects with values inside their duration', () => {
    for (const effect of ['wave', 'chase', 'ripple', 'pulse', 'static', 'staircase', 'sparkle', 'color', 'curve']) {
      const s = studio(); s.recipes[0].effect = effect;
      const result = compileStudio(s, items);
      expect(result.issues).toEqual([]);
      expect(result.clips.length).toBeGreaterThan(0);
      expect(result.clips.every(c => c.startTime >= 0 && c.startTime + c.duration <= 8.001)).toBe(true);
    }
  });
  it('freezes membership and reports deleted fixtures instead of remapping', () => {
    const s = studio(); s.groups = [autoGroups(items)[0]]; s.recipes[0].groupId = s.groups[0].id; s.recipes[0].frozenIds = ['jet-0'];
    expect(new Set(compileStudio(s, items).clips.map(c => c.fixtureId)).size).toBe(1);
    expect(compileStudio(s, items.slice(1)).issues.join(' ')).toContain('removed from Engineering');
  });
  it('inherits folder mute and solo', () => {
    const s = studio(); s.groups = [{ id: 'folder', muted: true }, { ...group, parentId: 'folder' }];
    expect(compileStudio(s, items).clips).toHaveLength(0);
    s.groups[0] = { id: 'folder', solo: true };
    expect(compileStudio(s, items).clips.length).toBeGreaterThan(0);
    s.groups.push({ id: 'other', solo: true }); s.groups[0].solo = false;
    expect(compileStudio(s, items).clips).toHaveLength(0);
  });
  it('inherits parent locks and tolerates damaged cyclic folder references', () => {
    expect(groupFlag([{ id: 'parent', locked: true }, { id: 'child', parentId: 'parent' }], 'child', 'locked')).toBe(true);
    expect(groupFlag([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }], 'a', 'locked')).toBe(false);
  });
  it('reports invalid recipes and unsupported attributes', () => {
    const s = studio(); s.recipes[0].duration = -4;
    expect(compileStudio(s, items).issues.length).toBe(1);
    s.recipes[0].duration = 8; s.recipes[0].attribute = 'lighting_red';
    expect(compileStudio(s, items).clips).toHaveLength(0);
    expect(compileStudio(s, items).issues[0]).toContain('no compatible');
  });
  it('migrates old programs without changing legacy clip values', () => {
    const old = { timelineClips: [{ id: 'original', fixtureId: 'jet-0', value: 73, duration: 2, startTime: 5 }], cues: [{ id: 'cue', time: 4 }] };
    const s = readStudio(old);
    expect(s.legacyClips).toEqual(old.timelineClips);
    expect(compileStudio(s, items).clips).toEqual(old.timelineClips);
    const reopened = normalizeUnifiedProject({ programmer: { ...old, studio: s } });
    expect(readStudio(reopened.programmer)).toEqual(s);
  });
  it('round trips groups and recipes with materialized clips without duplicating output', () => {
    const s = studio(), result = compileStudio(s, items);
    const saved = JSON.parse(JSON.stringify({ studio: s, timelineClips: result.clips }));
    expect(compileStudio(readStudio(saved), items).clips).toEqual(result.clips);
  });
  it('resolves 1,000 fixtures and stays deterministic', () => {
    const fx = Array.from({ length: 1000 }, (_, i) => ({ ...fixtures[0], id: `load-${i}`, x: i }));
    const s = studio(); s.groups[0] = { ...group, memberFixtureIds: fx.map(f => f.id) }; s.recipes[0].effect = 'sparkle';
    const result = compileStudio(s, inventory(fx));
    expect(result.clips).toHaveLength(2000);
    expect(compileStudio(s, inventory(fx))).toEqual(result);
  });
  it('converts an AI response into scoped editable recipes and rejects empty responses', () => {
    const result = aiRecipes({ analysis: { sections: [{ start: 0, end: 10, label: 'Opening', energy: .5 }] } }, 'outer', 'blue radial ripple', 4, 8);
    expect(result[0]).toMatchObject({ groupId: 'outer', start: 4, duration: 8, effect: 'ripple', color: '#529bff' });
    expect(() => aiRecipes({}, 'outer', 'wave', 0, 10)).toThrow();
  });
  it('interpolates custom envelopes and validates invalid keyframes', () => {
    expect(envelopeValue(undefined, .25)).toBe(.5);
    expect(envelopeValue([{ time: 0, value: .2 }, { time: 1, value: .8 }], .5)).toBeCloseTo(.5);
    const s = studio(); s.recipes[0].effect = 'curve'; s.recipes[0].spread = 0;
    s.recipes[0].envelope = [{ time: 0, value: .5 }, { time: 1, value: .5 }];
    const result = compileStudio(s, items);
    expect(result.clips.every(c => c.value === 40)).toBe(true);
    expect(() => createFullShowPreview(result.clips, fixtures)).not.toThrow();
    s.recipes[0].envelope[1].time = 0;
    expect(compileStudio(s, items).issues[0]).toContain('increasing times');
  });
  it('snaps sixteenth notes to the active tempo section', () => {
    expect(snapBeat(.14)).toBe(.125);
    const tempo = [{ time: 10, bpm: 60 }, { time: 0, bpm: 120 }];
    expect(snapBeat(10.14, tempo)).toBe(10.25);
    expect(snapBeat(9.14, tempo)).toBe(9.125);
    expect(snapBeat(1.14, [{ time: 0, bpm: 0 }])).toBe(1.125);
  });
  it('moves selected mixed clips together and clamps against the show bounds', () => {
    const s = studio(); s.recipes[0].start = 2;
    s.legacyClips = [{ id: 'old', startTime: 5, duration: 1 }];
    const ids = [s.recipes[0].id, 'old'];
    const moved = moveStudioClips(s, ids, -10);
    expect(moved.recipes[0].start).toBe(0); expect(moved.legacyClips[0].startTime).toBe(3);
    expect(s.recipes[0].start).toBe(2);
    s.groups[0] = { ...s.groups[0], locked: true };
    expect(moveStudioClips(s, ids, 10).recipes[0].start).toBe(2);
  });
  it('copies and pastes selections with independent IDs and relative timing', () => {
    const s = studio(); s.recipes.push({ ...newRecipe('outer'), start: 10 });
    const source = copyStudioClips(s, s.recipes.map(r => r.id));
    const result = pasteStudioClips(s, source, 20);
    expect(result.studio.recipes.slice(2).map(r => r.start)).toEqual([20, 30]);
    expect(new Set(result.studio.recipes.map(r => r.id)).size).toBe(4);
    expect(result.selectedIds).toHaveLength(2);
    s.groups[0] = { ...s.groups[0], locked: true };
    expect(pasteStudioClips(s, source, 0).selectedIds).toHaveLength(0);
  });
});
