import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-grid-audit-cache-'))
  return { app: { getPath: () => dir } }
})

const fit = {
  bpm: 140,
  firstMs: 12,
  fine: Array.from({ length: 60 }, () => ({ ms: 0, firstMs: 12 })),
}
const run = { windows: [{ ms: 6000, offsetMs: 2 }], total: 1, minutes: 2, fit }
const measured = { windows: [{ ms: 6000, offsetMs: 2 }], total: 1, heardPerMinute: 30 }
const measureGridAudit = vi.hoisted(() => vi.fn())
const measureBeatGrid = vi.hoisted(() => vi.fn())
vi.mock('./ffmpeg', () => ({ measureGridAudit, measureBeatGrid }))

import { cachedBeatGrid, cachedGridAudit } from './beatGridCache'

function track(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'surco-grid-audit-src-')), 'a.wav')
  writeFileSync(file, 'audio')
  return file
}

describe('cachedGridAudit', () => {
  it('reuses the fit already kept instead of fitting the beat again', async () => {
    const file = track()
    measureBeatGrid.mockReset().mockResolvedValue(fit)
    await cachedBeatGrid(file)
    measureGridAudit.mockReset().mockResolvedValue({ ...run, fit: null })
    expect(await cachedGridAudit(file, [0, 500, 1000], 0)).toEqual(measured)
    expect(measureGridAudit).toHaveBeenCalledWith(file, [0, 500, 1000], 0, false)
  })

  it('measures a grid once, so the filter does not decode the library again on the next look', async () => {
    const file = track()
    measureGridAudit.mockReset().mockResolvedValue(run)
    expect(await cachedGridAudit(file, [0, 500, 1000], 0)).toEqual(measured)
    expect(await cachedGridAudit(file, [0, 500, 1000], 0)).toEqual(measured)
    expect(measureGridAudit).toHaveBeenCalledTimes(1)
  })

  it('measures again when the grid changes, since the hits are read against its own beats', async () => {
    const file = track()
    measureGridAudit.mockReset().mockResolvedValue(run)
    await cachedGridAudit(file, [0, 500, 1000], 0)
    await cachedGridAudit(file, [10, 510, 1010], 0)
    expect(measureGridAudit).toHaveBeenCalledTimes(2)
  })

  it('keeps the fit heard in the same decode, so Auto finds it ready without reading the file twice', async () => {
    const file = track()
    measureGridAudit.mockReset().mockResolvedValue(run)
    measureBeatGrid.mockReset()
    await cachedGridAudit(file, [0, 500, 1000], 0)
    expect(await cachedBeatGrid(file)).toEqual(fit)
    expect(measureBeatGrid).not.toHaveBeenCalled()
  })
})
