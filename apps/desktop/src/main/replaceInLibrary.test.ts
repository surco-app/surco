import { describe, expect, it, vi } from 'vitest'
import { replaceLibraryCopy } from './replaceInLibrary'

// Apple Music has no way to point an existing track at a different file — location can be
// read, never written — so replacing a copy means adding the new file and deleting the old
// entry. The order is what keeps the user's library safe if a step fails.

const meta = { artist: 'A', title: 'One' }

function deps(over: Partial<Parameters<typeof replaceLibraryCopy>[1]> = {}) {
  return {
    add: vi.fn(async () => 'NEWPID'),
    remove: vi.fn(async () => '/m/old.mp3'),
    ...over,
  }
}

describe('replaceLibraryCopy', () => {
  it('returns the new library copy', async () => {
    const d = deps()

    const id = await replaceLibraryCopy(
      { newPath: '/m/new.aiff', oldPersistentId: 'OLDPID', meta },
      d,
    )

    expect(id).toBe('NEWPID')
  })

  // Add first, delete second. The other way round leaves the user with neither copy if the
  // add fails — their track simply gone from the library — while this order's worst case
  // is two copies, which is recoverable and visible.
  it('adds the new copy before removing the old one', async () => {
    const order: string[] = []
    const d = deps({
      add: vi.fn(async () => {
        order.push('add')
        return 'NEWPID'
      }),
      remove: vi.fn(async () => {
        order.push('remove')
        return '/m/old.mp3'
      }),
    })

    await replaceLibraryCopy({ newPath: '/m/new.aiff', oldPersistentId: 'OLDPID', meta }, d)

    expect(order).toEqual(['add', 'remove'])
  })

  it('removes the copy it superseded, named so the delete can verify it', async () => {
    const d = deps()

    await replaceLibraryCopy({ newPath: '/m/new.aiff', oldPersistentId: 'OLDPID', meta }, d)

    expect(d.remove).toHaveBeenCalledWith('OLDPID', 'A - One')
  })

  // A failed add must leave the old copy alone: it is still the user's only entry for that
  // track, and deleting it after failing to replace it would lose the track outright.
  it('keeps the old copy when the new one could not be added', async () => {
    const d = deps({
      add: vi.fn(async () => {
        throw new Error('Music refused the add')
      }),
    })

    await expect(
      replaceLibraryCopy({ newPath: '/m/new.aiff', oldPersistentId: 'OLDPID', meta }, d),
    ).rejects.toThrow('Music refused the add')
    expect(d.remove).not.toHaveBeenCalled()
  })

  // The new copy is already in the library by the time the delete runs, so a failed delete
  // is not worth undoing — the user has what they asked for, plus an old entry they can
  // remove. Losing the new copy to tidy up would be the worse trade.
  it('keeps the new copy when the old one could not be removed', async () => {
    const d = deps({
      remove: vi.fn(async () => {
        throw new Error('delete mismatch')
      }),
    })

    const id = await replaceLibraryCopy(
      { newPath: '/m/new.aiff', oldPersistentId: 'OLDPID', meta },
      d,
    )

    expect(id).toBe('NEWPID')
  })
})
