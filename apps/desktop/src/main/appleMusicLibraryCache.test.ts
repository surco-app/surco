import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

// appleMusicLibraryCache.ts persists to app.getPath('userData')/apple-music-library.json;
// point Electron at a throwaway temp dir and exercise the real save/load round-trip.
vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-amcache-'))
  return { app: { getPath: () => dir } }
})

import { mkdirSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppleMusicLookupCandidate } from '../shared/types'
import { loadLibraryCache, saveLibraryCache } from './appleMusicLibraryCache'

afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }))

afterEach(() => {
  try {
    unlinkSync(cacheFile())
  } catch {
    // File doesn't exist, that's fine
  }
})

const cacheFile = (): string => join(app.getPath('userData'), 'apple-music-library.json')

describe('appleMusicLibraryCache', () => {
  // First launch ever: no snapshot on disk means "no placeholder", never an empty
  // library that would flag the whole crate as not-owned.
  it('returns null when no snapshot was ever saved', () => {
    expect(loadLibraryCache()).toBeNull()
  })

  // The whole point: what the dump produced this session comes back next session,
  // optional fields included, so the placeholder index matches like the real one.
  it('round-trips a snapshot with optional fields intact', () => {
    const lib: AppleMusicLookupCandidate[] = [
      { title: 'Strobe', artist: 'deadmau5', durationSec: 634, persistentId: 'ABCDEF0123456789' },
      { title: 'One', artist: 'A' },
    ]
    saveLibraryCache(lib)
    expect(loadLibraryCache()).toEqual(lib)
  })

  // The file lives on disk between sessions; a truncated write or a hand edit must
  // degrade to "no cache", not poison the index with garbage.
  it('returns null on corrupt JSON', () => {
    writeFileSync(cacheFile(), '{"not an arr')
    expect(loadLibraryCache()).toBeNull()
  })

  it('returns null when the JSON is not an array', () => {
    writeFileSync(cacheFile(), '{"tracks": []}')
    expect(loadLibraryCache()).toBeNull()
  })

  // A malformed row is dropped rather than dropping the whole snapshot: one bad hand
  // edit should not cost the other thousands of rows their instant verdicts.
  it('drops malformed rows and mistyped optional fields, keeps the rest', () => {
    writeFileSync(
      cacheFile(),
      JSON.stringify([
        { title: 'Good', artist: 'Artist' },
        { title: '', artist: 'NoTitle' },
        { artist: 'MissingTitle' },
        'not an object',
        null,
        { title: 'Odd Fields', artist: 'B', durationSec: 'long', persistentId: 42 },
      ]),
    )
    expect(loadLibraryCache()).toEqual([
      { title: 'Good', artist: 'Artist' },
      { title: 'Odd Fields', artist: 'B' },
    ])
  })

  // An empty library is a real state, distinct from a broken file: it round-trips
  // as [] so the renderer can build an (empty) index instead of waiting for the dump.
  it('round-trips a genuinely empty library', () => {
    saveLibraryCache([])
    expect(loadLibraryCache()).toEqual([])
  })

  // A non-empty file whose every row is garbage is a corrupt snapshot, not an empty
  // library — [] here would flag the whole crate as not-owned until the dump lands.
  it('returns null when every row of a non-empty file is malformed', () => {
    writeFileSync(cacheFile(), JSON.stringify(['a', 'b']))
    expect(loadLibraryCache()).toBeNull()
  })

  // The cache is an optimization: if the disk write fails the dump result must still
  // reach the renderer, so save swallows the failure instead of throwing.
  it('does not throw when the write fails', () => {
    mkdirSync(cacheFile())
    expect(() => saveLibraryCache([{ title: 'X', artist: 'Y' }])).not.toThrow()
    rmdirSync(cacheFile())
  })
})
