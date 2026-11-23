import fs from 'node:fs';
import { readZip, zipText, createZip } from '/src/utils/zipStore.js';

const [srcPath, out] = process.argv.slice(2);
if (!srcPath || !out) throw new Error('usage: rotate-odaa-portrait.mjs <design.aquapkg> <out.aquapkg>');
const source = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get('project.aqua')));
const layout = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get('dwg-layout.json')));
const center = layout.portraitRestoration?.center || [35.0481, 14.1233];
const roles = new Set(['faceLight', 'hairLight', 'starLight']);
let rotated = 0;
for (const fixture of source.engineering.fixtures) {
  if (!roles.has(fixture.groupId)) continue;
  fixture.x = 2 * center[0] - fixture.x;
  fixture.y = 2 * center[1] - fixture.y;
  fixture.rotation = ((fixture.rotation || 0) + 180) % 360;
  fixture.engineering = { ...fixture.engineering, artworkRotationDeg: 180 };
  rotated++;
}
layout.portraitRestoration = { ...layout.portraitRestoration, rotationDeg: 180 };
source.savedAt = new Date().toISOString(); source.project.modifiedAt = source.savedAt;
fs.writeFileSync(out, createZip([{ name: 'project.aqua', data: JSON.stringify(source) }, { name: 'manifest.json', data: JSON.stringify(source.assetManifest, null, 2) },
  { name: 'design-notes.txt', data: `${zipText(readZip(fs.readFileSync(srcPath)).get('design-notes.txt'))}\n\nPORTRAIT ORIENTATION\nThe Old Man and Oddaa light-only artwork was rotated 180 degrees about (${center.join(', ')}) to match the supplied reference orientation. No other fixture was moved.\n` },
  { name: 'dwg-layout.json', data: JSON.stringify(layout) }]));
console.log(JSON.stringify({ out, rotated, fixtures: source.engineering.fixtures.length, center }, null, 2));
