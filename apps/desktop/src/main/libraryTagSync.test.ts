import { describe, expect, it, vi } from 'vitest'
import { syncLibraryTags } from './libraryTagSync'

describe('syncLibraryTags', () => {
  // The files are already right, so a library failing must not cost the others their update.
  it('keeps going after a library throws and resolves', async () => {
    const rekordbox = vi.fn()
    const engine = vi.fn()
    const warn = vi.fn()
    await expect(
      syncLibraryTags({
        traktor: () => Promise.reject(new Error('boom')),
        rekordbox: async () => rekordbox(),
        engine: async () => engine(),
        warn,
      }),
    ).resolves.toBeUndefined()
    expect(rekordbox).toHaveBeenCalled()
    expect(engine).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('traktor', expect.any(Error))
  })
})
