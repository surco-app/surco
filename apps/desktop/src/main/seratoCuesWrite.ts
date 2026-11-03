import { constants as fsConstants } from 'node:fs'
import { copyFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import log from 'electron-log/main'
import { type SeratoCue, withSeratoCues } from '../shared/seratoMarkers'
import type { TrashEntry } from '../shared/types'
import { assertDecodable, convertTmpPath } from './ffmpeg'
import { dropTemp, type Rewritten, type TmpTracking } from './musicFieldWrite'
import { discardBackup, hasOriginalKeeper, keepOriginal } from './originalKeeper'
import { cueFingerprint } from './rekordboxCues'
import { renameWithRetry } from './renameRetry'
import { seratoLeadOfFile } from './seratoClock'
import { seratoCueRows } from './seratoCueSource'
import { readSeratoPayload, readSeratoTrack } from './seratoTags'
import { runInWorker } from './worker'

export interface SeratoWriteDeps {
  tracking?: TmpTracking
  rewritten?: Rewritten
}

const sameBytes = (a: Uint8Array | null, b: Uint8Array): boolean =>
  a !== null && Buffer.from(a).equals(Buffer.from(b))

export async function writeSeratoCues(
  file: string,
  wanted: SeratoCue[],
  expectedFingerprint: string,
  { tracking, rewritten }: SeratoWriteDeps = {},
): Promise<'written' | 'changed' | 'failed'> {
  const track = readSeratoTrack(file)
  if (!track) return 'failed'
  const lead = await seratoLeadOfFile(file, track.sampleRate)
  if (cueFingerprint(seratoCueRows(track.markers?.cues ?? [], lead)) !== expectedFingerprint)
    return 'changed'
  const tmp = convertTmpPath(file, extname(file))
  tracking?.track(tmp)
  let archived: TrashEntry | null = null
  try {
    const payload = withSeratoCues(
      readSeratoPayload(file),
      wanted.map((cue) => ({ ...cue, ms: Math.max(0, Math.round(cue.ms + lead)) })),
    )
    const fromBytes = (await stat(file)).size
    await copyFile(file, tmp, fsConstants.COPYFILE_FICLONE)
    await runInWorker({ type: 'setSeratoMarkers', file: tmp, payload })
    if (!sameBytes(readSeratoPayload(tmp), payload))
      throw new Error(`Serato cues did not read back from ${tmp}`)
    await assertDecodable(tmp, file)
    archived = await keepOriginal(file, 'replaced', file, {
      reencodes: false,
      regardlessOfPolicy: true,
    })
    if (!archived && hasOriginalKeeper()) throw new Error(`no backup of ${file}`)
    await renameWithRetry(tmp, file)
    tracking?.untrack(tmp)
    rewritten?.(file, fromBytes)
    return 'written'
  } catch (e) {
    log.warn(`Serato cues not written to ${file}`, e)
    if (archived) await discardBackup(archived).catch(() => undefined)
    await dropTemp(tmp, tracking)
    return 'failed'
  }
}
