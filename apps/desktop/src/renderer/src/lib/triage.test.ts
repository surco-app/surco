import { describe, expect, it } from 'vitest'
import type { SpectrumResult } from '../../../shared/types'
import type { TrackItem } from '../types'
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
  const t = (id: string, cutoffHz?: number | null): TrackItem =>
    ({
      id,
      spectrum: cutoffHz === undefined ? undefined : { image: '', cutoffHz, sampleRateHz: 44100 },
    }) as TrackItem
  const tracks = [t('good', 21000), t('bad', 16000), t('fresh'), t('inconclusive', null)]

  it('returns every track when the filter is "all"', () => {
    expect(filterByQuality(tracks, 'all')).toHaveLength(4)
  })

  it('keeps only the suspect rips so the fakes are isolated', () => {
    expect(filterByQuality(tracks, 'suspect').map((x) => x.id)).toEqual(['bad'])
  })

  it('treats an inconclusive cutoff as unanalyzed alongside the unmeasured ones', () => {
    expect(filterByQuality(tracks, 'unanalyzed').map((x) => x.id)).toEqual([
      'fresh',
      'inconclusive',
    ])
  })

  it('counts suspect and unanalyzed tracks for the filter badges', () => {
    expect(qualityCounts(tracks)).toEqual({ suspect: 1, unanalyzed: 2 })
  })
})
