import { describe, expect, it } from 'vitest'
import type { NormalizeConfig } from '../shared/types'
import {
  astatsArgs,
  limitedLoudnormFilter,
  loudnormArgs,
  loudnormFilter,
  parseAstatsChannels,
  parseLoudnorm,
  parseMaxVolume,
  peakChannelFilter,
  peakGainDb,
  reachesTargetLinearly,
  volumedetectArgs,
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

// ffmpeg hard-rejects loudnorm targets outside its documented ranges (I ∈ [-70, -5],
// TP ∈ [-9, 0]) with "Value ... out of range", killing the whole conversion. The
// settings fields are free-form numbers — a user who typed the ceiling as +2.6
// (thinking headroom) crashed every normalization — so the targets must be clamped
// where the filter strings are built.
describe('loudnorm target clamping', () => {
  const outOfRange: NormalizeConfig = {
    mode: 'loudness',
    targetLufs: -10.5,
    truePeakDb: 2.6,
    peakDb: -1,
  }
  const m = { inputI: -14.58, inputTp: -0.16, inputLra: 6.6, inputThresh: -24.79, targetOffset: -0.07 }

  it('clamps a positive true-peak ceiling to 0 in the measurement pass', () => {
    const filter = loudnormArgs('in.wav', outOfRange)[5]
    expect(filter).toContain('TP=0')
    expect(filter).toContain('I=-10.5')
  })

  it('clamps a positive true-peak ceiling to 0 in the second pass', () => {
    expect(loudnormFilter(outOfRange, m)).toContain('TP=0')
  })

  it('clamps the integrated target into loudnorm range', () => {
    const hot: NormalizeConfig = { mode: 'loudness', targetLufs: -3, truePeakDb: -12, peakDb: -1 }
    const filter = loudnormArgs('in.wav', hot)[5]
    expect(filter).toContain('I=-5')
    expect(filter).toContain('TP=-9')
  })

  // alimiter's limit tops out at 1.0 (full scale); an unclamped +2.6 dBTP would feed
  // it 1.35 and fail the same way.
  it('caps the limiter at full scale when the ceiling was typed positive', () => {
    expect(limitedLoudnormFilter(outOfRange, m)).toContain('alimiter=limit=1.000000')
  })

  // The reachability check must judge against the ceiling that will actually be
  // enforced, or it would pick linear mode for a ceiling the filter won't honor.
  it('judges reachability against the clamped ceiling', () => {
    const cfg: NormalizeConfig = { mode: 'loudness', targetLufs: -13, truePeakDb: 2.6, peakDb: -1 }
    // needs +1.58 dB; peak -0.16 + 1.58 = +1.42 — under the typed 2.6, over the real 0.
    expect(reachesTargetLinearly(cfg, m)).toBe(false)
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

  it('measures through the prefilter, so the gain is sized on the repaired audio', () => {
    const args = loudnormArgs('/in.aiff', loudness, 'adeclick')
    expect(args.join(' ')).toContain('-af adeclick,loudnorm=I=-14')
  })
})

describe('volumedetectArgs', () => {
  it('measures through the prefilter, so the peak is the repaired audio, not a click', () => {
    const args = volumedetectArgs('/in.aiff', 'adeclick')
    expect(args.join(' ')).toContain('-af adeclick,volumedetect')
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

// Real astats stderr shape: per-channel blocks first, then an Overall block whose
// lines carry no "Channel:" header and must not leak into the last channel.
const ASTATS_STEREO = `
[Parsed_astats_0 @ 0x1] Channel: 1
[Parsed_astats_0 @ 0x1] DC offset: 0.100000
[Parsed_astats_0 @ 0x1] Min level: 0.037515
[Parsed_astats_0 @ 0x1] Max level: 0.162485
[Parsed_astats_0 @ 0x1] Peak level dB: -15.783565
[Parsed_astats_0 @ 0x1] Channel: 2
[Parsed_astats_0 @ 0x1] DC offset: 0.000000
[Parsed_astats_0 @ 0x1] Min level: -0.031242
[Parsed_astats_0 @ 0x1] Max level: 0.031242
[Parsed_astats_0 @ 0x1] Peak level dB: -30.103000
[Parsed_astats_0 @ 0x1] Overall
[Parsed_astats_0 @ 0x1] DC offset: 0.050000
[Parsed_astats_0 @ 0x1] Min level: -0.031242
[Parsed_astats_0 @ 0x1] Max level: 0.162485
`

describe('astatsArgs', () => {
  it('decodes to float before astats so levels come out linear, into a null muxer', () => {
    const args = astatsArgs('/m/a.wav')
    expect(args.join(' ')).toContain('aformat=sample_fmts=flt,astats')
    expect(args.slice(-3)).toEqual(['-f', 'null', '-'])
  })

  it('measures through the prefilter, so channel extremes exclude repaired clicks', () => {
    const args = astatsArgs('/m/a.wav', 'adeclick')
    expect(args.join(' ')).toContain('adeclick,aformat=sample_fmts=flt,astats')
  })
})

describe('parseAstatsChannels', () => {
  it('reads DC offset and min/max level per channel, ignoring the Overall block', () => {
    expect(parseAstatsChannels(ASTATS_STEREO)).toEqual([
      { dc: 0.1, min: 0.037515, max: 0.162485 },
      { dc: 0, min: -0.031242, max: 0.031242 },
    ])
  })

  it('returns null when astats printed nothing usable', () => {
    expect(parseAstatsChannels('no stats here')).toBeNull()
  })
})

const peak = (over: Partial<NormalizeConfig> = {}): NormalizeConfig => ({
  mode: 'peak',
  targetLufs: -14,
  truePeakDb: -1,
  peakDb: -1,
  ...over,
})

describe('peakChannelFilter', () => {
  // Audacity's "Normalize stereo channels independently": each channel gets the
  // gain that puts ITS OWN peak on the target, instead of one shared gain.
  it('gives each channel its own gain when normalizing channels independently', () => {
    const f = peakChannelFilter(peak({ peakDb: 0, peakPerChannel: true }), [
      { dc: 0, min: -0.5, max: 0.5 },
      { dc: 0, min: -0.25, max: 0.25 },
    ])
    expect(f).toBe('aeval=exprs=val(0)*2.000000|val(1)*4.000000:c=same')
  })

  it('shares one gain from the loudest channel when channels stay linked', () => {
    const f = peakChannelFilter(peak({ peakDb: 0 }), [
      { dc: 0, min: -0.5, max: 0.5 },
      { dc: 0, min: -0.25, max: 0.25 },
    ])
    expect(f).toBe('aeval=exprs=val(0)*2.000000|val(1)*2.000000:c=same')
  })

  // Audacity's "Remove DC offset": the mean is subtracted per channel BEFORE the
  // gain is sized, so the headroom the offset was wasting becomes usable level.
  it('subtracts each channel mean and sizes the gain on the centered extent', () => {
    const f = peakChannelFilter(peak({ peakDb: 0, peakRemoveDc: true, peakPerChannel: true }), [
      { dc: 0.1, min: 0.037515, max: 0.162485 },
      { dc: 0, min: -0.25, max: 0.25 },
    ])
    // channel 1: extent max(|0.162485-0.1|, |0.037515-0.1|) = 0.062485 → gain 1/0.062485
    expect(f).toBe('aeval=exprs=(val(0)-(0.100000))*16.003841|(val(1)-(0.000000))*4.000000:c=same')
  })

  it('respects the dB target', () => {
    const f = peakChannelFilter(peak({ peakDb: -6.0206, peakPerChannel: true }), [
      { dc: 0, min: -0.5, max: 0.5 },
    ])
    // -6.0206 dB ≈ 0.5 linear; peak already at 0.5 → unity gain
    expect(f).toBe('aeval=exprs=val(0)*1.000000:c=same')
  })

  it('returns null when a channel is silent, so the caller skips normalization', () => {
    expect(
      peakChannelFilter(peak({ peakPerChannel: true }), [{ dc: 0, min: 0, max: 0 }]),
    ).toBeNull()
  })
})
