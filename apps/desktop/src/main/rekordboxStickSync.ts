import log from 'electron-log/main'
import type { openRekordboxDb } from './rekordboxDb'
import { hexId } from './rekordboxMasterXml'

// What lets rekordbox keep syncing a stick Surco wrote: the collection's identity, which
// baken writes into export.pdb and OneLibrary (patch 0005), the stick's own playlist ids,
// and the two .sync files rekordbox reads to know which of its playlists the stick holds.
// Every rule was measured against rekordbox 7.2.19's own export of the test stick
// (usb-coexist/rebuild.md, 16/10 and 18/10; docs/export-usb-medidas.md sections 5-6).

type RekordboxDb = NonNullable<ReturnType<typeof openRekordboxDb>>

export interface MasterIdentity {
  dbId: number
  myTagMasterDbId: number
  myTags: { id: number; seq: number; name: string; attribute: number; parent: number }[]
  fileSizes: Record<string, number>
}

// master node IDs; 'root' for the root, as djmdPlaylist.ParentID has it.
export interface StickNode {
  id: string
  parentId: string
  folder: boolean
}

// rekordbox deletes nothing else on a stick before rewriting its library (16/10). The WAL of
// exportLibrary.db is not among them: baken clears it only as it replaces the database, so
// a run cancelled before that keeps rekordbox's last writes to the old one.
export const STALE_STICK_FILES: readonly string[] = ['sync.temp', 'sync.devlibplus.temp']
export const SYNC_FILES: readonly string[] = ['playlists3.sync', 'playlists3Plus.sync']

const CHUNK = 500
const U32_MAX = 2 ** 32 - 1

// The sync file prints the DBID as a signed 32-bit number (3942308644 is -352658652).
export function signedInt32(n: number): number {
  return n >= 2 ** 31 ? n - 2 ** 32 : n
}

const masterId = (hex: string): string => BigInt(`0x${hex}`).toString()

// Anchored on "<NODE " so an Id is never read out of a ParentId.
const SYNC_NODE = /<NODE Id="([0-9A-F]+)"[^>]*\bDev_ID="(\d+)"/g

// rekordbox knows the stick's playlists by these ids: a re-export keeps every one the stick
// already has, and a new node takes the next above every id in the file, those of
// playlists left out of this export included, so none can ever be taken twice. The highest
// is read from every Dev_ID in the file, whatever its node's Id and however often that Id
// repeats. baken's own fallback (above the ids it is given) is never relied on.
export function stickDeviceIds(nodes: StickNode[], syncText: string | null): Map<string, number> {
  const onStick = new Map<string, number>()
  for (const m of (syncText ?? '').matchAll(SYNC_NODE)) onStick.set(masterId(m[1]), Number(m[2]))
  const taken = [...(syncText ?? '').matchAll(/\bDev_ID="(\d+)"/g)].map((m) => Number(m[1]))
  let next = Math.max(0, ...taken) + 1
  const ids = new Map<string, number>()
  for (const n of nodes) {
    const kept = onStick.get(n.id)
    if (kept !== undefined) {
      ids.set(n.id, kept)
      continue
    }
    // baken stores these as u32 and refuses one past it.
    if (next > U32_MAX) throw new Error('no stick playlist id is left')
    ids.set(n.id, next)
    next += 1
  }
  return ids
}

// The Timestamp of each node in masterPlaylists6.xml, by hex Id: rekordbox copies it into
// the sync file, and a later one there is how it sees a playlist changed since the export.
export function nodeTimestamps(masterPlaylistsXml: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of masterPlaylistsXml.matchAll(/<NODE Id="([0-9A-F]+)"[^>]*\bTimestamp="(\d+)"/g))
    out.set(m[1], Number(m[2]))
  return out
}

