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
})
