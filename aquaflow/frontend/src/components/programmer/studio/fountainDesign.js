// Fountain design reader — what the Engineering design says about the water, so the music
// generator can give every part of the fountain a pattern it can really perform. Pure.
//
//   parts      nozzles (by kind: straight jet, rotating basket, shooter, geyser, ring …),
//              solenoid valves, pumps and lights, from the fixture type, name and datasheet fields
//   links      nozzle → its solenoid (engineering.solenoidValveId / linkedValveId / the valve's
//              controlledFixtureId), nozzle → its pump (pumpId / supplyingPumpId / the pump's
//              servesValveIds), light → its nozzle (pairedNozzleId, else the nearest nozzle)
//   control    'switch'  own solenoid: the jet turns on / off by itself; its height is its pump's
//              'pump'    no valve, shares a pump: rises and falls together with that pump's jets
//              'height'  own height control (own pump / VFD, or a jet driven directly)
//   areas      nozzles of one design group and kind, split by where they stand in the fountain
//              (front / back / left / right / centre) — the units the music is laid onto

import { getFixtureInfo } from '../../../utils/fixtureTypeResolver';
import { isLightItem, isWaterItem } from './patternPresets';
import { orderMembers } from './showModel';

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const slug = (s) => String(s || 'set').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'set';

/** Nozzle kinds, first match wins (tested on type, name, style, model and runtime effect). */
export const NOZZLE_KINDS = [
  { id: 'basket', test: /basket|pirouette|rotat|spinner|whirl/i, label: 'rotating baskets', moving: true },
  { id: 'swing', test: /swing|moving|dancing|oscillat|robot|\b[23]d\b|\bpan\b|tilt/i, label: 'moving nozzles', moving: true },
  { id: 'shooter', test: /shoot|cannon|blast|super[_ -]?jet|high[_ -]?jet/i, label: 'shooters' },
  { id: 'mist', test: /mist|fog/i, label: 'mist' },
  { id: 'geyser', test: /geyser|foam|aerat|bubbl|cascade|snow|frost/i, label: 'geysers' },
  { id: 'curtain', test: /curtain|screen|peacock|sheet|\bfan\b|water[_ -]?wall/i, label: 'curtains / fans' },
  { id: 'ring', test: /ring|crown|tulip|flower|dandelion|lotus|halo|trumpet|bell|mushroom/i, label: 'rings / flowers' },
  { id: 'jumping', test: /jump|laminar|leap/i, label: 'jumping jets' },
  { id: 'jet', test: /./, label: 'straight jets' },
];
export const POSITIONS = ['centre', 'front', 'back', 'left', 'right'];
const POSITION_LABEL = { centre: 'Centre', front: 'Front', back: 'Back', left: 'Left', right: 'Right' };
export const MIRROR_OF = { left: 'right', right: 'left', front: 'back', back: 'front' };

const hasTrack = (item, re) => (item?.tracks || []).some((t) => re.test(t.type));

/** 'nozzle' | 'valve' | 'pump' | 'light' | null */
export function partRole(item) {
  if (!item || item.category === 'scenery') return null;
  if (isLightItem(item)) return 'light';
  const info = getFixtureInfo(item.type);
  const type = String(item.type || '');
  if (info?.category === 'solenoid' || /valve|solenoid/i.test(type)) return 'valve';
  // The fixture library files nozzles under "pump" too: a real pump says so in its type or
  // carries pump duty data (motor power, served valves) instead of a jet height.
  const e = item.engineering || {};
  if ((/pump/i.test(type) && !/^nozzle_/i.test(type)) || Array.isArray(e.servesValveIds)
    || (num(e.powerKw) > 0 && !(num(e.jetHeightM) > 0))) return 'pump';
  return isWaterItem(item) ? 'nozzle' : null;
}

/** The kind of a nozzle from its type, name and datasheet fields. */
export function nozzleKind(item) {
  const e = item?.engineering || {};
  if (hasTrack(item, /^motion_(pan|tilt|angle)$/)) return NOZZLE_KINDS.find((k) => k.id === 'swing');
  // Type and datasheet fields first; the name only when they say nothing, and without layout
  // words ("perimeter ring", "front row") that describe where a jet stands, not what it is.
  const spec = [item?.type, e.nozzleStyle, e.equipmentModel, e.runtimeEffect, e.group].filter(Boolean).join(' ').replace(/_/g, ' ');
  const byType = NOZZLE_KINDS.find((k) => k.id !== 'jet' && k.test.test(spec));
  if (byType) return byType;
  const LAYOUT = /\b(ring|rings|row|rows|line|lines|perimeter|circle|arc|loop|centre|center|front|back|left|right|inner|outer)\b/gi;
  const name = String(item?.label || '').replace(/_/g, ' ').replace(LAYOUT, ' ');
  return NOZZLE_KINDS.find((k) => k.test.test(name)) || NOZZLE_KINDS.at(-1);
}

const shortName = (item) => String(item?.label || item?.id || '').split(/\s+[-–·]\s+/)[0];

/**
 * Read the fountain from the show inventory (items from showModel.inventory).
 * @returns {{ nozzles, valves, pumps, lights, areas, links, summary, connected }}
 */
