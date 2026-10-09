import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { copyQuality, qualityRank } from './copyQuality'

const at = (path: string, spectrum?: Partial<NonNullable<TrackItem['spectrum']>>) =>
  ({
    inputPath: path,
    spectrum: spectrum && {
      cutoffHz: 20500,
      sampleRateHz: 44100,
      processed: false,
      hasKnee: true,
      ...spectrum,
    },
  }) as TrackItem

describe('copyQuality', () => {
  // The view must never invent a verdict for a copy nobody measured.
  it('has none for a copy not analyzed or whose analysis failed', () => {
    expect(copyQuality(at('/a.aiff'))).toBeNull()
    expect(copyQuality(at('/a.aiff', { cutoffHz: null }))).toBeNull()
    expect(copyQuality(undefined)).toBeNull()
  })

  it('reads the verdict the editor shows, on the container of the file', () => {
    expect(copyQuality(at('/a.aiff', { cutoffHz: 16000 }))).toEqual({
      verdict: 'bad',
      transcode: true,
      cutoffHz: 16000,
      hasKnee: true,
    })
    expect(copyQuality(at('/a.mp3', { cutoffHz: 16000 }))).toMatchObject({
      verdict: 'good',
      transcode: false,
    })
  })

  // A copy nobody measured may still be the good one; a measured transcode never is, so the
  // review never suggests keeping it over an unmeasured copy.
  it('ranks good before doubtful, reprocessed, unknown and bad', () => {
    const ranks = [
      at('/a.aiff', {}),
      at('/a.m4a', { cutoffHz: 18500 }),
      at('/a.aiff', { processed: true }),
      at('/a.aiff', undefined),
      at('/a.aiff', { cutoffHz: 16000 }),
    ].map((r) => qualityRank(copyQuality(r)))
    expect(ranks).toEqual([0, 1, 2, 3, 4])
  })
})