// Byte for byte what rekordbox writes: CRLF, the root node, then one node per folder and
// playlist in tree order. A node not yet in masterPlaylists6.xml falls back to its
// updated_at (plan Decision 20).
export function syncFileText(
  dbId: number,
  nodes: StickNode[],
  devIds: ReadonlyMap<string, number>,
  stamps: ReadonlyMap<string, number>,
  updatedAt: ReadonlyMap<string, number>,
): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '',
    `<Sync DBID="${signedInt32(dbId)}" AutomaticSync="1" AllPlaylists="0" IncludeCue="1" ForcedSync="0" Timestamp="0">`,
    '  <Playlists>',
    '    <NODE Id="0" ParentId="0" Attribute="1" Lib_Type="0" Dev_ID="0" Timestamp="0" CheckType="2"/>',
    ...nodes.map((n) => {
      const id = hexId(n.id)
      const stamp = stamps.get(id) ?? updatedAt.get(n.id) ?? 0
      return `    <NODE Id="${id}" ParentId="${hexId(n.parentId)}" Attribute="${n.folder ? 1 : 0}" Lib_Type="0" Dev_ID="${devIds.get(n.id)}" Timestamp="${stamp}" CheckType="${n.folder ? 2 : 1}"/>`
    }),
    '  </Playlists>',
    '</Sync>',
    '',
  ]
  return lines.join('\r\n')
}

// The playlists (never the folders) a stick's sync file has ticked, by master ID. A node
// whose Id is not a master row's hex ID names no playlist of the collection.
export function syncedPlaylists(syncText: string): string[] {
  return [...syncText.matchAll(/<NODE [^>]*>/g)].flatMap(([tag]) => {
    const id = /<NODE Id="([0-9A-F]+)"/.exec(tag)
    return id && /\bAttribute="0"/.test(tag) && /\bCheckType="1"/.test(tag) ? [masterId(id[1])] : []
  })
}

// What rekordbox's own export writes from master.db: the DBID on every track row and in
// OneLibrary, the SyncService cloud row's ID as myTagMasterDBID (the table also holds a
// CDPFilterVersion row, measured 18/10, so the row is chosen by name), the live My Tags,
// and master's FileSize even when it is stale.
export function readMasterIdentity(db: RekordboxDb, trackIds: string[]): MasterIdentity {
  const property = db.prepare('SELECT DBID FROM djmdProperty').get() as
    | { DBID: string | number }
    | undefined
  const cloud = db
    .prepare(
      `SELECT ID FROM djmdCloudProperty WHERE Reserved1 = 'SyncService' AND Reserved2 = 'Google'`,
    )
    .get() as { ID: string | number } | undefined
  if (!property) log.warn('rekordbox collection has no DBID in djmdProperty')
  if (!cloud) log.warn('rekordbox collection has no SyncService cloud property')
  const tags = db
    .prepare(
      `SELECT ID, Seq, Name, Attribute, ParentID FROM djmdMyTag
        WHERE coalesce(rb_local_deleted, 0) = 0
        ORDER BY CAST(ID AS INTEGER)`,
    )
    .all() as {
    ID: string
    Seq: number | null
    Name: string | null
    Attribute: number
    ParentID: string
  }[]
  const fileSizes: Record<string, number> = {}
  for (let i = 0; i < trackIds.length; i += CHUNK) {
    const part = trackIds.slice(i, i + CHUNK)
    const rows = db
      .prepare(
        `SELECT ID, FileSize FROM djmdContent WHERE ID IN (${part.map(() => '?').join(', ')})`,
      )
      .all(...part) as { ID: string; FileSize: number | null }[]
    for (const r of rows) fileSizes[String(r.ID)] = Number(r.FileSize) || 0
  }
  return {
    dbId: Number(property?.DBID ?? 0),
    myTagMasterDbId: Number(cloud?.ID ?? 0),
    myTags: tags.map((t) => ({
      id: Number(t.ID),
      // baken loads it as u32: a Seq of 0 or none must not become -1 or NaN.
      seq: Math.max(0, Math.trunc(Number(t.Seq) || 0) - 1),
      name: t.Name ?? '',
      attribute: t.Attribute,
      parent: t.ParentID === 'root' ? 0 : Number(t.ParentID),
    })),
    fileSizes,
  }
}
