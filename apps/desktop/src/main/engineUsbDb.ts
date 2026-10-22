import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { chainOrder, type EngineDb } from './enginePlaylists'

export function createEngineUsbDb(desktop: EngineDb): Database.Database {
  const usb = new Database(':memory:')
  const statements = desktop
    .prepare(
      `SELECT sql FROM sqlite_master
        WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY rowid`,
    )
    .pluck()
    .all() as string[]
  for (const sql of statements) usb.exec(sql)
  usb.pragma(`user_version = ${Number(desktop.pragma('user_version', { simple: true }))}`)
  const info = desktop
    .prepare('SELECT * FROM Information ORDER BY id LIMIT 1')
    .safeIntegers()
    .get() as Record<string, unknown>
  const columns = Object.keys(info).filter((c) => c !== 'id' && c !== 'uuid')
  usb
    .prepare(
      `INSERT INTO Information (uuid, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`,
    )
    .run(randomUUID(), ...columns.map((c) => info[c]))
  return usb
}

export interface EngineUsbTrackCopy {
  desktopId: number
  path: string
  fileBytes: number
}

type Row = Record<string, unknown>

function columnsOf(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
}

function sharedColumns(usb: Database.Database, desktop: EngineDb, table: string): string[] {
  const there = new Set(columnsOf(desktop, table))
  return columnsOf(usb, table).filter((c) => there.has(c))
}

export function libraryUuid(db: Database.Database): string {
  return (db.prepare('SELECT uuid FROM Information ORDER BY id LIMIT 1').get() as { uuid: string })
    .uuid
}

export function engineUsbTracksByOrigin(
  usb: Database.Database,
  originUuid: string,
): Map<number, { id: number; path: string }> {
  const rows = usb
    .prepare('SELECT id, originTrackId, path FROM Track WHERE originDatabaseUuid = ?')
    .all(originUuid) as { id: number; originTrackId: number; path: string }[]
  return new Map(rows.map((r) => [r.originTrackId, { id: r.id, path: r.path }]))
}

function albumArtCopier(
  usb: Database.Database,
  desktop: EngineDb,
): (desktopArtId: unknown) => number | bigint | null {
  const read = desktop.prepare('SELECT hash, albumArt FROM AlbumArt WHERE id = ?')
  const find = usb.prepare('SELECT id FROM AlbumArt WHERE hash IS ? AND albumArt IS ?').pluck()
  const insert = usb.prepare('INSERT INTO AlbumArt (hash, albumArt) VALUES (?, ?)')
  return (desktopArtId) => {
    if (desktopArtId === null || desktopArtId === undefined) return null
    const art = read.get(desktopArtId) as { hash: unknown; albumArt: unknown } | undefined
    if (!art) return null
    const found = find.get(art.hash, art.albumArt) as number | undefined
    return found ?? insert.run(art.hash, art.albumArt).lastInsertRowid
  }
}

