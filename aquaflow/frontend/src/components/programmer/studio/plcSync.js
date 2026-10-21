// The one way every path sends a show to the Siemens PLC with Site sync applied ("Play on PLC",
// Advanced PLC controls → Compile current clips, the Siemens setup wizard). Each output fires
// early by its chain minus the music's (siteSync.js); the summary travels with the compiled
// show so the engine and the TIA package can tell site staff when to start the music.
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { poolCenter } from '../../../engineering/geometryContract';
import { compileForSite, inventory } from './showModel';

const r1 = (v) => Math.round(Number(v) * 10) / 10;

/** Numbers-only summary of an applySiteSync result for the engine (no settings, no ids). */
export function syncSummary(result) {
  if (!result?.enabled) return { enabled: false, audioStartMs: 0, recommendedAudioStartMs: 0, trimmed: 0, dropped: 0, byKind: {} };
  const byKind = {};
  for (const [kind, k] of Object.entries(result.byKind || {})) {
    if (!k?.clips) continue;
    byKind[kind] = { clips: k.clips, minShiftMs: r1(k.minShiftMs), maxShiftMs: r1(k.maxShiftMs) };
  }
  return { enabled: true, audioStartMs: Math.round(result.audioStartMs || 0), recommendedAudioStartMs: Math.round(result.recommendedAudioStartMs || 0),
    trimmed: result.trimmed?.length || 0, dropped: result.dropped || 0, byKind };
}

/**
 * Clips to send to the PLC with Site sync applied, plus the summary for the engine.
 * Clips that already carry `siteShiftMs` were shifted before and are sent unchanged.
 */
export function plcShowFor(clips = [], { items = [], site } = {}) {
  if (!clips.length || clips.some((c) => c && c.siteShiftMs !== undefined)) return { clips, sync: null };
  const result = compileForSite(null, items, clips, site || {});
  return { clips: result.clips, sync: syncSummary(result), result };
}

/** The current design's fixtures and the open project's Site sync settings (outside React). */
export function currentSyncContext() {
  const e = useEngineeringStore.getState();
  const items = inventory(e.fixtures || [], e.siteModels, poolCenter(e.geometry, e.params, e.poolType));
  return { items, site: useProjectStore.getState().programmer?.studio?.site || {} };
}

/** plcShowFor with the open project's design and settings. */
export const currentPlcShow = (clips) => plcShowFor(clips, currentSyncContext());

/** One line for compile messages: where the music must start. */
export function syncMessage(sync) {
  if (!sync) return '';
  if (!sync.enabled) return ' Site sync is off: cues are sent as programmed.';
  return ` Site sync applied: start the music ${sync.audioStartMs} ms after the PLC show starts.${sync.trimmed ? ` ${sync.trimmed} clip(s) were cut at the start.` : ''}`;
}
