import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import log from 'electron-log/main'
import type { FlushResult } from './libraryRepointFlush'
import type { RekordboxRepoint } from './rekordboxBatch'
import { type ContentProbe, readContentFacts } from './rekordboxContentAdd'
import { type FindOptions, openRekordboxDb } from './rekordboxDb'
import { nodeTimestamp, playlistXmlPath } from './rekordboxMasterXml'
import { resolveTracks, trackPlaylists } from './rekordboxPlaylistEdit'
import type { TrackOp } from './rekordboxQueueOps'

function labelOf(r: RekordboxRepoint): string {
  const artist = r.meta?.artist.trim()
  const title = r.meta?.title.trim()
  return artist && title ? `${artist} - ${title}` : basename(r.to)
}

export async function trackOpsFromRun(
  collectionPath: string,
  repoints: RekordboxRepoint[],
  opts: { repointing: boolean; probe: ContentProbe; find: FindOptions; newId?: () => string },
): Promise<TrackOp[]> {
  const wanted = repoints.filter((r) => r.playlists)
  if (wanted.length === 0 || !collectionPath) return []
  const db = openRekordboxDb(collectionPath, { readonly: true })
  if (!db) return []
  const xmlPath = playlistXmlPath(collectionPath)
  const xml = existsSync(xmlPath) ? readFileSync(xmlPath, 'utf8') : null
  const read: {
    r: RekordboxRepoint
    contentId?: string
    known: string[]
    stamps: Record<string, number>
  }[] = []
  try {
    for (const r of wanted) {
      const paths = opts.repointing && r.from !== r.to ? [r.to, r.from] : [r.to]
      const contentId = resolveTracks(db, [{ paths }], { ...opts.find, quiet: true }).contentIds[0]
      const known = !contentId ? [] : (r.playlistsBase ?? trackPlaylists(db, contentId))
      const stamps: Record<string, number> = {}
      const touched = new Set([
        ...known,
        ...(r.playlists ?? []).flatMap((t) => (t.id ? [t.id] : [])),
      ])
      for (const pid of touched) {
        const stamp = xml === null ? null : nodeTimestamp(xml, pid)
        if (stamp !== null) stamps[pid] = stamp
      }
      read.push({ r, contentId, known, stamps })
    }
  } finally {
    db.close()
  }
  const newId = opts.newId ?? randomUUID
  const ops: TrackOp[] = []
  for (const { r, contentId, known, stamps } of read) {
    const facts = r.meta ? await readContentFacts(r.to, r.meta, opts.probe).catch(() => null) : null
    ops.push({
      id: newId(),
      kind: 'track',
      path: r.to,
      label: labelOf(r),
      ...(contentId ? { contentId } : {}),
      facts,
      wanted: r.playlists ?? [],
      known,
      stamps,
    })
  }
  return ops
}

export function libraryTrackOps(
  repoints: RekordboxRepoint[],
  library: 'traktor' | 'engine',
  newId: () => string = randomUUID,
): TrackOp[] {
  return repoints.flatMap((r) => {
    const choice = library === 'traktor' ? r.traktorPlaylists : r.enginePlaylists
    if (!choice) return []
    return [
      {
        id: newId(),
        kind: 'track',
        path: r.to,
        ...(r.from !== r.to ? { from: r.from } : {}),
        label: labelOf(r),
        facts: null,
        wanted: choice.wanted,
        known: choice.base,
        stamps: {},
      },
    ]
  })
}

export interface RunQueueDeps {
  collectionPath: string
  held?: boolean
  // The collection is on a drive that is not mounted now, so its repoints wait for it.
  unplugged?: boolean
  flushRepoints: (repoints: RekordboxRepoint[]) => Promise<FlushResult>
  readOps: (repoints: RekordboxRepoint[]) => Promise<TrackOp[]>
  enqueue: (ops: TrackOp[], repoints: RekordboxRepoint[]) => void
  apply: () => void
}

export async function queueConversionRun(
  repoints: RekordboxRepoint[],
  deps: RunQueueDeps,
): Promise<void> {
  const result = await deps.flushRepoints(repoints)
  const waiting =
    result.blocked === 'rekordbox-running' ||
    deps.held ||
    (result.blocked === 'collection-missing' && deps.unplugged)
      ? repoints
      : []
  const ops = deps.collectionPath
    ? await deps.readOps(repoints).catch((e) => {
        log.error('rekordbox queue: reading the run playlists failed', e)
        return []
      })
    : []
  if (ops.length === 0 && waiting.length === 0) return
  deps.enqueue(ops, waiting)
  deps.apply()
}
