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
      db.exec('SELECT DISTINCT listId FROM PlaylistEntity WHERE trackId = ?', [trackId])[0]
        ?.values ?? []
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
        target.run('DELETE FROM PlaylistEntity WHERE listId = ? AND trackId = ?', [id, trackId])
    },
  }
}
