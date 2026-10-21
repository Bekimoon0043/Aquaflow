// Site sync — make the audience hear each beat as it sees the water peak / the light hit.
// Inputs (audio chain, speakers, temperature, PLC / network / DMX timing, listener), the live
// chain breakdown per output kind, the spread across the audience, the music start offset the
// site player must use, and the on-site sync test (click track + measurement from video or taps).
// Settings live in studio.site.sync (saved with the project). Model: siteSync.js.
import React, { useMemo, useRef, useState } from 'react';
import { applySiteSync, buildSyncModel, clickTimes, clickTrackWav, correctionPatch, detectBeeps, measureResidual, patchSync, speedOfSound, tapResidual } from './siteSync';
import { readFountainDesign } from './fountainDesign';
import './patternBuilder.css';
import './siteSync.css';

const ms = (v) => `${Math.round(v)} ms`;
const signed = (v) => `${v > 0 ? '+' : ''}${Math.round(v)} ms`;

function Num({ label, value, onChange, unit = 'ms', step = 1, min = 0, max = 100000, blank = false, placeholder = '', title = '' }) {
  return <label className="ss-num" title={title}><span>{label}</span>
    <input aria-label={label} type="number" step={step} min={min} max={max} value={value ?? ''} placeholder={placeholder}
      onChange={(e) => { const raw = e.target.value; if (raw === '') { if (blank) onChange(null); return; } const v = Number(raw); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v))); }} />
    <small>{unit}</small></label>;
}

