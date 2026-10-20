// Calibrate a nozzle type from video — film one jet side-on with something of known height in
// view, mark its base and the reference, set the moment the valve opened, then click the jet's
// tip on a few frames as it rises. AquaFlow fits the delay, launch speed and drag
// (waterPhysics.calibrateFromTrack) and stores them on the site: the show then fires each jet
// early by its measured time, and the preview and splash checks use the measured drag.
import { useRef, useState } from 'react';
import { calibrateFromTrack } from '../../preview/waterPhysics';

const STEPS = { base: 'Click the nozzle (the jet’s base)', ref: 'Click the top of the reference object', tip: 'Click the jet tip — step a few frames, click again' };

export default function CalibrationDialog({ types, calibration = {}, onSave, onClose }) {
  const [type, setType] = useState(types[0]?.id || '');
  const [url, setUrl] = useState(null);
  const [mode, setMode] = useState(null);
  const [base, setBase] = useState(null), [ref, setRef] = useState(null), [refM, setRefM] = useState(2);
  const [t0, setT0] = useState(null), [points, setPoints] = useState([]);
  const [fit, setFit] = useState(null), [error, setError] = useState('');
  const video = useRef(null);
  const heightAt = (y) => (base && ref && base.y !== ref.y ? ((base.y - y) / (base.y - ref.y)) * refM : null);
  const click = (e) => {
    if (!mode || !video.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (mode === 'base') { setBase(p); setMode('ref'); }
    else if (mode === 'ref') { setRef(p); setMode(null); }
    else if (mode === 'tip' && t0 != null) {
      const h = heightAt(p.y);
      if (h != null) setPoints((list) => [...list.filter((q) => Math.abs(q.t - (video.current.currentTime - t0)) > 1e-3), { t: Math.round((video.current.currentTime - t0) * 1000) / 1000, h: Math.round(h * 100) / 100, x: p.x, y: p.y }]);
    }
  };
  const runFit = () => {
    try { setFit(calibrateFromTrack(points)); setError(''); } catch (err) { setFit(null); setError(err.message); }
  };
  const step = (dt) => { if (video.current) video.current.currentTime = Math.max(0, video.current.currentTime + dt); };
  const current = calibration[type];
  return <div className="pattern-builder calib" role="dialog" aria-label="Calibrate a nozzle">
    <div className="pb-head"><strong>Calibrate a nozzle from video</strong><span className="sp-grow" /><button onClick={onClose} aria-label="Close">×</button></div>
    <div className="pb-row"><span>Nozzle</span>
      <select aria-label="Nozzle type" value={type} onChange={(e) => { setType(e.target.value); setFit(null); }}>
        {types.map((t) => <option key={t.id} value={t.id}>{t.label}{calibration[t.id] ? ' · calibrated' : ''}</option>)}
      </select></div>
    {current && <small className="pb-note">Now: delay {current.delayS} s · drag speed {current.vtMs} m/s · apex {current.apexM} m (measured {new Date(current.measuredAt).toLocaleDateString()})</small>}
    <label className="pb-file">{url ? 'Change video' : 'Load video'}
      <input type="file" accept="video/*" hidden aria-label="Calibration video" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setUrl(URL.createObjectURL(f)); setPoints([]); setFit(null); } e.target.value = ''; }} /></label>
    {url && <>
      <div className="calib-stage" onClick={click} style={{ position: 'relative', cursor: mode ? 'crosshair' : 'default' }}>
        <video ref={video} src={url} style={{ width: '100%', display: 'block' }} muted playsInline />
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {base && <circle cx={base.x} cy={base.y} r={5} fill="#35d0c0" />}
          {ref && <circle cx={ref.x} cy={ref.y} r={5} fill="#ffd166" />}
          {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill="#ff4f6d" />)}
        </svg>
      </div>
      <div className="pb-row">
        <button onClick={() => step(-1 / 30)} title="One frame back">◀ frame</button>
        <button onClick={() => (video.current?.paused ? video.current.play() : video.current?.pause())}>Play / pause</button>
        <button onClick={() => step(1 / 30)} title="One frame on">frame ▶</button>
      </div>
      <div className="pb-row">
        <button onClick={() => setMode('base')} aria-pressed={mode === 'base'}>1 · Mark base</button>
        <label title="Height of the reference object, in metres"><span>Reference</span>
          <input aria-label="Reference height" type="number" min={0.1} step={0.1} value={refM} onChange={(e) => setRefM(Number(e.target.value) || 1)} /> m</label>
        <button onClick={() => setT0(video.current?.currentTime ?? 0)} title="Pause on the frame where the valve opens, then press">2 · Valve opened here{t0 != null ? ` (${t0.toFixed(2)} s)` : ''}</button>
        <button onClick={() => setMode('tip')} aria-pressed={mode === 'tip'} disabled={!base || !ref || t0 == null}>3 · Mark tip ({points.length})</button>
      </div>
      {mode && <small className="pb-note">{STEPS[mode]}</small>}
      <div className="pb-row">
        <button onClick={() => setPoints([])} disabled={!points.length}>Clear tips</button>
        <span className="sp-grow" />
        <button onClick={runFit} disabled={points.length < 4}>Fit</button>
        <button className="sp-primary" disabled={!fit} onClick={() => onSave(type, { ...fit, measuredAt: Date.now(), points: points.map(({ t, h }) => ({ t, h })) })}>Save to site</button>
      </div>
      {fit && <small className="pb-note" role="status">Delay {fit.delayS} s · launch {fit.launchMs} m/s · apex {fit.apexM} m · drag speed {fit.vtMs} m/s · height efficiency {Math.round(fit.eta * 100)} % · fit error {fit.rms} m</small>}
      {error && <small className="pb-error" role="alert">{error}</small>}
    </>}
  </div>;
}