export function putEngineUsbTracks(
  usb: Database.Database,
  desktop: EngineDb,
  copies: EngineUsbTrackCopy[],
): Map<number, number> {
  const desktopUuid = libraryUuid(desktop)
  const known = engineUsbTracksByOrigin(usb, desktopUuid)
  const trackColumns = sharedColumns(usb, desktop, 'Track').filter((c) => c !== 'id')
  const perfColumns = sharedColumns(usb, desktop, 'PerformanceData').filter((c) => c !== 'trackId')
  const readTrack = desktop.prepare('SELECT * FROM Track WHERE id = ?').safeIntegers()
  const readPerf = desktop.prepare('SELECT * FROM PerformanceData WHERE trackId = ?').safeIntegers()
  const insertTrack = usb.prepare(
    `INSERT INTO Track (${trackColumns.join(', ')}) VALUES (${trackColumns.map(() => '?').join(', ')})`,
  )
  const updateTrack = usb.prepare(
    `UPDATE Track SET ${trackColumns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
  )
  const stampTrack = usb.prepare('UPDATE Track SET lastEditTime = ? WHERE id = ?')
  const putPerf = usb.prepare(
    `INSERT OR REPLACE INTO PerformanceData (trackId, ${perfColumns.join(', ')})
     VALUES (?, ${perfColumns.map(() => '?').join(', ')})`,
  )
  const art = albumArtCopier(usb, desktop)
  const ids = new Map<number, number>()
  usb.transaction(() => {
    for (const copy of copies) {
      const source = readTrack.get(copy.desktopId) as Row | undefined
      if (!source) continue
      const values: Row = {
        ...source,
        path: copy.path,
        filename: posix.basename(copy.path),
        fileBytes: copy.fileBytes,
        albumArtId: art(source.albumArtId),
        originDatabaseUuid: desktopUuid,
        originTrackId: copy.desktopId,
      }
      const row = trackColumns.map((c) => values[c] ?? null)
      const existing = known.get(copy.desktopId)
      let id: number
      if (existing) {
        id = existing.id
        updateTrack.run(...row, id)
        stampTrack.run(values.lastEditTime ?? null, id)
      } else {
        id = Number(insertTrack.run(...row).lastInsertRowid)
        known.set(copy.desktopId, { id, path: copy.path })
      }
      const perf = (readPerf.get(copy.desktopId) as Row | undefined) ?? {}
      putPerf.run(id, ...perfColumns.map((c) => perf[c] ?? null))
      ids.set(copy.desktopId, id)
    }
  })()
  return ids
}

const two = (n: number): string => String(n).padStart(2, '0')

function editStamp(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

interface Entity {
  id: number
  next: number
  trackId: number
  ref: number
}

function entitiesOf(usb: Database.Database, listId: number): Entity[] {
  return chainOrder(
    usb
      .prepare(
        `SELECT id, nextEntityId AS next, trackId, membershipReference AS ref
           FROM PlaylistEntity WHERE listId = ?`,
      )
      .all(listId) as Entity[],
  )
}

function listUnder(usb: Database.Database, parent: number, title: string, stamp: string): number {
  const found = usb
    .prepare('SELECT id FROM Playlist WHERE title = ? AND parentListId = ?')
    .pluck()
    .get(title, parent) as number | undefined
  if (found !== undefined) return found
  return Number(
    usb
      .prepare(
        `INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, lastEditTime,
          isExplicitlyExported) VALUES (?, ?, 1, 0, ?, 1)`,
      )
      .run(title, parent, stamp).lastInsertRowid,
  )
}

function appendEntities(
  usb: Database.Database,
  listId: number,
  tracks: { trackId: number; ref: number }[],
  uuid: string,
): void {
  const insert = usb.prepare(
    `INSERT INTO PlaylistEntity (listId, trackId, databaseUuid, nextEntityId, membershipReference)
     VALUES (?, ?, ?, 0, ?)`,
  )
  const link = usb.prepare('UPDATE PlaylistEntity SET nextEntityId = ? WHERE id = ?')
  let tail = entitiesOf(usb, listId).at(-1)?.id ?? null
  for (const t of tracks) {
    const id = Number(insert.run(listId, t.trackId, uuid, t.ref).lastInsertRowid)
    if (tail !== null) link.run(id, tail)
    tail = id
  }
}

function rebuildFolder(usb: Database.Database, folderId: number, uuid: string): void {
  const children = chainOrder(
    usb
      .prepare('SELECT id, nextListId AS next FROM Playlist WHERE parentListId = ?')
      .all(folderId) as { id: number; next: number }[],
  )
  const counts = new Map<number, number>()
  for (const child of children)
    for (const e of entitiesOf(usb, child.id))
      counts.set(e.trackId, (counts.get(e.trackId) ?? 0) + 1)
  usb
    .prepare('DELETE FROM PlaylistEntity WHERE listId = ? AND membershipReference > 0')
    .run(folderId)
  const direct = new Set(entitiesOf(usb, folderId).map((e) => e.trackId))
  appendEntities(
    usb,
    folderId,
    [...counts]
      .filter(([trackId]) => !direct.has(trackId))
      .map(([trackId, ref]) => ({ trackId, ref })),
    uuid,
  )
}

export function putEngineUsbPlaylist(
  usb: Database.Database,
  path: string[],
  trackIds: number[],
  now: Date,
): void {
  const uuid = libraryUuid(usb)
  const stamp = editStamp(now)
  usb.transaction(() => {
    const lists: number[] = []
    for (const title of path) lists.push(listUnder(usb, lists.at(-1) ?? 0, title, stamp))
    const listId = lists.at(-1) as number
    usb.prepare('UPDATE Playlist SET lastEditTime = ? WHERE id = ?').run(stamp, listId)
    usb
      .prepare('DELETE FROM PlaylistEntity WHERE listId = ? AND membershipReference = 0')
      .run(listId)
    appendEntities(
      usb,
      listId,
      [...new Set(trackIds)].map((trackId) => ({ trackId, ref: 0 })),
      uuid,
    )
    for (const folder of lists.slice(0, -1).reverse()) rebuildFolder(usb, folder, uuid)
  })()
}
