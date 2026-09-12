import { isLosslessContainer, isLossyContainer, isTranscode } from './quality'

// Whether replacing the library copy with the new file gives something up.
//
// The rule is the user's: warn, never block. Replacing a 320 kbps rip with a slightly
// different 320 is their call; replacing a WAV master with an MP3 is too, as long as they
// are told. So this only ever returns something to say, never a refusal.

export type ReplaceWarningReason = 'lossless-to-lossy' | 'lower-cutoff' | 'transcode'

export interface ReplaceWarning {
  reason: ReplaceWarningReason
}

export interface ReplaceSide {
  ext: string
  // The measured spectral cutoff, when the file has been analyzed. Absent for a file
  // nobody has looked at yet.
  cutoffHz?: number
  hasKnee?: boolean
}

// How far two cutoff measurements may differ before the difference means anything. The
// detector was calibrated against 39 LAME encodes of known lowpass: bias +356 Hz, spread
// -500 to +2100. Anything inside that spread is the measurement, not the music, and a
// tighter threshold would cry downgrade on two rips of the same quality.
const CUTOFF_NOISE_HZ = 2100

export function replaceWarning(oldFile: ReplaceSide, newFile: ReplaceSide): ReplaceWarning | null {
  // A lossless container built around a lossy source looks like an upgrade and is not
  // one, so it is worth saying even when the old file was lossy too. Checked first: the
  // container comparison below would call this an upgrade.
  if (isTranscode(newFile.ext, newFile.cutoffHz ?? Number.POSITIVE_INFINITY, newFile.hasKnee)) {
    return { reason: 'transcode' }
  }

  // The clearest loss: a lossless master traded for a lossy file. .m4a belongs to neither
  // list — it holds AAC or ALAC and the extension cannot say which — so it never triggers
  // this in either direction rather than guessing.
  if (isLosslessContainer(oldFile.ext) && isLossyContainer(newFile.ext)) {
    return { reason: 'lossless-to-lossy' }
  }

  // Two lossy files: the container says nothing, the measured cutoff does. Needs both
  // numbers — one measurement cannot be compared against an unknown.
  if (
    isLossyContainer(oldFile.ext) &&
    isLossyContainer(newFile.ext) &&
    oldFile.cutoffHz !== undefined &&
    newFile.cutoffHz !== undefined &&
    oldFile.cutoffHz - newFile.cutoffHz > CUTOFF_NOISE_HZ
  ) {
    return { reason: 'lower-cutoff' }
  }

  return null
}
