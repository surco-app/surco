import { describe, expect, it } from 'vitest'
import type { SpectrumResult, TrackMetadata } from '../../../shared/types'
import type { TrackItem, TrackStatus } from '../types'
import {
  EMPTY_FILTER,
  type FilterSelection,
  filterWithSticky,
  formatBuckets,
  matchesFilter,
  matchesSearch,
  qualityCounts,
  sortTracks,
  sourceFormat,
  suspectTracks,
  trackQuality,
  tracksToAnalyze,
} from './triage'

// The list filter is per-axis now; this keeps the cases reading "filter the list by X" the
// way they did when a single enum drove it, defaulting every other axis to "any".
const by = (tracks: TrackItem[], sel: Partial<FilterSelection>): TrackItem[] =>
  tracks.filter((t) => matchesFilter(t, { ...EMPTY_FILTER, ...sel }))

// trackQuality only reads the spectrum, so a thin stand-in keeps the cases readable.
const withSpectrum = (spectrum?: Partial<SpectrumResult>): TrackItem =>
  ({
    spectrum: spectrum && {
      image: '',
      cutoffHz: null,
      sampleRateHz: 44100,
      processed: false,
      ...spectrum,
    },
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

  it('is warn when the cutoff falls moderately short of Nyquist', () => {
    expect(trackQuality(withSpectrum({ cutoffHz: 18000, sampleRateHz: 44100 }))).toBe('warn')
  })

  it('is bad when the cutoff brick-walls deep below Nyquist (a re-encoded MP3)', () => {
    expect(trackQuality(withSpectrum({ cutoffHz: 16000, sampleRateHz: 44100 }))).toBe('bad')
  })

  it('is processed when the highs were regenerated, even though they reach far up', () => {
    // An enhancer hump pushes synthetic energy past the good line; the row must
    // flag the manipulation underneath the gloss, not rate it as merely dull.
    expect(
      trackQuality(withSpectrum({ cutoffHz: 20000, sampleRateHz: 44100, processed: true })),
    ).toBe('processed')
  })
})

describe('tracksToAnalyze', () => {
  const t = (id: string, over: Partial<TrackItem> = {}): TrackItem => ({ id, ...over }) as TrackItem

  it('picks only tracks without a spectrum that are not already in flight', () => {
    const tracks = [
      t('done', {
        spectrum: { image: '', cutoffHz: 20000, sampleRateHz: 44100, processed: false },
      }),
      t('flying'),
      t('fresh'),
    ]
    const targets = tracksToAnalyze(tracks, new Set(['flying']))
    expect(targets.map((x) => x.id)).toEqual(['fresh'])
  })

  it('returns nothing once every track is analyzed', () => {
    const tracks = [
      t('a', { spectrum: { image: '', cutoffHz: 20000, sampleRateHz: 44100, processed: false } }),
    ]
    expect(tracksToAnalyze(tracks, new Set())).toEqual([])
  })
})

