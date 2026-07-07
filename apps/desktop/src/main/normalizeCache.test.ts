import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// cachedAnalysis persists under app.getPath('userData'), so point it at a
// throwaway temp dir; isPackaged is for binaries.ts.
vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-normcache-'))
  return { app: { isPackaged: false, getPath: () => dir } }
})

// Capture every spawn and answer with a canned measurement, so the tests can
// count how many measurement decodes a repeated conversion actually costs.
const calls: Array<{ file: string; args: string[] }> = []

const LOUDNORM_JSON = `[Parsed_loudnorm_0 @ 0x0]
{
  "input_i": "-23.50",
  "input_tp": "-4.20",
  "input_lra": "6.00",
  "input_thresh": "-33.60",
  "target_offset": "0.10"
}`

vi.mock('node:child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    _opts: unknown,
    cb: (err: unknown, out: { stdout: string; stderr: string }) => void,
  ) => {
    calls.push({ file, args })
    const filter = args.join(' ')
    const stderr = filter.includes('volumedetect')
      ? '[Parsed_volumedetect_0 @ 0x0] max_volume: -3.4 dB'
      : filter.includes('loudnorm')
        ? LOUDNORM_JSON
        : ''
    cb(null, { stdout: '', stderr })
  },
}))

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { rmSync } from 'node:fs'
import type { NormalizeConfig } from '../shared/types'
import { clearAnalysisCache } from './analysisCache'
import { normalizeFilter } from './ffmpeg'

const work = mkdtempSync(join(tmpdir(), 'surco-normcache-src-'))
const src = join(work, 'in.flac')
writeFileSync(src, 'audio')

const loudness: NormalizeConfig = { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }
const peak: NormalizeConfig = { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

beforeEach(async () => {
  calls.length = 0
  await clearAnalysisCache()
})

afterAll(() => {
  rmSync(app.getPath('userData'), { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
})

// The measurement pass decodes the whole file — as long as the conversion itself.
// Re-converting an unchanged track (edited metadata, another format) must reuse
// the measurement instead of paying that decode again.
describe('normalizeFilter measurement caching', () => {
  it('measures loudness once for repeated conversions of an unchanged file', async () => {
    const first = await normalizeFilter(src, loudness, 44100)
    const second = await normalizeFilter(src, loudness, 44100)
    expect(first).not.toBeNull()
    expect(second).toEqual(first)
    expect(calls.length).toBe(1)
  })

  it('re-measures when the loudness target changes, since the offset depends on it', async () => {
    await normalizeFilter(src, loudness, 44100)
    await normalizeFilter(src, { ...loudness, targetLufs: -9 }, 44100)
    expect(calls.length).toBe(2)
  })

  it('measures the peak once for repeated peak-mode conversions', async () => {
    const first = await normalizeFilter(src, peak)
    const second = await normalizeFilter(src, peak)
    expect(first).not.toBeNull()
    expect(second).toEqual(first)
    expect(calls.length).toBe(1)
  })
})
