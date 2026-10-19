import type Database from 'better-sqlite3-multiple-ciphers'
import { type LearnedFlow, type LearnTrack, learnFlow } from '../shared/learnFlow'
import { readTrackCues } from './rekordboxCues'

type Db = InstanceType<typeof Database>

export interface LearnRead {
  tracks: { contentId: string; track: LearnTrack }[]
  withCall: number
  missing: string[]
  notAnalysed: string[]
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

export function collectionLearnTracks(db: Db, shareDir: string): LearnTrack[] {
  return readLearnTracks(db, shareDir).tracks.map((t) => t.track)
}

export function learnFromCollection(db: Db, shareDir: string): LearnedFlow | null {
  return learnFlow(collectionLearnTracks(db, shareDir))
}
