import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchProviderId } from '../../shared/types'

const { search, getRelease, getSettings } = vi.hoisted(() => ({
  search: vi.fn(),
  getRelease: vi.fn(),
  getSettings: vi.fn(() => ({ discogsToken: 'tok', discogsFormats: [] as string[] })),
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
    getSettings.mockReturnValueOnce({ discogsToken: 'tok', discogsFormats: ['Vinyl'] })
    search.mockResolvedValue([])
    await getProvider('discogs').search('only vinyl', 'high')
    expect(search).toHaveBeenCalledWith('only vinyl', 'tok', 'high', undefined, ['Vinyl'])
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
