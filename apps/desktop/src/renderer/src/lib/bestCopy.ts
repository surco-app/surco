import type { PairFacts } from '../../../shared/types'
import { type ReplaceSide, replaceWarning } from './replaceWarning'

export interface CopyFacts {
  ext: string
  cutoffHz?: number
  hasKnee?: boolean
  processed?: boolean
  upsampled?: boolean
  sampleRateHz?: number
  bitsUsage?: 'full' | 'padded16' | 'unknown'
  fingerprint?: string | null
  peakCount?: number | null
  crestDb?: number | null
  integratedLufs?: number
}

export type CopyReason =
  | 'lossless'
  | 'transcode'
  | 'cutoff'
  | 'processed'
  | 'upsampled'
  | 'peakCount'
  | 'crest'

export type CopyVerdict =
  | { winner: 'a' | 'b'; reason: CopyReason }
  | { winner: 'same' }
  | { winner: 'tie' }

export interface CopyMargins {
  sameMasterCorrelation: number
  peakCountRatio: number
  crestDb: number
}

// Measured on 26 real pairs: same-master pairs correlate >= 0.98 once aligned; the 8 that differed by >= 1 LU had peak count ratios of 25x to 36000x while pairs under 0.4 LU stayed under 3x; the one pair where the two metrics disagreed had 1.18 dB of crest.
export const COPY_MARGINS: CopyMargins = {
  sameMasterCorrelation: 0.98,
  peakCountRatio: 10,
  crestDb: 1.5,
}

const IDENTICAL_RESIDUAL_DB = -60
const IDENTICAL_GAIN_DB = 0.01

function side(f: CopyFacts): ReplaceSide {
  return { ext: f.ext, cutoffHz: f.cutoffHz, hasKnee: f.hasKnee }
}

function flag(
  a: boolean | undefined,
  b: boolean | undefined,
  reason: CopyReason,
): CopyVerdict | null {
  if (a && !b) return { winner: 'b', reason }
  if (b && !a) return { winner: 'a', reason }
  return null
}

function byPeakCount(a: CopyFacts, b: CopyFacts, ratio: number): CopyVerdict | null {
  if (a.peakCount == null || b.peakCount == null) return null
  const hi = Math.max(a.peakCount, b.peakCount) + 1
  const lo = Math.min(a.peakCount, b.peakCount) + 1
  if (hi / lo < ratio) return null
  return { winner: a.peakCount < b.peakCount ? 'a' : 'b', reason: 'peakCount' }
}

function byCrest(a: CopyFacts, b: CopyFacts, margin: number): CopyVerdict | null {
  if (a.crestDb == null || b.crestDb == null || Math.abs(a.crestDb - b.crestDb) < margin) {
    return null
  }
  return { winner: a.crestDb > b.crestDb ? 'a' : 'b', reason: 'crest' }
}

const REASON = {
  'lossless-to-lossy': 'lossless',
  transcode: 'transcode',
  'lower-cutoff': 'cutoff',
} as const

// The bits a copy really carries: a 24-bit file whose low byte is empty holds 16-bit audio,
// and a file the bit scan does not apply to (16-bit, lossy) has no third byte to carry. A
// 24-bit file the scan could not call may be real 24-bit, so it matches nothing.
function bitsClass(f: CopyFacts): '16' | 'full' | null {
  if (f.bitsUsage === 'unknown') return null
  return f.bitsUsage === 'full' ? 'full' : '16'
}

// The fingerprint and the pair probe both work on a 16-bit 44.1 kHz decode, which flattens
// the very rate and depth a hi-res copy is kept for, so those must match on their own.
export function isSameAudio(
  a: CopyFacts,
  b: CopyFacts,
  pair: PairFacts | null | undefined,
): boolean {
  if (a.sampleRateHz !== b.sampleRateHz) return false
  const bits = bitsClass(a)
  if (bits === null || bits !== bitsClass(b)) return false
  if (a.fingerprint && a.fingerprint === b.fingerprint) return true
  return (
    !!pair && pair.residualDb <= IDENTICAL_RESIDUAL_DB && Math.abs(pair.gainDb) < IDENTICAL_GAIN_DB
  )
}

export function compareCopies(
  a: CopyFacts,
  b: CopyFacts,
  pair?: PairFacts | null,
  margins: CopyMargins = COPY_MARGINS,
): CopyVerdict {
  if (isSameAudio(a, b, pair)) return { winner: 'same' }
  const bWorse = replaceWarning(side(a), side(b))
  const aWorse = replaceWarning(side(b), side(a))
  if (bWorse && !aWorse) return { winner: 'a', reason: REASON[bWorse.reason] }
  if (aWorse && !bWorse) return { winner: 'b', reason: REASON[aWorse.reason] }
  const cleaner =
    flag(a.processed, b.processed, 'processed') ?? flag(a.upsampled, b.upsampled, 'upsampled')
  if (cleaner) return cleaner
  if (!pair || pair.correlation < margins.sameMasterCorrelation) return { winner: 'tie' }
  return (
    byPeakCount(a, b, margins.peakCountRatio) ?? byCrest(a, b, margins.crestDb) ?? { winner: 'tie' }
  )
}
