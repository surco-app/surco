import type { Database } from 'sql.js'
import { engineTrackId } from '../shared/engineContent'
import type { RekordboxQueueNotice } from '../shared/types'
import { appendToList, rootListId } from './engineLibrary'
import { engineRowFinder } from './engineRepoint'
import type { TrackOp } from './rekordboxQueueOps'

interface List {
  id: number
  title: string
  parent: number
}

function trackOf(
  db: Database,
  libraryDir: string,
  op: TrackOp,
  key: (path: string) => string,
): number | null {
  const rows = (db.exec('SELECT id, path FROM Track WHERE path IS NOT NULL')[0]?.values ?? []).map(
    ([id, path]) => ({ id: Number(id), path: String(path) }),
  )
  const byId = op.contentId ? engineTrackId(op.contentId) : null
  if (byId !== null && rows.some((r) => r.id === byId)) return byId
  const find = engineRowFinder(libraryDir, rows)
  for (const path of [op.path, ...(op.from ? [op.from] : [])]) {
    const found = find(path, key)
    if (found.length === 1) return found[0].id
  }
  return null
}

function parentOf(db: Database, listId: number): number {
  return Number(
    db.exec('SELECT parentListId FROM Playlist WHERE id = ?', [listId])[0]?.values[0][0] ?? 0,
  )
}

// Every folder above the lists, deepest first, so a folder is counted after the ones in it.
function foldersAbove(db: Database, lists: number[]): number[] {
  const depth = new Map<number, number>()
  for (const list of lists) {
    const chain: number[] = []
    for (let at = parentOf(db, list); at !== 0 && !chain.includes(at); at = parentOf(db, at))
      chain.push(at)
    for (const [i, folder] of chain.entries())
      depth.set(folder, Math.max(depth.get(folder) ?? 0, chain.length - i))
  }
  return [...depth].sort((a, b) => b[1] - a[1]).map(([folder]) => folder)
}

// Engine DJ files a track in each folder above its lists too, with membershipReference
// counting how many of the folder's lists hold it: the same count the USB export keeps.
function recountFolder(db: Database, folder: number, trackId: number, uuid: string): void {
  const ref = Number(
    db.exec(
      `SELECT count(*) FROM Playlist c WHERE c.parentListId = ? AND EXISTS
         (SELECT 1 FROM PlaylistEntity e WHERE e.listId = c.id AND e.trackId = ?)`,
      [folder, trackId],
    )[0].values[0][0],
  )
  const counted = db.exec(
    'SELECT id FROM PlaylistEntity WHERE listId = ? AND trackId = ? AND membershipReference > 0',
    [folder, trackId],
  )[0]?.values[0][0]
  if (ref === 0) {
    if (counted !== undefined) db.run('DELETE FROM PlaylistEntity WHERE id = ?', [counted])
    return
  }
  if (counted !== undefined)
    db.run('UPDATE PlaylistEntity SET membershipReference = ? WHERE id = ?', [ref, counted])
  else appendToList(db, folder, trackId, uuid, ref)
}

export function planEngineTrackPlaylists(
  db: Database,
  libraryDir: string,
  op: TrackOp,
  key: (path: string) => string,
): { notices: RekordboxQueueNotice[]; write: ((db: Database) => void) | null } | null {
  const trackId = trackOf(db, libraryDir, op, key)
  if (trackId === null) return null
  const lists: List[] = (
    db.exec('SELECT id, title, parentListId FROM Playlist WHERE coalesce(isPersisted, 1) = 1')[0]
      ?.values ?? []
  ).map(([id, title, parent]) => ({ id: Number(id), title: String(title), parent: Number(parent) }))
  const holding = new Set(
    (
      db.exec(
        `SELECT DISTINCT e.listId FROM PlaylistEntity e WHERE e.trackId = ? AND e.membershipReference = 0
           AND NOT EXISTS (SELECT 1 FROM Playlist c WHERE c.parentListId = e.listId)`,
        [trackId],
      )[0]?.values ?? []
    ).map(([id]) => Number(id)),
  )
  const notices: RekordboxQueueNotice[] = []
  const wanted = new Set<number>()
  const adds: number[] = []
  const names: string[] = []
  for (const target of op.wanted) {
    const name = target.name.trim()
    const list = target.id
      ? lists.find((l) => String(l.id) === target.id)
      : lists.find((l) => l.parent === 0 && l.title === name)
    if (!list && !target.id && name !== '') {
      if (!names.includes(name)) names.push(name)
      continue
    }
    if (!list) {
      notices.push({ code: 'playlist-gone', track: op.label, playlist: target.name })
      continue
    }
    wanted.add(list.id)
    if (!holding.has(list.id) && !adds.includes(list.id)) adds.push(list.id)
  }
  const removes: number[] = []
  for (const id of holding) {
    if (wanted.has(id)) continue
    const list = lists.find((l) => l.id === id)
    if (!list) continue
    if (op.known.includes(String(id))) removes.push(id)
    else notices.push({ code: 'playlist-changed', track: op.label, playlist: list.title })
  }
  if (adds.length === 0 && names.length === 0 && removes.length === 0)
    return { notices, write: null }
  return {
    notices,
    write: (target) => {
      const uuid = String(target.exec('SELECT uuid FROM Information')[0].values[0][0])
      for (const id of adds) appendToList(target, id, trackId, uuid)
      for (const name of names) appendToList(target, rootListId(target, name), trackId, uuid)
      for (const id of removes)
        target.run(
          'DELETE FROM PlaylistEntity WHERE listId = ? AND trackId = ? AND membershipReference = 0',
          [id, trackId],
        )
      for (const folder of foldersAbove(target, [...adds, ...removes]))
        recountFolder(target, folder, trackId, uuid)
    },
  }
}
