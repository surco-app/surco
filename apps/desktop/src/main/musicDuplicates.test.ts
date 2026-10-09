import { describe, expect, it, vi } from 'vitest'
import type { ActivityEvent } from '../shared/types'
import { createActivity } from './activity'
import {
  type RemoveCopyDeps,
  removeDuplicateCopy,
  removeDuplicateCopyLogged,
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
