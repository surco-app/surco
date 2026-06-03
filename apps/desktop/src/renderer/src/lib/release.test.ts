import { describe, expect, it } from 'vitest'
import type { DiscogsRelease, DiscogsTrack } from '../../../shared/types'
import { bestTrack, cleanName, coverOf, joinArtists, resultFromRelease } from './release'

function release(over: Partial<DiscogsRelease> = {}): DiscogsRelease {
  return { id: 1, title: 'Album', artists: [], tracklist: [], ...over }
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
