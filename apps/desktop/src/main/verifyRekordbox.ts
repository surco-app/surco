import { extname } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { PlaceCheck } from '../shared/verification'
import { pathKey } from './libraryPathKey'
import {
  FILE_TYPES,
  type FindOptions,
  rekordboxStoredPath,
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

// before is the source's row read ahead of the conversion; added when the flush created a
// row for the file instead of repointing one; size is the written file's size on disk.
export interface RekordboxExpect {
  from: string
  to: string
  samplesKept: boolean
  before: RekordboxSnapshot | null
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
  const resolve = pathKey(find)
  const key = (p: string) => rekordboxStoredPath(resolve(p.normalize('NFC'))).normalize('NFC')
  const stored = rekordboxStoredPath(path)
  const name = stored.slice(stored.lastIndexOf('/') + 1)
  const rows = db
    .prepare(
      `SELECT ID, FolderPath, FileType, FileSize, AnalysisDataPath, Analysed
         FROM djmdContent
        WHERE FileNameL COLLATE NOCASE IN (?, ?)
          AND FileType <> ?
          AND ${LIVE}`,
    )
    .all(name.normalize('NFC'), name.normalize('NFD'), STREAMING_FILE_TYPE) as Row[]
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
// grid survived. Null when the collection has no row, or more than one, for the file.
export function snapshotRekordboxRow(
  db: RekordboxDb,
  from: string,
  find: FindOptions,
): RekordboxSnapshot | null {
  const rows = rowsOn(db, from, find)
  if (rows.length !== 1) return null
  const row = rows[0]
  return {
    id: String(row.ID),
    cues: liveCues(db, String(row.ID)),
    analysisDataPath: row.AnalysisDataPath ?? '',
    analysed: row.Analysed ?? 0,
  }
}

const check = (
  state: PlaceCheck['state'],
  key: string,
  params?: Record<string, string | number>,
): PlaceCheck => ({ place: 'rekordbox', state, detail: params ? { key, params } : { key } })

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
  const on = rowsOn(db, e.to, find)
  if (on.length > 1) return check('mismatch', 'rekordboxAmbiguous', { count: on.length })
  if (on.length === 0) {
    const old = rowsOn(db, e.from, find)
    if (old.length > 1) return check('mismatch', 'rekordboxAmbiguous', { count: old.length })
    if (old.length === 1)
      return check('mismatch', 'rekordboxStillOld', { format: formatOf(extname(e.from)) })
    return check('mismatch', 'rekordboxMissing')
  }

  const row = on[0]
  const id = String(row.ID)
  if (!e.added) {
    if (!e.before) return check('unreadable', 'rekordboxUnreadable')
    if (id !== e.before.id) return check('mismatch', 'rekordboxOtherRow')
  }
  if (row.FileType !== FILE_TYPES[extname(e.to).slice(1).toLowerCase()])
    return check('mismatch', 'rekordboxStillOld', { format: formatOfType(row.FileType) })
  if (row.FileSize !== e.size) return check('mismatch', 'rekordboxSizeDiffers')

  const cues = liveCues(db, id)
  if (!e.added && e.before) {
    if (cues < e.before.cues)
      return check('mismatch', 'rekordboxCuesLost', { before: e.before.cues, after: cues })
    if (cues > e.before.cues)
      return check('mismatch', 'rekordboxCuesChanged', { before: e.before.cues, after: cues })
    // The 30/10 report: a conversion that kept the samples emptied rekordbox's analysis,
    // and rekordbox drew a new grid over audio that had not moved.
    if (
      e.samplesKept &&
      ((row.AnalysisDataPath ?? '') !== e.before.analysisDataPath ||
        (row.Analysed ?? 0) !== e.before.analysed)
    )
      return check('mismatch', 'rekordboxAnalysisEmptied')
  }
  return check('ok', 'rekordboxOk', { format: formatOf(extname(e.to)), cues })
}
