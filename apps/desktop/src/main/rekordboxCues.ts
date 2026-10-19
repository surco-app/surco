import { existsSync, readFileSync } from 'node:fs'
import type Database from 'better-sqlite3-multiple-ciphers'
import { type StrongPart, strongParts } from '../shared/cueRules'
import type { CueWaveColumn, TrackCueRow, TrackCues } from '../shared/types'
import { beatGrid, colorWave, phrases, wavePreview } from './anlz'

type Db = InstanceType<typeof Database>

export function cueFingerprint(cues: TrackCueRow[]): string {
  return cues
    .map((c) => `${c.id}|${c.kind}|${c.ms}|${c.color ?? ''}`)
    .sort()
    .join(';')
}

export function liveCues(db: Db, contentId: string): TrackCueRow[] {
  return (
    db
      .prepare(
        `SELECT ID, InMsec, Kind, ColorTableIndex FROM djmdCue
          WHERE ContentID = ? AND coalesce(rb_local_deleted, 0) = 0`,
      )
      .all(contentId) as {
      ID: string
      InMsec: number
      Kind: number
      ColorTableIndex: number | null
    }[]
  ).map((r) => ({ id: String(r.ID), ms: r.InMsec, kind: r.Kind, color: r.ColorTableIndex }))
}

function read(path: string): Buffer | null {
  return existsSync(path) ? readFileSync(path) : null
}

interface Analysis {
  grid: { ms: number; beat: number }[]
  strong: StrongPart[]
  wave: CueWaveColumn[] | null
}

function analyse(
  shareDir: string,
  analysisPath: string | null,
  withWave: boolean,
): Analysis | null {
  const dat = analysisPath ? read(`${shareDir}${analysisPath}`) : null
  if (!dat || !analysisPath) return null
  const grid = beatGrid(dat).map((b) => ({ ms: b.ms, beat: b.beat }))
  if (grid.length === 0) return null
  const ext = read(`${shareDir}${analysisPath.replace(/\.DAT$/, '.EXT')}`)
  const sections = ext ? phrases(ext) : null
  const strong = sections
    ? strongParts(
        sections.mood,
        sections.entries,
        grid.map((b) => b.ms),
      )
    : []
  if (!withWave) return { grid, strong, wave: null }
  const preview = wavePreview(dat, 400)
  const wave =
    (ext ? colorWave(ext) : null) ?? (preview ? preview.map((h) => ({ h, rgb: null })) : null)
  return { grid, strong, wave }
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
  if (!analysis) return { ...base, analysed: false, grid: [], strong: [], wave: null }
  return { ...base, analysed: true, ...analysis }
}
