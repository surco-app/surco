import { describe, expect, it } from 'vitest'
import { BACKUP_POLICIES, type BackupPolicy, keepsBackup } from './backupPolicy'

describe('keepsBackup', () => {
  // The default, and what Surco did before the setting existed: every in-place rewrite
  // is undoable. Four defects in one week (17/09/2026) cost users the file instead of a
  // redo, which is why the trash exists at all.
  it('keeps a copy for every rewrite under "always"', () => {
    expect(keepsBackup('always', { reencodes: true })).toBe(true)
    expect(keepsBackup('always', { reencodes: false })).toBe(true)
  })

  // The case this setting was added for (21/09/2026): an AIFF rewritten as AIFF to edit
  // its tags stream-copies the audio, and archiving 65 MB of identical samples on every
  // metadata edit fills the 10 GB cap with copies of files that were never at risk of
  // sounding different.
  it('skips the copy under "audioChanges" when the audio is only copied through', () => {
    expect(keepsBackup('audioChanges', { reencodes: false })).toBe(false)
  })

  // A re-encode resamples, requantizes or applies a filter: the original samples cannot
  // be reconstructed from the result, so this is the case the backup exists for.
  it('keeps the copy under "audioChanges" when the audio is re-encoded', () => {
    expect(keepsBackup('audioChanges', { reencodes: true })).toBe(true)
  })

  // The only setting that removes the net. A failed write then costs the file, which is
  // the user's call to make — but it must be exactly what it says, with no hidden
  // exception that quietly keeps writing copies.
  it('never keeps a copy under "never"', () => {
    expect(keepsBackup('never', { reencodes: true })).toBe(false)
    expect(keepsBackup('never', { reencodes: false })).toBe(false)
  })
})

describe('BACKUP_POLICIES', () => {
  // The order the segmented control renders, safest first, so the row reads as a
  // spectrum from most protection to none rather than an arbitrary list.
  it('runs from the most protective to the least', () => {
    expect(BACKUP_POLICIES).toEqual<BackupPolicy[]>(['always', 'audioChanges', 'never'])
  })
})
