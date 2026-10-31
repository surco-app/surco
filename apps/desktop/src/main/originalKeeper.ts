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
  // Set by policyKeeper on that copy: the store pins it, evicting nothing for it.
  held?: boolean
}

export type OriginalKeeper = (
  path: string,
  reason: TrashReason,
  outputPath?: string,
  ctx?: KeepContext,
) => Promise<TrashEntry | null>

let keeper: OriginalKeeper | null = null
let livePolicy: (() => BackupPolicy) | null = null
// The originals held under 'never', by a token the job that wrote over them claims, so a
// late word about an earlier job on the same path cannot settle them. `entry` is null when
// Copias had no room. `unclaimed` is the hold each output path is waiting to hand over.
const holds = new Map<string, { key: string; entry: TrashEntry | null }>()
const unclaimed = new Map<string, string>()
let holdCount = 0
let releaser: ((id: string) => void) | null = null
const heldKey = (outputPath: string) => outputPath.normalize('NFC')

export function configureOriginalKeeper(next: OriginalKeeper | null): void {
  keeper = next
  holds.clear()
  unclaimed.clear()
  releaser = null
}

// The same path written over again before its verdict: the earlier original stays, as a
// copy like any other, and only the new one waits for the checks.
async function holdUntilChecked(
  stash: OriginalKeeper,
  path: string,
  reason: TrashReason,
  outputPath: string,
  ctx: KeepContext,
): Promise<TrashEntry | null> {
  const key = heldKey(outputPath)
  for (const [token, hold] of holds)
    if (hold.key === key) {
      holds.delete(token)
      if (hold.entry) releaser?.(hold.entry.id)
    }
  const entry = await stash(path, reason, outputPath, { ...ctx, held: true }).catch(() => null)
  const token = `held-${++holdCount}`
  holds.set(token, { key, entry })
  unclaimed.set(key, token)
  return entry
}

// What the job that wrote `outputPath` hands its checks, once: the hold it left there.
export function claimHeldOriginal(outputPath: string): string | undefined {
  const token = unclaimed.get(heldKey(outputPath))
  unclaimed.delete(heldKey(outputPath))
  return token
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
      if (!ctx?.untilChecked || !reencodes || !outputPath || policy() !== 'never') return null
      return holdUntilChecked(stash, path, reason, outputPath, ctx)
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
  for (const [token, hold] of holds) if (hold.entry?.id === entry.id) holds.delete(token)
  if (discarder) await discarder(entry)
}

// The checks' word on a held original. Everything adding up drops it, as 'never' asks,
// even after a retry cleared a mismatch; something wrong frees it to stay like any copy,
// and says so only while it is really there. No word at all (the app quit, a library that
// never answered) leaves it in Copias.
export function settleHeldOriginal(
  token: string | undefined,
  status: Verification['status'],
): HeldOriginal | undefined {
  const hold = token ? holds.get(token) : undefined
  if (!token || !hold) return undefined
  if (status === 'ok') {
    holds.delete(token)
    if (hold.entry) void discardBackup(hold.entry).catch(() => undefined)
    return undefined
  }
  if (status !== 'mismatch') return undefined
  if (!hold.entry) return 'noRoom'
  releaser?.(hold.entry.id)
  return existsSync(hold.entry.storedPath) ? 'kept' : undefined
}

// What launch installs: the real store behind the user's setting, and the same store
// for dropping a copy a failed write no longer needs.
export function configureBackupStore(
  store: {
    stash: (
      path: string,
      reason: TrashReason,
      outputPath?: string,
      trashedAt?: number,
      held?: boolean,
    ) => Promise<TrashEntry | null>
    remove: (id: string) => Promise<void>
    release?: (id: string) => void
  },
  policy: () => BackupPolicy,
  noRoom?: (path: string) => Promise<void>,
): void {
  livePolicy = policy
  configureOriginalKeeper(
    policyKeeper(
      policy,
      (path, reason, outputPath, ctx) =>
        ctx?.held
          ? store.stash(path, reason, outputPath, undefined, true)
          : store.stash(path, reason, outputPath),
      noRoom,
    ),
  )
  releaser = store.release ?? null
  configureBackupDiscarder((entry) => store.remove(entry.id))
}

// Unconfigured it answers the level that never allows a delete for good.
export function currentBackupPolicy(): BackupPolicy {
  return livePolicy?.() ?? 'always'
}
