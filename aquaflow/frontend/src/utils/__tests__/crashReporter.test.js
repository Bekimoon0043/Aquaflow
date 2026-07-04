// Unit tests for the client crash reporter (AQ-S4-002).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildCrashPayload, reportCrash, installGlobalCrashHandler, _resetCrashReporter,
} from '../crashReporter'

describe('buildCrashPayload', () => {
  it('maps an Error to the backend crash schema', () => {
    const err = new TypeError('cannot read x')
    const p = buildCrashPayload(err, { screen: 'timeline' })
    expect(p.exc_type).toBe('TypeError')
    expect(p.message).toBe('cannot read x')
    expect(typeof p.traceback).toBe('string')
    expect(p.context.source).toBe('frontend')
    expect(p.context.screen).toBe('timeline')
  })
})

describe('reportCrash', () => {
  beforeEach(() => { _resetCrashReporter(); global.fetch = vi.fn() })
  afterEach(() => vi.restoreAllMocks())

  it('uploads a crash to /api/crash/report', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'x', fingerprint: 'abc', uploaded: true }) })
    const out = await reportCrash(new Error('boom'))
    expect(out.uploaded).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/crash\/report$/), expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.exc_type).toBe('Error')
    expect(body.message).toBe('boom')
  })

  it('dedupes a burst of the identical error', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ uploaded: true }) })
    const e = new Error('same')
    await reportCrash(e)
    const second = await reportCrash(e)
    expect(second.deduped).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('swallows a backend-unreachable error (offline)', async () => {
    global.fetch.mockRejectedValue(new Error('network'))
    const out = await reportCrash(new Error('unique-offline'))
    expect(out.offline).toBe(true)
  })
})

describe('installGlobalCrashHandler', () => {
  beforeEach(() => { _resetCrashReporter(); global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ uploaded: true }) }) })
  afterEach(() => vi.restoreAllMocks())

  it('captures window error events automatically', async () => {
    const listeners = {}
    const target = {
      addEventListener: (t, fn) => { listeners[t] = fn },
      removeEventListener: () => {},
    }
    const uninstall = installGlobalCrashHandler(target)
    expect(typeof listeners.error).toBe('function')
    expect(typeof listeners.unhandledrejection).toBe('function')
    listeners.error({ error: new Error('uncaught-ui') })
    await Promise.resolve(); await Promise.resolve()
    expect(global.fetch).toHaveBeenCalled()
    uninstall()
  })
})
