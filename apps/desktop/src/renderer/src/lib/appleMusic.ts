import type { OutputFormat } from '../../../shared/types'
import type { TrackItem } from '../types'

// A track can be added to Apple Music by hand only after it has been converted —
// the add operates on the file on disk, so there is nothing to add until the
// output exists (status 'done' with an outputPath). It is gated to macOS, where
// the Music AppleScript bridge lives, and excludes FLAC, which Apple Music cannot
// ingest. The transient 'adding'/'added' states block a second click so the same
// track is never imported twice.
export function canAddToAppleMusic(
  track: TrackItem,
  platform: string,
  format: OutputFormat,
): boolean {
  return (
    platform === 'darwin' &&
    format !== 'flac' &&
    track.status === 'done' &&
    !!track.outputPath &&
    track.musicStatus !== 'adding' &&
    track.musicStatus !== 'added'
  )
}
