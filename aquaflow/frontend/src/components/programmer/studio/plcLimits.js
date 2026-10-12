// Live Siemens PLC-limit check for the Show Programming timeline (pure, unit-tested).
// Mirrors what "Play on PLC" does in the backend (translate_show + compile_show):
//   error → compile is refused; warn → the PLC changes the clip (we say how); info → harmless note.
const LEVEL_TRACKS = new Set(['pump_speed', 'pump_pressure', 'device_intensity', 'device_enable', 'solenoid_open', 'motion_intensity', 'solenoid_duration']);
const LIGHT_TRACKS = new Set(['lighting_master', 'lighting_red', 'lighting_green', 'lighting_blue']);
const EPS = 1e-6;
const fmt = seconds => `${Number(seconds.toFixed(2))} s`;

export const TRACK_LABEL = {
  pump_speed: 'Speed', pump_pressure: 'Pressure', solenoid_open: 'Open', solenoid_duration: 'Duration',
  lighting_master: 'Intensity', lighting_red: 'Red', lighting_green: 'Green', lighting_blue: 'Blue',
  device_intensity: 'Level', device_enable: 'Enable', motion_intensity: 'Intensity',
};
const TRACK_ORDER = ['pump_speed', 'pump_pressure', 'solenoid_open', 'device_intensity', 'device_enable', 'lighting_master', 'lighting_red', 'lighting_green', 'lighting_blue'];

// Rows for "one row per device": stable device order (Engineering order), then channel order.
export function deviceRows(clips = [], items = []) {
  const order = new Map(items.map((item, index) => [item.id, index]));
  const rows = new Map();
  for (const clip of clips) {
    const key = clip.trackId || `${clip.fixtureId}-${clip.type}`;
    if (!rows.has(key)) {
      const item = items.find(i => i.id === clip.fixtureId);
      rows.set(key, { key, fixtureId: clip.fixtureId, type: clip.type, clips: [],
        name: `${item?.label || 'Missing fixture'} · ${TRACK_LABEL[clip.type] || clip.type}` });
    }
    rows.get(key).clips.push(clip);
  }
  const rank = type => { const i = TRACK_ORDER.indexOf(type); return i < 0 ? 99 : i; };
  return [...rows.values()].sort((a, b) => (order.get(a.fixtureId) ?? 1e9) - (order.get(b.fixtureId) ?? 1e9) || rank(a.type) - rank(b.type) || a.key.localeCompare(b.key));
}

const span = clip => [Number(clip.startTime) || 0, (Number(clip.startTime) || 0) + (Number(clip.duration) || 0)];

// Same rule as the backend: windows closer than `gap` (the valve minimum off-time) merge.
function union(spans, gap = 0) {
  const out = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (out.length && a - out.at(-1)[1] < Math.max(gap, EPS)) out.at(-1)[1] = Math.max(out.at(-1)[1], b);
    else out.push([a, b]);
  }
  return out;
}

function uncovered([a, b], covered) {
  let missing = 0, cursor = a;
  for (const [c, d] of covered) {
    if (d <= cursor) continue;
    if (c >= b) break;
    if (c > cursor) missing += c - cursor;
    cursor = Math.max(cursor, d);
    if (cursor >= b) break;
  }
  return missing + Math.max(0, b - cursor);
}

/**
 * @returns {{ byClip: Map<string, {level, text}[]>, list: {clipId, level, text, time}[], counts: {error, warn, info} }}
 */
