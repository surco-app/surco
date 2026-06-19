import { afterEach, describe, expect, it, vi } from 'vitest'
import { revokeCoverUrl, revokeCoverUrlIfUnused } from './coverUrl'

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

describe('revokeCoverUrlIfUnused', () => {
  // Applying one cover across a multi-selection makes several tracks share a single
  // blob URL. Dropping it from one track must NOT free the blob while another still
  // shows it — that would blank the others' thumbnails.
  it('keeps a blob URL that another track still references', () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL: revoke })
    revokeCoverUrlIfUnused('blob:shared', ['blob:shared', 'https://img/x.jpg'])
    expect(revoke).not.toHaveBeenCalled()
  })

  // Once no remaining track references the blob, it must be freed — otherwise the
  // image file it pins stays in memory for the rest of the session.
  it('frees a blob URL no remaining track references', () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL: revoke })
    revokeCoverUrlIfUnused('blob:orphan', ['https://img/x.jpg', undefined])
    expect(revoke).toHaveBeenCalledWith('blob:orphan')
  })

  it('ignores non-blob sources regardless of references', () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL: revoke })
    revokeCoverUrlIfUnused('https://img/x.jpg', [])
    revokeCoverUrlIfUnused(undefined, [])
    expect(revoke).not.toHaveBeenCalled()
  })
})