export function readFountainDesign(items = []) {
  const byRole = { nozzle: [], valve: [], pump: [], light: [] };
  for (const item of items) { const role = partRole(item); if (role) byRole[role].push(item); }
  const valveById = new Map(byRole.valve.map((v) => [v.id, v]));
  const pumpById = new Map(byRole.pump.map((p) => [p.id, p]));
  const valveByNozzle = new Map();
  for (const v of byRole.valve) {
    const target = v.engineering?.controlledFixtureId || v.controlledFixtureId;
    if (target) valveByNozzle.set(target, v.id);
  }
  const pumpByValve = new Map();
  for (const p of byRole.pump) for (const id of p.engineering?.servesValveIds || []) pumpByValve.set(id, p.id);

  const nozzles = byRole.nozzle.map((item) => {
    const e = item.engineering || {};
    const valveId = [e.solenoidValveId, item.linkedValveId, e.linkedValveId, e.valveId, valveByNozzle.get(item.id)].find((id) => valveById.has(id)) || null;
    const pumpId = [e.pumpId, item.supplyingPumpId, e.supplyingPumpId, pumpByValve.get(valveId)].find((id) => pumpById.has(id)) || null;
    const kind = nozzleKind(item);
    return { id: item.id, item, kind: kind.id, kindLabel: kind.label, moving: !!kind.moving, heightM: num(e.jetHeightM),
      valveId, pumpId, pipeId: e.pipeId || null, set: item.zone || item.groupId || kind.id, lightIds: [] };
  });
  const nozzleById = new Map(nozzles.map((n) => [n.id, n]));
  const pumps = new Map(byRole.pump.map((p) => [p.id, { id: p.id, item: p, name: shortName(p), nozzleIds: [], valveIds: [] }]));
  for (const n of nozzles) if (n.pumpId) {
    pumps.get(n.pumpId).nozzleIds.push(n.id);
    if (n.valveId) pumps.get(n.pumpId).valveIds.push(n.valveId);
  }
  for (const n of nozzles) {
    const valve = n.valveId && valveById.get(n.valveId);
    n.control = valve && hasTrack(valve, /^solenoid_open$/) ? 'switch'
      : n.pumpId && pumps.get(n.pumpId).nozzleIds.length > 1 ? 'pump' : 'height';
  }
  const valves = new Map(byRole.valve.map((v) => [v.id, { id: v.id, item: v, nozzleIds: nozzles.filter((n) => n.valveId === v.id).map((n) => n.id) }]));

  // Lights: paired nozzle, else the nearest nozzle.
  const lights = byRole.light.map((item) => {
    let nozzleId = [item.engineering?.pairedNozzleId, item.pairedNozzleId].find((id) => nozzleById.has(id)) || null;
    if (!nozzleId && nozzles.length) {
      let best = Infinity;
      for (const n of nozzles) {
        const d = Math.hypot(num(n.item.x) - num(item.x), num(n.item.y) - num(item.y));
        if (d < best) { best = d; nozzleId = n.id; }
      }
    }
    if (nozzleId) nozzleById.get(nozzleId).lightIds.push(item.id);
    return { id: item.id, item, nozzleId };
  });

  // Where each nozzle stands: the fountain's own frame (front = +y on plan, as Engineering draws it).
  const xs = nozzles.map((n) => num(n.item.x)), ys = nozzles.map((n) => num(n.item.y));
  const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0, cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  const hw = Math.max(0.5, xs.length ? (Math.max(...xs) - Math.min(...xs)) / 2 : 1), hh = Math.max(0.5, ys.length ? (Math.max(...ys) - Math.min(...ys)) / 2 : 1);
  const positionOf = (x, y) => {
    const u = (x - cx) / hw, v = (y - cy) / hh;
    if (Math.hypot(u, v) < 0.3) return 'centre';
    return Math.abs(u) >= Math.abs(v) ? (u < 0 ? 'left' : 'right') : (v > 0 ? 'front' : 'back');
  };
  const sets = new Map();
  for (const n of nozzles) {
    const key = `${n.set}|${n.kind}`;
    if (!sets.has(key)) sets.set(key, []);
    sets.get(key).push(n);
  }
  for (const list of sets.values()) {
    const sx = list.map((n) => num(n.item.x)), sy = list.map((n) => num(n.item.y));
    const mx = sx.reduce((a, b) => a + b, 0) / list.length, my = sy.reduce((a, b) => a + b, 0) / list.length;
    const extent = Math.max((Math.max(...sx) - Math.min(...sx)) / (2 * hw), (Math.max(...sy) - Math.min(...sy)) / (2 * hh));
    // A straight line or a compact cluster is one instrument and stays whole (placed by its
    // centre); a large ring or perimeter is split by side. A compact set near the middle is the centre.
    const spanX = Math.max(...sx) - Math.min(...sx), spanY = Math.max(...sy) - Math.min(...sy);
    const long = Math.max(spanX, spanY), short = Math.min(spanX, spanY);
    const linear = list.length >= 3 && long > 4 && short < 0.15 * long;
    const nearMiddle = Math.hypot((mx - cx) / hw, (my - cy) / hh) < 0.35;
    const whole = linear || extent < 0.4 || (nearMiddle && extent < 0.6);
    const setPosition = nearMiddle && !linear ? 'centre' : positionOf(mx, my);
    for (const n of list) n.position = whole ? setPosition : positionOf(num(n.item.x), num(n.item.y));
  }

  const areaMap = new Map();
  for (const n of nozzles) {
    const id = `design:${slug(n.set)}:${n.kind}:${n.position}`;
    if (!areaMap.has(id)) areaMap.set(id, { id, set: n.set, kind: n.kind, kindLabel: n.kindLabel, moving: n.moving, position: n.position, nozzleIds: [] });
    areaMap.get(id).nozzleIds.push(n.id);
  }
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const areas = [...areaMap.values()].map((a) => {
    const members = a.nozzleIds.map((id) => nozzleById.get(id));
    const count = {};
    for (const m of members) count[m.control] = (count[m.control] || 0) + 1;
    const control = Object.entries(count).sort((x, y) => y[1] - x[1])[0][0];
    const pumpIds = [...new Set(members.map((m) => m.pumpId).filter(Boolean))];
    const ordered = orderMembers(a.nozzleIds, [...itemsById.values()], 'clockwise').map((m) => m.id);
    return { ...a, nozzleIds: ordered, control, size: members.length,
      heightM: Math.max(0, ...members.map((m) => m.heightM)),
      valveIds: members.map((m) => m.valveId).filter(Boolean),
      pumpIds, lightIds: orderMembers(members.flatMap((m) => m.lightIds), [...itemsById.values()], 'clockwise').map((m) => m.id),
      sharesPumpWith: [], name: '' };
  }).sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) || b.size - a.size);
  // Names: "Front · straight jets", made unique with the design group's name when needed.
  const base = (a) => `${POSITION_LABEL[a.position]} · ${a.kindLabel}`;
  const clash = new Map();
  areas.forEach((a) => clash.set(base(a), (clash.get(base(a)) || 0) + 1));
  for (const a of areas) a.name = clash.get(base(a)) > 1 ? `${base(a)} (${String(a.set).replace(/[-_]+/g, ' ')})` : base(a);
  for (const a of areas) a.sharesPumpWith = areas.filter((b) => b !== a && b.pumpIds.some((p) => a.pumpIds.includes(p))).map((b) => b.id);
  for (const a of areas) a.summary = areaSummary(a, pumps);

  // Design tips: jets without valves on a pump that also feeds other areas cannot move on their own.
  const tips = [];
  for (const a of areas.filter((x) => x.control === 'pump')) {
    for (const pid of a.pumpIds) {
      const others = pumps.get(pid).nozzleIds.filter((id) => !a.nozzleIds.includes(id)).length;
      if (others) tips.push(`${a.name} share ${pumps.get(pid).name} with ${others} other jet${others === 1 ? '' : 's'}: they rise whenever those jets fire. `
        + 'Give them their own pump (VFD) or a valve each so the music can move them on their own.');
    }
  }
  const links = new Map(nozzles.filter((n) => n.valveId).map((n) => [n.id, n.valveId]));
  const connected = nozzles.some((n) => n.valveId || n.pumpId);
  return {
    nozzles, nozzleById, valves, pumps, lights, areas, links, connected, tips,
    summary: `${nozzles.length} nozzle${nozzles.length === 1 ? '' : 's'} in ${areas.length} area${areas.length === 1 ? '' : 's'}`
      + ` · ${valves.size} solenoid${valves.size === 1 ? '' : 's'} · ${pumps.size} pump${pumps.size === 1 ? '' : 's'} · ${lights.length} light${lights.length === 1 ? '' : 's'}`,
  };
}

