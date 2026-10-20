// World-famous fountain show looks, built from AquaFlow's own pattern pieces (builder presets
// and wave fields), timed in bars so they land on the music. Pure data + one picker.
//
// Each entry says which parts of the music it suits (`parts`: hits, hats, melody, follow),
// which kind of control it needs (`controls`: switch = on/off solenoids, height = per-jet
// height, pump = jets that only move together with their pump), how many jets it needs, and
// `valve`: how a solenoid follows it ('hits' = opens on each crest, 'open' = stays open
// while the pump shapes the height).

const bars = (n, barSec) => Math.round(n * barSec * 1000) / 1000;

export const FAMOUS_PATTERNS = [
  { id: 'shooter-salvo', name: 'Shooter salvo', style: 'Las Vegas lake-show finale: the tall jets fire in volleys from the centre out, one on each bar',
    parts: ['hits'], controls: ['switch', 'height'], minJets: 4, energy: 0.5, valve: 'hits',
    make: ({ barSec }) => ({ preset: 'ripple', options: { lapSeconds: bars(1, barSec), order: 'center-out', crests: 1, smoothness: 'sharp' }, floor: 0 }) },
  { id: 'stadium-wave', name: 'Stadium wave', style: 'The Mexican wave: one crest races round the fountain, jets jump up fast and settle slowly',
    parts: ['hats', 'hits'], controls: ['switch', 'height'], minJets: 8, valve: 'hits',
    make: ({ barSec }) => ({ field: { kind: 'stadium', period: bars(2, barSec), width: 0.06, direction: 1 } }) },
  { id: 'swaying-arcs', name: 'Swaying arcs', style: 'Dubai-style sway: the water leans from one side to the other and back with the melody',
    parts: ['melody', 'follow'], controls: ['height', 'switch'], minJets: 6, valve: 'hits',
    make: ({ barSec }) => ({ field: { kind: 'custom', shape: 'bump', width: 0.22, path: 'from-point', origin: 'left', crests: 1, motion: 'there-and-back', period: bars(4, barSec) } }) },
  { id: 'peacock-fan', name: 'Peacock fan', style: 'Opens from the middle out to both sides like a peacock tail, then folds back',
    parts: ['melody'], controls: ['height', 'switch'], minJets: 4, valve: 'hits',
    make: ({ barSec }) => ({ preset: 'mirror', options: { lapSeconds: bars(2, barSec), order: 'outward', crests: 1, smoothness: 'smooth' } }) },
  { id: 'crossing-waves', name: 'Crossing waves', style: 'Magic-fountain style: two waves run opposite ways round the basin and pass through each other',
    parts: ['melody', 'follow'], controls: ['height', 'switch'], minJets: 8, valve: 'hits',
    make: ({ barSec }) => ({ field: { kind: 'crossing', period: bars(4, barSec), crests: 2, width: 0.12 } }) },
  { id: 'rolling-sea', name: 'Rolling sea', style: 'Long ocean rollers: crests roll from the far end down both sides',
    parts: ['follow'], controls: ['height', 'switch'], minJets: 6, valve: 'hits',
    make: ({ barSec }) => ({ field: { kind: 'rolling', period: bars(2, barSec), crests: 1.67, origin: 'tip', stairs: 0 } }) },
  { id: 'see-saw', name: 'See-saw', style: 'Neighbouring blocks answer each other: one rises while the next lowers',
    parts: ['hits', 'follow'], controls: ['height', 'switch'], minJets: 8, valve: 'hits',
    make: ({ barSec }) => ({ field: { kind: 'seesaw', period: bars(2, barSec), block: 4, drift: bars(8, barSec) } }) },
  { id: 'rain', name: 'Rain', style: 'Jets flick up at random like raindrops on a lake',
    parts: ['hats'], controls: ['switch', 'height'], minJets: 6, valve: 'hits',
    make: ({ beatSec }) => ({ preset: 'sparkle', options: { lapSeconds: Math.round(4 * beatSec * 1000) / 1000, smoothness: 'sharp' }, floor: 0 }) },
  { id: 'waterfall-steps', name: 'Waterfall steps', style: 'A step cascade: jets come up one after another from left to right',
    parts: ['hats', 'hits'], controls: ['switch', 'height'], minJets: 6, valve: 'hits',
    make: ({ barSec }) => ({ preset: 'chase', options: { lapSeconds: bars(2, barSec), order: 'left-to-right', crests: 1, smoothness: 'sharp' } }) },
  { id: 'heartbeat', name: 'Heartbeat', style: 'Lub-dub: two quick beats and a rest on every bar',
    parts: ['hits'], controls: ['height'], minJets: 1, valve: 'open',
    make: ({ barSec }) => ({ field: { kind: 'custom', shape: 'drawn', path: 'together', period: bars(1, barSec),
      points: [{ time: 0, value: 0 }, { time: 0.06, value: 1 }, { time: 0.16, value: 0.25 }, { time: 0.24, value: 0.9 }, { time: 0.4, value: 0 }, { time: 1, value: 0 }] } }) },
  { id: 'lotus-bloom', name: 'Lotus bloom', style: 'Slow rings open from the centre like a flower',
    parts: ['melody', 'follow'], controls: ['height', 'switch'], minJets: 3, valve: 'open',
    make: ({ barSec }) => ({ preset: 'ripple', options: { lapSeconds: bars(4, barSec), order: 'center-out', crests: 1, smoothness: 'smooth' } }) },
  { id: 'grand-swell', name: 'Grand swell', style: 'The whole area breathes up and down together, slowly, like the sea',
    parts: ['follow', 'melody', 'hits', 'hats'], controls: ['pump', 'height', 'switch'], minJets: 1, valve: 'open',
    make: ({ barSec }) => ({ field: { kind: 'swell', period: bars(4, barSec), lag: 0 } }) },
  { id: 'running-gap', name: 'Running gap', style: 'The negative chase: every jet stands tall while a gap races round the line',
    parts: ['hits', 'hats'], controls: ['switch', 'height'], minJets: 8, valve: 'hits',
    make: ({ barSec }) => ({ field: { kind: 'custom', shape: 'drawn', path: 'around', crests: 1, period: bars(2, barSec),
      points: [{ time: 0, value: 1 }, { time: 0.4, value: 1 }, { time: 0.5, value: 0 }, { time: 0.6, value: 1 }, { time: 1, value: 1 }] } }) },
  { id: 'wall-pulse', name: 'Wall pulse', style: 'The whole line stands up together and drops on the bar, like a beating wall of water',
    parts: ['hits'], controls: ['switch', 'height'], minJets: 3, valve: 'hits',
    make: ({ barSec }) => ({ field: { kind: 'custom', shape: 'drawn', path: 'together', period: bars(2, barSec),
      points: [{ time: 0, value: 0 }, { time: 0.06, value: 1 }, { time: 0.68, value: 1 }, { time: 0.78, value: 0 }, { time: 1, value: 0 }] } }) },
  { id: 'grand-finale', name: 'Grand finale', style: 'The closing build: a travelling wave that grows taller and faster',
    parts: ['hits', 'hats', 'melody', 'follow'], controls: ['height', 'switch'], minJets: 6, finale: true, valve: 'hits',
    make: ({ barSec }) => ({ field: { kind: 'finale', period: bars(2, barSec), crests: 3, accel: 0.002, direction: 1 } }) },
];
export const famousById = (id) => FAMOUS_PATTERNS.find((f) => f.id === id) || null;

/** Music part → the famous family it can use ('hits' kick/snare, 'hats', 'melody', 'follow'). */
export function partFamily(source) {
  if (!source) return 'follow';
  if (source.behaviour === 'hits') return source.field === 'hats' ? 'hats' : 'hits';
  return source.behaviour === 'melody' ? 'melody' : 'follow';
}

/**
 * The famous looks this area can perform for this part, in a stable order; `turn` picks one
 * (the same turn in a repeated section gives the same look). `finale` asks for the closing build.
 */
export function famousFor(source, area, { turn = 0, eRel = 0.5, finale = false } = {}) {
  const family = partFamily(source);
  const control = area?.control || 'height';
  const jets = area?.size || 1;
  const fits = FAMOUS_PATTERNS.filter((f) => f.parts.includes(family) && f.controls.includes(control) && jets >= f.minJets
    && (f.energy == null || eRel >= f.energy) && !!f.finale === false);
  if (finale) {
    const closing = FAMOUS_PATTERNS.find((f) => f.finale && f.controls.includes(control) && jets >= f.minJets);
    if (closing) return closing;
  }
  if (!fits.length) return null;
  return fits[((turn % fits.length) + fits.length) % fits.length];
}
