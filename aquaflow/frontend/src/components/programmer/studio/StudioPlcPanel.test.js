import { describe, expect, it, vi } from 'vitest';
import { PLAY_STEPS, playOnPlc } from './StudioPlcPanel';

const site = { id: 's1', revision: 4, mode: 'plcsim', plc: { db: 100 } };
const clips = [{ fixtureId: 'noz-1', type: 'device_intensity', startTime: 0, duration: 4, value: 70 }];

function fakeApi({ failAt } = {}) {
  const calls = [];
  const request = vi.fn(async (path, method, body) => {
    calls.push([path, method, body]);
    if (failAt && path.endsWith(failAt)) throw new Error(`${failAt} refused`);
    if (path.endsWith('/compile')) return { clips: [1, 2], duration: 4, translation: { nozzle_clips: 1 } };
    if (path.endsWith('/start')) return { running: true };
    return {};
  });
  const safety = { get: vi.fn(async () => ({ state: 'SAFE_IDLE' })), post: vi.fn(async () => ({})) };
  return { calls, request, safety };
}

describe('Play on PLC from Show Programming', () => {
  it('compiles with translation, verifies, arms and starts in that order', async () => {
    const api = fakeApi(), steps = [];
    const compiled = await playOnPlc({ site, clips, confirmed: true, request: api.request, safety: api.safety, onStep: s => steps.push(s) });
    expect(api.calls.map(c => c[0])).toEqual(['/s1/compile', '/s1/verify', '/s1/arm', '/s1/start']);
    expect(api.calls[0][2]).toEqual({ revision: 4, clips, translate: true });
    expect(api.calls[2][2]).toEqual({ flow_path_confirmed: true });
    expect(api.safety.post).toHaveBeenCalledWith('/safety/arm', {});
    expect(steps).toEqual([0, 1, 2, 3, 4]);
    expect(PLAY_STEPS).toHaveLength(5);
    expect(compiled.clips).toHaveLength(2);
  });

  it('stops at the first failing step and never starts', async () => {
    const api = fakeApi({ failAt: '/verify' });
    await expect(playOnPlc({ site, clips, confirmed: true, request: api.request, safety: api.safety })).rejects.toThrow('/verify refused');
    expect(api.calls.map(c => c[0])).toEqual(['/s1/compile', '/s1/verify']);
  });

  it('refuses preview sites, missing confirmation and empty shows before touching the PLC', async () => {
    const api = fakeApi();
    await expect(playOnPlc({ site: { ...site, mode: 'simulated' }, clips, confirmed: true, request: api.request, safety: api.safety })).rejects.toThrow(/animation only/);
    await expect(playOnPlc({ site, clips, confirmed: false, request: api.request, safety: api.safety })).rejects.toThrow(/PLCSIM simulator/);
    await expect(playOnPlc({ site, clips: [], confirmed: true, request: api.request, safety: api.safety })).rejects.toThrow(/no clips/);
    expect(api.calls).toHaveLength(0);
  });
});
