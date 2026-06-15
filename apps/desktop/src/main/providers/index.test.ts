import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchProviderId } from '../../shared/types'

const { search, getRelease, getSettings } = vi.hoisted(() => ({
  search: vi.fn(),
  getRelease: vi.fn(),
  getSettings: vi.fn(() => ({ discogsToken: 'tok' })),
}))

vi.mock('../discogs', () => ({ search, getRelease }))
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
  it('forwards search to the Discogs client with the saved token and priority', async () => {
    search.mockResolvedValue([{ id: 1 }])
    const out = await getProvider('discogs').search('aphex twin', 'high')
    expect(search).toHaveBeenCalledWith('aphex twin', 'tok', 'high')
    expect(out).toEqual([{ id: 1 }])
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
