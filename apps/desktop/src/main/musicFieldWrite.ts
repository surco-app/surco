import { constants as fsConstants } from 'node:fs'
import { copyFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import log from 'electron-log/main'
import { errorWithKey } from '../shared/errorKeys'
import type { TrashEntry } from '../shared/types'
import type { EngineShift } from './engineRepoint'
import { assertDecodable, convertTmpPath } from './ffmpeg'
import { discardBackup, hasOriginalKeeper, keepOriginal } from './originalKeeper'
import { removeTemp, renameWithRetry } from './renameRetry'
import { type FieldWrite, setTagFields, type TagFieldChange } from './tagFieldSet'
import { type CueShift, readCueTree } from './tags'
import { readTraktorMarkers } from './traktor4'
import { runInWorker } from './worker'

export { type FieldWrite, setTagFields, type TagFieldChange }

export interface TmpTracking {
  track: (path: string) => void
  untrack: (path: string) => void
}

// Told of a file rewritten on its own path, with the size it had before and how its audio
// moved under Engine's positions, so Engine DJ's row can follow it (see engineSizeFollow.ts).
export type Rewritten = (file: string, fromBytes: number, engineShift?: EngineShift) => void

// The same copy, check, back up and rename that convertAudio does for an in-place update,
// minus everything else it does: no ffmpeg pass, no full retag, no cues to carry. TagLib
// only rewrites the frames it was handed, so DJ data it was not handed stays byte for byte.
export async function rewriteTagFields(
  file: string,
  changes: TagFieldChange[],
  tracking?: TmpTracking,
  rewritten?: Rewritten,
  job: 'setTagFields' | 'setGenreFrame' = 'setTagFields',
): Promise<{ outcomes: FieldWrite[]; backup?: TrashEntry }> {
  const tmp = convertTmpPath(file, extname(file))
  tracking?.track(tmp)
  let archived: TrashEntry | null = null
  try {
    const fromBytes = (await stat(file)).size
    await copyFile(file, tmp, fsConstants.COPYFILE_FICLONE)
    const outcomes = await runInWorker<FieldWrite[]>({ type: job, file: tmp, changes })
    if (!outcomes.includes('written')) {
      await dropTemp(tmp, tracking)
      return { outcomes }
    }
    await assertDecodable(tmp, file)
    archived = await keepOriginal(file, 'replaced', file, {
      reencodes: false,
      regardlessOfPolicy: true,
    })
    if (!archived && hasOriginalKeeper()) throw errorWithKey('noBackup', file)
    await renameWithRetry(tmp, file)
    tracking?.untrack(tmp)
    rewritten?.(file, fromBytes)
    return { outcomes, backup: archived ?? undefined }
  } catch (e) {
    if (archived) await discardBackup(archived).catch(() => undefined)
    await dropTemp(tmp, tracking)
    throw e
  }
}

const GRID_TYPE = 4
const SAME_MS = 0.01

const cueStarts = (file: string): number[] | null => {
  const tree = readCueTree(file)
  const starts = tree
    ? readTraktorMarkers(tree)
        .filter((m) => m.type !== GRID_TYPE)
        .map((m) => m.startMs)
    : []
  return starts.length > 0 ? starts : null
}

const same = (a: number[], b: number[], addMs = 0): boolean =>
  a.length === b.length && a.every((ms, i) => Math.abs(b[i] - ms - addMs) <= SAME_MS)

// A converted file's own Traktor cues moved by addMs, only while they are still at
// `expected`, and only kept when every one of them moved by exactly that much.
export async function rewriteCueTree(
  file: string,
  addMs: number,
  expected: number[],
  tracking?: TmpTracking,
): Promise<{ written: boolean; backup?: TrashEntry }> {
  const before = cueStarts(file)
  if (!before || !same(expected, before)) return { written: false }
  const tmp = convertTmpPath(file, extname(file))
  tracking?.track(tmp)
  let archived: TrashEntry | null = null
  try {
    await copyFile(file, tmp, fsConstants.COPYFILE_FICLONE)
    const shift: CueShift = { shiftMs: -addMs }
    if (extname(file).toLowerCase() === '.flac')
      await runInWorker({ type: 'shiftFlacCues', file: tmp, shift })
    else await runInWorker({ type: 'copyCueFrames', source: file, dest: tmp, shift })
    const after = cueStarts(tmp)
    if (!after || !same(before, after, addMs)) {
      await dropTemp(tmp, tracking)
      return { written: false }
    }
    await assertDecodable(tmp, file)
    archived = await keepOriginal(file, 'replaced', file, {
      reencodes: false,
      regardlessOfPolicy: true,
    })
    if (!archived && hasOriginalKeeper()) throw new Error('no-backup')
    await renameWithRetry(tmp, file)
    tracking?.untrack(tmp)
    return { written: true, backup: archived ?? undefined }
  } catch (e) {
    if (archived) await discardBackup(archived).catch(() => undefined)
    await dropTemp(tmp, tracking)
    throw e
  }
}

export interface PreparedRewrite {
  write: (changes: TagFieldChange[]) => Promise<{ outcomes: FieldWrite[]; backup?: TrashEntry }>
  abandon: () => Promise<void>
  keep: () => Promise<TrashEntry | undefined>
  backup: () => TrashEntry | undefined
}

// rewriteTagFields with the copy and the backup taken up front, for a write that follows
// setting the field in Music: Music rewrites its file as soon as the tag is set, so by
// then the original and the value the review read are only left in these two copies.
export async function prepareTagRewrite(
  file: string,
  tracking?: TmpTracking,
  rewritten?: Rewritten,
): Promise<PreparedRewrite> {
  const tmp = convertTmpPath(file, extname(file))
  tracking?.track(tmp)
  let archived: TrashEntry | null = null
  let fromBytes = 0
  const abandon = async () => {
    if (archived) await discardBackup(archived).catch(() => undefined)
    archived = null
    await dropTemp(tmp, tracking)
  }
  try {
    fromBytes = (await stat(file)).size
    await copyFile(file, tmp, fsConstants.COPYFILE_FICLONE)
    archived = await keepOriginal(file, 'replaced', file, {
      reencodes: false,
      regardlessOfPolicy: true,
    })
    if (!archived && hasOriginalKeeper()) throw errorWithKey('noBackup', file)
  } catch (e) {
    await abandon()
    throw e
  }
  // The write only runs once Music accepted a field, and Music rewrote the file when it
  // did: from then on the copy is the only way back and stays, whatever the write does.
  const write = async (changes: TagFieldChange[]) => {
    try {
      const outcomes = await runInWorker<FieldWrite[]>({ type: 'setTagFields', file: tmp, changes })
      if (!outcomes.includes('written')) {
        await dropTemp(tmp, tracking)
        const held = await runInWorker<boolean[]>({ type: 'tagFieldsHeld', file, changes })
        return {
          outcomes: outcomes.map((o, i): FieldWrite => (held[i] ? 'written' : o)),
          backup: archived ?? undefined,
        }
      }
      await assertDecodable(tmp, file)
      await renameWithRetry(tmp, file)
      tracking?.untrack(tmp)
      return { outcomes, backup: archived ?? undefined }
    } catch (e) {
      await dropTemp(tmp, tracking)
      throw e
    } finally {
      rewritten?.(file, fromBytes)
    }
  }
  const keep = async () => {
    await dropTemp(tmp, tracking)
    rewritten?.(file, fromBytes)
    return archived ?? undefined
  }
  return { write, abandon, keep, backup: () => archived ?? undefined }
}

// A temp that will not delete (a network volume still holding the handle) stays in the
// manifest so the next launch sweeps it, as convertAudio does.
async function dropTemp(tmp: string, tracking?: TmpTracking): Promise<void> {
  if (await removeTemp(tmp)) log.warn(`temp cleanup failed, left behind: ${tmp}`)
  else tracking?.untrack(tmp)
}
