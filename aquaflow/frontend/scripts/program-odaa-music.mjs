import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readZip, zipText, createZip } from '/src/utils/zipStore.js';
import { compileStudio, inventory, newRecipe } from '/src/components/programmer/studio/showModel.js';
import { motionPatternRecipes } from '/src/components/programmer/studio/motionPatterns.js';

const [srcPath, audioPath, analysisPath, out] = process.argv.slice(2);
if (!srcPath || !audioPath || !analysisPath || !out) throw new Error('usage: program-odaa-music.mjs <design.aquapkg> <audio.m4a> <analysis.json> <out.aquapkg>');
const source = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get('project.aqua')));
const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
const fixtures = source.engineering.fixtures;
const studioGroups = source.programmer.studio.groups;
const byId = new Map(fixtures.map(f => [f.id, f]));
const r3 = v => Math.round(v * 1000) / 1000;
const GREEN = '#20ff45', WHITE = '#f4f7ff', GOLD = '#ffc400', RED = '#ff2020', BLUE = '#00bfff', PINK = '#ff168f', AMBER = '#ffb52e';
const END = 328.144399, BPM = 77.1;
for (const [prefix, label, height] of [['air-20m-left', 'left 20 m', 20], ['air-20m-right', 'right 20 m', 20], ['air-50m-center', 'center 50 m', 50]]) {
  const original = fixtures.filter(f => f.id.match(new RegExp(`^${prefix}-0[1-5]$`))).sort((a, b) => a.id.localeCompare(b.id));
  const existing = fixtures.filter(f => new RegExp(`^${prefix}-\\d\\d$`).test(f.id));
  if (existing.length === 10) continue;
  if (original.length !== 5 || existing.length !== 5) throw new Error(`Unexpected ${prefix} air-blast count: ${existing.length}`);
  const center = original.reduce((p, f) => [p[0] + f.x / 5, p[1] + f.y / 5], [0, 0]);
  const compressorIds = studioGroups.find(g => g.id === 'compressors').memberFixtureIds;
  const compressorLightIds = studioGroups.find(g => g.id === 'compressorsLight').memberFixtureIds;
  for (let i = 6; i <= 10; i++) {
    const a = original[i - 6], b = original[(i - 5) % 5], number = String(i).padStart(2, '0'), id = `${prefix}-${number}`;
    const start = Math.atan2(a.y - center[1], a.x - center[0]);
    let end = Math.atan2(b.y - center[1], b.x - center[0]); if (end <= start) end += Math.PI * 2;
    const angle = (start + end) / 2, radius = (Math.hypot(a.x - center[0], a.y - center[1]) + Math.hypot(b.x - center[0], b.y - center[1])) / 2;
    const x = r3(center[0] + Math.cos(angle) * radius), y = r3(center[1] + Math.sin(angle) * radius);
    const nozzle = { ...structuredClone(a), id, label: `${label} air blast ${i} of 10`, x, y,
      engineering: { ...structuredClone(a.engineering), cadSource: `${label} cyan circle · ten-nozzle circular array` } };
    const light = { ...structuredClone(byId.get(`${a.id}-light`)), id: `${id}-light`, label: `${label} air-blast light ${i}`, x, y,
      engineering: { ...structuredClone(byId.get(`${a.id}-light`).engineering), pairedNozzleId: id } };
    fixtures.push(nozzle, light); byId.set(id, nozzle); byId.set(`${id}-light`, light);
    compressorIds.push(id); compressorLightIds.push(`${id}-light`);
  }
}
studioGroups.find(g => g.id === 'compressors').name = 'Thirty circular air blasts · 20 × 20 m + 10 × 50 m';
studioGroups.find(g => g.id === 'compressorsLight').name = 'Thirty circular air-blast DMX lights';
const G = (id, name, memberFixtureIds, color = GREEN, orderMode = 'engineering') => ({ id, name, memberFixtureIds, orderMode, color, muted: false, solo: false });
const ids = role => source.programmer.studio.groups.find(g => g.id === role)?.memberFixtureIds || [];
const withIds = (group, name, memberFixtureIds, color, orderMode) => { const index = studioGroups.findIndex(g => g.id === group.id); if (index < 0) studioGroups.push(G(group.id, name, memberFixtureIds, color, orderMode)); else studioGroups[index] = { ...studioGroups[index], name, memberFixtureIds, color, orderMode }; };
const addGroup = (id, name, memberFixtureIds, color, orderMode) => withIds(G(id, name, memberFixtureIds, color, orderMode), name, memberFixtureIds, color, orderMode);
const allNozzleIds = fixtures.filter(f => !f.type.startsWith('light_')).map(f => f.id);
const allLightIds = fixtures.filter(f => f.type.startsWith('light_')).map(f => f.id);
const portraitIds = ['faceLight', 'hairLight', 'starLight'].flatMap(ids);
const straightIds = ['rays', 'pillar-left', 'pillar-right'].flatMap(ids);
const oneDIds = ['infinity', 'portraitCircle'].flatMap(ids);
const cx = 35.46, portraitCenter = [35.0481, 14.1233], rainbowAims = [];
const infinitySegments = { Left: [], Center: [], Right: [] };
for (const id of ids('infinity')) {
  const f = byId.get(id);
  if (f.x < 32) infinitySegments.Left.push(id);
  else if (f.x <= 39) infinitySegments.Center.push(id);
  else infinitySegments.Right.push(id);
}
for (const [segment, memberFixtureIds] of Object.entries(infinitySegments)) {
  addGroup(`infinity${segment}`, `GRP-01 · Infinity ${segment}`, memberFixtureIds, WHITE);
  addGroup(`infinity${segment}Light`, `GRP-01 · Infinity ${segment} lights`, memberFixtureIds.map(id => `${id}-light`), WHITE);
}
const infinityIds = ids('infinity');
for (let i = 0; i < 20; i++) {
  const members = infinityIds.slice(i * 12, i * 12 + 12), id = String(i + 1).padStart(2, '0');
  addGroup(`razor-${id}`, `Comet chase · window ${i + 1} of 20`, members, GOLD);
  addGroup(`razor-${id}Light`, `Comet chase · window ${i + 1} DMX`, members.map(member => `${member}-light`), GOLD);
}
addGroup('portraitCircle', 'GRP-02 · 5.5 m ring 1D · clockwise 1–22', ids('portraitCircle'), GREEN, 'clockwise');
addGroup('outerRing', 'GRP-03 · 10.3 m Vario · clockwise 1–22', ids('outerRing'), GOLD, 'clockwise');
addGroup('pillars', 'GRP-04 · Left and right ceremonial pillars', ['pillar-left', 'pillar-right'].flatMap(ids), GOLD);
addGroup('pillarsLight', 'GRP-04 · Pillar DMX wash', ['pillar-leftLight', 'pillar-rightLight'].flatMap(ids), GREEN);
addGroup('rays', 'GRP-05 · Starburst straight rays', ids('rays'), WHITE);
addGroup('raysLight', 'GRP-05 · Starburst DMX wash', ids('raysLight'), WHITE);
addGroup('allStraight', 'GRP-04+05 · All 386 straight nozzles', straightIds, WHITE);
addGroup('allStraightLight', 'GRP-04+05 · Straight-nozzle DMX wash', straightIds.map(id => `${id}-light`), WHITE);
addGroup('diagonalRainbow', 'GRP-06 · Six Diagonal Rainbow manifolds', ['diagonal-rainbow-01', 'diagonal-rainbow-02', 'diagonal-rainbow-03', 'diagonal-rainbow-04', 'diagonal-rainbow-05', 'diagonal-rainbow-06'], PINK);
addGroup('diagonalRainbowLight', 'GRP-06 · Diagonal Rainbow DMX', ['diagonal-rainbow-01-light', 'diagonal-rainbow-02-light', 'diagonal-rainbow-03-light', 'diagonal-rainbow-04-light', 'diagonal-rainbow-05-light', 'diagonal-rainbow-06-light'], PINK);
addGroup('air20Left', 'GRP-07 · Left 20 m ring · ten cannons', ids('compressors').filter(id => id.startsWith('air-20m-left')), BLUE, 'clockwise');
addGroup('air20LeftLight', 'GRP-07 · Left 20 m ring lights', ids('compressorsLight').filter(id => id.startsWith('air-20m-left')), BLUE, 'clockwise');
addGroup('air20Right', 'GRP-08 · Right 20 m ring · ten cannons', ids('compressors').filter(id => id.startsWith('air-20m-right')), BLUE, 'clockwise');
addGroup('air20RightLight', 'GRP-08 · Right 20 m ring lights', ids('compressorsLight').filter(id => id.startsWith('air-20m-right')), BLUE, 'clockwise');
addGroup('air50Center', 'GRP-09 · Center 50 m decagon · ten cannons', ids('compressors').filter(id => id.startsWith('air-50m-center')), BLUE, 'clockwise');
addGroup('air50CenterLight', 'GRP-09 · Center 50 m decagon lights', ids('compressorsLight').filter(id => id.startsWith('air-50m-center')), BLUE, 'clockwise');
addGroup('air20', 'Twenty 20 m air blasts · both circles', ids('compressors').filter(id => id.startsWith('air-20m')), BLUE);
addGroup('air20Light', 'Twenty 20 m air-blast lights', ids('compressorsLight').filter(id => id.startsWith('air-20m')), BLUE);
addGroup('air50', 'Ten center 50 m air blasts', ids('compressors').filter(id => id.startsWith('air-50m')), BLUE);
addGroup('air50Light', 'Ten center 50 m air-blast lights', ids('compressorsLight').filter(id => id.startsWith('air-50m')), BLUE);
addGroup('portraitDMX', 'GRP-10 · Odaa and Elder portrait · 434 pixels', portraitIds, GREEN);
addGroup('waterDMX', 'GRP-10 · Nozzle-wash DMX', allLightIds.filter(id => !portraitIds.includes(id)), WHITE);
addGroup('allRegular', 'All regular water · no air blasts', allNozzleIds.filter(id => !/^air-/.test(id)), WHITE);
addGroup('allNozzles', 'All 706 water outlets', allNozzleIds, WHITE);
addGroup('all1D', 'All 262 1D nozzles', oneDIds, WHITE);
addGroup('allLights', 'All 1,140 DMX lights', allLightIds, GREEN);
for (const role of ['rays', 'pillar-left', 'pillar-right']) {
  const inner = ids(role).filter(id => {
    const f = byId.get(id), r = Math.hypot(f.x - portraitCenter[0], f.y - portraitCenter[1]);
    return role === 'rays' && r <= 6.5;
  });
  if (inner.length) {
    addGroup('raysInner', 'GRP-05 · Inner starburst rays', inner, GOLD);
    addGroup('raysInnerLight', 'GRP-05 · Inner ray lights', inner.map(id => `${id}-light`), GOLD);
  }
}
addGroup('raysOuter', 'GRP-05 · Outer starburst rays', ids('rays').filter(id => !ids('raysInner').includes(id)), WHITE);
addGroup('raysOuterLight', 'GRP-05 · Outer ray lights', ids('raysOuter').map(id => `${id}-light`), WHITE);
for (const [side, prefix] of [['left', 'air20-left'], ['right', 'air20-right'], ['center', 'air50-center']]) {
  for (let i = 1; i <= 10; i++) {
    const number = String(i).padStart(2, '0'), fixturePrefix = prefix === 'air50-center' ? 'air-50m-center' : `air-20m-${side}`;
    addGroup(`${prefix}-${number}`, `${prefix} · cannon ${i}`, [`${fixturePrefix}-${number}`], BLUE);
    addGroup(`${prefix}-${number}Light`, `${prefix} · cannon ${i} light`, [`${fixturePrefix}-${number}-light`], BLUE);
  }
}
for (const f of fixtures) if (f.type === 'motion_nozzle_1d_tilt_motor') f.engineering.speedDegSec = 88;
for (const f of fixtures) if (f.groupId === 'outerRing') {
  f.type = 'nozzle_fan_large';
  f.label = f.label.replace('Vario nozzle', 'Vario fan nozzle');
  Object.assign(f.engineering, { jetHeightM: 4.8, sprayAngleDeg: 90, fanAngleDeg: 90, outletCount: 11, nozzleStyle: 'fan' });
}
for (const f of fixtures) if (f.groupId === 'diagonalRainbow') {
  const dx = portraitCenter[0] - f.x, dy = portraitCenter[1] - f.y, distance = Math.hypot(dx, dy);
  f.type = 'motion_nozzle_1d_tilt_motor';
  f.rotation = r3(Math.atan2(dy, dx) * 180 / Math.PI);
  Object.assign(f.engineering, { motionAxis: 'Tilt', axisCount: 1, angleRangeDeg: 120, speedDegSec: 88,
    jetHeightM: r3(distance + 8), diagonalAngleDeg: 45, aimTarget: 'Odaa and Elder portrait' });
  const groupId = `rainbowAim-${f.id}`;
  addGroup(groupId, `${f.label} · fixed high inward aim`, [f.id], BLUE);
  rainbowAims.push([groupId, f.id]);
}

