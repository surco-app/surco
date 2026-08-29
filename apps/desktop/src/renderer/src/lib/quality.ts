import type { NormalizeConfig } from '../../../shared/types'

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
//
// ext exempts a lossy container from the scale entirely. The bands measure a codec
// lowpass, which is precisely what an .mp3 is made of: grading one against the
// lossless line put "Review" on healthy 320s and taught users to distrust files that
// were exactly what they claimed to be. The cutoff still gets reported, in the
// caption, where a low-bitrate source is news rather than an accusation. Omitted (or
// an ambiguous .m4a, which may hold AAC or ALAC) keeps the stricter grading, so an
// unknown container is never assumed lossy.
export function qualityVerdict(
  cutoffHz: number,
  sampleRateHz: number,
  processed = false,
  hasKnee = true,
  ext = '',
): Verdict {
  if (processed) return 'processed'
  if (sampleRateHz <= 0) return 'warn'
  if (isLossyContainer(ext)) return 'good'
  if (!hasKnee) return 'good'
  if (cutoffHz >= GOOD_CUTOFF_HZ) return 'good'
  return cutoffHz >= WARN_CUTOFF_HZ ? 'warn' : 'bad'
}

// Containers that are lossless by definition, so any codec lowpass in them betrays a lossy
// source. .m4a is excluded: it can hold either ALAC (lossless) or AAC (lossy), so the
// extension alone can't promise lossless and would risk false positives on AAC files.
const LOSSLESS_CONTAINERS = ['flac', 'wav', 'aif', 'aiff', 'alac']

export function isLosslessContainer(ext: string): boolean {
  return LOSSLESS_CONTAINERS.includes(ext.toLowerCase())
}

// Containers that are lossy by definition, so their lowpass is the format working as
// designed. Listed explicitly rather than derived as "not lossless": an unrecognised
// extension must fall through to the strict scale, and .m4a belongs to neither list
// because it can hold AAC or ALAC.
const LOSSY_CONTAINERS = ['mp3', 'aac', 'ogg', 'oga', 'opus', 'wma']

export function isLossyContainer(ext: string): boolean {
  return LOSSY_CONTAINERS.includes(ext.toLowerCase())
}

// A "fake lossless" / transcode: a lossless-container file whose spectrum carries a real
// codec lowpass (a knee) below the full-quality line — i.e. a lossy file re-encoded as
// lossless. Gated tightly to stay high-precision: only lossless containers, only a detected
// knee (a genuine dark master is knee-free and must not trip), never a processed spectrum
// (regenerated highs are their own verdict), and only below GOOD_CUTOFF_HZ so a near-full
// knee doesn't cry wolf on full-bandwidth lossless. hasKnee defaults true to match
// qualityVerdict — an older cached analysis without the flag is graded on the codec scale.
export function isTranscode(
  ext: string,
  cutoffHz: number,
  hasKnee = true,
  processed = false,
): boolean {
  if (!isLosslessContainer(ext)) return false
  if (processed || !hasKnee) return false
  return cutoffHz < GOOD_CUTOFF_HZ
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

// Where the track lands after normalization, without converting it. A user was
// re-converting the same FLAC over and over just to read the resulting numbers: both
// modes apply a CONSTANT gain, so the outcome is arithmetic on figures the analysis
// already measured, not something an encode has to reveal.
//
// It mirrors main/normalize.ts on purpose — same clamps, same reachability test — so the
// estimate and the conversion can't disagree. It stays an estimate: loudnorm re-measures
// during the real pass and can land a few tenths off, which is why the UI labels it as one.
export interface NormalizePrediction {
  lufs: number
  truePeakDb: number
  // True when the target needs more gain than the ceiling allows, so the conversion
  // applies the full gain and limits the overs instead of falling short. The peak then
  // sits ON the ceiling rather than above it.
  limited: boolean
  // The constant gain the conversion applies, for the figures that simply ride along
  // with it (the noise floor). Null once the limiter engages: it holds the loud passages
  // back while the quiet ones still take the full gain, so no single figure describes
  // the shift and an estimate built on the nominal gain would overstate it.
  gainDb: number | null
}

export function predictNormalized(
  cfg: NormalizeConfig,
  measured: { integratedLufs: number | null; truePeakDb: number | null },
): NormalizePrediction | null {
  if (cfg.mode === 'none') return null
  const { integratedLufs: lufs, truePeakDb: peak } = measured
  // A missing or infinite reading (a silent decode reads -Infinity) would turn every
  // figure below into NaN on screen — no estimate is better than a fabricated one.
  if (lufs === null || peak === null || !Number.isFinite(lufs) || !Number.isFinite(peak))
    return null

  if (cfg.mode === 'peak') {
    // Peak mode sizes its gain from the peak, so the peak lands exactly on the target
    // and the loudness follows by the same amount.
    const gain = cfg.peakDb - peak
    return { lufs: lufs + gain, truePeakDb: cfg.peakDb, limited: false, gainDb: gain }
  }

  // Same clamps ffmpeg enforces (loudnorm rejects I outside [-70,-5], TP outside [-9,0]),
  // so a target typed out of range predicts what the conversion will actually do.
  const target = Math.min(-5, Math.max(-70, cfg.targetLufs))
  const ceiling = Math.min(0, Math.max(-9, cfg.truePeakDb))
  const gain = target - lufs
  const linearPeak = peak + gain
  // reachesTargetLinearly, restated: when the gained peak would clear the ceiling, the
  // conversion still applies the full gain and holds the overs at the ceiling.
  const limited = linearPeak > ceiling
  return {
    lufs: target,
    truePeakDb: limited ? ceiling : linearPeak,
    limited,
    gainDb: limited ? null : gain,
  }
}
