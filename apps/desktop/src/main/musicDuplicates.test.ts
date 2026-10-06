import { describe, expect, it, vi } from 'vitest'
import { type RemoveCopyDeps, removeDuplicateCopy } from './musicDuplicates'

function deps(over: Partial<RemoveCopyDeps> = {}): RemoveCopyDeps {
  return {
    locate: vi.fn(async (pid: string) => (pid === 'KEEP' ? '/m/keep.aiff' : '/m/old.mp3')),
    realpath: vi.fn(async (p: string) => p),
    transferPlaylists: vi.fn().mockResolvedValue('2\t0'),
    deleteEntry: vi.fn().mockResolvedValue('/m/old.mp3'),
    trash: vi.fn().mockResolvedValue(undefined),
    usedByLibrary: vi.fn().mockResolvedValue(false),
    ...over,
  }
}
const req = {
  removePid: 'OLD',
  keepPid: 'KEEP',
  label: 'Transfer - Possession',
  keepLabel: 'Transfer - Possession (Remaster)',
}

describe('removeDuplicateCopy', () => {
  it('moves the playlists to the kept copy, then deletes the entry and trashes its file', async () => {
    const d = deps()
    expect(await removeDuplicateCopy(req, d)).toEqual({
      outcome: 'removed',
      playlists: 2,
      fileTrashed: true,
    })
    expect(d.transferPlaylists).toHaveBeenCalledWith(
      'OLD',
      'KEEP',
      'Transfer - Possession',
      'Transfer - Possession (Remaster)',
    )
    expect(d.trash).toHaveBeenCalledWith('/m/old.mp3')
  })

  it('transfers before it deletes and deletes before it trashes', async () => {
    const calls: string[] = []
    const d = deps({
      transferPlaylists: vi.fn(async () => {
        calls.push('transfer')
        return '1\t0'
      }),
      deleteEntry: vi.fn(async () => {
        calls.push('delete')
        return '/m/old.mp3'
      }),
      trash: vi.fn(async () => {
        calls.push('trash')
      }),
    })
    await removeDuplicateCopy(req, d)
    expect(calls).toEqual(['transfer', 'delete', 'trash'])
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

  it('keeps the file when the kept copy has no known location', async () => {
    const d = deps({ locate: vi.fn(async (pid: string) => (pid === 'KEEP' ? '' : '/m/old.mp3')) })
    expect(await removeDuplicateCopy(req, d)).toMatchObject({
      outcome: 'removed',
      fileTrashed: false,
    })
    expect(d.deleteEntry).toHaveBeenCalled()
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('keeps the file when a path cannot be resolved', async () => {
    const d = deps({ realpath: vi.fn().mockResolvedValue(null) })
    expect(await removeDuplicateCopy(req, d)).toMatchObject({
      outcome: 'removed',
      fileTrashed: false,
    })
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('deletes nothing when an entry no longer carries the confirmed label', async () => {
    const d = deps({ transferPlaylists: vi.fn().mockResolvedValue('mismatch') })
    expect(await removeDuplicateCopy(req, d)).toEqual({
      outcome: 'mismatch',
      playlists: 0,
      fileTrashed: false,
    })
    expect(d.deleteEntry).not.toHaveBeenCalled()
  })

  it('reports a mismatch the delete finds after a successful transfer', async () => {
    const d = deps({
      deleteEntry: vi.fn().mockRejectedValue(new Error('applemusic-delete-mismatch')),
    })
    expect(await removeDuplicateCopy(req, d)).toEqual({
      outcome: 'mismatch',
      playlists: 2,
      fileTrashed: false,
    })
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('treats an entry already gone as done', async () => {
    const d = deps({ deleteEntry: vi.fn().mockResolvedValue(null) })
    expect(await removeDuplicateCopy(req, d)).toMatchObject({
      outcome: 'missing',
      fileTrashed: false,
    })
  })

  // A swallowed add would delete the entry and drop the track from that playlist for good.
  it('deletes nothing when a playlist add failed', async () => {
    const d = deps({ transferPlaylists: vi.fn().mockResolvedValue('3\t1') })
    expect(await removeDuplicateCopy(req, d)).toEqual({
      outcome: 'playlist-failed',
      playlists: 3,
      fileTrashed: false,
    })
    expect(d.deleteEntry).not.toHaveBeenCalled()
  })

  it('deletes nothing when Music answers something unreadable', async () => {
    const d = deps({ transferPlaylists: vi.fn().mockResolvedValue('') })
    expect(await removeDuplicateCopy(req, d)).toEqual({
      outcome: 'failed',
      playlists: 0,
      fileTrashed: false,
    })
    expect(d.deleteEntry).not.toHaveBeenCalled()
  })

  it('refuses to remove a copy in favour of itself', async () => {
    const d = deps()
    expect(await removeDuplicateCopy({ ...req, keepPid: 'OLD' }, d)).toMatchObject({
      outcome: 'failed',
    })
    expect(d.transferPlaylists).not.toHaveBeenCalled()
  })

  it('still reports removed when the trash fails after the delete', async () => {
    const d = deps({ trash: vi.fn().mockRejectedValue(new Error('gone')) })
    expect(await removeDuplicateCopy(req, d)).toEqual({
      outcome: 'removed',
      playlists: 2,
      fileTrashed: false,
    })
  })

  // rekordbox, Engine DJ or Traktor still pointing at the file would show it missing.
  it('keeps the file a synced DJ library still uses and says so', async () => {
    const d = deps({ usedByLibrary: vi.fn().mockResolvedValue(true) })
    expect(await removeDuplicateCopy(req, d)).toEqual({
      outcome: 'removed',
      playlists: 2,
      fileTrashed: false,
      keptForLibrary: true,
    })
    expect(d.usedByLibrary).toHaveBeenCalledWith('/m/old.mp3')
    expect(d.deleteEntry).toHaveBeenCalled()
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('keeps the file when a library cannot be read', async () => {
    const d = deps({ usedByLibrary: vi.fn().mockRejectedValue(new Error('locked')) })
    expect(await removeDuplicateCopy(req, d)).toMatchObject({
      outcome: 'removed',
      fileTrashed: false,
      keptForLibrary: true,
    })
    expect(d.trash).not.toHaveBeenCalled()
  })
})