const recipes = [];
const addRecipe = (...list) => recipes.push(...list);
const base = (groupId, name, start, duration, extra = {}) => ({ ...newRecipe(groupId, start), name, start: r3(start), duration: r3(duration), cycles: 1, spread: 1,
  intensity: 100, order: studioGroups.find(g => g.id === groupId)?.orderMode || 'engineering', color: studioGroups.find(g => g.id === groupId)?.color || GREEN, ...extra });
for (const [groupId, fixtureId] of rainbowAims) addRecipe(base(groupId, `${fixtureId} · 45° high arc toward Odaa`, 0, END,
  { effect: 'static', attribute: 'motion_angle', intensity: 45 }));
const hold = (g, name, s, d, level) => base(g, name, s, d, { effect: 'static', intensity: level });
const wave = (g, name, s, d, field, order = 'engineering') => base(g, name, s, d, { effect: 'field', order, field: { ease: 0.2, ...field } });
const light = (g, name, s, d, color, level = 30) => wave(g, name, s, d, { kind: 'custom', shape: 'drawn', path: 'together', motion: 'repeat', period: Math.max(0.2, d * 2),
  points: [{ time: 0, value: 1 }, { time: 1, value: 1 }], low: level, high: level, ease: 0, colorMode: 'sequence', colors: [color] });
