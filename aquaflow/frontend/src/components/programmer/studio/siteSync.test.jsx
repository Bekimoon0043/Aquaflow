// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { compileForSite, compileStudio, inventory, newRecipe, readStudio } from './showModel';
import { riseTime } from '../../preview/waterPhysics';
import {
  applySiteSync, audioChain, buildSyncModel, clickTimes, clickTrackWav, clipExtraMs, controlPath, correctionPatch, detectBeeps,
  measureResidual, outputChain, patchSync, readSync, speedOfSound, syncTestClips, tapResidual, SYNC_DEFAULTS,
} from './siteSync';
import SiteSyncDialog from './SiteSyncDialog';
import { patchStudioSite, syncTestShow } from './StudioPlcPanel';
import { heardDelayS, syncAudioElement } from './previewAudio';

// Eight 4 m jets with their own solenoid and light on one pump, plus seating in front (+y).
const jets = Array.from({ length: 8 }, (_, i) => ({ i, x: i * 2 - 7, y: 0 }));
const fixtures = [
  ...jets.map(j => ({ id: `jet${j.i}`, type: 'nozzle_straight_dn25', label: `Jet ${j.i}`, x: j.x, y: j.y, zone: 'line',
    engineering: { jetHeightM: 4, solenoidValveId: `valve${j.i}`, pumpId: 'pumpA' } })),
  ...jets.map(j => ({ id: `valve${j.i}`, type: 'valve_solenoid_dn25_24v', label: `Valve ${j.i}`, x: j.x, y: j.y,
    engineering: { controlledFixtureId: `jet${j.i}`, pumpId: 'pumpA' } })),
  ...jets.map(j => ({ id: `light${j.i}`, type: 'light_uw_rgb_18w', label: `Light ${j.i}`, x: j.x, y: j.y, engineering: { pairedNozzleId: `jet${j.i}` } })),
  { id: 'pumpA', type: 'pump_inline_vfd_pump_18_5kw', label: 'Pump A - 18.5 kW', x: 0, y: -6, engineering: { powerKw: 18.5, servesValveIds: jets.map(j => `valve${j.i}`) } },
];
const items = inventory(fixtures);
const near = (a, b, tol = 0.15) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

afterEach(cleanup);

describe('site sync model', () => {
  it('speed of sound follows 331.3 + 0.606·T', () => {
    expect(speedOfSound(0)).toBeCloseTo(331.3, 6);
    expect(speedOfSound(25)).toBeCloseTo(346.45, 6);
    expect(speedOfSound(-10)).toBeCloseTo(325.24, 6);
    expect(readSync({}).tempC).toBe(25);
  });

  it('sums the audio chain: electronics plus air at the listener', () => {
    const s = readSync({ sync: { audio: { playerMs: 40, dspMs: 8, ampMs: 2 }, tempC: 25 } });
    const a = audioChain(s, 34.645);
    near(a.parts.find(p => p.key === 'air').ms, 100);
    near(a.totalMs, 150);
  });

  it('sums the control path and each output chain', () => {
    const s = readSync({});
    expect(controlPath(s).totalMs).toBe(145);                     // 75 + 10 + 50 + 10
    const v = outputChain(s, { actuator: 'valve', heightM: 4 });
    near(v.totalMs, 145 + 100 + 1000 * riseTime(4));
    near(v.riseMs, 1000 * riseTime(4));
    // A calibrated nozzle uses its measured valve delay and drag speed.
    const c = outputChain(s, { actuator: 'valve', heightM: 4, cal: { delayS: 0.25, vtMs: 20 } });
    near(c.totalMs, 145 + 250 + 1000 * riseTime(4, 20));
    expect(outputChain(s, { actuator: 'light', fixtureMs: 5 }).totalMs).toBe(145 + 25 + 5);
    expect(outputChain(readSync({ sync: { lights: { via: 'artnet' } } }), { actuator: 'light' }).totalMs).toBe(12.5 + 25 + 20);
  });

  it('builds per-output rows, listener and audience spread from the design', () => {
    const m = buildSyncModel(items, {});
    expect(m.rows[0].key).toBe('audio');
    expect(m.rows.some(r => r.kind === 'water' && r.count === 8)).toBe(true);
    expect(m.rows.find(r => r.key === 'lights').count).toBe(8);
    const valve = m.outputs.get('valve3');
    near(valve.advanceMs, valve.totalMs - m.audio.totalMs, 0.01);
    // Listener in front of the fountain; the back row hears the music later than the front row.
    const back = m.spread.seats.find(s => s.key === 'back-centre'), front = m.spread.seats.find(s => s.key === 'front-centre');
    expect(back.offsetMs).toBeGreaterThan(0);
    expect(front.offsetMs).toBeLessThan(0);
    near(m.spread.spreadMs, Math.max(...m.spread.seats.map(s => s.offsetMs)) - Math.min(...m.spread.seats.map(s => s.offsetMs)), 0.11);
    // Speakers next to the audience shrink the acoustic part.
    const close = buildSyncModel(items, { sync: { speakers: [{ x: m.listener.x, y: m.listener.y - 2 }] } });
    expect(close.audio.totalMs).toBeLessThan(m.audio.totalMs);
  });
});

