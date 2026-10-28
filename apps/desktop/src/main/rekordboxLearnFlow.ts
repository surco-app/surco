import type Database from 'better-sqlite3-multiple-ciphers'
import { findDrops } from '../shared/cueRules'
import { type TasteTrack, tasteTrackOf } from '../shared/dropTaste'
import type { LearnTrack } from '../shared/learnFlow'
import { rekordboxShareDir } from './rekordboxArtwork'
import { readCueWaveDetail, readTrackCues } from './rekordboxCues'
import { openRekordboxDb } from './rekordboxDb'
import { keyOf, withCollection } from './rekordboxPlaylistsIpc'

type Db = InstanceType<typeof Database>

export interface LearnRead {
  tracks: { contentId: string; track: LearnTrack }[]
  withCall: number
  missing: string[]
  notAnalysed: string[]
}

const TRACKS_PER_PAUSE = 25

export interface CollectionMarks {
  learn: LearnTrack[]
  taste: TasteTrack[]
}

const markedIds = (db: Db): string[] =>
  (
    db
      .prepare(
        'SELECT DISTINCT ContentID FROM djmdCue WHERE coalesce(rb_local_deleted, 0) = 0 AND Kind = 0',
      )
      .all() as { ContentID: string }[]
  ).map((r) => String(r.ContentID))

export async function readCollectionMarks(
  db: Db,
  shareDir: string,
  pause: () => Promise<void>,
): Promise<CollectionMarks> {
  const out: CollectionMarks = { learn: [], taste: [] }
  for (const [i, contentId] of markedIds(db).entries()) {
    if (i % TRACKS_PER_PAUSE === 0) await pause()
    const read = readTrackCues(db, shareDir, contentId, { wave: false })
    if (!read?.analysed) continue
    out.learn.push({
      beats: read.grid.map((b) => b.ms),
      cues: read.cues.map(({ ms, kind, color }) => ({ ms, kind, color })),
      strong: read.strong,
      phrases: read.phrases,
    })
    const drops = findDrops(
      read.cues.filter((c) => c.kind === 0).map((c) => c.ms),
      read.cues.filter((c) => c.kind !== 0).map((c) => c.ms),
    )
    const words = drops.length > 0 ? readCueWaveDetail(db, shareDir, contentId) : null
    const track =
      words && tasteTrackOf(contentId, { grid: read.grid, phrases: read.phrases, words }, drops)
    if (track) out.taste.push(track)
  }
  return out
}

export function markedTracks(path: string, key?: string): number {
  return withCollection(path, (db) => markedIds(db).length, 0, key)
}

const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

export async function readCollectionMarksAt(path: string): Promise<CollectionMarks | null> {
  if (!path) return null
  const key = await keyOf(path)
  const db = openRekordboxDb(path, key ? { readonly: true, key } : { readonly: true })
  if (!db) return null
  try {
    return await readCollectionMarks(db, rekordboxShareDir(path), nextTurn)
  } finally {
    db.close()
  }
}

export function readLearnTracks(db: Db, shareDir: string): LearnRead {
  const ids = (
    db
      .prepare(
        'SELECT DISTINCT ContentID FROM djmdCue WHERE coalesce(rb_local_deleted, 0) = 0 AND Kind = 0',
      )
      .all() as { ContentID: string }[]
  ).map((r) => String(r.ContentID))
  const out: LearnRead = { tracks: [], withCall: ids.length, missing: [], notAnalysed: [] }
  for (const contentId of ids) {
    const read = readTrackCues(db, shareDir, contentId, { wave: false })
    if (!read) out.missing.push(contentId)
    else if (!read.analysed) out.notAnalysed.push(contentId)
    else
      out.tracks.push({
        contentId,
        track: {
          beats: read.grid.map((b) => b.ms),
          cues: read.cues.map(({ ms, kind, color }) => ({ ms, kind, color })),
          strong: read.strong,
          phrases: read.phrases,
        },
      })
  }
  return out
}
