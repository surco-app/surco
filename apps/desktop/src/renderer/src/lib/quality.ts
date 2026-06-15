// Three-step lossless verdict (green/amber/red), banded on the absolute cutoff
// because codec lowpasses are absolute: ~20.5 kHz is a full 320 kbps / lossless,
// ~18.5–19 kHz is the ~192 kbps class, and ~16 kHz is the classic 128 kbps
// re-encoded as WAV. Grading against Nyquist (the old rule) punished 48 kHz
// files for the same audio. A processed spectrum (regenerated highs) is its own
// verdict — the spectrogram looks full, so a plain red "Bad quality" badge reads
// as a contradiction; "Reprocessed" names the manipulation instead. An unknown
// sample rate means the analysis never ran on real bands, so it stays inconclusive.
export type Verdict = 'good' | 'warn' | 'bad' | 'processed'

export const GOOD_CUTOFF_HZ = 19500
const WARN_CUTOFF_HZ = 18000

// hasKnee defaults true so a caller with only a frequency keeps grading on the
// codec scale; the real analysis passes it explicitly. A knee-free reading means
// no codec lowpass was found — every lossy source trips the knee — so the cutoff
// is just how far a genuine (often dark) master extends, and grading that extent
// as if it were a codec cut is what demoted healthy masters to "review".
export function qualityVerdict(
  cutoffHz: number,
  sampleRateHz: number,
  processed = false,
  hasKnee = true,
): Verdict {
  if (processed) return 'processed'
  if (sampleRateHz <= 0) return 'warn'
  if (!hasKnee) return 'good'
  if (cutoffHz >= GOOD_CUTOFF_HZ) return 'good'
  return cutoffHz >= WARN_CUTOFF_HZ ? 'warn' : 'bad'
}

export function formatKHz(hz: number): string {
  return `${(hz / 1000).toFixed(1)} kHz`
}

// DJ artwork should be reasonably sharp; Discogs usually serves 600px but some
// releases only carry a small thumbnail. Below this on the smaller side, the
// embedded cover looks soft on CDJ screens — worth telling the user to find better.
export const MIN_COVER_PX = 500

export function isLowResCover(width: number, height: number): boolean {
  const smaller = Math.min(width, height)
  return smaller > 0 && smaller < MIN_COVER_PX
}

// One-decimal label for a loudness figure (LUFS / dBTP / LU). A silent track
// measures -Infinity, which would print "-Infinity"; show the ∞ glyph instead.
export function formatDb(value: number): string {
  if (!Number.isFinite(value)) return '-∞'
  return value.toFixed(1)
}

// Three-step quality grade behind the loudness pills' colour (green/amber/red),
// so the verdict is readable without understanding the number. Tuned for a
// DJ/streaming library rather than mastering, and deliberately lenient in the
// middle band. -Infinity (silence) falls out correctly: no peak is good, no
// loudness is bad.
export type Grade = 'good' | 'warn' | 'bad'

// A true peak over 0 dBFS clips once the file is re-encoded to a lossy codec or
// played through a DAC; the last dB of headroom is where inter-sample peaks bite.
export function gradeTruePeak(dbtp: number): Grade {
  if (dbtp > 0) return 'bad'
  if (dbtp > -1) return 'warn'
  return 'good'
}

// Integrated loudness: a wide "loud enough but not crushed" band is good, the
// edges are a touch quiet/hot, and the extremes mean a broken-quiet rip or a
// brick-walled master.
export function gradeLufs(lufs: number): Grade {
  if (lufs < -20 || lufs > -6) return 'bad'
  if (lufs < -16 || lufs > -8) return 'warn'
  return 'good'
}

// Loudness range is the soft-to-loud spread; a near-zero range is the
// loudness-war signature of heavy compression.
export function gradeLra(lra: number): Grade {
  if (lra < 3) return 'bad'
  if (lra < 6) return 'warn'
  return 'good'
}

// Left/right level difference in dB: a tightly matched pair is fine, a few dB is
// a noticeable lean, more is a clear imbalance (often a misaligned cartridge).
export function gradeBalance(diffDb: number): Grade {
  if (diffDb >= 3) return 'bad'
  if (diffDb >= 1) return 'warn'
  return 'good'
}

// DC offset as a fraction of full scale: digital rips are usually near zero, so
// anything past ~1% points to a biased capture worth fixing.
export function gradeDcOffset(offset: number): Grade {
  if (offset >= 0.01) return 'bad'
  if (offset >= 0.002) return 'warn'
  return 'good'
}

// Crest factor in dB (peak − RMS): the transient punch. A healthy track keeps
// some headroom over its average level; a squashed, brick-walled master collapses
// toward the RMS.
export function gradeCrest(crestDb: number): Grade {
  if (crestDb < 8) return 'bad'
  if (crestDb < 12) return 'warn'
  return 'good'
}

// Noise floor in dB, lower (more negative) is cleaner. Graded leniently — a
// continuously loud track has little quiet to measure, so only a clearly audible
// floor is flagged.
export function gradeNoiseFloor(floorDb: number): Grade {
  if (floorDb > -30) return 'bad'
  if (floorDb > -45) return 'warn'
  return 'good'
}

// Renders a 0..1 fraction as a one-decimal percentage for the DC offset pill.
export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}
