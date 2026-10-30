import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import type { PlaceCheck } from '../shared/verification'
import type { EngineDb } from './enginePlaylists'
import { engineRowFinder } from './engineRepoint'
import { formatOf } from './verifyFile'

export interface EngineSnapshot {
  id: number
  quickCues: string
  beatData: string
  loops: string
}

// What the library said about the source before the conversion: its row, no row at all
// (Engine does not have the track and is not checked), several rows, or a read that failed.
export type EngineBefore = EngineSnapshot | 'absent' | 'ambiguous' | 'unreadable'

// size is the written file's size on disk. Engine's repoint never adds a row, so a check
// without a snapshot has nothing to say the row is the same one. added is the row the Engine
// DJ destination created for a source Engine did not have: it only has to be there, on the
// written file.
export interface EngineExpect {
  from: string
  to: string
  samplesKept: boolean
  before: EngineBefore
  size: number
  added?: boolean
}

interface Row {
  id: number
  path: string
  fileType: string | null
  fileBytes: number | null
}

type Key = (path: string) => string

const PERFORMANCE = ['quickCues', 'beatData', 'loops'] as const

const digest = (blob: Uint8Array | null): string =>
  createHash('sha1')
    .update(blob ?? new Uint8Array())
    .digest('hex')

const EMPTY = digest(null)

function rowsFinder(db: EngineDb, libraryDir: string) {
  const rows = db
    .prepare('SELECT id, path, fileType, fileBytes FROM Track WHERE path IS NOT NULL')
    .all() as Row[]
  return engineRowFinder(libraryDir, rows)
}

function performanceOf(db: EngineDb, id: number): Omit<EngineSnapshot, 'id'> {
  const row = db
    .prepare('SELECT quickCues, beatData, loops FROM PerformanceData WHERE trackId = ?')
    .get(id) as Record<(typeof PERFORMANCE)[number], Uint8Array | null> | undefined
  return {
    quickCues: digest(row?.quickCues ?? null),
    beatData: digest(row?.beatData ?? null),
    loops: digest(row?.loops ?? null),
  }
}

// The source's row and its cues, grid and loops as they are before anything writes, so the
// check can say they survived.
export function snapshotEngineRow(
  db: EngineDb,
  libraryDir: string,
  from: string,
  key: Key,
): EngineBefore {
  try {
    const rows = rowsFinder(db, libraryDir)(from, key)
    if (rows.length === 0) return 'absent'
    if (rows.length > 1) return 'ambiguous'
    return { id: rows[0].id, ...performanceOf(db, rows[0].id) }
  } catch {
    return 'unreadable'
  }
}

const check = (
  state: PlaceCheck['state'],
  detailKey: string,
  params?: Record<string, string | number>,
): PlaceCheck => ({
  place: 'engine',
  state,
  detail: params ? { key: detailKey, params } : { key: detailKey },
})

// One read-only pass over the library for the whole batch, after its flush.
export function checkEngine(
  db: EngineDb,
  libraryDir: string,
  list: EngineExpect[],
  key: Key,
): PlaceCheck[] {
  let find: ReturnType<typeof rowsFinder>
  try {
    find = rowsFinder(db, libraryDir)
  } catch {
    return list.map(() => check('unreadable', 'engineUnreadable'))
  }
  return list.map((e) => {
    try {
      return judge(db, find, e, key)
    } catch {
      return check('unreadable', 'engineUnreadable')
    }
  })
}

function judge(
  db: EngineDb,
  find: ReturnType<typeof rowsFinder>,
  e: EngineExpect,
  key: Key,
): PlaceCheck {
  if (e.before === 'unreadable') return check('unreadable', 'engineUnreadable')
  const on = find(e.to, key)
  if (on.length > 1) return check('mismatch', 'engineAmbiguous', { count: on.length })
  if (on.length === 0) {
    const old = find(e.from, key)
    if (old.length > 1) return check('mismatch', 'engineAmbiguous', { count: old.length })
    if (old.length === 1)
      return check('mismatch', 'engineStillOld', { format: formatOf(extname(e.from)) })
    return check('mismatch', 'engineMissing')
  }

  const row = on[0]
  const before = e.before
  if (!e.added && typeof before !== 'object') return check('unreadable', 'engineUnreadable')
  if (typeof before === 'object' && row.id !== before.id) return check('mismatch', 'engineOtherRow')
  const fileType = (row.fileType ?? '').toLowerCase()
  if (!fileType) return check('mismatch', 'engineNoFileType')
  if (fileType !== extname(e.to).slice(1).toLowerCase())
    return check('mismatch', 'engineStillOld', { format: formatOf(`.${fileType}`) })
  if (row.fileBytes !== e.size) return check('mismatch', 'engineSizeDiffers')
  if (typeof before !== 'object')
    return check('ok', 'engineOk', { format: formatOf(extname(e.to)) })

  // Engine's repoint only moves the file columns; with the samples kept, a cue, beat or
  // loop that changed is one the DJ set and lost. A re-encode may move them, but what the
  // row had must still be there.
  const now = performanceOf(db, row.id)
  const changed = PERFORMANCE.find((field) =>
    e.samplesKept ? now[field] !== before[field] : before[field] !== EMPTY && now[field] === EMPTY,
  )
  if (changed) return check('mismatch', 'enginePerformanceChanged', { field: changed })
  return check('ok', 'engineOk', { format: formatOf(extname(e.to)) })
}