describe('matchesFilter / qualityCounts', () => {
  const t = (id: string, cutoffHz?: number | null, status: TrackStatus = 'idle'): TrackItem =>
    ({
      id,
      status,
      spectrum: cutoffHz === undefined ? undefined : { image: '', cutoffHz, sampleRateHz: 44100 },
    }) as TrackItem
  // 'good' is the only track already converted; the rest are still pending conversion.
  const tracks = [
    t('good', 21000, 'done'),
    t('bad', 16000),
    t('borderline', 18000),
    t('fresh'),
    t('inconclusive', null),
  ]

  it('returns every track when no axis is constrained', () => {
    expect(by(tracks, {})).toHaveLength(5)
  })

  it('keeps both warn and bad rips under the suspect filter so the fakes are isolated', () => {
    expect(by(tracks, { quality: 'suspect' }).map((x) => x.id)).toEqual(['bad', 'borderline'])
  })

  it('keeps reprocessed (enhancer-faked) rips under suspect and counted, not dropped as unanalyzed', () => {
    // Splitting 'processed' out of 'bad' must not let the fakes — the whole point
    // of the triage bucket — slip past the suspect filter or its badge count.
    const faked = [
      {
        id: 'faked',
        status: 'idle',
        spectrum: { image: '', cutoffHz: 20000, sampleRateHz: 44100, processed: true },
      } as TrackItem,
    ]
    expect(by(faked, { quality: 'suspect' }).map((x) => x.id)).toEqual(['faked'])
    expect(qualityCounts(faked).suspect).toBe(1)
  })

  it('keeps only the genuine-lossless rips when filtering for good', () => {
    expect(by(tracks, { quality: 'good' }).map((x) => x.id)).toEqual(['good'])
  })

  it('treats an inconclusive cutoff as unanalyzed alongside the unmeasured ones', () => {
    expect(by(tracks, { quality: 'unanalyzed' }).map((x) => x.id)).toEqual([
      'fresh',
      'inconclusive',
    ])
  })

  it('keeps only the tracks not yet converted regardless of quality verdict', () => {
    expect(by(tracks, { conversion: 'unconverted' }).map((x) => x.id)).toEqual([
      'bad',
      'borderline',
      'fresh',
      'inconclusive',
    ])
  })

  // The whole point of the split: each axis is independent, so a DJ can stack one choice
  // from several sections and get only the tracks that satisfy every one at once.
  it('ANDs independent axes together, narrowing to their intersection', () => {
    // unconverted alone keeps four; layering quality 'unanalyzed' drops the two flagged
    // rips, leaving just the two without a verdict.
    expect(
      by(tracks, { conversion: 'unconverted', quality: 'unanalyzed' }).map((x) => x.id),
    ).toEqual(['fresh', 'inconclusive'])
  })

  it('counts suspect (warn + bad), good, unanalyzed and unconverted tracks for the filter badges', () => {
    expect(qualityCounts(tracks)).toEqual({
      suspect: 2,
      good: 1,
      unanalyzed: 2,
      unconverted: 4,
      automatched: 0,
      inLibrary: 0,
      notInLibrary: 0,
      duplicates: 0,
    })
  })
})

describe('Apple Music library filter', () => {
  const t = (id: string, inLibrary?: boolean): TrackItem => ({ id, inLibrary }) as TrackItem
  // 'unknown' has no verdict yet (library not loaded, or non-macOS) — neither filter
  // should claim it, or the user sees a track in both "owned" and "missing" buckets.
  const tracks = [t('owned', true), t('missing', false), t('unknown')]

  it('keeps only the tracks confirmed in the library under the in-library filter', () => {
    expect(by(tracks, { library: 'inLibrary' }).map((x) => x.id)).toEqual(['owned'])
  })

  it('keeps only the tracks confirmed absent under the not-in-library filter', () => {
    expect(by(tracks, { library: 'notInLibrary' }).map((x) => x.id)).toEqual(['missing'])
  })

  it('counts owned and missing separately, leaving the unverified out of both', () => {
    const counts = qualityCounts(tracks)
    expect(counts.inLibrary).toBe(1)
    expect(counts.notInLibrary).toBe(1)
  })
})

