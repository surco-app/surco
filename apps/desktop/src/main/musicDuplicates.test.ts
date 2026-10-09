import { describe, expect, it, vi } from 'vitest'
import type { ActivityEvent, ListRemoval } from '../shared/types'
import { createActivity } from './activity'
import {
  type ListMusicDeps,
  type RemoveCopyDeps,
  removeDuplicateCopy,
  removeDuplicateCopyLogged,
  removeListCopyFromMusic,
} from './musicDuplicates'

function deps(over: Partial<RemoveCopyDeps> = {}): RemoveCopyDeps {
  return {
    locate: vi.fn(async (pid: string) => (pid === 'KEEP' ? '/m/keep.aiff' : '/m/old.mp3')),
    realpath: vi.fn(async (p: string) => p),
    transferPlaylists: vi.fn().mockResolvedValue('2\t0'),
    deleteEntry: vi.fn().mockResolvedValue('/m/old.mp3'),
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
  // The file waits for the DJ libraries to move to the kept copy (library:replaceDuplicates).
  it('moves the playlists to the kept copy, deletes the entry and hands back both files', async () => {
    const d = deps()
    expect(await removeDuplicateCopy(req, d)).toEqual({
      outcome: 'removed',
      playlists: 2,
      fileTrashed: false,
      pair: { from: '/m/old.mp3', to: '/m/keep.aiff', shared: false },
    })
    expect(d.transferPlaylists).toHaveBeenCalledWith(
      'OLD',
      'KEEP',
      'Transfer - Possession',
      'Transfer - Possession (Remaster)',
    )
  })

  it('transfers before it deletes', async () => {
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
    })
    await removeDuplicateCopy(req, d)
    expect(calls).toEqual(['transfer', 'delete'])
  })

  // Measured: 34 entries of the real library are two Music entries on one file through a
  // symlink. Trashing "the duplicate's file" there would take the kept copy's audio with it.
  it('marks the file as shared when the kept copy also points to it', async () => {
    const d = deps({ realpath: vi.fn().mockResolvedValue('/Volumes/Musica/same.aiff') })
    expect(await removeDuplicateCopy(req, d)).toMatchObject({
      outcome: 'removed',
      pair: { shared: true },
    })
  })

  it('treats the file as shared when the kept copy has no known location', async () => {
    const d = deps({ locate: vi.fn(async (pid: string) => (pid === 'KEEP' ? '' : '/m/old.mp3')) })
    expect(await removeDuplicateCopy(req, d)).toMatchObject({
      outcome: 'removed',
      pair: { shared: true },
    })
    expect(d.deleteEntry).toHaveBeenCalled()
  })

  it('treats the file as shared when a path cannot be resolved', async () => {
    const d = deps({ realpath: vi.fn().mockResolvedValue(null) })
    expect(await removeDuplicateCopy(req, d)).toMatchObject({
      outcome: 'removed',
      pair: { shared: true },
    })
  })

  it('hands back no file for an entry that had none', async () => {
    const d = deps({ deleteEntry: vi.fn().mockResolvedValue('') })
    expect(await removeDuplicateCopy(req, d)).toEqual({
      outcome: 'removed',
      playlists: 2,
      fileTrashed: false,
    })
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
})

