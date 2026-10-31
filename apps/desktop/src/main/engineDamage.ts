import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TrashEntry } from '../shared/types'
import { loadSqlJs } from './engine'
import { decodeTrackData, inflateEngineBlob } from './engineBlobs'
import { engineLengthOf, engineRowFinder } from './engineRepoint'
import type { headOffsetMs } from './ffmpeg'
import { pathKey } from './libraryPathKey'

export type EngineJudgement =
  | {
      kind: 'engine-cues' | 'engine-length'
      certainty: 'sure'
      trimmedMs: number
      sampleRateHz?: number
      backup?: { id: string; trashedAt: number }
    }
  | { kind: 'engine-cues'; unrepairable: true; missingSec: number }

export interface EngineDamage {
  path: string
  judgement: EngineJudgement
  fileBytes: number
  length: number
  trackData: { sampleRate: number; sampleCount: number }
}

interface EngineDamageDeps {
  probe: (p: string) => Promise<{ sampleRate: number; durationSec: number } | null>
  backups: () => Promise<TrashEntry[]>
  headOffsetMs: typeof headOffsetMs
  durationOf: (p: string) => Promise<number | null>
}

const ENGINE_SAME_SEC = 0.1
const HEAD_SLACK_MS = 50

export function judgeEngineRow(
  row: { sampleRate: number; sampleCount: number; length: number },
  file: { sampleRate: number; durationSec: number },
  backup: { id: string; trashedAt: number; durationSec: number; headMs: number | null } | null,
): EngineJudgement | null {
  const engineSec = row.sampleCount / row.sampleRate
  const missingSec = engineSec - file.durationSec
  const rate = file.sampleRate !== row.sampleRate ? { sampleRateHz: file.sampleRate } : {}
  if (Math.abs(missingSec) <= ENGINE_SAME_SEC && file.sampleRate !== row.sampleRate)
    return { kind: 'engine-cues', certainty: 'sure', trimmedMs: 0, ...rate }
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
        certainty: 'sure',
        trimmedMs: head,
        ...rate,
        backup: { id: backup.id, trashedAt: backup.trashedAt },
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
          'SELECT t.id, t.path, t.length, t.fileBytes, p.trackData FROM Track t JOIN PerformanceData p ON p.trackId = t.id',
        )[0]?.values ?? []
      ).map(([id, path, length, fileBytes, trackData]) => ({
        id: Number(id),
        path: String(path),
        length: Number(length),
        fileBytes: Number(fileBytes),
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
    const judgement = judgeEngineRow({ ...trackData, length: found[0].length }, file, backup)
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
