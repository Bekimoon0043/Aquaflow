// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { compileForSite, inventory } from './showModel';
import { currentPlcShow, plcShowFor, syncMessage, syncSummary } from './plcSync';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';

const request = vi.fn();
vi.mock('../../../utils/siemensSite', async (orig) => ({ ...(await orig()), siemensRequest: (...a) => request(...a) }));
const { default: SiemensShowControls } = await import('../SiemensShowControls');

// Four 4 m jets with their own solenoid and light on one pump.
const fixtures = [
  ...[0, 1, 2, 3].map(i => ({ id: `jet${i}`, type: 'nozzle_straight_dn25', label: `Jet ${i}`, x: i * 2, y: 0, zone: 'line',
    engineering: { jetHeightM: 4, solenoidValveId: `valve${i}`, pumpId: 'pumpA' } })),
  ...[0, 1, 2, 3].map(i => ({ id: `valve${i}`, type: 'valve_solenoid_dn25_24v', label: `Valve ${i}`, x: i * 2, y: 0,
    engineering: { controlledFixtureId: `jet${i}`, pumpId: 'pumpA' } })),
  ...[0, 1, 2, 3].map(i => ({ id: `light${i}`, type: 'light_uw_rgb_18w', label: `Light ${i}`, x: i * 2, y: 0, engineering: { pairedNozzleId: `jet${i}` } })),
  { id: 'pumpA', type: 'pump_inline_vfd_pump_18_5kw', label: 'Pump A', x: 0, y: -6, engineering: { powerKw: 18.5, servesValveIds: [0, 1, 2, 3].map(i => `valve${i}`) } },
];
const items = inventory(fixtures);
const clips = [
  { id: 'c1', fixtureId: 'valve0', type: 'solenoid_open', startTime: 10, duration: 2, value: 100 },
  { id: 'c2', fixtureId: 'light0', type: 'rgb_color', startTime: 10, duration: 2, value: 100, color: '#ff0000' },
];

afterEach(cleanup);

describe('PLC send with Site sync', () => {
  it('shifts each output like Play on PLC and summarises the music start', () => {
    const { clips: sent, sync } = plcShowFor(clips, { items, site: {} });
    const direct = compileForSite(null, items, clips, {});
    expect(sent.map(c => c.startTime)).toEqual(direct.clips.map(c => c.startTime));
    expect(sent[0].startTime).toBeLessThan(10);                    // the valve fires early
    expect(sync).toMatchObject({ enabled: true, audioStartMs: direct.audioStartMs, trimmed: 0 });
    expect(Object.keys(sync.byKind).length).toBeGreaterThan(0);
    expect(syncMessage(sync)).toMatch(/start the music \d+ ms after the PLC show starts/);
  });

  it('never shifts twice, and reports when Site sync is off', () => {
    const once = plcShowFor(clips, { items, site: {} }).clips;
    const again = plcShowFor(once, { items, site: {} });
    expect(again.clips).toBe(once);
    expect(again.sync).toBeNull();
    const off = plcShowFor(clips, { items, site: { sync: { enabled: false } } });
    expect(off.clips.map(c => c.startTime)).toEqual([10, 10]);
    expect(off.sync.enabled).toBe(false);
    expect(syncMessage(off.sync)).toMatch(/Site sync is off/);
    expect(syncSummary(null)).toMatchObject({ enabled: false, audioStartMs: 0 });
  });

  it('reads the open design and the project settings', () => {
    useEngineeringStore.setState({ fixtures });
    useProjectStore.setState(s => ({ programmer: { ...s.programmer, studio: { ...(s.programmer?.studio || {}), site: {} } } }));
    expect(currentPlcShow(clips).clips[0].startTime).toBeLessThan(10);
  });
});

describe('Advanced PLC controls → Compile current clips', () => {
  const site = { id: 's1', name: 'Bench', mode: 'simulated', revision: 3, channels: [], show: null, source: { kind: 'engineering' } };
  beforeEach(() => {
    request.mockReset();
    request.mockImplementation(async (path, method, body) => {
      if (path === '' || path === undefined) return { sites: [site] };
      if (/\/status$/.test(path)) return { running: false, armed: false, verified: false };
      if (/\/compile$/.test(path)) return { clips: body.clips, duration: 12, sync: body.sync };
      return {};
    });
    useEngineeringStore.setState({ fixtures });
    useProjectStore.setState(s => ({ programmer: { ...s.programmer, studio: { ...(s.programmer?.studio || {}), site: {} } } }));
  });

  it('sends the shifted clips with the Site sync summary', async () => {
    render(<SiemensShowControls clips={clips} selectedSite={site} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Compile current clips' })); });
    const call = request.mock.calls.find(([p]) => /\/compile$/.test(p));
    expect(call[2].clips[0].startTime).toBeLessThan(10);
    expect(call[2].sync.enabled).toBe(true);
    expect(await screen.findByText(/start the music \d+ ms after the PLC show starts/)).toBeTruthy();
  });
});
