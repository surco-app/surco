import { readFile } from 'node:fs/promises'
import type { RekordboxQueueState } from '../shared/types'
import type { LibraryRepointResult } from './libraryRepointFlush'
import type { RekordboxQueue } from './rekordboxQueue'
import { entryStates, type NmlPatch, spareEditedEntries } from './traktorNml'
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
  // The cues, stars and cover of the matched entry when the patch was held (see
  // spareEditedEntries): the DJ keeps working in Traktor while it waits.
  entryState?: string
}

export function queuedNmlPatch(patch: NmlPatch, entryState?: string): QueuedNmlPatch {
  const { cueTree, ...rest } = patch
  return {
    from: [patch.volume, patch.dir, patch.file].map((s) => s.normalize('NFC')).join('\0'),
    to: patch.outputFile ?? patch.newFile ?? patch.file,
    patch: cueTree ? { ...rest, cueTree: Buffer.from(cueTree).toString('base64') } : rest,
    ...(entryState === undefined ? {} : { entryState }),
  }
}

const readCollection = (path: string): Promise<string | null> =>
  readFile(path, 'utf8').catch(() => null)

export function nmlPatchOf(queued: QueuedNmlPatch): NmlPatch {
  const { cueTree, ...rest } = queued.patch
  return cueTree === undefined
    ? rest
    : { ...rest, cueTree: new Uint8Array(Buffer.from(cueTree, 'base64')) }
}

// The queue as flushTraktorSync uses it. Held patches go out on the queue's next quiet
// apply, which waits for Traktor to close instead of asking again: the user has just
// declined. Only a conversion patch counts as waiting; saved cues in the same queue are
// checked against the collection when written and do not depend on a run's order, and
// patches held for another collection wait in that collection's own queue.
export function holdInQueue(
  queue: {
    enqueue: RekordboxQueue<QueuedNmlPatch>['enqueue']
    state: () => RekordboxQueueState
    applyQuietly: () => void
  },
  bootVolume: () => string,
): { waiting: () => boolean; hold: (patches: NmlPatch[], nmlPath: string) => Promise<void> } {
  return {
    waiting: () => {
      return queue.state().items.some((i) => i.parts.some((p) => p.kind === 'repoint'))
    },
    hold: async (patches, nmlPath) => {
      const nml = await readCollection(nmlPath)
      const states = nml === null ? [] : entryStates(nml, patches, bootVolume())
      queue.enqueue(
        [],
        patches.map((p, i) => queuedNmlPatch(p, states[i])),
      )
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
  bootVolume: string,
): Promise<LibraryRepointResult[]> {
  const patches = queued.map(nmlPatchOf)
  const nml = await readCollection(nmlPath)
  const result = await sync(
    nmlPath,
    nml === null
      ? patches
      : spareEditedEntries(
          nml,
          patches,
          queued.map((q) => q.entryState),
          bootVolume,
        ),
  )
  return queued.map(() =>
    result.written
      ? { written: true }
      : { written: false, reason: QUEUE_REASON[result.reason ?? 'write-failed'] },
  )
}
