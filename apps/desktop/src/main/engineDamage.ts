import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Database } from 'sql.js'
import type { TrashEntry } from '../shared/types'
import { loadSqlJs } from './engine'
import { decodeTrackData, inflateEngineBlob } from './engineBlobs'
import { engineLengthOf, engineRowFinder } from './engineRepoint'
import type { headOffsetMs } from './ffmpeg'
import { pathKey } from './libraryPathKey'

export type EngineJudgement =
  | {
      kind: 'engine-cues' | 'engine-length'
      certainty: 'sure' | 'likely'
      trimmedMs: number
      sampleRateHz?: number
      backup?: { id: string; trashedAt: number }
      cuesKept?: boolean | null
    }
  | { kind: 'engine-cues'; unrepairable: true; missingSec: number }

export interface EngineDamage {
  path: string
  judgement: EngineJudgement
  fileBytes: number | null
  length: number
  trackData: { sampleRate: number; sampleCount: number }
}

interface EngineDamageDeps {
  probe: (p: string) => Promise<{ sampleRate: number; durationSec: number } | null>
  backups: () => Promise<TrashEntry[]>
  headOffsetMs: typeof headOffsetMs
  durationOf: (p: string) => Promise<number | null>
  copies?: () => Promise<{ takenAt: number; dbPath: string }[]>
}

const ENGINE_SAME_SEC = 0.1
const HEAD_SLACK_MS = 50

export function judgeEngineRow(
  row: { sampleRate: number; sampleCount: number; length: number },
  file: { sampleRate: number; durationSec: number },
  backup: { id: string; trashedAt: number; durationSec: number; headMs: number | null } | null,
  cuesKept: boolean | null = null,
): EngineJudgement | null {
  const cues = { certainty: cuesKept ? ('sure' as const) : ('likely' as const), cuesKept }
  const engineSec = row.sampleCount / row.sampleRate
  const missingSec = engineSec - file.durationSec
  const rate = file.sampleRate !== row.sampleRate ? { sampleRateHz: file.sampleRate } : {}
  if (Math.abs(missingSec) <= ENGINE_SAME_SEC && file.sampleRate !== row.sampleRate)
    return { kind: 'engine-cues', ...cues, trimmedMs: 0, ...rate }
  if (missingSec > ENGINE_SAME_SEC) {
    const head = backup?.headMs ?? null
    if (
      backup &&
      head !== null &&
      Math.abs(backup.durationSec - engineSec) <= ENGINE_SAME_SEC &&
      head >= 0 &&
      head <= missingSec * 1000 + HEAD_SLACK_MS
    )
      return {
        kind: 'engine-cues',
        certainty: cues.certainty,
        trimmedMs: head,
        ...rate,
        backup: { id: backup.id, trashedAt: backup.trashedAt },
        cuesKept,
      }
    return {
      kind: 'engine-cues',
      unrepairable: true,
      missingSec: Math.round(missingSec * 1000) / 1000,
    }
  }
  if (row.length !== engineLengthOf(row.sampleCount, row.sampleRate))
    return { kind: 'engine-length', certainty: 'sure', trimmedMs: 0 }
  return null
}

const nfc = (s: string) => s.normalize('NFC')

const cueBytes = (quickCues: unknown, loops: unknown): string =>
  [quickCues, loops]
    .map((b) => (b instanceof Uint8Array ? Buffer.from(b).toString('base64') : ''))
    .join('|')

