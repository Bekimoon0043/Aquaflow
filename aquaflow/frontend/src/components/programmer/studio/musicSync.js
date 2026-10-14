// The show's song and its beats: which file is loaded, analysis (browser Web Worker,
// tempo cross-checked with the backend's /api/beat/detect when it is running), and a
// per-file cache in the project (programmer.musicCache, keyed by the file's SHA-256).
import { useCallback, useEffect, useState } from 'react';
import useProjectStore from '../../../store/projectStore';
import { liveAssetFiles, sha256Hex } from '../../../utils/assetManifest';
import { apiPost } from '../../../utils/apiClient';
import { ANALYSIS_VERSION, analyzeSamples, buildAnalysis, downsample, toMono } from './musicAnalysis';

export const SONG_ASSET = 'audio:programmer';
export const CACHE_LIMIT = 4;

async function readBytes(file) {
  if (typeof file?.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Content hash of a song (SHA-256; FNV-1a where Web Crypto is unavailable). */
export async function hashFile(file) {
  let bytes;
  try { bytes = await readBytes(file); } catch { return `file:${file?.name}:${file?.size}:${file?.lastModified}`; }
  try { return `sha256:${await sha256Hex(bytes)}`; } catch { /* no Web Crypto */ }
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return `fnv:${bytes.length}:${h.toString(16)}`;
}

export function readCache(programmer, hash) {
  const entry = hash ? programmer?.musicCache?.[hash] : null;
  return entry && entry.version === ANALYSIS_VERSION ? entry : null;
}

/** Programmer document with `analysis` cached under `hash` (newest CACHE_LIMIT kept). */
export function withCache(programmer, hash, analysis) {
  const older = Object.entries(programmer?.musicCache || {}).filter(([key]) => key !== hash)
    .sort((a, b) => (b[1].cachedAt || 0) - (a[1].cachedAt || 0));
  const entries = [[hash, { ...analysis, hash, cachedAt: Date.now() }], ...older].slice(0, CACHE_LIMIT);
  return { ...(programmer || {}), musicCache: Object.fromEntries(entries) };
}

export function writeCache(hash, analysis) {
  const project = useProjectStore.getState();
  project.rememberProgrammer(withCache(project.programmer, hash, analysis));
}

/** Decode a song to mono samples at ~11 kHz. */
export async function decodeSong(file) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw new Error('This browser cannot decode audio');
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    return downsample(toMono(channels), buffer.sampleRate);
  } finally { context.close?.(); }
}

/** Run the analysis in a Web Worker (inline when workers are unavailable). */
export function analyzeInWorker(samples, rate) {
  if (typeof Worker === 'undefined') return Promise.resolve(analyzeSamples(samples, rate));
  return new Promise((resolve, reject) => {
    let worker;
    const inline = () => { try { resolve(analyzeSamples(samples, rate)); } catch (error) { reject(error); } };
    try { worker = new Worker(new URL('./musicAnalysis.worker.js', import.meta.url), { type: 'module' }); }
    catch { inline(); return; }
    worker.onmessage = ({ data }) => { worker.terminate(); if (data.error) reject(new Error(data.error)); else resolve(data); };
    worker.onerror = () => { worker.terminate(); inline(); };
    worker.postMessage({ id: 1, samples, rate });
  });
}

/** Tempo from the backend beat engine (45 s from the middle of the song), or null. */
export async function backendBpm(samples, rate, { timeoutMs = 12000, post = apiPost } = {}) {
  const span = Math.min(samples.length, Math.round(45 * rate));
  const from = Math.max(0, Math.floor((samples.length - span) / 2));
  const slice = Array.from(samples.subarray(from, from + span), v => Math.round(v * 1e4) / 1e4);
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); });
  try {
    const result = await Promise.race([post('/beat/detect', { samples: slice, sample_rate: Math.round(rate), hop: 128 }), timeout]);
    const bpm = Number(result?.bpm);
    return bpm >= 60 && bpm <= 200 ? bpm : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

/**
 * Analyse a song. The browser analysis always runs; a backend tempo (when available
 * and at least as well supported by the onsets) seeds the beat grid.
 */
export async function analyzeSong(file, { hash = null, decode = decodeSong, analyze = analyzeInWorker, backend = backendBpm } = {}) {
  const { samples, rate } = await decode(file);
  const [local, remote] = await Promise.all([analyze(samples, rate), Promise.resolve().then(() => backend(samples, rate)).catch(() => null)]);
  let analysis = local.analysis;
  if (remote && local.features) {
    const seeded = buildAnalysis(local.features, { bpm: remote, source: 'backend' });
    if (seeded.gridScore >= 0.9 * analysis.gridScore) analysis = seeded;
  }
  return { ...analysis, hash: hash || await hashFile(file), name: file?.name || '', analyzedAt: Date.now() };
}

/** Load a song into the show (same slot as Show Programming → Music). */
export function attachSong(file) {
  const project = useProjectStore.getState();
  project.rememberProgrammer({ ...(project.programmer || {}), audioFile: file });
  window.dispatchEvent(new CustomEvent('aquaflow:asset-attached', { detail: { id: SONG_ASSET, file } }));
}

/** The show's song as a File (or null), following loads, relinks and project changes. */
export function useProgrammerSong() {
  const ref = useProjectStore(s => s.programmer?.audioFileReference);
  const key = ref ? `${ref.name}|${ref.size}|${ref.lastModified}` : '';
  const [file, setFile] = useState(() => liveAssetFiles.get(SONG_ASSET) || null);
  useEffect(() => { setFile(liveAssetFiles.get(SONG_ASSET) || null); }, [key]);
  useEffect(() => {
    const onAttached = e => { if (e.detail?.id === SONG_ASSET) setFile(e.detail.file || null); };
    window.addEventListener('aquaflow:asset-attached', onAttached);
    return () => window.removeEventListener('aquaflow:asset-attached', onAttached);
  }, []);
  return file;
}

/** Song + cached analysis + an `analyze()` action for the builder. */
export function useSongBeats() {
  const file = useProgrammerSong();
  const cache = useProjectStore(s => s.programmer?.musicCache);
  const [hash, setHash] = useState(null);
  const [state, setState] = useState({ status: 'idle', error: '' });
  useEffect(() => {
    let alive = true;
    setHash(null);
    if (file) hashFile(file).then(h => { if (alive) setHash(h); });
    return () => { alive = false; };
  }, [file]);
  const analysis = readCache({ musicCache: cache }, hash);
  const analyze = useCallback(async () => {
    if (!file) return null;
    setState({ status: 'working', error: '' });
    try {
      const h = hash || await hashFile(file);
      const result = readCache(useProjectStore.getState().programmer, h) || await analyzeSong(file, { hash: h });
      writeCache(h, result);
      setHash(h);
      setState({ status: 'idle', error: '' });
      return result;
    } catch (error) {
      setState({ status: 'error', error: error.message || 'Could not read the song' });
      return null;
    }
  }, [file, hash]);
  return { file, hash, analysis, ...state, analyze };
}