const waterLight = (g, l, name, s, d, field, colors, lightHigh = 22, orderOverride = null) => {
  const order = orderOverride || (g === 'infinity' ? 'engineering' : 'clockwise');
  addRecipe(wave(g, name, s, d, field, order), wave(l, `${name} · DMX`, s, d, { ...field, low: 3, high: lightHigh, lowFar: 3, highFar: lightHigh,
    colorMode: 'sequence', colors }, order));
};
const rainbowFlow = (name, s, d, colors = [PINK, GREEN], lightHigh = 26) => waterLight('diagonalRainbow', 'diagonalRainbowLight', name, s, d,
  { kind: 'custom', shape: 'pulse', path: 'around', motion: 'there-and-back', period: d, crests: 1, direction: 1, offset: d / 2, low: 6, high: 90, ease: 0.1 },
  colors, lightHigh, 'center-out');
const varioBloom = (name, s, d, colors = [GOLD, '#0019ff'], lightHigh = 24, period = 6.4) => {
  const points = [{ time: 0, value: 0.12 }, { time: 0.16, value: 1 }, { time: 0.32, value: 1 }, { time: 0.58, value: 0.18 }, { time: 0.76, value: 0.28 }, { time: 1, value: 0.12 }];
  addRecipe(
    base('outerRing', name, s, d, { effect: 'curve', attribute: 'level', cycles: Math.max(1, Math.round(d / period)), spread: 0.65, intensity: 100, sampleRate: 10, envelope: points }),
    wave('outerRingLight', `${name} · DMX`, s, d, { kind: 'custom', shape: 'drawn', path: 'around', motion: 'repeat', period, crests: 1, points,
      low: 3, high: lightHigh, lowFar: 3, highFar: lightHigh, ease: 0.35, colorMode: 'sequence', colors }, 'clockwise')
  );
};
const ramp = (g, name, s, d, from, to, color = null) => base(g, name, s, d, { effect: 'field', field: { kind: 'custom', shape: 'drawn', path: 'together', motion: 'repeat',
  period: d * 2, spread: 0, points: [{ time: 0, value: 0 }, { time: 0.5, value: 1 }, { time: 1, value: 1 }], low: from, high: to, ease: 0,
  ...(color ? { colorMode: 'sequence', colors: [color] } : {}) } });
