import { describe, expect, it, vi } from 'vitest'
import type { GridCheck } from '../../../shared/gridCheck'
import type { SpectrumResult, TrackMetadata } from '../../../shared/types'
import type { Verification } from '../../../shared/verification'
import type { TrackItem, TrackStatus } from '../types'
import type { CopyVerdict } from './bestCopy'
import * as normalizeText from './normalizeText'
import {
  attentionOffered,
  EMPTY_FILTER,
  type FilterFacts,
  type FilterSelection,
  facetCounts,
  filterSessionKey,
  filterWithSticky,
  fitFilterToTab,
  formatBuckets,
  holdOrder,
  libraryOffered,
  matchesFilter,
  matchesSearch,
  NO_FACTS,
  outsideFilter,
  qualityCounts,
  searchMatcher,
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

  it('is transcoded when a lossless container hides a codec cut (fake lossless)', () => {
    // The editor's headline verdict for this file is "fake lossless", not a plain "bad
    // quality": a real codec knee can't occur in genuine lossless. The row must say the
    // same thing so the fake can be spotted without opening the editor — so the same
    // spectrum in a .flac is 'transcoded', not 'bad'.
    const track = withSpectrum({ cutoffHz: 16000, sampleRateHz: 44100, hasKnee: true })
    ;(track as { inputPath: string }).inputPath = '/x/on-the-edge.flac'
    expect(trackQuality(track)).toBe('transcoded')
  })

  it('stays good for the same cut inside a lossy container (an honest MP3)', () => {
    // An MP3 with a 16 kHz knee is the format working as designed, not a lie about it and
    // not a defect: the row badge stays green so a crate of MP3s doesn't triage as a wall
    // of red. 'transcoded' is reserved for the deception, and the editor's caption is
    // where the bitrate gets reported.
    const track = withSpectrum({ cutoffHz: 16000, sampleRateHz: 44100, hasKnee: true })
    ;(track as { inputPath: string }).inputPath = '/x/on-the-edge.mp3'
    expect(trackQuality(track)).toBe('good')
  })

  // An .m4a says nothing on its own; the analysis's codec does. A healthy AAC was graded
  // on the lossless scale and its encoder lowpass came out red; an ALAC with the same cut
  // is a lossy source dressed as lossless, like a .flac.
  it.each([
    ['aac', 'good'],
    ['alac', 'transcoded'],
    [undefined, 'bad'],
  ])('grades an .m4a holding %s as %s', (codec, verdict) => {
    const track = withSpectrum({ cutoffHz: 16000, sampleRateHz: 44100, hasKnee: true, codec })
    ;(track as { inputPath: string }).inputPath = '/x/song.m4a'
    expect(trackQuality(track)).toBe(verdict)
  })
})

describe('tracksToAnalyze', () => {
  const t = (id: string, over: Partial<TrackItem> = {}): TrackItem => ({ id, ...over }) as TrackItem

  it('picks only tracks without a spectrum that are not already in flight', () => {
    const tracks = [
      t('done', {
        spectrum: { cutoffHz: 20000, sampleRateHz: 44100, processed: false },
      }),
      t('flying'),
      t('fresh'),
    ]
    const targets = tracksToAnalyze(tracks, new Set(['flying']))
    expect(targets.map((x) => x.id)).toEqual(['fresh'])
  })

  it('returns nothing once every track is analyzed', () => {
    const tracks = [
      t('a', { spectrum: { cutoffHz: 20000, sampleRateHz: 44100, processed: false } }),
    ]
    expect(tracksToAnalyze(tracks, new Set())).toEqual([])
  })
})

describe('matchesFilter / qualityCounts', () => {
  const t = (id: string, cutoffHz?: number | null, status: TrackStatus = 'idle'): TrackItem =>
    ({
      id,
      status,
      spectrum: cutoffHz === undefined ? undefined : { cutoffHz, sampleRateHz: 44100 },
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
        spectrum: { cutoffHz: 20000, sampleRateHz: 44100, processed: true },
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
      damaged: 0,
      unconverted: 4,
      failed: 0,
      skipped: 0,
      automatched: 0,
      matchReview: 0,
      matchedDiscogs: 0,
      matchedBandcamp: 0,
      inLibrary: 0,
      notInLibrary: 0,
      duplicates: 0,
      silence: 0,
      clipping: 0,
      noCues: 0,
      offGrid: 0,
      badGrid: 0,
      betterThanLibrary: 0,
      unanalysedRekordbox: 0,
      unanalysedEngine: 0,
      noCover: 5,
      smallCover: 0,
      noBpm: 5,
      noKey: 5,
      missingRequired: 0,
      unsaved: 0,
      mismatch: 0,
      unplayed: 5,
      played: 0,
      noStars: 5,
      stars3: 0,
      stars4: 0,
      stars5: 0,
    })
  })
})

describe('attention filter (silence to trim, clipping)', () => {
  const t = (id: string, issues?: { silence: boolean; clipping: boolean }): TrackItem =>
    ({ id, status: 'idle', audioIssues: issues }) as TrackItem
  const tracks = [
    t('quiet-tail', { silence: true, clipping: false }),
    t('hot-master', { silence: false, clipping: true }),
    t('both', { silence: true, clipping: true }),
    t('clean', { silence: false, clipping: false }),
    t('undecoded'),
  ]

  // djotas's triage flow: while editing the collection, isolate the tracks with
  // retouch work left — silence still to trim, or true clipping to tame.
  it('buckets the retouch work and leaves undecoded tracks in neither', () => {
    expect(by(tracks, { attention: 'silence' }).map((x) => x.id)).toEqual(['quiet-tail', 'both'])
    expect(by(tracks, { attention: 'clipping' }).map((x) => x.id)).toEqual(['hot-master', 'both'])
    const counts = qualityCounts(tracks)
    expect(counts.silence).toBe(2)
    expect(counts.clipping).toBe(2)
  })

  it('stacks with the other axes like any dimension', () => {
    const done = [
      { ...t('trimmed-already', { silence: true, clipping: false }), status: 'done' },
    ] as TrackItem[]
    expect(
      by([...tracks, ...done], { attention: 'silence', conversion: 'unconverted' }).map(
        (x) => x.id,
      ),
    ).toEqual(['quiet-tail', 'both'])
  })
})

