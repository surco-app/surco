import { describe, expect, it, vi } from 'vitest'
import { volumeKeepsTrash } from './trashSupport'

// Whether a file's volume can actually keep a deleted file, asked of the filesystem rather
// than guessed from the path.
//
// The path-shaped guess it replaces called everything under /Volumes unsafe, which is
// wrong on this very machine: /Volumes/Macintosh HD is a symlink to the local disk and
// /Volumes/Public is the user's NAS. Measured 15/09 with statfs: the NAS reports type 30
// (smbfs) while every local path — home, /tmp and Macintosh HD alike — reports 26 (apfs).
// A file was already lost to a dialog promising a Trash that the NAS does not have.

describe('volumeKeepsTrash', () => {
  // The local disk keeps a Trash, so the promise holds and the ordinary wording stands.
  it('says a local filesystem keeps deleted files', () => {
    expect(volumeKeepsTrash('/Users/vicent/Music/a.aiff', { statfs: () => ({ type: 26 }) })).toBe(
      true,
    )
  })

  // The user's NAS: an SMB mount, where macOS deletes outright instead of moving to a
  // Trash. This is the case the whole check exists for.
  it('says a network filesystem may not keep them', () => {
    expect(volumeKeepsTrash('/Volumes/Public/Music/a.mp3', { statfs: () => ({ type: 30 }) })).toBe(
      false,
    )
  })

  // The false positive that motivated the rewrite: /Volumes/Macintosh HD is the local
  // disk, and the old path rule wrongly warned about it.
  it('does not warn about a local disk mounted under /Volumes', () => {
    expect(
      volumeKeepsTrash('/Volumes/Macintosh HD/Users/vicent/a.aiff', {
        statfs: () => ({ type: 26 }),
      }),
    ).toBe(true)
  })

  // Unanswerable must read as "no promise": a wrong "recoverable" is what costs a file,
  // while a wrong warning only makes the user pause.
  it('makes no promise when the filesystem cannot be inspected', () => {
    expect(
      volumeKeepsTrash('/Volumes/Gone/a.mp3', {
        statfs: () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        },
      }),
    ).toBe(false)
  })

  // The check walks up to the nearest existing directory: the file itself is often already
  // gone by the time a caller asks, and its folder answers for the same volume.
  it('asks about the containing folder when the file itself is gone', () => {
    const statfs = vi.fn((p: string) => {
      if (p.endsWith('.mp3')) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return { type: 30 }
    })

    expect(volumeKeepsTrash('/Volumes/Public/Music/a.mp3', { statfs })).toBe(false)
    expect(statfs).toHaveBeenCalledTimes(2)
  })

  // libuv answers statfs on Windows with type 0 for every drive, local or mapped. Node
  // cannot tell a local NTFS drive from a mapped share or a USB stick (no Recycle Bin on
  // either) without a native call, so Windows makes no promise and a delete goes to
  // Surco's backups. Wrong in the safe direction: a local file the Recycle Bin would have
  // taken waits in the backups instead.
  it('makes no promise for a Windows drive, whose statfs type is always 0', () => {
    expect(volumeKeepsTrash('C:\\Users\\me\\Music\\a.mp3', { statfs: () => ({ type: 0 }) })).toBe(
      false,
    )
  })
})
