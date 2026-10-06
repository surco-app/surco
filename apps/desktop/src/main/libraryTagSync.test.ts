import { describe, expect, it, vi } from 'vitest'
import { serialLibraryFlush, syncLibraryTags } from './libraryTagSync'

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

  // A conversion run's flush and a review's sync both rewrite the same databases (Engine's
  // m.db outside its own queue, the same temp names); interleaved, one clobbers the other.
  it('waits for a running library flush before syncing', async () => {
    let release: () => void = () => {}
    const running = serialLibraryFlush(() => new Promise<void>((r) => (release = r)))
    const traktor = vi.fn(async () => {})
    const sync = syncLibraryTags({
      traktor,
      rekordbox: async () => {},
      engine: async () => {},
      warn: vi.fn(),
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(traktor).not.toHaveBeenCalled()
    release()
    await Promise.all([running, sync])
    expect(traktor).toHaveBeenCalled()
  })

  it('runs the next flush after one rejects', async () => {
    await expect(serialLibraryFlush(() => Promise.reject(new Error('boom')))).rejects.toThrow()
    await expect(serialLibraryFlush(async () => 'next')).resolves.toBe('next')
  })
})