describe('filterWithSticky', () => {
  const t = (id: string, inLibrary?: boolean): TrackItem => ({ id, inLibrary }) as TrackItem
  const am = (id: string, autoMatched?: boolean): TrackItem =>
    ({ id, status: 'idle', autoMatched }) as TrackItem

  const sel = (over: Partial<FilterSelection>): FilterSelection => ({ ...EMPTY_FILTER, ...over })

  it('keeps a row pinned under the library filter after a background auto-match flips its verdict', () => {
    // This is the whole point: the user filters to "not in Apple Music", then while they
    // hunt the right match in the second column a background auto-match rewrites a row's
    // tags to the canonical name, which now matches the library and flips inLibrary
    // true. Without pinning the row would vanish from under them mid-work.
    const sticky = new Set<string>()
    expect(
      filterWithSticky(
        [t('a', false), t('b', false)],
        sel({ library: 'notInLibrary' }),
        sticky,
      ).map((x) => x.id),
    ).toEqual(['a', 'b'])
    expect(
      filterWithSticky([t('a', true), t('b', false)], sel({ library: 'notInLibrary' }), sticky).map(
        (x) => x.id,
      ),
    ).toEqual(['a', 'b'])
  })

  it('recomputes membership from scratch when the filter is re-applied (a fresh sticky set)', () => {
    // Re-clicking the chip is the deliberate "refresh" — the caller hands a new empty set,
    // so the now-owned row finally drops and the list reflects the current verdicts.
    const fresh = new Set<string>()
    expect(
      filterWithSticky([t('a', true), t('b', false)], sel({ library: 'notInLibrary' }), fresh).map(
        (x) => x.id,
      ),
    ).toEqual(['b'])
  })

  it('still surfaces a row that newly qualifies once its library verdict resolves', () => {
    // Pinning only adds; a track whose verdict lands as "missing" later must appear, or a
    // slow library lookup would leave real not-in-library tracks hidden.
    const sticky = new Set<string>()
    filterWithSticky([t('a', false)], sel({ library: 'notInLibrary' }), sticky)
    expect(
      filterWithSticky(
        [t('a', false), t('b', false)],
        sel({ library: 'notInLibrary' }),
        sticky,
      ).map((x) => x.id),
    ).toEqual(['a', 'b'])
  })

  it('does not pin when no library axis is active, dropping a row as soon as it stops matching', () => {
    // Stickiness is scoped to the library buckets, where a background rewrite silently
    // flips the verdict. The auto-matched bucket only changes by the user's own action,
    // so it must follow the live verdict like matchesFilter.
    const sticky = new Set<string>()
    filterWithSticky([am('x', true)], sel({ conversion: 'automatched' }), sticky)
    expect(filterWithSticky([am('x', false)], sel({ conversion: 'automatched' }), sticky)).toEqual(
      [],
    )
  })

  it('drops a pinned row that stops matching a co-active non-library axis (only the library flip is defeated)', () => {
    // A pinned row survives a background library flip, but must still satisfy the other
    // axes: if a completed analysis moves it out of the co-active quality bucket it should
    // drop, so stickiness never widens beyond the one verdict it's meant to hold steady.
    const q = (id: string, cutoffHz: number | null, inLibrary: boolean): TrackItem =>
      ({
        id,
        status: 'idle',
        inLibrary,
        spectrum: { image: '', cutoffHz, sampleRateHz: 44100 },
      }) as TrackItem
    const sticky = new Set<string>()
    // 'a' is unanalyzed (null cutoff) and not in the library, so it's pinned…
    filterWithSticky(
      [q('a', null, false)],
      sel({ library: 'notInLibrary', quality: 'unanalyzed' }),
      sticky,
    )
    // …but once its analysis lands as 'good' it no longer matches the quality axis, so even
    // though it's still pinned (and still not in the library) it drops out of view.
    expect(
      filterWithSticky(
        [q('a', 21000, false)],
        sel({ library: 'notInLibrary', quality: 'unanalyzed' }),
        sticky,
      ),
    ).toEqual([])
  })
})

describe('matchesSearch', () => {
  const t = (
    over: Partial<Omit<TrackItem, 'meta'>> & { meta?: Partial<TrackMetadata> },
  ): TrackItem => ({ listLabel: '', fileName: '', meta: {}, ...over }) as TrackItem

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
  const mk = (
    over: Partial<Omit<TrackItem, 'meta'>> & { meta?: Partial<TrackMetadata> },
  ): TrackItem => ({ listLabel: '', meta: {}, status: 'idle', ...over }) as TrackItem

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

  it('sorts by source format, grouping a mixed crate by container', () => {
    const list = [
      mk({ id: 'wav', inputPath: '/m/c.wav' }),
      mk({ id: 'flac', inputPath: '/m/a.flac' }),
      mk({ id: 'mp3', inputPath: '/m/b.mp3' }),
    ]
    expect(sortTracks(list, 'format').map((t) => t.id)).toEqual(['flac', 'mp3', 'wav'])
  })

  it('pushes tracks without a recognisable extension to the end of a format sort', () => {
    const list = [
      mk({ id: 'none', inputPath: '/m/no-ext' }),
      mk({ id: 'mp3', inputPath: '/m/b.mp3' }),
    ]
    expect(sortTracks(list, 'format').map((t) => t.id)).toEqual(['mp3', 'none'])
  })

  it('reverses the order under a descending sort', () => {
    const list = [mk({ listLabel: 'Zoo' }), mk({ listLabel: 'apple' }), mk({ listLabel: 'Banana' })]
    expect(sortTracks(list, 'name', 'desc').map((t) => t.listLabel)).toEqual([
      'Zoo',
      'Banana',
      'apple',
    ])
  })

  it('keeps tracks with missing data last even when the sort is descending', () => {
    // A descending sort flips the order of the real values, but the untagged/unprobed
    // rows are noise the user wants out of the way — they must stay at the end in both
    // directions, not jump to the top when the order is reversed.
    const list = [
      mk({ id: 'long', duration: 400 }),
      mk({ id: 'none' }),
      mk({ id: 'short', duration: 120 }),
    ]
    expect(sortTracks(list, 'duration', 'desc').map((t) => t.id)).toEqual(['long', 'short', 'none'])
  })

  it('leaves the import order untouched regardless of direction (it has no direction)', () => {
    const list = [mk({ id: 'b' }), mk({ id: 'a' })]
    expect(sortTracks(list, 'import', 'desc')).toBe(list)
  })
})

