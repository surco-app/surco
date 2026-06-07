import { describe, expect, it } from 'vitest'
import type { SpectrumResult } from '../../../shared/types'
import type { TrackItem, TrackStatus } from '../types'
import { filterByQuality, qualityCounts, trackQuality, tracksToAnalyze } from './triage'

// trackQuality only reads the spectrum, so a thin stand-in keeps the cases readable.
const withSpectrum = (spectrum?: Partial<SpectrumResult>): TrackItem =>
  ({
    spectrum: spectrum && { image: '', cutoffHz: null, sampleRateHz: 44100, ...spectrum },
  }) as TrackItem

describe('trackQuality', () => {
  it('is unanalyzed before the spectrum has been measured', () => {
    expect(trackQuality(withSpectrum())).toBe('unanalyzed')
  })

  it('stays unanalyzed when the cutoff analysis was inconclusive', () => {
    // A null cutoff means the spectrogram rendered but the cutoff pass failed — there
    // is no verdict to show, and needsSpectrum won't re-queue it, so the badge stays blank.
    expect(trackQuality(withSpectrum({ cutoffHz: null }))).toBe('unanalyzed')
  })

  it('is good when the cutoff reaches the lossless band', () => {
    expect(trackQuality(withSpectrum({ cutoffHz: 21000, sampleRateHz: 44100 }))).toBe('good')
  })

  it('is suspect when the cutoff falls short of Nyquist (a re-encoded MP3)', () => {
    expect(trackQuality(withSpectrum({ cutoffHz: 16000, sampleRateHz: 44100 }))).toBe('suspect')
  })
})

describe('tracksToAnalyze', () => {
  const t = (id: string, over: Partial<TrackItem> = {}): TrackItem => ({ id, ...over }) as TrackItem

  it('picks only tracks without a spectrum that are not already in flight', () => {
    const tracks = [
      t('done', { spectrum: { image: '', cutoffHz: 20000, sampleRateHz: 44100 } }),
      t('flying'),
      t('fresh'),
    ]
    const targets = tracksToAnalyze(tracks, new Set(['flying']))
    expect(targets.map((x) => x.id)).toEqual(['fresh'])
  })

  it('returns nothing once every track is analyzed', () => {
    const tracks = [t('a', { spectrum: { image: '', cutoffHz: 20000, sampleRateHz: 44100 } })]
    expect(tracksToAnalyze(tracks, new Set())).toEqual([])
  })
})

describe('filterByQuality / qualityCounts', () => {
  const t = (id: string, cutoffHz?: number | null, status: TrackStatus = 'idle'): TrackItem =>
    ({
      id,
      status,
      spectrum: cutoffHz === undefined ? undefined : { image: '', cutoffHz, sampleRateHz: 44100 },
    }) as TrackItem
  // 'good' is the only track already converted; the rest are still pending conversion.
  const tracks = [t('good', 21000, 'done'), t('bad', 16000), t('fresh'), t('inconclusive', null)]

  it('returns every track when the filter is "all"', () => {
    expect(filterByQuality(tracks, 'all')).toHaveLength(4)
  })

  it('keeps only the suspect rips so the fakes are isolated', () => {
    expect(filterByQuality(tracks, 'suspect').map((x) => x.id)).toEqual(['bad'])
  })

  it('keeps only the genuine-lossless rips when filtering for good', () => {
    expect(filterByQuality(tracks, 'good').map((x) => x.id)).toEqual(['good'])
  })

  it('treats an inconclusive cutoff as unanalyzed alongside the unmeasured ones', () => {
    expect(filterByQuality(tracks, 'unanalyzed').map((x) => x.id)).toEqual([
      'fresh',
      'inconclusive',
    ])
  })

  it('keeps only the tracks not yet converted regardless of quality verdict', () => {
    expect(filterByQuality(tracks, 'unconverted').map((x) => x.id)).toEqual([
      'bad',
      'fresh',
      'inconclusive',
    ])
  })

  it('counts suspect, good, unanalyzed and unconverted tracks for the filter badges', () => {
    expect(qualityCounts(tracks)).toEqual({ suspect: 1, good: 1, unanalyzed: 2, unconverted: 3 })
  })
})
