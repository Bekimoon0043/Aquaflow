import fs from 'node:fs';
import { readZip, zipText, createZip } from '/src/utils/zipStore.js';
import { inventory } from '/src/components/programmer/studio/showModel.js';

const [srcPath, out] = process.argv.slice(2);
if (!srcPath || !out) throw new Error('usage: circle-odaa-air.mjs <design.aquapkg> <out.aquapkg>');
const source = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get('project.aqua')));
const layout = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get('dwg-layout.json')));
const radius = 3.3659039959622876, count = 5, r4 = v => Math.round(v * 10000) / 10000;
const definitions = [
  { key: 'left', center: layout.air20[0], height: 20, type: 'nozzle_air_shooter_24e_30m_oase' },
  { key: 'right', center: layout.air20[1], height: 20, type: 'nozzle_air_shooter_24e_30m_oase' },
  { key: 'center', center: layout.air50[0], height: 50, type: 'nozzle_air_shooter_50e_50m_oase' },
];
const fixtures = source.engineering.fixtures.filter(f => !f.id.startsWith('air-'));
const circles = [];
for (const definition of definitions) {
  const members = [];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + i / count * 2 * Math.PI;
    const x = r4(definition.center[0] + radius * Math.cos(angle)), y = r4(definition.center[1] + radius * Math.sin(angle));
    const id = `air-${definition.height}m-${definition.key}-${String(i + 1).padStart(2, '0')}`;
    members.push({ id, x, y });
    fixtures.push({ id, type: definition.type, label: `${definition.key} ${definition.height} m air blast ${i + 1} of 5`,
      x, y, z: 0, rotation: 0, visible: true, groupId: 'compressors',
      engineering: { jetHeightM: definition.height, cadSource: `${definition.key} cyan circle · five-nozzle circular array`,
        designStatus: `${definition.height} m circular air-blast concept — verify plant, refill and splash containment` } });
    fixtures.push({ id: `${id}-light`, type: 'light_uw_rgb_36w', label: `${definition.key} ${definition.height} m air-blast light ${i + 1}`,
      x, y, z: 0, rotation: 0, visible: true, groupId: 'compressorsLight',
      engineering: { pairedNozzleId: id, defaultColor: '#38c8ff', beamAngleDeg: 40, designStatus: 'Circular air-blast paired light' } });
  }
  circles.push({ ...definition, radius, members });
}
source.engineering.fixtures = fixtures;
const groups = source.programmer.studio.groups.filter(g => !['compressors', 'compressorsLight', 'allLights', 'air20', 'air20Light', 'air50', 'air50Light', 'air20Left', 'air20Right', 'air50Center'].includes(g.id)
  && !/^air(20|50)-/.test(g.id));