describe('no cues filter', () => {
  const row = (id: string, cues?: number[]): TrackItem =>
    ({
      id,
      status: 'idle',
      ...(cues && {
        sourcePreview: {
          title: id,
          artist: '',
          durationSec: 300,
          cues: cues.map((ms) => ({ ms, kind: 1, color: null })),
        },
      }),
    }) as TrackItem
  const tracks = [row('marked', [1000, 64000]), row('bare', []), row('loose-file')]

  // djotas 27/10: going through a Traktor playlist, he wants the tracks still waiting for
  // their cues. A loose file has no DJ library to read cues from, so it is not one of them.
  it('isolates the library tracks that carry no cue and leaves loose files out', () => {
    expect(by(tracks, { attention: 'noCues' }).map((x) => x.id)).toEqual(['bare'])
    expect(qualityCounts(tracks).noCues).toBe(1)
  })
})

describe('cues off the grid filter', () => {
  const row = (id: string, gridDriftMs?: number): TrackItem =>
    ({
      id,
      status: 'idle',
      sourcePreview: {
        title: id,
        artist: '',
        durationSec: 300,
        cues: [{ ms: 1000, kind: 1, color: null }],
        ...(gridDriftMs !== undefined && { gridDriftMs }),
      },
    }) as TrackItem
  const tracks = [
    row('snapped', 0.4),
    row('slightly', 11),
    row('badly', 208),
    row('gridless'),
    { id: 'loose', status: 'idle' } as TrackItem,
  ]
  const tolerance = (gridTolerance: number): FilterFacts => ({ ...NO_FACTS, gridTolerance })
  const off = (facts: FilterFacts) =>
    tracks
      .filter((t) => matchesFilter(t, { ...EMPTY_FILTER, attention: 'offGrid' }, facts))
      .map((t) => t.id)

  it('isolates the library tracks whose cues the DJ app would not fire on the beat, 10 ms out by default', () => {
    expect(off(NO_FACTS)).toEqual(['slightly', 'badly'])
    expect(qualityCounts(tracks).offGrid).toBe(2)
  })

  it('follows the tolerance chosen in the Cues tab, so a DJ who does not hear 11 ms can leave those out', () => {
    expect(off(tolerance(20))).toEqual(['badly'])
    expect(qualityCounts(tracks, tolerance(20)).offGrid).toBe(1)
    expect(off(tolerance(5))).toEqual(['slightly', 'badly'])
  })
})

describe('bad grid filter', () => {
  const tracks = ['shifted', 'drifting', 'fine', 'unmeasured'].map(
    (id) => ({ id, status: 'idle' }) as TrackItem,
  )
  const checks: Record<string, GridCheck | null> = {
    shifted: { hereMs: -92, endMs: -92, worstMs: 92, verdict: { kind: 'shifted', ms: -92 } },
    drifting: { hereMs: 0, endMs: 4, worstMs: 4, verdict: { kind: 'drifting', msPerMin: -7.5 } },
    fine: { hereMs: 3, endMs: 2, worstMs: 3, verdict: null },
  }
  const facts: FilterFacts = { ...NO_FACTS, gridCheck: (t) => checks[t.id] }

  it('isolates the tracks whose grid Surco measured off the beats, leaving out the ones not measured yet', () => {
    expect(
      tracks
        .filter((t) => matchesFilter(t, { ...EMPTY_FILTER, attention: 'badGrid' }, facts))
        .map((t) => t.id),
    ).toEqual(['shifted', 'drifting'])
    expect(qualityCounts(tracks, facts).badGrid).toBe(2)
  })

  it('counts none before anything is measured', () => {
    expect(qualityCounts(tracks).badGrid).toBe(0)
  })

  it('counts as bad grid exactly the tracks the batch would adjust', () => {
    const batch = ['large', 'drifts', 'within', 'gated'].map(
      (id) => ({ id, status: 'idle' }) as TrackItem,
    )
    const measured: Record<string, GridCheck | null> = {
      large: { hereMs: 102, endMs: 101, worstMs: 102, verdict: null },
      drifts: { hereMs: 1, endMs: 6, worstMs: 6, verdict: { kind: 'drifting', msPerMin: 4 } },
      within: { hereMs: 7, endMs: -6, worstMs: 7, verdict: null },
      gated: null,
    }
    const batchFacts: FilterFacts = { ...NO_FACTS, gridCheck: (t) => measured[t.id] }
    expect(qualityCounts(batch, batchFacts).badGrid).toBe(2)
    expect(qualityCounts(batch, { ...batchFacts, gridTolerance: 5 }).badGrid).toBe(3)
  })
})

describe('better than the library copy filter', () => {
  const tracks = ['upgrade', 'downgrade', 'same', 'undecided', 'unmeasured'].map(
    (id) => ({ id, status: 'idle', inLibrary: true }) as TrackItem,
  )
  const verdicts: Record<string, CopyVerdict | null> = {
    upgrade: { winner: 'a', reason: 'lossless' },
    downgrade: { winner: 'b', reason: 'cutoff' },
    same: { winner: 'same' },
    undecided: { winner: 'tie' },
  }
  const facts: FilterFacts = { ...NO_FACTS, libraryCopy: (t) => verdicts[t.id] }

  it('keeps only the files the measured comparison calls better than the copy already in the library, the ones worth swapping in', () => {
    expect(
      tracks
        .filter((t) => matchesFilter(t, { ...EMPTY_FILTER, library: 'betterThanLibrary' }, facts))
        .map((t) => t.id),
    ).toEqual(['upgrade'])
    expect(qualityCounts(tracks, facts).betterThanLibrary).toBe(1)
  })

  it('counts none before anything is measured, so an unmeasured pair is never offered as an upgrade', () => {
    expect(qualityCounts(tracks).betterThanLibrary).toBe(0)
  })
})

