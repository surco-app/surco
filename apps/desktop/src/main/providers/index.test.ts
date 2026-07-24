import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchProviderId } from '../../shared/types'

const { search, getRelease, getSettings, bcSearch, dzSearch } = vi.hoisted(() => ({
  search: vi.fn(),
  getRelease: vi.fn(),
  getSettings: vi.fn(() => ({
    discogsToken: 'tok',
    discogsFormats: [] as string[],
    searchIgnoreWords: [] as string[],
  })),
  bcSearch: vi.fn(),
  dzSearch: vi.fn(),
}))

vi.mock('../discogs', () => ({ search, getRelease }))
vi.mock('../bandcamp', () => ({ search: bcSearch, getRelease: vi.fn() }))
vi.mock('../deezer', () => ({ search: dzSearch, getRelease: vi.fn() }))
vi.mock('../settings', () => ({ getSettings }))

import { DEFAULT_PROVIDER, getProvider } from './index'

afterEach(() => vi.clearAllMocks())

describe('getProvider', () => {
  it('defaults to Discogs when no provider id is given', () => {
    expect(DEFAULT_PROVIDER).toBe('discogs')
    expect(getProvider()).toBe(getProvider('discogs'))
  })

  // The provider owns its own credentials so the IPC layer stays provider-agnostic
  // and never has to know Discogs needs a token while a future provider may not. The
  // search strategy and pacing now live in the Discogs client; the seam only forwards.
  it('forwards search to the Discogs client with the saved token, priority and hints', async () => {
    search.mockResolvedValue([{ id: 1 }])
    const hints = { title: 'Airwave', catalogNumber: 'ANJ001' }
    const out = await getProvider('discogs').search('rank 1 airwave', 'high', hints)
    expect(search).toHaveBeenCalledWith('rank 1 airwave', 'tok', 'high', hints, [])
    expect(out).toEqual([{ id: 1 }])
  })

  // The saved format filter rides along to the client so search can restrict results
  // to the user's chosen release formats (e.g. only vinyl).
  it('forwards the saved Discogs format filter to the client', async () => {
    getSettings.mockReturnValueOnce({
      discogsToken: 'tok',
      discogsFormats: ['Vinyl'],
      searchIgnoreWords: [],
    })
    search.mockResolvedValue([])
    await getProvider('discogs').search('only vinyl', 'high')
    expect(search).toHaveBeenCalledWith('only vinyl', 'tok', 'high', undefined, ['Vinyl'])
  })

  // A rip-crew stamp in the query/hints ("rip djotas good") sinks every search shape —
  // no release carries those words. This seam is the one place every search crosses, so
  // stripping the user's listed phrases here cleans the sweep, the editor and every
  // provider at once.
  it('strips the saved ignore words from the query and hints', async () => {
    getSettings.mockReturnValueOnce({
      discogsToken: 'tok',
      discogsFormats: [] as string[],
      searchIgnoreWords: ['rip djotas good'],
    })
    search.mockResolvedValue([])
    await getProvider('discogs').search('Sueño Latino rip djotas good', 'high', {
      title: 'Sueño Latino rip djotas good',
      artist: 'Latino Project',
    })
    expect(search).toHaveBeenCalledWith(
      'Sueño Latino',
      'tok',
      'high',
      { title: 'Sueño Latino', artist: 'Latino Project' },
      [],
    )
  })

  it('strips the saved ignore words for Bandcamp too', async () => {
    getSettings.mockReturnValueOnce({
      discogsToken: 'tok',
      discogsFormats: [] as string[],
      searchIgnoreWords: ['rip djotas good'],
    })
    bcSearch.mockResolvedValue([])
    await getProvider('bandcamp').search('Song rip djotas good', 'low', {
      title: 'Song rip djotas good',
    })
    expect(bcSearch).toHaveBeenCalledWith('Song', 'low', { title: 'Song' })
  })

  it('strips the saved ignore words for Deezer too', async () => {
    getSettings.mockReturnValueOnce({
      discogsToken: 'tok',
      discogsFormats: [] as string[],
      searchIgnoreWords: ['rip djotas good'],
    })
    dzSearch.mockResolvedValue([])
    await getProvider('deezer').search('Song rip djotas good', 'low', {
      title: 'Song rip djotas good',
    })
    expect(dzSearch).toHaveBeenCalledWith('Song', 'low', { title: 'Song' })
  })

  it('forwards getRelease to the Discogs client with the saved token and priority', async () => {
    getRelease.mockResolvedValue({ id: 5 })
    await getProvider('discogs').getRelease(5, 'low')
    expect(getRelease).toHaveBeenCalledWith(5, 'tok', 'low')
  })

  // The provider id arrives over IPC from the renderer, so an unknown value must
  // resolve to a working provider instead of crashing the search handler.
  it('falls back to the default provider for an unknown id', () => {
    expect(getProvider('spotify' as SearchProviderId)).toBe(getProvider(DEFAULT_PROVIDER))
  })
})
