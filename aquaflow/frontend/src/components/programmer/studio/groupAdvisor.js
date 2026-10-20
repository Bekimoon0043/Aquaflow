// Group advisor — tells the designer when two water groups cannot move independently:
//   · shared jets: a jet can only do one thing at a time, so where both groups play at once the
//     jet follows whichever pattern wins and neither group reads clearly;
//   · shared pumps: every open jet on one pump rises to the same height, so two groups on one
//     pump can switch on and off on their own but cannot show two different heights.
// Only groups that matter are compared: groups linked to a part of the music, groups that have
// patterns in the show, and the group being made or edited. Two groups whose patterns never
// play at the same time do not conflict. Pure.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const listNames = (names) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Merged play intervals of each group's unmuted patterns. */
function playIntervals(recipes) {
  const by = new Map();
  for (const r of recipes || []) {
    if (!r?.groupId || r.muted || !(Number(r.duration) > 0)) continue;
    if (!by.has(r.groupId)) by.set(r.groupId, []);
    by.get(r.groupId).push([Number(r.start) || 0, (Number(r.start) || 0) + Number(r.duration)]);
  }
  for (const [id, list] of by) {
    list.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const iv of list) { const last = merged.at(-1); if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else merged.push([...iv]); }
    by.set(id, merged);
  }
  return by;
}

function overlapSeconds(a, b) {
  let total = 0, i = 0, j = 0;
  while (i < a.length && j < b.length) {
    total += Math.max(0, Math.min(a[i][1], b[j][1]) - Math.max(a[i][0], b[j][0]));
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return total;
}

const isVfd = (pump) => /vfd|variable|inverter/i.test(`${pump?.item?.engineering?.controlType || ''} ${pump?.item?.type || ''}`);

/**
 * Conflicts between pairs of water groups that matter for the show.
 * @param {object} o
 * @param {Array} o.groups studio groups ({ id, name, parentId, … })
 * @param {(g) => string[]} o.membersOf fixture ids of a group (showModel.resolveMembers)
 * @param o.design readFountainDesign(items)
 * @param {Array} [o.recipes] the show's patterns (groupId, start, duration, muted)
 * @param {string[]} [o.linked] group ids linked to parts of the music
 * @param {string[]} [o.focus] only pairs that involve these groups (the one being made / edited);
 *   a focus group is compared even when it has no patterns yet
 * @returns {Array<{ a, b, aName, bName, sharedJets, sharedPumps, together, text, fix }>}
 */
export function groupConflicts({ groups = [], membersOf, design, recipes = [], linked = [], focus = [] }) {
  if (!design?.nozzleById || !membersOf) return [];
  const plays = playIntervals(recipes);
  const relevant = (g) => linked.includes(g.id) || focus.includes(g.id) || plays.has(g.id);
  const water = groups.filter(relevant).map((g) => {
    const ids = new Set(membersOf(g).filter((id) => design.nozzleById.has(id)));
    return { g, ids, pumps: new Set([...ids].map((id) => design.nozzleById.get(id).pumpId).filter(Boolean)) };
  }).filter((x) => x.ids.size);
  const isAncestor = (child, parent) => { for (let p = child.parentId, n = 0; p && n < 20; n++) { if (p === parent.id) return true; p = groups.find((x) => x.id === p)?.parentId; } return false; };
  const out = [];
  for (let i = 0; i < water.length; i++) for (let j = i + 1; j < water.length; j++) {
    const A = water[i], B = water[j];
    if (focus.length && !focus.includes(A.g.id) && !focus.includes(B.g.id)) continue;
    if (isAncestor(A.g, B.g) || isAncestor(B.g, A.g)) continue;
    const shared = [...A.ids].filter((id) => B.ids.has(id)).length;
    // One group inside the other (e.g. "All jets" and "Front row") is a deliberate superset.
    if (shared && (shared === A.ids.size || shared === B.ids.size)) continue;
    const sharedPumps = [...A.pumps].filter((p) => B.pumps.has(p)).map((id) => ({ id, name: design.pumps.get(id)?.name || id, vfd: isVfd(design.pumps.get(id)) }));
    if (!shared && !sharedPumps.length) continue;
    // Both already have patterns: only a problem where they play at the same time.
    const together = plays.has(A.g.id) && plays.has(B.g.id) ? overlapSeconds(plays.get(A.g.id), plays.get(B.g.id)) : null;
    const bothLinked = linked.includes(A.g.id) && linked.includes(B.g.id);
    if (together !== null && together < 1 && !bothLinked) continue;

    const what = [shared ? plural(shared, 'jet') : null, sharedPumps.length ? `${plural(sharedPumps.length, 'pump')} (${listNames(sharedPumps.map((p) => p.name))})` : null].filter(Boolean);
    const why = [];
    if (shared) why.push(`a jet can only do one thing at a time, so those ${plural(shared, 'jet')} follow one group and the other loses them`);
    if (sharedPumps.length) why.push('jets on one pump rise to the same height, so the groups cannot show different heights');
    const fix = [];
    if (shared) fix.push('make the groups separate (no jet in both)');
    if (sharedPumps.length) fix.push(sharedPumps.every((p) => p.vfd) ? 'give each group its own VFD pump instead of sharing one' : 'give each group its own pump with a VFD');
    const text = `${A.g.name} and ${B.g.name} share ${what.join(' and ')}`
      + (together ? `, and they play together for ${clock(together)} of the show` : '') + '. '
      + `${why.join('; ').replace(/^./, (c) => c.toUpperCase())}.`;
    out.push({ a: A.g.id, b: B.g.id, aName: A.g.name, bName: B.g.name, sharedJets: shared, sharedPumps, together,
      text, fix: `To see each part of the music clearly, ${fix.join(' and ')}.` });
  }
  return out.sort((x, y) => y.sharedJets - x.sharedJets || y.sharedPumps.length - x.sharedPumps.length);
}

/** One short line for a status message (e.g. right after creating a group). */
export function conflictSummary(conflicts, groupId) {
  const mine = conflicts.filter((c) => c.a === groupId || c.b === groupId);
  if (!mine.length) return '';
  const other = (c) => (c.a === groupId ? c.bName : c.aName);
  const jets = mine.filter((c) => c.sharedJets), pumps = mine.filter((c) => !c.sharedJets);
  const bits = [];
  if (jets.length) bits.push(`shares jets with ${listNames(jets.map(other))}`);
  if (pumps.length) bits.push(`shares pumps with ${listNames(pumps.map(other))}`);
  return `⚠ This group ${bits.join(' and ')}: they cannot move fully on their own. The Group tab shows how to fix it.`;
}
