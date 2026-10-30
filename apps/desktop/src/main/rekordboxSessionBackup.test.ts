import { describe, expect, it, vi } from 'vitest'
import { createSessionBackup } from './rekordboxSessionBackup'

// One copy of the collection per momento, taken before the first write and never touched
// again. The per-write backup this sits alongside is overwritten on every track, so after
// 300 conversions it holds the state before track 300 — not the state the user started
// from. Only this one can put the collection back the way it was before the run.

describe('createSessionBackup', () => {
  // The whole point. Copying again on track 2 would take a copy that already carries track
  // 1's write, and by the end of a 300-track run the newest copy would be one write old.
  it('one copy per momento, however many tracks it writes', async () => {
    const take = vi.fn(async () => ({}) as never)
    const backup = createSessionBackup({ take })
    backup.begin('run')

    await backup.ensure('/dj/master.db')
    await backup.ensure('/dj/master.db')
    await backup.ensure('/dj/master.db')

    expect(take).toHaveBeenCalledTimes(1)
    expect(take).toHaveBeenCalledWith('/dj/master.db', [], 'run')
  })

  // The next momento starts from a clean slate: its own first write takes a fresh copy, so
  // the newest one always describes the state before the momento the user is living through.
  it('a new momento takes a new copy', async () => {
    const take = vi.fn(async () => ({}) as never)
    const backup = createSessionBackup({ take })

    backup.begin('run')
    await backup.ensure('/dj/master.db')
    backup.begin('cues')
    await backup.ensure('/dj/master.db')

    expect(take).toHaveBeenCalledTimes(2)
    expect(take).toHaveBeenLastCalledWith('/dj/master.db', [], 'cues')
  })

  it('small playlist edits share one copy per Surco session', async () => {
    const take = vi.fn(async () => ({}) as never)
    const backup = createSessionBackup({ take })

    backup.beginLoose('/dj/master.db')
    await backup.ensure('/dj/master.db')
    backup.beginLoose('/dj/master.db')
    await backup.ensure('/dj/master.db')

    expect(take).toHaveBeenCalledTimes(1)
    expect(take).toHaveBeenCalledWith('/dj/master.db', [], 'playlists')
  })

  it('a playlist edit on one collection does not relabel another collection copy', async () => {
    const take = vi.fn(async () => ({}) as never)
    const backup = createSessionBackup({ take })
    backup.begin('run')

    backup.beginLoose('/dj/one.db')
    await backup.ensure('/dj/two.db')

    expect(take).toHaveBeenCalledWith('/dj/two.db', [], 'run')
  })

  it('the rekordbox XML is copied with master.db, not on its own', async () => {
    const take = vi.fn(async () => ({}) as never)
    const backup = createSessionBackup({
      take,
      companionsOf: (p) => (p === '/dj/master.db' ? ['/dj/masterPlaylists6.xml'] : []),
      skip: (p) => p === '/dj/masterPlaylists6.xml',
    })
    backup.begin('run')

    await backup.ensure('/dj/master.db')
    await backup.ensure('/dj/masterPlaylists6.xml')

    expect(take).toHaveBeenCalledTimes(1)
    expect(take).toHaveBeenCalledWith('/dj/master.db', ['/dj/masterPlaylists6.xml'], 'run')
  })

  // A momento that failed to take the copy must not be treated as backed up: the next write
  // tries again rather than writing into a collection with no copy behind it.
  it('a failed copy is remembered so the Copias screen can say so', async () => {
    const take = vi
      .fn<() => Promise<never>>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce({} as never)
    const backup = createSessionBackup({ take })
    backup.begin('run')

    await expect(backup.ensure('/dj/master.db')).rejects.toThrow('disk full')
    expect([...backup.failed()]).toEqual(['/dj/master.db'])

    await backup.ensure('/dj/master.db')
    expect(backup.failed().size).toBe(0)
    expect(take).toHaveBeenCalledTimes(2)
  })

  // Two collections in one momento is not a case Surco creates today, but tracking a single
  // "done" flag would silently leave the second one with no copy at all.
  it('keeps a separate copy per collection', async () => {
    const take = vi.fn(async () => ({}) as never)
    const backup = createSessionBackup({ take })
    backup.begin('run')

    await backup.ensure('/dj/one.db')
    await backup.ensure('/dj/two.db')

    expect(take).toHaveBeenCalledTimes(2)
  })

  it('two writes that ask at once share one copy instead of taking two', async () => {
    let finish: () => void = () => {}
    const take = vi.fn(
      () =>
        new Promise<never>((resolve) => {
          finish = () => resolve({} as never)
        }),
    )
    const backup = createSessionBackup({ take })
    backup.begin('run')

    const first = backup.ensure('/dj/m.db')
    const second = backup.ensure('/dj/m.db')
    finish()
    await Promise.all([first, second])

    expect(take).toHaveBeenCalledTimes(1)
  })

  it('two writes that ask at once both fail when the one copy fails', async () => {
    const take = vi.fn(async (): Promise<never> => {
      throw new Error('disk full')
    })
    const backup = createSessionBackup({ take })
    backup.begin('run')

    const results = await Promise.allSettled([backup.ensure('/dj/m.db'), backup.ensure('/dj/m.db')])

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(take).toHaveBeenCalledTimes(1)
  })
})
