import { describe, expect, it } from 'vitest';
import { resizePanel, shownSize, togglePanel, validatePanelLayout } from './panelLayout';

const defaults = { panels: { sidebar: { size: 220, min: 180, max: 480 }, tray: { size: 172, min: 100, max: 400 } } };

describe('full-workspace panel layout', () => {
  it('falls back to defaults and clamps stored sizes', () => {
    expect(validatePanelLayout(null, defaults)).toEqual({ swapped: false, panels: { sidebar: { size: 220, collapsed: false }, tray: { size: 172, collapsed: false } } });
    const v = validatePanelLayout({ swapped: true, panels: { sidebar: { size: 9999, collapsed: true }, tray: { size: 'x' } } }, defaults);
    expect(v.swapped).toBe(true);
    expect(v.panels.sidebar).toEqual({ size: 480, collapsed: true });
    expect(v.panels.tray.size).toBe(172);
  });

  it('resizes within limits and re-opens a collapsed panel when dragged', () => {
    let l = validatePanelLayout(null, defaults);
    l = togglePanel(l, 'sidebar');
    expect(shownSize(l.panels.sidebar)).toBe(28);
    l = resizePanel(l, 'sidebar', -500, defaults);
    expect(l.panels.sidebar).toEqual({ size: 180, collapsed: false });
    expect(resizePanel(l, 'tray', 40, defaults).panels.tray.size).toBe(212);
  });
});
