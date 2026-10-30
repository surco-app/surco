import type { EngineShift } from './engineRepoint'
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
    // first sample sits in rekordbox's timeline (see rekordboxTimeline.ts), how much
    // silence was cut from the start and the rate the audio was resampled to, if it was.
    audio?: {
      sourceShiftMs: number
      outputShiftMs: number
      trimmedMs: number
      sampleRateHz?: number
      // The output's exact length in samples, when a trim or a resample changed it.
      sampleCount?: number
    }
    // The source's size before the conversion rewrote it on its own path.
    fromBytes?: number
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
  const engineShift: EngineShift | undefined =
    options.audio &&
    !options.replaces &&
    (options.audio.trimmedMs > 0 || options.audio.sampleRateHz || options.audio.sampleCount)
      ? {
          trimmedMs: options.audio.trimmedMs,
          ...(options.audio.sampleRateHz ? { sampleRateHz: options.audio.sampleRateHz } : {}),
          ...(options.audio.sampleCount ? { sampleCount: options.audio.sampleCount } : {}),
        }
      : undefined
  const extra = {
    ...(options.meta ? { meta: options.meta } : {}),
    ...(audio ? { audio } : {}),
    ...(engineShift ? { engineShift } : {}),
    ...(engineShift && options.fromBytes !== undefined ? { fromBytes: options.fromBytes } : {}),
  }
  if (from === output && !options.meta && !audio) return null
  return { from, to: output, ...extra }
}
