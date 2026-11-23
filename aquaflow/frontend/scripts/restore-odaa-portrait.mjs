import fs from 'node:fs';
import { readZip, zipText, createZip } from '/src/utils/zipStore.js';
import { inventory } from '/src/components/programmer/studio/showModel.js';

const [targetPath, portraitPath, out] = process.argv.slice(2);
if (!targetPath || !portraitPath || !out) throw new Error('usage: restore-odaa-portrait.mjs <target.aquapkg> <portrait-source.aquapkg> <out.aquapkg>');
const read = file => JSON.parse(zipText(readZip(fs.readFileSync(file)).get('project.aqua')));
const target = read(targetPath), portraitSource = read(portraitPath);
const roles = ['faceLight', 'hairLight', 'starLight'];
const fixtures = target.engineering.fixtures.filter(f => !roles.includes(f.groupId));
const center = [35.0481, 14.1233], previousCenter = [0.4, -0.3], scale = 0.55;
const roleNames = { faceLight: 'Old Man portrait · restored green light only', hairLight: 'Oddaa hair · restored green light only', starLight: 'Portrait star · restored green light only' };
const counts = {};
for (const role of roles) {
  const originals = portraitSource.engineering.fixtures.filter(f => f.groupId === role);
  counts[role] = originals.length;
  originals.forEach((old, i) => {
    const { pairedNozzleId, ...engineering } = old.engineering || {};
    fixtures.push({ ...old, id: `restored-${role}-${String(i + 1).padStart(3, '0')}`,
      label: `${roleNames[role]} ${i + 1}`, x: center[0] + (old.x - previousCenter[0]) * scale,
      y: center[1] + (old.y - previousCenter[1]) * scale, z: 0, groupId: role,
      engineering: { ...engineering, pairedNozzleId: null, defaultColor: '#92ff9d', mountHeightM: 0,
        cadSource: 'Restored traced Old Man and Oddaa light-only artwork', designStatus: 'Light-only portrait — no water nozzles' } });
  });
}
target.engineering.fixtures = fixtures;
const allLightIds = fixtures.filter(f => f.type.startsWith('light_')).map(f => f.id);
for (const group of target.programmer.studio.groups) {
  if (roles.includes(group.id)) group.memberFixtureIds = fixtures.filter(f => f.groupId === group.id).map(f => f.id);
  if (group.id === 'allLights') group.memberFixtureIds = allLightIds;
  group.name = roleNames[group.id] || group.name;
}
target.engineering.groups = target.programmer.studio.groups.map(g => ({ id: `group-${g.id}`, uuid: `group-${g.id}`, owner: 'model', name: g.name, members: g.memberFixtureIds }));
target.timelineTracks = inventory(fixtures).flatMap(item => (item.tracks || []).map(track => ({ id: track.id, fixtureId: item.id, deviceId: item.id,
  label: `${item.label} · ${String(track.type).replaceAll('_', ' ')}`, type: track.type, color: track.color || '#65d9d0', muted: false, solo: false, clips: [] })));
const now = new Date().toISOString();
target.savedAt = now; target.project.modifiedAt = now;
const notes = `${target.engineering.name}\n\nPORTRAIT RESTORATION\nThe original traced Old Man and Oddaa artwork is restored as ${Object.values(counts).reduce((a, b) => a + b, 0)} green light-only fixtures at the DWG center (${center.join(', ')}). Previous portrait center (${previousCenter.join(', ')}) is mapped with uniform scale ${scale}, keeping the artwork inside the 5.5 m 1D circle. These are lights only, not water nozzles. The remaining DWG equipment and empty pattern timeline are unchanged.\n`;
const layout = JSON.parse(zipText(readZip(fs.readFileSync(targetPath)).get('dwg-layout.json')));
layout.portraitRestoration = { counts, center, previousCenter, scale, lightOnly: true };
fs.writeFileSync(out, createZip([{ name: 'project.aqua', data: JSON.stringify(target) }, { name: 'manifest.json', data: JSON.stringify(target.assetManifest, null, 2) },
  { name: 'design-notes.txt', data: notes }, { name: 'dwg-layout.json', data: JSON.stringify(layout) }]));
console.log(JSON.stringify({ out, fixtures: fixtures.length, portraitLights: counts, dmxLights: allLightIds.length, patterns: target.programmer.studio.recipes.length }, null, 2));
