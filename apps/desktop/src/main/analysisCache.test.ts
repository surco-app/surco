import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// cachedAnalysis persists to app.getPath('userData')/analysis-cache, so point
// Electron at a throwaway temp dir and exercise the real disk round-trip.
vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-analysis-cache-'))
  return { app: { getPath: () => dir } }
})

import { mkdtempSync, rmSync } from 'node:fs'
import { utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import {
  analysisCacheStats,
  cachedAnalysis,
  clearAnalysisCache,
  pruneAnalysisCache,
} from './analysisCache'

const work = mkdtempSync(join(tmpdir(), 'surco-analysis-src-'))
afterAll(() => {
  rmSync(app.getPath('userData'), { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
})

let counter = 0
async function makeFile(): Promise<string> {
  const path = join(work, `track-${counter++}.aiff`)
  await writeFile(path, 'audio')
  return path
}

describe('cachedAnalysis', () => {
  beforeEach(() => {
    rmSync(join(app.getPath('userData'), 'analysis-cache'), { recursive: true, force: true })
  })

  // The whole point: a second analysis of an unchanged file must not re-run the
  // (expensive) compute — that's the ffmpeg work we're trying to avoid on reopen.
  it('runs compute once for an unchanged file and serves the rest from disk', async () => {
    const file = await makeFile()
    const compute = vi.fn().mockResolvedValue({ value: 42 })

    const first = await cachedAnalysis('demo', file, compute)
    const second = await cachedAnalysis('demo', file, compute)

    expect(first).toEqual({ value: 42 })
    expect(second).toEqual({ value: 42 })
    expect(compute).toHaveBeenCalledTimes(1)
  })

  // An edited or replaced file gets a new mtime, so its stale spectrum/loudness
  // must be recomputed rather than served from the old key.
  it('recomputes when the file mtime changes', async () => {
    const file = await makeFile()
    const compute = vi.fn().mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 })

    expect(await cachedAnalysis('demo', file, compute)).toEqual({ v: 1 })
    const later = new Date(Date.now() + 60_000)
    await utimes(file, later, later)
    expect(await cachedAnalysis('demo', file, compute)).toEqual({ v: 2 })
    expect(compute).toHaveBeenCalledTimes(2)
  })

  // Different analyses of the same file must not collide on one key.
  it('keys by namespace so different analyses cache independently', async () => {
    const file = await makeFile()
    const spectrum = vi.fn().mockResolvedValue({ kind: 'spectrum' })
    const loudness = vi.fn().mockResolvedValue({ kind: 'loudness' })

    expect(await cachedAnalysis('spectrum', file, spectrum)).toEqual({ kind: 'spectrum' })
    expect(await cachedAnalysis('loudness', file, loudness)).toEqual({ kind: 'loudness' })
    expect(await cachedAnalysis('spectrum', file, spectrum)).toEqual({ kind: 'spectrum' })
    expect(spectrum).toHaveBeenCalledTimes(1)
    expect(loudness).toHaveBeenCalledTimes(1)
  })

  // A missing/unreadable file can't be keyed by mtime, so it must fall through to
  // a live compute every time rather than caching against a bogus key.
  it('computes without caching when the file cannot be stat-ed', async () => {
    const compute = vi.fn().mockResolvedValue({ v: 1 })
    const gone = join(work, 'does-not-exist.aiff')

    await cachedAnalysis('demo', gone, compute)
    await cachedAnalysis('demo', gone, compute)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  // The cache dir comes from app.getPath, which unit tests of the conversion
  // pipeline stub out (and Electron could conceivably fail) — the documented
  // contract is that every failure path degrades to a live compute.
  it('computes without caching when the cache location cannot be resolved', async () => {
    const file = await makeFile()
    const compute = vi.fn().mockResolvedValue({ v: 7 })
    const spy = vi.spyOn(app, 'getPath').mockImplementation(() => {
      throw new Error('no userData')
    })
    try {
      await expect(cachedAnalysis('demo', file, compute)).resolves.toEqual({ v: 7 })
      await expect(cachedAnalysis('demo', file, compute)).resolves.toEqual({ v: 7 })
      expect(compute).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })

  // A failed measurement (null) must not be pinned: the next request should retry
  // rather than serve the failure forever.
  it('does not cache a null result, so a later attempt retries', async () => {
    const file = await makeFile()
    const compute = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ v: 9 })

    expect(await cachedAnalysis('demo', file, compute)).toBeNull()
    expect(await cachedAnalysis('demo', file, compute)).toEqual({ v: 9 })
    expect(compute).toHaveBeenCalledTimes(2)
  })

  // The shouldCache predicate lets the spectrogram handler skip pinning a transient
  // cutoff failure while still caching the (always-present) image on full success.
  it('honors a custom shouldCache predicate', async () => {
    const file = await makeFile()
    const compute = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ ok: true })

    await cachedAnalysis<{ ok: boolean }>('demo', file, compute, (r) => r.ok)
    await cachedAnalysis<{ ok: boolean }>('demo', file, compute, (r) => r.ok)
    await cachedAnalysis<{ ok: boolean }>('demo', file, compute, (r) => r.ok)
    // First (ok:false) not cached → recomputed; second (ok:true) cached → third served.
    expect(compute).toHaveBeenCalledTimes(2)
  })
})

