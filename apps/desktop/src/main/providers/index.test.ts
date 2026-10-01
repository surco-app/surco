import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchProviderId } from '../../shared/types'

const {
  search,
  getRelease,
  getSettings,
  bcSearch,
  dzSearch,
  bpSearch,
  bpGetRelease,
  mbSearch,
  mbGetRelease,
} = vi.hoisted(() => ({
  search: vi.fn(),
  getRelease: vi.fn(),
  getSettings: vi.fn(
    (): {
      discogsToken: string
      discogsFormats: string[]
      searchIgnoreWords: string[]
      // Optional on purpose: an older settings.json predates the setting, and the seam
      // has to cope with it missing.
      discogsMaxResults?: number
      searchByAlbumFirst?: boolean
    } => ({
      discogsToken: 'tok',
      discogsFormats: [],
      searchIgnoreWords: [],
    }),
  ),
  bcSearch: vi.fn(),
  dzSearch: vi.fn(),
  bpSearch: vi.fn(),
  bpGetRelease: vi.fn(),
  mbSearch: vi.fn(),
  mbGetRelease: vi.fn(),
}))

vi.mock('../discogs', () => ({ search, getRelease }))
vi.mock('../bandcamp', () => ({ search: bcSearch, getRelease: vi.fn() }))
vi.mock('../deezer', () => ({ search: dzSearch, getRelease: vi.fn() }))
vi.mock('../beatport', () => ({ search: bpSearch, getRelease: bpGetRelease }))
vi.mock('../musicbrainz', () => ({ search: mbSearch, getRelease: mbGetRelease }))
vi.mock('../settings', () => ({ getSettings }))

import { DEFAULT_PROVIDER, getProvider } from './index'

afterEach(() => vi.clearAllMocks())