describe('unanalysed in a DJ library filter', () => {
  const preview = (extra: object) => ({
    title: '',
    artist: '',
    durationSec: 300,
    cues: [],
    ...extra,
  })
  const tracks = [
    {
      id: 'rb-analysed',
      programs: ['rekordbox'],
      sourcePreview: preview({ analysisPath: '/a.DAT' }),
    },
    { id: 'rb-bare', programs: ['rekordbox'], sourcePreview: preview({}) },
    { id: 'engine-bare', programs: ['engine'], sourcePreview: preview({ unanalysed: true }) },
    { id: 'engine-analysed', programs: ['engine'], sourcePreview: preview({}) },
    { id: 'loose-file' },
  ] as TrackItem[]

  // Cues set on a track the DJ program has not analysed wait for its beat grid, so these
  // are the tracks to open in that program first. The rule is the one the row's own
  // "not analysed" mark uses, so the filter and the mark never disagree.
  it('buckets the tracks each program has not analysed under that program', () => {
    expect(by(tracks, { attention: 'unanalysedRekordbox' }).map((x) => x.id)).toEqual(['rb-bare'])
    expect(by(tracks, { attention: 'unanalysedEngine' }).map((x) => x.id)).toEqual(['engine-bare'])
    const counts = qualityCounts(tracks)
    expect(counts.unanalysedRekordbox).toBe(1)
    expect(counts.unanalysedEngine).toBe(1)
  })
})

describe('tags filter', () => {
  const t = (
    id: string,
    over: Partial<TrackItem> = {},
    meta: Partial<TrackMetadata> = {},
  ): TrackItem =>
    ({
      id,
      status: 'idle',
      meta: { bpm: '128', key: '8A', ...meta },
      coverUrl: 'data:cover',
      embeddedCover: 'data:cover',
      embeddedCoverDims: { w: 1400, h: 1400 },
      ...over,
    }) as TrackItem
  const tracks = [
    t('complete'),
    t('bare', { coverUrl: undefined, embeddedCover: undefined, embeddedCoverDims: undefined }),
    t('library-art', {
      coverUrl: undefined,
      embeddedCover: undefined,
      embeddedCoverDims: undefined,
      sourcePreview: { title: '', artist: '', durationSec: 300, cues: [], coverUrl: 'thumb:1' },
    }),
    t('thumbnail', { embeddedCoverDims: { w: 300, h: 300 } }),
    t('thumbnail-replaced', { embeddedCoverDims: { w: 300, h: 300 }, coverUrl: 'https://big' }),
    t('no-tempo', {}, { bpm: ' ' }),
    t('no-key', {}, { key: '' }),
    t(
      'still-reading',
      { loadingMeta: true, coverUrl: undefined, embeddedCover: undefined },
      { bpm: '', key: '' },
    ),
  ]

  // The tag work a DJ notices on the player's screen: no artwork, artwork too soft for a
  // CDJ, or no tempo or key to mix by. Each is something matching a release fixes, so the
  // filter hands over exactly the rows that need it. A row still being read has no tags
  // yet and belongs to none of them.
  it('buckets the tracks whose artwork, tempo or key still needs work', () => {
    const ids = (tags: FilterSelection['tags']) => by(tracks, { tags }).map((x) => x.id)
    expect(ids('noCover')).toEqual(['bare'])
    expect(ids('smallCover')).toEqual(['thumbnail'])
    expect(ids('noBpm')).toEqual(['no-tempo'])
    expect(ids('noKey')).toEqual(['no-key'])
    expect(qualityCounts(tracks)).toMatchObject({ noCover: 1, smallCover: 1, noBpm: 1, noKey: 1 })
  })

  // A DJ program's row takes the light read, which leaves its file's art unread until the
  // row comes on screen: until then nobody knows whether it has a cover, and counting it as
  // coverless would hand the DJ thousands of rows to fix that have nothing wrong.
  it('leaves out a row whose file art is not read yet', () => {
    const unread = t('art-unread', {
      metaPartial: true,
      coverUrl: undefined,
      embeddedCover: undefined,
      embeddedCoverDims: undefined,
    })

    expect(by([...tracks, unread], { tags: 'noCover' }).map((x) => x.id)).toEqual(['bare'])
    expect(qualityCounts([...tracks, unread]).noCover).toBe(1)
  })
})

describe('filters that read what App knows about a row', () => {
  const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as TrackItem[]
  const facts: FilterFacts = {
    incomplete: (t) => t.id === 'a',
    unsaved: (t) => t.id !== 'a',
    gridTolerance: 10,
    gridCheck: () => undefined,
    libraryCopy: () => undefined,
    played: () => false,
    selected: () => false,
  }

  // Which fields are required is a setting, and unsaved cues live in the cue editor's
  // drafts, so neither is on the row. App answers both and the filter only asks: the
  // same rule that keeps Convert all off a track decides that it is missing fields.
  it('asks App which rows miss required fields and which hold changes not yet saved', () => {
    expect(
      tracks
        .filter((t) => matchesFilter(t, { ...EMPTY_FILTER, tags: 'missingRequired' }, facts))
        .map((t) => t.id),
    ).toEqual(['a'])
    expect(
      tracks
        .filter((t) => matchesFilter(t, { ...EMPTY_FILTER, conversion: 'unsaved' }, facts))
        .map((t) => t.id),
    ).toEqual(['b', 'c'])
    expect(qualityCounts(tracks, facts)).toMatchObject({ missingRequired: 1, unsaved: 2 })
  })

  it('keeps the rows App flags while the filter session lasts, like any other bucket', () => {
    const sticky = new Set<string>()
    const sel = { ...EMPTY_FILTER, conversion: 'unsaved' as const }
    expect(filterWithSticky(tracks, sel, sticky, facts).map((t) => t.id)).toEqual(['b', 'c'])
    expect(outsideFilter(tracks, sel, { ...facts, unsaved: () => false })).toEqual(
      new Set(['a', 'b', 'c']),
    )
  })
})

