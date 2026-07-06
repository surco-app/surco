import { describe, expect, it } from 'vitest'
import type { NormalizeConfig } from '../shared/types'
import {
  limitedLoudnormFilter,
  loudnormArgs,
  loudnormFilter,
  parseLoudnorm,
  parseMaxVolume,
  peakGainDb,
  reachesTargetLinearly,
  volumeFilter,
} from './normalize'

const loudness: NormalizeConfig = { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

describe('parseLoudnorm', () => {
  // loudnorm's first pass prints a JSON block to stderr, prefixed by the filter
  // tag. We need the measured input_* values and the target_offset to feed the
  // accurate (linear) second pass.
  const out = `[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-14.58",\n\t"input_tp" : "-0.16",\n\t"input_lra" : "6.60",\n\t"input_thresh" : "-24.79",\n\t"output_i" : "-13.93",\n\t"target_offset" : "-0.07"\n}`

  it('reads the measured input figures and target offset from the JSON block', () => {
    expect(parseLoudnorm(out)).toEqual({
      inputI: -14.58,
      inputTp: -0.16,
      inputLra: 6.6,
      inputThresh: -24.79,
      targetOffset: -0.07,
    })
  })

  it('returns null when no JSON is present (the measurement pass failed)', () => {
    expect(parseLoudnorm('ffmpeg error, no json here')).toBeNull()
  })

  it('returns null when a figure is non-finite (e.g. -inf on silence) so we skip rather than feed garbage', () => {
    const silent = out.replace('"input_i" : "-14.58"', '"input_i" : "-inf"')
    expect(parseLoudnorm(silent)).toBeNull()
  })
})

describe('loudnormFilter', () => {
  it('builds the accurate second pass from the target plus the measured values', () => {
    const f = loudnormFilter(loudness, {
      inputI: -14.58,
      inputTp: -0.16,
      inputLra: 6.6,
      inputThresh: -24.79,
      targetOffset: -0.07,
    })
    expect(f).toContain('loudnorm=I=-14:TP=-1:LRA=11')
    expect(f).toContain('measured_I=-14.58')
    expect(f).toContain('measured_TP=-0.16')
    expect(f).toContain('measured_thresh=-24.79')
    expect(f).toContain('offset=-0.07')
    // linear=true keeps the dynamics intact instead of pumping per-frame.
    expect(f).toContain('linear=true')
  })

  // Verified empirically: with measured_LRA above the LRA target, af_loudnorm ignores
  // linear=true and normalizes dynamically (pumping) — and even lands off the
  // integrated target (a −14 request came out at −11 on a 14-LU source). Raising the
  // LRA parameter to the measured value keeps linear mode; in linear mode the LRA
  // target compresses nothing (a constant gain can't change range), it's only the
  // linear/dynamic gate.
  it('raises the LRA target to the measured range so linear mode survives dynamic material', () => {
    const f = loudnormFilter(loudness, {
      inputI: -24.07,
      inputTp: -20.06,
      inputLra: 14,
      inputThresh: -36.71,
      targetOffset: -0.04,
    })
    expect(f).toContain('loudnorm=I=-14:TP=-1:LRA=14')
    expect(f).toContain('linear=true')
  })

  // loudnorm oversamples to 192 kHz internally and emits its output at that rate;
  // without restoring the source rate every normalized file would balloon to
  // 192 kHz and silently change sample rate — wrong for a 44.1 kHz rip.
  it('restores the source sample rate after loudnorm', () => {
    const m = {
      inputI: -14.58,
      inputTp: -0.16,
      inputLra: 6.6,
      inputThresh: -24.79,
      targetOffset: -0.07,
    }
    expect(loudnormFilter(loudness, m, 44100)).toMatch(/loudnorm=.*linear=true,aresample=44100$/)
    // No rate known → no resampler appended, rather than guessing.
    expect(loudnormFilter(loudness, m)).not.toContain('aresample')
  })
})

describe('reachesTargetLinearly', () => {
  // A constant gain hits the target only when the boost it needs keeps true peak under
  // the ceiling. A dynamic source with headroom to spare can be lifted linearly.
  it('is reachable when the needed boost stays under the true-peak ceiling', () => {
    const cfg: NormalizeConfig = { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }
    // needs +6 dB (-20 → -14); peak -8 + 6 = -2, still under -1.
    const m = { inputI: -20, inputTp: -8, inputLra: 6, inputThresh: -30, targetOffset: 0 }
    expect(reachesTargetLinearly(cfg, m)).toBe(true)
  })

  // The club target (-9) on normal material is the case the user hit: the boost it
  // needs would push peaks well past the ceiling, so linear loudnorm clamps the gain
  // and the track lands several dB short of target.
  it('is unreachable when a loud target would push peaks past the ceiling', () => {
    const cfg: NormalizeConfig = { mode: 'loudness', targetLufs: -9, truePeakDb: -1, peakDb: -1 }
    // needs +5 dB (-14 → -9); peak -1.7 + 5 = +3.3, far over -1.
    const m = { inputI: -14, inputTp: -1.7, inputLra: 6, inputThresh: -24, targetOffset: 0 }
    expect(reachesTargetLinearly(cfg, m)).toBe(false)
  })

  // Quieter target than the source: a cut never raises peaks, so it is always reachable.
  it('is reachable when the target is quieter than the source', () => {
    const cfg: NormalizeConfig = { mode: 'loudness', targetLufs: -16, truePeakDb: -1, peakDb: -1 }
    const m = { inputI: -8, inputTp: -0.2, inputLra: 6, inputThresh: -18, targetOffset: 0 }
    expect(reachesTargetLinearly(cfg, m)).toBe(true)
  })
})

describe('limitedLoudnormFilter', () => {
  // When linear can't reach the target, push the constant gain all the way to it and
  // catch the overs with a limiter at the ceiling, so the track lands at the chosen
  // loudness instead of short.
  it('applies the full gain to target then limits to the true-peak ceiling', () => {
    const cfg: NormalizeConfig = { mode: 'loudness', targetLufs: -9, truePeakDb: -1, peakDb: -1 }
    const m = { inputI: -14, inputTp: -1.7, inputLra: 6, inputThresh: -24, targetOffset: 0 }
    const f = limitedLoudnormFilter(cfg, m, 44100)
    // gain to target: -9 − (−14) = +5 dB
    expect(f).toContain('volume=5.00dB')
    // -1 dBTP ceiling in linear amplitude: 10^(-1/20) ≈ 0.891251
    expect(f).toContain('alimiter=limit=0.891251')
    // level=disabled so the limiter doesn't re-normalize away the gain we just applied.
    expect(f).toContain('level=disabled')
    // Oversamples 4× around the limiter (176.4k) and back, so inter-sample peaks are
    // caught and true peak doesn't creep above the ceiling.
    expect(f).toMatch(/aresample=176400,alimiter=.*,aresample=44100$/)
  })

  // With no known source rate the resampler can't be built, so it falls back to a plain
  // sample-peak limit rather than guessing an oversample rate.
  it('limits without oversampling when the source rate is unknown', () => {
    const cfg: NormalizeConfig = { mode: 'loudness', targetLufs: -9, truePeakDb: -1, peakDb: -1 }
    const m = { inputI: -14, inputTp: -1.7, inputLra: 6, inputThresh: -24, targetOffset: 0 }
    expect(limitedLoudnormFilter(cfg, m)).not.toContain('aresample')
  })
})

describe('loudnormArgs', () => {
  it('runs a measurement-only pass: the chosen target with json output to a null sink', () => {
    const args = loudnormArgs('/in.aiff', loudness)
    expect(args).toContain('/in.aiff')
    expect(args.join(' ')).toContain('loudnorm=I=-14:TP=-1:LRA=11:print_format=json')
    // measurement only: decode to a null muxer, no file written
    expect(args.slice(-3)).toEqual(['-f', 'null', '-'])
  })
})

describe('parseMaxVolume', () => {
  it('reads the peak sample level volumedetect reports', () => {
    expect(parseMaxVolume('[Parsed_volumedetect_0 @ 0x1] max_volume: -0.2 dB')).toBe(-0.2)
  })

  it('returns null when volumedetect printed nothing usable', () => {
    expect(parseMaxVolume('no volume here')).toBeNull()
  })
})

describe('peakGainDb', () => {
  it('computes the gain that lifts the loudest sample to the target ceiling', () => {
    // a track peaking at -6 dB, target -1 dB → boost +5 dB
    expect(peakGainDb(-1, -6)).toBe(5)
  })

  it('attenuates when the track already peaks above the target', () => {
    // peaking at +2 dB (clipping), target -1 → cut 3 dB
    expect(peakGainDb(-1, 2)).toBe(-3)
  })
})

describe('volumeFilter', () => {
  it('renders the gain as an ffmpeg volume filter in dB', () => {
    expect(volumeFilter(5)).toBe('volume=5dB')
    expect(volumeFilter(-3.2)).toBe('volume=-3.2dB')
  })
})
