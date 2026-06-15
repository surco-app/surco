import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchProviderId } from '../../shared/types'

const { search, getRelease, hasCachedSearch, hasCachedRelease, getSettings } = vi.hoisted(() => ({
  search: vi.fn(),
  getRelease: vi.fn(),
  // Report nothing cached so the provider takes a rate-limiter token and calls the client.
  hasCachedSearch: vi.fn(() => false),
  hasCachedRelease: vi.fn(() => false),
  getSettings: vi.fn(() => ({ discogsToken: 'tok' })),
}))

vi.mock('../discogs', () => ({ search, getRelease, hasCachedSearch, hasCachedRelease }))
vi.mock('../settings', () => ({ getSettings }))

import { DEFAULT_PROVIDER, getProvider } from './index'

afterEach(() => vi.clearAllMocks())

describe('getProvider', () => {
  it('defaults to Discogs when no provider id is given', () => {
    expect(DEFAULT_PROVIDER).toBe('discogs')
    expect(getProvider()).toBe(getProvider('discogs'))
  })

  // The provider owns its own credentials so the IPC layer stays provider-agnostic
  // and never has to know Discogs needs a token while a future provider may not.
  it('routes search through the Discogs client with the saved token', async () => {
    search.mockResolvedValue([{ id: 1 }])
    const out = await getProvider('discogs').search('aphex twin')
    expect(search).toHaveBeenCalledWith('aphex twin', 'tok')
    expect(out).toEqual([{ id: 1 }])
  })

  // The first candidate keeps the mix name; when Discogs returns nothing for it the
  // provider retries the parenthetical-stripped query, which is what finds the release.
  it('falls back to a cleaned candidate when the fuller query finds nothing', async () => {
    search.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 9 }])
    const out = await getProvider('discogs').search('Rank 1 Airwave (Original Mix)')
    expect(search).toHaveBeenNthCalledWith(1, 'Rank 1 Airwave (Original Mix)', 'tok')
    expect(search).toHaveBeenNthCalledWith(2, 'Rank 1 Airwave', 'tok')
    expect(out).toEqual([{ id: 9 }])
  })

  it('routes getRelease through the Discogs client with the saved token', async () => {
    getRelease.mockResolvedValue({ id: 5 })
    await getProvider('discogs').getRelease(5)
    expect(getRelease).toHaveBeenCalledWith(5, 'tok')
  })

  // The provider id arrives over IPC from the renderer, so an unknown value must
  // resolve to a working provider instead of crashing the search handler.
  it('falls back to the default provider for an unknown id', () => {
    expect(getProvider('spotify' as SearchProviderId)).toBe(getProvider(DEFAULT_PROVIDER))
  })
})
