import type { Activity } from './activity'
import type { RekordboxRepoint } from './rekordboxBatch'
import type { RepointResult } from './rekordboxLibrary'

// Applies a run's accumulated repoints to the collection, lifted out of the IPC handler
// so it can be tested without booting Electron — the same shape traktorSyncFlush.ts uses.
// This only sequences the outcomes; every collaborator that touches the disk arrives
// through deps.

// Reasons that describe the collection rather than one track: retrying them for each
// remaining track would repeat a single failure hundreds of times and bury the cause. The
// run stops at the first one and reports it once.
const COLLECTION_WIDE: ReadonlySet<string> = new Set([
  'rekordbox-running',
  'backup-failed',
  'read-only',
  'unreadable',
  'write-failed',
])

// What the Activity panel says for a run that wrote nothing because of the collection
// itself. Only 'rekordbox-running' names something the user can act on, but each of these
// stops the whole run, so each needs its own line rather than a bare "nothing happened".
const BLOCKED_KEYS: Record<string, string> = {
  'rekordbox-running': 'activity.rekordboxSyncRunning',
  'backup-failed': 'activity.rekordboxSyncBackupFailed',
  'read-only': 'activity.rekordboxSyncReadOnly',
  unreadable: 'activity.rekordboxSyncUnreadable',
  'write-failed': 'activity.rekordboxSyncWriteFailed',
}

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

export interface FlushRekordboxDeps {
  // Empty when the user does not run rekordbox, or pointed the setting at nothing.
  collectionPath: string
  // Closes this run's begin/end pair and returns what it accumulated — empty when this
  // end was nested inside a still-open outer batch, which flushes later.
  endBatch: () => RekordboxRepoint[]
  repointTrack: (collectionPath: string, repoint: RekordboxRepoint) => Promise<RepointResult>
  // Puts the repoint in the Activity panel as its own step. Reported 15/09: the panel
  // showed the conversion and the Apple Music add and said nothing about rekordbox, so a
  // collection that was never updated looked exactly like one that was.
  track?: Activity['track']
  // Resolves true once rekordbox is confirmed closed (possibly because the user accepted
  // closing it here); false when it is running and the user declined. Absent means the
  // caller does not offer to close it, and the per-track guard is the only protection.
  ensureClosed?: () => Promise<boolean>
  // Shown only when rekordbox being open is what stopped the run — the one blocked reason
  // the user can act on. Reported 15/09: a replacement left the collection on the old MP3
  // with no indication why, because the refusal went to the log alone and a refusal nobody
  // sees reads as the feature being broken. The other collection-wide reasons stay silent:
  // a dialog about an unreadable or read-only file, on every convert, names nothing the
  // user can fix.
  showBlockedDialog?: () => void
}

// What the Activity panel shows once the repoint finishes. The count is the point of the
// step: a row that only says "done" leaves the user opening rekordbox to find out whether
// anything happened, which is exactly what they had to do.
function summaryOf(result: FlushResult): { detailKey: string; detailParams?: { count: number } } {
  if (result.blocked) {
    return { detailKey: BLOCKED_KEYS[result.blocked] ?? 'activity.rekordboxSyncUnreadable' }
  }
  if (result.written > 0) {
    return {
      detailKey: 'activity.rekordboxSyncWritten',
      detailParams: { count: result.written },
    }
  }
  if (result.skipped.length > 0) {
    return {
      detailKey: 'activity.rekordboxSyncSkipped',
      detailParams: { count: result.skipped.length },
    }
  }
  // Nothing written and nothing skipped: every track was a no-match, the ordinary outcome
  // for a library rekordbox only partly imported.
  return { detailKey: 'activity.rekordboxSyncNothing' }
}

export async function flushRekordboxSync(deps: FlushRekordboxDeps): Promise<FlushResult> {
  const repoints = deps.endBatch()
  if (!deps.collectionPath || repoints.length === 0) return { written: 0, skipped: [] }
  // Wrapped only once there is real work: a run whose tracks rekordbox never had would
  // otherwise put an empty "0 tracks" row in the panel on every single convert.
  if (!deps.track) return runRepoints(deps, repoints)
  return deps.track('export', 'activity.rekordboxSync', () => runRepoints(deps, repoints), {
    summary: summaryOf,
  })
}

async function runRepoints(
  deps: FlushRekordboxDeps,
  repoints: RekordboxRepoint[],
): Promise<FlushResult> {
  // Asked once, before anything is written, and only when there is actually something to
  // repoint. Warning afterwards is too late: the conversion has finished by then and the
  // repoint is lost, so the user has to convert the track all over again. No warning on
  // decline — they just answered that question in the prompt.
  if (deps.ensureClosed && !(await deps.ensureClosed())) {
    return { written: 0, blocked: 'rekordbox-running', skipped: [] }
  }

  let written = 0
  const skipped: SkippedRepoint[] = []

  for (const repoint of repoints) {
    const result = await deps.repointTrack(deps.collectionPath, repoint)
    if (result.written) {
      written += 1
      continue
    }
    if (COLLECTION_WIDE.has(result.reason)) {
      if (result.reason === 'rekordbox-running') deps.showBlockedDialog?.()
      return { written, blocked: result.reason, skipped }
    }
    // A track the collection never had is the common case for a partly-imported library,
    // not something to put in front of the user.
    if (result.reason === 'no-match') continue
    skipped.push({ track: repoint.to, reason: result.reason })
  }

  return { written, skipped }
}
