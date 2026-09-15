import { describe, expect, it } from 'vitest'
import { trashIsRecoverable } from './trashGuarantee'

// Whether sending a file to the Trash can be promised as recoverable.
//
// Measured 15/09 on the user's own machine, after a delete that vanished: their music
// lives on a NAS mounted as
//   //GUEST:@MyCloud._smb._tcp.local/Public on /Volumes/Public (smbfs, nodev, nosuid, noowners)
// with no .Trashes folder. macOS cannot move to a Trash there, so the delete was permanent
// while the dialog promised "you can restore it from the Trash". The wording has to stop
// claiming what the volume cannot honour — the action itself is unchanged.

describe('trashIsRecoverable', () => {
  // The ordinary case: a local path has a Trash and the promise holds.
  it('promises recovery for a file in the user home', () => {
    expect(trashIsRecoverable('/Users/vicent/Music/Surco/track.aiff', 'darwin')).toBe(true)
  })

  // The user's own case. Everything under /Volumes is a mounted volume, and a network
  // mount is exactly where the Trash may not exist.
  it('makes no promise for a file on a mounted volume', () => {
    expect(trashIsRecoverable('/Volumes/Public/Music/Transfer/02 Possession.mp3', 'darwin')).toBe(
      false,
    )
  })

  // Windows keeps a Recycle Bin per drive, including mapped network drives, so the
  // /Volumes rule is macOS-only and must not leak into the Windows wording.
  it('promises recovery on Windows regardless of the path', () => {
    expect(trashIsRecoverable('Z:\\Music\\track.mp3', 'win32')).toBe(true)
  })

  // Linux desktops put the Trash on the same filesystem, and a remote mount often has
  // none — same uncertainty as macOS, so no promise either.
  it('makes no promise for a remote mount on Linux', () => {
    expect(trashIsRecoverable('/mnt/nas/music/track.mp3', 'linux')).toBe(false)
    expect(trashIsRecoverable('/media/nas/music/track.mp3', 'linux')).toBe(false)
  })

  it('promises recovery for a local path on Linux', () => {
    expect(trashIsRecoverable('/home/vicent/Music/track.mp3', 'linux')).toBe(true)
  })

  // A path Surco cannot classify must not carry a promise it may not keep: the safe
  // wording is the cautious one.
  it('makes no promise for an empty path', () => {
    expect(trashIsRecoverable('', 'darwin')).toBe(false)
  })
})