describe('clearAnalysisCache', () => {
  beforeEach(() => {
    rmSync(join(app.getPath('userData'), 'analysis-cache'), { recursive: true, force: true })
  })

  // The settings "empty cache" button: every analysis must be gone so the next open
  // recomputes from scratch (the whole point of the manual clear).
  it('deletes every cached entry so each file recomputes', async () => {
    const files = await Promise.all([makeFile(), makeFile()])
    for (const f of files) await cachedAnalysis('demo', f, vi.fn().mockResolvedValue({ v: 1 }))

    await clearAnalysisCache()

    const recompute = vi.fn().mockResolvedValue({ v: 2 })
    for (const f of files) await cachedAnalysis('demo', f, recompute)
    expect(recompute).toHaveBeenCalledTimes(files.length)
  })

  // Clearing a cache that was never written (fresh install, no analysis yet) is a
  // no-op, not an error — the button must work before any track is opened.
  it('is a no-op when the cache directory does not exist', async () => {
    await expect(clearAnalysisCache()).resolves.toBeUndefined()
  })
})

describe('analysisCacheStats', () => {
  beforeEach(() => {
    rmSync(join(app.getPath('userData'), 'analysis-cache'), { recursive: true, force: true })
  })

  // The settings hint shows how much is cached; an empty/absent cache reads as zero
  // rather than throwing, so the row renders on a fresh install.
  it('reports zero for an absent cache', async () => {
    expect(await analysisCacheStats()).toEqual({ files: 0, bytes: 0 })
  })

  // Counts every entry and sums their sizes so the hint reflects real disk use.
  it('counts entries and sums their bytes', async () => {
    const files = await Promise.all([makeFile(), makeFile(), makeFile()])
    for (const f of files) await cachedAnalysis('demo', f, vi.fn().mockResolvedValue({ v: 1 }))

    const stats = await analysisCacheStats()
    expect(stats.files).toBe(files.length)
    expect(stats.bytes).toBeGreaterThan(0)
  })
})

describe('pruneAnalysisCache', () => {
  // A huge library would otherwise grow the cache without bound; pruning keeps the
  // newest entries and drops the oldest once over the cap.
  it('keeps the cap of most-recent entries and deletes the oldest', async () => {
    const files = await Promise.all([makeFile(), makeFile(), makeFile()])
    for (const f of files) {
      await cachedAnalysis('demo', f, vi.fn().mockResolvedValue({ v: 1 }))
    }

    await pruneAnalysisCache(1)

    // Only the single newest entry survives, so two of the three recompute.
    const recompute = vi.fn().mockResolvedValue({ v: 2 })
    for (const f of files) await cachedAnalysis('demo', f, recompute)
    expect(recompute).toHaveBeenCalledTimes(2)
  })
})
