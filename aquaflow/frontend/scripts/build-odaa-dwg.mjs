import fs from 'node:fs';
import { readZip, zipText, createZip } from '/src/utils/zipStore.js';
import { getDefaultEngineering } from '/src/data/fixtureLibrary.js';
import { compileStudio, inventory } from '/src/components/programmer/studio/showModel.js';

const [srcPath, layoutPath, out] = process.argv.slice(2);
if (!srcPath || !layoutPath || !out) throw new Error('usage: vite-node --root . scripts/build-odaa-dwg.mjs <current.aquapkg> <layout.json> <out.aquapkg>');
const source = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get('project.aqua')));
const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
const r3 = v => Math.round(v * 1000) / 1000, DEG = Math.PI / 180;
const GREEN = '#92ff9d', WHITE = '#e4f7ff', BLUE = '#38c8ff', GOLD = '#d8ffb8';
const fixtures = [], members = new Map(), labels = new Map();
const add = (fixture, role, label, paired = false) => {
  const id = fixture.id;
  fixtures.push({ z: 0, visible: true, ...fixture,
    engineering: { ...getDefaultEngineering(fixture.type), ...(fixture.engineering || {}) } });
  if (!members.has(role)) members.set(role, []);
  members.get(role).push(id); labels.set(role, label);
  if (paired) add({ id: `${id}-light`, type: 'light_uw_rgb_36w', label: `${fixture.label} · DMX light`, x: fixture.x, y: fixture.y,
    groupId: `${role}Light`, engineering: { pairedNozzleId: id, defaultColor: paired === true ? GREEN : paired, beamAngleDeg: 35 } }, `${role}Light`, `${label} · DMX lights`);
  return id;
};
const point = p => ({ x: p[0], y: p[1] });

layout.infinity.forEach((p, i) => {
  const prev = layout.infinity[(i + layout.infinity.length - 1) % layout.infinity.length], next = layout.infinity[(i + 1) % layout.infinity.length];
  const rotation = Math.atan2(next[1] - prev[1], next[0] - prev[0]) / DEG;
  add({ id: `infinity-1d-${String(i + 1).padStart(3, '0')}`, type: 'motion_nozzle_1d_tilt_motor', label: `DWG infinity 1D nozzle ${i + 1}`,
    ...point(p), rotation, groupId: 'infinity', engineering: { jetHeightM: 4.5, axisCount: 1, angleRangeDeg: 120, speedDegSec: 90,
      cadSource: 'FC6 · exact 240-point infinity polyline', designStatus: 'DWG-derived concept — verify drive and hydraulics' } }, 'infinity', 'DWG infinity · 1D nozzles', WHITE);
});
layout.oneD.forEach((p, i) => {
  const id = `portrait-circle-1d-${String(i + 1).padStart(2, '0')}`;
  add({ id, type: 'motion_nozzle_1d_tilt_motor', label: `DWG 1D ring nozzle ${i + 1}`, x: p.x, y: p.y, rotation: p.rotation,
    groupId: 'portraitCircle', engineering: { jetHeightM: 5.5, axisCount: 1, angleRangeDeg: 120, speedDegSec: 90,
      cadSource: 'yiweipentou · named 1D block on 5.5 m guide', designStatus: 'DWG-derived concept — verify drive and hydraulics' } }, 'portraitCircle', 'DWG 5.5 m circle · 22 1D nozzles', GREEN);
  const dx = p.x - layout.guides.center[0], dy = p.y - layout.guides.center[1], radius = Math.hypot(dx, dy);
  add({ id: `outer-vario-${String(i + 1).padStart(2, '0')}`, type: 'nozzle_solenoid_variodrop_oase', label: `DWG Vario nozzle ${i + 1}`,
    x: r3(layout.guides.center[0] + dx / radius * layout.guides.varioRadiusM), y: r3(layout.guides.center[1] + dy / radius * layout.guides.varioRadiusM),
    groupId: 'outerRing', engineering: { jetHeightM: 4, cadSource: '10.3 m guide + Vario nozzle annotation', designStatus: 'DWG-derived concept — verify Vario hardware' } }, 'outerRing', 'DWG 10.3 m circle · 22 Vario nozzles', GOLD);
});
layout.centralStraight.forEach((p, i) => add({ id: `straight-${String(i + 1).padStart(3, '0')}`, type: 'nozzle_straight_dn15', label: `DWG straight adjustable nozzle ${i + 1}`,
  ...point(p), groupId: 'rays', engineering: { jetHeightM: 3, cadSource: 'Expanded DWG straight-nozzle circle markers', designStatus: 'DWG-derived concept — verify nozzle model' } }, 'rays', 'DWG central straight adjustable nozzles', WHITE));
