import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import type { PlaceCheck, VerifyDetailKey } from '../shared/verification'
import {
  decodeBeatGrid,
  decodeLoops,
  decodeQuickCues,
  decodeTrackData,
  inflateEngineBlob,
} from './engineBlobs'
import type { EngineDb } from './enginePlaylists'
import { type EngineShift, engineRowFinder } from './engineRepoint'
import { formatOf } from './verifyFile'

// Where each cue, beat and loop end sits, in seconds from the file's first sample; null for
// an unset slot, and a field that does not decode is null as a whole.
type Positions = Record<(typeof PERFORMANCE)[number], (number | null)[] | null>

export interface EngineSnapshot {
  id: number
  quickCues: string
  beatData: string
  loops: string
  positions?: Positions
}

// What the library said about the source before the conversion: its row, no row at all
// (Engine does not have the track and is not checked), several rows, or a read that failed.
export type EngineBefore = EngineSnapshot | 'absent' | 'ambiguous' | 'unreadable'

// size is the written file's size on disk. Engine's repoint never adds a row, so a check
// without a snapshot has nothing to say the row is the same one. added is the row the Engine
// DJ destination created for a source Engine did not have: it only has to be there, on the
// written file. shift is how the conversion moved the audio under the row's positions.
export interface EngineExpect {
  from: string
  to: string
  samplesKept: boolean
  before: EngineBefore
  size: number
  added?: boolean
  shift?: EngineShift
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

function decoded<T>(read: () => T | null | undefined): T | null {
  try {
    return read() ?? null
  } catch {
    return null
  }
}

function positionsOf(
  row: Record<(typeof PERFORMANCE)[number] | 'trackData', Uint8Array | null> | undefined,
): Positions {
  const rate = decoded(
    () => row?.trackData && decodeTrackData(inflateEngineBlob(row.trackData)),
  )?.sampleRate
  if (!row || !rate) return { quickCues: null, beatData: null, loops: null }
  const sec = (sample: number) => (sample < 0 ? null : sample / rate)
  const cues = decoded(() => row.quickCues && decodeQuickCues(inflateEngineBlob(row.quickCues)))
  const grid = decoded(() => row.beatData && decodeBeatGrid(inflateEngineBlob(row.beatData)))
  const loops = decoded(() => row.loops && decodeLoops(Buffer.from(row.loops)))
  return {
    quickCues:
      cues && cues.tail.length >= 17
        ? [
            ...cues.slots.map((s) => (s.cue ? sec(s.cue.sample) : null)),
            sec(cues.tail.readDoubleBE(0)),
            sec(cues.tail.readDoubleBE(9)),
          ]
        : null,
    beatData: grid?.markers.map((m) => m.sample / rate) ?? null,
    loops:
      loops?.flatMap((l) => [l.startSet ? sec(l.start) : null, l.endSet ? sec(l.end) : null]) ??
      null,
  }
}

function performanceOf(db: EngineDb, id: number): Omit<EngineSnapshot, 'id'> {
  const row = db
    .prepare('SELECT trackData, quickCues, beatData, loops FROM PerformanceData WHERE trackId = ?')
    .get(id) as Record<(typeof PERFORMANCE)[number] | 'trackData', Uint8Array | null> | undefined
  return {
    quickCues: digest(row?.quickCues ?? null),
    beatData: digest(row?.beatData ?? null),
    loops: digest(row?.loops ?? null),
    positions: positionsOf(row),
  }
}

// The positions a write that followed the conversion leaves: earlier by the cut, a cue or
// loop end inside it on the new start, grid markers keeping their spacing.
function shifted(field: keyof Positions, before: (number | null)[], shift: EngineShift) {
  const cut = shift.trimmedMs / 1000
  return before.map((s) =>
    s === null ? null : field === 'beatData' ? s - cut : Math.max(0, s - cut),
  )
}

const POSITION_TOLERANCE_SEC = 0.001

function sameAt(a: (number | null)[], b: (number | null)[] | null): boolean {
  return (
    b !== null &&
    a.length === b.length &&
    a.every((s, i) => {
      const t = b[i]
      return s === null || t === null ? s === t : Math.abs(s - t) <= POSITION_TOLERANCE_SEC
    })
  )
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
  detailKey: VerifyDetailKey,
  params?: Record<string, string | number>,
): PlaceCheck => ({
  place: 'engine',
  state,
  detail: params ? { key: detailKey, params } : { key: detailKey },
})

// Without the row as it was before the write, no later read can judge it.
const noPhoto = (): PlaceCheck => ({ ...check('unreadable', 'engineUnreadable'), final: true })

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
  if (e.before === 'unreadable') return noPhoto()
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
  if (!e.added && typeof before !== 'object') return noPhoto()
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
  const shift = e.shift
  const misplaced =
    shift &&
    PERFORMANCE.find((field) => {
      const was = before.positions?.[field] ?? null
      return was !== null && !sameAt(shifted(field, was, shift), now.positions?.[field] ?? null)
    })
  if (misplaced) return check('mismatch', 'engineCuesMisplaced', { field: misplaced })
  return check('ok', 'engineOk', { format: formatOf(extname(e.to)) })
}
