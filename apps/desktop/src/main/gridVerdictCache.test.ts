import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-grid-verdict-cache-'))
  return { app: { getPath: () => dir } }
})

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { GridFit } from '../shared/gridEdit'
import { cachedGridVerdict } from './gridVerdictCache'

const work = mkdtempSync(join(tmpdir(), 'surco-grid-verdict-src-'))
const file = join(work, 'track.mp3')
writeFileSync(file, 'audio')
afterAll(() => {
  rmSync(work, { recursive: true, force: true })
  rmSync(app.getPath('userData'), { recursive: true, force: true })
})

const beats = Array.from({ length: 64 }, (_, i) => ({ ms: i * 500 }))
const fit: GridFit = { bpm: 120, firstMs: 0 }

// Each reopen of a crate asked every track again: the head of each file on the NAS and the
// fit of its beats, for a verdict nothing had changed. Measured once, it stays measured.
describe('cachedGridVerdict', () => {
  beforeEach(() => {
    rmSync(join(app.getPath('userData'), 'analysis-cache'), { recursive: true, force: true })
  })

  it('measures an unchanged track against an unchanged grid only once', async () => {
    const measure = vi.fn(async () => fit)
    const first = await cachedGridVerdict(file, beats, measure)
    expect(await cachedGridVerdict(file, beats, measure)).toEqual(first)
    expect(measure).toHaveBeenCalledTimes(1)
  })

  // Re-gridding the track in the DJ program changes what the verdict is about.
  it('measures again once the program grid changes', async () => {
    const measure = vi.fn(async () => fit)
    await cachedGridVerdict(file, beats, measure)
    await cachedGridVerdict(
      file,
      beats.map((b) => ({ ms: b.ms + 40 })),
      measure,
    )
    expect(measure).toHaveBeenCalledTimes(2)
  })

  // A decode that failed this time is not a verdict to keep.
  it('keeps no answer from a fit that could not be measured', async () => {
    const measure = vi.fn(async () => null)
    expect(await cachedGridVerdict(file, beats, measure)).toBeNull()
    await cachedGridVerdict(file, beats, measure)
    expect(measure).toHaveBeenCalledTimes(2)
  })

  it('reads nothing from the file for a track with no grid to judge', async () => {
    const measure = vi.fn(async () => fit)
    expect(await cachedGridVerdict(file, undefined, measure)).toBeNull()
    expect(await cachedGridVerdict(file, [], measure)).toBeNull()
    expect(measure).not.toHaveBeenCalled()
  })
})
