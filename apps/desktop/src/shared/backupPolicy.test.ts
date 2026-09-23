import { describe, expect, it } from 'vitest'
import {
  BACKUP_POLICIES,
  type BackupPolicy,
  keepsBackup,
  sanitizeMaxGb,
  sanitizeRetentionDays,
  trashLimits,
} from './backupPolicy'
import { TRASH_MAX_BYTES, TRASH_RETENTION_DAYS } from './trash'

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

describe('sanitizeRetentionDays', () => {
  it('keeps a whole number of days inside the allowed range', () => {
    expect(sanitizeRetentionDays(7)).toBe(7)
    expect(sanitizeRetentionDays('14')).toBe(14)
  })

  // The field is a text input the user can empty or paste rubbish into, and a NaN would
  // reach the sweep as "now - NaN > NaN", which drops nothing and silently disables the
  // retention the user thinks they set.
  it('falls back to the default for anything that is not a number', () => {
    expect(sanitizeRetentionDays('')).toBe(TRASH_RETENTION_DAYS)
    expect(sanitizeRetentionDays('abc')).toBe(TRASH_RETENTION_DAYS)
    expect(sanitizeRetentionDays(Number.NaN)).toBe(TRASH_RETENTION_DAYS)
  })

  // Zero would sweep a file away the moment it was stashed, which is "never keep
  // anything" said in a way the Never level already says clearly.
  it('clamps to at least a day and at most a year', () => {
    expect(sanitizeRetentionDays(0)).toBe(1)
    expect(sanitizeRetentionDays(-5)).toBe(1)
    expect(sanitizeRetentionDays(9999)).toBe(365)
    expect(sanitizeRetentionDays(2.7)).toBe(3)
  })
})

describe('sanitizeMaxGb', () => {
  it('keeps a size inside the allowed range', () => {
    expect(sanitizeMaxGb(25)).toBe(25)
    expect(sanitizeMaxGb('0.5')).toBe(0.5)
  })

  it('falls back to the default for anything that is not a number', () => {
    expect(sanitizeMaxGb('')).toBe(TRASH_MAX_BYTES / 1024 ** 3)
    expect(sanitizeMaxGb('abc')).toBe(TRASH_MAX_BYTES / 1024 ** 3)
  })

  // A cap of zero sweeps every entry on the next launch, so the smallest useful value is
  // a tenth of a gigabyte — enough for one track, which is the point of the feature.
  it('clamps to a tenth of a gigabyte at the bottom and a terabyte at the top', () => {
    expect(sanitizeMaxGb(0)).toBe(0.1)
    expect(sanitizeMaxGb(-3)).toBe(0.1)
    expect(sanitizeMaxGb(99999)).toBe(1024)
  })
})

// The setting is in gigabytes and the sweep counts bytes; main's sweep and the panel's
// meter both read these, so a unit slip in either would disagree with the other.
describe('trashLimits', () => {
  it('turns the settings into the retention and the byte cap the sweep uses', () => {
    expect(trashLimits({ backupRetentionDays: 14, backupMaxGb: 2 })).toEqual({
      retentionDays: 14,
      maxBytes: 2 * 1024 ** 3,
    })
  })
})
