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
}

export async function flushRekordboxSync(deps: FlushRekordboxDeps): Promise<FlushResult> {
  const repoints = deps.endBatch()
  if (!deps.collectionPath || repoints.length === 0) return { written: 0, skipped: [] }

  let written = 0
  const skipped: SkippedRepoint[] = []

  for (const repoint of repoints) {
    const result = await deps.repointTrack(deps.collectionPath, repoint)
    if (result.written) {
      written += 1
      continue
    }
    if (COLLECTION_WIDE.has(result.reason)) {
      return { written, blocked: result.reason, skipped }
    }
    // A track the collection never had is the common case for a partly-imported library,
    // not something to put in front of the user.
    if (result.reason === 'no-match') continue
    skipped.push({ track: repoint.to, reason: result.reason })
  }

  return { written, skipped }
}