const motion = (g, l, name, s, d, { amplitude = 40, centre = 0, period = 4, path = 'around', opposite = false, crests = 1, low = 45, high = 82, colors = [WHITE], lightHigh = 20, offset = 0, direction = 1, order = 'engineering' }) => {
  const made = motionPatternRecipes({ start: s, duration: d, name, groupId: g, lightGroupId: l, order,
    field: { kind: 'custom', shape: 'sine', path, motion: 'repeat', period, crests, opposite, offset, direction, low, high, ease: 0.2 },
    motion: { axes: 1, path: 'sweep', amplitudeDeg: amplitude, centreDeg: centre, limitSpeed: true },
    light: { color: colors[0], low: 3, high: lightHigh, colorMode: 'sequence', colors } });
  addRecipe(...made.recipes);
};
const shot = (g, t, name) => {
  const duration = g.includes('air50') ? 3.8 : g.includes('air20') ? 2.4 : 0.35;
  addRecipe(hold(g, name, t, duration, 100), light(`${g}Light`, `${name} · ice-cyan backlight`, Math.max(0, t - 0.05), duration + 0.1, '#00d2ff', 36));
};
const cascade20 = (t, name) => {
  for (let i = 1; i <= 10; i++) {
    const id = String(i).padStart(2, '0');
    shot(`air20-left-${id}`, t + (i - 1) * 0.18, `${name} · left ${i}`);
    shot(`air20-right-${id}`, t + (i - 1) * 0.18, `${name} · right ${i}`);
  }
};
const volley50 = (t, name) => { for (let i = 1; i <= 10; i++) shot(`air50-center-${String(i).padStart(2, '0')}`, t, `${name} · ${i}`); };
const pop20 = (start, name) => {
  for (let i = 0; i < 20; i++) {
    const side = i % 2 === 0 ? 'left' : 'right', number = String(Math.floor(i / 2) + 1).padStart(2, '0');
    shot(`air20-${side}-${number}`, start + i * 0.3, `${name} · ${side} ${number}`);
  }
};
const razor = (start, name, windows = 20) => {
  for (let i = 1; i <= windows; i++) {
    const id = String(i).padStart(2, '0');
    motion(`razor-${id}`, `razor-${id}Light`, `${name} · window ${i}`, start + (i - 1) * 0.55, 0.55,
      { amplitude: 12, centre: 12, period: 0.55, path: 'together', low: 0, high: 100, colors: [WHITE, GOLD, RED], lightHigh: 30 });
  }
};
const crown50 = (t, name) => {
  for (const id of ['03', '08']) shot(`air50-center-${id}`, t, `${name} · lower crown ${id}`);
  for (const id of ['02', '04', '07', '09']) shot(`air50-center-${id}`, t + 0.15, `${name} · middle crown ${id}`);
  for (const id of ['01', '05', '06', '10']) shot(`air50-center-${id}`, t + 0.3, `${name} · upper crown ${id}`);
};
const portraitLight = (name, s, d, colors, high = 34) => {
  const [emerald, ivory, amber] = colors;
  const level = Math.min(high, 4);
  for (const [role, color] of [['hairLight', emerald], ['faceLight', ivory], ['starLight', amber || ivory]]) {
    addRecipe(wave(role, name, s, d, { kind: 'custom', shape: 'sine', path: 'around', motion: 'repeat', period: 5, crests: 1,
      low: 0.5, high: level, lowFar: 0.5, highFar: level, ease: 0.2, colorMode: 'sequence', colors: [color] }, 'clockwise'));
  }
};

// 01 · Intro & Drum Ignition — darkness until the first measured dibbe hit.
razor(7.59, '01 · Razor Blade comet chase');
waterLight('diagonalRainbow', 'diagonalRainbowLight', '01 · Six-rainbow left-right-left sweep', 7.59, 5.6,
  { kind: 'custom', shape: 'drawn', path: 'around', motion: 'there-and-back', period: 5.6, crests: 1,
    points: [{ time: 0, value: 0 }, { time: 0.2, value: 1 }, { time: 0.5, value: 1 }, { time: 0.8, value: 0.4 }, { time: 1, value: 0 }], low: 0, high: 78, ease: 0 }, [PINK, GREEN], 26);
motion('infinity', 'infinityLight', '01 · Infinity inward embrace and return', 13.6, 8.4,
  { amplitude: 46, centre: 0, period: 4.2, path: 'together', low: 34, high: 82, colors: [WHITE, GOLD], lightHigh: 24 });
rainbowFlow('01 · Rainbow sides converge and return', 13.6, 8.4, [GOLD, WHITE]);
varioBloom('01 · White Vario fan crown', 13.6, 8.4, [WHITE], 22, 4.2);

// 02 · First Dance Drop & Horn Stabs — air percussion and gold/red pillar responses.
pop20(23, '02 · Alternating left-right cannon pops');
shot('air20', 34.9, '02 · Snare break · all twenty 20 m cannons');
shot('air20', 45, '02 · Final brass stab · all twenty');
waterLight('pillars', 'pillarsLight', '02 · Pillar gold/red horn pulses', 23, 22,
  { kind: 'custom', shape: 'sine', path: 'around', motion: 'repeat', period: 2.4, crests: 2, low: 24, high: 68, ease: 0.2 }, [GOLD, RED], 26);
motion('infinity', 'infinityLight', '02 · Infinity inward-outward dance arcs', 23, 22,
  { amplitude: 50, centre: 0, period: 5.5, path: 'together', opposite: true, crests: 2, low: 36, high: 86, colors: [GOLD, '#0019ff'], lightHigh: 26 });
rainbowFlow('02 · Rainbow converging drum answer A', 23, 10, [RED, GREEN]);
rainbowFlow('02 · Rainbow converging drum answer B', 34, 10, [GOLD, RED]);
varioBloom('02 · Vario wide bloom and gentle close', 23, 22, [GOLD, '#0019ff'], 24, 5.5);

// 03 · Verse 1 — the cultural portrait is the focus, with a gentle inward ring veil.
portraitLight('03 · Odaa and Elder reveal in emerald, white and amber', 46, 20, [GREEN, WHITE, AMBER], 36);
motion('portraitCircle', 'portraitCircleLight', '03 · Gentle inward mist veil', 46, 20,
  { amplitude: 18, centre: -22, period: 5, path: 'together', low: 10, high: 28, colors: ['#0a003c'], lightHigh: 14, order: 'clockwise' });
varioBloom('03 · White Vario fan bloom and soft close', 46, 20, [WHITE], 18, 8);

