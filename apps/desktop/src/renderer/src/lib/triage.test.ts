import { describe, expect, it } from 'vitest'
import type { SpectrumResult, TrackMetadata } from '../../../shared/types'
import type { TrackItem, TrackStatus } from '../types'
import {
  filterByQuality,
  matchesSearch,
  qualityCounts,
  sortTracks,
  trackQuality,
  tracksToAnalyze,
} from './triage'

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
    expect(qualityCounts(tracks)).toEqual({
      suspect: 1,
      good: 1,
      unanalyzed: 2,
      unconverted: 3,
      automatched: 0,
    })
  })
})

describe('matchesSearch', () => {
  const t = (over: Partial<Omit<TrackItem, 'meta'>> & { meta?: Partial<TrackMetadata> }): TrackItem =>
    ({ listLabel: '', fileName: '', meta: {}, ...over }) as TrackItem

  it('matches every track when the query is blank or whitespace', () => {
    const track = t({ listLabel: 'Back Now Yall' })
    expect(matchesSearch(track, '')).toBe(true)
    expect(matchesSearch(track, '   ')).toBe(true)
  })

  it('matches the list label the user sees on the row, case-insensitively', () => {
    const track = t({ listLabel: 'Back Now Yall' })
    expect(matchesSearch(track, 'now')).toBe(true)
    expect(matchesSearch(track, 'NOW')).toBe(true)
    expect(matchesSearch(track, 'house')).toBe(false)
  })

  it('matches the source file name even before tags are read', () => {
    expect(matchesSearch(t({ fileName: 'A2 - Untitled.flac' }), 'untitled')).toBe(true)
  })

  it('matches the artist, title and album tags so a crate can be searched by metadata', () => {
    const track = t({ meta: { artist: 'Floorplan', title: 'Never Grow Old', album: 'Paradise' } })
    expect(matchesSearch(track, 'floorplan')).toBe(true)
    expect(matchesSearch(track, 'grow')).toBe(true)
    expect(matchesSearch(track, 'paradise')).toBe(true)
  })
})

describe('sortTracks', () => {
  const mk = (over: Partial<Omit<TrackItem, 'meta'>> & { meta?: Partial<TrackMetadata> }): TrackItem =>
    ({ listLabel: '', meta: {}, status: 'idle', ...over }) as TrackItem

  it('leaves the import order untouched for the default sort', () => {
    const list = [mk({ id: 'b' }), mk({ id: 'a' })]
    // Returns the same array reference so the drop order is preserved verbatim.
    expect(sortTracks(list, 'import')).toBe(list)
  })

  it('sorts by track name, locale-aware so case does not split the alphabet', () => {
    const list = [mk({ listLabel: 'Zoo' }), mk({ listLabel: 'apple' }), mk({ listLabel: 'Banana' })]
    expect(sortTracks(list, 'name').map((t) => t.listLabel)).toEqual(['apple', 'Banana', 'Zoo'])
  })

  it('sorts by artist and pushes the untagged tracks to the end', () => {
    const list = [
      mk({ id: '1', meta: { artist: 'Mr Fingers' } }),
      mk({ id: '2', meta: { artist: '' } }),
      mk({ id: '3', meta: { artist: 'Floorplan' } }),
    ]
    expect(sortTracks(list, 'artist').map((t) => t.id)).toEqual(['3', '1', '2'])
  })

  it('sorts by duration ascending with the unprobed tracks last', () => {
    const list = [
      mk({ id: 'long', duration: 400 }),
      mk({ id: 'none' }),
      mk({ id: 'short', duration: 120 }),
    ]
    expect(sortTracks(list, 'duration').map((t) => t.id)).toEqual(['short', 'long', 'none'])
  })

  it('keeps equal rows in their import order so toggling never scrambles ties', () => {
    const list = [mk({ id: 'x', listLabel: 'Same' }), mk({ id: 'y', listLabel: 'Same' })]
    expect(sortTracks(list, 'name').map((t) => t.id)).toEqual(['x', 'y'])
  })
})

describe('automatched filter', () => {
  const t = (id: string, autoMatched?: boolean): TrackItem =>
    ({ id, status: 'idle', autoMatched }) as TrackItem
  // Auto-match is a provenance flag, orthogonal to the quality verdict, so it gets its
  // own filter and tally rather than folding into the quality buckets.
  const tracks = [t('filled', true), t('manual'), t('also-filled', true)]

  it('keeps only the tracks whose metadata was filled by auto-match', () => {
    expect(filterByQuality(tracks, 'automatched').map((x) => x.id)).toEqual([
      'filled',
      'also-filled',
    ])
  })

  it('tallies the auto-matched tracks for its filter badge', () => {
    expect(qualityCounts(tracks).automatched).toBe(2)
  })
})