for (const circle of circles) {
  const role = circle.key === 'left' ? 'air20Left' : circle.key === 'right' ? 'air20Right' : 'air50Center';
  groups.push({ id: role, name: `${circle.key} circle · five ${circle.height} m air blasts`, memberFixtureIds: circle.members.map(m => m.id),
    orderMode: 'clockwise', color: '#38c8ff', muted: false, solo: false });
  groups.push({ id: `${role}Light`, name: `${circle.key} circle · DMX lights`, memberFixtureIds: circle.members.map(m => `${m.id}-light`),
    orderMode: 'clockwise', color: '#38c8ff', muted: false, solo: false });
  for (const [index, member] of circle.members.entries()) {
    groups.push({ id: `air${circle.height}-${circle.key}-${index + 1}`, name: `${circle.key} ${circle.height} m · cannon ${index + 1}`,
      memberFixtureIds: [member.id], orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
    groups.push({ id: `air${circle.height}-${circle.key}-${index + 1}Light`, name: `${circle.key} ${circle.height} m · cannon ${index + 1} light`,
      memberFixtureIds: [`${member.id}-light`], orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
  }
}
const leftRightIds = circles.filter(c => c.height === 20).flatMap(c => c.members.map(m => m.id)), centerIds = circles.find(c => c.height === 50).members.map(m => m.id);
groups.push({ id: 'air20', name: 'Ten outer 20 m air blasts · two circles of five', memberFixtureIds: leftRightIds, orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
groups.push({ id: 'air20Light', name: 'Ten outer 20 m air-blast lights', memberFixtureIds: leftRightIds.map(id => `${id}-light`), orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
groups.push({ id: 'air50', name: 'Five center 50 m air blasts · one circle of five', memberFixtureIds: centerIds, orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
groups.push({ id: 'air50Light', name: 'Five center 50 m air-blast lights', memberFixtureIds: centerIds.map(id => `${id}-light`), orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
groups.push({ id: 'compressors', name: 'Fifteen circular air blasts · 10 × 20 m + 5 × 50 m', memberFixtureIds: [...leftRightIds, ...centerIds], orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
groups.push({ id: 'compressorsLight', name: 'Fifteen circular air-blast DMX lights', memberFixtureIds: [...leftRightIds, ...centerIds].map(id => `${id}-light`), orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
const allLightIds = fixtures.filter(f => f.type.startsWith('light_')).map(f => f.id);
groups.push({ id: 'allLights', name: 'All integrated DMX lights', memberFixtureIds: allLightIds, orderMode: 'engineering', color: '#92ff9d', muted: false, solo: false });
source.programmer.studio.groups = groups;
source.engineering.groups = groups.map(g => ({ id: `group-${g.id}`, uuid: `group-${g.id}`, owner: 'model', name: g.name, members: g.memberFixtureIds }));
source.engineering.guidePaths = [...(source.engineering.guidePaths || []).filter(g => !g.id.startsWith('guide-air-circle')),
  ...circles.map(circle => ({ id: `guide-air-circle-${circle.key}`, name: `${circle.key} air-blast circle · five nozzles`, closed: true, visible: true,
    color: '#38c8ff', points: Array.from({ length: 65 }, (_, i) => ({ x: circle.center[0] + circle.radius * Math.cos(i / 64 * 2 * Math.PI),
      y: circle.center[1] + circle.radius * Math.sin(i / 64 * 2 * Math.PI) })) }))];
source.timelineTracks = inventory(fixtures).flatMap(item => (item.tracks || []).map(track => ({ id: track.id, fixtureId: item.id, deviceId: item.id,
  label: `${item.label} · ${String(track.type).replaceAll('_', ' ')}`, type: track.type, color: track.color || '#65d9d0', muted: false, solo: false, clips: [] })));
source.savedAt = new Date().toISOString(); source.project.modifiedAt = source.savedAt;
layout.airBlastCircles = circles;
layout.air20 = circles.filter(c => c.height === 20).flatMap(c => c.members.map(m => [m.x, m.y]));
layout.air50 = circles.find(c => c.height === 50).members.map(m => [m.x, m.y]);
fs.writeFileSync(out, createZip([{ name: 'project.aqua', data: JSON.stringify(source) }, { name: 'manifest.json', data: JSON.stringify(source.assetManifest, null, 2) },
  { name: 'design-notes.txt', data: `${zipText(readZip(fs.readFileSync(srcPath)).get('design-notes.txt'))}\n\nFIVE-NOZZLE AIR-BLAST CIRCLES\nEach of the three cyan-circle air-blast areas now contains exactly five nozzles at radius ${radius} m: 5 × 20 m left, 5 × 20 m right and 5 × 50 m center. Every nozzle has a paired DMX light. Circular arrays are editable groups and no choreography has been added.\n` },
  { name: 'dwg-layout.json', data: JSON.stringify(layout) }]));
console.log(JSON.stringify({ out, fixtures: fixtures.length, lights: allLightIds.length,
  circles: circles.map(c => ({ key: c.key, height: c.height, radius: c.radius, members: c.members.length })),
  patterns: source.programmer.studio.recipes.length }, null, 2));
