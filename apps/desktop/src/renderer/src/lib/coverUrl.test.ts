import { afterEach, describe, expect, it, vi } from 'vitest'
import { revokeCoverUrl } from './coverUrl'

afterEach(() => vi.unstubAllGlobals())

describe('revokeCoverUrl', () => {
  // Only blob URLs hold a revocable handle; a Discogs https URL or an embedded
  // data: thumbnail must pass through untouched.
  it('revokes blob URLs and leaves every other cover source alone', () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL: revoke })

    revokeCoverUrl('blob:abc')
    expect(revoke).toHaveBeenCalledWith('blob:abc')

    revoke.mockClear()
    revokeCoverUrl('https://img.discogs.com/x.jpg')
    revokeCoverUrl('data:image/jpeg;base64,xyz')
    revokeCoverUrl(undefined)
    expect(revoke).not.toHaveBeenCalled()
  })
})
