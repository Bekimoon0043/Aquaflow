import fs from 'node:fs';
import { readZip, zipText, createZip } from '/src/utils/zipStore.js';
import { inventory } from '/src/components/programmer/studio/showModel.js';

const [srcPath, out] = process.argv.slice(2);
if (!srcPath || !out) throw new Error('usage: fix-odaa-rainbow-air.mjs <design.aquapkg> <out.aquapkg>');
const source = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get('project.aqua')));
const fixtures = source.engineering.fixtures.filter(f => !f.id.startsWith('air-'));
for (const fixture of fixtures) {
  delete fixture.engineering.diagonalRainbow;
  delete fixture.engineering.diagonalAngleDeg;
}
const zones = [
  { id: '6E12', points: [[9.099,8.256],[4.785,8.139],[4.813,7.101],[9.128,7.219],[9.099,8.256]], center: [6.942,7.779] },
  { id: '6E13', points: [[21.289,8.389],[16.975,8.271],[17.003,7.234],[21.317,7.351],[21.289,8.389]], center: [19.132,7.812] },
  { id: '6E14', points: [[31.882,8.438],[27.568,8.32],[27.596,7.283],[31.91,7.4],[31.882,8.438]], center: [29.725,7.919] },
  { id: '6E11', points: [[35.844,8.492],[40.16,8.492],[40.16,7.454],[35.844,7.454],[35.844,8.492]], center: [38.002,7.973] },
  { id: '6E10', points: [[46.435,8.732],[50.751,8.732],[50.751,7.694],[46.435,7.694],[46.435,8.732]], center: [48.593,8.213] },
  { id: '6E0F', points: [[58.624,8.931],[62.94,8.931],[62.94,7.893],[58.624,7.893],[58.624,8.931]], center: [60.782,8.412] },
];
const mapped = [];
for (const [index, zone] of zones.entries()) {
  const [x, y] = zone.center;
  const fixture = fixtures.filter(f => !f.type.startsWith('light_')).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
  fixture.engineering = { ...fixture.engineering, diagonalRainbow: true, diagonalAngleDeg: -45,
    cadSource: `Blue rectangle ${zone.id} · Diagonal Rainbow section`, designStatus: 'Diagonal Rainbow zone — original CAD nozzle position preserved' };
  mapped.push({ zone: zone.id, fixtureId: fixture.id, lightId: `${fixture.id}-light` });
}
const air = [
  { id: 'air-20m-1', type: 'nozzle_air_shooter_24e_30m_oase', height: 20, x: 20.4458, y: 11.6397, label: 'Left 20 m air blast' },
  { id: 'air-20m-2', type: 'nozzle_air_shooter_24e_30m_oase', height: 20, x: 50.0391, y: 12.0545, label: 'Right 20 m air blast' },
  { id: 'air-50m-1', type: 'nozzle_air_shooter_50e_50m_oase', height: 50, x: 35.2721, y: 12.4692, label: 'Center 50 m air blast' },
];
for (const item of air) {
  fixtures.push({ id: item.id, type: item.type, label: item.label, x: item.x, y: item.y, z: 0, rotation: 0, visible: true, groupId: 'compressors',
    engineering: { jetHeightM: item.height, cadSource: `${item.label} · cyan circle marker`, designStatus: `DWG ${item.height} m air blast — verify air plant and splash zone` } });
  fixtures.push({ id: `${item.id}-light`, type: 'light_uw_rgb_36w', label: `${item.label} · DMX light`, x: item.x, y: item.y, z: 0, rotation: 0, visible: true,
    groupId: 'compressorsLight', engineering: { pairedNozzleId: item.id, defaultColor: '#38c8ff', beamAngleDeg: 40, designStatus: 'Air-blast paired light' } });
}
source.engineering.fixtures = fixtures;
const groups = source.programmer.studio.groups.filter(g => !['diagonalRainbow', 'diagonalRainbowLight', 'compressors', 'compressorsLight', 'allLights', 'air20', 'air20Light', 'air50', 'air50Light'].includes(g.id)
  && !/^air20-[1-5](Light)?$/.test(g.id) && !/^air50-[AB](Light)?$/.test(g.id));
