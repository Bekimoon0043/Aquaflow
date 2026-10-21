// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { SITES } from './evalCorpus';

vi.mock('../../../utils/apiClient', () => ({ apiPost: vi.fn(), apiGet: vi.fn(async () => ({})), apiUrl: (p) => `/api${p}` }));
vi.mock('./StudioPreview', () => ({ default: () => null }));
import { apiPost } from '../../../utils/apiClient';
import ShowStudio from './ShowStudio';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

const recipes = () => useProjectStore.getState().programmer?.studio?.recipes || [];

beforeEach(() => {
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  // jsdom has no canvas: a context whose every call is a no-op.
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ width: 0 })), set: (t, k, v) => { t[k] = v; return true; } });
  HTMLCanvasElement.prototype.getContext = () => ctx;
  try { localStorage.clear(); } catch { /* no storage */ }
  useEngineeringStore.setState({ fixtures: SITES.ring().fixtures, siteModels: [] });
  useProjectStore.setState({ programmer: null });
  useProjectStore.setState((s) => ({ workspace: { ...s.workspace, activePanel: 'show_programmer' } }));
});
afterEach(() => { cleanup(); vi.mocked(apiPost).mockReset(); });

function openAi() {
  render(<ShowStudio />);
  fireEvent.click(screen.getAllByRole('button', { name: 'AI' })[0]);
  fireEvent.change(screen.getByLabelText('What should the water do?'), { target: { value: 'front ring blue wave from 4 to 20 seconds' } });
}

describe('AI compose in Show Studio', () => {
  it('proposes patterns from words, previews and applies them in one change', async () => {
    vi.mocked(apiPost).mockImplementation(async (path, body) => ({
      summary: 'A blue wave on the front ring', model: 'claude-opus-5-5',
      placements: [{ groupId: body.groups.find((g) => /front/.test(g)), look: 'wave', start: 4, end: 20, color: '#1e4fd8', low: 20, high: 70, why: 'as asked' },
        { groupId: 'ghost', look: 'wave', start: 0, end: 10, color: '#ffffff', low: 0, high: 50, why: 'bad id' }],
    }));
    openAi();
    fireEvent.click(screen.getByRole('button', { name: '✦ Compose with AI' }));
    await screen.findByText('1 proposed patterns');
    const [path, body] = vi.mocked(apiPost).mock.calls[0];
    expect(path).toBe('/ai/compose');
    expect(body.description).toContain("USER'S WORDS: front ring blue wave from 4 to 20 seconds");
    expect(screen.getByText(/^✦ Claude: /).textContent).toMatch(/A blue wave on the front ring · 1 unusable placement dropped/);
    expect(localStorage.getItem('aquaflow.aiCompose.prompt')).toBe('front ring blue wave from 4 to 20 seconds');
    expect(screen.getByRole('checkbox', { name: /Smooth wave · .*as asked/ }).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Preview proposed patterns' }));
    expect(screen.getByRole('button', { name: 'Return to saved show' })).toBeTruthy();
    const before = recipes().length;
    fireEvent.click(screen.getByRole('button', { name: 'Apply selected patterns' }));
    const added = recipes().slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((r) => r.pattern?.ai === 'compose')).toBe(true);
    fireEvent.click(screen.getByTitle('Undo · Ctrl+Z'));                // one Undo removes them all
    expect(recipes()).toHaveLength(before);
  });

  it('falls back to the rule-based composer message when the AI fails', async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error('HTTP 502 — AI compose needs an Anthropic API key (Your fountain → AI director)'));
    openAi();
    fireEvent.click(screen.getByRole('button', { name: '✦ Compose with AI' }));
    await screen.findByText(/AI compose needs an Anthropic API key \(Your fountain → AI director\)\. Select a group to use the rule-based composer instead\./);
  });
});
