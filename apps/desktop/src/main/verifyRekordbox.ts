import { extname } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { PlaceCheck, VerifyDetailKey } from '../shared/verification'
import {
  FILE_TYPES,
  type FindOptions,
  fileNameForms,
  rekordboxPathKey,
  SAME_FILE_NAME,
  STREAMING_FILE_TYPE,
} from './rekordboxDb'
import { formatOf } from './verifyFile'

type RekordboxDb = InstanceType<typeof Database>

export interface RekordboxSnapshot {
  id: string
  cues: number
  analysisDataPath: string
  analysed: number
}

// What the collection said about the source before the conversion: its row, no row at all
// (rekordbox does not have the track and is not checked), several rows, or a read that failed.
export type RekordboxBefore = RekordboxSnapshot | 'absent' | 'ambiguous' | 'unreadable'

// added when the flush created a row for the file instead of repointing one; size is the
// written file's size on disk.
export interface RekordboxExpect {
  from: string
  to: string
  samplesKept: boolean
  before: RekordboxBefore
  added: boolean
  size: number
}

interface Row {
  ID: string
  FolderPath: string
  FileType: number
  FileSize: number
  AnalysisDataPath: string | null
  Analysed: number | null
}

const LIVE = 'coalesce(rb_local_deleted, 0) = 0'

// Every row on the file, compared by where its path lands: rekordbox keeps the spelling it
// was given, through the ~/Music/Music link or not, NFD or NFC. Unlike findTrackByPath it
// returns all of them, so two rows on one file are seen as two and never one picked.
function rowsOn(db: RekordboxDb, path: string, find: FindOptions): Row[] {
  const key = rekordboxPathKey(find)
  const rows = db
    .prepare(
      `SELECT ID, FolderPath, FileType, FileSize, AnalysisDataPath, Analysed
         FROM djmdContent
        WHERE ${SAME_FILE_NAME}
          AND FileType <> ?
          AND ${LIVE}`,
    )
    .all(...fileNameForms(path), STREAMING_FILE_TYPE) as Row[]
  const target = key(path)
  return rows.filter((r) => key(r.FolderPath) === target)
}

const liveCues = (db: RekordboxDb, id: string) =>
  (
    db.prepare(`SELECT count(*) AS n FROM djmdCue WHERE ContentID = ? AND ${LIVE}`).get(id) as {
      n: number
    }
  ).n

// The source's row as it is before anything writes, so the check can say the cues and the
// grid survived.
export function snapshotRekordboxRow(
  db: RekordboxDb,
  from: string,
  find: FindOptions,
): RekordboxBefore {
  try {
    const rows = rowsOn(db, from, find)
    if (rows.length === 0) return 'absent'
    if (rows.length > 1) return 'ambiguous'
    const row = rows[0]
    return {
      id: String(row.ID),
      cues: liveCues(db, String(row.ID)),
      analysisDataPath: row.AnalysisDataPath ?? '',
      analysed: row.Analysed ?? 0,
    }
  } catch {
    return 'unreadable'
  }
}

const check = (
  state: PlaceCheck['state'],
  key: VerifyDetailKey,
  params?: Record<string, string | number>,
): PlaceCheck => ({ place: 'rekordbox', state, detail: params ? { key, params } : { key } })

// Without the row as it was before the write, no later read can judge it.
const noPhoto = (): PlaceCheck => ({ ...check('unreadable', 'rekordboxUnreadable'), final: true })

const formatOfType = (fileType: number) => {
  const ext = Object.keys(FILE_TYPES).find((e) => FILE_TYPES[e] === fileType)
  return ext ? formatOf(`.${ext}`) : String(fileType)
}

// One read-only pass over the collection for the whole batch, after its flush.
export function checkRekordbox(
  db: RekordboxDb,
  list: RekordboxExpect[],
  find: FindOptions,
): PlaceCheck[] {
  return list.map((e) => {
    try {
      return judge(db, e, find)
    } catch {
      return check('unreadable', 'rekordboxUnreadable')
    }
  })
}

function judge(db: RekordboxDb, e: RekordboxExpect, find: FindOptions): PlaceCheck {
  if (e.before === 'unreadable') return noPhoto()
  const on = rowsOn(db, e.to, find)
  if (on.length > 1) return check('mismatch', 'rekordboxAmbiguous', { count: on.length })
  if (on.length === 0) {
    const old = rowsOn(db, e.from, find)
    if (old.length > 1) return check('mismatch', 'rekordboxAmbiguous', { count: old.length })
    if (old.length === 1)
      return check('mismatch', 'rekordboxStillOld', { format: formatOf(extname(e.from)) })
    return check('mismatch', 'rekordboxMissing')
  }

  // The source had several rows: whichever one moved, the others are still in playlists on
  // the old file or beside the new one, so it never reads as done, added or not.
  if (e.before === 'ambiguous') {
    const ids = new Set([...on, ...rowsOn(db, e.from, find)].map((r) => String(r.ID)))
    return check('mismatch', 'rekordboxAmbiguous', { count: ids.size })
  }

  const row = on[0]
  const id = String(row.ID)
  const before = typeof e.before === 'object' ? e.before : null
  if (!e.added) {
    if (!before) return noPhoto()
    if (id !== before.id) return check('mismatch', 'rekordboxOtherRow')
  }
  if (row.FileType !== FILE_TYPES[extname(e.to).slice(1).toLowerCase()])
    return check('mismatch', 'rekordboxStillOld', { format: formatOfType(row.FileType) })
  if (row.FileSize !== e.size) return check('mismatch', 'rekordboxSizeDiffers')

  const cues = liveCues(db, id)
  if (!e.added && before) {
    if (cues < before.cues)
      return check('mismatch', 'rekordboxCuesLost', { before: before.cues, after: cues })
    if (cues > before.cues)
      return check('mismatch', 'rekordboxCuesChanged', { before: before.cues, after: cues })
    // The 30/10 report: a conversion that kept the samples emptied rekordbox's analysis,
    // and rekordbox drew a new grid over audio that had not moved.
    if (
      e.samplesKept &&
      ((row.AnalysisDataPath ?? '') !== before.analysisDataPath ||
        (row.Analysed ?? 0) !== before.analysed)
    )
      return check('mismatch', 'rekordboxAnalysisEmptied')
  }
  return check('ok', 'rekordboxOk', { format: formatOf(extname(e.to)), cues })
}
