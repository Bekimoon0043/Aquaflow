// Plays the show's song in step with the 3D preview clock (useICANPreviewStore).
import { useEffect } from 'react';
import { useICANPreviewStore } from '../../../store/icanPreviewStore';
import useProjectStore from '../../../store/projectStore';

/**
 * Seconds the song lags the picture when "Preview as heard at the audience" is on (Site sync):
 * the audio chain to the listener, stored by the Site sync panel. 0 when off.
 */
export function heardDelayS(programmer = useProjectStore.getState().programmer) {
  const sync = programmer?.studio?.site?.sync;
  return sync?.previewAsHeard && Number(sync.previewDelayMs) > 0 ? Number(sync.previewDelayMs) / 1000 : 0;
}

/**
 * Bring an <audio> element in line with the preview: play/pause, seek on jumps, and
 * nudge the playback rate for small drift so playback stays smooth.
 * @returns {'none'|'playing'|'paused'|'ended'}
 */
export function syncAudioElement(audio, { position = 0, playback = 'stopped' } = {}, { tolerance = .25 } = {}) {
  if (!audio) return 'none';
  const length = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity;
  const target = Math.max(0, Number(position) || 0);
  // "As heard at the audience": the song runs behind the picture; before it starts, wait at 0.
  if (playback === 'playing' && Number(position) < 0) {
    if (!audio.paused) audio.pause();
    if (audio.currentTime !== 0) audio.currentTime = 0;
    return 'waiting';
  }
  if (playback === 'playing') {
    if (target >= length) { if (!audio.paused) audio.pause(); return 'ended'; }
    const drift = audio.currentTime - target;
    if (audio.paused || Math.abs(drift) > tolerance) { audio.currentTime = target; audio.playbackRate = 1; }
    else audio.playbackRate = Math.abs(drift) > .04 ? (drift > 0 ? .97 : 1.03) : 1;
    if (audio.paused) audio.play?.()?.catch?.(() => {});
    return 'playing';
  }
  if (!audio.paused) audio.pause();
  const rest = Math.min(target, length);
  if (Math.abs(audio.currentTime - rest) > .02) audio.currentTime = rest;
  return 'paused';
}

/**
 * Keep `file` playing with the 3D preview. `yieldTo(state)` returns true while another
 * player (the preview sidebar's controls) is already playing the same song.
 */
export function usePreviewSongPlayback(file, { yieldTo = () => false } = {}) {
  useEffect(() => {
    if (!file || typeof Audio === 'undefined') return undefined;
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.preload = 'auto';
    const sync = state => {
      if (yieldTo(state)) { if (!audio.paused) audio.pause(); return; }
      const delay = heardDelayS();
      syncAudioElement(audio, delay ? { ...state, position: (Number(state.position) || 0) - delay } : state, delay ? { tolerance: .04 } : undefined);
    };
    sync(useICANPreviewStore.getState());
    const unsubscribe = useICANPreviewStore.subscribe(sync);
    return () => { unsubscribe(); audio.pause(); URL.revokeObjectURL(url); };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps
}
