import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

// lookupCacheStore persists to app.getPath('userData')/<name>.json; point Electron at
// a throwaway temp dir and exercise the real save/load round-trip, same as
// appleMusicLibraryCache.test.ts and analysisCache.test.ts.
vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-lookupcache-'))
  const listeners: Record<string, (() => void)[]> = {}
  return {
    app: {
      getPath: () => dir,
      on: (event: string, cb: () => void) => {
        listeners[event] = listeners[event] ?? []
        listeners[event].push(cb)
      },
      // Test-only escape hatch to fire a registered handler (e.g. 'before-quit')
      // without a real Electron runtime.
      __emit: (event: string) => {
        for (const cb of listeners[event] ?? []) cb()
      },
    },
  }
})

import { rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { createLookupCacheStore, SAVE_DEBOUNCE_MS } from './lookupCacheStore'

const cacheFile = (name: string): string => join(app.getPath('userData'), `${name}.json`)

afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }))

afterEach(() => {
  vi.useRealTimers()
  try {
    unlinkSync(cacheFile('test-provider'))
  } catch {
    // no file written this test, that's fine
  }
})

describe('createLookupCacheStore', () => {
  // First launch ever: no file on disk means an empty store, not an error.
  it('starts empty when no cache file exists', () => {
    const store = createLookupCacheStore<string, string>('test-provider')
    expect(store.hasSearch('missing')).toBe(false)
    expect(store.getSearch('missing')).toBeUndefined()
    expect(store.hasRelease(1)).toBe(false)
    expect(store.getRelease(1)).toBeUndefined()
  })

  // The whole point: what one session wrote to disk is visible to a fresh store
  // instance (a new process / the next launch), without a manual reload call.
  it('round-trips search and release entries across a simulated restart', async () => {
    vi.useFakeTimers()
    const first = createLookupCacheStore<{ id: number }, { title: string }>('test-provider')
    first.setSearch('aphex twin', { id: 1 })
    first.setRelease(7001, { title: 'Selected Ambient Works' })
    // Flush the debounced write synchronously instead of waiting out the debounce.
    await vi.runAllTimersAsync()

    const second = createLookupCacheStore<{ id: number }, { title: string }>('test-provider')
    expect(second.getSearch('aphex twin')).toEqual({ id: 1 })
    expect(second.getRelease(7001)).toEqual({ title: 'Selected Ambient Works' })
    expect(second.hasSearch('aphex twin')).toBe(true)
    expect(second.hasRelease(7001)).toBe(true)
  })

  // Corrupt JSON (truncated write, hand edit) must degrade to an empty store, never
  // throw and never poison every lookup for the session.
  it('starts empty when the cache file is corrupt', () => {
    writeFileSync(cacheFile('test-provider'), '{"not valid')
    const store = createLookupCacheStore<string, string>('test-provider')
    expect(store.hasSearch('anything')).toBe(false)
    expect(store.hasRelease(1)).toBe(false)
  })

  // A file that parses but isn't the expected shape (wrong version, hand edit) is
  // just as unusable as invalid JSON — same empty-store degradation.
  it('starts empty when the cache file has the wrong shape', () => {
    writeFileSync(cacheFile('test-provider'), JSON.stringify({ nope: true }))
    const store = createLookupCacheStore<string, string>('test-provider')
    expect(store.hasSearch('anything')).toBe(false)
  })

  // Caps bound disk + parse time (releases can be tens of KB). Inserting past the cap
  // must evict the oldest entry, not the newest — the just-added lookup must survive.
  it('evicts the oldest search entry once the cap is exceeded', async () => {
    vi.useFakeTimers()
    const store = createLookupCacheStore<number, never>('test-provider', { searchCap: 2 })
    store.setSearch('a', 1)
    store.setSearch('b', 2)
    store.setSearch('c', 3)
    await vi.runAllTimersAsync()

    expect(store.hasSearch('a')).toBe(false)
    expect(store.hasSearch('b')).toBe(true)
    expect(store.hasSearch('c')).toBe(true)
  })

  it('evicts the oldest release entry once the cap is exceeded', async () => {
    vi.useFakeTimers()
    const store = createLookupCacheStore<never, number>('test-provider', { releaseCap: 2 })
    store.setRelease(1, 10)
    store.setRelease(2, 20)
    store.setRelease(3, 30)
    await vi.runAllTimersAsync()

    expect(store.hasRelease(1)).toBe(false)
    expect(store.hasRelease(2)).toBe(true)
    expect(store.hasRelease(3)).toBe(true)
  })

  // Re-setting an already-cached key must not evict anything (no growth) and must not
  // reset its insertion order to "newest" in a way that starves the actually-new entries —
  // it simply refreshes the value in place.
  it('overwriting an existing key does not evict another entry', async () => {
    vi.useFakeTimers()
    const store = createLookupCacheStore<number, never>('test-provider', { searchCap: 2 })
    store.setSearch('a', 1)
    store.setSearch('b', 2)
    store.setSearch('a', 99)
    await vi.runAllTimersAsync()

    expect(store.getSearch('a')).toBe(99)
    expect(store.hasSearch('b')).toBe(true)
  })

  // Persistence must not write to disk on every single mutation — a debounce coalesces
  // a burst of writes (e.g. several searches typed in a row) into one file write that
  // only happens once the burst goes quiet, and it captures the whole burst's state.
  it('debounces writes so a burst of mutations produces a single save', async () => {
    const { existsSync } = require('node:fs')
    vi.useFakeTimers()
    const store = createLookupCacheStore<number, never>('test-provider')
    store.setSearch('a', 1)
    store.setSearch('b', 2)
    store.setSearch('c', 3)
    // Mid-burst, well before the debounce window elapses: nothing written yet.
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1)
    expect(existsSync(cacheFile('test-provider'))).toBe(false)

    await vi.runAllTimersAsync()
    expect(existsSync(cacheFile('test-provider'))).toBe(true)

    const restarted = createLookupCacheStore<number, never>('test-provider')
    expect(restarted.getSearch('a')).toBe(1)
    expect(restarted.getSearch('b')).toBe(2)
    expect(restarted.getSearch('c')).toBe(3)
  })

  // The app quitting must not lose the last (debounced, not-yet-flushed) burst of writes:
  // before-quit flushes synchronously rather than waiting out the debounce timer.
  it('flushes a pending debounced save on before-quit', () => {
    vi.useFakeTimers()
    const store = createLookupCacheStore<number, never>('test-provider')
    store.setSearch('a', 1)

    // Fire the app's 'before-quit' handler the store registered at creation, without
    // advancing timers — proves the flush is synchronous, not just an early timer fire.
    ;(app as unknown as { __emit: (e: string) => void }).__emit('before-quit')

    const second = createLookupCacheStore<number, never>('test-provider')
    expect(second.getSearch('a')).toBe(1)
  })

  // A disk write failure is an optimization lost, not a crash: the in-memory cache
  // must keep serving the session's own lookups regardless.
  it('does not throw when the write fails', async () => {
    vi.useFakeTimers()
    const { mkdirSync, rmdirSync } = require('node:fs')
    mkdirSync(cacheFile('test-provider'))
    const store = createLookupCacheStore<number, never>('test-provider')
    store.setSearch('a', 1)
    await vi.runAllTimersAsync()
    expect(store.getSearch('a')).toBe(1)
    rmdirSync(cacheFile('test-provider'))
  })
})
