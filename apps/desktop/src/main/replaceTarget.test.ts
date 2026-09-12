import { describe, expect, it, vi } from 'vitest'
import { resolveReplaceTarget } from './replaceTarget'

// What a replacement has to know before anything is converted: which file the library
// entry points at today, and which rekordbox row that file is. Both are read, nothing is
// written, so this can run before the user has committed to anything.

const OLD_MP3 = '/Volumes/Public/Music/Acid/02 Everybody.mp3'

function deps(over: Partial<Parameters<typeof resolveReplaceTarget>[1]> = {}) {
  return {
    entryLocation: vi.fn(async () => OLD_MP3),
    findTrack: vi.fn(() => ({
      id: '900001',
      folderPath: OLD_MP3,
      fileName: '02 Everybody.mp3',
      fileType: 1,
      fileSize: 18307141,
    })),
    ...over,
  }
}

describe('resolveReplaceTarget', () => {
  it('reports the old file and the rekordbox row it belongs to', async () => {
    const d = deps()

    const target = await resolveReplaceTarget({ persistentId: 'PID1' }, d)

    expect(target).toEqual({
      oldPath: OLD_MP3,
      rekordboxId: '900001',
      oldFileType: 1,
    })
  })

  // Reading the location must happen before any conversion or deletion: once the library
  // copy is gone, nothing can say which file the entry used to point at, and the repoint
  // loses its input. This is the ordering the whole feature depends on.
  it('asks the library where the old file is', async () => {
    const d = deps()

    await resolveReplaceTarget({ persistentId: 'PID1' }, d)

    expect(d.entryLocation).toHaveBeenCalledWith('PID1')
  })

  // 117 of the user's 1959 library tracks are not in rekordbox at all — imported into
  // Music and never into rekordbox. The replacement still goes ahead, there is simply
  // nothing to repoint.
  it('still reports the old file when rekordbox does not have it', async () => {
    const d = deps({ findTrack: vi.fn(() => null) })

    const target = await resolveReplaceTarget({ persistentId: 'PID1' }, d)

    expect(target).toEqual({ oldPath: OLD_MP3, rekordboxId: null, oldFileType: null })
  })

  // 34 of their files have two rekordbox rows apiece. Picking one would repoint half the
  // playlists and leave the rest on the replaced file, so the ambiguity is carried up for
  // the user to resolve rather than guessed at here.
  it('carries up an ambiguous rekordbox match instead of choosing', async () => {
    const d = deps({ findTrack: vi.fn(() => ({ ambiguous: ['900001', '900002'] })) })

    const target = await resolveReplaceTarget({ persistentId: 'PID1' }, d)

    expect(target).toEqual({
      oldPath: OLD_MP3,
      rekordboxId: null,
      oldFileType: null,
      ambiguous: ['900001', '900002'],
    })
  })

  // Music answers with an empty string when it holds no reachable file for the entry (a
  // cloud track, a broken reference). There is no old file to replace or repoint, and
  // saying so is not the same as saying rekordbox lacks it.
  it('reports no target when the library entry has no file', async () => {
    const d = deps({ entryLocation: vi.fn(async () => '') })

    expect(await resolveReplaceTarget({ persistentId: 'PID1' }, d)).toBeNull()
    expect(d.findTrack).not.toHaveBeenCalled()
  })

  // A track Surco did not add and the user did not import from a playlist carries no
  // persistent ID, so there is no library entry to ask about.
  it('reports no target when the track has no library copy', async () => {
    const d = deps()

    expect(await resolveReplaceTarget({ persistentId: undefined }, d)).toBeNull()
    expect(d.entryLocation).not.toHaveBeenCalled()
  })

  // Music failing to answer must not take the conversion down with it: the replacement
  // simply proceeds without a repoint, which is what happens today anyway.
  it('reports no target when the library cannot be asked', async () => {
    const d = deps({
      entryLocation: vi.fn(async () => {
        throw new Error('Music is not running')
      }),
    })

    expect(await resolveReplaceTarget({ persistentId: 'PID1' }, d)).toBeNull()
  })
})
