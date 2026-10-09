import type { TrackItem } from '../types'
import { isTranscode, qualityVerdict, type Verdict } from './quality'

export type CopyQuality = {
  verdict: Verdict
  transcode: boolean
  cutoffHz: number
  hasKnee: boolean
} | null

// The verdict the editor shows for this file, read from the analysis the list already holds.
// Null when nothing was measured: the review says so instead of guessing.
export function copyQuality(row: TrackItem | undefined): CopyQuality {
  const spectrum = row?.spectrum
  if (!row || !spectrum || spectrum.cutoffHz === null) return null
  const ext = row.inputPath.split('.').pop()?.toLowerCase() ?? ''
  return {
    verdict: qualityVerdict(
      spectrum.cutoffHz,
      spectrum.sampleRateHz,
      spectrum.processed,
      spectrum.hasKnee,
      ext,
    ),
    transcode: isTranscode(ext, spectrum.cutoffHz, spectrum.hasKnee, spectrum.processed),
    cutoffHz: spectrum.cutoffHz,
    hasKnee: spectrum.hasKnee !== false,
  }
}

const ORDER: Record<Verdict, number> = { good: 0, warn: 1, processed: 2, bad: 4 }
const UNMEASURED = 3

export function qualityRank(quality: CopyQuality): number {
  if (quality === null) return UNMEASURED
  return quality.transcode ? ORDER.bad : ORDER[quality.verdict]
}
