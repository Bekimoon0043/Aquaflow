import fs from 'node:fs';
import { readZip, zipText, createZip } from '/src/utils/zipStore.js';
import { inventory } from '/src/components/programmer/studio/showModel.js';

const [srcPath, out] = process.argv.slice(2);
if (!srcPath || !out) throw new Error('usage: place-odaa-diagonal.mjs <design.aquapkg> <out.aquapkg>');
const source = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get('project.aqua')));
const layout = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get('dwg-layout.json')));
const originalStatus = {
  infinity: ['FC6 · exact 240-point infinity polyline', 'DWG-derived concept — verify drive and hydraulics'],
  'pillar-left': ['DWG pillar paths and cap circles', 'DWG-derived concept — verify nozzle model'],
  'pillar-right': ['DWG pillar paths and cap circles', 'DWG-derived concept — verify nozzle model'],
  rays: ['Expanded DWG straight-nozzle circle markers', 'DWG-derived concept — verify nozzle model'],
};
for (const fixture of source.engineering.fixtures) {
  const [cadSource, designStatus] = originalStatus[fixture.groupId] || [null, null];
  if (fixture.engineering.diagonalRainbow) {
    fixture.engineering.cadSource = cadSource;
    fixture.engineering.designStatus = designStatus;
  }
  delete fixture.engineering.diagonalRainbow;
  delete fixture.engineering.diagonalAngleDeg;
}
const fixtures = source.engineering.fixtures.filter(f => !/^diagonal-rainbow-/.test(f.id));
for (const [index, zone] of layout.diagonalRainbowZones.entries()) {
  const number = index + 1, id = `diagonal-rainbow-${String(number).padStart(2, '0')}`, [x, y] = zone.center;
  fixtures.push({ id, type: 'nozzle_straight_dn15', label: `Diagonal Rainbow nozzle ${number} · blue box ${zone.id}`,
    x, y, z: 0, rotation: -45, visible: true, groupId: 'diagonalRainbow',
    engineering: { jetHeightM: 4, diagonalRainbow: true, diagonalAngleDeg: -45,
      cadSource: `Blue rectangle ${zone.id} center · exact CAD placement`, designStatus: 'Exact blue-box center — verify diagonal nozzle model and splash containment' } });
  fixtures.push({ id: `${id}-light`, type: 'light_uw_rgb_36w', label: `Diagonal Rainbow nozzle ${number} · DMX light`,
    x, y, z: 0, rotation: -45, visible: true, groupId: 'diagonalRainbowLight',
    engineering: { pairedNozzleId: id, defaultColor: '#ff66cc', beamAngleDeg: 35, designStatus: 'Diagonal Rainbow paired light' } });
}
source.engineering.fixtures = fixtures;
const groups = source.programmer.studio.groups.filter(g => !['diagonalRainbow', 'diagonalRainbowLight', 'allLights'].includes(g.id)
  && !/^diagonalRainbow-\d+(Light)?$/.test(g.id));
const zoneIds = layout.diagonalRainbowZones.map((_, i) => `diagonal-rainbow-${String(i + 1).padStart(2, '0')}`);
groups.push({ id: 'diagonalRainbow', name: 'Six Diagonal Rainbow nozzles · exact blue-box centers', memberFixtureIds: zoneIds,
  orderMode: 'engineering', color: '#ff66cc', muted: false, solo: false });
groups.push({ id: 'diagonalRainbowLight', name: 'Six Diagonal Rainbow · DMX lights', memberFixtureIds: zoneIds.map(id => `${id}-light`),
  orderMode: 'engineering', color: '#ff66cc', muted: false, solo: false });
for (const [index, id] of zoneIds.entries()) {
  groups.push({ id: `diagonalRainbow-${index + 1}`, name: `Diagonal Rainbow zone ${index + 1} · exact center`,
    memberFixtureIds: [id], orderMode: 'engineering', color: '#ff66cc', muted: false, solo: false });
}
const allLightIds = fixtures.filter(f => f.type.startsWith('light_')).map(f => f.id);
groups.push({ id: 'allLights', name: 'All integrated DMX lights', memberFixtureIds: allLightIds, orderMode: 'engineering', color: '#92ff9d', muted: false, solo: false });
source.programmer.studio.groups = groups;
source.engineering.groups = groups.map(g => ({ id: `group-${g.id}`, uuid: `group-${g.id}`, owner: 'model', name: g.name, members: g.memberFixtureIds }));
source.timelineTracks = inventory(fixtures).flatMap(item => (item.tracks || []).map(track => ({ id: track.id, fixtureId: item.id, deviceId: item.id,
  label: `${item.label} · ${String(track.type).replaceAll('_', ' ')}`, type: track.type, color: track.color || '#65d9d0', muted: false, solo: false, clips: [] })));
source.savedAt = new Date().toISOString(); source.project.modifiedAt = source.savedAt;
layout.diagonalRainbow = layout.diagonalRainbowZones.map((zone, i) => ({ zone: zone.id, fixtureId: zoneIds[i], lightId: `${zoneIds[i]}-light`, x: zone.center[0], y: zone.center[1] }));
fs.writeFileSync(out, createZip([{ name: 'project.aqua', data: JSON.stringify(source) }, { name: 'manifest.json', data: JSON.stringify(source.assetManifest, null, 2) },
  { name: 'design-notes.txt', data: `${zipText(readZip(fs.readFileSync(srcPath)).get('design-notes.txt'))}\n\nEXACT DIAGONAL NOZZLE PLACEMENT\nExactly one Diagonal Rainbow nozzle and one paired DMX light are placed at each of the six blue-box centers. These are new explicit fixtures; the nearest-nozzle placeholders were retired. The three air blasts remain at their cyan-circle positions: left/right 20 m and center 50 m.\n` },
  { name: 'dwg-layout.json', data: JSON.stringify(layout) }]));
console.log(JSON.stringify({ out, fixtures: fixtures.length, lights: allLightIds.length,
  diagonal: layout.diagonalRainbow, air: [layout.air20, layout.air50], patterns: source.programmer.studio.recipes.length }, null, 2));