for (const side of ['left', 'right']) layout.pillars[side].forEach((p, i) => add({ id: `pillar-${side}-${String(i + 1).padStart(3, '0')}`,
  type: 'nozzle_straight_dn15', label: `${side} DWG pillar straight nozzle ${i + 1}`, ...point(p), groupId: `pillar-${side}`,
  engineering: { jetHeightM: 3, cadSource: 'DWG pillar paths and cap circles', designStatus: 'DWG-derived concept — verify nozzle model' } }, `pillar-${side}`, `${side} DWG pillar · straight nozzles`, GREEN));

const centralLightPositions = layout.centralLights.map(point);
const star = centralLightPositions.slice(0, 4), portrait = centralLightPositions.slice(4);
star.forEach((p, i) => add({ id: `star-light-${i + 1}`, type: 'light_uw_rgb_36w', label: `DWG star DMX light ${i + 1}`, ...p,
  groupId: 'starLight', engineering: { defaultColor: GREEN, cadSource: 'Named DMX light block' } }, 'starLight', 'DWG star · DMX lights only'));
portrait.forEach((p, i) => {
  const role = p.y >= 17.35 ? 'hairLight' : 'faceLight';
  add({ id: `portrait-light-${i + 1}`, type: 'light_uw_rgb_36w', label: `DWG portrait DMX light ${i + 1}`, ...p,
    groupId: role, engineering: { defaultColor: GREEN, cadSource: 'Named DMX light block · light only' } }, role, role === 'hairLight' ? 'DWG hair · DMX light only' : 'DWG portrait · DMX light only');
});
layout.air20.forEach((p, i) => add({ id: `air-20m-${i + 1}`, type: 'nozzle_air_shooter_24e_30m_oase', label: `DWG 20 m air blast ${i + 1}`,
  ...point(p), groupId: 'compressors', engineering: { jetHeightM: 20, cadSource: 'rerrt45 + air blast 20m annotation', designStatus: 'DWG 20 m annotation — verify air plant and splash zone' } }, 'compressors', 'DWG 20 m and 50 m air blasts', BLUE));
layout.air50.forEach((p, i) => add({ id: `air-50m-${i + 1}`, type: 'nozzle_air_shooter_50e_50m_oase', label: `DWG 50 m air blast ${i + 1}`,
  ...point(p), groupId: 'compressors', engineering: { jetHeightM: 50, cadSource: '111 + air blast 50m annotation', designStatus: 'DWG 50 m annotation — verify air plant and splash zone' } }, 'compressors', 'DWG 20 m and 50 m air blasts', BLUE));

