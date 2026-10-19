import { randomInt, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { PlaylistTrackRef, RekordboxPlaylistEdit } from '../shared/types'
import { type FindOptions, findTrackByPath, isAmbiguous, STREAMING_FILE_TYPE } from './rekordboxDb'
import { IS_SEPARATOR } from './rekordboxPlaylists'
import { rekordboxStamp, takeLocalUsn, unusedRowId } from './rekordboxRows'

// The organising edits, each on a collection already opened read-write and inside the
// caller's transaction (rekordboxPlaylistWrite.ts holds the guard, the backups and the
// rollback). Every edit leaves the touched playlist numbered 1..N, as rekordbox keeps them,
// and never touches djmdContent: a playlist only links collection entries.

type Db = InstanceType<typeof Database>

// An edit that cannot apply to the collection as it is now: a row or playlist removed in
// rekordbox since Surco read it, or no separator to copy. Thrown inside the transaction so
// nothing is half written.
export class EditRefused extends Error {
  constructor(readonly reason: 'stale' | 'no-separator') {
    super(reason)
  }
}

export interface EditContext {
  now: Date
  // Seam for the tests and for skipping IDs the XML already holds (Task 4).
  newPlaylistId?: () => string
}

interface Link {
  ID: string
  ContentID: string
  TrackNo: number
  sep: number
}

// Every live link of the playlist, in its order. A link whose content row is gone still
// holds a number, so it is kept here (LEFT JOIN): numbering around it would collide.
function links(db: Db, playlistId: string): Link[] {
  return db
    .prepare(
      `SELECT s.ID, s.ContentID, s.TrackNo, coalesce(${IS_SEPARATOR}, 0) AS sep
         FROM djmdSongPlaylist s LEFT JOIN djmdContent c ON c.ID = s.ContentID
        WHERE s.PlaylistID = ? AND coalesce(s.rb_local_deleted, 0) = 0
        ORDER BY s.TrackNo, s.ID`,
    )
    .all(playlistId) as Link[]
}

export function nodeAttribute(db: Db, id: string): number | null {
  const row = db
    .prepare(
      `SELECT Attribute FROM djmdPlaylist WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
    )
    .get(id) as { Attribute: number } | undefined
  return row ? row.Attribute : null
}

function requirePlaylist(db: Db, id: string): void {
  if (nodeAttribute(db, id) !== 0) throw new EditRefused('stale')
}

function requireLinks(all: Link[], ids: string[]): void {
  const known = new Set(all.map((l) => l.ID))
  if (ids.some((id) => !known.has(id))) throw new EditRefused('stale')
}

// Numbers the playlist 1..N in the order given. Rows whose number changes share one change
// number, as rekordbox stamps a reorder (measured: Factory's rows carry one usn after a
// move); rows that keep their place are left alone.
function writeOrder(
  db: Db,
  order: Link[],
  stamp: string,
  usnOf = () => takeLocalUsn(db, stamp),
): void {
  if (order.every((l, i) => l.TrackNo === i + 1)) return
  const usn = usnOf()
  const update = db.prepare(
    `UPDATE djmdSongPlaylist SET TrackNo = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?`,
  )
  order.forEach((l, i) => {
    if (l.TrackNo !== i + 1) update.run(i + 1, usn, stamp, l.ID)
  })
}

// rekordbox 7 identifies a playlist row by a UUID (measured on all 9432 links), and gives
// each new row its own change number.
function insertLink(
  db: Db,
  playlistId: string,
  contentId: string,
  trackNo: number,
  stamp: string,
  usn = takeLocalUsn(db, stamp),
): Link {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo, UUID, rb_data_status,
       rb_local_data_status, rb_local_deleted, rb_local_synced, usn, rb_local_usn, created_at,
       updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, ?, ?, ?)`,
  ).run(id, playlistId, contentId, trackNo, randomUUID(), usn, stamp, stamp)
  return { ID: id, ContentID: contentId, TrackNo: trackNo, sep: 0 }
}

const lastTrackNo = (all: Link[]): number => all.reduce((max, l) => Math.max(max, l.TrackNo), 0)

export interface ResolvedTracks {
  contentIds: string[]
  notInCollection: number
  ambiguous: number
}

// The collection entries for the tracks to add. A row read from a rekordbox playlist names
// its entry already; everything else is looked up by path with the same rules the repoint
// uses (resolved symlinks, and a refusal rather than a guess between two rows for one
// file). A track the collection does not have is counted, never created.
export function resolveTracks(
  db: Db,
  tracks: PlaylistTrackRef[],
  options: FindOptions = {},
): ResolvedTracks {
  const known = db.prepare(
    `SELECT 1 FROM djmdContent c WHERE c.ID = ? AND coalesce(c.rb_local_deleted, 0) = 0
        AND c.FileType <> ? AND NOT ${IS_SEPARATOR}`,
  )
  const found: string[] = []
  let notInCollection = 0
  let ambiguous = 0
  for (const track of tracks) {
    if (track.contentId && known.get(track.contentId, STREAMING_FILE_TYPE)) {
      found.push(track.contentId)
      continue
    }
    let id: string | null = null
    let twins = false
    for (const path of track.paths) {
      const match = findTrackByPath(db, path, options)
      if (match === null) continue
      if (isAmbiguous(match)) {
        twins = true
        continue
      }
      if (!known.get(match.id, STREAMING_FILE_TYPE)) continue
      id = match.id
      break
    }
    if (id) found.push(id)
    else if (twins) ambiguous++
    else notInCollection++
  }
  return { contentIds: [...new Set(found)], notInCollection, ambiguous }
}

export function playlistContents(db: Db, playlistId: string): Set<string> {
  return new Set(links(db, playlistId).map((l) => l.ContentID))
}

export function addToPlaylist(
  db: Db,
  playlistId: string,
  contentIds: string[],
  ctx: EditContext,
): { added: number; already: number } {
  requirePlaylist(db, playlistId)
  const stamp = rekordboxStamp(ctx.now)
  const order = links(db, playlistId)
  const present = new Set(order.map((l) => l.ContentID))
  let next = lastTrackNo(order)
  let added = 0
  let already = 0
  for (const id of contentIds) {
    if (present.has(id)) {
      already++
      continue
    }
    present.add(id)
    next += 1
    order.push(insertLink(db, playlistId, id, next, stamp))
    added++
  }
  writeOrder(db, order, stamp)
  return { added, already }
}

// A track row stands for every link of that track in the playlist (the list shows it
// once), so all of them go; a separator goes one link at a time. Links are deleted, as
// rekordbox does with cloud sync off (measured: no soft-deleted link among 9432).
export function removeFromPlaylist(
  db: Db,
  playlistId: string,
  linkIds: string[],
  ctx: EditContext,
): number {
  requirePlaylist(db, playlistId)
  const order = links(db, playlistId)
  requireLinks(order, linkIds)
  const named = order.filter((l) => linkIds.includes(l.ID))
  const tracks = new Set(named.filter((l) => !l.sep).map((l) => l.ContentID))
  const doomed = new Set([
    ...named.map((l) => l.ID),
    ...order.filter((l) => tracks.has(l.ContentID)).map((l) => l.ID),
  ])
  const remove = db.prepare('DELETE FROM djmdSongPlaylist WHERE ID = ?')
  for (const id of doomed) remove.run(id)
  writeOrder(
    db,
    order.filter((l) => !doomed.has(l.ID)),
    rekordboxStamp(ctx.now),
  )
  return doomed.size
}

// The moved rows keep their own relative order and land right before the target (or at the
// end); every other row, shown in Surco or not, keeps its place relative to the rest.
function movedOrder(order: Link[], linkIds: string[], beforeLinkId: string | null): Link[] {
  const moving = new Set(linkIds)
  if (beforeLinkId !== null && moving.has(beforeLinkId)) return order
  const moved = order.filter((l) => moving.has(l.ID))
  const rest = order.filter((l) => !moving.has(l.ID))
  const at = beforeLinkId === null ? rest.length : rest.findIndex((l) => l.ID === beforeLinkId)
  rest.splice(at, 0, ...moved)
  return rest
}

export function moveInPlaylist(
  db: Db,
  playlistId: string,
  linkIds: string[],
  beforeLinkId: string | null,
  ctx: EditContext,
): void {
  requirePlaylist(db, playlistId)
  const order = links(db, playlistId)
  requireLinks(order, beforeLinkId === null ? linkIds : [...linkIds, beforeLinkId])
  if (beforeLinkId !== null && linkIds.includes(beforeLinkId)) return
  writeOrder(db, movedOrder(order, linkIds, beforeLinkId), rekordboxStamp(ctx.now))
}

// A drop onto a row's own place leaves the order as it is; the writer checks this before
// asking the user to close rekordbox, which would otherwise be a cost for no write.
export function moveChangesOrder(
  db: Db,
  playlistId: string,
  linkIds: string[],
  beforeLinkId: string | null,
): boolean {
  const order = links(db, playlistId)
  return movedOrder(order, linkIds, beforeLinkId).some((l, i) => l.ID !== order[i].ID)
}

// The DJ's own separator, found by what it is (a blank file of a second or two) and, among
// several, the one linked most: the measured collection links one 345 times.
export function separatorContent(db: Db): string | null {
  const row = db
    .prepare(
      `SELECT c.ID, count(s.ID) AS uses FROM djmdContent c
         LEFT JOIN djmdSongPlaylist s ON s.ContentID = c.ID AND coalesce(s.rb_local_deleted, 0) = 0
        WHERE coalesce(c.rb_local_deleted, 0) = 0 AND c.FileType <> ? AND ${IS_SEPARATOR}
        GROUP BY c.ID ORDER BY uses DESC, c.ID LIMIT 1`,
    )
    .get(STREAMING_FILE_TYPE) as { ID: string } | undefined
  return row ? String(row.ID) : null
}

export function insertSeparator(
  db: Db,
  playlistId: string,
  beforeLinkId: string,
  ctx: EditContext,
): void {
  requirePlaylist(db, playlistId)
  const separator = separatorContent(db)
  if (!separator) throw new EditRefused('no-separator')
  const order = links(db, playlistId)
  requireLinks(order, [beforeLinkId])
  const stamp = rekordboxStamp(ctx.now)
  // One gesture, one change number: the new row and the rows it renumbers share it.
  const usn = takeLocalUsn(db, stamp)
  const link = insertLink(db, playlistId, separator, lastTrackNo(order) + 1, stamp, usn)
  order.splice(
    order.findIndex((l) => l.ID === beforeLinkId),
    0,
    link,
  )
  writeOrder(db, order, stamp, () => usn)
}

// Whether an edit can apply to the collection as it is now, checked on a read-only handle
// before rekordbox is asked to close: an edit that cannot apply must not cost the user a
// closed rekordbox.
export function editProblem(db: Db, edit: RekordboxPlaylistEdit): 'stale' | 'no-separator' | null {
  if (edit.kind === 'create') {
    if (edit.name.trim() === '') return 'stale'
    return edit.parentId === 'root' || nodeAttribute(db, edit.parentId) === 1 ? null : 'stale'
  }
  if (edit.kind === 'rename' || edit.kind === 'delete') {
    const attribute = nodeAttribute(db, edit.playlistId)
    if (attribute !== 0 && attribute !== 1) return 'stale'
    return edit.kind === 'rename' && edit.name.trim() === '' ? 'stale' : null
  }
  if (nodeAttribute(db, edit.playlistId) !== 0) return 'stale'
  const known = new Set(links(db, edit.playlistId).map((l) => l.ID))
  const named =
    edit.kind === 'move'
      ? [...edit.linkIds, ...(edit.beforeLinkId === null ? [] : [edit.beforeLinkId])]
      : edit.kind === 'remove'
        ? edit.linkIds
        : edit.kind === 'insertSeparator'
          ? [edit.beforeLinkId]
          : []
  if (named.some((id) => !known.has(id))) return 'stale'
  if (edit.kind === 'insertSeparator' && separatorContent(db) === null) return 'no-separator'
  return null
}

// pyrekordbox's rule for a new playlist ID: random, within 28 bits, never below 100.
export function randomPlaylistId(): string {
  return String(randomInt(100, 2 ** 28))
}

// A new playlist or folder goes last among its live siblings, which is where rekordbox puts
// one created from its own menu.
export function createNode(
  db: Db,
  parentId: string,
  name: string,
  folder: boolean,
  ctx: EditContext,
): { id: string; attribute: 0 | 1 } {
  if (parentId !== 'root' && nodeAttribute(db, parentId) !== 1) throw new EditRefused('stale')
  const stamp = rekordboxStamp(ctx.now)
  const { last } = db
    .prepare(
      `SELECT coalesce(max(Seq), 0) AS last FROM djmdPlaylist
        WHERE ParentID = ? AND coalesce(rb_local_deleted, 0) = 0`,
    )
    .get(parentId) as { last: number }
  const id = unusedRowId(db, 'djmdPlaylist', ctx.newPlaylistId ?? randomPlaylistId)
  const attribute = folder ? 1 : 0
  db.prepare(
    `INSERT INTO djmdPlaylist (ID, Seq, Name, ImagePath, Attribute, ParentID, SmartList, UUID,
       rb_data_status, rb_local_data_status, rb_local_deleted, rb_local_synced, usn, rb_local_usn,
       created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, 0, 0, 0, 0, NULL, ?, ?, ?)`,
  ).run(
    id,
    Number(last) + 1,
    name.trim(),
    attribute,
    parentId,
    randomUUID(),
    takeLocalUsn(db, stamp),
    stamp,
    stamp,
  )
  return { id, attribute }
}

function requireNode(db: Db, id: string): void {
  const attribute = nodeAttribute(db, id)
  if (attribute !== 0 && attribute !== 1) throw new EditRefused('stale')
}

export function renameNode(db: Db, id: string, name: string, ctx: EditContext): void {
  requireNode(db, id)
  if (name.trim() === '') throw new EditRefused('stale')
  const stamp = rekordboxStamp(ctx.now)
  db.prepare('UPDATE djmdPlaylist SET Name = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?').run(
    name.trim(),
    takeLocalUsn(db, stamp),
    stamp,
    id,
  )
}

export function nodeSubtree(db: Db, id: string): string[] {
  const children = db.prepare(
    `SELECT ID FROM djmdPlaylist WHERE ParentID = ? AND coalesce(rb_local_deleted, 0) = 0 ORDER BY Seq`,
  )
  const found = [id]
  for (let i = 0; i < found.length; i++) {
    for (const row of children.all(found[i]) as { ID: string }[]) found.push(String(row.ID))
  }
  return found
}

export function deleteNode(db: Db, id: string, ctx: EditContext): string[] {
  requireNode(db, id)
  const { ParentID, Seq } = db
    .prepare('SELECT ParentID, Seq FROM djmdPlaylist WHERE ID = ?')
    .get(id) as { ParentID: string; Seq: number }
  const doomed = nodeSubtree(db, id)
  const unlink = db.prepare('DELETE FROM djmdSongPlaylist WHERE PlaylistID = ?')
  const drop = db.prepare('DELETE FROM djmdPlaylist WHERE ID = ?')
  for (const node of doomed) {
    unlink.run(node)
    drop.run(node)
  }
  const stamp = rekordboxStamp(ctx.now)
  const after = db
    .prepare(
      `SELECT ID, Seq FROM djmdPlaylist WHERE ParentID = ? AND Seq > ? AND coalesce(rb_local_deleted, 0) = 0`,
    )
    .all(ParentID, Seq) as { ID: string; Seq: number }[]
  const renumber = db.prepare(
    'UPDATE djmdPlaylist SET Seq = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?',
  )
  for (const sibling of after)
    renumber.run(sibling.Seq - 1, takeLocalUsn(db, stamp), stamp, sibling.ID)
  return doomed
}

export function trackPlaylists(db: Db, contentId: string): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT p.ID FROM djmdSongPlaylist s JOIN djmdPlaylist p ON p.ID = s.PlaylistID
          WHERE s.ContentID = ? AND coalesce(s.rb_local_deleted, 0) = 0
            AND coalesce(p.rb_local_deleted, 0) = 0 AND p.Attribute = 0`,
      )
      .all(contentId) as { ID: string }[]
  ).map((r) => String(r.ID))
}

export function removeTrackFromPlaylist(
  db: Db,
  playlistId: string,
  contentId: string,
  ctx: EditContext,
): number {
  requirePlaylist(db, playlistId)
  const order = links(db, playlistId)
  const doomed = order.filter((l) => l.ContentID === contentId)
  if (doomed.length === 0) return 0
  const remove = db.prepare('DELETE FROM djmdSongPlaylist WHERE ID = ?')
  for (const l of doomed) remove.run(l.ID)
  writeOrder(
    db,
    order.filter((l) => l.ContentID !== contentId),
    rekordboxStamp(ctx.now),
  )
  return doomed.length
}
