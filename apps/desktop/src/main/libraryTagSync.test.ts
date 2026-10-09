import { describe, expect, it, vi } from 'vitest'
import type { FlushResult } from './libraryRepointFlush'
import { serialLibraryFlush, syncLibraryTags, tagSyncOf } from './libraryTagSync'

const NOTHING = { outcome: 'nothing' } as const

describe('syncLibraryTags', () => {
  // The files are already right, so a library failing must not cost the others their update.
  // The failure is returned, not only logged: the done sheet said every library got the
  // change while one had thrown.
  it('keeps going after a library throws and reports each library', async () => {
    const rekordbox = vi.fn()
    const engine = vi.fn()
    const warn = vi.fn()
    await expect(
      syncLibraryTags({
        traktor: () => Promise.reject(new Error('boom')),
        rekordbox: async () => {
          rekordbox()
          return { outcome: 'updated', count: 2 }
        },
        engine: async () => {
          engine()
          return { outcome: 'open' }
        },
        warn,
      }),
    ).resolves.toEqual({
      traktor: { outcome: 'failed' },
      rekordbox: { outcome: 'updated', count: 2 },
      engine: { outcome: 'open' },
    })
    expect(rekordbox).toHaveBeenCalled()
    expect(engine).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('traktor', expect.any(Error))
  })

  // A conversion run's flush and a review's sync both rewrite the same databases (Engine's
  // m.db outside its own queue, the same temp names); interleaved, one clobbers the other.
  it('waits for a running library flush before syncing', async () => {
    let release: () => void = () => {}
    const running = serialLibraryFlush(() => new Promise<void>((r) => (release = r)))
    const traktor = vi.fn(async () => NOTHING)
    const sync = syncLibraryTags({
      traktor,
      rekordbox: async () => NOTHING,
      engine: async () => NOTHING,
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

describe('tagSyncOf', () => {
  const run = (over: Partial<FlushResult>): FlushResult => ({ written: 0, skipped: [], ...over })

  it.each([
    ['the tracks it updated', run({ written: 3 }), { outcome: 'updated', count: 3 }],
    ['nothing when no track matched', run({}), { outcome: 'nothing' }],
    ['open when the app held it', run({ blocked: 'rekordbox-running' }), { outcome: 'open' }],
    ['missing collection', run({ blocked: 'collection-missing' }), { outcome: 'missing' }],
    [
      'failed on any other stop',
      run({ blocked: 'write-failed', written: 1 }),
      { outcome: 'failed' },
    ],
  ] as const)('says %s', (_name, result, expected) => {
    expect(tagSyncOf(result, 'rekordbox-running')).toEqual(expected)
  })
})
