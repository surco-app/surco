import { readFile, unlink, writeFile } from 'node:fs/promises'
import log from 'electron-log/main'
import type { Database } from 'sql.js'
import { HOT_KINDS, validWantedSet, type WantedCue } from '../shared/cueRules'
import { engineTrackId } from '../shared/engineContent'
import { hotCueArgb, nearestHotCueColor } from '../shared/rekordboxCueColors'
import type { RekordboxQueueNotice, TrackCueRow } from '../shared/types'
import { loadSqlJs } from './engine'
import {
  decodeQuickCues,
  deflateEngineBlob,
  type EngineQuickCues,
  encodeQuickCues,
  inflateEngineBlob,
  quickCueSlotBytes,
} from './engineBlobs'
import { type EnginePerformance, engineCuesOf } from './engineCues'
import { assertEngineClosed, withEngineDatabase } from './engineLibrary'
import { engineDatabasePath } from './enginePlaylists'
import type { BatchResult, CuesOp, OpOutcome, QueueOp } from './rekordboxQueueOps'
import { writeBackup } from './rekordboxSessionBackup'
import { renameWithRetry } from './renameRetry'

const BACKUP_SUFFIX = '.surco-backup'
const NO_MAIN_CUE = Buffer.from('bff000000000000000bff0000000000000', 'hex')

export interface EngineCuesWriteDeps {
  ensureClosed: () => Promise<boolean>
  sessionBackup: (dbPath: string) => Promise<void>
}

function currentQuickCues(blob: Uint8Array | null): EngineQuickCues {
  const empty = (): EngineQuickCues => ({
    slots: HOT_KINDS.map(() => ({ bytes: quickCueSlotBytes(null), cue: null })),
    tail: NO_MAIN_CUE,
  })
  const decoded = blob && blob.length > 4 ? decodeQuickCues(inflateEngineBlob(blob)) : null
  if (!decoded) return empty()
  const missing = Math.max(0, HOT_KINDS.length - decoded.slots.length)
  return {
    ...decoded,
    slots: [...decoded.slots, ...empty().slots.slice(0, missing)],
  }
}

function withHotCues(
  stored: EngineQuickCues,
  read: TrackCueRow[],
  wanted: WantedCue[],
  sampleRate: number,
): Buffer {
  const slots = stored.slots.map((slot, i) => {
    if (i >= HOT_KINDS.length) return slot.bytes
    const w = wanted.find((c) => c.kind === HOT_KINDS[i])
    if (!w) return slot.cue ? quickCueSlotBytes(null) : slot.bytes
    const was = read.find((c) => c.id === w.id)
    const from = was ? stored.slots[Number(was.id)]?.cue : null
    if (was && from && was.id === String(i) && was.ms === w.ms && was.color === w.color)
      return slot.bytes
    const color = w.color ?? nearestHotCueColor(hotCueArgb(null))
    return quickCueSlotBytes({
      label: from?.label ?? '',
      sample: was && from && was.ms === w.ms ? from.sample : (w.ms / 1000) * sampleRate,
      argb: from && nearestHotCueColor(from.argb) === color ? from.argb : hotCueArgb(color),
    })
  })
  return encodeQuickCues(slots, stored.tail)
}

interface Planned {
  op: CuesOp
  trackId: number
  quickCues: Buffer
  notices: RekordboxQueueNotice[]
}

type Plan = { outcome: OpOutcome } | Planned

function row(db: Database, trackId: number): EnginePerformance | null {
  const statement = db.prepare(
    `SELECT t.length, p.trackData, p.beatData, p.quickCues, p.overviewWaveFormData
       FROM Track t LEFT JOIN PerformanceData p ON p.trackId = t.id WHERE t.id = ?`,
  )
  try {
    statement.bind([trackId])
    return statement.step() ? (statement.getAsObject() as unknown as EnginePerformance) : null
  } finally {
    statement.free()
  }
}

function plan(db: Database, op: QueueOp): Plan {
  const refused = (code: 'cues-changed' | 'cues-invalid'): Plan => ({
    outcome: {
      id: op.id,
      applied: false,
      notices: [{ code, track: op.kind === 'edit' ? '' : op.label }],
    },
  })
  if (op.kind !== 'cues') return refused('cues-invalid')
  const trackId = engineTrackId(op.contentId)
  const perf = trackId === null ? null : row(db, trackId)
  if (trackId === null || !perf) return refused('cues-changed')
  const read = engineCuesOf(op.contentId, perf, { wave: false })
  if (!read.analysed || read.fingerprint !== op.fingerprint) return refused('cues-changed')
  if (op.wanted === undefined) return refused('cues-invalid')
  const valid = validWantedSet(op.wanted, read.cues)
  if (!valid.ok) {
    log.warn(`Engine DJ cues: refused the queued set for ${op.contentId} (${valid.reason})`)
    return refused('cues-invalid')
  }
  const hot = op.wanted.filter((c) => c.kind !== 0)
  const calls = op.wanted.filter((c) => c.kind === 0).map((c) => c.ms)
  const notices: RekordboxQueueNotice[] =
    calls.length > 0 ? [{ code: 'cues-calls-dropped', track: op.label, calls }] : []
  const stored = currentQuickCues(perf.quickCues)
  const next = withHotCues(stored, read.cues, hot, sampleRateOf(perf))
  const before = encodeQuickCues(
    stored.slots.map((s) => s.bytes),
    stored.tail,
  )
  if (perf.quickCues && next.equals(before))
    return { outcome: { id: op.id, applied: true, notices } }
  return { op, trackId, quickCues: deflateEngineBlob(next), notices }
}

