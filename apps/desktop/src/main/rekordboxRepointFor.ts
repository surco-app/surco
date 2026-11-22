import type { ReplaceShift } from '../shared/replaceShift'
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
    // How far the replacement moved the audio against the file it replaces, measured on
    // what ffmpeg decodes: positive when the new file's audio starts later.
    replaceShift?: ReplaceShift
    // Where rekordbox places the first sample of the replaced file and of the replacement,
    // the replacement's real rate and, if the conversion counted it, its length in samples.
    replaceAudio?: {
      oldShiftMs: number
      newShiftMs: number
      sampleRateHz?: number
      sampleCount?: number
    }
    // The source's size before the conversion rewrote it on its own path.
    fromBytes?: number
    names?: RekordboxRepoint['names']
  } = {},
): RekordboxRepoint | null {
  const from = options.replaces ?? input
  // A replacement's cues were set on the old file's audio: they follow it by the measured
  // shift, plus the difference in where rekordbox places each file's first sample. Engine
  // DJ and VirtualDJ count from the first sample with no lead, and their shift subtracts a
  // trim, so audio that starts later is a negative trim.
  const moved =
    options.replaces && options.replaceShift && 'moved' in options.replaceShift
      ? options.replaceShift.moved
      : undefined
  const replaceAudio = options.replaceAudio ?? { oldShiftMs: 0, newShiftMs: 0 }
  // A replacement that moved the audio leaves rekordbox's waveform and grid describing the
  // old file even when the samples were copied, so it gets the same re-analysis a
  // re-encoded one does.
  const audio =
    options.replaces && (options.audio || moved)
      ? {
          cueShiftMs:
            moved === undefined
              ? 0
              : Math.round(moved + replaceAudio.newShiftMs - replaceAudio.oldShiftMs),
        }
      : options.audio && {
          cueShiftMs: Math.round(
            options.audio.outputShiftMs - options.audio.sourceShiftMs - options.audio.trimmedMs,
          ),
        }
  // Engine DJ keeps cues in samples at the old file's rate, so a replacement at another rate
  // has to hand it the new one even when the shift was not trusted and nothing moves in time.
  const engineShift: EngineShift | undefined =
    moved !== undefined || (options.replaces && replaceAudio.sampleRateHz)
      ? {
          trimmedMs: moved === undefined ? 0 : 0 - Math.round(moved),
          ...(replaceAudio.sampleRateHz ? { sampleRateHz: replaceAudio.sampleRateHz } : {}),
          ...(replaceAudio.sampleCount ? { sampleCount: replaceAudio.sampleCount } : {}),
        }
      : options.audio &&
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
    ...((!options.replaces || options.replaces === output) && options.fromBytes !== undefined
      ? { fromBytes: options.fromBytes }
      : {}),
    ...(options.names ? { names: options.names } : {}),
  }
  if (from === output && !options.meta && !audio) return null
  return { from, to: output, ...(options.replaces ? { replaced: true as const } : {}), ...extra }
}
