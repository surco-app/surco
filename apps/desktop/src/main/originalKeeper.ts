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
  reencodes?: boolean
  // A write whose own promise rests on the copy: the review's Undo, a removal the user
  // never phrased as a delete for good. The setting does not get to break that promise.
  regardlessOfPolicy?: boolean
}

export type OriginalKeeper = (
  path: string,
  reason: TrashReason,
  outputPath?: string,
  ctx?: KeepContext,
) => Promise<TrashEntry | null>

let keeper: OriginalKeeper | null = null
let livePolicy: (() => BackupPolicy) | null = null

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
    if (!ctx?.regardlessOfPolicy && !keepsBackup(policy(), { reencodes })) return null
    return stash(path, reason, outputPath, ctx)
  }
}

// Whether a null from keepOriginal means "refused" rather than "nothing to keep with".
// A write that promises a backup has to stop on a refusal, and still run in the unit
// tests that never configure a store.
export function hasOriginalKeeper(): boolean {
  return keeper !== null
}

export async function keepOriginal(
  path: string,
  reason: TrashReason,
  outputPath?: string,
  ctx?: KeepContext,
): Promise<TrashEntry | null> {
  return keeper ? keeper(path, reason, outputPath, ctx) : null
}

// A replaced original is backed up by copy and never leaves its path, so a write that
// fails leaves the user's file untouched and the copy is just a duplicate to drop.
export type BackupDiscarder = (entry: TrashEntry) => Promise<void>

let discarder: BackupDiscarder | null = null

export function configureBackupDiscarder(next: BackupDiscarder | null): void {
  discarder = next
}

export async function discardBackup(entry: TrashEntry): Promise<void> {
  if (discarder) await discarder(entry)
}

// What launch installs: the real store behind the user's setting, and the same store
// for dropping a copy a failed write no longer needs.
export function configureBackupStore(
  store: {
    stash: (path: string, reason: TrashReason, outputPath?: string) => Promise<TrashEntry | null>
    remove: (id: string) => Promise<void>
  },
  policy: () => BackupPolicy,
): void {
  livePolicy = policy
  configureOriginalKeeper(
    policyKeeper(policy, (path, reason, outputPath) => store.stash(path, reason, outputPath)),
  )
  configureBackupDiscarder((entry) => store.remove(entry.id))
}

// Unconfigured it answers the level that never allows a delete for good.
export function currentBackupPolicy(): BackupPolicy {
  return livePolicy?.() ?? 'always'
}