describe('filterSessionKey', () => {
  // The list keeps every row a filter has shown until the filter changes, and this key is
  // how it notices the change. Switching from silence to clipping kept the silence rows on
  // screen because the attention axis was missing from the hand-written list of axes.
  it('changes with every axis, so any new pick starts a fresh filter session', () => {
    const picks: Partial<FilterSelection>[] = [
      { quality: 'suspect' },
      { conversion: 'failed' },
      { library: 'inLibrary' },
      { duplicates: 'duplicates' },
      { attention: 'silence' },
      { attention: 'clipping' },
      { tags: 'noCover' },
      { tags: 'noBpm' },
      { tags: 'missingRequired' },
      { conversion: 'unsaved' },
      { format: 'WAV' },
    ]
    const keys = [EMPTY_FILTER, ...picks.map((p) => ({ ...EMPTY_FILTER, ...p }))].map(
      filterSessionKey,
    )
    expect(new Set(keys).size).toBe(keys.length)
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

  it('keeps an accepted suggestion in place under the review filter', () => {
    // Accepting the amber spark clears matchReview. Dropping the row at once slid the next
    // row's spark under the pointer, and a quick second click accepted a suggestion the
    // user never looked at.
    const r = (id: string, matchReview: boolean): TrackItem =>
      ({ id, status: 'idle', matchReview }) as TrackItem
    const sticky = new Set<string>()
    filterWithSticky([r('a', true), r('b', true)], sel({ conversion: 'matchReview' }), sticky)
    expect(
      filterWithSticky(
        [r('a', false), r('b', true)],
        sel({ conversion: 'matchReview' }),
        sticky,
      ).map((x) => x.id),
    ).toEqual(['a', 'b'])
  })

  it('keeps a shown row when a background analysis moves it out of a quality bucket', () => {
    // Analyses land on their own while the user works the 'unanalyzed' list; a row that
    // vanished mid-click took the click to whatever slid into its place.
    const q = (id: string, cutoffHz: number | null): TrackItem =>
      ({ id, status: 'idle', spectrum: { cutoffHz, sampleRateHz: 44100 } }) as TrackItem
    const sticky = new Set<string>()
    filterWithSticky([q('a', null)], sel({ quality: 'unanalyzed' }), sticky)
    expect(
      filterWithSticky([q('a', 21000)], sel({ quality: 'unanalyzed' }), sticky).map((x) => x.id),
    ).toEqual(['a'])
  })

  it('shows every track with no filter axis active', () => {
    const sticky = new Set<string>()
    expect(filterWithSticky([am('x', true), am('y', false)], EMPTY_FILTER, sticky)).toHaveLength(2)
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

  it('matches the genre and the label so a crate can be narrowed by either', () => {
    const track = t({ meta: { genre: 'Deep House', publisher: 'Defected Records' } })
    expect(matchesSearch(track, 'deep house')).toBe(true)
    expect(matchesSearch(track, 'defected')).toBe(true)
    expect(matchesSearch(track, 'techno')).toBe(false)
  })

  it('matches the artist, title and album tags so a crate can be searched by metadata', () => {
    const track = t({ meta: { artist: 'Floorplan', title: 'Never Grow Old', album: 'Paradise' } })
    expect(matchesSearch(track, 'floorplan')).toBe(true)
    expect(matchesSearch(track, 'grow')).toBe(true)
    expect(matchesSearch(track, 'paradise')).toBe(true)
  })

  // The search re-runs on every keystroke and every list change, over the whole crate. The
  // folding (an NFD pass and four regexes) is the cost, so a track's fields are folded once
  // for as long as the track is unchanged, and the query once per search, not once per row.
  it('folds an unchanged track once across searches, and the query once per search', () => {
    const tracks = [
      t({ listLabel: 'Back Now Yall', meta: { artist: 'MK' } }),
      t({ listLabel: 'Never Grow Old', meta: { artist: 'Floorplan' } }),
    ]
    tracks.filter(searchMatcher('now'))
    const fold = vi.spyOn(normalizeText, 'foldText')

    const found = tracks.filter(searchMatcher('floor'))

    expect(found).toEqual([tracks[1]])
    expect(fold).toHaveBeenCalledTimes(1)
    fold.mockRestore()
  })

  it('does not match a query that spans two fields', () => {
    expect(matchesSearch(t({ meta: { artist: 'Floor', title: 'Plan' } }), 'floor plan')).toBe(false)
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

  // An album dropped in file-name order is out of its running order, and the user wants to
  // read it as the record plays: disc first, then track, by number ("10" after "9", and a
  // "3/12" total never throws it off). Untagged tracks wait at the end.
  it('sorts by disc and track number in album order with the untagged tracks last', () => {
    const list = [
      mk({ id: '2-1', meta: { discNumber: '2', trackNumber: '1' } }),
      mk({ id: 'none' }),
      mk({ id: '1-10', meta: { discNumber: '1', trackNumber: '10/12' } }),
      mk({ id: '1-9', meta: { discNumber: '1', trackNumber: '9/12' } }),
    ]
    expect(sortTracks(list, 'trackNumber').map((t) => t.id)).toEqual(['1-9', '1-10', '2-1', 'none'])
    expect(sortTracks(list, 'trackNumber', 'desc').map((t) => t.id)).toEqual([
      '2-1',
      '1-10',
      '1-9',
      'none',
    ])
  })

  it('sorts by duration ascending with the unprobed tracks last', () => {
    const list = [
      mk({ id: 'long', duration: 400 }),
      mk({ id: 'none' }),
      mk({ id: 'short', duration: 120 }),
    ]
    expect(sortTracks(list, 'duration').map((t) => t.id)).toEqual(['short', 'long', 'none'])
  })

  it('sorts by BPM by value, so 98 comes before 128, with the untempoed tracks last in both directions', () => {
    const list = [
      mk({ id: '128', meta: { bpm: '128' } }),
      mk({ id: 'none' }),
      mk({ id: '98.5', meta: { bpm: '98.5' } }),
    ]
    expect(sortTracks(list, 'bpm').map((t) => t.id)).toEqual(['98.5', '128', 'none'])
    expect(sortTracks(list, 'bpm', 'desc').map((t) => t.id)).toEqual(['128', '98.5', 'none'])
  })

  it('sorts by year numerically, reading a full date as its year, with undated tracks last', () => {
    const list = [
      mk({ id: '2019', meta: { year: '2019-05-03' } }),
      mk({ id: 'none', meta: { year: '' } }),
      mk({ id: '1998', meta: { year: '1998' } }),
    ]
    expect(sortTracks(list, 'year').map((t) => t.id)).toEqual(['1998', '2019', 'none'])
    expect(sortTracks(list, 'year', 'desc').map((t) => t.id)).toEqual(['2019', '1998', 'none'])
  })

  it('sorts by key around the Camelot wheel in either notation, with unkeyed tracks last', () => {
    const list = [
      mk({ id: '10A', meta: { key: '10A' } }),
      mk({ id: 'none' }),
      mk({ id: '2B', meta: { key: '2B' } }),
      mk({ id: '2A', meta: { key: '02A' } }),
      mk({ id: '4B-as-Ab', meta: { key: 'Ab' } }),
      mk({ id: '8A-as-Am', meta: { key: 'Am' } }),
    ]
    expect(sortTracks(list, 'key').map((t) => t.id)).toEqual([
      '2A',
      '2B',
      '4B-as-Ab',
      '8A-as-Am',
      '10A',
      'none',
    ])
  })

  it('reads sharp and flat spellings of the same key as one wheel position', () => {
    const list = [
      mk({ id: 'Gb', meta: { key: 'Gb' } }),
      mk({ id: 'Abm', meta: { key: 'Abm' } }),
      mk({ id: 'D#m', meta: { key: 'D#m' } }),
    ]
    expect(sortTracks(list, 'key').map((t) => t.id)).toEqual(['Abm', 'D#m', 'Gb'])
  })

  it('keeps keys that are not on the wheel with the unkeyed tracks at the end', () => {
    const list = [mk({ id: 'odd', meta: { key: 'xyz' } }), mk({ id: '1A', meta: { key: '1A' } })]
    expect(sortTracks(list, 'key', 'desc').map((t) => t.id)).toEqual(['1A', 'odd'])
  })

  it('sorts by quality worst verdict first so the files to check surface, unanalyzed last in both directions', () => {
    const spec = (cutoffHz: number | null, over: Partial<SpectrumResult> = {}) =>
      ({ image: '', cutoffHz, sampleRateHz: 44100, processed: false, ...over }) as SpectrumResult
    const list = [
      mk({ id: 'good', spectrum: spec(21000) }),
      mk({ id: 'none' }),
      mk({ id: 'warn', spectrum: spec(18000) }),
      mk({ id: 'damaged', spectrum: spec(21000, { damaged: true }) }),
    ]
    expect(sortTracks(list, 'quality').map((t) => t.id)).toEqual([
      'damaged',
      'warn',
      'good',
      'none',
    ])
    expect(sortTracks(list, 'quality', 'desc').map((t) => t.id)).toEqual([
      'good',
      'warn',
      'damaged',
      'none',
    ])
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

describe('match-review filter', () => {
  const t = (id: string, matchReview?: boolean): TrackItem =>
    ({ id, status: 'idle', matchReview }) as TrackItem
  // The auto-match sweep marks the matches it would not apply unsupervised, and those
  // rows are the ONLY ones the user still has to act on. Without a bucket, finding the
  // 40 amber sparks scattered through a 300-track crate meant scrolling and eyeballing
  // colour — the axis already splits by provider for exactly this kind of review pass.
  const tracks = [t('needs-eyes', true), t('clean'), t('also-needs-eyes', true)]

  it('keeps only the matches the sweep left for review', () => {
    expect(by(tracks, { conversion: 'matchReview' }).map((x) => x.id)).toEqual([
      'needs-eyes',
      'also-needs-eyes',
    ])
  })

  it('tallies the tracks awaiting review for its filter badge', () => {
    expect(qualityCounts(tracks).matchReview).toBe(2)
  })
})

describe('failed filter', () => {
  const t = (id: string, status: TrackItem['status']): TrackItem => ({ id, status }) as TrackItem
  // After a 200-track batch the toolbar says "180 converted · 20 failed", and the only
  // per-row sign of a failure is a small red ring on the artwork. 'unconverted' can't
  // stand in: it means status !== 'done', which lumps the failures together with every
  // track that was never attempted.
  const tracks = [t('ok', 'done'), t('broke', 'error'), t('pending', 'idle'), t('broke2', 'error')]

  it('keeps only the tracks whose conversion failed', () => {
    expect(by(tracks, { conversion: 'failed' }).map((x) => x.id)).toEqual(['broke', 'broke2'])
  })

  it('does not confuse a failure with a track that was never converted', () => {
    expect(by(tracks, { conversion: 'unconverted' }).map((x) => x.id)).toEqual([
      'broke',
      'pending',
      'broke2',
    ])
  })

  it('tallies the failed tracks for its filter badge', () => {
    expect(qualityCounts(tracks).failed).toBe(2)
  })

  // A file Surco could not read or measure only ever showed up as a count in a notice
  // ("12 could not be analyzed"), which names none of them. They are failures to retry
  // just like a broken conversion, so they belong in the same bucket.
  it('also holds the tracks that could not be read or analysed', () => {
    const more = [
      ...tracks,
      { ...t('unreadable', 'idle'), metaReadFailed: true },
      { ...t('unmeasured', 'done'), analyzeFailed: true },
    ]
    expect(by(more, { conversion: 'failed' }).map((x) => x.id)).toEqual([
      'broke',
      'broke2',
      'unreadable',
      'unmeasured',
    ])
    expect(qualityCounts(more).failed).toBe(4)
  })
})

describe('mismatch filter', () => {
  const t = (id: string, status?: Verification['status']): TrackItem =>
    ({ id, status: 'done', verification: status && { status, checks: [] } }) as TrackItem
  // A batch of 40 ends "38 comprobadas · 2 no cuadran": the count has to lead to the two
  // rows, or the DJ scrolls the crate looking for an amber dot. A track still checking, one
  // waiting on a program to close, or one never re-read has nothing to fix yet.
  const tracks = [
    t('ok', 'ok'),
    t('bad', 'mismatch'),
    t('wait', 'pending'),
    t('busy', 'checking'),
    t('old'),
  ]

  it('the mismatch filter keeps only tracks whose verification is mismatch', () => {
    expect(by(tracks, { conversion: 'mismatch' }).map((x) => x.id)).toEqual(['bad'])
  })

  it('tallies the tracks that do not add up for its filter badge', () => {
    expect(qualityCounts(tracks).mismatch).toBe(1)
  })
})

describe('skipped filter', () => {
  const t = (id: string, skipReason?: string): TrackItem =>
    ({ id, status: 'idle', skipReason }) as TrackItem
  const tracks = [t('pending'), t('kept', 'kept existing'), t('cancelled', 'cancelled')]

  it('keeps only the tracks a run skipped, not every idle track that was never attempted', () => {
    expect(by(tracks, { conversion: 'skipped' }).map((x) => x.id)).toEqual(['kept', 'cancelled'])
    expect(qualityCounts(tracks).skipped).toBe(2)
  })
})

describe('match-provider filter', () => {
  const t = (id: string, matchProvider?: 'discogs' | 'bandcamp'): TrackItem =>
    ({ id, status: 'idle', matchProvider }) as TrackItem
  // Which catalog a match came from is worth filtering on its own: a Bandcamp match
  // carries no Discogs id or catalog number, so the user may want to eyeball exactly
  // those rows (or the Discogs ones) after a sweep over a mixed crate.
  const tracks = [t('dg', 'discogs'), t('bc', 'bandcamp'), t('none')]

  it('keeps only the tracks matched from the chosen catalog', () => {
    expect(by(tracks, { conversion: 'matchedDiscogs' }).map((x) => x.id)).toEqual(['dg'])
    expect(by(tracks, { conversion: 'matchedBandcamp' }).map((x) => x.id)).toEqual(['bc'])
  })

  it('tallies each provider for its filter badge', () => {
    expect(qualityCounts(tracks).matchedDiscogs).toBe(1)
    expect(qualityCounts(tracks).matchedBandcamp).toBe(1)
  })
})

describe('suspectTracks', () => {
  const t = (id: string, cutoffHz?: number | null, processed = false): TrackItem =>
    ({
      id,
      status: 'idle',
      spectrum: cutoffHz === undefined ? undefined : { cutoffHz, sampleRateHz: 44100, processed },
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

  it('leaves a damaged file out of the trash-the-fakes sweep, since a broken rip is not a fake and still needs a look, while a transcode is still swept', () => {
    const damaged = {
      id: 'damaged',
      status: 'idle',
      spectrum: { cutoffHz: 21000, sampleRateHz: 44100, processed: false, damaged: true },
    } as TrackItem
    const transcoded = {
      id: 'transcoded',
      status: 'idle',
      inputPath: '/x/fake.flac',
      spectrum: { cutoffHz: 16000, sampleRateHz: 44100, processed: false, hasKnee: true },
    } as TrackItem
    expect(suspectTracks([damaged, transcoded]).map((x) => x.id)).toEqual(['transcoded'])
    expect(by([damaged, transcoded], { quality: 'suspect' }).map((x) => x.id)).toEqual([
      'transcoded',
    ])
    expect(qualityCounts([damaged, transcoded]).suspect).toBe(1)
  })

  it('counts a damaged file in none of the suspect, good and unanalyzed buckets, so each of those badges matches what its filter shows', () => {
    const damaged = {
      id: 'damaged',
      status: 'idle',
      spectrum: { cutoffHz: 21000, sampleRateHz: 44100, processed: false, damaged: true },
    } as TrackItem
    const counts = qualityCounts([damaged])
    expect([counts.suspect, counts.good, counts.unanalyzed]).toEqual([0, 0, 0])
    expect(by([damaged], { quality: 'unanalyzed' })).toEqual([])
  })

  it('lists only the damaged files under the damaged filter so a broken rip can be found and replaced', () => {
    const damaged = {
      id: 'damaged',
      status: 'idle',
      spectrum: { cutoffHz: 21000, sampleRateHz: 44100, processed: false, damaged: true },
    } as TrackItem
    const transcoded = {
      id: 'transcoded',
      status: 'idle',
      inputPath: '/x/fake.flac',
      spectrum: { cutoffHz: 16000, sampleRateHz: 44100, processed: false, hasKnee: true },
    } as TrackItem
    const good = {
      id: 'good',
      status: 'idle',
      spectrum: { cutoffHz: 21000, sampleRateHz: 44100, processed: false },
    } as TrackItem
    const fresh = { id: 'fresh', status: 'idle' } as TrackItem
    const tracks = [damaged, transcoded, good, fresh]
    expect(by(tracks, { quality: 'damaged' }).map((x) => x.id)).toEqual(['damaged'])
    expect(qualityCounts(tracks).damaged).toBe(1)
  })

  it('returns nothing when no track has a suspect verdict, so the action stays disabled', () => {
    expect(suspectTracks([t('good', 21000), t('fresh')])).toEqual([])
  })
})

describe('outsideFilter', () => {
  // The rows filterWithSticky keeps on screen after their verdict flipped, so the list can
  // dim them; with no filter active nothing is ever outside it.
  it('names the shown rows that no longer match the live filter', () => {
    const r = (id: string, matchReview: boolean): TrackItem =>
      ({ id, status: 'idle', matchReview }) as TrackItem
    const rows = [r('a', false), r('b', true)]
    expect([...outsideFilter(rows, { ...EMPTY_FILTER, conversion: 'matchReview' })]).toEqual(['a'])
    expect(outsideFilter(rows, EMPTY_FILTER).size).toBe(0)
  })

  // The list redraws every row when this set is a new one; with nothing dimmed, an edit to
  // one row must not hand it a fresh empty set.
  it('hands back the same empty set whenever nothing is outside the filter', () => {
    const rows = [{ id: 'a', status: 'idle' } as TrackItem]
    expect(outsideFilter(rows, EMPTY_FILTER)).toBe(outsideFilter([...rows], EMPTY_FILTER))
  })
})

describe('holdOrder', () => {
  const r = (id: string, artist = ''): TrackItem => ({ id, meta: { artist } }) as TrackItem
  // The live objects in the shown order: the edit lands, the row does not move.
  it('keeps the shown order with the live rows', () => {
    const fresh = [r('b'), r('a', 'Zulu')]
    const held = holdOrder([r('a'), r('b')], fresh)
    expect(held.map((t) => t.id)).toEqual(['a', 'b'])
    expect(held[0]).toBe(fresh[1])
  })

  // A new or vanished row has no shown place to keep, so the fresh order wins.
  it('takes the fresh order when the set of rows changed', () => {
    const fresh = [r('c'), r('a'), r('b')]
    expect(holdOrder([r('a'), r('b')], fresh)).toBe(fresh)
    const swapped = [r('a'), r('c')]
    expect(holdOrder([r('a'), r('b')], swapped)).toBe(swapped)
  })
})

describe('facetCounts', () => {
  const t = (id: string, inputPath: string, cutoffHz: number | null): TrackItem =>
    ({ ...withSpectrum({ cutoffHz }), id, inputPath, status: 'idle' }) as TrackItem
  const tracks = [
    t('a', '/m/a.wav', 21000),
    t('b', '/m/b.wav', null),
    t('c', '/m/c.mp3', 21000),
    t('d', '/m/d.mp3', null),
    t('e', '/m/e.mp3', null),
  ]

  it('counts the whole crate while nothing is filtered', () => {
    const { tally, formats } = facetCounts(tracks, EMPTY_FILTER)
    expect(tally).toEqual(qualityCounts(tracks))
    expect(formats).toEqual({ MP3: 3, WAV: 2 })
  })

  it('counts every other section within the active filter, so a number says what picking it shows', () => {
    const { tally, formats } = facetCounts(tracks, { ...EMPTY_FILTER, quality: 'good' })
    expect(formats).toEqual({ MP3: 1, WAV: 1 })
    expect(tally.unconverted).toBe(2)
  })

  it('leaves the filtered section counted on its own, so its alternatives stay visible', () => {
    const { tally, formats } = facetCounts(tracks, { ...EMPTY_FILTER, format: 'WAV' })
    expect(formats).toEqual({ MP3: 3, WAV: 2 })
    expect(tally.good).toBe(1)
    expect(tally.unanalyzed).toBe(1)
  })

  // Every write of a big list recounts it on each render, and counting 8,000 rows twice
  // over (the whole crate for the filter bar, then the same crate again for each section
  // nothing else narrows) was most of a render while a first read landed. The counts must
  // stay the same; only the second walk goes.
  const spiedFacts = () => ({ ...NO_FACTS, unsaved: vi.fn(() => false) })

  it('takes the count of the whole crate it is handed instead of counting it again', () => {
    const facts = spiedFacts()
    const whole = qualityCounts(tracks, facts)
    facts.unsaved.mockClear()

    const counted = facetCounts(tracks, EMPTY_FILTER, facts, whole)

    expect(facts.unsaved).not.toHaveBeenCalled()
    expect(counted).toEqual(facetCounts(tracks, EMPTY_FILTER, spiedFacts()))
  })

  it('counts only the rows a filter narrows to, reusing the whole crate for the section it filters', () => {
    const facts = spiedFacts()
    const whole = qualityCounts(tracks, facts)
    facts.unsaved.mockClear()
    const sel = { ...EMPTY_FILTER, quality: 'good' as const }

    const counted = facetCounts(tracks, sel, facts, whole)

    expect(facts.unsaved).toHaveBeenCalledTimes(2)
    expect(counted).toEqual(facetCounts(tracks, sel, spiedFacts()))
  })

  it('combines every other active section when several are on', () => {
    const { tally, formats } = facetCounts(tracks, {
      ...EMPTY_FILTER,
      quality: 'unanalyzed',
      format: 'MP3',
    })
    expect(formats).toEqual({ MP3: 2, WAV: 1 })
    expect(tally.good).toBe(1)
    expect(tally.unanalyzed).toBe(2)
  })
})

describe('listened filter', () => {
  const tracks = ['heard', 'fresh'].map((id) => ({ id, status: 'idle' }) as TrackItem)
  const facts: FilterFacts = { ...NO_FACTS, played: (t) => t.id === 'heard' }

  // Going through 700 tracks over several days, what is left is the ones not heard yet.
  it('splits the tracks the user has listened to from the ones still to hear', () => {
    const ids = (listen: 'unplayed' | 'played') =>
      tracks.filter((t) => matchesFilter(t, { ...EMPTY_FILTER, listen }, facts)).map((t) => t.id)
    expect(ids('unplayed')).toEqual(['fresh'])
    expect(ids('played')).toEqual(['heard'])
    expect(qualityCounts(tracks, facts)).toMatchObject({ unplayed: 1, played: 1 })
  })

  it('counts each listen bucket within the other filters but not within its own', () => {
    const { tally } = facetCounts(tracks, { ...EMPTY_FILTER, listen: 'unplayed' }, facts)
    expect(tally).toMatchObject({ unplayed: 1, played: 1 })
  })
})

describe('selected filter', () => {
  const tracks = ['picked', 'other'].map((id) => ({ id, status: 'idle' }) as TrackItem)
  const facts: FilterFacts = { ...NO_FACTS, selected: (t) => t.id === 'picked' }

  // Two picked out of 718 to look at again before converting.
  it('keeps only the selected tracks', () => {
    expect(
      tracks
        .filter((t) => matchesFilter(t, { ...EMPTY_FILTER, selection: 'selected' }, facts))
        .map((t) => t.id),
    ).toEqual(['picked'])
  })
})

describe('stars filter and sort', () => {
  const rated = (id: string, rating: string, over: Partial<TrackItem> = {}) =>
    ({ id, status: 'idle', meta: { rating }, ...over }) as unknown as TrackItem
  const tracks = [
    rated('none', ''),
    rated('two', '2'),
    rated('three', '3'),
    rated('four', '4'),
    rated('five', '5'),
    rated('reading', '', { loadingMeta: true }),
  ]
  const ids = (stars: 'noStars' | 'stars3' | 'stars4' | 'stars5') =>
    tracks.filter((t) => matchesFilter(t, { ...EMPTY_FILTER, stars })).map((t) => t.id)

  // The stars are the DJ's own verdict on a track: the floor picks the ones worth a set, and
  // the unrated ones are what is still to judge. A row still being read has no rating yet.
  it('keeps the tracks at or above a number of stars, or the ones still unrated', () => {
    expect(ids('noStars')).toEqual(['none'])
    expect(ids('stars3')).toEqual(['three', 'four', 'five'])
    expect(ids('stars4')).toEqual(['four', 'five'])
    expect(ids('stars5')).toEqual(['five'])
    expect(qualityCounts(tracks)).toMatchObject({ noStars: 1, stars3: 3, stars4: 2, stars5: 1 })
  })

  // Sorting by stars puts the best first, the way a DJ reads a rating column; the unrated
  // stay at the end either way, like every other missing value.
  it('sorts by stars, most first, with the unrated last in both directions', () => {
    const order = (dir: 'asc' | 'desc') =>
      sortTracks(tracks.slice(0, 5), 'rating', dir).map((t) => t.id)
    expect(order('asc')).toEqual(['five', 'four', 'three', 'two', 'none'])
    expect(order('desc')).toEqual(['two', 'three', 'four', 'five', 'none'])
  })
})

// A filter is offered only on a tab whose tracks it can ever hold: cues and grids come from a
// DJ program, each program's unanalysed rows from that program, Music has no other library
// copy to be in, and Better than Music weighs files brought into Tracks.
describe('filters offered per tab', () => {
  it('keeps the cue and grid filters to the DJ program tabs', () => {
    for (const mode of ['noCues', 'offGrid', 'badGrid'] as const) {
      expect(attentionOffered(mode, 'rekordbox')).toBe(true)
      expect(attentionOffered(mode, 'serato')).toBe(true)
      expect(attentionOffered(mode, null)).toBe(false)
      expect(attentionOffered(mode, 'appleMusic')).toBe(false)
    }
    expect(attentionOffered('silence', null)).toBe(true)
    expect(attentionOffered('clipping', 'appleMusic')).toBe(true)
  })

  it('keeps each unanalysed filter to its own program', () => {
    expect(attentionOffered('unanalysedRekordbox', 'rekordbox')).toBe(true)
    expect(attentionOffered('unanalysedRekordbox', 'engine')).toBe(false)
    expect(attentionOffered('unanalysedEngine', 'engine')).toBe(true)
    expect(attentionOffered('unanalysedEngine', null)).toBe(false)
  })

  it('leaves the library filters out of Music and Better than Music to Tracks', () => {
    expect(libraryOffered('inLibrary', 'rekordbox')).toBe(true)
    expect(libraryOffered('notInLibrary', null)).toBe(true)
    expect(libraryOffered('inLibrary', 'appleMusic')).toBe(false)
    expect(libraryOffered('betterThanLibrary', null)).toBe(true)
    expect(libraryOffered('betterThanLibrary', 'rekordbox')).toBe(false)
  })

  // Left on across a switch, a filter the new tab does not offer would empty its list from
  // behind a menu that no longer lists it.
  it('drops on a switch the filters the new tab does not offer', () => {
    const sel = {
      ...EMPTY_FILTER,
      attention: 'offGrid',
      library: 'inLibrary',
      stars: 'stars4',
    } as const
    expect(fitFilterToTab(sel, null)).toEqual({ ...sel, attention: null })
    expect(fitFilterToTab(sel, 'appleMusic')).toEqual({ ...sel, attention: null, library: null })
    expect(fitFilterToTab(sel, 'traktor')).toBe(sel)
  })
})
