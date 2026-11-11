import type { Database, SqlValue } from 'sql.js'
import { engineTrackId } from '../shared/engineContent'
import type {
  PlaylistAddReport,
  PlaylistTrackRef,
  RekordboxEditRefusal,
  RekordboxPlaylistEdit,
} from '../shared/types'
import { lastId } from './engine'
import { appendToList } from './engineLibrary'
import { engineRowFinder } from './engineRepoint'
import { foldersAbove, recountFolder, trackRows } from './engineTrackPlaylists'

export type EngineEditDone =
  | { applied: true; createdId?: string; report?: PlaylistAddReport }
  | { applied: false; reason: RekordboxEditRefusal; report?: PlaylistAddReport }

interface List {
  id: number
  parent: number
}

function rows(db: Database, sql: string, params: SqlValue[] = []): SqlValue[][] {
  return db.exec(sql, params)[0]?.values ?? []
}

function listOf(db: Database, id: string): List | null {
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) return null
  const found = rows(db, 'SELECT id, parentListId FROM Playlist WHERE id = ?', [n])[0]
  return found ? { id: Number(found[0]), parent: Number(found[1]) } : null
}

function hasChildren(db: Database, id: number): boolean {
  return rows(db, 'SELECT 1 FROM Playlist WHERE parentListId = ? LIMIT 1', [id]).length > 0
}

function uuidOf(db: Database): string {
  return String(rows(db, 'SELECT uuid FROM Information')[0][0])
}

function editTime(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function resolveTracks(
  db: Database,
  libraryDir: string,
  tracks: PlaylistTrackRef[],
  key: (path: string) => string,
): { ids: number[]; notInCollection: number; ambiguous: number } {
  const all = trackRows(db)
  const known = new Set(all.map((r) => r.id))
  const find = engineRowFinder(libraryDir, all)
  const ids: number[] = []
  let notInCollection = 0
  let ambiguous = 0
  for (const track of tracks) {
    const byId = track.contentId ? engineTrackId(track.contentId) : null
    if (byId !== null && known.has(byId)) {
      ids.push(byId)
      continue
    }
    let id: number | null = null
    let twins = false
    for (const path of track.paths) {
      const found = find(path, key)
      if (found.length > 1) twins = true
      if (found.length === 1) {
        id = found[0].id
        break
      }
    }
    if (id !== null) ids.push(id)
    else if (twins) ambiguous++
    else notInCollection++
  }
  return { ids: [...new Set(ids)], notInCollection, ambiguous }
}

function fill(
  db: Database,
  listId: number,
  libraryDir: string,
  tracks: PlaylistTrackRef[],
  key: (path: string) => string,
): PlaylistAddReport {
  const resolved = resolveTracks(db, libraryDir, tracks, key)
  const present = new Set(
    rows(db, 'SELECT trackId FROM PlaylistEntity WHERE listId = ?', [listId]).map((r) =>
      Number(r[0]),
    ),
  )
  const adds = resolved.ids.filter((id) => !present.has(id))
  const uuid = uuidOf(db)
  for (const id of adds) appendToList(db, listId, id, uuid)
  for (const folder of foldersAbove(db, [listId]))
    for (const id of adds) recountFolder(db, folder, id, uuid)
  return {
    added: adds.length,
    already: resolved.ids.length - adds.length,
    notInCollection: resolved.notInCollection,
    ambiguous: resolved.ambiguous,
  }
}

function create(
  db: Database,
  edit: Extract<RekordboxPlaylistEdit, { kind: 'create' }>,
  libraryDir: string,
  key: (path: string) => string,
  now: Date,
): EngineEditDone {
  if (edit.folder) return { applied: false, reason: 'read-only' }
  let parent = 0
  if (edit.parentId !== 'root') {
    const list = listOf(db, edit.parentId)
    if (!list) return { applied: false, reason: 'stale' }
    if (!hasChildren(db, list.id)) return { applied: false, reason: 'read-only' }
    parent = list.id
  }
  const name = edit.name.trim()
  if (
    name === '' ||
    rows(db, 'SELECT 1 FROM Playlist WHERE parentListId = ? AND title = ?', [parent, name]).length >
      0
  )
    return { applied: false, reason: 'bad-name' }
  db.run('UPDATE Playlist SET nextListId = -1 WHERE parentListId = ? AND nextListId = 0', [parent])
  db.run(
    `INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, lastEditTime,
       isExplicitlyExported) VALUES (?, ?, 1, 0, ?, 1)`,
    [name, parent, editTime(now)],
  )
  const id = lastId(db)
  db.run('UPDATE Playlist SET nextListId = ? WHERE parentListId = ? AND nextListId = -1', [
    id,
    parent,
  ])
  if (!edit.tracks) return { applied: true, createdId: String(id) }
  return {
    applied: true,
    createdId: String(id),
    report: fill(db, id, libraryDir, edit.tracks, key),
  }
}

function add(
  db: Database,
  edit: Extract<RekordboxPlaylistEdit, { kind: 'add' }>,
  libraryDir: string,
  key: (path: string) => string,
): EngineEditDone {
  const list = listOf(db, edit.playlistId)
  if (!list) return { applied: false, reason: 'stale' }
  if (hasChildren(db, list.id)) return { applied: false, reason: 'read-only' }
  const report = fill(db, list.id, libraryDir, edit.tracks, key)
  if (report.added === 0) return { applied: false, reason: 'nothing-to-add', report }
  return { applied: true, report }
}

function subtree(db: Database, id: number): number[] {
  const children = rows(db, 'SELECT id FROM Playlist WHERE parentListId = ?', [id]).map((r) =>
    Number(r[0]),
  )
  return [...children.flatMap((c) => subtree(db, c)), id]
}

function remove(db: Database, edit: Extract<RekordboxPlaylistEdit, { kind: 'delete' }>) {
  const list = listOf(db, edit.playlistId)
  if (!list) return { applied: false as const, reason: 'stale' as const }
  const doomed = subtree(db, list.id)
  const tracks = [
    ...new Set(
      rows(
        db,
        `SELECT trackId FROM PlaylistEntity WHERE listId IN (${doomed.map(() => '?').join(',')})`,
        doomed,
      ).map((r) => Number(r[0])),
    ),
  ]
  for (const id of doomed) {
    const at = rows(db, 'SELECT parentListId, nextListId FROM Playlist WHERE id = ?', [id])[0]
    db.run('DELETE FROM PlaylistEntity WHERE listId = ?', [id])
    db.run('DELETE FROM Playlist WHERE id = ?', [id])
    db.run('UPDATE Playlist SET nextListId = ? WHERE parentListId = ? AND nextListId = ?', [
      at[1],
      at[0],
      id,
    ])
  }
  const uuid = uuidOf(db)
  for (let folder = list.parent; folder !== 0; folder = listOf(db, String(folder))?.parent ?? 0)
    for (const id of tracks) recountFolder(db, folder, id, uuid)
  return { applied: true as const }
}

export function applyEngineEdit(
  db: Database,
  edit: RekordboxPlaylistEdit,
  libraryDir: string,
  key: (path: string) => string,
  now: Date = new Date(),
): EngineEditDone {
  if (edit.kind === 'create') return create(db, edit, libraryDir, key, now)
  if (edit.kind === 'add') return add(db, edit, libraryDir, key)
  if (edit.kind === 'delete') return remove(db, edit)
  return { applied: false, reason: 'read-only' }
}
