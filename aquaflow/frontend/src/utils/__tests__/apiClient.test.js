// Unit tests for the backend API client (AQ-X-014).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiGet, apiPost, apiUrl } from '../apiClient'

describe('apiUrl', () => {
  it('joins the base URL with a path (with or without leading slash)', () => {
    expect(apiUrl('/hydraulics/solve')).toMatch(/\/api\/hydraulics\/solve$/)
    expect(apiUrl('nozzles/models')).toMatch(/\/api\/nozzles\/models$/)
  })
})

describe('apiGet / apiPost', () => {
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { vi.restoreAllMocks() })

  it('apiGet returns parsed JSON', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: 1 }) })
    await expect(apiGet('/mobile/status')).resolves.toEqual({ ok: 1 })
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/mobile\/status$/), expect.any(Object))
  })

  it('apiPost sends a JSON body and returns parsed JSON', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ bpm: 120 }) })
    const out = await apiPost('/beat/detect', { samples: [1, 2], sample_rate: 44100 })
    expect(out).toEqual({ bpm: 120 })
    const [, opts] = global.fetch.mock.calls[0]
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ samples: [1, 2], sample_rate: 44100 })
  })

  it('throws with the backend detail on an error status', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ detail: 'bad network' }) })
    await expect(apiPost('/hydraulics/solve', {})).rejects.toThrow(/400.*bad network/)
  })
})