describe('advances on compiled clips', () => {
  const model = buildSyncModel(items, {});
  const audio = model.audio.totalMs;
  const valve = model.outputs.get('valve0'), light = model.outputs.get('light0');

  it('never counts the water lead twice', () => {
    // Hand-made water clip: the preview already shows the rise → control + valve − audio.
    const hand = clipExtraMs({ fixtureId: 'valve0', type: 'solenoid_open', startTime: 10, duration: 2 }, model);
    near(hand.extraMs, 145 + 100 - audio);
    // Generated pattern: started early by leadS already → only the rest.
    const gen = clipExtraMs({ fixtureId: 'valve0', type: 'solenoid_open', startTime: 10, duration: 2, leadS: 0.5 }, model);
    near(gen.extraMs, valve.totalMs - audio - 500);
    // Its light was shifted with the water: it comes back onto the beat (negative extra).
    const lit = clipExtraMs({ fixtureId: 'light0', type: 'lighting_master', startTime: 10, duration: 2, leadS: 0.5 }, model);
    near(lit.extraMs, light.totalMs - audio - 500);
    expect(lit.extraMs).toBeLessThan(0);
  });

  it('recommends a music start offset instead of firing before t = 0', () => {
    const clips = [
      { id: 'a', fixtureId: 'valve0', type: 'solenoid_open', startTime: 0, duration: 2, value: 100 },
      { id: 'b', fixtureId: 'light0', type: 'lighting_master', startTime: 5, duration: 1, value: 100 },
    ];
    const extraA = clipExtraMs(clips[0], model).extraMs, extraB = clipExtraMs(clips[1], model).extraMs;
    const r = applySiteSync(clips, model);
    expect(r.recommendedAudioStartMs).toBe(Math.ceil(extraA));
    expect(r.audioStartMs).toBe(r.recommendedAudioStartMs);
    const a = r.clips.find(c => c.id === 'a'), b = r.clips.find(c => c.id === 'b');
    near(a.startTime * 1000, r.audioStartMs - extraA, 1);
    near(b.startTime * 1000, 5000 + r.audioStartMs - extraB, 1);
    // Relative to the music, every output fires early by exactly its extra advance.
    near((r.audioStartMs / 1000 + 5) - b.startTime, extraB / 1000, 0.002);
    expect(r.trimmed).toEqual([]);
  });

  it('with a fixed music start, clips that would start before 0 are trimmed and reported', () => {
    const m = buildSyncModel(items, { sync: { audioStartMs: 0, control: { frameMs: 400 } } });
    const clip = { id: 'k', fixtureId: 'valve0', type: 'solenoid_open', startTime: 0, duration: 3, value: 100, keys: [0, 0, 1, 100, 3, 100] };
    const r = applySiteSync([clip], m);
    expect(r.audioStartMs).toBe(0);
    expect(r.trimmed).toHaveLength(1);
    expect(r.clips[0].startTime).toBe(0);
    expect(r.clips[0].duration).toBeLessThan(3);
    expect(r.clips[0].keys[0]).toBe(0);
  });

  it('switched off: the PLC gets the timeline as drawn', () => {
    const clips = [{ id: 'a', fixtureId: 'valve0', type: 'solenoid_open', startTime: 1, duration: 2, value: 100 }];
    const r = applySiteSync(clips, buildSyncModel(items, { sync: { enabled: false } }));
    expect(r.clips).toBe(clips);
    expect(r.audioStartMs).toBe(0);
  });

  it('compile shifts each output of a generated pattern by its own advance', () => {
    const studio = readStudio({ studio: {
      groups: [{ id: 'g-jets', name: 'Jets', memberFixtureIds: jets.map(j => `jet${j.i}`) }, { id: 'g-lights', name: 'Lights', memberFixtureIds: jets.map(j => `light${j.i}`) }],
      recipes: [
        { ...newRecipe('g-jets', 2), id: 'r-water', effect: 'pulse', duration: 8, cycles: 4, hardware: 'hits', pattern: { leadS: 0.6 } },
        { ...newRecipe('g-lights', 2), id: 'r-light', effect: 'pulse', duration: 8, cycles: 4, pattern: { leadS: 0.6 } },
        { ...newRecipe('g-jets', 20), id: 'r-hand', effect: 'static', duration: 4 },
      ] } });
    const { clips } = compileStudio(studio, items);
    // The lead travels onto the valve and pump clips hardwareFollow makes.
    expect(clips.filter(c => c.hardware && c.type === 'solenoid_open' && c.studioRecipeId === 'r-water').every(c => c.leadS === 0.6)).toBe(true);
    expect(clips.some(c => c.hardware && c.type === 'pump_speed' && c.leadS === 0.6)).toBe(true);
    const site = compileForSite(studio, items, clips);
    const D = site.audioStartMs;
    const byId = new Map(site.clips.map(c => [c.id, c]));
    for (const c of clips) {
      const out = byId.get(c.id);
      if (!out) continue;
      const o = site.model.outputs.get(c.fixtureId);
      const covered = c.leadS ? 1000 * c.leadS : o.kind === 'water' ? o.riseMs : 0;
      near((out.startTime - c.startTime) * 1000, D - (o.totalMs - site.model.audio.totalMs - covered), 1.01);
    }
    // Lights of the generated pattern move later (back onto the beat), hand water earlier than D.
    const light = site.clips.find(c => c.studioRecipeId === 'r-light');
    expect(light.siteShiftMs).toBeGreaterThan(D);
  });
});

