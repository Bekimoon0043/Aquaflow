// Timeline ownership: who a pattern clip belongs to (a group or a single item).
// Pure helpers shared by every timeline view, so a clip always shows its owner's name and
// colour the same way: clip owner chip, row-label swatch, tooltip.
import { autoGroups, resolveMembers } from './showModel';
import { TRACK_LABEL } from './plcLimits';

/** The colour every new group/recipe gets by default; treated as "no colour chosen". */
export const DEFAULT_GROUP_COLOR = '#65d9d0';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** FNV-1a 32-bit hash: stable across sessions and machines. */
export function hashString(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text ?? '')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * An owner's colour: its own colour when the user chose one, otherwise a stable colour
 * derived from its id (golden-angle hue steps keep neighbouring ids apart).
 */
export function ownerColor(id, color) {
  if (typeof color === 'string' && HEX_COLOR.test(color) && color.toLowerCase() !== DEFAULT_GROUP_COLOR) return color;
  const hue = Math.round((hashString(id) % 360) * 137.508) % 360;
  return `hsl(${hue} 62% 60%)`;
}

const KINDS = [
  ['light', /light|led|lamp|rgb|par|spot|wash/],
  ['jet', /jet|nozzle|shooter|vario|geyser|fountain|spray|mist|ring|swing|oarsm|head|curtain|cannon|blast/],
  ['pump', /pump|vfd|inverter/],
  ['valve', /valve|solenoid/],
  ['flame', /flame|fire|pyro/],
  ['laser', /laser/],
];
const kindOf = item => {
  const text = `${item?.type || ''} ${item?.category || ''}`.toLowerCase();
  return KINDS.find(([, re]) => re.test(text))?.[0] || 'device';
};

/** The noun for a set of items: "jets" when they are all jets, else "devices". */
export function memberNoun(ids = [], items = []) {
  const byId = items instanceof Map ? items : new Map(items.map(i => [i.id, i]));
  const kinds = new Set(ids.map(id => kindOf(byId.get(id))));
  return kinds.size === 1 ? [...kinds][0] : 'device';
}

export const countLabel = (count, noun = 'device') => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Lookup tables for one studio + inventory; build once per render (useMemo). */
export function ownershipIndex(studio, items = []) {
  const byId = new Map(items.map(i => [i.id, i]));
  const groups = new Map((studio?.groups || []).map(g => [g.id, g]));
  const cache = new Map();
  const group = id => {
    if (id == null) return null;
    if (cache.has(id)) return cache.get(id);
    let g = groups.get(id);
    // Automatic (engineering) groups are referenced by id only: auto:<dimension>:<key>.
    if (!g && typeof id === 'string' && id.startsWith('auto:')) {
      const dimension = id.split(':')[1];
      g = autoGroups(items, dimension).find(x => x.id === id) || null;
    }
    const owner = g ? groupOwner(g, items, byId) : { kind: 'group', id, name: 'Missing group', color: ownerColor(id), count: 0, noun: 'device', missing: true };
    cache.set(id, owner);
    return owner;
  };
  const item = (id, channel) => itemOwner(byId.get(id) || { id, label: 'Missing fixture', missing: true }, channel);
  return { group, item, byId };
}

export function groupOwner(group, items = [], byId = null) {
  const members = resolveMembers(group, items);
  return {
    kind: 'group', id: group.id, name: group.name || 'Group', color: ownerColor(group.id, group.color),
    count: members.length, noun: memberNoun(members, byId || items), auto: !!group.linkedQuery,
  };
}

export function itemOwner(item, channel) {
  return {
    kind: 'item', id: item.id, name: item.label || item.name || item.type || 'Item', color: ownerColor(item.id, item.color),
    count: 1, noun: kindOf(item), channel: channel ? (TRACK_LABEL[channel] || channel) : null, missing: !!item.missing,
  };
}

