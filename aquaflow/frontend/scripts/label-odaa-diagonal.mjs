import fs from 'node:fs';
import { readZip, zipText, createZip } from '/src/utils/zipStore.js';

const [srcPath, out] = process.argv.slice(2);
if (!srcPath || !out) throw new Error('usage: label-odaa-diagonal.mjs <design.aquapkg> <out.aquapkg>');
const source = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get('project.aqua')));
const targets = [
  { x: 5.778, y: 7.088, role: 'infinity', label: 'Left diagonal Rainbow leader' },
  { x: 18.904, y: 7.191, role: 'pillar-left', label: 'Pillar diagonal Rainbow leader' },
  { x: 29.569, y: 7.191, role: 'rays', label: 'Central diagonal Rainbow leader' },
];
const mapped = [];
for (const target of targets) {
  const candidates = source.engineering.fixtures.filter(f => f.groupId === target.role);
  const fixture = candidates.sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))[0];
  if (!fixture) throw new Error(`No nozzle found for ${target.label}`);
  fixture.engineering = { ...fixture.engineering, diagonalRainbow: true, diagonalAngleDeg: -45,
    cadSource: `${target.label} · nearest existing nozzle to annotation target`, designStatus: 'Diagonal Rainbow nozzle group — original CAD position preserved' };
  mapped.push({ target, fixtureId: fixture.id, lightId: `${fixture.id}-light`, x: fixture.x, y: fixture.y });
}
const groups = source.programmer.studio.groups;
if (!groups.some(g => g.id === 'diagonalRainbow')) {
  groups.push({ id: 'diagonalRainbow', name: 'Diagonal Rainbow nozzles · three CAD leaders', memberFixtureIds: mapped.map(m => m.fixtureId), orderMode: 'engineering', color: '#ff66cc', muted: false, solo: false });
  groups.push({ id: 'diagonalRainbowLight', name: 'Diagonal Rainbow · DMX lights', memberFixtureIds: mapped.map(m => m.lightId), orderMode: 'engineering', color: '#ff66cc', muted: false, solo: false });
}
source.engineering.groups = groups.map(g => ({ id: `group-${g.id}`, uuid: `group-${g.id}`, owner: 'model', name: g.name, members: g.memberFixtureIds }));
source.engineering.guidePaths = [...(source.engineering.guidePaths || []).filter(g => g.id !== 'guide-diagonalRainbow'),
  { id: 'guide-diagonalRainbow', name: 'Diagonal Rainbow · three annotated positions', closed: false, visible: true, color: '#ff66cc', points: mapped.map(m => ({ x: m.x, y: m.y })) }];
source.savedAt = new Date().toISOString(); source.project.modifiedAt = source.savedAt;
const layout = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get('dwg-layout.json')));
layout.diagonalRainbow = mapped;
fs.writeFileSync(out, createZip([{ name: 'project.aqua', data: JSON.stringify(source) }, { name: 'manifest.json', data: JSON.stringify(source.assetManifest, null, 2) },
  { name: 'design-notes.txt', data: `${zipText(readZip(fs.readFileSync(srcPath)).get('design-notes.txt'))}\n\nDIAGONAL RAINBOW\nThe three Diagonal Rainbow annotation leaders are mapped to the nearest existing nozzle positions; no CAD point was moved or invented. Group: diagonalRainbow with matching diagonalRainbowLight DMX lights. All 434 portrait lights remain light-only.\n` },
  { name: 'dwg-layout.json', data: JSON.stringify(layout) }]));
console.log(JSON.stringify({ out, mapped, fixtures: source.engineering.fixtures.length, groups: groups.length, patterns: source.programmer.studio.recipes.length }, null, 2));