// Each removed copy gets its own row in Activity: what left Music and how many playlists
// moved now, and later, under the same row, what became of its file.
describe('removeDuplicateCopyLogged', () => {
  function logged() {
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))
    const copies = new Map<string, { group: string; label: string }>()
    return {
      events,
      copies,
      log: {
        track: activity.track,
        rememberCopy: (path: string, copy: { group: string; label: string }) =>
          copies.set(path, copy),
      },
    }
  }

  it('names the copy and says it left Music with its playlists', async () => {
    const { events, copies, log } = logged()
    await removeDuplicateCopyLogged(req, deps(), log)
    expect(events[0]).toMatchObject({
      phase: 'start',
      kind: 'applemusic',
      labelKey: 'activity.reviewDuplicateMusic',
      group: 'duplicate-OLD',
      groupLabel: 'Transfer - Possession',
    })
    expect(events[1]).toMatchObject({
      phase: 'done',
      detailKey: 'activity.reviewDuplicateRemoved',
      detailParams: { count: 2 },
    })
    expect(copies.get('/m/old.mp3')).toEqual({
      group: 'duplicate-OLD',
      label: 'Transfer - Possession',
    })
  })

  it('says a copy with no file left only Music', async () => {
    const { events, copies, log } = logged()
    await removeDuplicateCopyLogged(req, deps({ deleteEntry: vi.fn().mockResolvedValue('') }), log)
    expect(events[1]).toMatchObject({ detailKey: 'activity.reviewDuplicateRemovedNoFile' })
    expect(copies.size).toBe(0)
  })

  it.each([
    [
      'mismatch',
      { transferPlaylists: vi.fn().mockResolvedValue('mismatch') },
      'warn',
      'activity.reviewDuplicateMismatch',
    ],
    [
      'missing',
      { transferPlaylists: vi.fn().mockResolvedValue('missing') },
      'warn',
      'activity.reviewDuplicateMissing',
    ],
    [
      'playlist-failed',
      { transferPlaylists: vi.fn().mockResolvedValue('3\t1') },
      'error',
      'activity.reviewDuplicatePlaylistFailed',
    ],
    [
      'failed',
      { transferPlaylists: vi.fn().mockResolvedValue('garbage') },
      'error',
      'activity.reviewDuplicateFailed',
    ],
  ] as const)('says why a copy stayed (%s)', async (_name, over, phase, detailKey) => {
    const { events, log } = logged()
    await removeDuplicateCopyLogged(req, deps(over), log)
    expect(events[1]).toMatchObject({ phase, detailKey })
  })
})