for (const [index, map] of mapped.entries()) {
  groups.push({ id: `diagonalRainbow-${index + 1}`, name: `Diagonal Rainbow zone ${index + 1} · blue CAD box ${map.zone}`,
    memberFixtureIds: [map.fixtureId], orderMode: 'engineering', color: '#ff66cc', muted: false, solo: false });
  groups.push({ id: `diagonalRainbow-${index + 1}Light`, name: `Diagonal Rainbow zone ${index + 1} · DMX light`,
    memberFixtureIds: [map.lightId], orderMode: 'engineering', color: '#ff66cc', muted: false, solo: false });
}
const air20Ids = ['air-20m-1', 'air-20m-2'], air50Ids = ['air-50m-1'];
groups.push({ id: 'air20', name: 'Two side 20 m air blasts', memberFixtureIds: air20Ids, orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
groups.push({ id: 'air20Light', name: 'Two side 20 m air-blast lights', memberFixtureIds: air20Ids.map(id => `${id}-light`), orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
groups.push({ id: 'air50', name: 'Center 50 m air blast', memberFixtureIds: air50Ids, orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
groups.push({ id: 'air50Light', name: 'Center 50 m air-blast light', memberFixtureIds: air50Ids.map(id => `${id}-light`), orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
groups.push({ id: 'compressors', name: 'Two side 20 m + center 50 m air blasts', memberFixtureIds: [...air20Ids, ...air50Ids], orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
groups.push({ id: 'compressorsLight', name: 'Air-blast DMX lights', memberFixtureIds: [...air20Ids, ...air50Ids].map(id => `${id}-light`), orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
for (const [index, id] of air20Ids.entries()) {
  groups.push({ id: `air20-${index + 1}`, name: `Side ${index + 1} · 20 m air blast`, memberFixtureIds: [id], orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
  groups.push({ id: `air20-${index + 1}Light`, name: `Side ${index + 1} · 20 m air-blast light`, memberFixtureIds: [`${id}-light`], orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
}
groups.push({ id: 'air50-A', name: 'Center · 50 m air blast', memberFixtureIds: air50Ids, orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
groups.push({ id: 'air50-ALight', name: 'Center · 50 m air-blast light', memberFixtureIds: air50Ids.map(id => `${id}-light`), orderMode: 'engineering', color: '#38c8ff', muted: false, solo: false });
const allLightIds = fixtures.filter(f => f.type.startsWith('light_')).map(f => f.id);
const allLights = groups.find(g => g.id === 'allLights');
if (allLights) allLights.memberFixtureIds = allLightIds;
source.programmer.studio.groups = groups;
source.engineering.groups = groups.map(g => ({ id: `group-${g.id}`, uuid: `group-${g.id}`, owner: 'model', name: g.name, members: g.memberFixtureIds }));
source.engineering.guidePaths = [...(source.engineering.guidePaths || []).filter(g => g.id !== 'guide-diagonalRainbow'),
  ...zones.map(zone => ({ id: `guide-diagonalRainbow-${zone.id}`, name: `Diagonal Rainbow · blue box ${zone.id}`, closed: true, visible: true,
    color: '#ff66cc', points: zone.points.map(([x, y]) => ({ x, y })) }))];
source.timelineTracks = inventory(fixtures).flatMap(item => (item.tracks || []).map(track => ({ id: track.id, fixtureId: item.id, deviceId: item.id,
  label: `${item.label} · ${String(track.type).replaceAll('_', ' ')}`, type: track.type, color: track.color || '#65d9d0', muted: false, solo: false, clips: [] })));
source.savedAt = new Date().toISOString(); source.project.modifiedAt = source.savedAt;
const layout = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get('dwg-layout.json')));
layout.diagonalRainbowZones = zones;
layout.air20 = air20Ids.map(id => air.find(a => a.id === id)).map(a => [a.x, a.y]);
layout.air50 = air50Ids.map(id => air.find(a => a.id === id)).map(a => [a.x, a.y]);
layout.diagonalRainbow = mapped;
fs.writeFileSync(out, createZip([{ name: 'project.aqua', data: JSON.stringify(source) }, { name: 'manifest.json', data: JSON.stringify(source.assetManifest, null, 2) },
  { name: 'design-notes.txt', data: `${zipText(readZip(fs.readFileSync(srcPath)).get('design-notes.txt'))}\n\nDIAGONAL RAINBOW AND AIR-BLAST CORRECTION\nSix blue CAD rectangles are retained as Diagonal Rainbow zone guides. Each is mapped to the nearest existing nozzle without moving it. Air blasts are exactly: left 20 m (${air[0].x}, ${air[0].y}), right 20 m (${air[1].x}, ${air[1].y}), center 50 m (${air[2].x}, ${air[2].y}). No other equipment was changed.\n` },
  { name: 'dwg-layout.json', data: JSON.stringify(layout) }]));
console.log(JSON.stringify({ out, fixtures: fixtures.length, lights: allLightIds.length, diagonalZones: mapped, air,
  groups: groups.length, patterns: source.programmer.studio.recipes.length }, null, 2));