describe('sync test', () => {
  it('click track: 16-bit WAV with a beep every period', () => {
    const wav = clickTrackWav({ durationS: 9, periodS: 2, firstS: 2, sampleRate: 8000 });
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(8000);
    const samples = new Float32Array((wav.length - 44) / 2).map((_, i) => v.getInt16(44 + 2 * i, true) / 32768);
    expect(detectBeeps(samples, 8000)).toEqual(clickTimes({ durationS: 9, periodS: 2, firstS: 2 }).map(t => expect.closeTo(t, 2)));
  });

  it('test cues: jets reach their top on each beep, lights flash on it', () => {
    const t = syncTestClips(items, { durationS: 12, periodS: 2 });
    expect(t.beeps).toEqual([2, 4, 6, 8, 10]);
    const lights = t.clips.filter(c => c.fixtureId.startsWith('light'));
    expect(lights).toHaveLength(8 * 5);
    expect(lights.every(c => t.beeps.includes(c.startTime) && !c.leadS)).toBe(true);
    const water = t.clips.filter(c => c.fixtureId.startsWith('jet'));
    expect(water.length).toBeGreaterThan(0);
    expect(water.every(c => Math.abs(c.startTime + c.leadS - t.beeps.find(b => Math.abs(b - c.startTime - c.leadS) < 0.01)) < 0.01)).toBe(true);
    // Only plain clips: playing them is a separate, user-initiated PLC start.
    const show = syncTestShow(items, { sync: { test: { periodS: 2, durationS: 12 } } });
    expect(show.clips.length).toBe(t.clips.length);
    expect(show.audioStartMs).toBeGreaterThanOrEqual(0);
  });

  it('measures the residual from video marks and from taps, and stores it as a correction', () => {
    const beeps = [2, 4, 6, 8];
    const r = measureResidual(beeps, [2.06, 4.05, 6.07, 8.06]);
    expect(r.residualMs).toBe(60);
    expect(r.n).toBe(4);
    const taps = tapResidual([10.2, 12.21, 14.19, 16.2], [30.28, 32.27, 34.29, 36.28], 2);
    near(taps.residualMs, 80, 2);
    const patch = correctionPatch(readSync({}), 'water', 60, { source: 'video' });
    const site = patchSync({ front: 'x' }, patch);
    expect(site.front).toBe('x');
    expect(readSync(site).correctionMs.water).toBe(60);
    // The correction moves the water chain (and its advance) by the measured amount.
    const before = buildSyncModel(items, {}).outputs.get('valve0').totalMs;
    expect(buildSyncModel(items, site).outputs.get('valve0').totalMs).toBeCloseTo(before + 60, 5);
  });
});

