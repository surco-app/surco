import { describe, expect, it } from 'vitest'
import type { DiscogsRelease, DiscogsTrack, TrackMetadata } from '../../../shared/types'
import {
  bestMatch,
  buildReleaseMeta,
  cleanName,
  confidenceTier,
  coverOf,
  joinArtists,
  resultFromRelease,
  scoreTrack,
} from './release'

function release(over: Partial<DiscogsRelease> = {}): DiscogsRelease {
  return { id: 1, title: 'Album', artists: [], tracklist: [], ...over }
}

function meta(over: Partial<TrackMetadata> = {}): TrackMetadata {
  return {
    title: '',
    artist: '',
    album: '',
    albumArtist: '',
    year: '',
    genre: '',
    grouping: '',
    comment: '',
    trackNumber: '',
    discNumber: '',
    bpm: '',
    key: '',
    publisher: '',
    catalogNumber: '',
    remixArtist: '',
    ...over,
  }
}

describe('cleanName', () => {
  // Discogs disambiguates same-named artists with a trailing "(2)"; that suffix
  // is noise in a tag, so it gets stripped.
  it('strips a trailing disambiguation number', () => {
    expect(cleanName('Aphex Twin (2)')).toBe('Aphex Twin')
  })

  it('leaves a plain name untouched', () => {
    expect(cleanName('Aphex Twin')).toBe('Aphex Twin')
  })

  it('only strips a trailing numeric suffix, not other parentheses', () => {
    expect(cleanName('Orbital (UK)')).toBe('Orbital (UK)')
  })
})

describe('joinArtists', () => {
  it('cleans and comma-joins every artist', () => {
    expect(joinArtists([{ name: 'A (2)' }, { name: 'B' }])).toBe('A, B')
  })

  it('returns an empty string when there are no artists', () => {
    expect(joinArtists(undefined)).toBe('')
    expect(joinArtists([])).toBe('')
  })
})

describe('coverOf', () => {
  it('prefers the primary image', () => {
    const rel = release({
      images: [
        { uri: 'secondary.jpg', type: 'secondary', resource_url: '' },
        { uri: 'primary.jpg', type: 'primary', resource_url: '' },
      ],
    })
    expect(coverOf(rel)).toBe('primary.jpg')
  })

  it('falls back to the first image when none is primary', () => {
    const rel = release({
      images: [{ uri: 'first.jpg', type: 'secondary', resource_url: '' }],
    })
    expect(coverOf(rel)).toBe('first.jpg')
  })

  it('falls back to the provided fallback when there are no images', () => {
    expect(coverOf(release(), 'thumb.jpg')).toBe('thumb.jpg')
  })

  it('returns undefined with no images and no fallback', () => {
    expect(coverOf(release())).toBeUndefined()
  })
})

describe('resultFromRelease', () => {
  it('prefixes the album artist when present', () => {
    const rel = release({ artists: [{ name: 'Daft Punk' }], title: 'Discovery', year: 2001 })
    const r = resultFromRelease(rel)
    expect(r.title).toBe('Daft Punk - Discovery')
    expect(r.year).toBe('2001')
  })

  it('uses the bare title when there is no album artist', () => {
    expect(resultFromRelease(release({ title: 'Untitled' })).title).toBe('Untitled')
  })

  it('omits the year when the release has none', () => {
    expect(resultFromRelease(release()).year).toBeUndefined()
  })

  it('maps label names', () => {
    const rel = release({ labels: [{ name: 'Warp', catno: 'WARP1' }] })
    expect(resultFromRelease(rel).label).toEqual(['Warp'])
  })
})