const CONTROL_TEXT = {
  switch: 'own solenoid each: on / off by jet, height from the pump',
  pump: 'no valves: rise and fall together with their pump',
  height: 'own height control per jet',
};

function areaSummary(a, pumps) {
  const pumpNames = a.pumpIds.map((id) => pumps.get(id)?.name).filter(Boolean);
  const parts = [`${a.size} ${a.kindLabel}`, a.heightM ? `${Math.round(a.heightM * 10) / 10} m` : null, CONTROL_TEXT[a.control],
    pumpNames.length ? `fed by ${pumpNames.join(', ')}` : null, a.lightIds.length ? `${a.lightIds.length} light${a.lightIds.length === 1 ? '' : 's'}` : null];
  return parts.filter(Boolean).join(' · ');
}

/** Builder groups for the design: one water group per area and one for its lights. */
export function designGroups(design) {
  const out = [];
  for (const a of design.areas) {
    out.push({ id: a.id, name: a.name, memberFixtureIds: a.nozzleIds, orderMode: 'clockwise', color: '#65d9d0', quick: true, source: 'Fountain design', area: a.id });
    if (a.lightIds.length) out.push({ id: `${a.id}:lights`, name: `${a.name} · lights`, memberFixtureIds: a.lightIds, orderMode: 'clockwise', color: '#f5c86b', quick: true, source: 'Fountain design', area: a.id });
  }
  return out;
}
