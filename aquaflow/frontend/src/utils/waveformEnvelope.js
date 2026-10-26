/**
 * waveformEnvelope.js — a light stand-in for a decoded AudioBuffer when only a waveform is drawn.
 *
 * A 5½-minute song decoded at 48 kHz stereo is ~126 MB of Float32 samples, and Show Studio
 * kept that AudioBuffer alive for as long as the workspace was mounted just to paint the
 * timeline waveform. The envelope keeps the peak (max |sample| over all channels) per bin at
 * ~1 kHz (~1.3 MB for the same song) and exposes the AudioBuffer members the waveform
 * reads (duration, sampleRate, length, numberOfChannels, getChannelData), so the decoded
 * buffer can be released straight after decoding.
 */
export const ENVELOPE_RATE = 1000;

export function waveformEnvelope(buffer, rate = ENVELOPE_RATE) {
  if (!buffer || typeof buffer.getChannelData !== "function") return null;
  const channels = Array.from({ length: Math.max(1, buffer.numberOfChannels || 1) }, (_, i) => buffer.getChannelData(i));
  const sourceRate = Number(buffer.sampleRate) || 48000;
  const length = Number(buffer.length) || channels[0].length;
  const step = Math.max(1, Math.round(sourceRate / Math.max(1, rate)));
  const bins = Math.max(1, Math.ceil(length / step));
  const peaks = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    const from = b * step, to = Math.min(length, from + step);
    let peak = 0;
    for (const data of channels) {
      for (let i = from; i < to; i++) {
        const v = data[i] < 0 ? -data[i] : data[i];
        if (v > peak) peak = v;
      }
    }
    peaks[b] = peak;
  }
  return {
    envelope: true,
    duration: Number.isFinite(buffer.duration) ? buffer.duration : length / sourceRate,
    sampleRate: sourceRate / step,
    length: bins,
    numberOfChannels: 1,
    getChannelData: () => peaks,
  };
}
