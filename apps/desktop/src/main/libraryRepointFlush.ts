import type { RekordboxSyncIssue } from '../shared/types'
import type { Activity } from './activity'
import type { RekordboxRepoint } from './rekordboxBatch'

// Applies a run's accumulated repoints to a DJ library, lifted out of the IPC handler so
// it can be tested without booting Electron — the same shape traktorSyncFlush.ts uses.
// This only sequences the outcomes; every collaborator that touches the disk arrives
// through deps, and the wording through keys, so rekordbox and Engine DJ share it.

// What a library's writer says about one track: the shape rekordbox's and Engine DJ's
// writers share, with each free to name its own reasons.
export type LibraryRepointResult = { written: true } | { written: false; reason: string }

export interface SkippedRepoint {
  track: string
  reason: string
}

export interface FlushResult {
  written: number
  skipped: SkippedRepoint[]
  // Set when the whole flush stopped, so the caller can say so once rather than listing
  // every track that never got its turn.
  blocked?: string
}

// The library's own wording in the Activity panel, as i18n keys, and the reason its writer
// gives when the app that owns the library is open.
export interface RepointKeys {
  step: string
  written: string
  skipped: string
  nothing: string
  running: string
  backupFailed: string
  readOnly: string
  unreadable: string
  writeFailed: string
  runningReason: string
}

export interface FlushLibraryDeps<T = RekordboxRepoint> {
  // Empty when the user does not use this library, or pointed the setting at nothing.
  collectionPath: string
  // Closes this run's begin/end pair and returns what it accumulated — empty when this
  // end was nested inside a still-open outer batch, which flushes later.
  endBatch: () => T[]
  // The whole run in one pass over the library, with an outcome per track in the order
  // given.
  repointTracks: (
    collectionPath: string,
    repoints: T[],
  ) => Promise<LibraryRepointResult[]>
  // Puts the repoint in the Activity panel as its own step. Reported 15/09: the panel
  // showed the conversion and the Apple Music add and said nothing about rekordbox, so a
  // collection that was never updated looked exactly like one that was.
  track?: Activity['track']
  // Resolves true once the owning app is confirmed closed (possibly because the user
  // accepted closing it here); false when it is running and the user declined. Absent
  // means the caller does not offer to close it, and the per-track guard is the only
  // protection.
  ensureClosed?: () => Promise<boolean>
  // Shown only when the owning app being open is what stopped the run — the one blocked
  // reason the user can act on right there, by closing it. Reported 15/09: a replacement
  // left the collection on the old MP3 with no indication why, because the refusal went to
  // the log alone and a refusal nobody sees reads as the feature being broken.
  showBlockedDialog?: () => void
  // Everything else the run could not do, told once after it: a library that stopped the
  // run for another reason, and the tracks it holds under more than one entry. Neither is
  // fixable mid-convert, which is why it is a notice and not a dialog, but left to the log
  // the library stayed on the old file while the run looked like it had worked.
  reportIssue?: (issue: RekordboxSyncIssue) => void
  // How a skipped item is named in the notice. Absent means a repoint, named by the file
  // it moves to; any other kind of change has to say what names it.
  labelOf?: (item: T) => string
}

// Reasons that describe the library rather than one track: retrying them for each
// remaining track would repeat a single failure hundreds of times and bury the cause. The
// run stops at the first one and reports it once.
function collectionWide(keys: RepointKeys): ReadonlySet<string> {
  return new Set([keys.runningReason, 'backup-failed', 'read-only', 'unreadable', 'write-failed'])
}

// What the Activity panel says for a run that wrote nothing because of the library itself.
// Only the app being open names something the user can act on, but each of these stops the
// whole run, so each needs its own line rather than a bare "nothing happened".
function blockedKey(keys: RepointKeys, reason: string): string {
  const byReason: Record<string, string> = {
    [keys.runningReason]: keys.running,
    'backup-failed': keys.backupFailed,
    'read-only': keys.readOnly,
    unreadable: keys.unreadable,
    'write-failed': keys.writeFailed,
  }
  return byReason[reason] ?? keys.unreadable
}

// What the Activity panel shows once the repoint finishes. The count is the point of the
// step: a row that only says "done" leaves the user opening the library to find out whether
// anything happened, which is exactly what they had to do.
function summaryOf(
  keys: RepointKeys,
  result: FlushResult,
): { detailKey: string; detailParams?: { count: number } } {
  if (result.blocked) return { detailKey: blockedKey(keys, result.blocked) }
  if (result.written > 0) {
    return { detailKey: keys.written, detailParams: { count: result.written } }
  }
  if (result.skipped.length > 0) {
    return { detailKey: keys.skipped, detailParams: { count: result.skipped.length } }
  }
  // Nothing written and nothing skipped: every track was a no-match, the ordinary outcome
  // for a library that only partly imported the user's music.
  return { detailKey: keys.nothing }
}

export async function flushLibraryRepoints<T = RekordboxRepoint>(
  deps: FlushLibraryDeps<T>,
  keys: RepointKeys,
): Promise<FlushResult> {
  const repoints = deps.endBatch()
  if (!deps.collectionPath || repoints.length === 0) return { written: 0, skipped: [] }
  // Wrapped only once there is real work: a run whose tracks the library never had would
  // otherwise put an empty "0 tracks" row in the panel on every single convert.
  if (!deps.track) return runRepoints(deps, keys, repoints)
  return deps.track('export', keys.step, () => runRepoints(deps, keys, repoints), {
    summary: (result: FlushResult) => summaryOf(keys, result),
  })
}

async function runRepoints<T>(
  deps: FlushLibraryDeps<T>,
  keys: RepointKeys,
  repoints: T[],
): Promise<FlushResult> {
  // Asked once, before anything is written, and only when there is actually something to
  // repoint. Warning afterwards is too late: the conversion has finished by then and the
  // repoint is lost, so the user has to convert the track all over again. No warning on
  // decline — they just answered that question in the prompt.
  if (deps.ensureClosed && !(await deps.ensureClosed())) {
    return { written: 0, blocked: keys.runningReason, skipped: [] }
  }

  let written = 0
  const skipped: SkippedRepoint[] = []
  const wide = collectionWide(keys)

  const results = await deps.repointTracks(deps.collectionPath, repoints)
  for (const [i, repoint] of repoints.entries()) {
    const result = results[i]
    if (result.written) {
      written += 1
      continue
    }
    if (wide.has(result.reason)) {
      if (result.reason === keys.runningReason) deps.showBlockedDialog?.()
      else
        deps.reportIssue?.({
          blocked: result.reason as RekordboxSyncIssue['blocked'],
          ambiguous: ambiguousOf(skipped),
        })
      return { written, blocked: result.reason, skipped }
    }
    // A track the library never had is the common case for a partly-imported library,
    // not something to put in front of the user.
    if (result.reason === 'no-match') continue
    skipped.push({
      track: deps.labelOf ? deps.labelOf(repoint) : (repoint as unknown as RekordboxRepoint).to,
      reason: result.reason,
    })
  }

  const ambiguous = ambiguousOf(skipped)
  if (ambiguous.length > 0) deps.reportIssue?.({ ambiguous })
  return { written, skipped }
}

function ambiguousOf(skipped: SkippedRepoint[]): string[] {
  return skipped.filter((s) => s.reason === 'ambiguous').map((s) => s.track)
}
