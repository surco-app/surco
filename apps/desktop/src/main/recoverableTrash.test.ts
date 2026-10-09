import { describe, expect, it, vi } from 'vitest'
import { type RecoverableTrashDeps, trashRecoverably } from './recoverableTrash'

function deps(over: Partial<RecoverableTrashDeps>): RecoverableTrashDeps {
  return {
    keepsTrash: () => true,
    keep: vi.fn(async () => ({})),
    trashItem: vi.fn(async () => {}),
    ...over,
  }
}

describe('trashRecoverably', () => {
  it('sends the file to the OS Trash when its volume has one', async () => {
    const d = deps({})
    expect(await trashRecoverably('/Users/me/a.mp3', {}, d)).toBe('trash')
    expect(d.trashItem).toHaveBeenCalledWith('/Users/me/a.mp3')
    expect(d.keep).not.toHaveBeenCalled()
  })

  it('keeps the file in Surco trash instead when the volume has no Trash, since the OS would delete it outright', async () => {
    const d = deps({ keepsTrash: () => false })
    expect(await trashRecoverably('/Volumes/Public/a.mp3', {}, d)).toBe('surco')
    expect(d.keep).toHaveBeenCalledWith('/Volumes/Public/a.mp3')
    expect(d.trashItem).not.toHaveBeenCalled()
  })

  it('throws and leaves the file alone when the volume has no Trash and keeping failed', async () => {
    const d = deps({ keepsTrash: () => false, keep: vi.fn(async () => null) })
    await expect(trashRecoverably('/Volumes/Public/a.mp3', {}, d)).rejects.toThrow()
    expect(d.trashItem).not.toHaveBeenCalled()
  })

  // "Nunca" in Settings warns that a delete on a disk with no Trash is for good. A delete
  // the user confirmed under it is theirs to make; refusing it left no way to delete at all.
  it('lets a delete the user confirmed under the never setting go to the OS', async () => {
    const d = deps({ keepsTrash: () => false, keep: vi.fn(async () => null) })
    await trashRecoverably('/Volumes/Public/a.mp3', { userConfirmed: true, policy: 'never' }, d)
    expect(d.trashItem).toHaveBeenCalledWith('/Volumes/Public/a.mp3')
    expect(d.keep).not.toHaveBeenCalled()
  })

  // A removal the review decides on its own is not the user deleting one named file: it
  // still needs somewhere to come back from.
  it('still refuses an automatic delete under the never setting', async () => {
    const d = deps({ keepsTrash: () => false, keep: vi.fn(async () => null) })
    await expect(
      trashRecoverably('/Volumes/Public/a.mp3', { policy: 'never' }, d),
    ).rejects.toThrow()
    expect(d.trashItem).not.toHaveBeenCalled()
  })

  // Only the setting is a choice. A keeper that failed under any other setting is a fault,
  // and the user was promised a copy.
  it('still refuses a confirmed delete when keeping failed under a setting that keeps', async () => {
    const d = deps({ keepsTrash: () => false, keep: vi.fn(async () => null) })
    await expect(
      trashRecoverably('/Volumes/Public/a.mp3', { userConfirmed: true, policy: 'audioChanges' }, d),
    ).rejects.toThrow()
    expect(d.trashItem).not.toHaveBeenCalled()
  })
})
