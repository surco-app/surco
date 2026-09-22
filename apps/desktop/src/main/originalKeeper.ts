import { type BackupPolicy, keepsBackup } from '../shared/backupPolicy'
import type { TrashEntry, TrashReason } from '../shared/types'

// The seam between the write paths and Surco's Originals. convertAudio,
// removeRenamedOriginal and the shell's delete call keepOriginal at the moment a user's
// file is about to be replaced, renamed away or deleted; index.ts points it at the real
// store at launch. Unconfigured — every unit test that drives a conversion — it keeps
// nothing and answers null, and the callers fall back to what they did before: rename
// over, unlink.

// What the conversion did to the audio, when there was one. Absent for the paths where
// no encode happened (a format change's leftover, a delete): those have nothing to judge
// and are always worth keeping, since their original cannot be reproduced by re-running
// anything.
export interface KeepContext {
  reencodes: boolean
}

export type OriginalKeeper = (
  path: string,
  reason: TrashReason,
  outputPath?: string,
  ctx?: KeepContext,
) => Promise<TrashEntry | null>

let keeper: OriginalKeeper | null = null

export function configureOriginalKeeper(next: OriginalKeeper | null): void {
  keeper = next
}

// Wraps the real store with the user's setting, so ONE decision covers all three write
// paths. Applying it at each call site instead is what let "Never" archive a format
// change and a NAS delete anyway: the setting named one behaviour and two of the three
// paths ignored it.
//
// `policy` is a getter, not a value: Settings is saved while the app runs, and a keeper
// built at launch would otherwise honour the value the app started with until restart.
export function policyKeeper(policy: () => BackupPolicy, stash: OriginalKeeper): OriginalKeeper {
  return async (path, reason, outputPath, ctx) => {
    // No conversion to judge (a format change's leftover, a delete): nothing was
    // re-encoded, but nothing can be re-run either, so only 'never' skips these.
    const reencodes = ctx?.reencodes ?? true
    if (!keepsBackup(policy(), { reencodes })) return null
    return stash(path, reason, outputPath, ctx)
  }
}

export async function keepOriginal(
  path: string,
  reason: TrashReason,
  outputPath?: string,
  ctx?: KeepContext,
): Promise<TrashEntry | null> {
  return keeper ? keeper(path, reason, outputPath, ctx) : null
}

// The way back for a write that archived the original and then failed: without it the
// user's file is gone from its folder and survives only in Originals, which empties itself.
export type OriginalRestorer = (entry: TrashEntry) => Promise<void>

let restorer: OriginalRestorer | null = null

export function configureOriginalRestorer(next: OriginalRestorer | null): void {
  restorer = next
}

export async function restoreOriginal(entry: TrashEntry): Promise<void> {
  if (restorer) await restorer(entry)
}
