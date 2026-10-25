import { randomInt, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import {
  type FlowPhrase,
  type PhraseSection,
  phraseKindOf,
  phraseLabelOf,
} from '../shared/cueFlows'
import { type CueChangeSet, type StrongPart, strongParts } from '../shared/cueRules'
import type { CueWaveColumn, TrackCueRow, TrackCues } from '../shared/types'
import { beatGrid, colorWave, colorWaveSpanMs, colorWaveWords, phrases, wavePreview } from './anlz'
import { insideShare } from './rekordboxArtwork'
import { rekordboxStamp, takeLocalUsn, unusedRowId } from './rekordboxRows'

type Db = InstanceType<typeof Database>

export function cueFingerprint(cues: TrackCueRow[]): string {
  return cues
    .map((c) => `${c.id}|${c.kind}|${c.ms}|${c.color ?? ''}`)
    .sort()
    .join(';')
}

function liveCuesQuery(db: Db): (contentId: string) => TrackCueRow[] {
  const statement = db.prepare(
    `SELECT ID, InMsec, OutMsec, Kind, ColorTableIndex FROM djmdCue
      WHERE ContentID = ? AND coalesce(rb_local_deleted, 0) = 0`,
  )
  return (contentId) =>
    (
      statement.all(contentId) as {
        ID: string
        InMsec: number
        OutMsec: number | null
        Kind: number
        ColorTableIndex: number | null
      }[]
    ).map((r) => ({
      id: String(r.ID),
      ms: r.InMsec,
      kind: r.Kind,
      color: r.ColorTableIndex,
      ...(r.OutMsec !== null && r.OutMsec !== -1 ? { loop: true } : {}),
    }))
}

export function liveCues(db: Db, contentId: string): TrackCueRow[] {
  return liveCuesQuery(db)(contentId)
}

function read(path: string): Buffer | null {
  return existsSync(path) ? readFileSync(path) : null
}

interface Analysis {
  grid: { ms: number; beat: number }[]
  strong: StrongPart[]
  phrases: FlowPhrase[]
  sections: PhraseSection[]
  wave: CueWaveColumn[] | null
  spanMs: number | null
}

function analyse(
  shareDir: string,
  analysisPath: string | null,
  withWave: boolean,
): Analysis | null {
  if (!analysisPath) return null
  const datPath = resolve(shareDir, `.${analysisPath}`)
  if (!insideShare(shareDir, datPath)) return null
  const dat = read(datPath)
  if (!dat) return null
  const grid = beatGrid(dat).map((b) => ({ ms: b.ms, beat: b.beat }))
  if (grid.length === 0) return null
  const ext = read(datPath.replace(/\.DAT$/, '.EXT'))
  const sections = ext ? phrases(ext) : null
  const strong = sections
    ? strongParts(
        sections.mood,
        sections.entries,
        grid.map((b) => b.ms),
      )
    : []
  const phraseList: FlowPhrase[] = sections
    ? sections.entries.flatMap((p) => {
        const kind = phraseKindOf(sections.mood, p.kind)
        const at = grid[p.beat - 1]
        return kind && at ? [{ ms: at.ms, kind }] : []
      })
    : []
  const sectionList: PhraseSection[] = sections
    ? sections.entries.flatMap((p) => {
        const kind = phraseKindOf(sections.mood, p.kind)
        const label = phraseLabelOf(sections.mood, p.kind)
        const at = grid[p.beat - 1]
        return kind && label && at ? [{ ms: at.ms, label, kind }] : []
      })
    : []
  const spanMs = ext ? colorWaveSpanMs(ext) : null
  const found = { grid, strong, phrases: phraseList, sections: sectionList, spanMs }
  return { ...found, wave: withWave ? buildWave(dat, ext) : null }
}

function buildWave(dat: Buffer, ext: Buffer | null): CueWaveColumn[] | null {
  try {
    const preview = wavePreview(dat, 400)
    return (
      (ext ? colorWave(ext) : null) ?? (preview ? preview.map((h) => ({ h, rgb: null })) : null)
    )
  } catch {
    return null
  }
}

export function readTrackCues(
  db: Db,
  shareDir: string,
  contentId: string,
  options: { wave?: boolean } = {},
): TrackCues | null {
  const row = db
    .prepare(
      `SELECT AnalysisDataPath, Length FROM djmdContent
        WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
    )
    .get(contentId) as { AnalysisDataPath: string | null; Length: number } | undefined
  if (!row) return null
  const cues = liveCues(db, contentId)
  const base = { contentId, cues, durationMs: row.Length * 1000, fingerprint: cueFingerprint(cues) }
  let analysis: Analysis | null = null
  try {
    analysis = analyse(shareDir, row.AnalysisDataPath, options.wave !== false)
  } catch {
    analysis = null
  }
  if (!analysis)
    return {
      ...base,
      analysed: false,
      grid: [],
      strong: [],
      phrases: [],
      sections: [],
      wave: null,
    }
  const { spanMs, ...found } = analysis
  return { ...base, durationMs: spanMs ?? base.durationMs, analysed: true, ...found }
}

export function readCueWaveDetail(db: Db, shareDir: string, contentId: string): Uint16Array | null {
  const row = db
    .prepare(
      `SELECT AnalysisDataPath FROM djmdContent
        WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
    )
    .get(contentId) as { AnalysisDataPath: string | null } | undefined
  if (!row?.AnalysisDataPath) return null
  const datPath = resolve(shareDir, `.${row.AnalysisDataPath}`)
  if (!insideShare(shareDir, datPath)) return null
  try {
    const ext = read(datPath.replace(/\.DAT$/, '.EXT'))
    return ext ? colorWaveWords(ext) : null
  } catch {
    return null
  }
}

const CUE_JSON_KEYS = [
  'ID',
  'ContentID',
  'ContentUUID',
  'InMsec',
  'InFrame',
  'InMpegFrame',
  'InMpegAbs',
  'OutMsec',
  'OutFrame',
  'OutMpegFrame',
  'OutMpegAbs',
  'Kind',
  'Color',
  'UUID',
  'created_at',
  'updated_at',
] as const

const randomCueId = (): string => String(randomInt(100, 2 ** 32))

const isoOf = (stamp: unknown): unknown =>
  typeof stamp === 'string' ? stamp.replace(' ', 'T').replace(/ ([+-]\d\d:\d\d)$/, '$1') : stamp

function liveEntries(db: Db, contentId: string): Record<string, unknown>[] {
  return (
    db
      .prepare(
        `SELECT ${CUE_JSON_KEYS.join(', ')} FROM djmdCue
          WHERE ContentID = ? AND coalesce(rb_local_deleted, 0) = 0`,
      )
      .all(contentId) as Record<string, unknown>[]
  ).map((e) => ({ ...e, created_at: isoOf(e.created_at), updated_at: isoOf(e.updated_at) }))
}

const frameOf = (ms: number): number => Math.floor((ms * 150) / 1000)

function changedEntries(
  cues: string | null,
  changes: CueChangeSet,
  inserted: Record<string, string | number | null>[],
  iso: string,
): Record<string, unknown>[] {
  const gone = new Set(changes.remove)
  const entries = (cues ? (JSON.parse(cues) as Record<string, unknown>[]) : []).filter(
    (e) => !gone.has(String(e.ID)),
  )
  for (const u of changes.update) {
    const e = entries.find((x) => String(x.ID) === u.id)
    if (e) {
      e.Kind = u.kind
      if ('ColorTableIndex' in e) e.ColorTableIndex = u.color
      if (u.ms !== undefined) {
        e.InMsec = u.ms
        e.InFrame = frameOf(u.ms)
      }
      e.updated_at = iso
    }
  }
  for (const row of inserted)
    entries.push(
      Object.fromEntries(
        CUE_JSON_KEYS.map((k) => [k, k === 'created_at' || k === 'updated_at' ? iso : row[k]]),
      ),
    )
  return entries
}

interface CuePosition {
  InMsec: number
  OutMsec: number | null
}

function shifted<T extends CuePosition>(cue: T, deltaMs: number) {
  const inMs = Math.max(0, cue.InMsec + deltaMs)
  const loop = cue.OutMsec !== null && cue.OutMsec >= 0
  const outMs = loop ? Math.max(0, (cue.OutMsec as number) + deltaMs) : cue.OutMsec
  return { inMs, outMs, loop }
}

export function shiftCues(db: Db, contentId: string, deltaMs: number, ctx: { now: Date }): number {
  if (deltaMs === 0) return 0
  const cues = db
    .prepare(
      `SELECT ID, InMsec, OutMsec FROM djmdCue
        WHERE ContentID = ? AND coalesce(rb_local_deleted, 0) = 0`,
    )
    .all(contentId) as ({ ID: string } & CuePosition)[]
  if (cues.length === 0) return 0
  const stamp = rekordboxStamp(ctx.now)
  const iso = ctx.now.toISOString().replace('Z', '+00:00')
  const move = db.prepare(
    `UPDATE djmdCue SET InMsec = ?, InFrame = ?, InMpegFrame = 0, InMpegAbs = 0,
       OutMsec = ?, OutFrame = CASE WHEN ? THEN ? ELSE OutFrame END, OutMpegFrame = 0,
       OutMpegAbs = 0, rb_local_usn = ?, updated_at = ?
      WHERE ID = ? AND ContentID = ?`,
  )
  for (const cue of cues) {
    const { inMs, outMs, loop } = shifted(cue, deltaMs)
    move.run(
      inMs,
      frameOf(inMs),
      outMs,
      loop ? 1 : 0,
      loop ? frameOf(outMs as number) : null,
      takeLocalUsn(db, stamp),
      stamp,
      cue.ID,
      contentId,
    )
  }

  const cc = db.prepare('SELECT ID, Cues FROM contentCue WHERE ContentID = ?').get(contentId) as
    | { ID: string; Cues: string | null }
    | undefined
  if (cc?.Cues) {
    const entries = (JSON.parse(cc.Cues) as Record<string, unknown>[]).map((e) => {
      if (typeof e.InMsec !== 'number') return e
      const { inMs, outMs, loop } = shifted(
        { InMsec: e.InMsec, OutMsec: typeof e.OutMsec === 'number' ? e.OutMsec : null },
        deltaMs,
      )
      const next: Record<string, unknown> = { ...e, InMsec: inMs, InFrame: frameOf(inMs) }
      for (const k of ['InMpegFrame', 'InMpegAbs', 'OutMpegFrame', 'OutMpegAbs'])
        if (k in e) next[k] = 0
      if (loop) {
        next.OutMsec = outMs
        next.OutFrame = frameOf(outMs as number)
      }
      next.updated_at = iso
      return next
    })
    db.prepare('UPDATE contentCue SET Cues = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?').run(
      JSON.stringify(entries),
      takeLocalUsn(db, stamp),
      stamp,
      cc.ID,
    )
  }
  const track = db.prepare('SELECT CueUpdated FROM djmdContent WHERE ID = ?').get(contentId) as {
    CueUpdated: string | null
  }
  db.prepare(
    'UPDATE djmdContent SET CueUpdated = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?',
  ).run(
    String(Number(track.CueUpdated ?? 0) + cues.length),
    takeLocalUsn(db, stamp),
    stamp,
    contentId,
  )
  return cues.length
}

export function applyCueChanges(
  db: Db,
  contentId: string,
  changes: CueChangeSet,
  ctx: { now: Date; newCueId?: () => string },
): number {
  const count = changes.insert.length + changes.update.length + changes.remove.length
  if (count === 0) return 0
  const stamp = rekordboxStamp(ctx.now)
  const iso = ctx.now.toISOString().replace('Z', '+00:00')
  const track = db
    .prepare('SELECT UUID, CueUpdated FROM djmdContent WHERE ID = ?')
    .get(contentId) as { UUID: string; CueUpdated: string | null }

  const inserted: Record<string, string | number | null>[] = []
  for (const c of changes.insert) {
    const row: Record<string, string | number | null> = {
      ID: unusedRowId(db, 'djmdCue', ctx.newCueId ?? randomCueId),
      ContentID: contentId,
      InMsec: c.ms,
      InFrame: frameOf(c.ms),
      InMpegFrame: 0,
      InMpegAbs: 0,
      OutMsec: -1,
      OutFrame: 0,
      OutMpegFrame: 0,
      OutMpegAbs: 0,
      Kind: c.kind,
      Color: -1,
      ColorTableIndex: c.color,
      ContentUUID: track.UUID,
      UUID: randomUUID(),
      rb_data_status: 0,
      rb_local_data_status: 0,
      rb_local_deleted: 0,
      rb_local_synced: 0,
      usn: null,
      rb_local_usn: null,
      created_at: stamp,
      updated_at: stamp,
    }
    const names = Object.keys(row)
    db.prepare(
      `INSERT INTO djmdCue (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    ).run(...Object.values(row))
    inserted.push(row)
  }
  const update = db.prepare(
    `UPDATE djmdCue SET Kind = ?, ColorTableIndex = ?, rb_local_usn = ?, updated_at = ?
      WHERE ID = ? AND ContentID = ?`,
  )
  const move = db.prepare(
    'UPDATE djmdCue SET InMsec = ?, InFrame = ? WHERE ID = ? AND ContentID = ?',
  )
  for (const u of changes.update) {
    update.run(u.kind, u.color, takeLocalUsn(db, stamp), stamp, u.id, contentId)
    if (u.ms !== undefined) move.run(u.ms, frameOf(u.ms), u.id, contentId)
  }
  const remove = db.prepare('DELETE FROM djmdCue WHERE ID = ? AND ContentID = ?')
  for (const id of changes.remove) remove.run(id, contentId)

  const cc = db.prepare('SELECT ID, Cues FROM contentCue WHERE ContentID = ?').get(contentId) as
    | { ID: string; Cues: string | null }
    | undefined
  const entries = cc ? changedEntries(cc.Cues, changes, inserted, iso) : liveEntries(db, contentId)
  const ccUsn = takeLocalUsn(db, stamp)
  if (cc)
    db.prepare(
      'UPDATE contentCue SET Cues = ?, rb_cue_count = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?',
    ).run(JSON.stringify(entries), entries.length, ccUsn, stamp, cc.ID)
  else
    db.prepare(
      `INSERT INTO contentCue (ID, ContentID, Cues, rb_cue_count, UUID, rb_data_status,
         rb_local_data_status, rb_local_deleted, rb_local_synced, usn, rb_local_usn, created_at,
         updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, ?, ?, ?)`,
    ).run(
      track.UUID,
      contentId,
      JSON.stringify(entries),
      entries.length,
      randomUUID(),
      ccUsn,
      stamp,
      stamp,
    )
  db.prepare(
    'UPDATE djmdContent SET CueUpdated = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?',
  ).run(String(Number(track.CueUpdated ?? 0) + count), takeLocalUsn(db, stamp), stamp, contentId)
  return count
}
