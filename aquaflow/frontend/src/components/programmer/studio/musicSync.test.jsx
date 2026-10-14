// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import useProjectStore from '../../../store/projectStore';
import { useICANPreviewStore } from '../../../store/icanPreviewStore';
import { CACHE_LIMIT, analyzeSong, backendBpm, hashFile, readCache, withCache, writeCache } from './musicSync';
import { analyzeSamples, clickTrack, ANALYSIS_VERSION } from './musicAnalysis';
import { syncAudioElement, usePreviewSongPlayback } from './previewAudio';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const RATE = 11025;
const track = clickTrack({ bpm: 120, bars: 16, rate: RATE });

describe('song analysis service', () => {
  it('caches each analysis under the file hash in the project (newest few kept)', () => {
    let programmer = { studio: { recipes: [] } };
    for (let i = 0; i < CACHE_LIMIT + 2; i++) programmer = withCache(programmer, `h${i}`, { version: ANALYSIS_VERSION, bpm: 100 + i });
    expect(Object.keys(programmer.musicCache)).toHaveLength(CACHE_LIMIT);
    expect(readCache(programmer, `h${CACHE_LIMIT + 1}`).bpm).toBe(100 + CACHE_LIMIT + 1);
    expect(readCache(programmer, 'missing')).toBeNull();
    expect(readCache({ musicCache: { old: { version: 0 } } }, 'old')).toBeNull();
    expect(programmer.studio).toEqual({ recipes: [] });

    useProjectStore.setState({ programmer: { studio: { recipes: [] } } });
    writeCache('sha256:abc', { version: ANALYSIS_VERSION, bpm: 128 });
    expect(readCache(useProjectStore.getState().programmer, 'sha256:abc').bpm).toBe(128);
  });

  it('hashes file contents (two files with the same bytes share a cache entry)', async () => {
    const a = await hashFile(new File([new Uint8Array([1, 2, 3])], 'a.mp3'));
    const b = await hashFile(new File([new Uint8Array([1, 2, 3])], 'b.mp3'));
    const c = await hashFile(new File([new Uint8Array([1, 2, 4])], 'a.mp3'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(await hashFile({ name: 'x', size: 1, lastModified: 2, arrayBuffer: () => Promise.reject(new Error('no')) })).toBe('file:x:1:2');
  });

  it('uses the browser analysis; a backend tempo seeds the grid when it fits the onsets', async () => {
    const file = { name: 'song.wav' };
    const decode = async () => ({ samples: track, rate: RATE });
    const analyze = async (s, r) => analyzeSamples(s, r);
    const local = await analyzeSong(file, { hash: 'h', decode, analyze, backend: async () => null });
    expect(local).toMatchObject({ source: 'browser', hash: 'h', name: 'song.wav' });
    expect(local.bpm).toBeCloseTo(120, 0);

    const seeded = await analyzeSong(file, { hash: 'h', decode, analyze, backend: async () => 119.4 });
    expect(seeded.source).toBe('backend');
    expect(seeded.bpm).toBeCloseTo(120, 0);

    const offbeat = await analyzeSong(file, { hash: 'h', decode, analyze, backend: async () => 87 });
    expect(offbeat.source).toBe('browser');          // a tempo the onsets do not support is ignored
    const failing = await analyzeSong(file, { hash: 'h', decode, analyze, backend: async () => { throw new Error('offline'); } });
    expect(failing.source).toBe('browser');
  });

  it('asks the backend beat engine with a 45 s excerpt and tolerates errors', async () => {
    const post = vi.fn(async (path, body) => ({ bpm: 121.5, path, n: body.samples.length }));
    expect(await backendBpm(new Float32Array(RATE * 120), RATE, { post })).toBe(121.5);
    expect(post.mock.calls[0][0]).toBe('/beat/detect');
    expect(post.mock.calls[0][1]).toMatchObject({ sample_rate: RATE, hop: 128 });
    expect(post.mock.calls[0][1].samples).toHaveLength(RATE * 45);
    expect(await backendBpm(track, RATE, { post: async () => ({ bpm: 0 }) })).toBeNull();
    expect(await backendBpm(track, RATE, { post: async () => { throw new Error('HTTP 500'); } })).toBeNull();
    expect(await backendBpm(track, RATE, { post: () => new Promise(() => {}), timeoutMs: 10 })).toBeNull();
  });
});

class FakeAudio {
  constructor(src) { this.src = src; this.paused = true; this.currentTime = 0; this.duration = 60; this.playbackRate = 1; FakeAudio.last = this; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

describe('preview audio sync', () => {
  it('starts at the playhead, seeks on jumps, nudges small drift, pauses and stops at the end', () => {
    const audio = new FakeAudio();
    expect(syncAudioElement(audio, { position: 12.5, playback: 'paused' })).toBe('paused');
    expect(audio.currentTime).toBe(12.5);
    expect(audio.paused).toBe(true);
    expect(syncAudioElement(audio, { position: 12.5, playback: 'playing' })).toBe('playing');
    expect(audio.paused).toBe(false);
    audio.currentTime = 12.6;                                   // small drift → rate nudge, no jump
    syncAudioElement(audio, { position: 12.5, playback: 'playing' });
    expect(audio.currentTime).toBe(12.6);
    expect(audio.playbackRate).toBeLessThan(1);
    syncAudioElement(audio, { position: 30, playback: 'playing' }); // seek while playing
    expect(audio.currentTime).toBe(30);
    expect(audio.playbackRate).toBe(1);
    syncAudioElement(audio, { position: 0, playback: 'stopped' });
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(0);
    syncAudioElement(audio, { position: 0, playback: 'playing' });
    expect(syncAudioElement(audio, { position: 75, playback: 'playing' })).toBe('ended');
    expect(audio.paused).toBe(true);
    expect(syncAudioElement(null, {})).toBe('none');
  });

  it('follows the 3D preview clock: play, seek, pause', () => {
    vi.stubGlobal('Audio', FakeAudio);
    URL.createObjectURL = vi.fn(() => 'blob:song');
    URL.revokeObjectURL = vi.fn();
    useICANPreviewStore.setState({ playback: 'paused', position: 0 });
    const song = new File([new Uint8Array(4)], 'song.mp3');
    let owner = false;
    function Host() { usePreviewSongPlayback(song, { yieldTo: () => owner }); return null; }
    const view = render(<Host />);
    const audio = FakeAudio.last;
    expect(audio.src).toBe('blob:song');
    act(() => { useICANPreviewStore.setState({ playback: 'playing', position: 4 }); });
    expect(audio.paused).toBe(false);
    expect(audio.currentTime).toBe(4);
    act(() => { useICANPreviewStore.setState({ position: 20 }); });          // seek
    expect(audio.currentTime).toBe(20);
    act(() => { useICANPreviewStore.setState({ playback: 'paused', position: 21 }); });
    expect(audio.paused).toBe(true);
    owner = true;                                                          // sidebar player takes over
    act(() => { useICANPreviewStore.setState({ playback: 'playing', position: 22 }); });
    expect(audio.paused).toBe(true);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:song');
  });
});