describe('getProvider', () => {
  it("beatport releases reach the renderer with the key already in the user's notation", async () => {
    getSettings.mockReturnValueOnce({ ...getSettings(), keyNotation: 'musical' } as never)
    bpGetRelease.mockResolvedValue({ tracklist: [{ title: 'x', position: '1', key: 'Eb Minor' }] })
    const rel = await getProvider('beatport').getRelease(1)
    expect(rel.tracklist[0].key).toBe('Ebm')
  })

  it('routes Beatport searches to its client with the cleaned query and hints', async () => {
    bpSearch.mockResolvedValue([{ id: 7 }])
    const hints = { artist: 'ROSALÍA', title: 'DESPECHÁ' }
    const out = await getProvider('beatport').search('ROSALÍA DESPECHÁ', 'high', hints)
    expect(bpSearch).toHaveBeenCalledWith('ROSALÍA DESPECHÁ', 'high', hints)
    expect(out).toEqual([{ id: 7 }])
  })

  it('sends the query with composed accents, since Beatport misses "Rosalía" typed decomposed', async () => {
    search.mockResolvedValue([])
    await getProvider('discogs').search('Rosalía Despechá'.normalize('NFD'), 'high', {
      artist: 'Rosalía'.normalize('NFD'),
      title: 'Despechá'.normalize('NFD'),
    })
    expect(search).toHaveBeenCalledWith(
      'Rosalía Despechá',
      'tok',
      'high',
      { artist: 'Rosalía', title: 'Despechá' },
      [],
      0,
    )
  })

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
    expect(search).toHaveBeenCalledWith('rank 1 airwave', 'tok', 'high', hints, [], 0)
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
    expect(search).toHaveBeenCalledWith('only vinyl', 'tok', 'high', undefined, ['Vinyl'], 0)
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
      0,
    )
  })

  // The page the client fetches has to cover the list the panel will show, so the seam
  // forwards how many results Settings displays alongside the token and formats.
  it('forwards the shown-results setting to the Discogs client', async () => {
    getSettings.mockReturnValueOnce({
      discogsToken: 'tok',
      discogsFormats: [] as string[],
      searchIgnoreWords: [] as string[],
      discogsMaxResults: 50,
    })
    search.mockResolvedValue([])
    await getProvider('discogs').search('fifty please', 'high')
    expect(search).toHaveBeenCalledWith('fifty please', 'tok', 'high', undefined, [], 50)
  })

  // The renderer always sends the tagged album; the setting decides here whether any
  // provider sees it. Off (the default, and any settings.json that predates it) must
  // leave every request exactly as it was before the setting existed.
  it('drops the album hint for every provider while album-first search is off', async () => {
    search.mockResolvedValue([])
    bcSearch.mockResolvedValue([])
    const hints = { artist: 'Moby', title: 'Porcelain', album: 'Play' }
    await getProvider('discogs').search('moby porcelain', 'high', hints)
    await getProvider('bandcamp').search('moby porcelain', 'high', hints)
    expect(search.mock.calls[0][3]).not.toHaveProperty('album')
    expect(bcSearch.mock.calls[0][2]).not.toHaveProperty('album')
  })

  it('hands the album over, cleaned like the title, when album-first search is on', async () => {
    getSettings.mockReturnValueOnce({
      discogsToken: 'tok',
      discogsFormats: [],
      searchIgnoreWords: ['vinyl'],
      searchByAlbumFirst: true,
    })
    dzSearch.mockResolvedValue([])
    await getProvider('deezer').search('moby porcelain', 'high', {
      artist: 'Moby',
      title: 'Porcelain',
      album: 'Play vinyl',
    })
    expect(dzSearch.mock.calls[0][2]).toEqual({ artist: 'Moby', title: 'Porcelain', album: 'Play' })
  })

  it('hands the album to MusicBrainz only when album-first search is on', async () => {
    mbSearch.mockResolvedValue([])
    const hints = { artist: 'Moby', title: 'Porcelain', album: 'Play' }
    await getProvider('musicbrainz').search('moby porcelain', 'high', hints)
    expect(mbSearch.mock.calls[0][2]).not.toHaveProperty('album')
    getSettings.mockReturnValueOnce({
      discogsToken: 'tok',
      discogsFormats: [],
      searchIgnoreWords: [],
      searchByAlbumFirst: true,
    })
    await getProvider('musicbrainz').search('moby porcelain', 'high', hints)
    expect(mbSearch.mock.calls[1][2]).toEqual(hints)
  })

  // A single's album tag repeats its title, and an untagged album is blank: neither names
  // anything the track search does not already try, so neither may jump ahead of it.
  it.each([
    ['repeats the title', 'porcelain'],
    ['is blank', '  '],
  ])('drops an album that %s even when album-first search is on', async (_why, album) => {
    getSettings.mockReturnValueOnce({
      discogsToken: 'tok',
      discogsFormats: [],
      searchIgnoreWords: [],
      searchByAlbumFirst: true,
    })
    search.mockResolvedValue([])
    await getProvider('discogs').search('moby porcelain', 'high', {
      artist: 'Moby',
      title: 'Porcelain',
      album,
    })
    expect(search.mock.calls[0][3]).not.toHaveProperty('album')
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

  it('strips the saved ignore words for MusicBrainz too', async () => {
    getSettings.mockReturnValueOnce({
      discogsToken: 'tok',
      discogsFormats: [] as string[],
      searchIgnoreWords: ['rip djotas good'],
    })
    mbSearch.mockResolvedValue([])
    await getProvider('musicbrainz').search('Song rip djotas good', 'low', {
      title: 'Song rip djotas good',
    })
    expect(mbSearch).toHaveBeenCalledWith('Song', 'low', { title: 'Song' }, [])
  })

  // One format filter for every source that knows a release's medium: a user who only
  // buys vinyl wants MusicBrainz trimmed the same way as Discogs, not a second setting.
  it('forwards the saved format filter to MusicBrainz too', async () => {
    getSettings.mockReturnValueOnce({
      discogsToken: 'tok',
      discogsFormats: ['Vinyl', 'Cassette'],
      searchIgnoreWords: [],
    })
    mbSearch.mockResolvedValue([])
    await getProvider('musicbrainz').search('only vinyl', 'high')
    expect(mbSearch).toHaveBeenCalledWith('only vinyl', 'high', undefined, ['Vinyl', 'Cassette'])
  })

  // A MusicBrainz release is a UUID carried in the row's page URL; the seam must hand
  // that string through untouched, not coerce it to the numeric id.
  it('forwards the MusicBrainz release page URL to its client', async () => {
    mbGetRelease.mockResolvedValue({ id: 1 })
    const url = 'https://musicbrainz.org/release/4a27f230-ab38-4fae-8dd7-c5032fd4a4ee'
    await getProvider('musicbrainz').getRelease(url, 'low')
    expect(mbGetRelease).toHaveBeenCalledWith(url, 'low')
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
