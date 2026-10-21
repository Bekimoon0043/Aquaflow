import { useEffect, useMemo, useRef, useState } from 'react';
import useProjectStore from '../../../store/projectStore';
import { siemensRequest } from '../../../utils/siemensSite';
import { explainS7Error } from '../../../utils/siemensDevices';
import { apiGet, apiPost } from '../../../utils/apiClient';
import { compileMessage } from '../SiemensShowControls';
import SiemensPlcMonitor from '../../panels/siemens/SiemensPlcMonitor';
import { clipsForPlc, nozzleLinks } from './plcLimits';
import { compileForSite, readStudio } from './showModel';
import { syncSummary } from './plcSync';
import { applySiteSync, buildSyncModel, clickTrackWav, patchSync, readSync, syncTestClips } from './siteSync';
import SiteSyncDialog from './SiteSyncDialog';
import '../../panels/siemens/siemensSetup.css';

export const PLAY_STEPS = ['Compile', 'Verify', 'Safety arm', 'Arm PLC', 'Start'];

// One click from the Show Programming timeline to a running PLC (PLCSIM or real).
// Every step is the normal guarded API call; the first failure stops the chain and says why.
export async function playOnPlc({ site, clips, sync = null, confirmed, request = siemensRequest, safety = { get: apiGet, post: apiPost }, onStep = () => {} }) {
  if (!site) throw new Error('Choose a Siemens site first.');
  if (site.mode === 'simulated') throw new Error('This site is an AquaFlow animation only. Switch it to the PLCSIM test PLC in Devices → PLC → Siemens Setup → Connect.');
  if (!confirmed) throw new Error(site.mode === 'plcsim' ? 'Tick “this is the isolated PLCSIM simulator” first.' : 'Confirm a person is watching and every outlet has a safe water path.');
  if (!clips?.length) throw new Error('The timeline has no clips yet. Add a pattern first.');
  onStep(0);
  const compiled = await request(`/${site.id}/compile`, 'POST', { revision: site.revision, clips, translate: true, ...(sync ? { sync } : {}) });
  onStep(1);
  await request(`/${site.id}/verify`, 'POST');
  onStep(2);
  const state = await safety.get('/safety/status');
  if (state.state === 'SAFE_IDLE') await safety.post('/safety/arm', {});
  else if (state.state !== 'ARMED') throw new Error(`AquaFlow master safety is ${state.state}; resolve it before playing on the PLC.`);
  onStep(3);
  await request(`/${site.id}/arm`, 'POST', { flow_path_confirmed: true });
  onStep(4);
  const started = await request(`/${site.id}/start`, 'POST');
  if (!started.running) throw new Error('The PLC did not enter playback; check the monitor below.');
  return compiled;
}

// The site sync settings live in the show document (studio.site.sync); the panel reads and
// writes them through the project store (useShowDocument picks the change up).
const NO_SITE = {};
const siteOf = programmer => programmer?.studio?.site || NO_SITE;
export function patchStudioSite(patch, store = useProjectStore) {
  const project = store.getState();
  const studio = project.programmer?.studio || readStudio(project.programmer);
  project.rememberProgrammer({ ...project.programmer, studio: { ...studio, site: patchSync(studio.site, patch) } });
}

/** The sync test as PLC clips: click-matched cues, shifted by the site sync like a show. */
export function syncTestShow(items, site) {
  const settings = readSync(site);
  const test = syncTestClips(items, { site, periodS: settings.test.periodS, durationS: settings.test.durationS });
  return { ...applySiteSync(test.clips, buildSyncModel(items, site)), test };
}