describe('sourceFormat', () => {
  const t = (inputPath: string): TrackItem => ({ inputPath }) as TrackItem

  it('reads the extension off the input path, uppercased like the row pill', () => {
    // The parsed fileName has dropped its extension, so the source container is read
    // from the original path — the same value the row pill shows.
    expect(sourceFormat(t('/music/A1 - Untitled.flac'))).toBe('FLAC')
    expect(sourceFormat(t('/music/bought.mp3'))).toBe('MP3')
  })

  it('keys off the last extension only, so a dotted name does not split the format', () => {
    expect(sourceFormat(t('/music/Mr. Fingers - Can You Feel It.aiff'))).toBe('AIFF')
  })

  it('is undefined when the path has no extension', () => {
    expect(sourceFormat(t('/music/no-extension'))).toBeUndefined()
  })
})

describe('per-format buckets', () => {
  const t = (id: string, inputPath: string): TrackItem => ({ id, inputPath }) as TrackItem
  const tracks = [t('a', '/m/a.flac'), t('b', '/m/b.mp3'), t('c', '/m/c.wav'), t('d', '/m/d.mp3')]

  it('lists each present format with its count, sorted, for the filter chips', () => {
    expect(formatBuckets(tracks)).toEqual([
      { format: 'FLAC', count: 1 },
      { format: 'MP3', count: 2 },
      { format: 'WAV', count: 1 },
    ])
  })

  it('offers no per-format filter for a single-format crate, since one format needs no filter', () => {
    expect(formatBuckets([t('a', '/m/a.flac'), t('b', '/m/b.flac')])).toEqual([])
  })

  it('offers no per-format filter for an empty list', () => {
    expect(formatBuckets([])).toEqual([])
  })
})

describe('automatched filter', () => {
  const t = (id: string, autoMatched?: boolean): TrackItem =>
    ({ id, status: 'idle', autoMatched }) as TrackItem
  // Auto-match is a provenance flag, orthogonal to the quality verdict, so it gets its
  // own filter and tally rather than folding into the quality buckets.
  const tracks = [t('filled', true), t('manual'), t('also-filled', true)]

  it('keeps only the tracks whose metadata was filled by auto-match', () => {
    expect(by(tracks, { conversion: 'automatched' }).map((x) => x.id)).toEqual([
      'filled',
      'also-filled',
    ])
  })

  it('tallies the auto-matched tracks for its filter badge', () => {
    expect(qualityCounts(tracks).automatched).toBe(2)
  })
})

describe('suspectTracks', () => {
  const t = (id: string, cutoffHz?: number | null, processed = false): TrackItem =>
    ({
      id,
      status: 'idle',
      spectrum:
        cutoffHz === undefined
          ? undefined
          : { image: '', cutoffHz, sampleRateHz: 44100, processed },
    }) as TrackItem

  // The one-click "trash the fakes" action must delete exactly what the suspect filter
  // shows — every flagged rip and nothing that passed as genuine or was never measured —
  // so a DJ who trusts the sweep isn't handed a surprise deletion.
  it('returns every flagged rip: amber (warn), red (bad) and enhancer-faked (processed)', () => {
    const tracks = [
      t('good', 21000),
      t('warn', 18000),
      t('bad', 16000),
      t('faked', 20000, true),
      t('fresh'),
      t('inconclusive', null),
    ]
    expect(suspectTracks(tracks).map((x) => x.id)).toEqual(['warn', 'bad', 'faked'])
  })

  it('returns nothing when no track has a suspect verdict, so the action stays disabled', () => {
    expect(suspectTracks([t('good', 21000), t('fresh')])).toEqual([])
  })
})
