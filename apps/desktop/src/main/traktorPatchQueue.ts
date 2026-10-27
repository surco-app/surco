import type { RekordboxQueueState } from '../shared/types'
import type { LibraryRepointResult } from './libraryRepointFlush'
import type { RekordboxQueue } from './rekordboxQueue'
import type { NmlPatch } from './traktorNml'
import type { SyncResult } from './traktorNmlLibrary'

// A conversion's collection patch kept in the Traktor queue (traktor-cue-queue.json) when
// the collection could not take it as the run ended: Traktor was open, or the write
// failed. Dropping it left the ENTRY on the old file, so an in-place AIFF to FLAC showed
// as missing with its cues and playlists cut off. The rekordbox queue keeps a run's
// repoints the same way. `from` is the source the ENTRY is found by, so converting the
// track again replaces a patch still waiting; `to` is the name the queue shows.
export interface QueuedNmlPatch {
  from: string
  to: string
  // The cue tree as base64: JSON has no bytes, and a Uint8Array written as is reads back
  // as an object of numbered keys.
  patch: Omit<NmlPatch, 'cueTree'> & { cueTree?: string }
}

export function queuedNmlPatch(patch: NmlPatch): QueuedNmlPatch {
  const { cueTree, ...rest } = patch
  return {
    from: [patch.volume, patch.dir, patch.file].map((s) => s.normalize('NFC')).join('\0'),
    to: patch.outputFile ?? patch.newFile ?? patch.file,
    patch: cueTree ? { ...rest, cueTree: Buffer.from(cueTree).toString('base64') } : rest,
  }
}

export function nmlPatchOf(queued: QueuedNmlPatch): NmlPatch {
  const { cueTree, ...rest } = queued.patch
  return cueTree === undefined
    ? rest
    : { ...rest, cueTree: new Uint8Array(Buffer.from(cueTree, 'base64')) }
}

// The queue as flushTraktorSync uses it. Held patches go out on the queue's next quiet
// apply, which waits for Traktor to close instead of asking again: the user has just
// declined. Only a conversion patch counts as waiting; saved cues in the same queue are
// checked against the collection when written and do not depend on a run's order.
export function holdInQueue(queue: {
  enqueue: RekordboxQueue<QueuedNmlPatch>['enqueue']
  state: () => RekordboxQueueState
  applyQuietly: () => void
}): { waiting: () => boolean; hold: (patches: NmlPatch[]) => void } {
  return {
    waiting: () => queue.state().items.some((i) => i.parts.some((p) => p.kind === 'repoint')),
    hold: (patches) => {
      queue.enqueue([], patches.map(queuedNmlPatch))
      queue.applyQuietly()
    },
  }
}

// The queue's own refusal names, so a reason that stops the whole collection keeps every
// patch for the next try (as traktorCuesWrite.ts maps them for cue saves) and a patch
// that found no track is let go.
const QUEUE_REASON: Record<NonNullable<SyncResult['reason']>, string> = {
  'traktor-running': 'rekordbox-running',
  'backup-failed': 'backup-failed',
  unreadable: 'unreadable',
  'write-failed': 'write-failed',
  'no-matches': 'no-match',
}

export async function syncQueuedPatches(
  nmlPath: string,
  queued: QueuedNmlPatch[],
  sync: (nmlPath: string, patches: NmlPatch[]) => Promise<SyncResult>,
): Promise<LibraryRepointResult[]> {
  const result = await sync(nmlPath, queued.map(nmlPatchOf))
  return queued.map(() =>
    result.written
      ? { written: true }
      : { written: false, reason: QUEUE_REASON[result.reason ?? 'write-failed'] },
  )
}
