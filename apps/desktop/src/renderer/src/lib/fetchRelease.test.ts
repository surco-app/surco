// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchResult } from '../../../shared/types'
import { fetchRelease } from './fetchRelease'

function setApi(getRelease: ReturnType<typeof vi.fn>): void {
  ;(window as unknown as { api: unknown }).api = { getRelease }
}

afterEach(() => vi.restoreAllMocks())

const base = { provider: 'discogs', title: 'A Release' } as const

describe('fetchRelease', () => {
  // Bandcamp's parsed release id can differ from the row's autocomplete id, so a result
  // that carries a page URL must be re-fetched by that URL — using the id would load the
  // wrong (or no) release.
  it('addresses a result by its page URL when it has one', async () => {
    const getRelease = vi.fn().mockResolvedValue({})
    setApi(getRelease)
    const result = { ...base, id: 7, releaseUrl: 'https://x.bandcamp.com/album/y' } as SearchResult
    await fetchRelease(result, 'low')
    expect(getRelease).toHaveBeenCalledWith('https://x.bandcamp.com/album/y', 'discogs', 'low')
  })

  // Discogs results have no URL; they are id-addressable, so the id is the fallback.
  it('falls back to the id when there is no URL, carrying the priority through', async () => {
    const getRelease = vi.fn().mockResolvedValue({})
    setApi(getRelease)
    const result = { ...base, id: 42 } as SearchResult
    await fetchRelease(result, 'high')
    expect(getRelease).toHaveBeenCalledWith(42, 'discogs', 'high')
  })
})