// Whether the row's cues and loops are still what the newest library copy taken no later
// than the conversion holds for it. Null when no such copy has the row, or when nothing dates
// the conversion (a resample leaves no backup), since a later copy may hold hand edits.
async function cuesKeptSince(
  path: string,
  cues: string,
  convertedAt: number | undefined,
  libraryDir: string,
  deps: EngineDamageDeps,
): Promise<boolean | null> {
  if (convertedAt === undefined) return null
  const copies = (await deps.copies?.().catch(() => [])) ?? []
  const before = copies
    .filter((c) => c.takenAt <= convertedAt)
    .sort((a, b) => b.takenAt - a.takenAt)
  const SQL = await loadSqlJs()
  for (const copy of before) {
    let db: Database | null = null
    try {
      db = new SQL.Database(await readFile(copy.dbPath))
      const rows = (
        db.exec(
          'SELECT t.path, p.quickCues, p.loops FROM Track t JOIN PerformanceData p ON p.trackId = t.id',
        )[0]?.values ?? []
      ).map(([stored, quickCues, loops]) => ({
        path: String(stored),
        cues: cueBytes(quickCues, loops),
      }))
      const found = engineRowFinder(libraryDir, rows)(path, pathKey())
      if (found.length === 1) return found[0].cues === cues
    } catch {
    } finally {
      db?.close()
    }
  }
  return null
}

async function backupFor(
  path: string,
  engineSec: number,
  missingSec: number,
  entries: TrashEntry[],
  deps: EngineDamageDeps,
): Promise<{ id: string; trashedAt: number; durationSec: number; headMs: number | null } | null> {
  const mine = entries
    .filter(
      (e) => nfc(e.originalPath) === nfc(path) || (e.outputPath && nfc(e.outputPath) === nfc(path)),
    )
    .sort((a, b) => b.trashedAt - a.trashedAt)
  for (const entry of mine) {
    const durationSec = await deps.durationOf(entry.storedPath)
    if (durationSec === null || Math.abs(durationSec - engineSec) > ENGINE_SAME_SEC) continue
    const headMs = await deps.headOffsetMs(entry.storedPath, path, missingSec + 1)
    return { id: entry.id, trashedAt: entry.trashedAt, durationSec, headMs }
  }
  return null
}

export async function scanEngineDamage(
  paths: string[],
  libraryDir: string,
  deps: EngineDamageDeps,
): Promise<EngineDamage[]> {
  const SQL = await loadSqlJs()
  const db = new SQL.Database(await readFile(join(libraryDir, 'Database2', 'm.db')))
  const rows = (() => {
    try {
      return (
        db.exec(
          'SELECT t.id, t.path, t.length, t.fileBytes, p.trackData, p.quickCues, p.loops FROM Track t JOIN PerformanceData p ON p.trackId = t.id',
        )[0]?.values ?? []
      ).map(([id, path, length, fileBytes, trackData, quickCues, loops]) => ({
        cues: cueBytes(quickCues, loops),
        id: Number(id),
        path: String(path),
        length: Number(length),
        fileBytes: fileBytes == null ? null : Number(fileBytes),
        trackData:
          trackData instanceof Uint8Array ? decodeTrackData(inflateEngineBlob(trackData)) : null,
      }))
    } finally {
      db.close()
    }
  })()
  const find = engineRowFinder(libraryDir, rows)
  let trash: Promise<TrashEntry[]> | undefined
  const out: EngineDamage[] = []
  for (const path of paths) {
    const found = find(path, pathKey())
    const trackData = found.length === 1 ? found[0].trackData : null
    if (!trackData || trackData.sampleRate <= 0) continue
    const file = await deps.probe(path)
    if (!file) continue
    const engineSec = trackData.sampleCount / trackData.sampleRate
    const missingSec = engineSec - file.durationSec
    trash ??= deps.backups()
    const backup =
      missingSec > ENGINE_SAME_SEC
        ? await backupFor(path, engineSec, missingSec, await trash, deps)
        : null
    const moved = file.sampleRate !== trackData.sampleRate || missingSec > ENGINE_SAME_SEC
    const kept = moved
      ? await cuesKeptSince(path, found[0].cues, backup?.trashedAt, libraryDir, deps)
      : null
    const judgement = judgeEngineRow({ ...trackData, length: found[0].length }, file, backup, kept)
    if (judgement)
      out.push({
        path,
        judgement,
        fileBytes: found[0].fileBytes,
        length: found[0].length,
        trackData,
      })
  }
  return out
}
