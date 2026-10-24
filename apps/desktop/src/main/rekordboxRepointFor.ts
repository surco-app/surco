import type { RekordboxRepoint } from './rekordboxBatch'
import type { RekordboxMeta } from './rekordboxMetadata'

// What a finished conversion has to tell rekordbox, or null when it has nothing to say.
//
// Deliberately simpler than the Traktor rule next to it in ffmpeg.ts. Traktor addresses a
// track as volume + directory + file and only ever rewrites the file part, so a
// conversion that writes into a different folder cannot be followed there and is left
// pointing at the original on purpose. rekordbox keeps the whole path in one column, so
// the entry can follow the file wherever it landed — which is what the user asked for.
export function rekordboxRepointFor(
  input: string,
  output: string,
  // The file this conversion supersedes, when it is replacing a copy already in the
  // library. That file — not the one being converted — is what the collection has indexed:
  // a FLAC downloaded into some folder has never been in rekordbox, so repointing from it
  // matched nothing and left the entry on the old MP3.
  options: {
    replaces?: string
    meta?: RekordboxMeta
    // Set when the conversion rewrote the audio rather than copying it: where each file's
    // first sample sits in rekordbox's timeline (see rekordboxTimeline.ts) and how much
    // silence was cut from the start.
    audio?: { sourceShiftMs: number; outputShiftMs: number; trimmedMs: number }
  } = {},
): RekordboxRepoint | null {
  const from = options.replaces ?? input
  const audio = options.audio && {
    cueShiftMs: options.replaces
      ? 0
      : Math.round(
          options.audio.outputShiftMs - options.audio.sourceShiftMs - options.audio.trimmedMs,
        ),
  }
  const extra = {
    ...(options.meta ? { meta: options.meta } : {}),
    ...(audio ? { audio } : {}),
  }
  if (from === output && !options.meta && !audio) return null
  return { from, to: output, ...extra }
}