/** Owner of a Show Studio recipe (its group). */
export const ownerOfRecipe = (recipe, index) => index.group(recipe?.groupId);

/** Owner of a legacy fixture clip (its fixture + channel). */
export const ownerOfLegacyClip = (clip, index) => index.item(clip?.fixtureId, clip?.type);

/** Owner of a clip in StudioTimeline (recipe or legacy clip). */
export const ownerOfClip = (clip, index) => (clip && clip.fixtureId !== undefined && clip.groupId === undefined
  ? ownerOfLegacyClip(clip, index) : ownerOfRecipe(clip, index));

/**
 * Owner of a 3D-preview sequence block. Water/motion group first; a separate lights group
 * is returned as `also`. Recorded blocks belong to their fixtures.
 */
export function ownerOfBlock(block, index, legacyClips = []) {
  if (!block) return null;
  if (block.type === 'recorded') {
    const ids = new Set(block.legacyIds || []);
    const fixtures = [...new Set(legacyClips.filter(c => ids.has(c.id)).map(c => c.fixtureId))];
    if (fixtures.length === 1) return index.item(fixtures[0]);
    return { kind: 'items', id: `items:${fixtures.join(',')}`, name: countLabel(fixtures.length, memberNoun(fixtures, index.byId)),
      color: ownerColor(fixtures.join(',') || block.id), count: fixtures.length, noun: memberNoun(fixtures, index.byId) };
  }
  const primary = index.group(block.motion?.groupId || block.water?.groupId);
  const lightsId = block.lights?.groupId;
  const also = lightsId && lightsId !== primary?.id ? index.group(lightsId) : null;
  return also ? { ...primary, also } : primary;
}

/** "Group · 24 jets", "Item · Speed", "Auto group · 6 lights". */
export function ownerSummary(owner) {
  if (!owner) return '';
  if (owner.kind === 'item') return `Item${owner.channel ? ` · ${owner.channel}` : ''}`;
  if (owner.kind === 'items') return `Items · ${owner.name}`;
  if (owner.kind === 'track') return `Track${owner.channel ? ` · ${owner.channel}` : ''}`;
  return `${owner.auto ? 'Auto group' : 'Group'} · ${countLabel(owner.count, owner.noun)}`;
}

/** Short text for the clip chip: the owner's name (plus the item's channel). */
export function ownerLabel(owner) {
  if (!owner) return '';
  return owner.kind === 'item' && owner.channel ? `${owner.name} · ${owner.channel}` : owner.name;
}

const sec = value => `${(Math.round((Number(value) || 0) * 100) / 100).toFixed(2).replace(/\.?0+$/, '')} s`;

/** Multi-line hover text for a clip: owner, members, pattern, time span, level. */
export function clipTooltip({ owner, name, kind, start, duration, level }) {
  const lines = [];
  if (owner) {
    lines.push(`${ownerLabel(owner)} — ${ownerSummary(owner)}`);
    if (owner.also) lines.push(`Lights: ${owner.also.name} — ${ownerSummary(owner.also)}`);
  }
  lines.push(`Pattern: ${name || 'Clip'}${kind ? ` (${kind})` : ''}`);
  if (Number.isFinite(Number(start))) lines.push(`${sec(start)} – ${sec(Number(start) + (Number(duration) || 0))} (${sec(duration)})`);
  if (level != null && Number.isFinite(Number(level))) lines.push(`Level ${Math.round(Number(level))}%`);
  return lines.join('\n');
}

/**
 * How far (px) a clip's label must shift right so it stays readable when the clip starts
 * left of the visible area ("sticky" clip names, as in DAWs). `viewLeft` is the content x
 * where the visible clip area begins; the shift never pushes the label past the clip end.
 */
export function stickyOffset(clipLeft, clipWidth, viewLeft, reserve = 48) {
  const shift = viewLeft - clipLeft;
  if (!(shift > 0)) return 0;
  return Math.max(0, Math.min(shift, clipWidth - reserve));
}