describe('scoreTrack', () => {
  it('scores an exact title match as fully confident when nothing else is known', () => {
    expect(scoreTrack({ position: 'A1', title: 'Nannou' }, { title: 'Nannou' })).toBe(1)
  })

  it('drops confidence for a partial title match', () => {
    const s = scoreTrack({ position: 'B1', title: 'Nannou' }, { title: 'the nannou theme' })
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })

  it('scores a track that shares no signal as zero', () => {
    expect(scoreTrack({ position: 'A1', title: 'Windowlicker' }, { title: 'unrelated' })).toBe(0)
  })

  it('rewards a duration within a couple of seconds and rejects a far one', () => {
    // The title is blank so duration alone decides — a release's track length vs
    // the file's probed seconds is the strongest within-release discriminator.
    const close = scoreTrack(
      { position: 'A1', title: '', duration: '3:00' },
      { title: '', durationSec: 178 },
    )
    const far = scoreTrack(
      { position: 'A1', title: '', duration: '3:00' },
      { title: '', durationSec: 240 },
    )
    expect(close).toBe(1)
    expect(far).toBe(0)
  })

  it('lets duration separate two identically titled mixes', () => {
    const target = { title: 'Acid', durationSec: 358 }
    const slow = scoreTrack({ position: 'A1', title: 'Acid', duration: '3:00' }, target)
    const fast = scoreTrack({ position: 'A2', title: 'Acid', duration: '5:58' }, target)
    expect(fast).toBeGreaterThan(slow)
  })

  it('matches on track position when the file carries a track number', () => {
    const target = { title: 'Acid', trackNumber: '2' }
    const right = scoreTrack({ position: '2', title: 'Acid' }, target)
    const wrong = scoreTrack({ position: '1', title: 'Acid' }, target)
    expect(right).toBeGreaterThan(wrong)
  })

  it('matches a per-track artist on a compilation', () => {
    const target = { title: 'Track', artist: 'Daft Punk' }
    const mine = scoreTrack(
      { position: '1', title: 'Track', artists: [{ name: 'Daft Punk' }] },
      target,
    )
    const other = scoreTrack(
      { position: '2', title: 'Track', artists: [{ name: 'Justice' }] },
      target,
    )
    expect(mine).toBeGreaterThan(other)
  })
})

describe('bestMatch', () => {
  const tracks: DiscogsTrack[] = [
    { position: 'A1', title: 'Windowlicker' },
    { position: 'A2', title: 'Windowlicker (Acid Edit)' },
    { position: 'B1', title: 'Nannou' },
  ]

  it('returns the exact title match over a partial one', () => {
    expect(bestMatch(tracks, { title: 'Windowlicker' })?.track.position).toBe('A1')
  })

  it('matches a longer parsed title to its containing tracklist entry', () => {
    expect(bestMatch(tracks, { title: 'Windowlicker Acid Edit' })?.track.position).toBe('A2')
  })

  it('falls back to a partial title match when nothing matches exactly', () => {
    expect(bestMatch(tracks, { title: 'the nannou theme' })?.track.position).toBe('B1')
  })

  it('returns undefined when the title is empty and nothing else is known', () => {
    expect(bestMatch(tracks, { title: '' })).toBeUndefined()
  })

  it('returns undefined when no track shares any signal', () => {
    expect(bestMatch(tracks, { title: 'completely unrelated' })).toBeUndefined()
  })

  it('uses duration to pick the right mix when the titles tie', () => {
    const mixes: DiscogsTrack[] = [
      { position: 'A1', title: 'Acid', duration: '3:00' },
      { position: 'A2', title: 'Acid', duration: '5:58' },
    ]
    expect(bestMatch(mixes, { title: 'Acid', durationSec: 358 })?.track.position).toBe('A2')
  })

  it('reports the winner confidence between 0 and 1', () => {
    expect(bestMatch(tracks, { title: 'Windowlicker' })?.confidence).toBe(1)
  })
})

describe('confidenceTier', () => {
  // The thresholds an auto-match would act on: high enough to apply unattended,
  // a middle band worth flagging for a glance, and below that, leave it manual.
  it('calls a near-certain match high', () => {
    expect(confidenceTier(1)).toBe('high')
    expect(confidenceTier(0.85)).toBe('high')
  })

  it('flags a middling match for review', () => {
    expect(confidenceTier(0.84)).toBe('review')
    expect(confidenceTier(0.6)).toBe('review')
  })

  it('calls a weak match low', () => {
    expect(confidenceTier(0.59)).toBe('low')
    expect(confidenceTier(0)).toBe('low')
  })
})

