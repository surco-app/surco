import { beyondVersionReach, VERSION_GAP_SEC } from '../../../shared/copyVersion'
import type { PairFacts, PairProbe } from '../../../shared/types'
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
  durationSec?: number
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
  | { winner: 'tie'; sameMaster?: true }
  | { winner: 'different' }

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

// Another version is read from PairFacts.versionCorrelation alone: the |correlation| of
// comparePair's wider search (4410 Hz, as far as the length gap plus a second either way,
// either polarity), which is only run when the lengths differ by more than VERSION_GAP_SEC, so
// a copy of one master with a trimmed or padded head lines up again. The 0.5 line comes from
// the 22/11 measurement: different edits of one title correlated about 0 (0.19 at best,
// searched 60 s either way) and one master stayed at 0.95 or above. Both files must also have
// given the search real audio: 10 s or more and above the -70 LUFS gate.
// Past the search's own reach (VERSION_REACH_MAX_SECONDS, about 54 s) nothing is measured, and
// the lengths alone decide: a master with a trimmed or padded head differs by seconds, so one
// that carries more than that much extra audio is a longer or shorter edit, another version.
export const OTHER_VERSION = {
  maxCorrelation: 0.5,
  minDurationSec: 10,
  silentLufs: -70,
}

function aligned(pair: PairProbe | null | undefined): PairFacts | null {
  return pair && 'correlation' in pair ? pair : null
}

function isOtherVersion(a: CopyFacts, b: CopyFacts, pair: PairProbe | null): boolean {
  if (a.durationSec == null || b.durationSec == null) return false
  const gapSec = Math.abs(a.durationSec - b.durationSec)
  if (gapSec <= VERSION_GAP_SEC) return false
  if (beyondVersionReach(gapSec)) {
    return Math.min(a.durationSec, b.durationSec) >= OTHER_VERSION.minDurationSec
  }
  if (pair?.versionCorrelation == null) return false
  if (pair.versionCorrelation >= OTHER_VERSION.maxCorrelation) return false
  const probed = (f: CopyFacts): boolean =>
    f.durationSec != null &&
    f.durationSec >= OTHER_VERSION.minDurationSec &&
    f.integratedLufs != null &&
    f.integratedLufs > OTHER_VERSION.silentLufs
  return probed(a) && probed(b)
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
  probe: PairProbe | null | undefined,
): boolean {
  const pair = aligned(probe)
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
  probe?: PairProbe | null,
  margins: CopyMargins = COPY_MARGINS,
): CopyVerdict {
  const pair = probe === undefined ? undefined : aligned(probe)
  if (isSameAudio(a, b, probe)) return { winner: 'same' }
  if (probe !== undefined && isOtherVersion(a, b, probe)) return { winner: 'different' }
  const bWorse = replaceWarning(side(a), side(b))
  const aWorse = replaceWarning(side(b), side(a))
  if (bWorse && !aWorse) return { winner: 'a', reason: REASON[bWorse.reason] }
  if (aWorse && !bWorse) return { winner: 'b', reason: REASON[aWorse.reason] }
  const cleaner =
    flag(a.processed, b.processed, 'processed') ?? flag(a.upsampled, b.upsampled, 'upsampled')
  if (cleaner) return cleaner
  if (pair === undefined) return { winner: 'tie' }
  if (pair === null || pair.correlation < margins.sameMasterCorrelation) return { winner: 'tie' }
  return (
    byPeakCount(a, b, margins.peakCountRatio) ??
    byCrest(a, b, margins.crestDb) ?? { winner: 'tie', sameMaster: true }
  )
}
