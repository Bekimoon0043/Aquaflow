// Deep analysis client — sends the song to the engine's licence-clean deep analysis
// (POST /api/music/deep: K-weighted loudness, novelty structure with repeat groups, build-ups,
// drops, mood, vocal phrases) and merges the result into the song analysis. The browser's
// beat grid is sent along so both analyses share one grid. Fast mode (browser only) stays the
// default; deep results are cached per song by the engine and stored on the song analysis.

import { apiGet, apiPost } from '../../../utils/apiClient';
import { decodeSong } from './musicSync';

export const DEEP_RATE = 11025;

/** Mono float samples → base64 little-endian int16. */
export function toPcm16Base64(samples) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
  const bytes = new Uint8Array(pcm.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Run the deep analysis for a song file.
 * @returns {Promise<object>} the engine's result
 */
export async function requestDeepAnalysis(file, analysis, { decode = decodeSong, post = apiPost, get = apiGet, onProgress = null, pollMs = 500, timeoutMs = 600000 } = {}) {
  const { samples, rate } = await decode(file, DEEP_RATE);
  const body = { pcm16: toPcm16Base64(samples), rate: Math.round(rate), bpm: analysis?.bpm || null,
    beats: analysis?.beats?.length ? analysis.beats : null, beatsPerBar: analysis?.beatsPerBar || 4 };
  let job = await post('/music/deep', body);
  const t0 = Date.now();
  while (job.status !== 'done') {
    if (job.status === 'error') throw new Error(job.error || 'Deep analysis failed');
    if (Date.now() - t0 > timeoutMs) throw new Error('Deep analysis timed out');
    onProgress?.(job.progress || 0);
    await new Promise((r) => setTimeout(r, pollMs));
    job = await get(`/music/deep/${job.job_id}`);
  }
  onProgress?.(1);
  return job.result;
}

export { mergeDeep, songAnalysis } from './deepMerge';