// 04 · Pre-Chorus — radial rows open, then Vario fans rise and open.
waterLight('raysInner', 'raysInnerLight', '04 · Inner sunbeams ignite', 67, 7,
  { kind: 'custom', shape: 'drawn', path: 'around', motion: 'repeat', period: 7, crests: 1, points: [{ time: 0, value: 0 }, { time: 0.18, value: 1 }, { time: 0.7, value: 1 }, { time: 1, value: 0 }], low: 0, high: 72, ease: 0 }, [GOLD], 24);
waterLight('raysOuter', 'raysOuterLight', '04 · Outer sunbeams follow', 70, 7,
  { kind: 'custom', shape: 'drawn', path: 'around', motion: 'repeat', period: 7, crests: 1, points: [{ time: 0, value: 0 }, { time: 0.18, value: 1 }, { time: 0.7, value: 1 }, { time: 1, value: 0 }], low: 0, high: 78, ease: 0 }, [WHITE, GOLD], 24);
addRecipe(base('outerRing', '04 · Vario fans rise and open', 67, 22, { effect: 'curve', attribute: 'level', spread: 0, sampleRate: 10,
  envelope: [{ time: 0, value: 0.14 }, { time: 0.5, value: 1 }, { time: 1, value: 1 }] }), light('outerRingLight', '04 · Vario rising amber light', 67, 22, AMBER, 28));
rainbowFlow('04 · Rainbow side-to-center sunbeam', 67, 10, [GOLD, WHITE]);
for (const [role, lightRole] of [['infinity', 'infinityLight'], ['portraitCircle', 'portraitCircleLight']]) {
  for (const [parity, offset] of [['Odd', 0], ['Even', 1.75]]) {
    motion(`${role}${parity}`, lightRole, `04 · DNA scissor-cross · ${role} ${parity}`, 82, 7,
      { amplitude: 35, period: 3.5, offset, low: 30, high: 70, colors: [GOLD, '#0019ff'], lightHigh: 20, order: 'engineering' });
  }
}

// 04b · Circular whip before the DNA helix.
motion('portraitCircle', 'portraitCircleLight', '04b · Circular whip and mist vortex', 77, 5,
  { amplitude: 8, centre: 35, period: 0.8, direction: 1, low: 10, high: 50, colors: [GREEN], lightHigh: 18, order: 'clockwise' });

// 05 · Call and Response — bright inner calls, crimson/green infinity answers.
for (const [i, t] of [90, 96, 102].entries()) {
  motion('portraitCircle', 'portraitCircleLight', `05 · Lead call ${i + 1} · white/gold`, t, 3,
    { amplitude: 26, centre: -12, period: 3, path: 'together', low: 55, high: 82, colors: [WHITE], lightHigh: 30, order: 'clockwise' });
  shot('air20', t + 3, `05 · Both 20 m rings answer ${i + 1}`);
  rainbowFlow(`05 · Rainbow center-flow answer ${i + 1}`, t + 3, 3, [RED, GREEN]);
}
motion('infinity', 'infinityLight', '05 · Infinity opens inward on every answer', 90, 18,
  { amplitude: 48, centre: 0, period: 6, path: 'together', low: 42, high: 86, colors: [GREEN, RED], lightHigh: 26 });
varioBloom('05 · Vario wide-open answer and soft close', 90, 18, [RED, GREEN], 24, 6);
addRecipe(wave('portraitDMX', '05 · White portrait on each lead call', 90, 18,
  { kind: 'custom', shape: 'pulse', path: 'together', motion: 'repeat', period: 6, crests: 1, low: 0.5, high: 4, ease: 0.2, colorMode: 'sequence', colors: [WHITE] }));

// 06 · Chorus 1 Climax — central 50 m crown and opposing infinity waves.
crown50(109, '06 · Fifty-meter cathedral crown');
shot('air20', 111, '06 · All twenty 20 m cannons');
rainbowFlow('06 · Rainbow center-flow crown A', 109, 5.4, ['#0019ff']);
rainbowFlow('06 · Rainbow center-flow crown B', 114.7, 5.4, ['#0019ff']);
rainbowFlow('06 · Rainbow center-flow crown C', 120.4, 5.4, ['#0019ff']);
varioBloom('06 · Vario wide crown and partial close', 109, 17, ['#ff005a'], 28, 4);
motion('infinity', 'infinityLight', '06 · High inward-outward opposing 1D cross', 109, 17,
  { amplitude: 50, centre: 0, period: 3.2, opposite: true, crests: 2, low: 48, high: 90, colors: [GOLD, '#0019ff'], lightHigh: 28 });

// 07 · Instrumental interlude — mechanical figure-eight weave and snare scissors.
razor(127, '07 · Guitar-driven Razor Blade chase', 8);
motion('infinity', 'infinityLight', '07 · Full infinity scissor-flow finale', 131.4, 6.6,
  { amplitude: 50, centre: 0, period: 2.2, opposite: true, crests: 2, low: 42, high: 88, colors: [GOLD, WHITE], lightHigh: 24 });
rainbowFlow('07 · Rainbow guitar center-flow A', 127, 5.2, [PINK, WHITE]);
rainbowFlow('07 · Rainbow guitar center-flow B', 132.5, 5.2, [PINK, WHITE]);
motion('portraitCircle', 'portraitCircleLight', '07 · Circle 1D right-to-left traveling swing', 127, 3.6,
  { amplitude: 42, centre: 0, period: 1.8, direction: 1, low: 35, high: 82, colors: [BLUE, GOLD], lightHigh: 24, order: 'clockwise' });
motion('portraitCircle', 'portraitCircleLight', '07 · Circle 1D front-back swing', 130.6, 3.6,
  { amplitude: 44, centre: -10, period: 1.8, path: 'together', low: 38, high: 84, colors: [PINK, WHITE], lightHigh: 24, order: 'clockwise' });
motion('portraitCircle', 'portraitCircleLight', '07 · Circle 1D left-to-right scissor swing', 134.2, 3.8,
  { amplitude: 42, centre: 0, period: 1.9, direction: -1, opposite: true, low: 38, high: 86, colors: [GREEN, GOLD], lightHigh: 24, order: 'clockwise' });

