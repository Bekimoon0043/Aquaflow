import { describe, expect, it } from 'vitest';
import { checkPlcLimits, clipsForPlc, deviceRows, issuesByBlock, nozzleLinks, worstLevel } from './plcLimits';

// The PLCSIM Training Fountain: one pump (40 % ceiling), two jets (500 ms on/off), one RGB light.
const site = { channels: [
  { id: 'pump', kind: 'pump', name: 'Main Pump', max_percent: 40, min_on_ms: 500, min_off_ms: 500 },
  { id: 'va', kind: 'valve', name: 'Center Jet A', pump_id: 'pump', min_on_ms: 500, min_off_ms: 500 },
  { id: 'vb', kind: 'valve', name: 'Center Jet B', pump_id: 'pump', min_on_ms: 500, min_off_ms: 500 },
  { id: 'light', kind: 'light', name: 'Basin RGB Light', max_percent: 40, min_on_ms: 500, min_off_ms: 500 },
] };
const c = (id, fixtureId, type, startTime, duration, value, extra = {}) => ({ id, fixtureId, type, startTime, duration, value, ...extra });

describe('live PLC limits in the timeline', () => {
  it('passes a show that respects every limit', () => {
    const result = checkPlcLimits([c('a', 'va', 'solenoid_open', 0, 2, 100), c('b', 'vb', 'solenoid_open', 2, 2, 100),
      c('p', 'pump', 'pump_speed', 0, 4, 30), c('l', 'light', 'lighting_blue', 0, 4, 100)], site);
    expect(result.counts).toEqual({ error: 0, warn: 0, info: 0 });
  });

  it('explains what the PLC does with short pulses, short gaps, too much speed and a dry pump', () => {
    const result = checkPlcLimits([
      c('short', 'va', 'solenoid_open', 0, .2, 100),
      c('gap', 'va', 'solenoid_open', .8, 1, 100),
      c('fast', 'pump', 'pump_speed', 0, 3, 55),
    ], site);
    expect(result.byClip.get('short')[0].text).toMatch(/minimum on-time \(0.5 s\): the PLC keeps it open 0.5 s/);
    expect(result.byClip.get('gap')[0].text).toMatch(/Only 0.3 s after the previous opening/);
    const fast = result.byClip.get('fast').map(i => i.text).join(' ');
    expect(fast).toMatch(/caps this pump at 40%/);
    expect(fast).toMatch(/run for 1.2 s while all its jets are closed/);
    expect(result.counts.warn).toBe(4);
  });

  it('marks overlapping light clips as errors the compile would refuse', () => {
    const result = checkPlcLimits([c('r1', 'light', 'lighting_red', 0, 3, 100), c('r2', 'light', 'lighting_red', 2, 2, 100)], site);
    expect(worstLevel(result.byClip.get('r2'))).toBe('error');
    expect(result.list[0].level).toBe('error');
  });

  it('maps nozzle clips onto their linked valve, like the Training Fountain layout', () => {
    const items = [{ id: 'noz-a', linkedValveId: 'va' }, { id: 'pump' }];
    const links = nozzleLinks(items);
    const clips = [c('n', 'noz-a', 'device_intensity', 0, .2, 60), c('p', 'pump', 'pump_speed', 0, .5, 30)];
    const result = checkPlcLimits(clips, site, links);
    expect(result.byClip.get('n')[0].text).toMatch(/Center Jet A's minimum on-time/);
    expect(result.byClip.has('p')).toBe(false); // the stretched jet covers the pump
    expect(clipsForPlc(clips, site, links)[0]).toMatchObject({ fixtureId: 'va', sourceFixtureId: 'noz-a' });
    expect(checkPlcLimits([c('x', 'fog', 'fog_density', 0, 2, 50)], site).byClip.get('x')[0].level).toBe('info');
  });

  it('reports pattern clips on their pattern block, once per message', () => {
    const result = checkPlcLimits([c('rec1:noz-a:0', 'va', 'solenoid_open', 0, .2, 100), c('rec1:noz-a:1', 'va', 'solenoid_open', 3, .2, 100)], site);
    const blocks = issuesByBlock(result);
    expect([...blocks.keys()]).toEqual(['rec1']);
    expect(blocks.get('rec1')).toHaveLength(1);
  });

  it('builds one row per device channel in Engineering order', () => {
    const items = [{ id: 'pump', label: 'Main Pump' }, { id: 'light', label: 'Basin RGB Light' }];
    const rows = deviceRows([c('1', 'light', 'lighting_red', 0, 1, 1, { trackId: 'light-red' }), c('2', 'light', 'lighting_master', 0, 1, 1, { trackId: 'light-master' }),
      c('3', 'pump', 'pump_speed', 0, 1, 1, { trackId: 'pump-speed' }), c('4', 'pump', 'pump_speed', 2, 1, 1, { trackId: 'pump-speed' })], items);
    expect(rows.map(r => r.name)).toEqual(['Main Pump · Speed', 'Basin RGB Light · Intensity', 'Basin RGB Light · Red']);
    expect(rows[0].clips).toHaveLength(2);
  });
});