export function downloadClickTrack({ periodS = 2, durationS = 32 } = {}) {
  const blob = new Blob([clickTrackWav({ periodS, durationS })], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `AquaFlow sync test ${periodS}s.wav`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Breakdown table: one row per output kind (audio, each nozzle kind, lights). */
export function SyncBreakdown({ model }) {
  return <table className="ss-table" aria-label="Site sync breakdown">
    <thead><tr><th>Output</th><th>Chain</th><th>Total</th><th title="How much earlier than the music it must fire (negative: it waits for the sound)">Advance</th></tr></thead>
    <tbody>{model.rows.map((row) => <tr key={row.key} data-kind={row.kind}>
      <td>{row.label}{row.count > 1 ? ` ×${row.count}` : ''}</td>
      <td><small>{row.parts.map((p) => `${p.label} ${Math.round(p.ms)}`).join(' · ')}</small></td>
      <td>{ms(row.totalMs)}</td>
      <td>{row.kind === 'audio' ? '—' : signed(row.advanceMs)}</td>
    </tr>)}</tbody>
  </table>;
}

export default function SiteSyncDialog({ items = [], site = {}, clips = null, onPatch, onClose }) {
  const design = useMemo(() => readFountainDesign(items), [items]);
  const model = useMemo(() => buildSyncModel(items, site, { design }), [items, site, design]);
  const s = model.settings;
  const result = useMemo(() => (clips?.length ? applySiteSync(clips, model) : null), [clips, model]);
  const [tab, setTab] = useState('model');
  // Every change also refreshes the preview delay the 3D preview's song uses.
  const set = (patch) => {
    const next = buildSyncModel(items, patchSync(site, patch), { design });
    onPatch({ ...patch, previewDelayMs: next.audio.totalMs });
  };
  const speakersText = (s.speakers || []).map((p) => `${p.x}, ${p.y}${p.z ? `, ${p.z}` : ''}`).join('\n');
  const [speakerDraft, setSpeakerDraft] = useState(speakersText);
  const saveSpeakers = (text) => {
    const list = text.split(/\n|;/).map((line) => line.split(/[,\s]+/).filter(Boolean).map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite)).map(([x, y, z]) => ({ x, y, ...(Number.isFinite(z) ? { z } : {}) }));
    set({ speakers: list });
  };
  const fmtSeat = (seat) => `${seat.label}: ${seat.distanceM} m from the speakers, music ${seat.offsetMs > 0 ? `${Math.round(seat.offsetMs)} ms late` : seat.offsetMs < 0 ? `${Math.round(-seat.offsetMs)} ms early` : 'on time'}`;

  return <div className="pattern-builder site-sync" role="dialog" aria-label="Site sync" style={{ maxHeight: '86vh', overflow: 'auto', width: 'min(760px, 96vw)' }}>
    <div className="pb-head"><strong>Site sync · sound ↔ fountain</strong><span className="sp-grow" />
      <button aria-pressed={tab === 'model'} onClick={() => setTab('model')}>Timing</button>
      <button aria-pressed={tab === 'test'} onClick={() => setTab('test')}>Sync test</button>
      <button aria-pressed={tab === 'measure'} onClick={() => setTab('measure')}>Measure</button>
      <button onClick={onClose} aria-label="Close">×</button></div>
    <p className="pb-note">On site every output reaches the audience later than its cue: the PLC, the valve and the water's rise, the light's DMX. The music has its own delay (player, processor, amplifier and the air). AquaFlow fires each output early by the difference so the beat is heard as the water peaks. The 3D preview stays the ideal view; only what is sent to the PLC is shifted.</p>

    {tab === 'model' && <>
      <label className="pb-row"><input type="checkbox" checked={s.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} />Compensate the show sent to the PLC</label>
      <fieldset className="ss-group"><legend>Music</legend>
        <Num label="Player / output buffer" value={s.audio.playerMs} onChange={(v) => set({ audio: { playerMs: v } })} title="Sound card / player latency (Windows shared mode ≈ 20–50 ms)" />
        <Num label="DSP / processor" value={s.audio.dspMs} onChange={(v) => set({ audio: { dspMs: v } })} />
        <Num label="Amplifier" value={s.audio.ampMs} onChange={(v) => set({ audio: { ampMs: v } })} />
        <Num label="Air temperature" value={s.tempC} unit={`°C · sound ${Math.round(speedOfSound(s.tempC) * 10) / 10} m/s`} min={-30} max={55} step={0.5} onChange={(v) => set({ tempC: v })} />
        <Num label="Speakers → listener" value={s.speakerDistanceM} unit="m (blank: at the fountain)" blank step={0.5} placeholder="auto" onChange={(v) => set({ speakerDistanceM: v })} title="Used when no speaker positions are listed" />
        <label className="ss-num ss-wide"><span>Speaker positions</span>
          <textarea aria-label="Speaker positions" rows={2} value={speakerDraft} placeholder="x, y (m) — one speaker or cluster per line" onChange={(e) => setSpeakerDraft(e.target.value)} onBlur={(e) => saveSpeakers(e.target.value)} /></label>
      </fieldset>
      <fieldset className="ss-group"><legend>Listener and audience</legend>
        <Num label="Listener x" value={s.listener?.x ?? null} unit="m" blank step={0.5} min={-10000} placeholder={String(model.listener.x)} onChange={(v) => set({ listener: v === null ? null : { x: v, y: s.listener?.y ?? model.listener.y } })} />
        <Num label="Listener y" value={s.listener?.y ?? null} unit="m" blank step={0.5} min={-10000} placeholder={String(model.listener.y)} onChange={(v) => set({ listener: v === null ? null : { x: s.listener?.x ?? model.listener.x, y: v } })} />
        <Num label="Audience starts" value={s.audience.frontM} unit="m in front of the fountain" step={0.5} onChange={(v) => set({ audience: { frontM: v } })} />
        <Num label="Audience depth" value={s.audience.depthM} unit="m" step={0.5} onChange={(v) => set({ audience: { depthM: v } })} />
        <Num label="Audience width" value={s.audience.widthM} unit="m (blank: fountain width)" blank step={0.5} onChange={(v) => set({ audience: { widthM: v } })} />
        <small className="pb-note">Listener {s.listener ? 'set by you' : `auto: centre of the audience (${model.area.front.source === 'seating' ? 'from the seating in the design' : 'in front of the fountain'})`} at ({model.listener.x}, {model.listener.y}), {model.listener.distanceM} m from the {(s.speakers || []).length ? 'nearest speaker' : 'speakers'}.</small>
      </fieldset>
      <fieldset className="ss-group"><legend>Control path (AquaFlow PC → Siemens PLC)</legend>
        <Num label="Show frame period" value={s.control.frameMs} onChange={(v) => set({ control: { frameMs: v } })} title="AquaFlow sends one command frame about every 100 ms plus the S7 round trip" />
        <Num label="Network / S7 write" value={s.control.networkMs} onChange={(v) => set({ control: { networkMs: v } })} />
        <Num label="PLC cycle (OB)" value={s.control.plcCycleMs} onChange={(v) => set({ control: { plcCycleMs: v } })} title="The AquaFlow cyclic interrupt OB runs every 100 ms" />
        <Num label="Output card" value={s.control.outputMs} onChange={(v) => set({ control: { outputMs: v } })} title="Relay outputs ≈ 10 ms, transistor < 1 ms" />
        <Num label="Valve opening" value={s.valveMs} onChange={(v) => set({ valveMs: v })} title="Used for nozzle types without a video calibration" />
        <Num label="VFD response" value={s.vfdMs} onChange={(v) => set({ vfdMs: v })} title="Command to speed change; the ramp itself is already started early" />
        <Num label="Swing motor" value={s.motorMs} onChange={(v) => set({ motorMs: v })} />
      </fieldset>
      <fieldset className="ss-group"><legend>Lights</legend>
        <label className="ss-num"><span>Lights driven by</span><select aria-label="Lights driven by" value={s.lights.via} onChange={(e) => set({ lights: { via: e.target.value } })}>
          <option value="plc">the PLC (DMX / analog interface)</option><option value="artnet">Art-Net from the AquaFlow PC</option></select></label>
        <Num label="DMX frame" value={s.lights.dmxMs} onChange={(v) => set({ lights: { dmxMs: v } })} title="A full 512-channel DMX frame takes ≈ 23 ms" />
        <Num label="Fixture latency" value={s.lights.fixtureMs} onChange={(v) => set({ lights: { fixtureMs: v } })} title="Used when the fixture type has no latencyMs" />
      </fieldset>

      <SyncBreakdown model={model} />
      {(s.correctionMs?.water || s.correctionMs?.lights) ? <small className="pb-note">Measured corrections included: water {signed(s.correctionMs.water || 0)}, lights {signed(s.correctionMs.lights || 0)}. <button onClick={() => set({ correctionMs: { water: 0, lights: 0 } })}>Clear</button></small> : null}

      <div className="ss-result" role="status">
        <strong>Audience spread: {ms(model.spread.spreadMs)}</strong>
        <small>{model.spread.seats.map(fmtSeat).join(' · ')}</small>
        <small>The timing is exact at the listener. Under ≈ 40 ms nobody notices; above ≈ 80 ms the front or back rows see the water before / after the beat — move the speakers closer to the audience or split them.</small>
      </div>
      <fieldset className="ss-group"><legend>Music start on site</legend>
        <label className="pb-row"><input type="radio" name="ss-start" checked={s.audioStartMs === null || s.audioStartMs === undefined} onChange={() => set({ audioStartMs: null })} />Recommended{result ? `: start the music ${ms(result.recommendedAudioStartMs)} after the PLC show starts` : ' (from the compiled show)'}</label>
        <div className="pb-row"><label><input type="radio" name="ss-start" checked={s.audioStartMs !== null && s.audioStartMs !== undefined} onChange={() => set({ audioStartMs: result?.recommendedAudioStartMs ?? 0 })} />Fixed (your player cannot start later):</label>
          <Num label="Music starts after the PLC show" value={s.audioStartMs ?? ''} onChange={(v) => set({ audioStartMs: v })} /></div>
        {result && <small className="pb-note">{result.enabled ? `Music start offset ${ms(result.audioStartMs)}. Water cues move ${result.byKind.water ? `${Math.round(result.byKind.water.minShiftMs)}…${Math.round(result.byKind.water.maxShiftMs)} ms` : '—'}, lights ${result.byKind.light ? `${Math.round(result.byKind.light.minShiftMs)}…${Math.round(result.byKind.light.maxShiftMs)} ms` : '—'} on the PLC clock.${result.trimmed.length ? ` ${result.trimmed.length} clip(s) at the very start are cut short: they would have to start before the show — use the recommended offset.` : ''}` : 'Compensation is off: the PLC plays the timeline as drawn.'}</small>}
      </fieldset>
      <label className="pb-row"><input type="checkbox" checked={!!s.previewAsHeard} onChange={(e) => set({ previewAsHeard: e.target.checked })} />Preview as heard at the audience (the preview's music lags by {ms(model.audio.totalMs)}, uncompensated)</label>
    </>}

    {tab === 'test' && <SyncTestPanel settings={s} model={model} set={set} />}
    {tab === 'measure' && <MeasurePanel settings={s} set={set} />}
  </div>;
}

function SyncTestPanel({ settings, set }) {
  const t = settings.test || { periodS: 2, durationS: 32 };
  return <div>
    <p className="pb-note">The sync test is a click (a short beep every {t.periodS} s) and a matching cue set: one jet group reaches its top and every light flashes on each beep. It plays only when you press “Play sync test” in Compile / Siemens, through the normal checks (confirm, compile, verify, arm, start).</p>
    <div className="pb-row">
      <Num label="Beep every" value={t.periodS} unit="s" step={0.5} min={1} max={10} onChange={(v) => set({ test: { periodS: v } })} />
      <Num label="Test length" value={t.durationS} unit="s" step={1} min={8} max={120} onChange={(v) => set({ test: { durationS: v } })} />
      <button onClick={() => downloadClickTrack(t)}>Download click track (WAV)</button>
    </div>
    <ol className="ss-steps">
      <li>Set up the site as for the show: PLC, music player, amplifier, speakers. Measure the air temperature.</li>
      <li>In Compile / Siemens tick “Play the music from this PC” (the click plays from the AquaFlow PC at the music start offset), or load the click track on the site player and start it the offset shown after the PLC show starts.</li>
      <li>Stand at the listener position. Film the fountain with a phone (sound on, 60 fps if possible) — keep the jets and the lights in the frame.</li>
      <li>Press “Play sync test on the PLC”. The test plays {Math.floor((t.durationS - 2) / t.periodS)} beeps.</li>
      <li>Open Measure: load the video, mark the frames where the water reaches its top and where the lights come on; AquaFlow finds the beeps in the video's sound. Or use the tap tool live.</li>
      <li>Save the correction. Repeat until the residual is within ± 20 ms.</li>
    </ol>
  </div>;
}

function MeasurePanel({ settings, set }) {
  const periodS = settings.test?.periodS || 2;
  const [url, setUrl] = useState(null);
  const [beeps, setBeeps] = useState([]);
  const [marks, setMarks] = useState({ water: [], lights: [] });
  const [note, setNote] = useState('');
  const [taps, setTaps] = useState({ heard: [], water: [], lights: [] });
  const video = useRef(null);
  const load = async (file) => {
    setUrl(URL.createObjectURL(file)); setMarks({ water: [], lights: [] }); setBeeps([]); setNote('Looking for the beeps in the video sound…');
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      ctx.close?.();
      const found = detectBeeps(buffer.getChannelData(0), buffer.sampleRate, { minGapS: periodS * 0.6 });
      setBeeps(found);
      setNote(found.length ? `Found ${found.length} beeps in the sound.` : 'No beeps found in the sound: mark them by hand (“Beep heard here”).');
    } catch (e) { setNote(`Could not read the video sound (${e.message}): mark the beeps by hand.`); }
  };
  const now = () => Math.round((video.current?.currentTime || 0) * 1000) / 1000;
  const step = (dt) => { if (video.current) video.current.currentTime = Math.max(0, video.current.currentTime + dt); };
  const water = measureResidual(beeps, marks.water, { periodS }), lights = measureResidual(beeps, marks.lights, { periodS });
  const tapWater = tapResidual(taps.heard, taps.water, periodS), tapLights = tapResidual(taps.heard, taps.lights, periodS);
  const tap = (key) => setTaps((t) => ({ ...t, [key]: [...t[key], performance.now() / 1000] }));
  const save = (kind, r, source) => { set(correctionPatch(settings, kind, r.residualMs, { n: r.n, source })); setNote(`Saved: ${kind} ${r.residualMs > 0 ? 'fire' : 'wait'} ${Math.abs(Math.round(r.residualMs))} ms ${r.residualMs > 0 ? 'earlier' : 'longer'} from now on.`); };
  const line = (label, r, kind, source) => <div className="pb-row" role="status"><span>{label}: {r.residualMs === null ? `need marks (${r.n})` : `seen ${Math.abs(Math.round(r.residualMs))} ms ${r.residualMs > 0 ? 'after' : 'before'} the beep (${r.n} marks, spread ${Math.round(r.spreadMs)} ms)`}</span>
    <span className="sp-grow" /><button disabled={r.residualMs === null} onClick={() => save(kind, r, source)}>Save as correction</button></div>;
  return <div>
    <p className="pb-note">Film from the listener position. The camera hears the beep and sees the water at the same place as the audience, so the difference is what the audience perceives.</p>
    <label className="pb-file">{url ? 'Change video' : 'Load sync test video'}
      <input type="file" accept="video/*" hidden aria-label="Sync test video" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} /></label>
    {url && <>
      <video ref={video} src={url} style={{ width: '100%', display: 'block' }} playsInline controls />
      <div className="pb-row">
        <button onClick={() => step(-1 / 60)}>◀ frame</button><button onClick={() => step(1 / 60)}>frame ▶</button>
        <button onClick={() => setBeeps((b) => [...b, now()].sort((x, y) => x - y))}>Beep heard here ({beeps.length})</button>
        <button onClick={() => setMarks((m) => ({ ...m, water: [...m.water, now()] }))}>Water at its top here ({marks.water.length})</button>
        <button onClick={() => setMarks((m) => ({ ...m, lights: [...m.lights, now()] }))}>Lights on here ({marks.lights.length})</button>
        <button onClick={() => { setMarks({ water: [], lights: [] }); }}>Clear marks</button>
      </div>
      {line('Water', water, 'water', 'video')}
      {line('Lights', lights, 'lights', 'video')}
    </>}
    <fieldset className="ss-group"><legend>Tap tool (no video)</legend>
      <small className="pb-note">While the sync test plays: first tap on every beep you hear (8 or more), then on every water top, then on every light flash. Your reaction time cancels out.</small>
      <div className="pb-row">
        <button onClick={() => tap('heard')}>Beep heard ({taps.heard.length})</button>
        <button onClick={() => tap('water')}>Water top seen ({taps.water.length})</button>
        <button onClick={() => tap('lights')}>Light flash seen ({taps.lights.length})</button>
        <button onClick={() => setTaps({ heard: [], water: [], lights: [] })}>Reset</button>
      </div>
      {line('Water (taps)', tapWater, 'water', 'taps')}
      {line('Lights (taps)', tapLights, 'lights', 'taps')}
    </fieldset>
    {note && <small className="pb-note" role="status">{note}</small>}
    {(settings.measurements || []).length > 0 && <small className="pb-note">History: {settings.measurements.slice(-5).map((m) => `${m.kind} ${m.residualMs > 0 ? '+' : ''}${m.residualMs} ms (${m.source || 'measured'})`).join(' · ')}</small>}
    <small className="pb-note">Beeps of the test: {clickTimes(settings.test).length} at {periodS} s intervals.</small>
  </div>;
}
