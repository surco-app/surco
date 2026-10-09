import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureOriginalKeeper, policyKeeper } from './originalKeeper'
import { type RecoverableTrashDeps, trashAsConfirmed, trashRecoverably } from './recoverableTrash'

afterEach(() => configureOriginalKeeper(null))

function deps(over: Partial<RecoverableTrashDeps>): RecoverableTrashDeps {
  return {
    keepsTrash: () => true,
    keep: vi.fn(async () => ({})),
    trashItem: vi.fn(async () => {}),
    policy: () => 'audioChanges',
    remove: vi.fn(async () => {}),
    platform: 'darwin',
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
      await trashRecoverably('/Volumes/Public/a.mp3', {
        keepsTrash: () => false,
        trashItem,
      }),
    ).toBe('surco')
    expect(stash).toHaveBeenCalledTimes(1)
    expect(trashItem).not.toHaveBeenCalled()
  })
})

// Under "Never" Surco keeps nothing, so a delete on a disk with no Trash has nowhere
// recoverable to go. Only the user can turn that into a delete for good, in a dialog
// that said so before they confirmed; main checks the setting and the volume itself.
describe('trashAsConfirmed', () => {
  const nas = '/Volumes/Public/a.mp3'

  it('refuses to delete for good without the confirmation, and keeps nothing', async () => {
    const d = deps({ keepsTrash: () => false, policy: () => 'never' })
    await expect(trashAsConfirmed(nas, { permanentConfirmed: false }, d)).rejects.toThrow()
    expect(d.remove).not.toHaveBeenCalled()
    expect(d.keep).not.toHaveBeenCalled()
    expect(d.trashItem).not.toHaveBeenCalled()
  })

  // Windows drives all read as having no Trash, but a local one has a Recycle Bin: the
  // OS gets the first try, so a confirmed delete under "Never" lands there when it can.
  it('hands a confirmed delete under never to the OS first on Windows', async () => {
    const d = deps({ keepsTrash: () => false, policy: () => 'never', platform: 'win32' })
    expect(await trashAsConfirmed('C:\\Music\\a.mp3', { permanentConfirmed: true }, d)).toBe(
      'trash',
    )
    expect(d.trashItem).toHaveBeenCalledWith('C:\\Music\\a.mp3')
    expect(d.remove).not.toHaveBeenCalled()
  })

  it('deletes for good once confirmed under never on a disk with no Trash', async () => {
    const d = deps({ keepsTrash: () => false, policy: () => 'never' })
    expect(await trashAsConfirmed(nas, { permanentConfirmed: true }, d)).toBe('deleted')
    expect(d.remove).toHaveBeenCalledWith(nas)
    expect(d.keep).not.toHaveBeenCalled()
  })

  it('still keeps a copy when the setting keeps one, confirmation or not', async () => {
    for (const policy of ['always', 'audioChanges'] as const) {
      const d = deps({ keepsTrash: () => false, policy: () => policy })
      expect(await trashAsConfirmed(nas, { permanentConfirmed: true }, d)).toBe('surco')
      expect(d.remove).not.toHaveBeenCalled()
    }
  })

  it('still uses the Trash on a disk that has one, even under never', async () => {
    const d = deps({ policy: () => 'never' })
    expect(await trashAsConfirmed('/Users/me/a.mp3', { permanentConfirmed: true }, d)).toBe('trash')
    expect(d.remove).not.toHaveBeenCalled()
  })
})
