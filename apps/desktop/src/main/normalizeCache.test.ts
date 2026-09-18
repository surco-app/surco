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

// The measurement is ebur128's end-of-run summary, the same pass the editor's loudness
// section runs (see ebur128MeasureArgs).
const EBUR128_SUMMARY = `[Parsed_ebur128_0 @ 0x0] Summary:

  Integrated loudness:
    I:         -23.5 LUFS
    Threshold: -33.6 LUFS

  Loudness range:
    LRA:         6.0 LU
    Threshold:  -43.6 LUFS

  True peak:
    Peak:       -4.2 dBFS`

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
      : filter.includes('ebur128')
        ? EBUR128_SUMMARY
        : ''
    cb(null, { stdout: '', stderr })
  },
}))

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
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
// the measurement instead of paying that decode again. Without a prefilter the
// measurement is the editor's own loudness reading (ebur128 plus the astats channel
// pass it carries), so one conversion costs those decodes once and nothing after.
describe('normalizeFilter measurement caching', () => {
  it('measures loudness once for repeated conversions of an unchanged file', async () => {
    const first = await normalizeFilter(src, loudness, 44100)
    const afterFirst = calls.length
    const second = await normalizeFilter(src, loudness, 44100)
    expect(first).not.toBeNull()
    expect(second).toEqual(first)
    expect(afterFirst).toBeGreaterThan(0)
    expect(calls.length).toBe(afterFirst)
  })

  // The figures are a fact about the file, not about the target: loudnorm's own
  // measurement pass carried the target (its offset depended on it) and had to run
  // again per target, which ebur128's does not.
  it('does not measure again when only the loudness target changes', async () => {
    await normalizeFilter(src, loudness, 44100)
    const afterFirst = calls.length
    const other = await normalizeFilter(src, { ...loudness, targetLufs: -9 }, 44100)
    expect(other).not.toBeNull()
    expect(calls.length).toBe(afterFirst)
  })

  it('measures the peak once for repeated peak-mode conversions', async () => {
    const first = await normalizeFilter(src, peak)
    const second = await normalizeFilter(src, peak)
    expect(first).not.toBeNull()
    expect(second).toEqual(first)
    expect(calls.length).toBe(1)
  })
})
