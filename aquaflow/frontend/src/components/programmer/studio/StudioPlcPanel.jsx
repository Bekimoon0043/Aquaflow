import { useEffect, useRef, useState } from 'react';
import useProjectStore from '../../../store/projectStore';
import { siemensRequest } from '../../../utils/siemensSite';
import { explainS7Error } from '../../../utils/siemensDevices';
import { apiGet, apiPost } from '../../../utils/apiClient';
import { compileMessage } from '../SiemensShowControls';
import SiemensPlcMonitor from '../../panels/siemens/SiemensPlcMonitor';
import { clipsForPlc, nozzleLinks } from './plcLimits';
import '../../panels/siemens/siemensSetup.css';

export const PLAY_STEPS = ['Compile', 'Verify', 'Safety arm', 'Arm PLC', 'Start'];

// One click from the Show Programming timeline to a running PLC (PLCSIM or real).
// Every step is the normal guarded API call; the first failure stops the chain and says why.
export async function playOnPlc({ site, clips, confirmed, request = siemensRequest, safety = { get: apiGet, post: apiPost }, onStep = () => {} }) {
  if (!site) throw new Error('Choose a Siemens site first.');
  if (site.mode === 'simulated') throw new Error('This site is an AquaFlow animation only. Switch it to the PLCSIM test PLC in Devices → PLC → Siemens Setup → Connect.');
  if (!confirmed) throw new Error(site.mode === 'plcsim' ? 'Tick “this is the isolated PLCSIM simulator” first.' : 'Confirm a person is watching and every outlet has a safe water path.');
  if (!clips?.length) throw new Error('The timeline has no clips yet. Add a pattern first.');
  onStep(0);
  const compiled = await request(`/${site.id}/compile`, 'POST', { revision: site.revision, clips, translate: true });
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

export default function StudioPlcPanel({ clips, items = [], pending, onPlcStatus }) {
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
  const play = async () => {
    setBusy(true); setMessage({ text: '', tone: '' });
    try {
      const compiled = await playOnPlc({ site, clips: clipsForPlc(clips, site, nozzleLinks(items)), confirmed, onStep: setStep });
      setStep(PLAY_STEPS.length);
      setMessage({ text: `Playing on ${target}. ${compileMessage(compiled)} Watch DB${site.plc.db} change in TIA Portal (Monitor all) and in the monitor below.`, tone: 'ok' });
    } catch (e) {
      const hint = explainS7Error(e.message, site);
      setMessage({ text: hint ? `${hint}  (Details: ${e.message})` : e.message, tone: 'bad' });
    } finally {
      setBusy(false);
      reload().catch(() => {});
    }
  };
  const stop = async () => {
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
    {site?.mode === 'simulated' && <div className="s7-card s7-card--bad">“{site.name}” is an AquaFlow animation only; PLCSIM/TIA will not change. <button className="btn" onClick={openSetup}>Switch it to the PLCSIM test PLC</button></div>}
    {site && site.mode !== 'simulated' && <>
      <label className="s7-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
        {site.mode === 'plcsim' ? 'This is the isolated PLCSIM simulator' : 'A person is watching; every outlet has a safe water path'}</label>
      <div className="s7-row" style={{ margin: '8px 0' }}>
        <button className="btn primary" disabled={busy || pending || status?.running || !confirmed || !clips?.length} onClick={play}>▶ Play this show on {target}</button>
        <button className="btn danger" disabled={busy || !site} onClick={stop}>■ Stop PLC</button>
      </div>
      {(busy || step >= 0) && <ol className="s7-progress" aria-label="Play on PLC steps">{PLAY_STEPS.map((label, i) =>
        <li key={label} style={{ color: i < step || step === PLAY_STEPS.length ? '#4cc38a' : i === step && busy ? '#f6d795' : 'var(--text-muted)' }}>{i < step || step === PLAY_STEPS.length ? '✓' : i === step && busy ? '…' : '·'} {label}</li>)}</ol>}
      {status?.running && <p className="sp-help">PLC show time {Number(status.elapsed || 0).toFixed(1)} s — the timeline follows the PLC.</p>}
    </>}
    {message.text && <div role="status" className={`s7-msg ${message.tone === 'ok' ? 's7-msg--ok' : message.tone === 'bad' ? 's7-msg--bad' : ''}`}>{message.text}</div>}
    {site && site.mode !== 'simulated' && <SiemensPlcMonitor site={site} />}
  </div>;
}
