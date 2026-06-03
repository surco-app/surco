import { describe, expect, it } from 'vitest'
import type { DiscogsRelease, DiscogsTrack, TrackMetadata } from '../../../shared/types'
import {
  bestTrack,
  buildReleaseMeta,
  cleanName,
  coverOf,
  joinArtists,
  resultFromRelease,
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

describe('bestTrack', () => {
  const tracks: DiscogsTrack[] = [
    { position: 'A1', title: 'Windowlicker' },
    { position: 'A2', title: 'Windowlicker (Acid Edit)' },
    { position: 'B1', title: 'Nannou' },
  ]

  it('returns the exact title match over a partial one', () => {
    expect(bestTrack(tracks, 'Windowlicker')?.position).toBe('A1')
  })

  it('matches a longer parsed title to its containing tracklist entry', () => {
    expect(bestTrack(tracks, 'Windowlicker Acid Edit')?.position).toBe('A2')
  })

  it('falls back to word overlap when nothing contains the other', () => {
    expect(bestTrack(tracks, 'the nannou theme')?.position).toBe('B1')
  })

  it('returns undefined when the title is empty', () => {
    expect(bestTrack(tracks, '')).toBeUndefined()
  })

  it('returns undefined when no track shares a word', () => {
    expect(bestTrack(tracks, 'completely unrelated')).toBeUndefined()
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

  it('prefers the track artist, then the current artist, then the album artist', () => {
    const rel = release({ artists: [{ name: 'Album Artist' }] })
    expect(
      buildReleaseMeta(meta(), rel, { ...track, artists: [{ name: 'Remixer' }] }).meta.artist,
    ).toBe('Remixer')
    expect(buildReleaseMeta(meta({ artist: 'Existing' }), rel, track).meta.artist).toBe('Existing')
    expect(buildReleaseMeta(meta(), rel, track).meta.artist).toBe('Album Artist')
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
