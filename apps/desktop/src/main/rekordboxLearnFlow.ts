import type Database from 'better-sqlite3-multiple-ciphers'
import { type LearnedFlow, type LearnTrack, learnFlow } from '../shared/learnFlow'
import { readTrackCues } from './rekordboxCues'

type Db = InstanceType<typeof Database>

export function collectionLearnTracks(db: Db, shareDir: string): LearnTrack[] {
  const ids = db
    .prepare(
      'SELECT DISTINCT ContentID FROM djmdCue WHERE coalesce(rb_local_deleted, 0) = 0 AND Kind = 0',
    )
    .all() as { ContentID: string }[]
  return ids.flatMap(({ ContentID }) => {
    const read = readTrackCues(db, shareDir, String(ContentID), { wave: false })
    if (!read?.analysed) return []
    return [
      {
        beats: read.grid.map((b) => b.ms),
        cues: read.cues.map(({ ms, kind, color }) => ({ ms, kind, color })),
        strong: read.strong,
        phrases: read.phrases,
      },
    ]
  })
}

export function learnFromCollection(db: Db, shareDir: string): LearnedFlow | null {
  return learnFlow(collectionLearnTracks(db, shareDir))
}