const groups = [], group = (id, name, memberFixtureIds, color) => groups.push({ id, name, memberFixtureIds, orderMode: 'engineering', color, muted: false, solo: false });
for (const [role, ids] of members) group(role, labels.get(role), ids, role === 'infinity' ? WHITE : role === 'outerRing' ? GOLD : GREEN);
const regularRoles = ['rays', 'pillar-left', 'pillar-right', 'infinity', 'portraitCircle', 'outerRing'];
group('allRegular', 'All regular water (no air blasts)', regularRoles.flatMap(role => members.get(role) || []), WHITE);
group('allLights', 'All integrated lights', fixtures.filter(f => f.type.startsWith('light_')).map(f => f.id), GREEN);
for (const role of ['infinity', 'portraitCircle']) {
  const fixturesInRole = members.get(role).map(id => fixtures.find(f => f.id === id));
  const sorted = [...fixturesInRole].sort((a, b) => a.x - b.x), middle = Math.ceil(sorted.length / 2);
  [sorted.slice(0, middle), sorted.slice(middle)].forEach((list, i) => group(`${role}${i ? 'B' : 'A'}`, `${labels.get(role)} · ${i ? 'right' : 'left'} half`, list.map(f => f.id), GREEN));
  [0, 1].forEach(parity => group(`${role}${parity ? 'Odd' : 'Even'}`, `${labels.get(role)} · ${parity ? 'odd' : 'even'} cross`, fixturesInRole.filter((_, i) => i % 2 === parity).map(f => f.id), GREEN));
}
const recipes = [];
const studio = { ...source.programmer.studio, groups, recipes, markers: [] };
const items = inventory(fixtures);
const { clips, issues } = compileStudio(studio, items);
if (issues.length) throw new Error(`${issues.length} show compile issues: ${issues.slice(0, 12).join(' | ')}`);
if (layout.infinity.length !== 240 || layout.oneD.length !== 22 || layout.centralStraight.length !== 130 || layout.air20.length !== 5 || layout.air50.length !== 2) {
  throw new Error('Unexpected DWG extraction counts');
}
const inside = (x, y, polygon) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
};
const distanceToPool = (x, y, polygon) => {
  let best = Infinity;
  for (let i = 0; i < polygon.length - 1; i++) {
    const a = polygon[i], b = polygon[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1e-12)));
    best = Math.min(best, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
  }
  return best;
};
const outside = fixtures.filter(f => !inside(f.x, f.y, layout.pool) && distanceToPool(f.x, f.y, layout.pool) > 0.25);
if (outside.length) throw new Error(`Fixtures outside DWG pool: ${outside.slice(0, 12).map(f => `${f.id}@${f.x},${f.y}`).join(' | ')}`);
const byTrack = new Map();
for (const clip of clips) (byTrack.get(clip.trackId) || byTrack.set(clip.trackId, []).get(clip.trackId)).push(clip);
const now = new Date().toISOString(), name = 'Odaa and Elder — DWG Infinity Fountain';
const xs = layout.pool.map(p => p[0]), ys = layout.pool.map(p => p[1]);
const cx = layout.guides.center[0], cy = layout.guides.center[1];
source.engineering = { ...source.engineering, name, id: 'aquaflow-odaa-dwg-infinity', projectName: name, pool_type: 'freeform',
  params: { width: r3(Math.max(...xs) - Math.min(...xs)), length: r3(Math.max(...ys) - Math.min(...ys)), depth: 0.65, units: 'm', design_head_m: 50, fountainMode: 'pool' },
  geometry: { type: 'polygon', closed: true, points: layout.pool.map(([x, y]) => ({ x, y })), source: { units: 'meters', status: 'Exact DWG E33 boundary with bulges' } },
  basins: [{ type: 'polygon', closed: true, id: 'basin-dwg', name: 'DWG D-shaped basin', outer: layout.pool.map(([x, y]) => ({ x, y })), source: { units: 'meters', status: 'Exact DWG E33 boundary with bulges' } }],
  fixtures, groups: groups.map(g => ({ id: `group-${g.id}`, uuid: `group-${g.id}`, owner: 'model', name: g.name, members: g.memberFixtureIds })),
  site_models: [], site_surfaces: [], cad_underlay: null, measurements: [], manualPipes: [], pipes: [],
  guidePaths: ['infinity', 'portraitCircle', 'outerRing'].map(role => ({ id: `guide-${role}`, name: labels.get(role), closed: true, visible: true,
    color: role === 'outerRing' ? GOLD : role === 'infinity' ? WHITE : GREEN,
    points: fixtures.filter(f => f.groupId === role).map(f => ({ x: f.x, y: f.y })) })),
  depth_zones: [{ id: 'basin-depth', zone: 'display', label: '650 mm concept water level', depth: 0.65, color: '#5fb4d6', points: layout.pool.map(([x, y]) => ({ x, y })) }],
  hydraulics: null, solved_hydraulics: null, bom: null, exported_at: now };
