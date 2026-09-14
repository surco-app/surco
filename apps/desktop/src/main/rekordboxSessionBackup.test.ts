import { describe, expect, it, vi } from 'vitest'
import { createSessionBackup } from './rekordboxSessionBackup'

// One copy of the collection per run, taken before the first write and never touched
// again. The per-write backup this sits alongside is overwritten on every track, so after
// 300 conversions it holds the state before track 300 — not the state the user started
// from. Only this one can put the collection back the way it was before the run.

describe('createSessionBackup', () => {
  it('copies the collection before the first write', async () => {
    const copy = vi.fn(async () => {})
    const backup = createSessionBackup({ copy })

    await backup.ensure('/dj/master.db')

    expect(copy).toHaveBeenCalledWith('/dj/master.db', '/dj/master.db.surco-session')
  })

  // The whole point. Copying again on track 2 would overwrite the pre-run state with a
  // collection that already carries track 1's write, and by the end of a 300-track run
  // the "backup" would be one write old.
  it('copies once for the whole run, however many tracks are repointed', async () => {
    const copy = vi.fn(async () => {})
    const backup = createSessionBackup({ copy })

    await backup.ensure('/dj/master.db')
    await backup.ensure('/dj/master.db')
    await backup.ensure('/dj/master.db')

    expect(copy).toHaveBeenCalledTimes(1)
  })

  // A run that failed to take the copy must not be treated as backed up: the next track
  // tries again rather than writing into a collection with no pre-run copy behind it.
  it('tries again after a failed copy instead of assuming one exists', async () => {
    const copy = vi
      .fn<(from: string, to: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined)
    const backup = createSessionBackup({ copy })

    await expect(backup.ensure('/dj/master.db')).rejects.toThrow('disk full')
    await backup.ensure('/dj/master.db')

    expect(copy).toHaveBeenCalledTimes(2)
  })

  // The next run starts from a clean slate: its own first write takes a fresh copy, so the
  // stored one always describes the state before the run the user is living through.
  it('takes a new copy once the run is reset', async () => {
    const copy = vi.fn(async () => {})
    const backup = createSessionBackup({ copy })

    await backup.ensure('/dj/master.db')
    backup.reset()
    await backup.ensure('/dj/master.db')

    expect(copy).toHaveBeenCalledTimes(2)
  })

  // Two collections in one run is not a case Surco creates today, but tracking a single
  // "done" flag would silently leave the second one with no pre-run copy at all.
  it('keeps a separate copy per collection', async () => {
    const copy = vi.fn(async () => {})
    const backup = createSessionBackup({ copy })

    await backup.ensure('/dj/one.db')
    await backup.ensure('/dj/two.db')

    expect(copy).toHaveBeenCalledTimes(2)
  })
})
