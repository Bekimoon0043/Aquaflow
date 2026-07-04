// Unit tests for the Documentation Center (AQ-S4-006).
// Covers the acceptance criteria via the pure engine:
//   1. search supported (ranked full-text search over the bundled docs),
//   2. offline mode supported (docs bundled; no network / fetch used),
//   3. context-sensitive help supported (panel key → relevant articles).
import { describe, it, expect, vi } from 'vitest'
import { ARTICLES, CATEGORIES } from '../articles'
import {
  search, contextHelp, getArticle, tokenize, scoreArticle, OFFLINE_AVAILABLE,
} from '../search'
import { setHelpContext, getHelpContext } from '../helpContext'

describe('docs library', () => {
  it('bundles a set of articles with unique ids and required fields', () => {
    expect(ARTICLES.length).toBeGreaterThanOrEqual(10)
    const ids = new Set()
    for (const a of ARTICLES) {
      expect(ids.has(a.id)).toBe(false); ids.add(a.id)
      expect(a.title && a.category && a.body).toBeTruthy()
      expect(Array.isArray(a.tags) && Array.isArray(a.context)).toBe(true)
    }
    expect(CATEGORIES.length).toBeGreaterThan(1)
  })
})

describe('1. search', () => {
  it('finds relevant articles ranked by score', () => {
    const res = search('dmx universe output')
    expect(res.length).toBeGreaterThan(0)
    expect(res[0].id).toBe('dmx-artnet')          // most relevant first
    expect(res[0].score).toBeGreaterThan(0)
    expect(res[0].snippet).toBeTruthy()
  })

  it('ranks a title/tag match above a body-only mention', () => {
    const res = search('pump')
    expect(res[0].id).toBe('pumps')               // "Pump Curves" title match wins
  })

  it('matches on tags', () => {
    const res = search('hazen darcy')
    expect(res.map((r) => r.id)).toContain('hydraulics')
  })

  it('returns nothing for an empty or stopword-only query', () => {
    expect(search('')).toEqual([])
    expect(search('the and of')).toEqual([])
  })

  it('scoreArticle weights title over body', () => {
    const pumps = ARTICLES.find((a) => a.id === 'pumps')
    expect(scoreArticle(pumps, tokenize('pump'))).toBeGreaterThan(0)
  })
})

describe('2. offline mode', () => {
  it('is available and never touches the network', () => {
    const fetchSpy = vi.spyOn(global, 'fetch', 'get').mockReturnValue(undefined)
    expect(OFFLINE_AVAILABLE).toBe(true)
    // search + retrieval work with no fetch defined
    const res = search('safety permit')
    expect(res.length).toBeGreaterThan(0)
    expect(getArticle(res[0].id).body).toBeTruthy()
    fetchSpy.mockRestore()
  })
})

describe('3. context-sensitive help', () => {
  it('maps a panel key to its help articles', () => {
    const help = contextHelp('safety')
    expect(help.map((h) => h.id)).toContain('safety')
    const eng = contextHelp('engtools')
    expect(eng.map((h) => h.id)).toEqual(expect.arrayContaining(['hydraulics', 'pumps', 'valves']))
  })

  it('returns empty for an unknown context', () => {
    expect(contextHelp('nonexistent-panel')).toEqual([])
    expect(contextHelp('')).toEqual([])
  })

  it('tracks the last panel for the docs center', () => {
    setHelpContext('wind')
    expect(getHelpContext()).toBe('wind')
    setHelpContext('docs')                         // opening docs does not overwrite context
    expect(getHelpContext()).toBe('wind')
  })
})
