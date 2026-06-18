import type { TrackItem } from '../types'

export interface CoverSourceFields {
  coverUrl?: string
  coverPath?: string
  coverFromFile?: string
}

// What a write path (convert, Apple Music add, export, drag) should name as the art
// source. When the shown cover is the file's own embedded picture, the renderer only
// holds a display thumbnail of it — so the job names the audio file and main pulls
// the full-resolution art fresh. A Discogs URL or a user-picked file passes through.
export function coverSourceOf(
  track: Pick<TrackItem, 'coverUrl' | 'coverPath' | 'embeddedCover' | 'inputPath'>,
): CoverSourceFields {
  if (track.coverUrl && track.coverUrl === track.embeddedCover) {
    return { coverFromFile: track.inputPath }
  }
  return { coverUrl: track.coverUrl, coverPath: track.coverPath }
}

// The cover argument that tells buildReleaseMeta to keep the file's own art and fill from
// the release only when the file carries none. The editor's album match and the
// background auto-match sweep apply the same non-destructive rule, so they read it from
// one place rather than each spelling out the `keep: !!coverUrl` predicate.
export function keepCoverArg(
  track: Pick<TrackItem, 'coverUrl' | 'coverPath'>,
): { url?: string; path?: string; keep: boolean } {
  return { url: track.coverUrl, path: track.coverPath, keep: !!track.coverUrl }
}
