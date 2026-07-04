// Unit tests for the client usage analytics (AQ-S4-003).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { trackEvent, trackFeature, getSessionId, hasConsent, setConsent } from '../analytics'

// The vitest env is 'node' (no DOM), so provide a minimal localStorage shim.
function makeLocalStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  }
}

beforeEach(() => { global.localStorage = makeLocalStorage(); global.fetch = vi.fn() })
afterEach(() => { vi.restoreAllMocks(); delete global.localStorage })

describe('session id', () => {
  it('generates a stable anonymous session id (not a user identity)', () => {
    const a = getSessionId()
    const b = getSessionId()
    expect(a).toBe(b)
    expect(a).toMatch(/^s-/)
    expect(a).not.toMatch(/@/)
  })
})

describe('trackEvent', () => {
  it('posts an anonymous event to /api/analytics/track', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ tracked: true }) })
    const out = await trackEvent('panel_open', { panel: 'hydraulics' })
    expect(out.tracked).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/analytics\/track$/), expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.name).toBe('panel_open')
    expect(body.properties.panel).toBe('hydraulics')
    expect(body.session_id).toMatch(/^s-/)
  })

  it('trackFeature wraps feature usage', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ tracked: true }) })
    await trackFeature('wind', { source: 'menu' })
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.name).toBe('feature_use')
    expect(body.properties.feature).toBe('wind')
  })

  it('does not collect when consent is off', async () => {
    setConsent(false)
    global.fetch.mockClear()
    const out = await trackEvent('panel_open')
    expect(out.tracked).toBe(false)
    // only the consent POST (from setConsent) may have fired, never a track call
    const trackCalls = global.fetch.mock.calls.filter((c) => /analytics\/track/.test(c[0]))
    expect(trackCalls).toHaveLength(0)
  })

  it('swallows a backend-unreachable error (never blocks the UI)', async () => {
    setConsent(true)
    global.fetch.mockRejectedValue(new Error('network'))
    const out = await trackEvent('panel_open')
    expect(out.offline).toBe(true)
  })
})

describe('consent', () => {
  it('defaults to opt-in and can be toggled', () => {
    expect(hasConsent()).toBe(true)
    setConsent(false)
    expect(hasConsent()).toBe(false)
    setConsent(true)
    expect(hasConsent()).toBe(true)
  })
})
