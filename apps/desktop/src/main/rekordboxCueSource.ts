import { type BeatGridFit, provisionalGrid } from './beatGrid'
import type { CueQueue, CueSource } from './cueSource'
import { rekordboxShareDir } from './rekordboxArtwork'
import { readCueWaveDetail, readTrackCues } from './rekordboxCues'
import { keyOf, withCollection } from './rekordboxPlaylistsIpc'
import { queuedWanted } from './rekordboxPlaylistWrite'
import { rekordboxLeadOfFile, rekordboxShiftOfFile } from './rekordboxTimeline'

const WORDS_PER_SECOND = 150

function shiftedWords(words: Uint16Array, shiftMs: number): Uint16Array {
  const lead = Math.round((shiftMs * WORDS_PER_SECOND) / 1000)
  const out = new Uint16Array(lead + words.length)
  out.set(words, lead)
  return out
}

export function rekordboxCueSource(host: {
  collection: () => string
  queue: CueQueue
  applyQuietly: () => void
  beatGrid: (file: string) => Promise<BeatGridFit | null>
  words: (file: string) => Promise<Uint16Array | null>
}): CueSource {
  return {
    trackCues: async (contentId) => {
      const path = host.collection()
      return withCollection(
        path,
        (db) => readTrackCues(db, rekordboxShareDir(path), contentId),
        null,
        await keyOf(path),
      )
    },
    waveDetail: async (contentId) => {
      const path = host.collection()
      return withCollection(
        path,
        (db) => readCueWaveDetail(db, rekordboxShareDir(path), contentId),
        null,
        await keyOf(path),
      )
    },
    dropInput: async () => null,
    auditionLead: async (contentId) => {
      const path = host.collection()
      const file = withCollection(
        path,
        (db) =>
          (
            db
              .prepare(
                `SELECT FolderPath FROM djmdContent WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
              )
              .get(contentId) as { FolderPath: string } | undefined
          )?.FolderPath ?? null,
        null,
        await keyOf(path),
      )
      return file ? rekordboxLeadOfFile(file) : 0
    },
    surcoGrid: async (contentId) => {
      const path = host.collection()
      const row = withCollection(
        path,
        (db) =>
          db
            .prepare(
              `SELECT FolderPath, SampleRate, Length FROM djmdContent
                WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
            )
            .get(contentId) as
            | { FolderPath: string; SampleRate: number | null; Length: number }
            | undefined,
        undefined,
        await keyOf(path),
      )
      if (!row) return null
      const fit = await host.beatGrid(row.FolderPath)
      if (!fit) return null
      const shiftMs = await rekordboxShiftOfFile(row.FolderPath, row.SampleRate || 44100)
      const words = await host.words(row.FolderPath)
      return {
        bpm: fit.bpm,
        grid: provisionalGrid(fit, shiftMs, row.Length * 1000),
        words: words && shiftedWords(words, shiftMs),
      }
    },
    queuedWanted: async (contentId, op) => {
      const path = host.collection()
      const read = withCollection(
        path,
        (db) => readTrackCues(db, rekordboxShareDir(path), contentId, { wave: false }),
        null,
        await keyOf(path),
      )
      return read ? (queuedWanted(op, read) ?? read.cues) : []
    },
    queue: host.queue,
    applyQuietly: host.applyQuietly,
  }
}