describe('buildReleaseMeta', () => {
  const track: DiscogsTrack = { position: 'A1', title: 'Track One' }

  it('overwrites album-level data and clears the cover path', () => {
    const rel = release({
      title: 'Homework',
      artists: [{ name: 'Daft Punk' }],
      year: 1997,
      images: [{ uri: 'cover.jpg', type: 'primary', resource_url: '' }],
    })
    const patch = buildReleaseMeta(meta(), rel, undefined)
    expect(patch.meta.album).toBe('Homework')
    expect(patch.meta.albumArtist).toBe('Daft Punk')
    expect(patch.meta.year).toBe('1997')
    expect(patch.coverUrl).toBe('cover.jpg')
    expect(patch.coverPath).toBeUndefined()
  })

  it('prefers a style over a genre, and falls back to a genre with no style', () => {
    const styled = buildReleaseMeta(
      meta(),
      release({ genres: ['Electronic'], styles: ['House'] }),
      undefined,
    )
    expect(styled.meta.genre).toBe('House')
    const genred = buildReleaseMeta(meta(), release({ genres: ['Electronic'] }), undefined)
    expect(genred.meta.genre).toBe('Electronic')
  })

  it('takes title, track number and disc from the chosen track', () => {
    const patch = buildReleaseMeta(meta(), release(), { position: '2-3', title: 'Mix' })
    expect(patch.meta.title).toBe('Mix')
    expect(patch.meta.discNumber).toBe('2')
    expect(patch.meta.trackNumber).toBe('3')
  })

  it('keeps the current title and numbers when no track is chosen', () => {
    const patch = buildReleaseMeta(
      meta({ title: 'Kept', trackNumber: '7', discNumber: '1' }),
      release(),
      undefined,
    )
    expect(patch.meta.title).toBe('Kept')
    expect(patch.meta.trackNumber).toBe('7')
    expect(patch.meta.discNumber).toBe('1')
  })

  it('prefers the track artist, then the album artist, then the current value', () => {
    const rel = release({ artists: [{ name: 'Album Artist' }] })
    // A track that carries its own artist (compilations) wins.
    expect(
      buildReleaseMeta(meta(), rel, { ...track, artists: [{ name: 'Remixer' }] }).meta.artist,
    ).toBe('Remixer')
    // With no per-track artist, the release artist overwrites a wrong existing value — the
    // artist applies from Discogs like album/year/genre, not kept just because it was set.
    expect(buildReleaseMeta(meta({ artist: 'Existing' }), rel, track).meta.artist).toBe(
      'Album Artist',
    )
    // Only when Discogs carries no artist at all does the current value stand.
    expect(
      buildReleaseMeta(meta({ artist: 'Existing' }), release({ artists: [] }), track).meta.artist,
    ).toBe('Existing')
  })

  it('uses the label catalog number but discards a literal "none"', () => {
    const real = release({ labels: [{ name: 'Warp', catno: 'WARP20' }] })
    expect(buildReleaseMeta(meta(), real, undefined).meta.catalogNumber).toBe('WARP20')
    expect(buildReleaseMeta(meta(), real, undefined).meta.publisher).toBe('Warp')
    const none = release({ labels: [{ name: 'Self-Released', catno: 'none' }] })
    expect(
      buildReleaseMeta(meta({ catalogNumber: 'OLD' }), none, undefined).meta.catalogNumber,
    ).toBe('OLD')
  })

  it('leaves fields the release does not carry untouched', () => {
    const patch = buildReleaseMeta(
      meta({ bpm: '128', key: '8A', comment: 'note' }),
      release(),
      undefined,
    )
    expect(patch.meta.bpm).toBe('128')
    expect(patch.meta.key).toBe('8A')
    expect(patch.meta.comment).toBe('note')
  })
})
