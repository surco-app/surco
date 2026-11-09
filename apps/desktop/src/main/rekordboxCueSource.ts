import type { GridFit } from '../shared/gridEdit'
import { type BeatGridFit, provisionalGrid, REKORDBOX_BEAT_AFTER_RISE_MS } from './beatGrid'
import type { CueQueue, CueSource } from './cueSource'
import { CUE_WAVE_FINE_PER_SECOND } from './cueWaveFine'
import { shiftedWords } from './cueWords'
import { cachedGridVerdict } from './gridVerdictCache'
import { rekordboxShareDir } from './rekordboxArtwork'
import { readCueWaveDetail, readTrackCues } from './rekordboxCues'
import { keyOf, withCollection } from './rekordboxPlaylistsIpc'
import { queuedWanted } from './rekordboxPlaylistWrite'
import { rekordboxLeadOfFile, rekordboxShiftOfFile } from './rekordboxTimeline'

export function rekordboxCueSource(host: {
  collection: () => string
  queue: CueQueue
  applyQuietly: () => void
  beatGrid: (file: string, priority?: 'high' | 'low') => Promise<BeatGridFit | null>
  words: (file: string) => Promise<Uint16Array | null>
  fine?: (file: string) => Promise<Uint8Array | null>
}): CueSource {
  const audioRowOf = async (
    contentId: string,
  ): Promise<{ FolderPath: string; SampleRate: number | null; Length: number } | undefined> => {
    const path = host.collection()
    return withCollection(
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
  }
  const gridFit = async (
    contentId: string,
    priority: 'high' | 'low' = 'high',
  ): Promise<GridFit | null> => {
    const row = await audioRowOf(contentId)
    if (!row) return null
    const fit = await host.beatGrid(row.FolderPath, priority)
    if (!fit) return null
    const lead =
      (await rekordboxShiftOfFile(row.FolderPath, row.SampleRate || 44100)) +
      REKORDBOX_BEAT_AFTER_RISE_MS
    return {
      bpm: fit.bpm,
      firstMs: fit.firstMs + lead,
      phases: fit.phases?.map((p) => ({ ms: p.ms + lead, firstMs: p.firstMs + lead })),
    }
  }
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
    fineWave: async (contentId) => {
      const row = await audioRowOf(contentId)
      const levels = row && host.fine ? await host.fine(row.FolderPath) : null
      if (!row || !levels) return null
      return {
        levels,
        perSecond: CUE_WAVE_FINE_PER_SECOND,
        startMs: await rekordboxShiftOfFile(row.FolderPath, row.SampleRate || 44100),
      }
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
      const row = await audioRowOf(contentId)
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
    gridFit: (contentId) => gridFit(contentId),
    gridVerdict: async (contentId) => {
      const path = host.collection()
      const read = withCollection(
        path,
        (db) => readTrackCues(db, rekordboxShareDir(path), contentId, { wave: false }),
        null,
        await keyOf(path),
      )
      if (!read?.analysed) return null
      const row = await audioRowOf(contentId)
      return cachedGridVerdict(row?.FolderPath ?? null, read.grid, () => gridFit(contentId, 'low'))
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
