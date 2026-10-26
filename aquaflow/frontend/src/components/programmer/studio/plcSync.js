// The one way every path sends a show to the Siemens PLC with Site sync applied ("Play on PLC",
// Advanced PLC controls → Compile current clips, the Siemens setup wizard). Each output fires
// early by its chain minus the music's (siteSync.js); the summary travels with the compiled
// show so the engine and the TIA package can tell site staff when to start the music.
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { poolCenter } from '../../../engineering/geometryContract';
import { compileForSite, inventory } from './showModel';
import { withPlcTiming } from './siteSync';

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

// PLC timing per Siemens site, as the engine last reported it (status.timing.mode):
// 'buffered' = frame-accurate PLC clock (contract v3), 'streamed' = older program (v2).
const knownTiming = new Map();

/** Remember the timing a Siemens site's runtime status reported (null/unknown are ignored). */
export function rememberPlcTiming(siteId, timing) {
  const mode = typeof timing === 'string' ? timing : timing?.mode;
  if (siteId && (mode === 'buffered' || mode === 'streamed')) knownTiming.set(siteId, mode);
}

/** Last reported timing mode of a Siemens site, or null. */
export const plcTimingOf = (siteId) => (siteId && knownTiming.get(siteId)) || null;

/** The current design's fixtures and the open project's Site sync settings (outside React). */
export function currentSyncContext({ plcTiming } = {}) {
  const e = useEngineeringStore.getState();
  const items = inventory(e.fixtures || [], e.siteModels, poolCenter(e.geometry, e.params, e.poolType));
  const project = useProjectStore.getState();
  const mode = plcTiming || plcTimingOf(project.integrations?.siemensSiteId);
  return { items, site: withPlcTiming(project.programmer?.studio?.site || {}, mode) };
}

/** plcShowFor with the open project's design and settings (and the PLC's timing mode). */
export const currentPlcShow = (clips, options = {}) => plcShowFor(clips, currentSyncContext(options));

/**
 * One status line for the PLC timing: { text, tone: 'ok' | 'warn' | '', title }.
 * `timing` is the runtime status block { mode, accuracyMs, worstLateMs, aheadMs, underruns, notice }.
 */
export function plcTimingLabel(timing) {
  const mode = timing?.mode;
  const worst = Number.isFinite(timing?.worstLateMs) ? ` · worst ${Math.round(timing.worstLateMs)} ms late` : '';
  if (mode === 'buffered') {
    const ahead = Number.isFinite(timing.aheadMs) ? ` · ${(timing.aheadMs / 1000).toFixed(1)} s buffered` : '';
    const under = timing.underruns ? ` · ${timing.underruns} buffer underrun${timing.underruns === 1 ? '' : 's'}` : '';
    return { text: `Frame-accurate (PLC clock) · ±${Math.round(timing.accuracyMs ?? 10)} ms${worst}${ahead}${under}`,
      tone: under ? 'warn' : 'ok', title: "Cues fire on the PLC's own clock from a timestamped buffer, independent of PC and network jitter." };
  }
  if (mode === 'streamed') {
    return { text: `Streamed · ±${Math.round(timing.accuracyMs ?? 75)} ms${worst} — update the PLC program`,
      tone: 'warn', title: timing.notice || 'Download the current AquaFlow TIA package to the PLC for frame-accurate timing.' };
  }
  if (mode === 'preview') return { text: 'Preview only — no PLC timing', tone: '', title: '' };
  return { text: 'PLC timing: verify the PLC to check', tone: '', title: '' };
}

/** One line for compile messages: where the music must start. */
export function syncMessage(sync) {
  if (!sync) return '';
  if (!sync.enabled) return ' Site sync is off: cues are sent as programmed.';
  return ` Site sync applied: start the music ${sync.audioStartMs} ms after the PLC show starts.${sync.trimmed ? ` ${sync.trimmed} clip(s) were cut at the start.` : ''}`;
}
