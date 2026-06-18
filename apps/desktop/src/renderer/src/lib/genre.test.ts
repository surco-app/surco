import { describe, expect, it } from 'vitest'
import type { Release } from '../../../shared/types'
import { genrePresets } from './genre'

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