// 08 · Verse 2 — Vario blooms, inner vortex and broad infinity breathing arcs.
varioBloom('08 · Vario wide-open bloom and gentle close', 139, 18, [GREEN, GOLD], 22, 4.5);
motion('portraitCircle', 'portraitCircleLight', '08 · Circle 1D left-to-right traveling swing', 139, 18,
  { amplitude: 38, centre: 0, period: 2.4, direction: -1, low: 18, high: 72, colors: [GREEN, GOLD], lightHigh: 20, order: 'clockwise' });
motion('infinity', 'infinityLight', '08 · Infinity slow inward embrace and release', 139, 18,
  { amplitude: 48, centre: 0, period: 6, path: 'together', low: 28, high: 78, colors: [GREEN, GOLD], lightHigh: 24 });
rainbowFlow('08 · Rainbow emerald center-flow', 139, 9, [GREEN, GOLD]);
rainbowFlow('08 · Rainbow golden center-flow', 148, 9, [GOLD, WHITE]);

// 09 · Extended Naanaa horse-gallop — left loop, central X, right loop.
pop20(158, '09 · Alternating left-right cannon pops');
shot('air20', 170, '09 · Gallop snare break · all twenty');
for (const [cycle, t] of [158, 163.4, 168.8].entries()) {
  for (const [step, role, offset] of [['Left', 'infinityLeft', 0], ['Center', 'infinityCenter', 1.6], ['Right', 'infinityRight', 3.2]]) {
    motion(role, `${role}Light`, `09 · Gallop ${cycle + 1} · ${step} inward-outward`, t + offset, 1.4,
      { amplitude: 42, centre: 0, period: 1.4, path: 'together', low: 8, high: 84, colors: [WHITE, GREEN, BLUE], lightHigh: 24 });
  }
}
rainbowFlow('09 · Rainbow gallop center-flow A', 179.6, 8, [GREEN, WHITE]);
rainbowFlow('09 · Rainbow gallop center-flow B', 190.4, 8, [BLUE, GOLD]);
varioBloom('09 · Vario gallop wide bloom and soft close', 158, 40, [GREEN, GOLD], 24, 5.4);
shot('air20', 201, '09 · Gallop finale · all twenty');

// 10 · Verse 3 & Geerarsa — solid red/gold wall and twin 50 m drop.
waterLight('allStraight', 'allStraightLight', '10 · Geerarsa towering red/gold wall', 199, 59,
  { kind: 'custom', shape: 'sine', path: 'around', motion: 'repeat', period: 5, crests: 2, low: 52, high: 86, ease: 0.4 }, [RED, GOLD], 28);
rainbowFlow('10 · Rainbow heroic center-flow A', 199, 12, [RED, GOLD]);
rainbowFlow('10 · Rainbow heroic center-flow B', 227, 10, [RED, GOLD]);
volley50(246, '10 · Bulloo drop · all ten 50 m');
addRecipe(light('outerRingLight', '10 · Shadow magenta', 246, 4, '#ff005a', 26));

// 11 · Obsa bridge — quiet portrait, then an inward cathedral canopy.
portraitLight('11 · Obsa portrait in pure white and emerald', 259, 28, [WHITE, GREEN], 36);
varioBloom('11 · White Vario fan bloom and gentle close', 259, 21, [WHITE], 18, 8);
motion('infinity', 'infinityLight', '11 · Cathedral canopy inward and release', 281, 6,
  { amplitude: 35, centre: -20, period: 6, path: 'together', low: 38, high: 68, colors: ['#0a003c'], lightHigh: 16 });
rainbowFlow('11 · Rainbow quiet center-flow canopy', 281, 6, ['#0019ff'], 18);

// 12 · Grand Finale — air volleys, full 1D starbursts, staccato and hard freeze.
crown50(288, '12 · Grand finale · staggered 50 m crown');
shot('air20Left', 288, '12 · Left 20 m opening volley');
shot('air20Right', 294, '12 · Right 20 m answering volley');
shot('air20Left', 300, '12 · Left 20 m final chase');
shot('air20Right', 306, '12 · Right 20 m final chase');
shot('air20', 312, '12 · Final all twenty 20 m cannons');
motion('infinity', 'infinityLight', '12 · Full-power infinity starburst', 288, 18,
  { amplitude: 50, period: 2.6, opposite: true, crests: 2, low: 62, high: 92, colors: [GOLD, '#0019ff'], lightHigh: 26 });
motion('portraitCircle', 'portraitCircleLight', '12 · Full-power inner-ring starburst', 288, 18,
  { amplitude: 46, period: 3.2, opposite: true, low: 58, high: 88, colors: [WHITE, GOLD, GREEN], lightHigh: 24, order: 'clockwise' });
rainbowFlow('12 · Rainbow finale center-flow A', 288, 6, [PINK, GOLD], 26);
rainbowFlow('12 · Rainbow finale center-flow B', 294, 6, [PINK, GOLD], 26);
rainbowFlow('12 · Rainbow finale center-flow C', 300, 6, [PINK, GOLD], 26);
varioBloom('12 · Vario magenta and gold fan finale', 288, 18, [PINK, GOLD], 28, 3.2);
waterLight('allStraight', 'allStraightLight', '12 · Full-power straight-nozzle starburst', 288, 18,
  { kind: 'custom', shape: 'sine', path: 'around', motion: 'repeat', period: 2.6, crests: 2, low: 58, high: 88, ease: 0.2 }, [WHITE, GOLD, RED, GREEN], 26);
waterLight('allRegular', 'waterDMX', '12 · Staccato bursts on every beat', 306, 14,
  { kind: 'custom', shape: 'pulse', path: 'around', motion: 'repeat', period: 0.8, crests: 1, width: 0.18, low: 10, high: 92, ease: 0 }, [WHITE], 28);