describe('removeListCopyFromMusic', () => {
  const ref = {
    removePid: 'OLD',
    label: 'A - T',
    keep: { persistentId: 'KEEP', label: 'A - T (Remaster)' },
  }
  const removal = (music?: ListRemoval['music']) => ({
    from: '/m/old.aiff',
    to: '/m/keep.aiff',
    ...(music && { music }),
  })
  function listDeps(over: Partial<ListMusicDeps> = {}): ListMusicDeps {
    return {
      transferPlaylists: vi.fn().mockResolvedValue('1\t0'),
      deleteEntry: vi.fn().mockResolvedValue('/m/old.aiff'),
      holds: vi.fn().mockResolvedValue(false),
      ...over,
    }
  }

  // The renderer found no entry for the file, and its lookup misses a track renamed in Music.
  it('checks Music itself before calling a file it found no entry for free', async () => {
    const d = listDeps()
    expect(await removeListCopyFromMusic(removal(), d)).toEqual({ step: 'none' })
    expect(d.holds).toHaveBeenCalledWith('/m/old.aiff')
    expect(d.transferPlaylists).not.toHaveBeenCalled()
  })

  // Nobody confirmed that entry, so it is neither moved nor deleted, and the file stays.
  it('touches nothing when Music holds a file the renderer found no entry for', async () => {
    const d = listDeps({ holds: vi.fn().mockResolvedValue(true) })
    expect(await removeListCopyFromMusic(removal(), d)).toEqual({ step: 'held' })
    expect(d.transferPlaylists).not.toHaveBeenCalled()
    expect(d.deleteEntry).not.toHaveBeenCalled()
  })

  it('lets a failed check through as a failure', async () => {
    const d = listDeps({ holds: vi.fn().mockRejectedValue(new Error('osascript')) })
    await expect(removeListCopyFromMusic(removal(), d)).rejects.toThrow('osascript')
  })

  // The renderer never consulted Music: it does not know, so nothing is assumed.
  it('touches nothing when the renderer could not ask Music', async () => {
    const d = listDeps()
    expect(await removeListCopyFromMusic(removal('unknown'), d)).toEqual({ step: 'unknown' })
    expect(d.holds).not.toHaveBeenCalled()
    expect(d.transferPlaylists).not.toHaveBeenCalled()
    expect(d.deleteEntry).not.toHaveBeenCalled()
  })

  // Each entry is checked live against the file it was found by, not only by its label.
  it('moves the playlists to the kept entry and then deletes the removed one', async () => {
    const calls: string[] = []
    const d = listDeps({
      transferPlaylists: vi.fn(async () => {
        calls.push('transfer')
        return '3\t0'
      }),
      deleteEntry: vi.fn(async () => {
        calls.push('delete')
        return '/m/old.aiff'
      }),
    })
    expect(await removeListCopyFromMusic(removal(ref), d)).toEqual({
      step: 'removed',
      playlists: 3,
    })
    expect(d.transferPlaylists).toHaveBeenCalledWith('OLD', 'KEEP', 'A - T', 'A - T (Remaster)', {
      from: '/m/old.aiff',
      to: '/m/keep.aiff',
    })
    expect(d.deleteEntry).toHaveBeenCalledWith('OLD', 'A - T', '/m/old.aiff')
    expect(d.holds).not.toHaveBeenCalled()
    expect(calls).toEqual(['transfer', 'delete'])
  })

  // Its Music playlists would have nowhere to go.
  it('touches nothing when the kept file is not in Music', async () => {
    const d = listDeps()
    expect(await removeListCopyFromMusic(removal({ removePid: 'OLD', label: 'A - T' }), d)).toEqual(
      { step: 'kept-no-entry' },
    )
    expect(d.transferPlaylists).not.toHaveBeenCalled()
    expect(d.deleteEntry).not.toHaveBeenCalled()
  })

  it('touches nothing for a file Music holds twice', async () => {
    const d = listDeps()
    expect(await removeListCopyFromMusic(removal('ambiguous'), d)).toEqual({ step: 'ambiguous' })
    expect(d.transferPlaylists).not.toHaveBeenCalled()
    expect(d.deleteEntry).not.toHaveBeenCalled()
  })

  it('touches nothing when both sides name the same entry', async () => {
    const d = listDeps()
    const same = { ...ref, keep: { persistentId: 'OLD', label: 'A - T' } }
    expect(await removeListCopyFromMusic(removal(same), d)).toEqual({ step: 'failed' })
    expect(d.transferPlaylists).not.toHaveBeenCalled()
    expect(d.deleteEntry).not.toHaveBeenCalled()
  })

  it.each([
    ['mismatch', { step: 'mismatch' }],
    ['missing', { step: 'failed' }],
    ['2\t1', { step: 'failed', playlists: 2 }],
    ['nonsense', { step: 'failed' }],
  ])('deletes nothing when the transfer answers %s', async (answer, outcome) => {
    const d = listDeps({ transferPlaylists: vi.fn().mockResolvedValue(answer) })
    expect(await removeListCopyFromMusic(removal(ref), d)).toEqual(outcome)
    expect(d.deleteEntry).not.toHaveBeenCalled()
  })

  it('reports an entry that changed between the transfer and the delete', async () => {
    const d = listDeps({
      deleteEntry: vi.fn().mockRejectedValue(new Error('applemusic-delete-mismatch')),
    })
    expect(await removeListCopyFromMusic(removal(ref), d)).toEqual({
      step: 'mismatch',
      playlists: 1,
    })
  })

  // Gone before the delete: nothing confirms Music let go of this file.
  it('does not count an entry that vanished before the delete as removed', async () => {
    const d = listDeps({ deleteEntry: vi.fn().mockResolvedValue(null) })
    expect(await removeListCopyFromMusic(removal(ref), d)).toEqual({ step: 'failed', playlists: 1 })
  })
})
