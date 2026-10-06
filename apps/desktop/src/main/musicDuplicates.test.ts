import { describe, expect, it, vi } from 'vitest'
import { type RemoveCopyDeps, removeDuplicateCopy } from './musicDuplicates'

function deps(over: Partial<RemoveCopyDeps> = {}): RemoveCopyDeps {
  return {
    locate: vi.fn(async (pid: string) => (pid === 'KEEP' ? '/m/keep.aiff' : '/m/old.mp3')),
    realpath: vi.fn(async (p: string) => p),
    transferPlaylists: vi.fn().mockResolvedValue('2'),
    deleteEntry: vi.fn().mockResolvedValue('/m/old.mp3'),
    trash: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}
const req = { removePid: 'OLD', keepPid: 'KEEP', label: 'Transfer - Possession' }

describe('removeDuplicateCopy', () => {
  it('moves the playlists to the kept copy, then deletes the entry and trashes its file', async () => {
    const d = deps()
    expect(await removeDuplicateCopy(req, d)).toEqual({
      outcome: 'removed',
      playlists: 2,
      fileTrashed: true,
    })
    expect(d.transferPlaylists).toHaveBeenCalledWith('OLD', 'KEEP', 'Transfer - Possession')
    expect(d.trash).toHaveBeenCalledWith('/m/old.mp3')
  })

  // Measured: 34 entries of the real library are two Music entries on one file through a
  // symlink. Trashing "the duplicate's file" there would take the kept copy's audio with it.
  it('never trashes a file the kept copy also points to', async () => {
    const d = deps({ realpath: vi.fn().mockResolvedValue('/Volumes/Musica/same.aiff') })
    expect(await removeDuplicateCopy(req, d)).toMatchObject({
      outcome: 'removed',
      fileTrashed: false,
    })
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('deletes nothing when the entry no longer carries the confirmed label', async () => {
    const d = deps({ transferPlaylists: vi.fn().mockResolvedValue('mismatch') })
    expect(await removeDuplicateCopy(req, d)).toEqual({
      outcome: 'mismatch',
      playlists: 0,
      fileTrashed: false,
    })
    expect(d.deleteEntry).not.toHaveBeenCalled()
  })

  it('treats an entry already gone as done', async () => {
    const d = deps({ deleteEntry: vi.fn().mockResolvedValue(null) })
    expect(await removeDuplicateCopy(req, d)).toMatchObject({
      outcome: 'missing',
      fileTrashed: false,
    })
  })
})