describe('settings persistence', () => {
  it('readStudio keeps studio.site.sync and patches merge one level deep', () => {
    let site = patchSync(undefined, { tempC: 31, audio: { dspMs: 12 } });
    site = patchSync(site, { audio: { ampMs: 3 } });
    expect(site.sync).toMatchObject({ version: 1, tempC: 31, audio: { dspMs: 12, ampMs: 3 } });
    const studio = readStudio({ studio: { site } });
    expect(readSync(studio.site)).toMatchObject({ tempC: 31, audio: { playerMs: SYNC_DEFAULTS.audio.playerMs, dspMs: 12, ampMs: 3 } });
  });

  it('the PLC panel writes into the project show document', () => {
    let state = { programmer: { studio: { recipes: [], site: { windMs: 3 } } } };
    state.rememberProgrammer = (p) => { state = { ...state, programmer: p }; };
    const store = { getState: () => state };
    patchStudioSite({ playFromPc: true }, store);
    expect(state.programmer.studio.site).toMatchObject({ windMs: 3, sync: { playFromPc: true } });
  });

  it('preview as heard: the song lags the picture by the stored audio chain', () => {
    expect(heardDelayS({ studio: { site: { sync: { previewAsHeard: true, previewDelayMs: 120 } } } })).toBeCloseTo(0.12, 6);
    expect(heardDelayS({ studio: { site: { sync: { previewAsHeard: false, previewDelayMs: 120 } } } })).toBe(0);
    const audio = { paused: false, currentTime: 3, duration: 100, pause() { this.paused = true; } };
    expect(syncAudioElement(audio, { position: -0.05, playback: 'playing' })).toBe('waiting');
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(0);
  });
});

describe('Site sync dialog', () => {
  it('renders the breakdown per output and saves edits to studio.site.sync', () => {
    const patches = [];
    render(<SiteSyncDialog items={items} site={{}} clips={[{ id: 'a', fixtureId: 'valve0', type: 'solenoid_open', startTime: 0, duration: 2, value: 100 }]} onPatch={p => patches.push(p)} onClose={() => {}} />);
    const table = screen.getByRole('table', { name: 'Site sync breakdown' });
    expect(within(table).getByText('Music at the listener')).toBeTruthy();
    expect(within(table).getByText(/Lights/)).toBeTruthy();
    expect(within(table).getAllByText(/valve/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Audience spread/)).toBeTruthy();
    expect(screen.getByText(/start the music \d+ ms after the PLC show starts/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Air temperature'), { target: { value: '35' } });
    expect(patches.at(-1)).toMatchObject({ tempC: 35 });
    expect(patches.at(-1).previewDelayMs).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Sync test'));
    expect(screen.getByText('Download click track (WAV)')).toBeTruthy();
    fireEvent.click(screen.getByText('Measure'));
    expect(screen.getByText(/Tap tool/)).toBeTruthy();
  });
});
