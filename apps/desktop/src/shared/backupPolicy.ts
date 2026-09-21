// Whether an in-place rewrite stashes the file it is about to replace. Only the
// overwrite destination can reach this: every other destination writes a new file and
// leaves the source alone, so there is nothing to back up.
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