source.devices = []; source.nodes = []; source.connections = [];
source.timelineTracks = items.flatMap(item => (item.tracks || []).map(track => ({ id: track.id, fixtureId: item.id, deviceId: item.id,
  label: `${item.label} · ${String(track.type).replaceAll('_', ' ')}`, type: track.type, color: track.color || '#65d9d0', muted: false, solo: false, clips: byTrack.get(track.id) || [] })));
source.programmer = { ...source.programmer, studio, timelineClips: clips, cues: [], audioDuration: 0, audioFileReference: null, musicCache: {}, stems: null, patternDefinitions: [] };
source.show = { ...source.show, id: 'aquaflow-odaa-dwg-show', name, bpm: 120, duration: 0, loop: false };
source.project = { ...source.project, id: 'aquaflow-odaa-dwg-infinity', name, revision: 1, createdAt: now, modifiedAt: now };
source.render = { ...source.render, environment: 'night', cameraMode: 'front', activeCameraView: 'top', realWorld: true, windX: 0, windZ: 0,
  cameraTrack: { enabled: false, keys: [] },
  cameraViews: [{ id: 'front', name: 'Audience · front', position: { x: cx, y: 30, z: cy - 55 }, target: { x: cx, y: 3, z: cy }, fov: 45 },
    { id: 'top', name: 'Top · DWG plan', position: { x: cx, y: 70, z: cy - 0.01 }, target: { x: cx, y: 0, z: cy }, fov: 45 }] };
source.workspace = { activePanel: 'preview' };
source.assetManifest = { format: 'aquaflow-asset-manifest', version: 1, generatedAt: now, projectPath: out, assets: [] };
source.savedAt = now;
const notes = `${name}\n\nDWG-CORRECTED DESIGN-ONLY EDITION\nSource: ${layout.source}. Pool = exact E33 polyline with bulges (${r3(Math.max(...xs) - Math.min(...xs))} x ${r3(Math.max(...ys) - Math.min(...ys))} m). Infinity = exact FC6 polyline with 240 1D nozzles. Named yiweipentou blocks = 22 1D nozzles on the 5.5 m guide. Vario annotation + 10.3 m guide = 22 VarioDrop positions. Expanded circle markers = 130 straight adjustable nozzles. Pillar paths/caps = 123 straight nozzles per side. Named DMX light blocks = 26 unique light-only positions. Five rerrt45 = 20 m air blasts; two 111 = 50 m air blasts.\n\nThis is a design-only deliverable with an empty pattern timeline. Choreography will be authored separately after the layout is approved. Every fixture was checked against the exact DWG pool polygon. No external assets are embedded. Hydraulics, hardware models, compressed-air plant and commissioning still require site/supplier verification.\n`;
fs.writeFileSync(out, createZip([{ name: 'project.aqua', data: JSON.stringify(source) }, { name: 'manifest.json', data: JSON.stringify(source.assetManifest, null, 2) },
  { name: 'design-notes.txt', data: notes }, { name: 'dwg-layout.json', data: JSON.stringify(layout) }]));
console.log(JSON.stringify({ out, fixtures: fixtures.length, roles: Object.fromEntries([...members].map(([k, v]) => [k, v.length])),
  patterns: recipes.length, clips: clips.length, duration: 0, bytes: fs.statSync(out).size }, null, 2));
