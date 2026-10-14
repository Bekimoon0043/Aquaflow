// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { useICANPreviewStore } from '../../../store/icanPreviewStore';
import PreviewShowTimeline from './PreviewShowTimeline';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Vitest uses the classic JSX transform here; the app components rely on Vite's automatic runtime.
globalThis.React = React;

const ring = (n, height) => Array.from({ length: n }, (_, i) => ({
  id: `jet-${i + 1}`, label: `Jet ${i + 1}`, type: 'nozzle_foam_dn40',
  x: 10 + 4 * Math.cos((2 * Math.PI * i) / n), y: 10 + 4 * Math.sin((2 * Math.PI * i) / n), z: 0,
  engineering: { siteFunction: 'foam', jetHeightM: height },
}));

let replace;
function setup({ height = 2.5, head = 4 } = {}) {
  useEngineeringStore.setState({ fixtures: ring(8, height), siteModels: [], params: { ...useEngineeringStore.getState().params, design_head_m: head } });
  useProjectStore.setState({ programmer: null });
  replace = vi.fn();
  useICANPreviewStore.setState({ replace, playback: 'stopped', position: 0 });
  return render(<PreviewShowTimeline height={320} />);
}
const recipes = () => useProjectStore.getState().programmer?.studio?.recipes || [];

beforeEach(() => {
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
});
afterEach(() => cleanup());

describe('Pattern builder in the 3D show timeline', () => {
  it('Smooth wave → Apply adds one recipe and updates the 3D preview; Undo removes it', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Pattern builder/ }));
    const dialog = screen.getByRole('dialog', { name: 'Pattern builder' });
    expect(within(dialog).getByLabelText('Pattern group').value).toBe('quick:water');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Smooth wave/ }));
    expect(within(dialog).getByText(/3 laps · seamless loop/)).toBeTruthy();
    expect(within(dialog).queryByRole('alert')).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(recipes()).toHaveLength(1);
    expect(recipes()[0]).toMatchObject({ effect: 'curve', cycles: 3, spread: 1, intensity: 100, order: 'clockwise' });
    expect(useProjectStore.getState().programmer.studio.groups.map(g => g.name)).toEqual(['All water jets']);
    expect(useProjectStore.getState().programmer.timelineClips.length).toBeGreaterThan(0);
    expect(replace).toHaveBeenCalled();
    const [plan, , , panel] = replace.mock.calls.at(-1);
    expect(panel).toBe('show_programmer');
    expect(plan).toBeTruthy();

    // A second Apply updates the same pattern instead of stacking a copy.
    fireEvent.change(within(dialog).getByLabelText('Speed'), { target: { value: '15' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
    expect(recipes()).toHaveLength(1);
    expect(recipes()[0].cycles).toBe(2);

    fireEvent.click(within(dialog).getByRole('button', { name: /Undo/ }));
    expect(recipes()).toHaveLength(1);
    expect(recipes()[0].cycles).toBe(3);
    fireEvent.click(within(dialog).getByRole('button', { name: /Undo/ }));
    expect(recipes()).toHaveLength(0);
  });

  it('warns about low jets and offers one-click fixes; engineering changes need a confirm', () => {
    setup({ height: .58, head: 1.2 });
    fireEvent.click(screen.getByRole('button', { name: /Pattern builder/ }));
    const dialog = screen.getByRole('dialog', { name: 'Pattern builder' });
    fireEvent.change(within(dialog).getByLabelText('High'), { target: { value: '52' } });
    fireEvent.change(within(dialog).getByLabelText('Low'), { target: { value: '23' } });
    const alert = within(dialog).getByRole('alert');
    expect(alert.textContent).toMatch(/Jets will be about 0\.3 m tall — hard to see/);
    expect(alert.textContent).toMatch(/Movement will be subtle/);

    fireEvent.click(within(alert).getByRole('button', { name: 'Use 100% level' }));
    expect(within(dialog).getByLabelText('High').value).toBe('100');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Raise jet design height' }));
    expect(useEngineeringStore.getState().fixtures[0].engineering.jetHeightM).toBe(.58); // nothing yet
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    const state = useEngineeringStore.getState();
    expect(state.fixtures.every(f => f.engineering.jetHeightM === 2)).toBe(true);
    expect(state.params.design_head_m).toBe(3);
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('shows a timeline badge when an applied pattern will be hard to see', () => {
    setup({ height: .58, head: 1.2 });
    fireEvent.click(screen.getByRole('button', { name: /Pattern builder/ }));
    const dialog = screen.getByRole('dialog', { name: 'Pattern builder' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Pattern builder' })).toBeNull();
    expect(screen.getByText(/Low jets/)).toBeTruthy();
  });
});
