import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { engineContentId } from '../shared/engineContent'
import { mediaUrl } from '../shared/media'
import { RECENTLY_ADDED_ID } from '../shared/recentlyAdded'
import type {
  AppleMusicTrackMeta,
  SourceNode,
  SourcePlaylistEntry,
  SourcePreview,
} from '../shared/types'
import { engineCuesOf, readEnginePerformance } from './engineCues'

export type EngineDb = Database.Database

const WAL_HEADER = 2
const ROLLBACK_HEADER = 1

export function engineDatabasePath(libraryDir: string): string {
  return join(libraryDir, 'Database2', 'm.db')
}

export function openEngineDb(libraryDir: string): EngineDb | null {
  if (!libraryDir) return null
  const file = engineDatabasePath(libraryDir)
  if (!existsSync(file)) return null
  if (existsSync(`${file}-wal`)) return new Database(file, { readonly: true, fileMustExist: true })
  const bytes = readFileSync(file)
  if (bytes[18] !== WAL_HEADER || bytes[19] !== WAL_HEADER)
    return new Database(file, { readonly: true, fileMustExist: true })
  bytes[18] = ROLLBACK_HEADER
  bytes[19] = ROLLBACK_HEADER
  return new Database(bytes, { readonly: true })
}

interface Linked {
  id: number
  next: number
}

function chainOrder<T extends Linked>(items: T[]): T[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const pointed = new Set(items.map((i) => i.next))
  const sorted = [...items].sort((a, b) => a.id - b.id)
  const seen = new Set<number>()
  const out: T[] = []
  const walk = (start: T): void => {
    let at: T | undefined = start
    while (at && !seen.has(at.id)) {
      seen.add(at.id)
      out.push(at)
      at = byId.get(at.next)
    }
  }
  for (const head of sorted.filter((i) => !pointed.has(i.id))) walk(head)
  for (const rest of sorted) walk(rest)
  return out
}

interface ListRow extends Linked {
  parent: number
  title: string
  n: number
}

export function readEngineTree(db: EngineDb): SourceNode[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.nextListId AS next, p.parentListId AS parent, p.title,
              (SELECT count(*) FROM PlaylistEntity e JOIN Track t ON t.id = e.trackId
                WHERE e.listId = p.id) AS n
         FROM Playlist p`,
    )
    .all() as ListRow[]
  const byParent = new Map<number, ListRow[]>()
  for (const r of rows) byParent.set(r.parent, [...(byParent.get(r.parent) ?? []), r])
  const placed = new Set<number>()
  const build = (parent: number): SourceNode[] =>
    chainOrder(byParent.get(parent) ?? [])
      .filter((r) => !placed.has(r.id))
      .map((r) => {
        placed.add(r.id)
        const children = build(r.id)
        if (children.length > 0)
          return {
            id: String(r.id),
            name: r.title,
            kind: 'folder',
            count: children.length,
            children,
          }
        return { id: String(r.id), name: r.title, kind: 'playlist', count: r.n }
      })
  return build(0)
}

interface EntityRow extends Linked {
  trackId: number
  path: string | null
  title: string | null
  artist: string | null
  length: number | null
  bpm: number | null
  bpmAnalyzed: number | null
  rating: number | null
  albumArtId: number | null
}

function bpmText(row: EntityRow): string | undefined {
  const bpm = row.bpmAnalyzed && row.bpmAnalyzed > 0 ? row.bpmAnalyzed : row.bpm
  return bpm && bpm > 0 ? String(Number(bpm.toFixed(2))) : undefined
}

function metaOf(row: EntityRow): AppleMusicTrackMeta {
  const meta: AppleMusicTrackMeta = {}
  const bpm = bpmText(row)
  if (bpm) meta.bpm = bpm
  if (row.rating && row.rating > 0) meta.rating = row.rating
  return meta
}

function coverFiles(db: EngineDb, ids: number[], artDir: string): Map<number, string> {
  const files = new Map<number, string>()
  const read = db.prepare('SELECT albumArt FROM AlbumArt WHERE id = ?')
  for (const id of new Set(ids)) {
    const row = read.get(id) as { albumArt: Buffer | null } | undefined
    if (!row?.albumArt || row.albumArt.length === 0) continue
    const png = row.albumArt[0] === 0x89
    const file = join(
      artDir,
      `${createHash('sha1').update(row.albumArt).digest('hex')}.${png ? 'png' : 'jpg'}`,
    )
    if (!existsSync(file)) {
      mkdirSync(artDir, { recursive: true })
      writeFileSync(file, row.albumArt)
    }
    files.set(id, file)
  }
  return files
}

const ROW_FIELDS =
  't.id AS trackId, t.path, t.title, t.artist, t.length, t.bpm, t.bpmAnalyzed, t.rating, t.albumArtId'

function recentSince(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30).getTime() / 1000
}

function readRecentRows(db: EngineDb, now: Date): EntityRow[] {
  return db
    .prepare(
      `SELECT t.id, 0 AS next, ${ROW_FIELDS} FROM Track t
        WHERE t.dateAdded >= ? ORDER BY t.dateAdded DESC, t.id DESC`,
    )
    .all(recentSince(now)) as EntityRow[]
}

export function readEngineRecentCount(db: EngineDb, now: Date = new Date()): number {
  const row = db
    .prepare('SELECT count(*) AS n FROM Track WHERE dateAdded >= ?')
    .get(recentSince(now)) as { n: number }
  return row.n
}

function readPlaylistRows(db: EngineDb, id: string): EntityRow[] {
  return chainOrder(
    db
      .prepare(
        `SELECT e.id, e.nextEntityId AS next, ${ROW_FIELDS}
           FROM PlaylistEntity e JOIN Track t ON t.id = e.trackId
          WHERE e.listId = ?`,
      )
      .all(Number(id)) as EntityRow[],
  )
}

export function readEnginePlaylist(
  db: EngineDb,
  libraryDir: string,
  id: string,
  artDir: string,
  now: Date = new Date(),
): SourcePlaylistEntry[] {
  const rows = id === RECENTLY_ADDED_ID ? readRecentRows(db, now) : readPlaylistRows(db, id)
  const covers = coverFiles(
    db,
    rows.flatMap((r) => (r.path && r.albumArtId ? [r.albumArtId] : [])),
    artDir,
  )
  return rows.map((r) => {
    if (!r.path) return { path: null, separator: false, meta: {} }
    const cover = r.albumArtId ? covers.get(r.albumArtId) : undefined
    const contentId = engineContentId(r.trackId)
    const perf = readEnginePerformance(db, r.trackId)
    const cues = perf ? engineCuesOf(contentId, perf, { wave: false }).cues : []
    const preview: SourcePreview = {
      title: r.title?.trim() ?? '',
      artist: r.artist?.trim() ?? '',
      durationSec: r.length ?? 0,
      ...(cover ? { coverUrl: mediaUrl(cover) } : {}),
      cues: cues.map(({ ms, kind, color }) => ({ ms, kind, color })),
    }
    return {
      path: resolve(libraryDir, r.path),
      separator: false,
      meta: metaOf(r),
      contentId,
      preview,
    }
  })
}
