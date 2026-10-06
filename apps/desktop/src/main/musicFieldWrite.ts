import { constants as fsConstants } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { extname } from 'node:path'
import log from 'electron-log/main'
import type { TrashEntry } from '../shared/types'
import { assertDecodable, convertTmpPath } from './ffmpeg'
import { discardBackup, hasOriginalKeeper, keepOriginal } from './originalKeeper'
import { removeTemp, renameWithRetry } from './renameRetry'
import { type FieldWrite, setTagFields, type TagFieldChange } from './tagFieldSet'
import { runInWorker } from './worker'

export { type FieldWrite, setTagFields, type TagFieldChange }

export interface TmpTracking {
  track: (path: string) => void
  untrack: (path: string) => void
}

// The same copy, check, back up and rename that convertAudio does for an in-place update,
// minus everything else it does: no ffmpeg pass, no full retag, no cues to carry. TagLib
// only rewrites the frames it was handed, so DJ data it was not handed stays byte for byte.
export async function rewriteTagFields(
  file: string,
  changes: TagFieldChange[],
  tracking?: TmpTracking,
): Promise<{ outcomes: FieldWrite[]; backup?: TrashEntry }> {
  const tmp = convertTmpPath(file, extname(file))
  tracking?.track(tmp)
  let archived: TrashEntry | null = null
  try {
    await copyFile(file, tmp, fsConstants.COPYFILE_FICLONE)
    const outcomes = await runInWorker<FieldWrite[]>({ type: 'setTagFields', file: tmp, changes })
    if (!outcomes.includes('written')) {
      await dropTemp(tmp, tracking)
      return { outcomes }
    }
    await assertDecodable(tmp, file)
    archived = await keepOriginal(file, 'replaced', file, { reencodes: false })
    if (!archived && hasOriginalKeeper()) throw new Error('no-backup')
    await renameWithRetry(tmp, file)
    tracking?.untrack(tmp)
    return { outcomes, backup: archived ?? undefined }
  } catch (e) {
    if (archived) await discardBackup(archived).catch(() => undefined)
    await dropTemp(tmp, tracking)
    throw e
  }
}

// A temp that will not delete (a network volume still holding the handle) stays in the
// manifest so the next launch sweeps it, as convertAudio does.
async function dropTemp(tmp: string, tracking?: TmpTracking): Promise<void> {
  if (await removeTemp(tmp)) log.warn(`temp cleanup failed, left behind: ${tmp}`)
  else tracking?.untrack(tmp)
}
