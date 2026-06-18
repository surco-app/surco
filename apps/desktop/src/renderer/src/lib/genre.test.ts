import { describe, expect, it } from 'vitest'
import type { Release } from '../../../shared/types'
import { genreChips, genrePresets } from './genre'

function release(patch: Partial<Release>): Release {
  return { provider: 'discogs', id: 1, title: '', artists: [], tracklist: [], ...patch }
}

describe('genrePresets', () => {
  it('offers the broad genres and styles Discogs returns, not a fixed guess', () => {
    const r = release({ genres: ['Electronic'], styles: ['House', 'Techno'] })
    expect(genrePresets(r)).toEqual(['Electronic', 'House', 'Techno'])
  })

  it('de-dupes so a value present in both genres and styles appears once', () => {
    const r = release({ genres: ['Electronic'], styles: ['Electronic', 'House'] })
    expect(genrePresets(r)).toEqual(['Electronic', 'House'])
  })

  it('returns nothing when no release is loaded, so no stale chips show', () => {
    expect(genrePresets(null)).toEqual([])
  })

  it('handles a release missing genres or styles', () => {
    expect(genrePresets(release({ styles: ['Trance'] }))).toEqual(['Trance'])
    expect(genrePresets(release({ genres: ['Rock'] }))).toEqual(['Rock'])
    expect(genrePresets(release({}))).toEqual([])
  })
})

describe('genreChips', () => {
  // The reported case: the user's preset "Electronic" and a provider's "electronic" are the
  // same genre — show one pill, in the user's casing (their list comes first).
  it('de-dupes the user preset and a provider genre that differ only in case', () => {
    const r = release({ genres: ['electronic'], styles: ['hardhouse'] })
    expect(genreChips(['Electronic'], r)).toEqual(['Electronic', 'hardhouse'])
  })

  it('keeps the user presets first, then the release genres', () => {
    const r = release({ genres: ['Techno'] })
    expect(genreChips(['House'], r)).toEqual(['House', 'Techno'])
  })

  it('works with no release (just the user presets)', () => {
    expect(genreChips(['House', 'Trance'], null)).toEqual(['House', 'Trance'])
  })
})
