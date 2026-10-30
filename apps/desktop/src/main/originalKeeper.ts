import { existsSync } from 'node:fs'
import { type BackupPolicy, keepsBackup } from '../shared/backupPolicy'
import { errorWithKey } from '../shared/errorKeys'
import type { TrashEntry, TrashReason } from '../shared/types'
import type { HeldOriginal, Verification } from '../shared/verification'

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
  // A file that stays on its path, playing in Music while Music rewrites it: short of
  // room it is not sent to the system Trash, which would take it from under the entry.
  staysInPlace?: boolean
  // The original a conversion writes over. Under 'never' it is kept anyway until the
  // checks of the new file answer (settleHeldOriginal), which happens after it is gone.
  untilChecked?: boolean
}

export type OriginalKeeper = (
  path: string,
  reason: TrashReason,
  outputPath?: string,
  ctx?: KeepContext,
) => Promise<TrashEntry | null>

let keeper: OriginalKeeper | null = null
let livePolicy: (() => BackupPolicy) | null = null
// The originals held under 'never', by the file written over them: null when Copias had no
// room. `settled` once the checks found something wrong, after which it is a copy like any.
const held = new Map<string, { entry: TrashEntry | null; settled?: HeldOriginal }>()
const heldKey = (outputPath: string) => outputPath.normalize('NFC')

export function configureOriginalKeeper(next: OriginalKeeper | null): void {
  keeper = next
  held.clear()
}

// Wraps the real store with the user's setting, so ONE decision covers all three write
// paths. Applying it at each call site instead is what let "Never" archive a format
// change and a NAS delete anyway: the setting named one behaviour and two of the three
// paths ignored it.
//
// `policy` is a getter, not a value: Settings is saved while the app runs, and a keeper
// built at launch would otherwise honour the value the app started with until restart.
export function policyKeeper(
  policy: () => BackupPolicy,
  stash: OriginalKeeper,
  noRoom?: (path: string) => Promise<void>,
): OriginalKeeper {
  return async (path, reason, outputPath, ctx) => {
    // No conversion to judge (a format change's leftover, a delete): nothing was
    // re-encoded, but nothing can be re-run either, so only 'never' skips these.
    const reencodes = ctx?.reencodes ?? true
    if (!ctx?.regardlessOfPolicy && !keepsBackup(policy(), { reencodes })) {
      if (!ctx?.untilChecked || !outputPath || policy() !== 'never') return null
      const entry = await stash(path, reason, outputPath, ctx)
      held.set(heldKey(outputPath), { entry })
      return entry
    }
    const kept = await stash(path, reason, outputPath, ctx)
    if (!kept && !ctx?.regardlessOfPolicy && !ctx?.staysInPlace && noRoom && existsSync(path))
      await noRoom(path)
    return kept
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

// Music rewrites an entry's file as soon as a tag is set on it, so that file is copied
// first, under the setting the write it stands for follows: a tag-only rewrite unless the
// caller says the audio changed. A copy the setting asks for and the room refuses stops
// the rewrite rather than letting Music change the file with no way back.
export async function keepBeforeMusicRewrite(
  path: string,
  { outputPath = path, reencodes = false }: { outputPath?: string; reencodes?: boolean } = {},
): Promise<TrashEntry | null> {
  const kept = await keepOriginal(path, 'replaced', outputPath, { reencodes, staysInPlace: true })
  if (!kept && keeper && existsSync(path) && keepsBackup(currentBackupPolicy(), { reencodes }))
    throw errorWithKey('noRoomBeforeMusicRewrite', path)
  return kept
}

// A replaced original is backed up by copy and never leaves its path, so a write that
// fails leaves the user's file untouched and the copy is just a duplicate to drop.
export type BackupDiscarder = (entry: TrashEntry) => Promise<void>

let discarder: BackupDiscarder | null = null

export function configureBackupDiscarder(next: BackupDiscarder | null): void {
  discarder = next
}

export async function discardBackup(entry: TrashEntry): Promise<void> {
  for (const [key, hold] of held) if (hold.entry?.id === entry.id) held.delete(key)
  if (discarder) await discarder(entry)
}

// The checks' word on the file written at `outputPath`. Everything adding up drops the
// held original, as 'never' asks; something wrong keeps it for good, and says whether it is
// there. No word at all (the app quit, a library that never answered) leaves it in Copias.
export function settleHeldOriginal(
  outputPath: string,
  status: Verification['status'],
): HeldOriginal | undefined {
  const hold = held.get(heldKey(outputPath))
  if (!hold || hold.settled) return hold?.settled
  if (status === 'mismatch') hold.settled = hold.entry ? 'kept' : 'noRoom'
  if (status === 'ok') {
    held.delete(heldKey(outputPath))
    if (hold.entry) void discardBackup(hold.entry).catch(() => undefined)
  }
  return hold.settled
}

// What launch installs: the real store behind the user's setting, and the same store
// for dropping a copy a failed write no longer needs.
export function configureBackupStore(
  store: {
    stash: (path: string, reason: TrashReason, outputPath?: string) => Promise<TrashEntry | null>
    remove: (id: string) => Promise<void>
  },
  policy: () => BackupPolicy,
  noRoom?: (path: string) => Promise<void>,
): void {
  livePolicy = policy
  configureOriginalKeeper(
    policyKeeper(
      policy,
      (path, reason, outputPath) => store.stash(path, reason, outputPath),
      noRoom,
    ),
  )
  configureBackupDiscarder((entry) => store.remove(entry.id))
}

// Unconfigured it answers the level that never allows a delete for good.
export function currentBackupPolicy(): BackupPolicy {
  return livePolicy?.() ?? 'always'
}