addRecipe(hold('allNozzles', '12 · Simultaneous vertical burst', 321, 0.25, 100), light('allLights', '12 · Cool-white blinder', 321, 0.12, '#e6f5ff', 100));
addRecipe(light('waterDMX', '12 · Warm-gold hanging mist', 321.12, 5, '#ffa01e', 30),
  ramp('portraitDMX', '12 · Slow portrait fade after hard freeze', 321.4, END - 321.4, 4, 0, GREEN));

const studio = { ...source.programmer.studio, groups: studioGroups, recipes, tempo: [{ time: 0, bpm: BPM }],
  markers: [[0, 'Intro & Drum Ignition'], [23, 'First Dance Drop & Horn Stabs'], [46, 'Verse 1'], [67, 'Pre-Chorus'], [90, 'Call and Response'], [109, 'Chorus 1 Climax'],
    [127, 'Instrumental Interlude'], [139, 'Verse 2'], [158, 'Horse Gallop'], [199, 'Verse 3 & Geerarsa'], [259, 'Obsa Bridge'], [288, 'Grand Finale'], [321, 'Hard Freeze']]
    .map(([time, name], i) => ({ id: `section-${i + 1}`, time, name, kind: 'section', color: GREEN })) };
const items = inventory(fixtures);
const { clips, issues } = compileStudio(studio, items);
if (issues.length) throw new Error(`${issues.length} show compile issues: ${issues.slice(0, 20).join(' | ')}`);
if (fixtures.length !== 1846 || allLightIds.length !== 1140 || allNozzleIds.length !== 706 || oneDIds.length !== 262) throw new Error('Unexpected DWG fixture counts');
const lastByFixture = new Map();
for (const clip of clips.filter(c => /^air-(20m|50m)-/.test(c.fixtureId) && /^(device_intensity|pump_speed|motion_intensity)$/.test(c.type))) {
  const cycle = clip.fixtureId.startsWith('air-20m') ? 6 : 25, previous = lastByFixture.get(clip.fixtureId);
  if (previous !== undefined && clip.startTime - previous < cycle - 0.001) throw new Error(`Air-blast refill violation at ${clip.fixtureId} ${clip.startTime}`);
  lastByFixture.set(clip.fixtureId, clip.startTime);
}
let maxMotionSpeed = 0;
for (const clip of clips.filter(c => c.type === 'motion_angle' && c.keys?.length > 3)) {
  for (let i = 2; i < clip.keys.length; i += 2) {
    const dt = clip.keys[i] - clip.keys[i - 2]; if (dt <= 0) continue;
    const degrees = k => clip.motionOffset === undefined ? -45 + clip.keys[k + 1] * 0.9 : clip.motionOffset + clip.motionScale * clip.keys[k + 1];
    maxMotionSpeed = Math.max(maxMotionSpeed, Math.abs(degrees(i) - degrees(i - 2)) / dt);
  }
}
if (maxMotionSpeed > 90.01) throw new Error(`Compiled motion exceeds 90 degrees/second: ${maxMotionSpeed}`);
const byTrack = new Map();
for (const clip of clips) (byTrack.get(clip.trackId) || byTrack.set(clip.trackId, []).get(clip.trackId)).push(clip);
const now = new Date().toISOString(), name = 'Odaa and Elder — 3Obsa Musical Infinity';
source.timelineTracks = items.flatMap(item => (item.tracks || []).map(track => ({ id: track.id, fixtureId: item.id, deviceId: item.id,
  label: `${item.label} · ${String(track.type).replaceAll('_', ' ')}`, type: track.type, color: track.color || '#65d9d0', muted: false, solo: false, clips: byTrack.get(track.id) || [] })));
const audioBytes = fs.readFileSync(audioPath), audioStat = fs.statSync(audioPath), sha256 = crypto.createHash('sha256').update(audioBytes).digest('hex');
const audioName = 'Yosan_Getahun_3Obsa.m4a', packaged = `assets/audio_programmer--${audioName}`;
source.programmer = { ...source.programmer, studio, timelineClips: clips, cues: [], audioDuration: END,
  audioFile: null, audioFileReference: { name: audioName, path: path.resolve(audioPath), size: audioStat.size, type: 'audio/mp4', lastModified: audioStat.mtimeMs },
  musicCache: { analysis }, stems: null, patternDefinitions: [{ id: 'odaa-3obsa-328s', name, duration: END }] };
source.show = { ...source.show, id: 'aquaflow-odaa-3obsa-show', name, bpm: BPM, duration: END, loop: false };
source.project = { ...source.project, id: 'aquaflow-odaa-3obsa-musical', name, revision: 1, createdAt: now, modifiedAt: now };
source.assetManifest = { format: 'aquaflow-asset-manifest', version: 1, generatedAt: now, projectPath: out, assets: [{ id: 'audio:programmer', role: 'audio', source: 'file',
  name: audioName, type: 'audio/mp4', path: path.resolve(audioPath), size: audioStat.size, locator: { field: 'programmer.audioFileReference' }, packaged, sha256 }] };
