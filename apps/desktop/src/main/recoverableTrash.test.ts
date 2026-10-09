import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureOriginalKeeper, policyKeeper } from './originalKeeper'
import { type RecoverableTrashDeps, trashRecoverably } from './recoverableTrash'

afterEach(() => configureOriginalKeeper(null))

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
    expect(await trashRecoverably('/Users/me/a.mp3', d)).toBe('trash')
    expect(d.trashItem).toHaveBeenCalledWith('/Users/me/a.mp3')
    expect(d.keep).not.toHaveBeenCalled()
  })

  it('keeps the file in Surco trash instead when the volume has no Trash, since the OS would delete it outright', async () => {
    const d = deps({ keepsTrash: () => false })
    expect(await trashRecoverably('/Volumes/Public/a.mp3', d)).toBe('surco')
    expect(d.keep).toHaveBeenCalledWith('/Volumes/Public/a.mp3')
    expect(d.trashItem).not.toHaveBeenCalled()
  })

  it('throws and leaves the file alone when the volume has no Trash and keeping failed', async () => {
    const d = deps({ keepsTrash: () => false, keep: vi.fn(async () => null) })
    await expect(trashRecoverably('/Volumes/Public/a.mp3', d)).rejects.toThrow()
    expect(d.trashItem).not.toHaveBeenCalled()
  })

  // A duplicate the review removes, the old Music copy, a row removed from the list: none
  // of these was phrased to the user as a delete for good, so "Never" cannot make one.
  it('keeps the file in Surco trash on a volume with no Trash even when the setting says never', async () => {
    const stash = vi.fn(async (path: string) => ({
      id: 'kept',
      name: 'a.mp3',
      originalPath: path,
      storedPath: '',
      bytes: 0,
      trashedAt: 0,
      reason: 'deleted' as const,
    }))
    configureOriginalKeeper(policyKeeper(() => 'never', stash))
    const trashItem = vi.fn(async () => {})
    expect(
      await trashRecoverably('/Volumes/Public/a.mp3', { keepsTrash: () => false, trashItem }),
    ).toBe('surco')
    expect(stash).toHaveBeenCalledTimes(1)
    expect(trashItem).not.toHaveBeenCalled()
  })
})
