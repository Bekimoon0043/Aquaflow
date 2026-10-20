// Look library — every look the phrase search can choose, with tags. Pure data.
//
//   parts     music parts it suits: hits (kick / snare), hats, melody, follow (bass, pads, loudness)
//   controls  area control it can be performed on: switch (solenoids), height (own drive), pump (shared pump only)
//   energy    how intense it reads (0..1) — matched to the section's energy target
//   duty      share of jets with water at a time on solenoid areas — matched to the coverage target
//   speed     slow | mid | fast — matched to onset density
//   hero      a hero moment (rare, planned): only where the plan allows it

import { FAMOUS_PATTERNS } from './famousPatterns';

export const PRESET_LOOKS = [
  { id: 'breathing', name: 'Breathing', preset: 'breathing', parts: ['follow', 'melody', 'hits', 'hats'], controls: ['switch', 'height', 'pump'], energy: 0.4, duty: 1, speed: 'slow', minJets: 1 },
  { id: 'wave', name: 'Smooth wave', preset: 'wave', parts: ['melody', 'follow'], controls: ['switch', 'height'], energy: 0.55, duty: 0.5, speed: 'mid', minJets: 3 },
  { id: 'mirror', name: 'Mirror', preset: 'mirror', parts: ['melody'], controls: ['switch', 'height'], energy: 0.6, duty: 0.5, speed: 'mid', minJets: 4 },
  { id: 'ripple', name: 'Ripple', preset: 'ripple', parts: ['hits', 'melody'], controls: ['switch', 'height'], energy: 0.65, duty: 0.45, speed: 'mid', minJets: 3 },
  { id: 'chase', name: 'Chase', preset: 'chase', parts: ['hits', 'hats'], controls: ['switch', 'height'], energy: 0.6, duty: 0.25, speed: 'fast', minJets: 4 },
  { id: 'sparkle', name: 'Sparkle', preset: 'sparkle', parts: ['hats'], controls: ['switch', 'height'], energy: 0.5, duty: 0.25, speed: 'fast', minJets: 6 },
  { id: 'pulse', name: 'Pulse', preset: 'pulse', parts: ['hits'], controls: ['switch', 'height'], energy: 0.8, duty: 0.45, speed: 'fast', minJets: 1 },
];

const FAMOUS_TAGS = {
  'shooter-salvo': { energy: 0.95, duty: 0.4, speed: 'mid', hero: true },
  'stadium-wave': { energy: 0.7, duty: 0.3, speed: 'fast' },
  'swaying-arcs': { energy: 0.6, duty: 0.4, speed: 'slow' },
  'peacock-fan': { energy: 0.7, duty: 0.5, speed: 'mid' },
  'crossing-waves': { energy: 0.65, duty: 0.4, speed: 'mid' },
  'rolling-sea': { energy: 0.55, duty: 0.5, speed: 'mid' },
  'see-saw': { energy: 0.6, duty: 0.5, speed: 'mid' },
  rain: { energy: 0.45, duty: 0.25, speed: 'fast' },
  'waterfall-steps': { energy: 0.6, duty: 0.35, speed: 'mid' },
  heartbeat: { energy: 0.7, duty: 1, speed: 'fast' },
  'lotus-bloom': { energy: 0.4, duty: 0.5, speed: 'slow' },
  'grand-swell': { energy: 0.5, duty: 1, speed: 'slow' },
  'grand-finale': { energy: 1, duty: 0.6, speed: 'fast', hero: true },
  'running-gap': { energy: 0.8, duty: 0.8, speed: 'fast' },
  'wall-pulse': { energy: 0.85, duty: 0.7, speed: 'mid' },
};

export const LOOKS = [
  ...PRESET_LOOKS,
  ...FAMOUS_PATTERNS.map((f) => ({ id: f.id, name: f.name, famous: f.id, parts: f.parts, controls: f.controls, minJets: f.minJets,
    style: f.style, energy: 0.6, duty: 0.5, speed: 'mid', ...FAMOUS_TAGS[f.id], hero: !!FAMOUS_TAGS[f.id]?.hero })),
];
export const lookById = (id) => LOOKS.find((l) => l.id === id) || null;
export const SPEED_RANK = { slow: 0, mid: 0.5, fast: 1 };
