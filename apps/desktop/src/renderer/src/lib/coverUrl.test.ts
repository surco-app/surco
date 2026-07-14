import { afterEach, describe, expect, it, vi } from 'vitest'
import { revokeCoverUrl, revokeCoverUrlIfUnused, revokeDisplacedCovers } from './coverUrl'

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

describe('revokeDisplacedCovers', () => {
  // The whole batch is weighed against the whole batch. Removing rows one at a time and
  // asking "does anyone else still hold this blob?" answers YES for every member of a
  // shared-cover batch — each one sees its not-yet-removed siblings — so a cover applied
  // across a selection survived the selection's own removal and leaked for the session.
  // Deciding once, per batch, is what makes the answer right.
  it('frees a cover shared by the batch when the whole batch goes', () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL: revoke })

    revokeDisplacedCovers(['blob:shared', 'blob:shared', 'blob:shared'], [])

    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:shared')
  })

  // The other half of the same rule: a survivor outside the batch still showing that blob
  // keeps it alive, or its thumbnail would blank.
  it('keeps a cover a surviving track still shows', () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL: revoke })

    revokeDisplacedCovers(['blob:shared', 'blob:shared'], ['blob:shared'])

    expect(revoke).not.toHaveBeenCalled()
  })

  // Mixed batch: each distinct blob is judged on its own, and a blob is freed once, not
  // once per row that carried it.
  it('frees each orphaned blob exactly once and leaves the kept ones', () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL: revoke })

    revokeDisplacedCovers(
      ['blob:a', 'blob:a', 'blob:b', 'https://img/x.jpg', undefined],
      ['blob:b'],
    )

    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:a')
  })
})
