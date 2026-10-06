import { constants as fsConstants } from 'node:fs'
import { copyFile, unlink } from 'node:fs/promises'
import { extname } from 'node:path'
import type { TrashEntry } from '../shared/types'
import { assertDecodable, convertTmpPath } from './ffmpeg'
import { discardBackup, keepOriginal } from './originalKeeper'
import { renameWithRetry } from './renameRetry'
import { type FieldWrite, setTagFields, type TagFieldChange } from './tagFieldSet'
import { runInWorker } from './worker'

export { type FieldWrite, setTagFields, type TagFieldChange }

// The same copy, check, back up and rename that convertAudio does for an in-place update,
// minus everything else it does: no ffmpeg pass, no full retag, no cues to carry. TagLib
// only rewrites the frames it was handed, so DJ data it was not handed stays byte for byte.
export async function rewriteTagFields(
  file: string,
  changes: TagFieldChange[],
): Promise<{ outcomes: FieldWrite[]; backup?: TrashEntry }> {
  const tmp = convertTmpPath(file, extname(file))
  let archived: TrashEntry | null = null
  try {
    await copyFile(file, tmp, fsConstants.COPYFILE_FICLONE)
    const outcomes = await runInWorker<FieldWrite[]>({ type: 'setTagFields', file: tmp, changes })
    if (!outcomes.includes('written')) {
      await unlink(tmp).catch(() => undefined)
      return { outcomes }
    }
    await assertDecodable(tmp, file)
    archived = await keepOriginal(file, 'replaced', file, { reencodes: false })
    await renameWithRetry(tmp, file)
    return { outcomes, backup: archived ?? undefined }
  } catch (e) {
    if (archived) await discardBackup(archived).catch(() => undefined)
    await unlink(tmp).catch(() => undefined)
    throw e
  }
}
