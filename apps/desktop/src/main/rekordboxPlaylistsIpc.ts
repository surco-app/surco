import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { ipcMain } from 'electron'
import type { DjEditMain, DjReadMain } from '../shared/djApi'
import { mediaPathFromUrl } from '../shared/media'
import type { RekordboxEditResult, RekordboxPlaylistEdit } from '../shared/types'
import { pathAliasesOf } from './libraryPathKey'
import { serialLibraryFlush } from './libraryTagSync'
import { rekordboxRawKey } from './rekordboxDb'
import { readNodeStamps } from './rekordboxMasterXml'
import { type QueueApply, type RekordboxQueue, withoutOp } from './rekordboxQueue'
import { type EditOp, editResultOfOutcome, type QueueOp } from './rekordboxQueueOps'
import { stillWaiting } from './rekordboxQueueWatch'
import type { RekordboxReadAnswer, RekordboxReadArg, RekordboxReadName } from './rekordboxReads'
import { readRekordbox } from './worker'

export { collectionMemo, withCollection } from './rekordboxCollection'

// Whether to offer rekordbox in the rail. Asked on every focus, so it only looks for the
// file: decrypting it runs the SQLCipher key derivation in the main process, for every
// user with rekordbox installed, each time Surco comes back. A file that is there but
// does not read is offered anyway, and its tree says it could not be read.
export function collectionAvailable(path: string): boolean {
  return path !== '' && existsSync(path)
}

export interface PlaylistEditHost {
  isRunning: () => Promise<boolean>
  queue: Pick<RekordboxQueue, 'enqueue' | 'apply' | 'drop' | 'outcomeOf'>
  onApplied?: (result: QueueApply) => void
  onWaiting?: () => void
  beginLoose?: (collectionPath: string) => void
}

export interface RekordboxReadHost {
  allowMedia?: (paths: string[]) => void
}

function editStamps(collectionPath: string, edit: RekordboxPlaylistEdit): Record<string, number> {
  if (edit.kind === 'create') return {}
  const stamp = readNodeStamps(collectionPath)[edit.playlistId]
  return stamp === undefined ? {} : { [edit.playlistId]: stamp }
}

export async function keyOf(path: string): Promise<string | undefined> {
  return path ? rekordboxRawKey(path).catch(() => undefined) : undefined
}

export function rekordboxRead(
  collection: () => string,
  membershipCollection: () => string,
  host: RekordboxReadHost,
): DjReadMain {
  const read = async <N extends RekordboxReadName>(
    path: string,
    name: N,
    arg: RekordboxReadArg<N>,
  ): Promise<RekordboxReadAnswer<N>> => readRekordbox(path, await keyOf(path), name, arg)
  return {
    available: () => collectionAvailable(collection()),
    tree: () => read(collection(), 'tree', undefined),
    recentCount: () => read(collection(), 'recentCount', undefined),
    trackCount: () => read(collection(), 'trackCount', undefined),
    collection: () => read(collection(), 'collection', undefined),
    matching: () => read(collection(), 'matching', undefined),
    playedTogether: (playlistIds: string[]) => read(collection(), 'playedTogether', playlistIds),
    playlist: async (id: string) => {
      const entries = await read(collection(), 'playlist', id)
      host.allowMedia?.(
        entries.flatMap((e) => [
          ...(e.path && !e.separator ? [e.path] : []),
          ...(e.preview?.coverUrl ? [mediaPathFromUrl(e.preview.coverUrl)] : []),
        ]),
      )
      return entries
    },
    membership: (paths: string[]) => read(membershipCollection(), 'membership', paths),
  }
}

// The collection path is resolved on every call, not captured once: the user can change
// the override in Settings while Surco runs.
export function rekordboxEdit(collection: () => string, host: PlaylistEditHost): DjEditMain {
  const run = async (path: string, op: QueueOp): Promise<RekordboxEditResult> => {
    host.queue.enqueue([op])
    host.beginLoose?.(path)
    const result = await host.queue.apply(async () => !(await host.isRunning()))
    if (result.status === 'applied') {
      const others = withoutOp(result, op.id)
      if (others.tracks > 0 || others.changes > 0 || others.notices.length > 0)
        host.onApplied?.(others)
    }
    if (stillWaiting(result)) {
      host.onWaiting?.()
      return { applied: false, queued: true, opId: op.id }
    } else if (result.status === 'refused') host.queue.drop(op.id)
    if (result.status === 'refused') return { applied: false, reason: result.reason }
    const written = host.queue.outcomeOf(op.id)
    const outcome =
      result.status === 'applied' ? result.outcomes.find((o) => o.id === op.id) : undefined
    return editResultOfOutcome(outcome ?? written)
  }
  return {
    hasSeparator: async () => {
      const path = collection()
      return readRekordbox(path, await keyOf(path), 'hasSeparator', undefined)
    },
    // Queued behind any other library write (a conversion's repoint, a review's sync): they
    // touch the same master.db, and the write's transaction spans an await, so two at once
    // would block each other on SQLite's busy timeout.
    save: (edit: RekordboxPlaylistEdit, label: string | undefined) =>
      serialLibraryFlush(async (): Promise<RekordboxEditResult> => {
        const path = collection()
        if (!path) return { applied: false, reason: 'unreadable' }
        const op: EditOp = {
          id: randomUUID(),
          kind: 'edit',
          edit,
          stamps: editStamps(path, edit),
          ...(label ? { label } : {}),
        }
        return run(path, op)
      }),
    match: (action, pair, label) =>
      serialLibraryFlush(async (): Promise<RekordboxEditResult> => {
        const path = collection()
        if (!path) return { applied: false, reason: 'unreadable' }
        return run(path, { id: randomUUID(), kind: 'match', action, pair, label })
      }),
  }
}

export function registerPathAliasesIpc(): void {
  // Rows dragged out of the list and dropped back in come with the OS's spelling of their
  // files, which may be resolved through the symlinked music folder.
  ipcMain.handle('library:pathAliases', (_e, paths: unknown) =>
    pathAliasesOf(paths, { realPath: (p: string) => realpath(p) }),
  )
}