function sampleRateOf(perf: EnginePerformance): number {
  return perf.trackData ? inflateEngineBlob(perf.trackData).readDoubleBE(0) : 0
}

export function applyEngineCuesBatch(
  libraryDir: string,
  ops: QueueOp[],
  deps: EngineCuesWriteDeps,
): Promise<BatchResult> {
  if (!libraryDir) return Promise.resolve({ ok: false, reason: 'unreadable' })
  const dbPath = engineDatabasePath(libraryDir)
  return withEngineDatabase(dbPath, () => writeEngineCuesBatch(dbPath, ops, deps))
}

async function openPlanned(
  dbPath: string,
  ops: QueueOp[],
): Promise<{ db: Database; outcomes: Map<string, OpOutcome>; planned: Planned[] } | null> {
  let db: Database
  try {
    const SQL = await loadSqlJs()
    db = new SQL.Database(await readFile(dbPath))
    db.exec('SELECT trackId FROM PerformanceData LIMIT 1')
  } catch (e) {
    log.warn(`Engine DJ cues: cannot read ${dbPath}: ${(e as Error).message}`)
    return null
  }
  const outcomes = new Map<string, OpOutcome>()
  const planned: Planned[] = []
  for (const op of ops) {
    const p = plan(db, op)
    if ('outcome' in p) outcomes.set(op.id, p.outcome)
    else planned.push(p)
  }
  return { db, outcomes, planned }
}

async function writeEngineCuesBatch(
  dbPath: string,
  ops: QueueOp[],
  deps: EngineCuesWriteDeps,
): Promise<BatchResult> {
  const inOrder = (outcomes: Map<string, OpOutcome>): OpOutcome[] =>
    ops.map((op) => outcomes.get(op.id) as OpOutcome)
  const first = await openPlanned(dbPath, ops)
  if (!first) return { ok: false, reason: 'unreadable' }
  first.db.close()
  if (first.planned.length === 0)
    return { ok: true, wrote: false, outcomes: inOrder(first.outcomes) }

  if (!(await deps.ensureClosed())) return { ok: false, reason: 'cancelled' }
  try {
    await assertEngineClosed(dbPath)
  } catch {
    return { ok: false, reason: 'rekordbox-running' }
  }
  // Engine DJ saves the library on its way out, so what was read above is out of date once
  // it quits: the batch is worked out again on what it left, which also catches pads the
  // DJ changed in Engine meanwhile.
  const fresh = await openPlanned(dbPath, ops)
  if (!fresh) return { ok: false, reason: 'unreadable' }
  const { db, outcomes, planned } = fresh
  try {
    if (planned.length === 0) return { ok: true, wrote: false, outcomes: inOrder(outcomes) }
    try {
      await deps.sessionBackup(dbPath)
      await writeBackup(dbPath, `${dbPath}${BACKUP_SUFFIX}`)
    } catch (e) {
      log.warn(`Engine DJ cues: backup failed: ${(e as Error).message}`)
      return { ok: false, reason: 'backup-failed' }
    }
    for (const p of planned)
      db.run('UPDATE PerformanceData SET quickCues = ? WHERE trackId = ?', [p.quickCues, p.trackId])
    try {
      await assertEngineClosed(dbPath)
    } catch {
      return { ok: false, reason: 'rekordbox-running' }
    }
    const tmp = `${dbPath}.surco-tmp`
    try {
      await writeFile(tmp, db.export())
      await renameWithRetry(tmp, dbPath)
    } catch (e) {
      log.warn(`Engine DJ cues: write failed: ${(e as Error).message}`)
      await unlink(tmp).catch(() => {})
      return { ok: false, reason: 'write-failed' }
    }
    for (const p of planned)
      outcomes.set(p.op.id, { id: p.op.id, applied: true, notices: p.notices })
    return { ok: true, wrote: true, outcomes: inOrder(outcomes) }
  } finally {
    db.close()
  }
}
