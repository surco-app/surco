import type { EngineExportTrack } from '../../../shared/types'
import type { TrackItem } from '../types'

// Shapes the loaded tracks into the serializable payload the Engine DJ export IPC takes. The
// heavy lifting (resolving the on-disk path to a relative one, reading file sizes, writing the
// SQLite library) happens in the main process; this only picks the fields that survive IPC.
export function buildEnginePayload(tracks: TrackItem[]): EngineExportTrack[] {
  return tracks.map((t) => ({
    // Point at the converted output when there is one; Engine should reference the file the DJ
    // will actually play, not the pre-conversion source.
    path: t.outputPath ?? t.inputPath,
    title: t.meta.title || t.fileName,
    artist: t.meta.artist,
    album: t.meta.album,
    genre: t.meta.genre,
    comment: t.meta.comment,
    bpm: t.meta.bpm,
    year: t.meta.year,
    rating: t.meta.rating ?? '',
    durationSec: t.duration,
  }))
}