const camera = (t, position, target, fov = 42, ease = 'smooth') => ({ id: `camera-${t}`, t, position: { x: position[0], y: position[1], z: position[2] }, target: { x: target[0], y: target[1], z: target[2] }, fov, roll: 0, ease });
const cameraKeys = [
  camera(0, [34, 32, -46], [0, 4, 0], 46), camera(7.55, [16, 20, -42], [0, 7, 0], 50, 'cut'),
  camera(7.59, [0, 8, -46], [0, 7, 0], 56), camera(22.9, [0, 15, -50], [0, 8, 0], 54, 'cut'),
  camera(23, [-34, 5, -18], [-5, 9, 0], 56), camera(45.9, [34, 7, -22], [5, 9, 0], 56, 'cut'),
  camera(46, [0, 48, -16], [0, 0, 0], 44), camera(66.9, [18, 40, -24], [0, 0, 0], 46, 'cut'),
  camera(67, [-26, 5, -28], [0, 6, 0], 54), camera(89.9, [26, 8, -30], [0, 7, 0], 54, 'cut'),
  camera(90, [-28, 9, -32], [0, 9, 0], 56), camera(99, [0, 12, -46], [0, 10, 0], 56), camera(108.95, [28, 9, -32], [0, 10, 0], 56, 'cut'),
  camera(109, [0, 14, -68], [0, 16, 0], 60), camera(126.9, [0, 28, -72], [0, 16, 0], 58, 'cut'),
  camera(127, [-36, 6, -20], [-5, 6, 0], 52), camera(138.9, [36, 7, -20], [5, 6, 0], 52, 'cut'),
  camera(139, [32, 36, -30], [0, 4, 0], 48), camera(157.9, [-30, 42, -28], [0, 4, 0], 48, 'cut'),
  camera(158, [-34, 5, -18], [-8, 6, 0], 54), camera(179, [0, 8, -34], [0, 7, 0], 54), camera(198.9, [34, 7, -24], [8, 7, 0], 54, 'cut'),
  camera(199, [0, 10, -60], [0, 10, 0], 56), camera(226.9, [0, 20, -64], [0, 12, 0], 56, 'cut'),
  camera(227, [-30, 8, -38], [0, 9, 0], 56), camera(245.9, [30, 12, -40], [0, 10, 0], 56, 'cut'),
  camera(246, [0, 14, -72], [0, 18, 0], 62), camera(258.9, [0, 28, -76], [0, 16, 0], 58, 'cut'),
  camera(259, [0, 62, -0.01], [0, 0, 0], 46), camera(280.9, [20, 45, -20], [0, 2, 0], 48, 'cut'),
  camera(281, [0, 10, -48], [0, 8, 0], 54), camera(287.9, [12, 18, -50], [0, 9, 0], 54, 'cut'),
  camera(288, [35, 30, -50], [0, 18, 0], 58), camera(305.9, [-35, 26, -48], [0, 18, 0], 58, 'cut'),
  camera(306, [0, 10, -58], [0, 12, 0], 58), camera(320.9, [0, 16, -60], [0, 12, 0], 56, 'cut'),
  camera(321, [0, 10, -54], [0, 10, 0], 56), camera(END, [0, 14, -50], [0, 8, 0], 54)
];
source.render = { ...source.render, environment: 'night', cameraMode: 'animated', activeCameraView: null, realWorld: true, windX: 0, windZ: 0,
  cameraTrack: { enabled: true, keys: cameraKeys },
  cameraViews: [{ id: 'front', name: 'Audience · Bellagio low front', position: { x: 0, y: 6, z: -50 }, target: { x: 0, y: 20, z: 0 }, fov: 60 },
    { id: 'side', name: 'Side tracking · left', position: { x: -34, y: 5, z: -18 }, target: { x: 0, y: 10, z: 0 }, fov: 54 },
    { id: 'drone', name: 'Drone · south-east', position: { x: 34, y: 32, z: -46 }, target: { x: 0, y: 4, z: 0 }, fov: 46 },
    { id: 'top', name: 'Top · portrait and DWG plan', position: { x: 0, y: 62, z: -0.01 }, target: { x: 0, y: 0, z: 0 }, fov: 46 }] };
source.workspace = { activePanel: 'preview' };
source.savedAt = now;
const notes = `${name}\n\nCINEMATIC MUSIC-PROGRAMMED 5:28 SHOW\nTrack: Yosan Getahun - 3Obsa. Audio duration ${END} s; measured grid ${BPM} BPM. Source: https://youtu.be/8zlm6JVbi2U. Ten master groups plus left/center/right infinity, six Diagonal Rainbow manifolds, two ten-cannon 20 m rings and one ten-cannon 50 m decagon are editable in the timeline. Portrait/nozzle-wash DMX remain separate. Infinity 1D nozzles perform repeated inward/outward dances; rainbows flow from both sides to the center and back. VarioDrop rings open to 9 m and partially close to 2–3 m in traveling blooms. Blast pulses last 2.4 s at 20 m and 3.8 s at 50 m. Bellagio-inspired camera work combines low audience shots, side tracking, orbital moves, drone views and musical cuts.\n\nThe 12 sections follow the supplied timecode plan: first pulse 00:07.59, horn/drop 00:23, portrait verse 00:46, Vario build 01:07, call/response 01:30, central 50 m crown 01:49, guitar weave 02:07, Verse 2 02:19, gallop 02:38, Geerarsa 03:19, Bulloo 04:06, Obsa canopy 04:41, finale 04:48 and hard freeze 05:21 followed by portrait fade.\n\nAir-blast scheduling enforces >=6 s between shots on each 20 m nozzle and >=25 s on each 50 m nozzle. Maximum compiled 1D speed is ${r3(maxMotionSpeed)} degrees/second. This 1,846-fixture show includes 1,140 DMX lights and 706 nozzles, including 30 air blasts. This is a simulated musical concept, not commissioned hardware. Audio is embedded in the package; no external asset is needed for playback.\n`;
fs.writeFileSync(out, createZip([{ name: 'project.aqua', data: JSON.stringify(source) }, { name: 'manifest.json', data: JSON.stringify(source.assetManifest, null, 2) },
  { name: 'design-notes.txt', data: notes }, { name: 'music-analysis.json', data: JSON.stringify(analysis) }, { name: packaged, data: audioBytes }]));
console.log(JSON.stringify({ out, fixtures: fixtures.length, dmx: allLightIds.length, nozzles: allNozzleIds.length, groups: studioGroups.length,
  patterns: recipes.length, clips: clips.length, duration: END, maxMotionSpeed: r3(maxMotionSpeed), audioSha256: sha256, bytes: fs.statSync(out).size }, null, 2));
