import { TRASH_MAX_BYTES, TRASH_RETENTION_DAYS } from './trash'

// Whether a write path stashes the file it is about to replace, rename away or delete.
// Three paths reach it — a rewrite onto the source's own path, the old-extension file a
// format change leaves behind, and a delete on a volume with no OS Trash — and one
// setting governs all three, applied on the keeper seam (originalKeeper.ts) rather than
// at each call site, which is what let two of them ignore it.
//
// The middle level exists because a rewrite is not one thing. Editing tags on a file
// already in the target format stream-copies the audio — the samples come out byte for
// byte — so the archived copy differs from the new file only in its tag block, at the
// cost of the whole file's size. A DJ updating a crate filled the 10 GB cap with those.
// A re-encode is the opposite: resampled, requantized or filtered, the original samples
// are gone for good if the write goes wrong.
export type BackupPolicy = 'always' | 'audioChanges' | 'never'

// Safest first, which is the order the settings row renders.
export const BACKUP_POLICIES: BackupPolicy[] = ['always', 'audioChanges', 'never']

// `reencodes` is the conversion plan's own verdict (plan.codec !== 'copy'), not a guess:
// it is false exactly when ffmpeg copies the audio stream through untouched, and the
// planner already turns it off for normalize, declick, trim and the editor's explicit
// re-encode. Note it says nothing about the FILE being unchanged — the tag pass rewrites
// it either way — only about the audio being re-rendered, which is what the copy insures
// against.
export function keepsBackup(policy: BackupPolicy, { reencodes }: { reencodes: boolean }): boolean {
  if (policy === 'never') return false
  if (policy === 'audioChanges') return reencodes
  return true
}

// The user's limits, sanitized. They arrive from a text field, so anything can be in
// them; a NaN would reach the sweep as "now - NaN > NaN", dropping nothing and quietly
// disabling the retention the user believes they set.
//
// The floors are what keeps the numbers from becoming a second, hidden "never": a
// retention of zero days, or a cap of zero bytes, sweeps a file away the moment it is
// stashed. That choice has its own level, stated plainly and with a warning.
const DAY_MIN = 1
const DAY_MAX = 365
const GB_MIN = 0.1
const GB_MAX = 1024

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function sanitizeRetentionDays(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || value === '' || value === null) return TRASH_RETENTION_DAYS
  return clamp(Math.round(n), DAY_MIN, DAY_MAX)
}

export function sanitizeMaxGb(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || value === '' || value === null) return TRASH_MAX_BYTES / 1024 ** 3
  return clamp(n, GB_MIN, GB_MAX)
}
