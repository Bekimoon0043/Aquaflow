// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import StudioTimeline from './StudioTimeline';
import PreviewShowTimeline from './PreviewShowTimeline';
import { readStudio } from './showModel';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { useICANPreviewStore } from '../../../store/icanPreviewStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

const items = [
  ...Array.from({ length: 6 }, (_, i) => ({ id: `jet-${i}`, label: `Jet ${i}`, type: 'nozzle_straight_dn25', tracks: [] })),
  { id: 'pump-1', label: 'Main pump', type: 'pump_vfd_15kw', tracks: [] },
];
const studio = readStudio({ studio: {
  groups: [{ id: 'g-arc', name: 'Blue arc inner', memberFixtureIds: items.slice(0, 6).map(i => i.id), color: '#65d9d0' }],
  recipes: [{ id: 'r1', groupId: 'g-arc', start: 2, duration: 8, effect: 'wave', name: 'Blue inner rises', intensity: 80, envelope: [{ time: 0, value: 1 }, { time: 1, value: 1 }] }],
  legacyClips: [{ id: 'l1', fixtureId: 'pump-1', type: 'pump_speed', startTime: 0, duration: 5, name: 'Pump ramp' }],
} });
const noop = () => {};
const props = { studio, items, time: 0, audioBuffer: null, selectedIds: [], onSelect: noop, onSelectMany: noop, onMoveSelection: noop, onCopy: noop, onPaste: noop,
  onDuplicate: noop, onDelete: noop, onChangeRecipe: noop, onChangeLegacy: noop, onSeek: noop, onDropGroup: noop, onGroupPatch: noop, onMarker: noop };

beforeEach(() => { globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; });
afterEach(() => cleanup());

describe('timeline clips show their owner', () => {
  it('Studio arrangement: group and device clips name their owner, rows show type badges', () => {
    const { container } = render(<StudioTimeline {...props} />);
    const clip = screen.getByRole('button', { name: 'Blue inner rises' }); // accessible name unchanged
    expect(clip.querySelector('.sp-clip-owner').textContent).toBe('Blue arc inner');
    expect(clip.getAttribute('title')).toMatch(/^Blue arc inner — Group · 6 jets\nPattern: Blue inner rises \(wave\)/);
    expect(clip.style.getPropertyValue('--owner-color')).toMatch(/^hsl/); // default colour → derived owner colour
    const pump = screen.getByRole('button', { name: 'Pump ramp' });
    expect(pump.querySelector('.sp-clip-owner').textContent).toBe('Main pump · Speed');
    const badges = [...container.querySelectorAll('.sp-owner-badge')].map(b => b.textContent);
    expect(badges).toEqual(['▣ 6', '◉']);
  });

  it("combined device row still names each clip's fixture", () => {
    render(<StudioTimeline {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'One row per device' }));
    expect(screen.getByRole('button', { name: 'Pump ramp' }).querySelector('.sp-clip-owner').textContent).toBe('Main pump · Speed');
  });

  it('3D preview sequence blocks name their group', () => {
    useEngineeringStore.setState({ fixtures: items.map(({ tracks, ...f }) => ({ ...f, x: 0, y: 0, engineering: {} })), siteModels: [] });
    useProjectStore.setState({ programmer: { studio } });
    useICANPreviewStore.setState({ replace: vi.fn(), playback: 'stopped', position: 0 });
    render(<PreviewShowTimeline height={320} />);
    const block = screen.getByRole('button', { name: 'Blue inner rises' });
    // Fitted into a 0-px jsdom viewport the block is narrow: swatch only, name in the tooltip.
    expect(block.querySelector('.seq-owner .seq-owner-swatch')).toBeTruthy();
    expect(block.querySelector('.seq-owner').textContent).toBe('');
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByTitle('Zoom in'));
    expect(block.querySelector('.seq-owner').textContent).toBe('Blue arc inner');
    expect(block.getAttribute('aria-description')).toBe('Blue arc inner — Group · 6 jets');
    expect(block.getAttribute('title')).toMatch(/^Blue arc inner — Group · 6 jets/);
  });
});