export default function StudioPlcPanel({ clips, items = [], pending, onPlcStatus }) {
  const site0 = useProjectStore(s => siteOf(s.programmer));
  const audioFile = useProjectStore(s => s.programmer?.audioFile || null);
  const sync = useMemo(() => compileForSite(null, items, clips || [], site0), [items, clips, site0]);
  const syncSettings = sync.model.settings;
  const [syncOpen, setSyncOpen] = useState(false);
  const player = useRef(null);
  const stopMusic = () => { const p = player.current; player.current = null; if (p) { clearTimeout(p.timer); p.audio?.pause(); if (p.url) URL.revokeObjectURL(p.url); } };
  useEffect(() => stopMusic, []);
  // Prepared before the PLC chain runs so the song starts on time once the PLC show is running.
  const prepareMusic = test => {
    stopMusic();
    if (!syncSettings.playFromPc || typeof Audio === 'undefined') return null;
    const source = test ? new Blob([clickTrackWav({ periodS: syncSettings.test.periodS, durationS: syncSettings.test.durationS })], { type: 'audio/wav' }) : audioFile;
    if (!(source instanceof Blob)) return null;
    const url = URL.createObjectURL(source), audio = new Audio(url);
    audio.preload = 'auto'; audio.load?.();
    player.current = { audio, url, timer: null };
    return player.current;
  };
  const startMusic = (prepared, offsetMs) => {
    if (!prepared || player.current !== prepared) return;
    prepared.timer = setTimeout(() => { prepared.audio.currentTime = 0; prepared.audio.play()?.catch?.(e => setMessage({ text: `Music from this PC: ${e.message}`, tone: 'bad' })); }, Math.max(0, offsetMs));
  };
  const siteId = useProjectStore(s => s.integrations?.siemensSiteId);
  const updateIntegrations = useProjectStore(s => s.updateIntegrations);
  const [sites, setSites] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const [step, setStep] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: '', tone: '' });
  const [status, setStatus] = useState(null);
  const reportRef = useRef(onPlcStatus);
  reportRef.current = onPlcStatus;
  const site = sites.find(s => s.id === siteId) || null;
  const reload = () => siemensRequest().then(r => setSites(r.sites));
  useEffect(() => { reload().catch(e => setMessage({ text: e.message, tone: 'bad' })); }, []);
  useEffect(() => { setConfirmed(false); setStep(-1); }, [siteId]);
  useEffect(() => {
    if (!siteId) return undefined;
    let alive = true;
    const poll = () => siemensRequest(`/${siteId}/status`).then(s => { if (!alive) return; setStatus(s); reportRef.current?.(s); }).catch(() => {});
    poll();
    const timer = setInterval(poll, 400);
    return () => { alive = false; clearInterval(timer); reportRef.current?.(null); };
  }, [siteId]);
  const target = site?.mode === 'plcsim' ? 'PLCSIM' : 'the PLC';
  const play = async (test = false) => {
    setBusy(true); setMessage({ text: '', tone: '' });
    try {
      // Site sync: each output fires early by its chain minus the music's (siteSync.js).
      const show = test ? syncTestShow(items, site0) : sync;
      if (test && !show.clips.length) throw new Error('The sync test found no jets or lights to drive.');
      const music = prepareMusic(test);
      const compiled = await playOnPlc({ site, clips: clipsForPlc(show.clips, site, nozzleLinks(items)), sync: syncSummary(show), confirmed, onStep: setStep });
      setStep(PLAY_STEPS.length);
      startMusic(music, show.audioStartMs);
      const start = show.enabled ? ` ${music ? 'The music plays from this PC' : 'Start the music'} ${show.audioStartMs} ms after the PLC show starts.` : '';
      setMessage({ text: `Playing${test ? ' the sync test' : ''} on ${target}. ${compileMessage(compiled)}${start} Watch DB${site.plc.db} change in TIA Portal (Monitor all) and in the monitor below.`, tone: 'ok' });
    } catch (e) {
      stopMusic();
      const hint = explainS7Error(e.message, site);
      setMessage({ text: hint ? `${hint}  (Details: ${e.message})` : e.message, tone: 'bad' });
    } finally {
      setBusy(false);
      reload().catch(() => {});
    }
  };
  const stop = async () => {
    stopMusic();
    setBusy(true);
    try {
      const result = await siemensRequest(`/${site.id}/stop`, 'POST');
      await apiPost('/safety/disarm', {}).catch(() => {});
      setStep(-1);
      setMessage({ text: result.stop_confirmed ? `${target} stopped; every output acknowledged OFF.` : 'STOP UNCONFIRMED — check the PLC.', tone: result.stop_confirmed ? 'ok' : 'bad' });
    } catch (e) { setMessage({ text: e.message, tone: 'bad' }); } finally { setBusy(false); }
  };
  const openSetup = () => window.dispatchEvent(new CustomEvent('aquaflow:open-panel', { detail: { panel: 'plc' } }));
  return <div className="s7" style={{ padding: 0 }}>
    <span className="sp-eyebrow">PLAY ON SIEMENS PLC</span>
    <div className="s7-row" style={{ margin: '6px 0' }}>
      <select aria-label="Siemens site for this show" value={siteId || ''} onChange={e => updateIntegrations({ siemensSiteId: e.target.value || null })}>
        <option value="">Choose a Siemens site…</option>
        {sites.map(s => <option key={s.id} value={s.id}>{s.name} · {s.mode === 'plcsim' ? 'PLCSIM' : s.mode === 'physical' ? 'real PLC' : 'animation only'}</option>)}
      </select>
      <button className="btn" onClick={openSetup}>Setup…</button>
    </div>
    <div className="s7-card" aria-label="Site sync summary">
      <div className="s7-row"><strong>Site sync</strong><span>{sync.enabled
        ? `on · music starts ${sync.audioStartMs} ms after the PLC show · water ${sync.byKind.water ? `+${Math.round(sync.byKind.water.minShiftMs)}…+${Math.round(sync.byKind.water.maxShiftMs)} ms` : '—'}, lights ${sync.byKind.light ? `+${Math.round(sync.byKind.light.minShiftMs)}…+${Math.round(sync.byKind.light.maxShiftMs)} ms` : '—'} on the PLC clock · audience spread ${Math.round(sync.model.spread.spreadMs)} ms`
        : 'off — the PLC plays the timeline as drawn'}</span>
        <button className="btn" onClick={() => setSyncOpen(v => !v)}>Site sync…</button></div>
      <label className="s7-row"><input type="checkbox" checked={!!syncSettings.playFromPc} onChange={e => patchStudioSite({ playFromPc: e.target.checked })} />
        Play the music from this PC when the PLC show starts{audioFile ? '' : ' (attach the show audio in the Music tab)'}</label>
      {sync.trimmed.length > 0 && <small>{sync.trimmed.length} clip(s) at the very start would have to fire before the show starts and are cut short.</small>}
    </div>
    {syncOpen && <SiteSyncDialog items={items} site={site0} clips={clips} onPatch={patchStudioSite} onClose={() => setSyncOpen(false)} />}
    {site?.mode === 'simulated' && <div className="s7-card s7-card--bad">“{site.name}” is an AquaFlow animation only; PLCSIM/TIA will not change. <button className="btn" onClick={openSetup}>Switch it to the PLCSIM test PLC</button></div>}
    {site && site.mode !== 'simulated' && <>
      <label className="s7-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
        {site.mode === 'plcsim' ? 'This is the isolated PLCSIM simulator' : 'A person is watching; every outlet has a safe water path'}</label>
      <div className="s7-row" style={{ margin: '8px 0' }}>
        <button className="btn primary" disabled={busy || pending || status?.running || !confirmed || !clips?.length} onClick={() => play(false)}>▶ Play this show on {target}</button>
        <button className="btn danger" disabled={busy || !site} onClick={stop}>■ Stop PLC</button>
        <button className="btn" disabled={busy || pending || status?.running || !confirmed} onClick={() => play(true)} title="Click-matched test cues for measuring the sound ↔ water timing (Site sync → Sync test)">▶ Play sync test on {target}</button>
      </div>
      {(busy || step >= 0) && <ol className="s7-progress" aria-label="Play on PLC steps">{PLAY_STEPS.map((label, i) =>
        <li key={label} style={{ color: i < step || step === PLAY_STEPS.length ? '#4cc38a' : i === step && busy ? '#f6d795' : 'var(--text-muted)' }}>{i < step || step === PLAY_STEPS.length ? '✓' : i === step && busy ? '…' : '·'} {label}</li>)}</ol>}
      {status?.running && <p className="sp-help">PLC show time {Number(status.elapsed || 0).toFixed(1)} s — the timeline follows the PLC.</p>}
    </>}
    {message.text && <div role="status" className={`s7-msg ${message.tone === 'ok' ? 's7-msg--ok' : message.tone === 'bad' ? 's7-msg--bad' : ''}`}>{message.text}</div>}
    {site && site.mode !== 'simulated' && <SiemensPlcMonitor site={site} />}
  </div>;
}