export function checkPlcLimits(clips = [], site = null, links = new Map()) {
  const byClip = new Map(), list = [];
  const add = (clip, level, text) => {
    if (!byClip.has(clip.id)) byClip.set(clip.id, []);
    byClip.get(clip.id).push({ level, text });
    list.push({ clipId: clip.id, level, text, time: Number(clip.startTime) || 0 });
  };
  if (!site?.channels?.length) return { byClip, list, counts: { error: 0, warn: 0, info: 0 } };
  const channels = new Map(site.channels.map(c => [c.id, c]));
  const valveOfNozzle = new Map(site.channels.filter(c => c.kind === 'valve').flatMap(c => (c.nozzle_ids || []).map(n => [n, c.id])));
  for (const [nozzle, valve] of links) if (channels.get(valve)?.kind === 'valve' && !valveOfNozzle.has(nozzle)) valveOfNozzle.set(nozzle, valve);
  const valveClips = new Map(), pumpClips = new Map(), lightClips = new Map();
  for (const clip of clips) {
    if (clip.muted || clip.disabled || !(Number(clip.duration) > 0)) continue;
    const channel = channels.get(clip.fixtureId);
    const valveId = valveOfNozzle.get(clip.fixtureId) || (channel?.kind === 'valve' ? channel.id : null);
    if (valveId && LEVEL_TRACKS.has(clip.type)) {
      if (!valveClips.has(valveId)) valveClips.set(valveId, []);
      valveClips.get(valveId).push(clip);
      if (channel?.kind === 'valve' && (clip.fadeIn || clip.fadeOut)) add(clip, 'info', 'Valves are on/off: the fade is ignored.');
    } else if (channel?.kind === 'pump' && LEVEL_TRACKS.has(clip.type)) {
      if (!pumpClips.has(channel.id)) pumpClips.set(channel.id, []);
      pumpClips.get(channel.id).push(clip);
      if (Number(clip.value) > channel.max_percent) add(clip, 'warn', `Above the ${channel.max_percent}% speed ceiling: the PLC caps this pump at ${channel.max_percent}%.`);
    } else if (channel?.kind === 'light' && LIGHT_TRACKS.has(clip.type)) {
      const key = `${channel.id}:${clip.type}`;
      if (!lightClips.has(key)) lightClips.set(key, []);
      lightClips.get(key).push(clip);
    } else {
      add(clip, 'info', 'Not driven by this Siemens PLC site: skipped when playing on the PLC.');
    }
    if (span(clip)[1] > 1800) add(clip, 'error', 'Siemens shows can be at most 30 minutes.');
  }
  const openSpans = new Map();
  for (const [valveId, list] of valveClips) {
    const valve = channels.get(valveId);
    const minOn = valve.min_on_ms / 1000, minOff = valve.min_off_ms / 1000;
    const on = list.filter(c => Number(c.value) > 0).sort((a, b) => a.startTime - b.startTime);
    const stretched = on.map(clip => {
      const [a, b] = span(clip);
      if (b - a < minOn - EPS) add(clip, 'warn', `Shorter than ${valve.name}'s minimum on-time (${fmt(minOn)}): the PLC keeps it open ${fmt(minOn)}.`);
      return { clip, s: [a, Math.max(b, a + minOn)] };
    });
    for (let i = 1; i < stretched.length; i++) {
      const gap = stretched[i].s[0] - Math.max(...stretched.slice(0, i).map(x => x.s[1]));
      if (gap > EPS && gap < minOff - EPS) add(stretched[i].clip, 'warn', `Only ${fmt(gap)} after the previous opening of ${valve.name} (minimum off-time ${fmt(minOff)}): the valve stays open through the gap.`);
    }
    openSpans.set(valveId, union(stretched.map(x => x.s), minOff));
  }
  for (const [pumpId, list] of pumpClips) {
    const pump = channels.get(pumpId);
    const outlets = union(site.channels.filter(c => c.kind === 'valve' && c.pump_id === pumpId).flatMap(c => openSpans.get(c.id) || []));
    const sorted = [...list].sort((a, b) => a.startTime - b.startTime);
    sorted.forEach((clip, i) => {
      if (Number(clip.value) <= 0) return;
      const dry = uncovered(span(clip), outlets);
      if (dry > .05) add(clip, 'warn', `${pump.name} is asked to run for ${fmt(dry)} while all its jets are closed: the PLC holds it at 0% then (it never pumps against closed valves).`);
      if (i && span(sorted[i - 1])[1] > span(clip)[0] + EPS) add(clip, 'info', 'Overlaps another speed clip on this pump: the later clip wins.');
    });
  }
  for (const list of lightClips.values()) {
    const sorted = [...list].sort((a, b) => a.startTime - b.startTime);
    for (let i = 1; i < sorted.length; i++) {
      if (span(sorted[i - 1])[1] > span(sorted[i])[0] + EPS) add(sorted[i], 'error', `Overlaps another ${TRACK_LABEL[sorted[i].type].toLowerCase()} clip on this light: the PLC compile refuses overlapping light clips. Move or shorten one.`);
    }
  }
  const counts = { error: 0, warn: 0, info: 0 };
  list.forEach(item => { counts[item.level]++; });
  list.sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a.level] - { error: 0, warn: 1, info: 2 }[b.level]) || a.time - b.time);
  return { byClip, list, counts };
}

// Engineering links nozzle → its valve (linkedValveId). Older Siemens sites do not store
// nozzle_ids, so the timeline maps nozzle clips onto the valve before checking or playing.
export function nozzleLinks(items = []) {
  return new Map(items.filter(i => i.linkedValveId).map(i => [i.id, i.linkedValveId]));
}

export function clipsForPlc(clips = [], site = null, links = new Map()) {
  if (!site?.channels?.length) return clips;
  const ids = new Set(site.channels.map(c => c.id));
  return clips.map(clip => !ids.has(clip.fixtureId) && ids.has(links.get(clip.fixtureId)) && LEVEL_TRACKS.has(clip.type)
    ? { ...clip, fixtureId: links.get(clip.fixtureId), sourceFixtureId: clip.fixtureId } : clip);
}

// Show one marker per timeline block: resolved pattern clips report on their pattern.
export function issuesByBlock(result) {
  const map = new Map();
  for (const [id, issues] of result.byClip) {
    const block = id.includes(':') ? id.split(':')[0] : id;
    if (!map.has(block)) map.set(block, []);
    for (const issue of issues) if (!map.get(block).some(x => x.text === issue.text)) map.get(block).push(issue);
  }
  return map;
}

export function worstLevel(issues = []) {
  return issues.some(i => i.level === 'error') ? 'error' : issues.some(i => i.level === 'warn') ? 'warn' : issues.length ? 'info' : '';
}
